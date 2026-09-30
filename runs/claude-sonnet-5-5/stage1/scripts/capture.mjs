// Local capture harness: serves nothing itself. Point it at a running `vite preview` and a Chromium binary.
//   node scripts/capture.mjs <chrome-binary> [url] [outDir]
// Writes stage1-desktop.png, stage1-narrow.png and stage1-capture.json (measured bounds, ratios, counts, console errors).
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [chrome, url = 'http://localhost:4173/', outDir = '.'] = process.argv.slice(2)
if (!chrome) {
  console.error('usage: node scripts/capture.mjs <chrome-binary> [url] [outDir]')
  process.exit(2)
}
mkdirSync(outDir, { recursive: true })
const port = 9300 + Math.floor(Math.random() * 500)
const profile = resolve(outDir, '.capture-profile')
const proc = spawn(chrome, ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' })

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
  writeFileSync(resolve(outDir, `stage1-${name}.png`), Buffer.from(shot.result.data, 'base64'))
  return measured
}

const desktop = await capture('desktop', 1440, 900, false)
const narrow = await capture('narrow', 390, 844, true)

// exercise the keybed once for the console-error pass
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url })
await sleep(800)
const interaction = await evaluate(`(async () => {
  const key = document.querySelector('[data-note="60"]')
  const b = key.getBoundingClientRect()
  const opts = { bubbles: true, clientX: b.x + b.width / 2, clientY: b.y + b.height * 0.7, pointerId: 7, pointerType: 'mouse', button: 0 }
  key.dispatchEvent(new PointerEvent('pointerdown', opts))
  await new Promise((r) => setTimeout(r, 300))
  const during = { pressed: key.dataset.pressed, audio: document.querySelector('[data-testid="audio-status"]').dataset.phase }
  window.dispatchEvent(new PointerEvent('pointerup', opts))
  await new Promise((r) => setTimeout(r, 900))
  const knob = document.querySelector('[data-control-id="synth-glide"]')
  const before = knob.getAttribute('aria-valuenow')
  knob.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
  await new Promise((r) => setTimeout(r, 100))
  return { during, after: { pressed: key.dataset.pressed, voices: document.querySelector('[data-testid="voice-status"]').textContent }, knob: { before, after: knob.getAttribute('aria-valuenow') } }
})()`)

const report = { generatedAt: new Date().toISOString(), url, desktop, narrow, interaction, consoleErrors }
writeFileSync(resolve(outDir, 'stage1-capture.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ desktopFraction: desktop.instrument.widthFractionOfViewport, narrowFraction: narrow.instrument.widthFractionOfViewport, consoleErrors, unreachable: desktop.unreachableControls.length }, null, 2))
ws.close()
proc.kill()
