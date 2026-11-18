// The seal-side half of the lockdown: bring a phase out of the box, run its
// gates, its canonical capture, and its sample check back inside one, and
// write down what the boundary observed.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { materializeSamplePack } from '../lib/sample-pack.mjs'
import { sha256, workspaceRoot, writeJson } from '../lib/shared.mjs'
import { readGatewayEvents } from '../lib/usage.mjs'
import { captureHarnessSource } from '../lib/run/workspace.mjs'
import { detectRuntime } from './runtime.mjs'
import {
  destroySession, evaluatorSessions, exportSession, findStrings, loadSession, runAudioMeasureInBox, runCaptureInBox, runGatesInBox, runSampleMatchInBox, sessionStateDir, summarizeGatewayLog,
} from './session.mjs'

export const ISOLATION_MODES = ['lockdown', 'none']

// What a run was created to require. Runs recorded before the field existed
// were never locked down and are not retroactively held to it.
export function requiredIsolation(run) {
  return ISOLATION_MODES.includes(run.isolation) ? run.isolation : 'none'
}

export function defaultIsolation(env = process.env) {
  return env.STAGEBENCH_ISOLATION === 'none' ? 'none' : 'lockdown'
}

export function hasSession(root, id, phase) {
  return loadSession(root, id, phase) !== null
}

// Copy the candidate out of its volume into the host workspace, refusing to go
// further if a credential travelled with it.
export async function exportLockedCandidate(root, { id, phase, workspace, onOutput }) {
  const exported = await exportSession(root, { id, phase, workspace, onOutput })
  if (exported.secretsInArtifact.length > 0) {
    throw new Error(`A credential from the lockdown session appears in the candidate tree (${exported.secretsInArtifact.slice(0, 5).join(', ')}). Sealing would publish it. Remove it in the box, then seal again.`)
  }
  for (const entry of exported.dropped) onOutput?.(`  ! dropped ${entry.kind} ${entry.path}${entry.target ? ` -> ${entry.target}` : ''} (links and special files do not cross the boundary)\n`)
  return exported
}

// Install and the four gates, in a box with no network. `featureTests` also
// collects which test files the candidate's runner executed.
export async function runLockedChecks(root, stageDir, { onOutput, featureTests = false, network = 'none' } = {}) {
  const gates = await runGatesInBox(root, stageDir, { onOutput, featureTests, network })
  return {
    // Same shape runChecks returns; the raw output stays out of the record.
    checks: gates.checks.map(({ id, command, passed, durationMs, detail, isolation }) => ({ id, command, passed, durationMs, detail, isolation })),
    gateIsolation: gates.gateIsolation,
    network: gates.network,
    gateway: gates.gateway,
    featureTests: gates.featureTests,
  }
}

// Canonical capture by the image's own Chromium, in a box with no network.
export function captureLocked(root, { id, phase, stageDir, onOutput }) {
  return runCaptureInBox(root, { distDir: path.join(stageDir, 'dist'), phase, evidenceDir: path.join(root, 'runs', id, `stage${phase}`, 'evidence'), harnessSource: captureHarnessSource(), onOutput })
}

// Harness-measured audio by the image's own Chromium, in a box with no
// network: the measurement modules are the harness's, copied in from here.
export function measureAudioLocked(root, { phase, stageDir, onOutput }) {
  const read = (name) => fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'run', name), 'utf8')
  return runAudioMeasureInBox(root, {
    distDir: path.join(stageDir, 'dist'),
    phase,
    files: { 'audio-analysis.mjs': read('audio-analysis.mjs'), 'audio-measure.mjs': read('audio-measure.mjs'), 'capture.mjs': captureHarnessSource() },
    onOutput,
  })
}

// The acoustic half of the sample check, wherever it can run: in a box when an
// engine answers, otherwise with this machine's ffmpeg. Returns null when
// neither is available, and the caller records that the check did not run.
export async function matchSamples(root, { stageDir, packDir, packDigest, entries, onOutput }) {
  if (entries.length === 0) return { threshold: null, results: [], where: 'none needed' }
  const script = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'run', 'sample-match.mjs'), 'utf8')
  const materialized = fs.existsSync(path.join(packDir, 'MANIFEST.json'))
  if (detectRuntime() && materialized) {
    return { ...(await runSampleMatchInBox(root, { stageDir, packDir, packDigest, entries, script, onOutput })), where: 'lockdown' }
  }
  const { spawnSync } = await import('node:child_process')
  if (spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status !== 0) return null
  const { matchEntries } = await import('../lib/run/sample-match.mjs')
  // Match against the published recordings, as the candidate was given them:
  // the phase's own copy, or a fresh one (the operator's store keeps WAV
  // recordings compressed, under another name).
  if (materialized) return { ...matchEntries({ stage: stageDir, pack: packDir, entries }), where: 'host' }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'stagebench-pack-'))
  try {
    materializeSamplePack(root, temporary)
    return { ...matchEntries({ stage: stageDir, pack: temporary, entries }), where: 'host' }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}

