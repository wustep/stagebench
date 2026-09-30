// Minimal Chrome DevTools Protocol driver shared by the capture scripts (no dependencies beyond node and a Chrome binary).
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function launch(chrome, outDir, { audio = true } = {}) {
  mkdirSync(outDir, { recursive: true })
  const port = 9300 + Math.floor(Math.random() * 500)
  const profile = resolve(outDir, '.capture-profile')
  rmSync(profile, { recursive: true, force: true }) // every pass starts from a clean profile (no stored programs)
  const proc = spawn(chrome, ['--no-sandbox', '--disable-gpu', ...(process.env.CDP_EXTRA ? process.env.CDP_EXTRA.split(' ') : []), '--hide-scrollbars', ...(audio ? ['--autoplay-policy=no-user-gesture-required'] : []), '--headless=new', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' })
  let wsUrl = null
  for (let i = 0; i < 100 && !wsUrl; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null
    } catch {
      // not up yet
    }
    if (!wsUrl) await sleep(100)
  }
  if (!wsUrl) throw new Error('chrome did not start')
  const ws = new WebSocket(wsUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  let nextId = 1
  const pending = new Map()
  const consoleErrors = []
  const consoleWarnings = []
  const requests = []
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    } else if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(msg.params.exceptionDetails.text + ' ' + (msg.params.exceptionDetails.exception?.description ?? ''))
    else if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'assert')) consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '))
    else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'warning') consoleWarnings.push(msg.params.args.map((a) => a.value ?? a.description).join(' '))
    else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') consoleErrors.push(msg.params.entry.text)
    else if (msg.method === 'Network.responseReceived') requests.push({ url: msg.params.response.url, status: msg.params.response.status })
  })
  const send = (method, params = {}) =>
    new Promise((res) => {
      const id = nextId++
      pending.set(id, res)
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
  // tap what reaches the destination so a pass can measure REAL audio output in the browser
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => { const orig = AudioNode.prototype.connect; window.__taps = []; window.__contexts = new Set(); AudioNode.prototype.connect = function (dest, ...rest) { window.__contexts.add(this.context); if (dest instanceof AudioDestinationNode && !this.__tapped) { this.__tapped = true; const an = this.context.createAnalyser(); an.fftSize = 4096; orig.call(this, an); window.__taps.push(an) } return orig.call(this, dest, ...rest) } })()`,
  })
  // pages opened from file:// cannot use fetch(); route it through XMLHttpRequest, which --allow-file-access-from-files permits
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => { if (location.protocol !== 'file:') return; const real = window.fetch.bind(window); window.fetch = (input, init) => { const url = String(input instanceof URL ? input.href : input.url ?? input); if (!url.startsWith('file:')) return real(input, init); return new Promise((resolve, reject) => { const x = new XMLHttpRequest(); x.open('GET', url); x.responseType = 'arraybuffer'; x.onload = () => resolve(new Response(x.response, { status: x.status === 0 ? 200 : x.status })); x.onerror = () => resolve(new Response(null, { status: 404 })); x.send() }) } })()`,
  })
  const shot = async (file, { width, height, mobile = false, clip } = {}) => {
    if (width) await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile })
    const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(file, Buffer.from(r.result.data, 'base64'))
  }
  return { send, evaluate, shot, consoleErrors, consoleWarnings, requests, close: () => { ws.close(); proc.kill() } }
}
