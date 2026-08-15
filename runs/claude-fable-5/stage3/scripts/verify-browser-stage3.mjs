#!/usr/bin/env node
/**
 * Real-browser verification pass for Phase 3 (Chromium via playwright-core,
 * using the locally cached browser — no downloads).
 *
 * Exercises the Organ engines/drawbars, Synth categories/filter/arp,
 * Programs (store/load/dirty/live), splits/zones, scenes, morphs, transpose
 * and Panic, verifying AUDIBLE behavior through an AnalyserNode tapped on the
 * real master gain. Fails on any console error. Also captures the
 * candidate-stage3 desktop/narrow screenshots.
 *
 * Usage: node scripts/verify-browser-stage3.mjs [url]
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

async function pressKey(midi, holdMs = 250, pointerId = 1) {
  const selector = `[data-control-id="key-${midi}"]`
  await page.dispatchEvent(selector, 'pointerdown', { pointerId })
  await page.waitForTimeout(holdMs)
  await page.dispatchEvent(selector, 'pointerup', { pointerId })
}

async function attachAnalyser() {
  await page.evaluate(() => {
    const bench = window.__stagebench
    const diag = bench.engine.diagnostics()
    const analyser = diag.context.createAnalyser()
    analyser.fftSize = 2048
    // No smoothing: we sample the spectrum sparsely, and the default 0.8
    // smoothing would blend each read with the stale previous read.
    analyser.smoothingTimeConstant = 0
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
    /** Fraction of spectral POWER above cutoffHz (power sums keep the noise
     *  floor from dominating the ratio the way magnitude sums do). */
    window.__highRatio = (cutoffHz) => {
      const analyser = window.__analyser
      const bins = new Float32Array(analyser.frequencyBinCount)
      analyser.getFloatFrequencyData(bins)
      const binWidth = analyser.context.sampleRate / analyser.fftSize
      const cutoffBin = Math.round(cutoffHz / binWidth)
      let high = 0
      let total = 0
      for (let i = 1; i < bins.length; i++) {
        const power = bins[i] > -90 ? Math.pow(10, bins[i] / 10) : 0
        total += power
        if (i >= cutoffBin) high += power
      }
      return total > 0 ? high / total : 0
    }
  })
}

async function sampleRms(ms, stepMs = 40) {
  return page.evaluate(
    async ({ ms, stepMs }) => {
      const series = []
      const steps = Math.ceil(ms / stepMs)
      for (let i = 0; i < steps; i++) {
        series.push(window.__rms())
        await new Promise((resolve) => setTimeout(resolve, stepMs))
      }
      return { max: Math.max(...series), mean: series.reduce((a, b) => a + b, 0) / series.length, series }
    },
    { ms, stepMs },
  )
}

async function noteBurstRms(midi = 60, holdMs = 350) {
  const pressPromise = pressKey(midi, holdMs)
  const sampled = await sampleRms(holdMs)
  await pressPromise
  await page.waitForTimeout(300)
  return sampled
}

async function heldCentroid(midi, holdMs = 500, cutoffHz = 1500) {
  const pressPromise = pressKey(midi, holdMs)
  await page.waitForTimeout(250)
  const centroid = await page.evaluate(() => window.__centroid())
  const high = await page.evaluate((hz) => window.__highRatio(hz), cutoffHz)
  const rms = await page.evaluate(() => window.__rms())
  await pressPromise
  await page.waitForTimeout(400)
  return { centroid, high, rms }
}

/** Panel SHIFT is a latched on-screen button; wrap a shifted click. */
async function shiftClick(selector) {
  await page.click('[data-control-id="shift"]')
  await page.click(selector)
  await page.click('[data-control-id="shift"]')
}

const state = () => page.evaluate(() => window.__stagebench.instrument.getState())

/* ------------------------------------------------------------ scenarios -- */

// Boot: start the engine, keep only the Organ sounding for the organ block.
await pressKey(60, 150)
await page.waitForFunction(() => {
  const status = document.querySelector('[data-testid="engine-status"]')?.getAttribute('data-status')
  return status === 'ready' || status === 'fallback'
})
await attachAnalyser()