// Reasons a locked phase must not be sealed, however its gates went. The
// record is only worth having if a broken one stops the seal.
export function sealBlockers(root, id, phase, exported, gates, stageDir) {
  const blockers = []
  const session = exported.session
  const sessionLog = summarizeGatewayLog(path.join(sessionStateDir(root, id, phase), 'gateway', 'events.jsonl'))
  if (session.launches.length > 0 && !sessionLog.chainOk) blockers.push(`the session's gateway log is missing or its hash chain does not verify (${sessionLog.error ?? 'unknown'})`)
  // Protocol-3 gates have no network and so no gateway; only the legacy mirror leaves a log.
  if (gates.network === 'legacy-mirror' && !gates.gateway?.chainOk) blockers.push(`the gates' gateway log is missing or its hash chain does not verify (${gates.gateway?.error ?? 'unknown'})`)
  // A candidate session's gateway has no mirror door. Anything fetched through one means it was misconfigured.
  if ((sessionLog.mirrorArtifacts ?? 0) > 0) blockers.push(`the session's gateway served ${sessionLog.mirrorArtifacts} object(s) from a package mirror, which a protocol-3 session does not have`)
  if (exported.honeytoken.tokenInArtifact.length > 0) blockers.push(`a decoy's token is in the candidate tree (${exported.honeytoken.tokenInArtifact.slice(0, 3).join(', ')})`)
  // The build is published. A credential that was only encoded in the source
  // can come out of the build verbatim.
  const inBuild = findStrings(path.join(stageDir, 'dist'), [...(session.leakNeedles ?? []), session.honeytoken])
  if (inBuild.length > 0) blockers.push(`the built dist/ contains the session credential or a decoy's token (${[...new Set(inBuild.map((hit) => hit.path))].slice(0, 3).join(', ')})`)
  return blockers
}

// Advisory evidence entries a locked seal adds to the verification record.
export function lockdownEvidence(exported) {
  const { decoysRead, tokenInTranscript } = exported.honeytoken
  const touched = decoysRead.length > 0 || tokenInTranscript.length > 0
  return [{
    id: 'lockdown decoys',
    advisory: true,
    passed: !touched,
    detail: touched
      ? `Decoy scoring files inside the box were read (${decoysRead.join(', ') || 'token seen in the transcript'}). They contain nothing useful, but someone went looking; read the transcript.`
      : 'The decoy scoring files inside the box were not read',
  }]
}

// What the operator said to the candidate, launch by launch: the template that
// was used and the exact text that was sent.
export function operatorMessages(session) {
  return session.launches.map((launch) => ({
    launch: launch.index,
    kind: launch.kind,
    template: launch.message?.template ?? (launch.kind === 'follow-up' ? 'free' : 'initial'),
    offProtocol: Boolean(launch.message?.offProtocol) || Boolean(launch.interactive),
    interactive: Boolean(launch.interactive),
    sha256: launch.message?.sha256 ?? launch.promptSha256 ?? null,
    // The first message is the same fixed text for every run; its hash is enough.
    ...(launch.kind === 'follow-up' || launch.message?.offProtocol ? { text: launch.message?.text ?? launch.prompt ?? null } : {}),
    at: launch.startedAt,
  }))
}

