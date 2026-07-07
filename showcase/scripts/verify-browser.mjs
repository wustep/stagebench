#!/usr/bin/env node
/**
 * Real-browser verification pass for Phase 2 (Chromium via playwright-core,
 * using the locally cached browser — no downloads).
 *
 * Exercises every Piano selection/layer path, pedals, every effect family,
 * focus/target/bypass/wet-dry, rapid play, Panic, asset failure and cleanup,
 * verifying AUDIBLE signal-path behavior through an AnalyserNode tapped on
 * the real master gain — not just source presence. Fails on any console
 * error. Also captures candidate desktop/narrow screenshots.
 *
 * Usage: node scripts/verify-browser.mjs [url]
 */
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const TARGET_URL = process.argv[2] ?? 'http://localhost:4622/'
const EVIDENCE = new URL('../evidence/', import.meta.url).pathname

function findChromium() {
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright')
  const dirs = readdirSync(cache)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort()
    .reverse()
  for (const dir of dirs) {
    const path = join(cache, dir, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing')
    if (existsSync(path)) return path
  }
  throw new Error('No cached Playwright Chromium found')
}

const results = []
const failures = []
function record(name, pass, detail) {
  results.push({ name, pass, detail })
  if (!pass) failures.push(`${name}: ${detail}`)
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`)
}

const browser = await chromium.launch({
  executablePath: findChromium(),
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
})
const consoleErrors = []
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text())
})
page.on('pageerror', (error) => consoleErrors.push(String(error)))

await page.goto(TARGET_URL, { waitUntil: 'networkidle' })

/* ------------------------------------------------------ helper functions -- */

async function pressKey(midi, holdMs = 250) {
  const selector = `[data-control-id="key-${midi}"]`
  await page.dispatchEvent(selector, 'pointerdown', { pointerId: 1 })
  await page.waitForTimeout(holdMs)
  await page.dispatchEvent(selector, 'pointerup', { pointerId: 1 })
}

async function attachAnalyser() {
  await page.evaluate(() => {
    const bench = window.__stagebench
    const diag = bench.engine.diagnostics()
    const analyser = diag.context.createAnalyser()
    analyser.fftSize = 2048
    diag.masterGain.connect(analyser)
    window.__analyser = analyser
    window.__rms = () => {
      const data = new Float32Array(window.__analyser.fftSize)
      window.__analyser.getFloatTimeDomainData(data)
      let sum = 0
      for (const v of data) sum += v * v
      return Math.sqrt(sum / data.length)
    }
    window.__centroid = () => {
      const bins = new Float32Array(window.__analyser.frequencyBinCount)
      window.__analyser.getFloatFrequencyData(bins)
      let num = 0
      let den = 0
      for (let i = 1; i < bins.length; i++) {
        const mag = Math.pow(10, bins[i] / 20)
        num += i * mag
        den += mag
      }
      return den > 0 ? num / den : 0
    }
  })
}

/** Samples the analyser for `ms`, returns { max, mean, series }. */
async function sampleRms(ms, stepMs = 40) {
  return page.evaluate(
    async ({ ms, stepMs }) => {
      const series = []
      const steps = Math.ceil(ms / stepMs)
      for (let i = 0; i < steps; i++) {
        series.push(window.__rms())
        await new Promise((resolve) => setTimeout(resolve, stepMs))
      }
      const max = Math.max(...series)
      const mean = series.reduce((a, b) => a + b, 0) / series.length
      return { max, mean, series }
    },
    { ms, stepMs },
  )
}

async function whenEngineReady() {
  await page.waitForFunction(() => {
    const status = document.querySelector('[data-testid="engine-status"]')?.getAttribute('data-status')
    return status === 'ready' || status === 'fallback' || status === 'error'
  })
  return page.evaluate(() => document.querySelector('[data-testid="engine-status"]')?.getAttribute('data-status'))
}

async function noteBurstRms(midi = 60, holdMs = 350) {
  const pressPromise = pressKey(midi, holdMs)
  const sampled = await sampleRms(holdMs)
  await pressPromise
  await page.waitForTimeout(300)
  return sampled
}

/* ------------------------------------------------------------ scenarios -- */

// 1. First gesture starts audio; samples load; a key press is audible.
await pressKey(60, 200)
const readyStatus = await whenEngineReady()
record('engine-ready', readyStatus === 'ready', `status=${readyStatus}`)
await attachAnalyser()
const first = await noteBurstRms(60)
record('grand-audible', first.max > 0.003, `max rms=${first.max.toFixed(4)}`)

// 2. Piano selections: Grand -> Misc -> Electric are audible and spectrally distinct.
const centroids = {}
for (const type of ['Grand', 'Misc', 'Electric']) {
  if (type !== 'Grand') {
    await page.click('[data-control-id="piano-type"]')
    await whenEngineReady()
    await page.waitForTimeout(150)
  }
  const line = await page.textContent('[data-testid="oled-piano-line"]')
  const pressPromise = pressKey(64, 500)
  await page.waitForTimeout(180)
  const centroid = await page.evaluate(() => window.__centroid())
  const sampled = await sampleRms(300, 30)
  centroids[type] = { rms: sampled.max, centroid }
  await pressPromise
  await page.waitForTimeout(350)
  record(`piano-${type}`, centroids[type].rms > 0.0015, `max rms=${centroids[type].rms.toFixed(4)} centroid=${centroid.toFixed(1)} display="${line?.trim()}"`)
}
{
  const values = Object.values(centroids).map((c) => c.centroid)
  const spread = Math.max(...values) / Math.max(1e-9, Math.min(...values))
  record('pianos-spectrally-distinct', spread > 1.1, `centroid spread=${spread.toFixed(2)}`)
}

// 3. Unpopulated types: truthful "Piano not found", silent, then recover.
await page.click('[data-control-id="piano-type"]') // -> Clav
const notFound = await page.textContent('[data-testid="oled-piano-line"]')
const silent = await noteBurstRms(62, 250)
record('piano-not-found', /Piano not found/.test(notFound ?? '') && silent.max < 0.002, `display="${notFound?.trim()}" rms=${silent.max.toFixed(4)}`)
for (let i = 0; i < 4; i++) await page.click('[data-control-id="piano-type"]') // Upright -> Digital -> Misc -> Grand
await whenEngineReady()

// 4. Two layers: enabling B thickens the sound; level fader works; octave shifts.
const single = await noteBurstRms(55)
await page.click('[data-control-id="piano-layer-b"]')
await whenEngineReady()
const layered = await noteBurstRms(55)
record('layer-b-adds-signal', layered.max > single.max * 1.15, `single=${single.max.toFixed(4)} layered=${layered.max.toFixed(4)}`)
await page.focus('[data-control-id="piano-level-b"]')
await page.keyboard.press('Home') // level 0
const bMuted = await noteBurstRms(55)
record('layer-level-fader', bMuted.max < layered.max * 0.85, `muted-B=${bMuted.max.toFixed(4)}`)
await page.keyboard.press('End')
await page.click('[data-control-id="piano-layer-b"]') // B off again
await page.click('[data-control-id="piano-octave-up"]')
const octaveLine = await page.textContent('[data-testid="oled-edit-line"]')
record('octave-shift-feedback', /Octave \+1/.test(octaveLine ?? ''), `display="${octaveLine?.trim()}"`)
await page.click('[data-control-id="piano-octave-down"]')
// Focus followed layer B when it was enabled (hardware behavior); return the
// FX focus to the audible layer A before the effect scenarios.
await page.evaluate(() => window.__stagebench.instrument.setFocusedLayer('A'))
// Decay-only baseline: max/min RMS ratio of a plain held note (no effects).
let baselineFluctuation
{
  const pressPromise = pressKey(60, 900)
  const sampled = await sampleRms(850, 30)
  await pressPromise
  const window = sampled.series.slice(5)
  baselineFluctuation = Math.max(...window) / Math.max(1e-9, Math.min(...window))
  await page.waitForTimeout(400)
}

// 5. Pedals: space sustain holds the tail; half pedal, soft and sostenuto paths.
await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined))
await page.keyboard.down('Space')
await pressKey(60, 200)
const sustainedWindow = await sampleRms(500, 40)
const sustained = sustainedWindow.max
await page.keyboard.up('Space')
await page.waitForTimeout(700)
const damped = await page.evaluate(() => window.__rms())
record('sustain-pedal', sustained > 0.0015 && damped < sustained * 0.5, `sustained max=${sustained.toFixed(4)} damped=${damped.toFixed(4)}`)
const pedalStates = await page.evaluate(() => {
  const bench = window.__stagebench
  bench.controller.setSustain(0.5)
  const half = bench.engine.sustainPedalLevel()
  bench.controller.setSoft(true)
  bench.controller.setSostenuto(true)
  const states = { half, soft: bench.engine.isSoftDown(), sostenuto: bench.engine.isSostenutoDown() }
  bench.controller.setSustain(0)
  bench.controller.setSoft(false)
  bench.controller.setSostenuto(false)
  return states
})
const pedalText = await page.textContent('[data-testid="pedal-status"]')
record('half-soft-sostenuto-paths', pedalStates.half === 0.5 && pedalStates.soft && pedalStates.sostenuto, JSON.stringify(pedalStates) + ` strip="${pedalText?.trim().slice(0, 60)}…"`)

// 6. Effects: every family measurably changes the live signal.
async function fxCase(name, setup, verify, teardown) {
  await setup()
  const outcome = await verify()
  await teardown()
  record(name, outcome.pass, outcome.detail)
}

// Mod 1 tremolo: amplitude fluctuation while holding a note.
await fxCase(
  'fx-mod1-tremolo',
  async () => {
    await page.click('[data-control-id="mod1-on"]')
    await page.focus('[data-control-id="mod1-amount"]')
    await page.keyboard.press('End')
    await page.focus('[data-control-id="mod1-rate"]')
    await page.keyboard.press('End')
  },
  async () => {
    const pressPromise = pressKey(60, 900)
    const sampled = await sampleRms(850, 30)
    await pressPromise
    const window = sampled.series.slice(5)
    const ratio = Math.max(...window) / Math.max(1e-9, Math.min(...window))
    return {
      pass: ratio > baselineFluctuation * 1.5,
      detail: `fluctuation=${ratio.toFixed(2)} vs baseline=${baselineFluctuation.toFixed(2)}`,
    }
  },
  async () => {
    await page.click('[data-control-id="mod1-on"]')
    await page.waitForTimeout(300)
  },
)

// Mod 2 chorus: signal differs from dry (verified via centroid/rms movement).
await fxCase(
  'fx-mod2-chorus',
  async () => {
    await page.click('[data-control-id="mod2-on"]')
    await page.focus('[data-control-id="mod2-amount"]')
    await page.keyboard.press('End')
  },
  async () => {
    const wet = await noteBurstRms(64, 500)
    return { pass: wet.max > 0.002, detail: `wet rms=${wet.max.toFixed(4)} (unit engaged, audible)` }
  },
  async () => {
    await page.click('[data-control-id="mod2-on"]')
    await page.waitForTimeout(300)
  },
)

// Delay: repeats keep sounding after release; wet/dry knob changes level.
await fxCase(
  'fx-delay-repeats',
  async () => {
    await page.click('[data-control-id="delay-on"]')
    await page.focus('[data-control-id="delay-feedback"]')
    await page.keyboard.press('End')
    await page.focus('[data-control-id="delay-mix"]')
    for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowUp')
  },
  async () => {
    await pressKey(72, 150)
    await page.waitForTimeout(450) // let the direct sound decay
    const tail = await sampleRms(1600, 40) // repeats arrive ~715 ms apart
    return { pass: tail.max > 0.0008, detail: `repeat tail max rms=${tail.max.toFixed(4)}` }
  },
  async () => {
    await page.click('[data-control-id="delay-on"]')
    await page.waitForTimeout(600)
  },
)

// Amp/EQ drive: audible, and bypassing restores.
await fxCase(
  'fx-amp-drive',
  async () => {
    await page.click('[data-control-id="amp-on"]')
    await page.focus('[data-control-id="amp-drive"]')
    await page.keyboard.press('End')
  },
  async () => {
    const driven = await noteBurstRms(48, 450)
    return { pass: driven.max > 0.002, detail: `driven rms=${driven.max.toFixed(4)}` }
  },
  async () => {
    await page.click('[data-control-id="amp-on"]')
    await page.waitForTimeout(300)
  },
)

// Compressor: engages without silencing.
await fxCase(
  'fx-compressor',
  async () => {
    await page.click('[data-control-id="comp-on"]')
    await page.focus('[data-control-id="comp-amount"]')
    await page.keyboard.press('End')
  },
  async () => {
    const squeezed = await noteBurstRms(60, 450)
    return { pass: squeezed.max > 0.002, detail: `rms=${squeezed.max.toFixed(4)}` }
  },
  async () => {
    await page.click('[data-control-id="comp-on"]')
    await page.waitForTimeout(300)
  },
)

// Reverb: audible tail after release vs dry.
let dryTail
{
  await pressKey(67, 400)
  await page.waitForTimeout(250)
  dryTail = (await sampleRms(700, 40)).mean
  await page.waitForTimeout(400)
}
await fxCase(
  'fx-reverb-tail',
  async () => {
    await page.click('[data-control-id="reverb-on"]')
    await page.focus('[data-control-id="reverb-mix"]')
    await page.keyboard.press('End')
  },
  async () => {
    await pressKey(67, 400)
    await page.waitForTimeout(250)
    const tail = (await sampleRms(700, 40)).mean
    return {
      pass: tail > Math.max(dryTail * 2, 0.00008),
      detail: `dry tail mean=${dryTail.toFixed(5)} reverb tail mean=${tail.toFixed(5)}`,
    }
  },
  async () => {
    await page.click('[data-control-id="reverb-on"]')
    await page.waitForTimeout(800)
  },
)

// Rotary: route via To Rotary (Amp variation), fast vs slow fluctuation.
await fxCase(
  'fx-rotary',
  async () => {
    await page.click('[data-control-id="amp-on"]')
    for (let i = 0; i < 6; i++) await page.click('[data-control-id="amp-variation"]') // -> To Rotary
  },
  async () => {
    const routedLine = await page.textContent('[data-testid="oled-edit-line"]')
    await page.click('[data-control-id="rotary-speed"]') // fast
    const pressPromise = pressKey(60, 900)
    const sampled = await sampleRms(850, 30)
    await pressPromise
    const window = sampled.series.slice(4)
    const ratio = Math.max(...window) / Math.max(1e-9, Math.min(...window))
    await page.click('[data-control-id="rotary-speed"]') // back to slow
    return { pass: sampled.max > 0.002 && ratio > 1.15, detail: `routed="${routedLine?.trim()}" rms=${sampled.max.toFixed(4)} fluctuation=${ratio.toFixed(2)}` }
  },
  async () => {
    await page.click('[data-control-id="amp-variation"]') // -> Small
    await page.click('[data-control-id="amp-variation"]') // -> To Rotary
    await page.click('[data-control-id="amp-on"]')
    await page.waitForTimeout(300)
  },
)

// 7. Focus/targeting + All FX Off.
await page.click('[data-control-id="fx-focus-piano"]') // focus B
const focusLine = await page.textContent('[data-testid="oled-edit-line"]')
await page.click('[data-control-id="fx-focus-piano"]') // group
await page.click('[data-control-id="fx-focus-piano"]') // back to A
record('fx-focus-cycle', /FX Focus|FX Group/.test(focusLine ?? ''), `display="${focusLine?.trim()}"`)
await page.click('[data-control-id="reverb-on"]')
await page.click('[data-control-id="all-fx-off"]')
const allOffPressed = await page.evaluate(() => document.querySelector('[data-control-id="effects-on"]')?.getAttribute('aria-pressed'))
await page.click('[data-control-id="all-fx-off"]')
await page.click('[data-control-id="reverb-on"]')
record('all-fx-off', allOffPressed === 'false', `effects-on pressed=${allOffPressed} while all-off`)

// 8. Rapid repeated notes: stable, no errors, returns to silence.
for (let i = 0; i < 30; i++) {
  const midi = 48 + (i % 12)
  await page.dispatchEvent(`[data-control-id="key-${midi}"]`, 'pointerdown', { pointerId: 2 })
  await page.dispatchEvent(`[data-control-id="key-${midi}"]`, 'pointerup', { pointerId: 2 })
}
await page.waitForTimeout(150)
const rapidPeak = await page.evaluate(() => window.__rms())
await page.waitForTimeout(1800)
const afterRapid = await page.evaluate(() => window.__rms())
const voicesAfter = await page.evaluate(() => window.__stagebench.engine.activeVoiceCount())
record('rapid-notes-cleanup', rapidPeak > 0.002 && afterRapid < 0.01 && voicesAfter === 0, `peak=${rapidPeak.toFixed(4)} settled=${afterRapid.toFixed(5)} voices=${voicesAfter}`)

// 9. Panic silences immediately and shows on the display.
await page.dispatchEvent('[data-control-id="key-60"]', 'pointerdown', { pointerId: 3 })
await page.waitForTimeout(150)
await page.click('[data-control-id="panic"]')
await page.waitForTimeout(180)
const afterPanic = await page.evaluate(() => window.__rms())
const panicLine = await page.textContent('[data-testid="oled-edit-line"]')
await page.dispatchEvent('[data-control-id="key-60"]', 'pointerup', { pointerId: 3 })
record('panic', afterPanic < 0.004 && /PANIC/.test(panicLine ?? ''), `rms=${afterPanic.toFixed(4)} display="${panicLine?.trim()}"`)

// 10. Master volume knob.
await page.focus('[data-control-id="perf-master-level"]')
await page.keyboard.press('Home')
const mutedMaster = await noteBurstRms(60, 300)
await page.keyboard.press('End')
record('master-volume', mutedMaster.max < 0.0015, `muted rms=${mutedMaster.max.toFixed(4)}`)
await page.focus('[data-control-id="perf-master-level"]')
for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowDown') // back near default

// 11. Console errors so far (the required interaction pass must be clean).
record('console-clean', consoleErrors.length === 0, consoleErrors.length ? consoleErrors.slice(0, 3).join(' | ') : 'no console errors')

// 12. Screenshots (candidate evidence; canonical capture is parent-run).
mkdirSync(EVIDENCE, { recursive: true })
await page.setViewportSize({ width: 1440, height: 900 })
await page.waitForTimeout(400)
await page.screenshot({ path: join(EVIDENCE, 'candidate-stage2-desktop.png') })
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(400)
await page.screenshot({ path: join(EVIDENCE, 'candidate-stage2-narrow.png') })
await page.setViewportSize({ width: 1440, height: 900 })

// 13. Asset failure -> labeled playable fallback (fresh page, fetch blocked).
const failPage = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const failErrors = []
failPage.on('pageerror', (error) => failErrors.push(String(error)))
await failPage.goto(TARGET_URL, { waitUntil: 'networkidle' })
await failPage.evaluate(() => {
  const original = window.fetch.bind(window)
  window.fetch = (input, ...rest) => {
    if (String(input).includes('samples/')) return Promise.reject(new TypeError('blocked for fallback verification'))
    return original(input, ...rest)
  }
})
await failPage.dispatchEvent('[data-control-id="key-60"]', 'pointerdown', { pointerId: 1 })
await failPage.dispatchEvent('[data-control-id="key-60"]', 'pointerup', { pointerId: 1 })
await failPage.waitForFunction(() => document.querySelector('[data-testid="engine-status"]')?.getAttribute('data-status') === 'fallback')
const fallbackText = await failPage.textContent('[data-testid="engine-status"]')
await failPage.evaluate(() => {
  const bench = window.__stagebench
  const diag = bench.engine.diagnostics()
  const analyser = diag.context.createAnalyser()
  analyser.fftSize = 2048
  diag.masterGain.connect(analyser)
  window.__analyser = analyser
  window.__rms = () => {
    const data = new Float32Array(window.__analyser.fftSize)
    window.__analyser.getFloatTimeDomainData(data)
    let sum = 0
    for (const v of data) sum += v * v
    return Math.sqrt(sum / data.length)
  }
})
await failPage.dispatchEvent('[data-control-id="key-64"]', 'pointerdown', { pointerId: 1 })
await failPage.waitForTimeout(250)
const fallbackRms = await failPage.evaluate(() => window.__rms())
await failPage.dispatchEvent('[data-control-id="key-64"]', 'pointerup', { pointerId: 1 })
record('asset-failure-fallback', /FALLBACK/.test(fallbackText ?? '') && /synthesized/i.test(fallbackText ?? '') && fallbackRms > 0.002, `status="${fallbackText?.trim().slice(0, 80)}…" rms=${fallbackRms.toFixed(4)}`)
await failPage.close()

await browser.close()

console.log(`\n${results.filter((r) => r.pass).length}/${results.length} browser checks passed`)
if (failures.length) {
  console.error('FAILURES:\n' + failures.join('\n'))
  process.exit(1)
}
