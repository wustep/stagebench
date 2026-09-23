// Phase 3 browser pass (evidence, not a test gate): serves the production build with `vite
// preview`, drives headless Chrome over the DevTools protocol on a pipe (no extra dependencies),
// exercises programs, Live Mode, splits, scenes, morphs, organ and synth sounds, the arpeggiator
// and Panic through the real panel, and records console/page errors and screenshots.
//   usage: pnpm build && node scripts/browser-pass.mjs [chrome-binary]
// Writes evidence/stage3-browser-pass.json and evidence/stage3-pass-*.png. The canonical
// desktop/narrow captures are produced by the parent capture harness at seal.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const chrome = process.argv[2] ?? 'google-chrome'
const port = 4317
const url = `http://127.0.0.1:${port}/`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const server = spawn(join(root, 'node_modules/.bin/vite'), ['preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore' })
const profile = mkdtempSync(join(tmpdir(), 'stage3-pass-'))
const browser = spawn(
  chrome,
  ['--headless=new', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', '--disable-gpu', `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
)

// ---- minimal CDP client over fds 3/4 (NUL-separated JSON) ----
let nextId = 1
const pending = new Map()
const listeners = []
let buffer = ''
browser.stdio[4].on('data', (chunk) => {
  buffer += chunk.toString('utf8')
  let i
  while ((i = buffer.indexOf('\0')) >= 0) {
    const msg = JSON.parse(buffer.slice(0, i))
    buffer = buffer.slice(i + 1)
    if (msg.id && pending.has(msg.id)) {
      const { resolve: ok, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else ok(msg.result)
    } else listeners.forEach((l) => l(msg))
  }
})
function send(method, params = {}, sessionId) {
  const id = nextId++
  browser.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`)
  return new Promise((ok, reject) => pending.set(id, { resolve: ok, reject }))
}

const consoleMessages = []
const pageErrors = []
const steps = []
listeners.push((msg) => {
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(msg.params.type)) {
    consoleMessages.push({ type: msg.params.type, text: msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ') })
  }
  if (msg.method === 'Runtime.exceptionThrown') pageErrors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text)
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') consoleMessages.push({ type: 'log-error', text: msg.params.entry.text, url: msg.params.entry.url })
})

async function main() {
  await sleep(1500)
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const s = (method, params) => send(method, params, sessionId)
  await s('Page.enable')
  await s('Runtime.enable')
  await s('Log.enable')
  const viewport = async (width, height) => s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 })
  await viewport(1440, 900)
  await s('Page.navigate', { url })
  const evaluate = async (expression) => {
    const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(`${expression.slice(0, 80)}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
    return r.result.value
  }
  const shot = async (name) => {
    const { data } = await s('Page.captureScreenshot', { format: 'png' })
    const file = `evidence/stage3-pass-${name}.png`
    writeFileSync(join(root, file), Buffer.from(data, 'base64'))
    return file
  }
  // In-page helpers: panel clicks, keyboard operation, Shift, and notes via the computer keyboard.
  await sleep(500)
  for (let i = 0; i < 60; i++) {
    const ready = await evaluate(`document.querySelector('[data-testid="voice-status"]')?.textContent`)
    if (ready === 'Ready') break
    await sleep(250)
  }
  await evaluate(`(() => {
    const el = (id) => document.getElementById(id)
    window.__pass = {
      click: (id) => el(id).click(),
      key: (id, key) => el(id).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })),
      shift: (fn) => { const s = el('program-shift'); s.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); fn(); s.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })) },
      down: (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true })),
      up: (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true })),
      text: (id) => el(id).textContent,
      status: () => document.querySelector('[data-testid="program-status"]').textContent,
      audio: () => document.querySelector('[data-testid="audio-status"]').textContent,
      voices: () => document.querySelector('[data-testid="voice-count"]').textContent,
      lit: (id) => el(id).getAttribute('data-lit') === 'true',
    }
  })()`)
  const step = async (name, script, check) => {
    await evaluate(`(() => { const p = window.__pass; ${script} })()`)
    await sleep(350)
    const observed = await evaluate(`(() => { const p = window.__pass; return ${check} })()`)
    steps.push({ step: name, observed })
    return observed
  }
  const metrics = async () =>
    evaluate(`(() => {
      const r = document.querySelector('.instrument').getBoundingClientRect()
      const deck = document.querySelector('.chassis-deck')
      const keys = document.querySelectorAll('[data-note]').length
      return {
        viewport: [innerWidth, innerHeight],
        instrument: [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10),
        widthRatio: Math.round((r.width / innerWidth) * 1000) / 1000,
        aspect: Math.round((r.width / r.height) * 10000) / 10000,
        scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
        keys,
        deckBottomRatio: deck ? Math.round(((deck.getBoundingClientRect().bottom - r.y) / r.height) * 10000) / 10000 : null,
      }
    })()`)
  const layout = { desktop: await metrics() }
  const files = []
  files.push(await shot('desktop-initial'))
  await step('Piano: play C4-E4 from the computer keyboard', `p.down('KeyA'); p.down('KeyD')`, `p.voices() + ' | ' + p.audio()`)
  await sleep(400)
  await step('Release keys', `p.up('KeyA'); p.up('KeyD')`, `p.voices()`)
  await step('Program 1.2 B3 Rock Rotary, play a chord', `p.click('program-slot-2'); p.down('KeyA'); p.down('KeyG')`, `p.status() + ' | ' + p.text('program-oled') + ' | ' + p.voices()`)
  await sleep(600)
  await step('Drawbar 5 out, rotary fast (organ held)', `p.key('organ-drawbar-5', 'End'); p.click('performance-rotary-speed')`, `p.status() + ' | graph lit ' + document.getElementById('organ-drawbar-5-graph').dataset.lit`)
  files.push(await shot('desktop-organ'))
  await step('Release; Store to 1.7', `p.up('KeyA'); p.up('KeyG'); p.click('program-store'); p.click('program-slot-7'); p.click('program-store')`, `p.status()`)
  await step('Live Mode on, edit auto-stores', `p.click('program-live-mode'); p.click('piano-type')`, `p.status() + ' | live LED ' + p.lit('program-led-live-mode')`)
  await step('Live Mode off', `p.click('program-live-mode')`, `p.status()`)
  await step('Split on, edit Mid to C5 with ±6', `p.click('program-split'); p.shift(() => p.click('program-split')); p.key('program-dial', 'ArrowUp'); p.key('program-dial', 'ArrowUp'); p.click('program-page-right'); p.key('program-dial', 'ArrowUp')`, `p.text('program-oled')`)
  await step('Split edit done', `p.click('program-split')`, `p.status()`)
  await step('Layer Scene II', `p.click('program-layer-scene')`, `'scene LED ' + p.lit('program-led-layer-scene') + ' | ' + p.status()`)
  await step('Program 1.6 Super Saw Lead, play', `p.click('program-layer-scene'); p.click('program-slot-6'); p.down('KeyA')`, `p.status() + ' | ' + p.text('synth-oled') + ' | ' + p.voices()`)
  await sleep(500)
  await step('Morph: wheel assign on filter freq, then wheel up', `p.click('program-morph-wheel'); p.key('synth-filter-freq', 'Home'); p.click('program-morph-wheel'); p.key('performance-mod-wheel', 'End')`, `'morph LED ' + p.lit('program-led-morph-wheel') + ' | filter LED ' + p.lit('synth-led-filter-freq')`)
  files.push(await shot('desktop-synth'))
  await step('Release, synth pages: filter/env via OLED dials', `p.up('KeyA'); p.click('synth-filter-type'); p.key('synth-list-1', 'ArrowUp'); p.click('synth-amp-envelope'); p.key('synth-info', 'ArrowUp')`, `p.text('synth-oled')`)
  await step('Program 2.1 Arp Pluck 110: hold a chord (arpeggiator runs on the clock)', `p.click('program-page-right'); p.click('program-slot-1'); p.down('KeyA'); p.down('KeyD'); p.down('KeyG')`, `p.status() + ' | ' + p.voices()`)
  await sleep(1500)
  for (let i = 0; i < 3; i++) {
    await evaluate(`window.__pass.click('program-master-clock')`)
    await sleep(400)
  }
  await step('Master Clock: fourth tap (400 ms apart → 150 BPM)', `p.click('program-master-clock')`, `p.text('program-oled')`)
  await step('Panic (Shift+Transpose) while holding', `p.shift(() => p.click('program-transpose'))`, `p.text('program-oled')`)
  await sleep(400)
  await step('Release keys after Panic', `p.up('KeyA'); p.up('KeyD'); p.up('KeyG')`, `p.voices()`)
  await step('Vox, Farf and Pipe organ programs', `p.click('program-page-left'); p.click('program-slot-3'); p.down('KeyA'); p.up('KeyA'); p.click('program-slot-4'); p.down('KeyA'); p.up('KeyA'); p.click('program-slot-5'); p.down('KeyA'); p.up('KeyA')`, `p.status()`)
  await viewport(390, 844)
  await sleep(500)
  layout.narrow = await metrics()
  files.push(await shot('narrow'))
  const report = {
    version: 1,
    phase: 3,
    url,
    capturedAt: new Date().toISOString(),
    browser: (await send('Browser.getVersion')).product,
    note: 'Browser pass driven over the Chrome DevTools protocol by scripts/browser-pass.mjs; canonical captures come from the parent capture harness at seal.',
    layout,
    steps,
    screenshots: files,
    consoleMessages,
    pageErrors,
  }
  writeFileSync(join(root, 'evidence/stage3-browser-pass.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(`steps ${steps.length}, console ${consoleMessages.length}, page errors ${pageErrors.length}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      await send('Browser.close')
    } catch {
      // already gone
    }
    browser.kill()
    server.kill()
    await sleep(300)
    rmSync(profile, { recursive: true, force: true })
  })
