// Phase 3 capture + real-browser pass.
//   node scripts/capture3.mjs <chrome-binary> [pageUrl] [outDir]
// The page is opened from dist/index.html over file:// (with --allow-file-access-from-files; fetch() is routed through XHR by
// scripts/cdp-lib.mjs) so that no local server is needed. Writes stage3-desktop.png, stage3-narrow.png, detail crops and
// stage3-capture.json: measured bounds, a browser pass through programs, Live Mode, splits, scenes, morphs, organ and synth
// sounds and Panic with REAL audio measured at the destination through an analyser tap, and console errors.
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { launch, sleep } from './cdp-lib.mjs'

const [chrome, pageUrl = pathToFileURL(resolve('dist/index.html')).href, outDir = 'evidence'] = process.argv.slice(2)
if (!chrome) {
  console.error('usage: node scripts/capture3.mjs <chrome-binary> [pageUrl] [outDir]')
  process.exit(2)
}
process.env.CDP_EXTRA ??= '--allow-file-access-from-files'
const b = await launch(chrome, outDir)
const { send, evaluate } = b

const MEASURE = `(() => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height } }
  const inst = document.querySelector('[data-testid="instrument"]')
  const ib = r(inst)
  const deck = r(document.querySelector('[data-testid="deck"]'))
  const keyzone = r(document.querySelector('[data-testid="keybed-zone"]'))
  const sections = [...document.querySelectorAll('section[data-section]')].map((s) => ({ id: s.dataset.section, ...r(s), fractionOfInstrument: r(s).width / ib.width }))
  const whites = document.querySelectorAll('[data-key="white"]').length
  const blacks = document.querySelectorAll('[data-key="black"]').length
  const oleds = [...document.querySelectorAll('[data-oled]')].map((o) => ({ id: o.id, section: o.closest('[data-section]').dataset.section, ...r(o), clipped: o.scrollHeight > o.clientHeight + 1 }))
  const controls = [...document.querySelectorAll('[data-control-id]')]
  const bySection = {}
  for (const c of controls) { const s = c.closest('[data-section]').dataset.section; bySection[s] = (bySection[s] || 0) + 1 }
  let unreachable = []
  for (const c of controls) {
    const b = c.getBoundingClientRect()
    const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)
    if (!hit || !(c === hit || c.contains(hit))) unreachable.push(c.dataset.controlId)
  }
  const de = document.documentElement
  return {
    viewport: { width: innerWidth, height: innerHeight },
    scroll: { scrollWidth: de.scrollWidth, scrollHeight: de.scrollHeight, horizontalOverflow: de.scrollWidth > innerWidth, verticalOverflow: de.scrollHeight > innerHeight },
    instrument: { ...ib, widthFractionOfViewport: ib.width / innerWidth, aspectRatio: ib.width / ib.height, insideViewport: ib.x >= 0 && ib.x + ib.width <= innerWidth && ib.y >= 0 && ib.y + ib.height <= innerHeight },
    deckHeightFraction: deck.height / ib.height,
    keybedHeightFraction: keyzone.height / ib.height,
    sections,
    keys: { total: whites + blacks, white: whites, black: blacks },
    oleds,
    controlCount: controls.length,
    controlsBySection: bySection,
    unreachableControls: unreachable,
    splitLeds: document.querySelectorAll('[data-split-position]').length,
    fontFloor: Math.min(...[...document.querySelectorAll('.legend, .led-text, .frame-title')].map((e) => parseFloat(getComputedStyle(e).fontSize)))
  }
})()`

async function capture(name, width, height, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile })
  await send('Page.navigate', { url: pageUrl })
  await sleep(1500)
  const measured = await evaluate(MEASURE)
  await b.shot(resolve(outDir, `stage3-${name}.png`))
  return measured
}

await send('Network.enable')
const desktop = await capture('desktop', 1440, 900, false)
const narrow = await capture('narrow', 390, 844, true)