// 1. Organ: layer A on, piano off → organ is audible on its own.
await page.click('[data-control-id="organ-layer-a"]')
await page.click('[data-control-id="piano-on"]')
const organB3 = await heldCentroid(60)
record('organ-audible', organB3.rms > 0.002, `B3 rms=${organB3.rms.toFixed(4)}`)

// 2. Organ models are spectrally distinct (B3 → Vox → Farf).
const modelCentroids = { B3: organB3.centroid }
await page.click('[data-control-id="organ-model"]') // B3 Bass
await page.click('[data-control-id="organ-model"]') // Vox
modelCentroids.Vox = (await heldCentroid(60)).centroid
await page.click('[data-control-id="organ-model"]') // Farf
modelCentroids.Farf = (await heldCentroid(60)).centroid
{
  const values = Object.values(modelCentroids)
  const spread = Math.max(...values) / Math.max(1e-9, Math.min(...values))
  record('organ-models-distinct', spread > 1.15, `centroids B3=${modelCentroids.B3.toFixed(1)} Vox=${modelCentroids.Vox.toFixed(1)} Farf=${modelCentroids.Farf.toFixed(1)} spread=${spread.toFixed(2)}`)
}
for (let i = 0; i < 3; i++) await page.click('[data-control-id="organ-model"]') // back to B3 (Pipe1→Pipe2→B3)

// 3. Drawbars: pulling the 1' drawbar (2093 Hz partial on C4) adds
//    measurable high-band energy to the live tone.
const beforeDrawbar = await heldCentroid(60, 500, 1800)
await page.focus('[data-control-id="organ-drawbar-9"]')
await page.keyboard.press('End')
const afterDrawbar = await heldCentroid(60, 500, 1800)
record('drawbar-brightens', afterDrawbar.high > beforeDrawbar.high * 1.5, `high-band ratio ${beforeDrawbar.high.toFixed(4)} → ${afterDrawbar.high.toFixed(4)}`)
await page.focus('[data-control-id="organ-drawbar-9"]')
await page.keyboard.press('Home')

// 4. Percussion and vibrato write canonical state with LED/display feedback.
await page.click('[data-control-id="organ-perc-on"]')
await page.click('[data-control-id="organ-vib-on"]')
const organState = (await state()).organ
record('organ-perc-vibrato', organState.percussion.on === true && organState.layers.A.vibratoOn === true, `perc=${organState.percussion.on} vibrato=${organState.layers.A.vibratoOn}`)
await page.click('[data-control-id="organ-perc-on"]')
await page.click('[data-control-id="organ-vib-on"]')

// 5. Synth: layer A on, organ off → synth audible; categories distinct.
await page.click('[data-control-id="organ-layer-a"]')
await page.click('[data-control-id="synth-layer-a"]')
const synthHigh = {}
const pureHold = await heldCentroid(60, 500, 1200)
synthHigh.Pure = pureHold.high
record('synth-audible', pureHold.rms > 0.0015, `Pure rms=${pureHold.rms.toFixed(4)}`)
await page.click('[data-control-id="waveform-select"]') // Sync
await page.click('[data-control-id="waveform-select"]') // Multi
await page.click('[data-control-id="waveform-select"]') // Super
synthHigh.Super = (await heldCentroid(60, 500, 1200)).high
await page.click('[data-control-id="waveform-select"]') // FM-H
synthHigh.FM = (await heldCentroid(60, 500, 1200)).high
{
  const values = Object.values(synthHigh)
  const spread = Math.max(...values) / Math.max(1e-6, Math.min(...values))
  record('synth-categories-distinct', spread > 2, `high-band Pure=${synthHigh.Pure.toFixed(4)} Super=${synthHigh.Super.toFixed(4)} FM=${synthHigh.FM.toFixed(4)} spread=${spread.toFixed(1)}`)
}
await page.click('[data-control-id="waveform-select"]') // back to Pure

