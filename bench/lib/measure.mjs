// Measure what a built artifact actually DOES, by running it in a browser.
//
// Scope note, because the obvious larger version of this file is not
// achievable and it matters why. The panel criteria — geometry, keybed
// layout, control inventory, reachability — would all be scriptable if the
// artifacts shared a way to find a control, a section or a key in the DOM.
// They do not: the task never specified one, so each candidate invented its
// own. Across the sealed runs, `data-section` appears in 8 of 8 but
// `data-keybed` in 4, `data-deck` in 3 and `data-note` in 1. Scripting those
// criteria therefore requires adding a DOM contract to the task, which changes
// what is asked of candidates and cannot be applied to work already sealed.
// Until then those criteria stay evaluator-measured against the method the
// rubric names.
//
// The Web Audio API is different: it is a browser interface, not a candidate
// convention, so instrumenting it works against every artifact regardless of
// how it is written. That is enough to catch the failure that motivated this
// file — a run that shipped Phase 1 resealed as Phase 2, constructing no
// delay, convolver, compressor or panner and never calling decodeAudioData,
// while its IMPLEMENTATION_PLAN.md ticked all five hard gates and `seal`
// passed it, because sealing checked paperwork rather than behaviour.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { serveDirectory } from './run/capture.mjs'

const require = createRequire(import.meta.url)

function loadPlaywright() {
  try {
    return require('playwright')
  } catch {
    throw new Error('Audio verification requires playwright: pnpm add -D playwright && npx playwright install chromium')
  }
}

// The node types a phase's declared capabilities cannot be implemented
// without. Deliberately minimal: this is a floor that catches an absent
// deliverable, not a judgement about how the audio should be built. Anything
// subtler belongs to the evaluator.
export const PHASE_AUDIO_FLOOR = {
  1: { anyOf: [['Oscillator'], ['AudioBufferSource'], ['BufferSource']], because: 'a phase-1 artifact must be able to make a sound' },
  2: {
    anyOf: [['Delay'], ['Convolver'], ['DynamicsCompressor'], ['WaveShaper'], ['StereoPanner']],
    because: 'phase 2 requires audible effect units — delay, reverb, compressor, amp or pan',
  },
  3: {
    anyOf: [['Delay'], ['Convolver'], ['DynamicsCompressor'], ['WaveShaper'], ['StereoPanner']],
    because: 'phase 3 inherits the phase-2 effects chain',
  },
}

// Census every factory on the AudioContext prototype plus decodeAudioData,
// installed before any application code runs.
const AUDIO_CENSUS = `(() => {
  const counts = {}
  let decodeCalls = 0
  let contexts = 0
  const bump = (name) => { counts[name] = (counts[name] || 0) + 1 }

  const Ctor = window.AudioContext || window.webkitAudioContext
  if (!Ctor) {
    window.__audioCensus = () => ({ counts, decodeCalls, contexts, available: false })
    return
  }

  // Two ways to build a node, and artifacts use both: the factory methods on
  // the context (ctx.createDelay()) and the constructor form (new DelayNode(ctx)).
  // Counting only factories reported "no nodes" for every artifact, including
  // ones with demonstrably working effect chains.
  // The factory methods live on BaseAudioContext.prototype, not on
  // AudioContext.prototype — getOwnPropertyNames on the subclass returns none
  // of them, so patching there silently instruments nothing.
  const proto = (window.BaseAudioContext || Ctor).prototype
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (!name.startsWith('create')) continue
    const original = proto[name]
    if (typeof original !== 'function') continue
    proto[name] = function (...args) { bump(name.slice(6)); return original.apply(this, args) }
  }
  for (const name of Object.getOwnPropertyNames(window)) {
    if (!/Node$/.test(name)) continue
    const NodeCtor = window[name]
    if (typeof NodeCtor !== 'function' || !NodeCtor.prototype) continue
    const short = name.replace(/Node$/, '')
    window[name] = new Proxy(NodeCtor, { construct(target, args, newTarget) { bump(short); return Reflect.construct(target, args, newTarget) } })
  }

  if (typeof proto.decodeAudioData === 'function') {
    const decode = proto.decodeAudioData
    proto.decodeAudioData = function (...args) { decodeCalls++; return decode.apply(this, args) }
  }
  const CtxProxy = new Proxy(Ctor, { construct(target, args, newTarget) { contexts++; return Reflect.construct(target, args, newTarget) } })
  window.AudioContext = CtxProxy
  if (window.webkitAudioContext) window.webkitAudioContext = CtxProxy

  window.__audioCensus = () => ({ counts, decodeCalls, contexts, available: contexts > 0 || Object.keys(counts).length > 0 })
})()`