// The isolation record written into the verification file at seal.
export function attestation(root, id, phase, exported, gates, extras = {}) {
  const { session } = exported
  const gateway = summarizeGatewayLog(path.join(sessionStateDir(root, id, phase), 'gateway', 'events.jsonl'))
  const messages = operatorMessages(session)
  return {
    mode: 'lockdown',
    version: 2,
    session: session.key,
    runtime: session.runtime,
    images: { candidate: session.images.candidate, gateway: session.images.gateway },
    // The candidate's whole network: its own model API, through the gateway.
    network: { candidate: 'model-api-only', packages: 'offline mirror in the image', gates: gates?.network ?? null, capture: extras.capture?.where === 'lockdown' ? 'none' : 'host' },
    toolchain: session.toolchain ?? null,
    samplePack: session.samplePack ? { manifestSha256: session.samplePack.manifestSha256 } : null,
    // Where install and the four gates ran, how each gate was kept from the
    // others, and what they could reach.
    gates: {
      isolation: 'lockdown',
      tree: gates?.gateIsolation ?? null,
      network: gates?.network ?? null,
      gateway: gates?.gateway ? {
        chainOk: gates.gateway.chainOk, head: gates.gateway.head, entries: gates.gateway.entries,
        denied: gates.gateway.denied, deniedTargets: gates.gateway.deniedTargets,
        mirrorArtifacts: gates.gateway.mirrorArtifacts, mirrorBytes: gates.gateway.mirrorBytes,
      } : null,
    },
    capture: extras.capture ?? null,
    launches: session.launches.map((launch) => ({
      index: launch.index,
      kind: launch.kind,
      harness: launch.harnessLabel,
      harnessVersion: launch.harnessVersion ?? null,
      auth: launch.auth,
      credentialInBox: Boolean(launch.credentialInBox),
      model: launch.model,
      interactive: launch.interactive,
      mcpServers: launch.mcpServers ?? [],
      startedAt: launch.startedAt,
      endedAt: launch.endedAt,
      exitCode: launch.exitCode,
      promptSha256: launch.promptSha256,
      messageTemplate: launch.message?.template ?? null,
      // Follow-up prompts are operator interventions; keep their text.
      ...(launch.kind === 'follow-up' ? { operatorMessage: launch.prompt } : {}),
    })),
    operator: {
      messages,
      followUps: messages.filter((message) => message.kind === 'follow-up').length,
      offProtocol: messages.filter((message) => message.offProtocol).length,
    },
    gateway: {
      chainOk: gateway.chainOk,
      head: gateway.head,
      entries: gateway.entries,
      denied: gateway.denied,
      deniedTargets: gateway.deniedTargets,
      modelRequests: gateway.modelRequests,
      models: gateway.models,
      strippedTools: gateway.strippedTools,
      tunnels: gateway.tunnels,
      mirrorArtifacts: gateway.mirrorArtifacts,
      mirrorBytes: gateway.mirrorBytes,
      usage: gateway.usage,
    },
    export: { dropped: exported.dropped },
    honeytoken: exported.honeytoken,
  }
}

// What goes to the transcript archive from a boxed session: the harness's own
// session files, and the launcher's console logs (written on this side of the
// boundary, under names that say which launch they belong to).
export function sessionTranscriptFiles(exported, { prefix = 'lockdown-console' } = {}) {
  const files = []
  if (exported?.transcripts && fs.existsSync(exported.transcripts)) {
    const visit = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name)
        if (entry.isDirectory()) visit(absolute)
        // Session rollouts only; history.jsonl is an index of prompts, not a session.
        else if (entry.isFile() && entry.name.endsWith('.jsonl') && entry.name !== 'history.jsonl') files.push(absolute)
      }
    }
    visit(exported.transcripts)
  }
  const sessions = files.sort()
  const consoles = []
  for (const [index, log] of (exported?.consoleLogs ?? []).entries()) {
    const staged = path.join(path.dirname(log), `${prefix}-${index}.log`)
    fs.copyFileSync(log, staged)
    consoles.push(staged)
  }
  return { sessions, consoles, all: [...sessions, ...consoles] }
}

export function unlockedAttestation(extras = {}) {
  return { mode: 'none', version: 2, gates: { isolation: 'host' }, network: { candidate: 'whatever its harness allowed', gates: 'host', capture: 'host' }, ...extras }
}

// Keep the boundary's own evidence with the run (small, no bodies), move the
// bulky rest — model request/response bodies, harness transcripts, launch
// logs — to an archive outside the repository, then tear the session down.
export function archiveAndClose(root, id, phase, record, gates) {
  const stateDir = sessionStateDir(root, id, phase)
  const runDir = path.join(root, 'runs', id, 'lockdown')
  const events = path.join(stateDir, 'gateway', 'events.jsonl')
  fs.mkdirSync(runDir, { recursive: true })
  if (fs.existsSync(events)) fs.copyFileSync(events, path.join(runDir, `stage${phase}.gateway.jsonl`))
  if (gates?.gateway?.events) fs.writeFileSync(path.join(runDir, `stage${phase}.gates.gateway.jsonl`), gates.gateway.events)
  writeJson(path.join(runDir, `stage${phase}.json`), record)
  const archive = path.join(workspaceRoot(root, 'archive'), id, `stage${phase}`)
  destroySession(root, id, phase)
  if (fs.existsSync(stateDir)) {
    fs.rmSync(archive, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(archive), { recursive: true })
    fs.renameSync(stateDir, archive)
  }
  return { record: path.join(runDir, `stage${phase}.json`), archive }
}