// 6. Filter frequency audibly darkens (Super Saw for broadband source).
for (let i = 0; i < 3; i++) await page.click('[data-control-id="waveform-select"]') // → Super
const openFilter = await heldCentroid(60, 500, 1200)
await page.focus('[data-control-id="filter-freq"]')
await page.keyboard.press('Home')
for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowUp')
const closedFilter = await heldCentroid(60, 500, 1200)
record('synth-filter-darkens', closedFilter.high < openFilter.high * 0.5, `high-band ${openFilter.high.toFixed(4)} → ${closedFilter.high.toFixed(4)}`)
await page.focus('[data-control-id="filter-freq"]')
await page.keyboard.press('End')
for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowDown')
await page.click('[data-control-id="waveform-select"]') // FM-H
await page.click('[data-control-id="waveform-select"]') // → Pure

// 7. Arpeggiator: run + hold keeps stepped notes sounding after release.
await page.click('[data-control-id="kb-hold"]')
await page.click('[data-control-id="arp-run"]')
await pressKey(60, 120)
await pressKey(64, 120)
await page.waitForTimeout(300)
const arpTail = await sampleRms(1200, 40)
record('arp-hold-runs', arpTail.max > 0.0015, `held-arp rms=${arpTail.max.toFixed(4)} after release`)
await page.click('[data-control-id="arp-run"]')
await page.click('[data-control-id="kb-hold"]')
await page.click('[data-control-id="panic"]')
await page.waitForTimeout(300)

// 8. Programs: dirty indicator, store to another slot, load round-trip, undo.
await page.click('[data-control-id="piano-on"]') // piano back on
await page.focus('[data-control-id="piano-level-a"]')
await page.keyboard.press('ArrowDown')
const dirtyLine = await page.textContent('[data-testid="oled-program-line"]')
record('program-dirty-indicator', / E\b/.test(dirtyLine ?? ''), `display="${dirtyLine?.trim()}" (E = edited)`)
await page.click('[data-control-id="store"]')
await page.click('[data-control-id="program-3"]') // audition destination 1.3
await page.click('[data-control-id="store"]') // confirm
const storedLine = await page.textContent('[data-testid="oled-edit-line"]')
const afterStore = await state()
record('program-store', afterStore.programs.current.index === 2 && !/ E\b/.test((await page.textContent('[data-testid="oled-program-line"]')) ?? ''), `display="${storedLine?.trim()}" slot=${afterStore.programs.current.index + 1}`)
await page.click('[data-control-id="program-1"]')
await page.click('[data-control-id="program-3"]')
const roundtrip = await state()
record('program-roundtrip', roundtrip.layers.A.level === afterStore.layers.A.level, `restored level=${roundtrip.layers.A.level}`)

// 9. Live Mode: edits auto-store into the Live slot.
await page.click('[data-control-id="live-mode"]')
await page.focus('[data-control-id="piano-level-a"]')
await page.keyboard.press('ArrowDown')
const liveState = await state()
const liveStored = liveState.programs.live[liveState.programs.current.index]?.pianoLayers.A.level === liveState.layers.A.level
record('live-mode-autostore', liveState.programs.current.bank === 'live' && liveStored, `bank=${liveState.programs.current.bank} stored=${liveStored}`)
await page.click('[data-control-id="live-mode"]')
await page.click('[data-control-id="program-1"]')

// 10. Split: ON gates the piano layer to its zone (audible below, silent above).
await page.click('[data-control-id="split-onset"]')
await page.evaluate(() => window.__stagebench.instrument.setZoneRange('pianoA', { from: 0, to: 0 }))
const below = await noteBurstRms(55, 300)
const above = await noteBurstRms(72, 300)
record('split-gates-notes', below.max > 0.002 && above.max < below.max * 0.25, `below=${below.max.toFixed(4)} above=${above.max.toFixed(4)}`)
await page.click('[data-control-id="split-onset"]')
await page.evaluate(() => window.__stagebench.instrument.setZoneRange('pianoA', { from: 0, to: 3 }))

// 11. Scenes: II swaps layer enables, I restores; sound params untouched.
await page.click('[data-control-id="piano-layer-b"]') // scene I: A+B
await page.click('[data-control-id="layer-scene"]') // scene II (fresh enable set)
const sceneII = await state()
await page.click('[data-control-id="layer-scene"]') // back to I
const sceneI = await state()
record('scenes-swap-enables', sceneII.scenes.active === 'II' && sceneI.scenes.active === 'I' && sceneI.layers.B.enabled === true, `II B=${sceneII.layers.B.enabled} I B=${sceneI.layers.B.enabled}`)
await page.click('[data-control-id="piano-layer-b"]') // B off