// Real Playwright interactions, over HTTP. An earlier version dispatched
// synthetic events against a file:// page and reported "never constructs an
// AudioContext" for every artifact including ones with known-good audio:
// browsers gate audio on a trusted user gesture, and synthetic events are not
// trusted. Anything that decides whether a phase sealed has to be driven the
// way a person drives it.
async function exercise(page) {
  await page.keyboard.press('Tab').catch(() => {})
  for (const key of ['z', 'x', 'c', 'v', 'a', 's', 'd']) {
    await page.keyboard.press(key).catch(() => {})
    await page.waitForTimeout(60)
  }
  // Play a key first: most artifacts build their graph lazily on the first
  // note, so clicking panel controls alone leaves the census empty. Artifacts
  // label keys differently, so try the shapes actually seen across sealed runs.
  for (const selector of ['[data-note]', '[data-midi]', '[data-key]', '.key', '[aria-label*="key" i]', '[class*="key"]']) {
    const keys = await page.$$(selector)
    if (keys.length < 20) continue
    for (const key of keys.slice(0, 4)) await key.click({ timeout: 800, force: true }).catch(() => {})
    await page.waitForTimeout(600)
    break
  }
  const clickable = await page.$$('button, [role="button"], [role="slider"], [role="switch"]')
  for (const element of clickable.slice(0, 120)) {
    await element.click({ timeout: 400, force: true }).catch(() => {})
  }
  await page.waitForTimeout(600)
}

// Run the built artifact and report which audio nodes it actually constructs.
export async function auditAudioGraph(buildDir, { timeout = 45_000 } = {}) {
  const { chromium } = loadPlaywright()
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
  let server = null
  try {
    const page = await browser.newContext({ viewport: { width: 1440, height: 900 } }).then((c) => c.newPage())
    const consoleErrors = []
    page.on('pageerror', (error) => consoleErrors.push(String(error.message).slice(0, 200)))
    await page.addInitScript(AUDIO_CENSUS)
    server = await serveDirectory(buildDir)
    await page.goto(server.url, { waitUntil: 'load', timeout })
    await page.waitForTimeout(600)
    await exercise(page)
    const census = await page.evaluate('window.__audioCensus ? window.__audioCensus() : { counts: {}, decodeCalls: 0, contexts: 0, available: false }')
    return { ...census, consoleErrors }
  } finally {
    await browser.close()
    await server?.close()
  }
}

// Does the artifact construct the nodes its phase cannot be implemented
// without? A miss is not a low score — it means the phase's deliverable is
// absent, whatever the plan document claims.
export function checkAudioFloor(census, phase) {
  const floor = PHASE_AUDIO_FLOOR[Number(phase)]
  if (!floor) return { id: 'audio-floor', passed: true, detail: `No audio floor defined for phase ${phase}` }
  if (!census.available) {
    return { id: 'audio-floor', passed: false, detail: 'The artifact never constructs an AudioContext' }
  }
  const built = Object.entries(census.counts).filter(([, count]) => count > 0).map(([name]) => name)
  const satisfied = floor.anyOf.some((group) => group.every((name) => built.includes(name)))
  return {
    id: 'audio-floor',
    passed: satisfied,
    detail: satisfied
      ? `Constructed: ${built.join(', ')}`
      : `${floor.because}. Constructed only: ${built.join(', ') || 'nothing'}; decodeAudioData called ${census.decodeCalls} times`,
    constructed: census.counts,
    decodeCalls: census.decodeCalls,
  }
}

export function buildDirFor(root, id, phase) {
  const published = path.join(root, 'public', 'previews', id, `stage${phase}`)
  if (fs.existsSync(path.join(published, 'index.html'))) return published
  const dist = path.join(root, 'runs', id, `stage${phase}`, 'dist')
  return fs.existsSync(path.join(dist, 'index.html')) ? dist : null
}