// Which model actually graded, as the provider reported it. For every model
// request an evaluator's box made, the gateway logged the model id the request
// asked for, the id the response said served it, and the provider's request
// id. The pin is checked against the served ids of the requests that asked for
// the pinned model (a harness's own auxiliary calls on a smaller model are
// recorded but are not the grader). Read before the boxes are closed.
export function graderRecord(root, id, phase, { requested, pinned }) {
  const sessions = []
  const served = {}
  const requestIds = []
  for (const kind of evaluatorSessions(root, id, phase)) {
    const stateDir = sessionStateDir(root, id, phase, kind)
    const session = loadSession(root, id, phase, kind)
    const events = readGatewayEvents(path.join(stateDir, 'gateway', 'events.jsonl'))
    const asked = new Map(events.filter((entry) => entry.kind === 'inspect.request' && entry.method === 'POST' && entry.model).map((entry) => [entry.seq, entry.model]))
    for (const entry of events) {
      if (entry.kind !== 'inspect.response' || !asked.has(entry.request)) continue
      const key = `${asked.get(entry.request)} -> ${entry.model ?? 'unreported'}`
      served[key] = (served[key] ?? 0) + 1
      if (entry.requestId) requestIds.push(entry.requestId)
    }
    sessions.push({ slot: session?.slot ?? 1, harness: session?.launches.map((launch) => `${launch.harnessLabel}${launch.harnessVersion ? ` ${launch.harnessVersion}` : ''}`).filter((value, index, all) => all.indexOf(value) === index) ?? [] })
  }
  const pinnedTurns = Object.entries(served).filter(([key]) => key.startsWith(`${requested} -> `))
  const drifted = pinnedTurns.filter(([key]) => key !== `${requested} -> ${pinned}`).map(([key, count]) => ({ servedAs: key.split(' -> ')[1], requests: count }))
  return {
    boxed: sessions.length > 0,
    requested,
    pinned,
    sessions,
    served,
    pinnedRequests: pinnedTurns.reduce((total, [, count]) => total + count, 0),
    requestIds: { count: requestIds.length, first: requestIds[0] ?? null, last: requestIds.at(-1) ?? null, sha256: requestIds.length ? sha256(requestIds.join('\n')) : null },
    requestIdList: requestIds,
    drift: drifted.length > 0 ? drifted : null,
    ...(sessions.length === 0 ? { note: 'The evaluator was not boxed, so no gateway saw its requests: the model that graded is what the assessment says, unverified.' } : {}),
  }
}

// The same for an evaluation's boxes, once its assessment is registered.
export function closeEvaluatorSessions(root, id, phase) {
  const closed = []
  for (const kind of evaluatorSessions(root, id, phase)) {
    const stateDir = sessionStateDir(root, id, phase, kind)
    const session = loadSession(root, id, phase, kind)
    const gateway = summarizeGatewayLog(path.join(stateDir, 'gateway', 'events.jsonl'))
    closed.push({
      slot: session.slot ?? 1,
      session: session.key,
      runtime: session.runtime,
      images: { candidate: session.images.candidate, gateway: session.images.gateway },
      launches: session.launches.map((launch) => ({ index: launch.index, kind: launch.kind, harness: launch.harnessLabel, harnessVersion: launch.harnessVersion ?? null, model: launch.model, messageTemplate: launch.message?.template ?? null, offProtocol: Boolean(launch.message?.offProtocol), startedAt: launch.startedAt, endedAt: launch.endedAt, exitCode: launch.exitCode })),
      gateway: { chainOk: gateway.chainOk, head: gateway.head, denied: gateway.denied, modelRequests: gateway.modelRequests, models: gateway.models, strippedTools: gateway.strippedTools },
    })
    const archive = path.join(workspaceRoot(root, 'archive'), id, `${kind}-stage${phase}`)
    destroySession(root, id, phase, { kind })
    if (fs.existsSync(stateDir)) {
      fs.rmSync(archive, { recursive: true, force: true })
      fs.mkdirSync(path.dirname(archive), { recursive: true })
      fs.renameSync(stateDir, archive)
    }
  }
  return closed
}