// --- browser pass ------------------------------------------------------------------------------------------------------
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: pageUrl })
await sleep(1000)

const PASS_HELPERS = `
  window.__h = (() => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const $ = (s) => document.querySelector(s)
    const ctl = (id) => document.querySelector('[data-control-id="' + id + '"]')
    const level = () => { let s = 0, n = 0; for (const an of window.__taps) { const d = new Float32Array(an.fftSize); an.getFloatTimeDomainData(d); for (const v of d) s += v * v; n += d.length } return n ? Math.sqrt(s / n) : 0 }
    const peakLevel = async (ms) => { let p = 0; const end = performance.now() + ms; while (performance.now() < end) { p = Math.max(p, level()); await wait(15) } return p }
    const centroid = () => { const an = window.__taps[0]; if (!an) return 0; const f = new Float32Array(an.frequencyBinCount); an.getFloatFrequencyData(f); let num = 0, den = 0; for (let i = 1; i < f.length; i++) { const m = Math.pow(10, f[i] / 20); num += m * i * (an.context.sampleRate / an.fftSize); den += m } return den ? num / den : 0 }
    const opt = (el, id, y = 0.7) => { const b = el.getBoundingClientRect(); return { bubbles: true, clientX: b.x + b.width / 2, clientY: b.y + b.height * y, pointerId: id, pointerType: 'mouse', button: 0 } }
    const press = (el, id = 1, extra = {}) => { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: id, button: 0, ...extra })); el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: id, button: 0 })) }
    const holdBtn = async (el, ms, id = 1) => { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: id, button: 0 })); await wait(ms); el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: id, button: 0 })) }
    const keyDown = (note, id) => { const k = $('[data-note="' + note + '"]'); k.dispatchEvent(new PointerEvent('pointerdown', opt(k, id))) }
    const keyUp = (note, id) => { const k = $('[data-note="' + note + '"]'); window.dispatchEvent(new PointerEvent('pointerup', opt(k, id))) }
    const oled = () => $('#program-oled').textContent
    const synthOled = () => $('#synth-oled').textContent
    const key = (id, k) => ctl(id).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
    const voices = () => $('[data-testid="voice-status"]').textContent
    const status = () => $('[data-testid="audio-status"]').dataset.phase + ': ' + $('[data-testid="audio-status"]').textContent
    const currentPage = () => { const d = ctl('program-button-1').getAttribute('aria-description'); const m = /(\\d)\\.\\d/.exec(d || ''); if (!m) throw new Error('no page in: ' + d); return Number(m[1]) - 1 }
    const selectProgram = async (index) => {
      await wait(60) // let React commit the last change before reading the buttons
      const target = Math.floor(index / 8)
      for (let i = 0; i < 5 && currentPage() !== target; i++) { press(ctl('program-page-next'), 50 + i); await wait(40) }
      press(ctl('program-button-' + ((index % 8) + 1)), 60)
      await wait(60)
    }
    const findProgram = async (name) => { for (let i = 0; i < 32; i++) { await selectProgram(i); if (oled().startsWith(Math.floor(i / 8) + 1 + '.' + ((i % 8) + 1) + ' ' + name)) return i } return -1 }
    const silence = async () => { press(ctl('program-transpose'), 90, { shiftKey: true }); await wait(400) }
    const waitReady = async () => { for (let i = 0; i < 120 && !/ready|fallback|error/.test($('[data-testid="audio-status"]').dataset.phase); i++) await wait(100) }
    return { wait, $, ctl, level, peakLevel, centroid, opt, press, holdBtn, keyDown, keyUp, oled, synthOled, key, voices, status, selectProgram, findProgram, silence, waitReady }
  })()
`
await evaluate(PASS_HELPERS)

