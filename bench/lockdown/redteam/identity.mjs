// Does the candidate know which model it is, or which run? It should not.
//
// The probe makes a real candidate workspace for a throwaway run whose run id,
// model, and title are made-up identifiers, opens a real lockdown session for
// it, writes the harness's home exactly as a launch would (Codex's and Claude
// Code's config, auth stand-ins, the pinned effort), and from inside the box
// dumps everything a candidate can look at: its environment, working
// directory, hostname, /etc/hosts, the container's own records, the process
// table, git config, every file in the workspace and the home directory, and
// the prompts. The host then searches the dump for the identifiers, in any
// punctuation.
//
// Two places are allowed to name the model, and only these: the harness's own
// configuration and command line, because the CLI has to send the model id
// with every request. They are reported as known, not hidden. Everything else
// is a leak and fails the red team.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { namePattern } from '../../lib/eval/workspace.mjs'
import { workspaceRoot, writeJson } from '../../lib/shared.mjs'
import { createRun } from '../../lib/run/store.mjs'
import { startPhase } from '../../lib/run/workspace.mjs'
import { BOX_HOME, HARNESSES, resolveAuth } from '../harnesses.mjs'
import { CANDIDATE_MESSAGES, neutralizeFailure } from '../messages.mjs'
import { destroySession, openSession, runInBox, sessionNames, startGateway, stopGateway } from '../session.mjs'
import { writeIntoVolume } from '../runtime.mjs'

// What a candidate-side process can see, section by section.
export const IDENTITY_SCRIPT = [
  'section() { printf "\\n### %s\\n" "$1"; }',
  'section env; env | sort',
  'section cwd; pwd',
  'section hostname; hostname; cat /etc/hostname 2>/dev/null',
  'section hosts; cat /etc/hosts 2>/dev/null',
  'section containerenv; cat /run/.containerenv 2>/dev/null; ls -la /run 2>/dev/null',
  'section cgroup; cat /proc/self/cgroup 2>/dev/null',
  'section mountinfo; cat /proc/self/mountinfo 2>/dev/null',
  'section processes; for p in /proc/[0-9]*; do tr "\\000" " " < "$p/cmdline" 2>/dev/null; echo; done',
  'section git-config; git config --global --list 2>&1; git config --system --list 2>&1; git -C /workspace/candidate config --list 2>&1',
  'section workspace-files; find /workspace -not -path "*/node_modules/*" -not -path "/workspace/inputs/samples/*" 2>/dev/null',
  'section home-files; find "$HOME" -maxdepth 5 2>/dev/null',
  // Every small text file a candidate can read in its workspace and home:
  // prompts, inputs, the starter tree, and the harness's own configuration.
  'for f in $(find /workspace "$HOME" -type f -size -512k -not -path "*/node_modules/*" -not -path "/workspace/inputs/samples/*" -not -name "*.pdf" -not -name "*.jpg" -not -name "*.png" 2>/dev/null); do printf "\\n### file:%s\\n" "$f"; cat "$f" 2>/dev/null; done',
].join('\n')

// Split the dump into { name: text } sections.
export function parseSections(output) {
  const sections = {}
  let current = null
  for (const line of String(output).split('\n')) {
    const header = /^### (.+)$/.exec(line)
    if (header) {
      current = header[1].trim()
      sections[current] ??= ''
      continue
    }
    if (current) sections[current] += `${line}\n`
  }
  return sections
}

// Where the model's id is allowed to appear: the harness's own config and
// command line (the CLI sends it with every request). Nowhere else.
export function isHarnessSurface(section) {
  return /^file:.*\/\.codex\/config\.toml$/.test(section) || section === 'harness-command'
}

// Every place an identifier shows up, in any punctuation, split into what the
// harness itself requires and what is a leak.
export function findIdentityLeaks(sections, identifiers) {
  const patterns = [...new Set(identifiers.filter(Boolean).map(String))]
    .sort((a, b) => b.length - a.length)
    .map((name) => ({ name, pattern: namePattern(name) }))
    .filter((entry) => entry.pattern)
  const leaks = []
  const known = []
  for (const [section, text] of Object.entries(sections)) {
    for (const { name, pattern } of patterns) {
      pattern.lastIndex = 0
      const match = pattern.exec(text)
      if (!match) continue
      const line = text.slice(text.lastIndexOf('\n', match.index) + 1, text.indexOf('\n', match.index) === -1 ? undefined : text.indexOf('\n', match.index)).trim().slice(0, 200)
      const hit = { section, identifier: name, line }
      if (isHarnessSurface(section)) known.push(hit)
      else leaks.push(hit)
    }
  }
  return { leaks, known }
}

// What can never be hidden from a candidate, whatever the launcher does.
export const UNHIDEABLE = [
  'The model knows its own identity from its training and from the system prompt its harness sends: Codex opens with "You are Codex, an agent based on GPT-6" and lists the current model among its subagent model overrides; Claude Code tells the model its name and model id in its system prompt. Changing that means changing the harness, which is the unit under test.',
  'The harness has to send the model id with every request, so it is in the harness\'s configuration (Codex: model in ~/.codex/config.toml) or on its command line (Claude Code: --model), both readable from inside the box.',
  'The harness\'s own session files (~/.codex/sessions, ~/.claude/projects) record the model for every turn, and the provider names the model in every response.',
]

