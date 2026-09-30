// Local Phase 2 capture + browser pass: serves nothing itself. Point it at a running `vite preview` and a Chromium binary.
//   node scripts/capture2.mjs <chrome-binary> [url] [outDir]
// Writes stage2-desktop.png, stage2-narrow.png and stage2-capture.json (measured bounds, ratios, counts, console errors,
// and a real-browser interaction pass: sample loading, real audio output level through an analyser tap, panel controls).
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [chrome, url = 'http://localhost:4173/', outDir = '.'] = process.argv.slice(2)
if (!chrome) {
  console.error('usage: node scripts/capture2.mjs <chrome-binary> [url] [outDir]')
  process.exit(2)
}
mkdirSync(outDir, { recursive: true })
const port = 9300 + Math.floor(Math.random() * 500)
const profile = resolve(outDir, '.capture-profile')
const proc = spawn(chrome, ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', '--headless=new', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitForTarget() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      const page = list.find((t) => t.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch {
      // not up yet
    }
    await sleep(100)
  }
  throw new Error('chrome did not start')
}

const ws = new WebSocket(await waitForTarget())
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let nextId = 1
const pending = new Map()
const consoleErrors = []
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  } else if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(msg.params.exceptionDetails.text + ' ' + (msg.params.exceptionDetails.exception?.description ?? ''))
  } else if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'assert')) {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '))
  } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    consoleErrors.push(msg.params.entry.text)
  }
})
const sampleRequests = []
const consoleWarnings = []
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.method === 'Network.responseReceived' && msg.params.response.url.includes('/samples/')) sampleRequests.push({ url: msg.params.response.url.split('/samples/')[1], status: msg.params.response.status })
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'warning') consoleWarnings.push(msg.params.args.map((a) => a.value ?? a.description).join(' '))
})
const send = (method, params = {}) =>
  new Promise((resolveMsg) => {
    const id = nextId++
    pending.set(id, resolveMsg)
    ws.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (res.result.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails))
  return res.result.result.value
}