const pass = await evaluate(`(async () => {
  const H = window.__h
  const { wait, ctl, press, peakLevel, keyDown, keyUp, oled, synthOled, key, status } = H
  const out = {}
  const note = async (n, ms = 600, id = 5) => { keyDown(n, id); await wait(150); const p = await peakLevel(ms); keyUp(n, id); await wait(700); return p }
  const sound = async (n, ms = 600) => { keyDown(n, 5); await wait(200); const p = await peakLevel(ms); const c = H.centroid(); keyUp(n, 5); await wait(800); return { peak: p, centroid: Math.round(c) } }

  out.first = { oled: oled().slice(0, 60), status: status() }
  // piano
  keyDown(60, 3); await H.waitReady(); await wait(200); out.pianoLevel = await peakLevel(400); keyUp(60, 3); await wait(900)
  out.pianoStatus = status()

  // programs: browse with the dial and the buttons, E indicator, discard
  press(ctl('program-page-next'), 7); press(ctl('program-button-2'), 7)
  await wait(80) // React commits asynchronously
  out.program2_2 = oled().slice(0, 40)
  key('fx-reverb-dry-wet', 'End')
  await wait(80)
  out.editedIndicator = !!document.querySelector('[data-testid="edited-indicator"]')
  press(ctl('program-button-3'), 8)
  await wait(80)
  out.editedAfterChange = !!document.querySelector('[data-testid="edited-indicator"]')

  // organ programs
  const jam = await H.findProgram('B3 Drawbar Jam'); out.b3Program = jam
  out.b3 = await sound(60)
  key('organ-drawbar-1', 'Home'); key('organ-drawbar-3', 'Home')
  out.b3AfterDrawbarsOut = await sound(60)
  const vox = await H.findProgram('Vox Continental'); out.voxProgram = vox
  out.vox = await sound(60)
  const farf = await H.findProgram('Farfisa Fun'); out.farf = await sound(60)
  const pipe = await H.findProgram('Pipe Cathedral'); out.pipe = await sound(60)

  // synth programs
  await H.findProgram('Saw Lead'); out.saw = await sound(60)
  key('synth-filter-frequency', 'Home'); out.sawClosed = await sound(60)
  await H.findProgram('Super Pad'); out.superPad = await sound(60, 900)
  await H.findProgram('FM Bells'); out.fm = await sound(72)
  out.synthOled = synthOled().slice(0, 80)

  // arpeggiator: hold a chord, the arpeggio keeps stepping after the keys go up (KB Hold)
  await H.findProgram('Arp Pulse')
  keyDown(60, 11); keyDown(64, 12); keyDown(67, 13); await wait(400)
  keyUp(60, 11); keyUp(64, 12); keyUp(67, 13)
  await wait(500)
  out.arpAfterRelease = await peakLevel(500)
  await H.silence()
  out.arpAfterPanic = await peakLevel(300)

  // split: Bass and Piano; low key and high key
  await H.findProgram('Bass and Piano')
  out.splitLow = await sound(43)
  out.splitHigh = await sound(76)
  out.splitLeds = [...document.querySelectorAll('[data-split-position][data-lit="true"]')].map((e) => e.dataset.splitPosition)
  // change the split point from the panel (hold SPLIT, press a key)
  await H.holdBtn(ctl('program-split'), 700, 20)
  out.splitEditOled = oled().slice(0, 50)
  keyDown(65, 21); keyUp(65, 21)
  await wait(100)
  out.splitLedsAfterSetKey = [...document.querySelectorAll('[data-split-position][data-lit="true"]')].map((e) => e.dataset.splitPosition)
  press(ctl('program-split'), 22)

  // scenes
  await H.findProgram('Scenes Piano Organ')
  out.sceneI = await sound(60)
  press(ctl('program-layer-scene'), 23)
  out.sceneII = await sound(60)
  out.sceneIIOled = oled().slice(0, 100)
  press(ctl('program-layer-scene'), 24)

  // morphs: Morph Swell — the wheel raises the organ level and pulls a drawbar, the pedal opens the synth filter
  await H.findProgram('Morph Swell')
  keyDown(60, 30); await wait(300); out.morphWheel0 = await peakLevel(300)
  key('mod-wheel', 'End'); await wait(300); out.morphWheel1 = await peakLevel(300)
  keyUp(60, 30); await wait(500)
  out.morphLeds = document.querySelectorAll('.morph-led.is-lit').length
  document.querySelector('[data-testid="control-pedal"]')

  // Live Mode
  press(ctl('program-live-mode'), 31)
  press(ctl('program-button-2'), 31)
  key('fx-reverb-dry-wet', 'End')
  await wait(80)
  out.liveOled = oled().slice(0, 40)
  out.liveDirty = !!document.querySelector('[data-testid="edited-indicator"]')

  // master clock / transpose
  for (let i = 0; i < 4; i++) { press(ctl('program-master-clock-tap'), 33); await wait(400) }
  out.clockOled = oled()
  press(ctl('program-live-mode'), 34)

  // Panic with a held chord and the sustain pedal
  await H.findProgram('Super Pad')
  keyDown(60, 40); keyDown(64, 41)
  ctl('program-transpose').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 42, button: 0, shiftKey: true }))
  ctl('program-transpose').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 42, button: 0 }))
  await wait(700)
  out.panicLevel = await peakLevel(300)
  out.panicVoices = H.voices()
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 40 }))
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 41 }))

  out.contexts = window.__contexts.size
  out.finalStatus = status()
  return out
})()`)