// 12. Morph: latch Wheel, pull a drawbar as destination, wheel morphs it live.
await page.click('[data-control-id="organ-layer-a"]') // organ on for a morph target
await page.click('[data-control-id="morph-wheel"]')
await page.focus('[data-control-id="organ-drawbar-9"]')
await page.keyboard.press('End')
await page.click('[data-control-id="morph-wheel"]') // unlatch
const morphState = await state()
record('morph-assign', morphState.morphs.wheel.length === 1, `assignments=${JSON.stringify(morphState.morphs.wheel.map((a) => a.path))}`)
const wheelDown = await heldCentroid(60, 500, 1800)
await page.focus('[data-control-id="perf-mod-wheel"]')
await page.keyboard.press('End')
const wheelUp = await heldCentroid(60, 500, 1800)
record('morph-audible', wheelUp.high > wheelDown.high * 1.5, `high-band ${wheelDown.high.toFixed(4)} → ${wheelUp.high.toFixed(4)}`)
await page.focus('[data-control-id="perf-mod-wheel"]')
await page.keyboard.press('Home')
await shiftClick('[data-control-id="morph-wheel"]') // Shift+Wheel clears
const cleared = await state()
record('morph-clear', cleared.morphs.wheel.length === 0, `assignments after clear=${cleared.morphs.wheel.length}`)
await page.click('[data-control-id="organ-layer-a"]') // organ off

// 13. Transpose and Master Clock write canonical state with display feedback.
await page.click('[data-control-id="transpose-onset"]') // transpose ON
await shiftClick('[data-control-id="transpose-onset"]') // Shift+ = set mode (dial = ±6)
await page.focus('[data-control-id="program-dial"]')
for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp')
const transposed = await state()
record('transpose-set', transposed.transpose.on && transposed.transpose.semitones > 0, `on=${transposed.transpose.on} semitones=${transposed.transpose.semitones}`)
await page.evaluate(() => {
  const instrument = window.__stagebench.instrument
  instrument.setTranspose(0)
  if (instrument.getState().programs.transposeSet) instrument.toggleTransposeSet()
  if (instrument.getState().transpose.on) instrument.toggleTranspose()
})
for (let i = 0; i < 4; i++) {
  await page.click('[data-control-id="mstclk-tap"]') // tap tempo ≈ 150 BPM
  await page.waitForTimeout(400)
}
const clockLine = await page.textContent('[data-testid="oled-perf-line"]')
const clockBpm = (await state()).clockBpm
record('master-clock', /♩ ?\d+/.test(clockLine ?? '') && clockBpm > 120 && clockBpm < 180, `display="${clockLine?.trim()}" bpm=${clockBpm}`)

// 14. Panic silences everything.
await page.dispatchEvent('[data-control-id="key-60"]', 'pointerdown', { pointerId: 5 })
await page.waitForTimeout(120)
await page.click('[data-control-id="panic"]')
await page.waitForTimeout(200)
const afterPanic = await page.evaluate(() => window.__rms())
await page.dispatchEvent('[data-control-id="key-60"]', 'pointerup', { pointerId: 5 })
record('panic-silence', afterPanic < 0.004, `rms=${afterPanic.toFixed(4)}`)

// 15. Console must be clean across the whole pass.
record('console-clean', consoleErrors.length === 0, consoleErrors.length ? consoleErrors.slice(0, 3).join(' | ') : 'no console errors')

// 16. Candidate screenshots.
mkdirSync(EVIDENCE, { recursive: true })
await page.setViewportSize({ width: 1440, height: 900 })
await page.waitForTimeout(400)
await page.screenshot({ path: join(EVIDENCE, 'candidate-stage3-desktop.png') })
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(400)
await page.screenshot({ path: join(EVIDENCE, 'candidate-stage3-narrow.png') })

await browser.close()

console.log(`\n${results.filter((r) => r.pass).length}/${results.length} browser checks passed`)
if (failures.length) {
  console.error('FAILURES:\n' + failures.join('\n'))
  process.exit(1)
}