const MINIMAL_CHECKOUT = [
  'BENCHMARK.md', 'TASK.md', 'package.json',
  'specs/benchmark-phases.json', 'specs/nord-stage-4.variants.json', 'specs/nord-stage-4.visual.json', 'specs/nord-stage-4.piano.json',
  'prompts/stage1.md', 'bench/rubric.json',
  'bench/schemas/implementation-details.schema.json',
]

// A throwaway checkout holding just what `start` needs (no runs, no pack), so
// the probe never writes a run into the real repository.
function probeCheckout(root) {
  const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stagebench-identity-'))
  for (const relative of MINIMAL_CHECKOUT) {
    const source = path.join(root, relative)
    if (!fs.existsSync(source)) continue
    fs.mkdirSync(path.dirname(path.join(probeRoot, relative)), { recursive: true })
    fs.copyFileSync(source, path.join(probeRoot, relative))
  }
  fs.cpSync(path.join(root, 'bench', 'starter'), path.join(probeRoot, 'bench', 'starter'), { recursive: true, filter: (entry) => !['node_modules', 'dist', '.git'].includes(path.basename(entry)) })
  writeJson(path.join(probeRoot, 'src', 'data', 'runs.json'), [])
  return probeRoot
}

export async function runIdentityProbe(root, { runtime, onOutput } = {}) {
  const tag = crypto.randomBytes(4).toString('hex')
  // Made-up identifiers that cannot occur by accident.
  const model = `sbprobe-${tag}-model`
  const title = `Sbprobe ${tag} Title`
  const probeRoot = probeCheckout(root)
  let session = null
  try {
    const created = createRun(probeRoot, { model, title, target: '1', provider: 'openai' })
    const id = created.id
    const identifiers = [id, model, title]
    const started = startPhase(probeRoot, id)
    const opened = await openSession(probeRoot, { id, phase: 1, workspace: started.workspace, runtime, onOutput })
    session = opened.session
    const names = sessionNames(session.key)
    const results = []
    for (const [harness, adapter] of Object.entries(HARNESSES).filter(([name]) => name !== 'custom')) {
      // The home a launch of this harness would write: its config, the pinned
      // effort, the run's model, and auth stand-ins (no real credential).
      const fakeEnv = { STAGEBENCH_OPENAI_API_KEY: `sk-proj-${crypto.randomBytes(24).toString('hex')}`, STAGEBENCH_ANTHROPIC_API_KEY: `sk-ant-api03-${crypto.randomBytes(24).toString('hex')}` }
      const auth = resolveAuth(adapter, fakeEnv, { auth: 'api-key' })
      const context = { prompt: CANDIDATE_MESSAGES.initial.text({ workspace: '/workspace' }), interactive: false, resume: false, model, effort: 'high', extraArgs: [], mcpServers: {} }
      writeIntoVolume(opened.runtime, { image: opened.images.candidate.tag, volume: names.home, files: [...adapter.files(context), ...auth.files] })
      await startGateway(opened.runtime, session, opened.images, { egress: auth.egress, mirrors: {}, secrets: auth.gatewaySecrets, bodyLog: 'none' })
      let probe
      try {
        probe = await runInBox(opened.runtime, session, opened.images, { argv: ['sh', '-c', IDENTITY_SCRIPT], env: { ...adapter.env, ...auth.env }, timeout: 300_000 })
      } finally {
        stopGateway(opened.runtime, session)
      }
      const sections = parseSections(probe.output)
      // The command line the launcher would give the harness, which the process
      // table inside the box shows while it runs.
      sections['harness-command'] = adapter.command(context).join(' ')
      // The messages an operator can send, filled in as the launcher fills
      // them — a seal failure that quoted the run's and model's names included.
      const failure = neutralizeFailure(`src/${id}.ts and docs/${title}.md name the producer; see runs/${id}/stage1`, { root: probeRoot, id, names: [model, title] })
      sections.messages = [
        CANDIDATE_MESSAGES.initial.text({ workspace: '/workspace' }),
        CANDIDATE_MESSAGES.continue.text(),
        CANDIDATE_MESSAGES['seal-failure'].text({ failure }),
      ].join('\n')
      const found = findIdentityLeaks(sections, identifiers)
      results.push({ harness, sections: Object.keys(sections).length, files: Object.keys(sections).filter((name) => name.startsWith('file:')).length, leaks: found.leaks, known: found.known })
    }
    return {
      identifiers: { runId: id, model, title },
      home: BOX_HOME,
      harnesses: results,
      leaks: results.flatMap((entry) => entry.leaks.map((leak) => ({ harness: entry.harness, ...leak }))),
      knownHarnessSurfaces: [...new Set(results.flatMap((entry) => entry.known.map((hit) => `${entry.harness}: ${hit.section}`)))],
      unhideable: UNHIDEABLE,
      passed: results.every((entry) => entry.leaks.length === 0),
    }
  } finally {
    if (session) {
      try { destroySession(probeRoot, session.runId, 1, { keepState: false }) } catch { /* nothing to remove */ }
    }
    for (const kind of ['work', 'lockdown']) fs.rmSync(path.dirname(workspaceRoot(probeRoot, kind)), { recursive: true, force: true })
    fs.rmSync(probeRoot, { recursive: true, force: true })
  }
}