await send('Runtime.enable')
await send('Log.enable')
await send('Page.enable')
await send('Network.enable')
// tap everything that reaches the destination so the pass can measure REAL audio output in the browser
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const orig = AudioNode.prototype.connect; window.__taps = []; AudioNode.prototype.connect = function (dest, ...rest) { if (dest instanceof AudioDestinationNode && !this.__tapped) { this.__tapped = true; const an = this.context.createAnalyser(); an.fftSize = 2048; orig.call(this, an); window.__taps.push(an) } return orig.call(this, dest, ...rest) } })()` })

const MEASURE = `(() => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height } }
  const inst = document.querySelector('[data-testid="instrument"]')
  const ib = r(inst)
  const deck = r(document.querySelector('[data-testid="deck"]'))
  const keyzone = r(document.querySelector('[data-testid="keybed-zone"]'))
  const sections = [...document.querySelectorAll('section[data-section]')].map((s) => ({ id: s.dataset.section, ...r(s), fractionOfInstrument: r(s).width / ib.width }))
  const whites = document.querySelectorAll('[data-key="white"]').length
  const blacks = document.querySelectorAll('[data-key="black"]').length
  const oleds = [...document.querySelectorAll('[data-oled]')].map((o) => ({ id: o.id, section: o.closest('[data-section]').dataset.section, ...r(o) }))
  const controls = [...document.querySelectorAll('[data-control-id]')]
  const bySection = {}
  for (const c of controls) { const s = c.closest('[data-section]').dataset.section; bySection[s] = (bySection[s] || 0) + 1 }
  // reachability: the element at the centre of every control is that control (or one of its parts)
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
    fontFloor: Math.min(...[...document.querySelectorAll('.legend, .led-text, .frame-title')].map((e) => parseFloat(getComputedStyle(e).fontSize)))
  }
})()`

async function capture(name, width, height, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile })
  await send('Page.navigate', { url })
  await sleep(1200)
  const measured = await evaluate(MEASURE)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(resolve(outDir, `stage2-${name}.png`), Buffer.from(shot.result.data, 'base64'))
  return measured
}

const desktop = await capture('desktop', 1440, 900, false)
const narrow = await capture('narrow', 390, 844, true)

// --- Phase 2 browser pass: real samples, real audio, panel controls ---------------------------------------------------
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url })
await sleep(800)
const pass = await evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const $ = (s) => document.querySelector(s)
  const ctl = (id) => document.querySelector('[data-control-id="' + id + '"]')
  const level = () => { const an = window.__taps[0]; if (!an) return 0; const d = new Float32Array(an.fftSize); an.getFloatTimeDomainData(d); let s = 0; for (const v of d) s += v * v; return Math.sqrt(s / d.length) }
  const peakLevel = async (ms) => { let p = 0; const end = performance.now() + ms; while (performance.now() < end) { p = Math.max(p, level()); await wait(20) } return p }
  const status = () => $('[data-testid="audio-status"]').dataset.phase + ': ' + $('[data-testid="audio-status"]').textContent
  const key = $('[data-note="60"]')
  const b = key.getBoundingClientRect()
  const opts = (id) => ({ bubbles: true, clientX: b.x + b.width / 2, clientY: b.y + b.height * 0.7, pointerId: id, pointerType: 'mouse', button: 0 })
  const press = (el, id = 1, extra = {}) => { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: id, button: 0, ...extra })); el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: id, button: 0 })) }
  const out = {}
  out.before = status()
  key.dispatchEvent(new PointerEvent('pointerdown', opts(7)))
  out.duringLoad = status()
  out.loadingLevel = await peakLevel(400) // the labelled stand-in voice is audible while the recordings decode
  for (let i = 0; i < 100 && !$('[data-testid="audio-status"]').dataset.phase.match(/ready|fallback|error/); i++) await wait(100)
  out.afterLoad = status()
  window.dispatchEvent(new PointerEvent('pointerup', opts(7)))
  await wait(900)
  // a recorded Grand note, measured at the destination
  key.dispatchEvent(new PointerEvent('pointerdown', opts(8)))
  out.grandLevel = await peakLevel(500)
  window.dispatchEvent(new PointerEvent('pointerup', opts(8)))
  await wait(900)
  out.silenceLevel = await peakLevel(200)
  // panel: Upright, Electric, Clav
  const typeLevel = {}
  for (const name of ['Upright', 'Electric', 'Clav']) {
    press(ctl('piano-select'))
    await wait(60)
    for (let i = 0; i < 100 && !$('[data-testid="audio-status"]').dataset.phase.match(/ready|fallback|error/); i++) await wait(100)
    key.dispatchEvent(new PointerEvent('pointerdown', opts(9)))
    typeLevel[name] = { label: ctl('piano-select').getAttribute('aria-label'), status: status(), peak: await peakLevel(500), oled: $('#program-oled').textContent }
    window.dispatchEvent(new PointerEvent('pointerup', opts(9)))
    await wait(800)
  }
  out.typeLevel = typeLevel
  // effects: reverb on with a long tail must keep sounding after the key is released
  press(ctl('piano-select')); press(ctl('piano-select')); press(ctl('piano-select')) // back to Grand
  await wait(300)
  press(ctl('fx-reverb-on'))
  ctl('fx-reverb-dry-wet').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
  press(ctl('fx-reverb-type'))
  key.dispatchEvent(new PointerEvent('pointerdown', opts(10)))
  await wait(300)
  window.dispatchEvent(new PointerEvent('pointerup', opts(10)))
  await wait(700)
  out.reverbTailAfterRelease = await peakLevel(300)
  press(ctl('fx-reverb-on'))
  await wait(1500)
  out.tailAfterReverbOff = await peakLevel(300)
  // layers: add layer B with shift, both sound; voices count 2
  press(ctl('piano-layer-b-onoff'), 3, { shiftKey: true })
  key.dispatchEvent(new PointerEvent('pointerdown', opts(11)))
  await wait(400)
  out.twoLayerVoices = $('[data-testid="voice-status"]').textContent
  out.twoLayerOled = $('#program-oled').textContent
  window.dispatchEvent(new PointerEvent('pointerup', opts(11)))
  // master level to zero silences everything, even while a key is held
  key.dispatchEvent(new PointerEvent('pointerdown', opts(12)))
  await wait(300)
  ctl('master-level').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
  await wait(200)
  out.masterZeroLevel = await peakLevel(300)
  ctl('master-level').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
  window.dispatchEvent(new PointerEvent('pointerup', opts(12)))
  await wait(400)
  out.contexts = window.__taps.length
  out.finalStatus = status()
  return out
})()`)
// a fresh page load with the sample files blocked: the labelled fallback in a real browser
await send('Network.setBlockedURLs', { urls: ['*/samples/grand-salamander/*'] })
await send('Page.navigate', { url })
await sleep(700)
const blocked = await evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const key = document.querySelector('[data-note="60"]')
  const b = key.getBoundingClientRect()
  const o = { bubbles: true, clientX: b.x + b.width / 2, clientY: b.y + b.height * 0.7, pointerId: 21, pointerType: 'mouse', button: 0 }
  key.dispatchEvent(new PointerEvent('pointerdown', o))
  await wait(2500)
  const an = window.__taps[0]; const d = new Float32Array(an.fftSize); an.getFloatTimeDomainData(d); let s = 0; for (const v of d) s += v * v
  const r = { status: document.querySelector('[data-testid="audio-status"]').dataset.phase + ': ' + document.querySelector('[data-testid="audio-status"]').textContent, oled: document.querySelector('#program-oled').textContent, typeLedBlinking: !!document.querySelector('[data-control-id="piano-select"]').dataset.focused, rms: Math.sqrt(s / d.length) }
  window.dispatchEvent(new PointerEvent('pointerup', o))
  return r
})()`)
await send('Network.setBlockedURLs', { urls: [] })
const interaction = { ...pass, blockedSamples: blocked }

const report = { generatedAt: new Date().toISOString(), url, browser: 'Chrome for Testing (headless)', desktop, narrow, interaction, sampleRequests: { total: sampleRequests.length, notOk: sampleRequests.filter((r) => r.status !== 200 && r.status !== 304 && !r.url.startsWith('grand-salamander')).length, blockedByTest: sampleRequests.filter((r) => r.url.startsWith('grand-salamander') && r.status !== 200).length, files: sampleRequests.length }, consoleErrors: consoleErrors.filter((e) => !/Failed to load resource|ERR_BLOCKED/.test(e)), consoleWarnings, blockedResourceErrors: consoleErrors.filter((e) => /Failed to load resource|ERR_BLOCKED/.test(e)).length }
writeFileSync(resolve(outDir, 'stage2-capture.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ interaction, desktopFraction: desktop.instrument.widthFractionOfViewport, narrowFraction: narrow.instrument.widthFractionOfViewport, consoleErrors, unreachable: desktop.unreachableControls.length }, null, 2))
ws.close()
proc.kill()