// zoom crops for the visual audit
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false })
await evaluate(`(async () => { const H = window.__h; await H.findProgram('B3 Drawbar Jam'); })()`)
const rect = async (sel) => evaluate(`(() => { const b = document.querySelector('${sel}').getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height } })()`)
const organ = await rect('section[data-section="organ"]')
await b.shot(resolve(outDir, 'stage3-organ-zoom.png'), { clip: { x: organ.x - 4, y: organ.y - 4, width: organ.width + 8, height: organ.height + 8 } })
await evaluate(`(async () => { const H = window.__h; await H.findProgram('Four Zones'); H.press(H.ctl('program-morph-wheel'), 71); })()`)
const program = await rect('section[data-section="program"]')
const synthRect = await rect('section[data-section="synth"]')
await b.shot(resolve(outDir, 'stage3-program-zoom.png'), { clip: { x: program.x - 4, y: program.y - 4, width: program.width + 8, height: program.height + 8 } })
await evaluate(`(async () => { const H = window.__h; await H.findProgram('Saw Lead'); H.press(H.ctl('synth-filter-envelope'), 72) })()`)
await b.shot(resolve(outDir, 'stage3-synth-zoom.png'), { clip: { x: synthRect.x - 4, y: synthRect.y - 4, width: synthRect.width + 8, height: synthRect.height + 8 } })
await evaluate(`(async () => { const H = window.__h; await H.findProgram('Four Zones'); await H.wait(100) })()`)
const deck = await rect('[data-testid="deck"]')
const inst = await rect('[data-testid="instrument"]')
await b.shot(resolve(outDir, 'stage3-split-leds.png'), { clip: { x: inst.x, y: deck.y + deck.height - 26, width: inst.width, height: 70 } })

const report = { generatedAt: new Date().toISOString(), url: pageUrl, browser: 'Chrome for Testing (headless), page opened from dist over file://', desktop, narrow, interaction: pass, consoleErrors: b.consoleErrors, consoleWarnings: b.consoleWarnings, sampleRequests: { total: b.requests.filter((r) => r.url.includes('/samples/')).length } }
writeFileSync(resolve(outDir, 'stage3-capture.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ interaction: pass, consoleErrors: b.consoleErrors, unreachable: desktop.unreachableControls, oleds: desktop.oleds }, null, 2))
b.close()
process.exit(0)
