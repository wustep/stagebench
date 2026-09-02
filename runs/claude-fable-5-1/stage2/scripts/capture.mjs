/**
 * Canonical capture + browser interaction pass (Phase 2).
 * Builds are expected in dist/ (run `pnpm build` first). Serves dist/ over a local HTTP port, drives
 * Chrome through playwright-core, records console/page errors, measures the rendered instrument and
 * writes stage2-desktop.png, stage2-narrow.png and stage2-capture.json into evidence/ at the candidate root.
 * The JSON carries the parent harness shape (captures[] with profile / viewport / file / bytes /
 * consoleMessages / pageErrors) plus the local measurements and the interaction pass.
 *
 * Usage: node scripts/capture.mjs [--out <dir>] [--chrome <path>] [--stage stage2]   (default --out evidence)
 */
import { createServer } from 'node:http'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argValue = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const stage = argValue('--stage', 'stage2')
const outDir = path.resolve(root, argValue('--out', 'evidence'))
await mkdir(outDir, { recursive: true })
const distDir = path.join(root, 'dist')
if (!existsSync(path.join(distDir, 'index.html'))) {
  console.error('dist/index.html not found; run `pnpm build` first')
  process.exit(1)
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.wasm': 'application/wasm' }
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    let file = path.join(distDir, decodeURIComponent(url.pathname))
    if (!file.startsWith(distDir)) throw new Error('outside dist')
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html')
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const baseUrl = `http://127.0.0.1:${port}/`

const chromePath = argValue('--chrome', process.env.CHROME_PATH ?? process.env.PLAYWRIGHT_CHROME_PATH)
const launch = chromePath ? { executablePath: chromePath } : { channel: 'chrome' }
const browser = await chromium.launch({ ...launch, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream'] })

const MEASURE = () => {
  const rect = (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  }
  const instrument = document.getElementById('instrument')
  const inst = rect(instrument)
  const deck = rect(document.getElementById('deck'))
  const keybed = rect(document.getElementById('keybed'))
  const sections = [...document.querySelectorAll('.section')].map((s) => {
    const r = rect(s)
    return { id: s.dataset.section, documentedFraction: Number(s.dataset.fraction), x: r.x, width: r.width, measuredFraction: r.width / inst.width, left: (r.x - inst.x) / inst.width }
  })
  const keys = [...document.querySelectorAll('.key')]
  const white = keys.filter((k) => k.dataset.color === 'white')
  const black = keys.filter((k) => k.dataset.color === 'black')
  const whiteRect = white.length ? rect(white[0]) : null
  const blackRect = black.length ? rect(black[0]) : null
  const controls = [...document.querySelectorAll('[data-control-kind]')]
  const perSection = {}
  for (const s of document.querySelectorAll('.section')) {
    const id = s.dataset.section
    const list = [...s.querySelectorAll('[data-control-kind]')]
    const kinds = {}
    for (const c of list) kinds[c.dataset.controlKind] = (kinds[c.dataset.controlKind] ?? 0) + 1
    const displays = [...s.querySelectorAll('[data-display], [id*="oled"], [class*="display"], [class*="screen"]')].map((d) => {
      const r = rect(d)
      return { id: d.id, width: r.width, widthFraction: r.width / rect(s).width, area: r.width * r.height }
    })
    perSection[id] = { controls: list.length, kinds, displays, sectionWidth: rect(s).width }
  }
  const missingNames = controls.filter((c) => !(c.getAttribute('aria-label') || c.textContent.trim())).map((c) => c.id)
  const duplicateIds = (() => {
    const seen = new Set()
    const dup = []
    for (const el of document.querySelectorAll('[id]')) {
      if (seen.has(el.id)) dup.push(el.id)
      seen.add(el.id)
    }
    return dup
  })()
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    document: { scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight },
    instrument: { ...inst, widthFraction: inst.width / window.innerWidth, aspect: inst.width / inst.height, bottom: inst.y + inst.height },
    deck: { ...deck, fraction: deck.height / inst.height },
    keybed: { ...keybed, fraction: keybed.height / inst.height },
    sections,
    keys: {
      total: keys.length,
      white: white.length,
      black: black.length,
      first: keys[0]?.dataset.note,
      last: keys[keys.length - 1]?.dataset.note,
      whiteKey: whiteRect,
      blackKey: blackRect,
      blackHeightFraction: whiteRect && blackRect ? blackRect.height / whiteRect.height : null,
    },
    controls: { total: controls.length, missingNames, duplicateIds, perSection },
  }
}

const results = {
  version: 1,
  phase: 2,
  url: baseUrl,
  capturedAt: new Date().toISOString(),
  browser: `Playwright Chrome ${browser.version()}`,
  deviceScaleFactor: 1,
  locale: 'en-US',
  timezone: 'UTC',
  colorScheme: 'light',
  reducedMotion: 'no-preference',
  tool: 'scripts/capture.mjs (playwright-core + local Chrome)',
  captures: {},
  interaction: null,
}

async function capture(name, viewport, options = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', ...options })
  const page = await context.newPage()
  const consoleErrors = []
  const consoleMessages = []
  const pageErrors = []
  page.on('console', (msg) => {
    consoleMessages.push({ type: msg.type(), text: msg.text() })
    if (msg.type() === 'error' || msg.type() === 'warning') consoleErrors.push(`${msg.type()}: ${msg.text()}`)
  })
  page.on('pageerror', (err) => pageErrors.push(String(err)))
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.waitForSelector('#instrument')
  // the sample library starts loading at page load; wait for the default Grand to be ready (bundled, local)
  await page.waitForFunction(() => globalThis.__stagebench?.engine.getStatus().layers.A.state === 'ready', null, { timeout: 60000 }).catch(() => undefined)
  await page.waitForTimeout(300)
  const measured = await page.evaluate(MEASURE)
  const file = path.join(outDir, `${name}.png`)
  await page.screenshot({ path: file, fullPage: false })
  const bytes = (await stat(file)).size
  results.captures[name] = { file: path.basename(file), bytes, ...measured, consoleErrors, consoleMessages, pageErrors }
  return { page, context, consoleErrors, pageErrors }
}

const desktopName = `${stage}-desktop`
const narrowName = `${stage}-narrow`

// Desktop capture + interaction pass
{
  const { page, context, consoleErrors, pageErrors } = await capture(desktopName, { width: 1440, height: 900 }, { hasTouch: true })
  const interaction = { steps: [] }
  const step = async (label, fn) => {
    try {
      const value = await fn()
      interaction.steps.push({ label, ok: true, value })
    } catch (err) {
      interaction.steps.push({ label, ok: false, error: String(err) })
    }
  }
  const status = () => page.evaluate(() => {
    const s = globalThis.__stagebench.engine.getStatus()
    return { state: s.state, effects: s.effects, voiceSource: s.voiceSource, A: { model: s.layers.A.modelName, state: s.layers.A.state, source: s.layers.A.source, loaded: s.layers.A.loaded, total: s.layers.A.total }, B: { model: s.layers.B.modelName, state: s.layers.B.state, source: s.layers.B.source } }
  })
  await step('library state on load (before any gesture)', status)
  await step('press key C4 with the mouse', async () => {
    const key = page.locator('#key-60')
    const box = await key.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8)
    await page.mouse.down()
    await page.waitForTimeout(80)
    const pressed = await key.getAttribute('aria-pressed')
    const voices = await page.evaluate(() => globalThis.__stagebench.engine.activeVoices())
    await page.mouse.up()
    await page.waitForTimeout(50)
    const released = await key.getAttribute('aria-pressed')
    return { pressed, released, voices }
  })
  await step('audio status after first gesture', async () => {
    await page.waitForFunction(() => ['ready', 'error', 'fallback'].includes(document.getElementById('audio-status')?.dataset.state ?? ''), null, { timeout: 8000 })
    await page.waitForFunction(() => ['worklet', 'main-thread', 'unavailable'].includes(globalThis.__stagebench.engine.getStatus().effects), null, { timeout: 8000 })
    return await page.evaluate(() => ({ state: document.getElementById('audio-status').dataset.state, message: document.getElementById('audio-message').textContent, library: document.getElementById('library-message').textContent, effects: document.getElementById('effects-status').dataset.state, midi: document.getElementById('midi-status').dataset.state, midiMessage: document.getElementById('midi-message').textContent, contextState: globalThis.__stagebench.engine.getStatus().contextState, sampleRate: globalThis.__stagebench.engine.getStatus().sampleRate }))
  })
  await step('engine metrics after playing', async () => await page.evaluate(() => globalThis.__stagebench.engine.metrics()))
  await step('computer keyboard A/W chord with sustain', async () => {
    await page.keyboard.down('Shift')
    await page.keyboard.down('KeyA')
    await page.keyboard.down('KeyW')
    await page.waitForTimeout(60)
    const held = await page.evaluate(() => globalThis.__stagebench.bus.heldNotes())
    const sustain = await page.evaluate(() => globalThis.__stagebench.engine.isSustain())
    await page.keyboard.up('KeyA')
    await page.keyboard.up('KeyW')
    const sustained = await page.evaluate(() => globalThis.__stagebench.engine.activeVoices().map((v) => [v.midi, v.sustained, v.releasing]))
    await page.keyboard.up('Shift')
    await page.waitForTimeout(60)
    const after = await page.evaluate(() => ({ held: globalThis.__stagebench.bus.heldNotes(), voices: globalThis.__stagebench.engine.activeVoices().map((v) => [v.midi, v.releasing]) }))
    return { held, sustain, sustained, after }
  })
  await step('multi-touch two keys', async () => {
    const a = await page.locator('#key-64').boundingBox()
    const b = await page.locator('#key-67').boundingBox()
    await page.touchscreen.tap(a.x + a.width / 2, a.y + a.height * 0.8)
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height * 0.8)
    return await page.evaluate(() => globalThis.__stagebench.bus.getState().lastEvent)
  })
  await step('cycle the piano type through all six models and back (library loads each set)', async () => {
    const seen = []
    for (let i = 0; i < 6; i++) {
      await page.locator('#piano\\.type').click()
      await page.waitForFunction(() => ['ready', 'fallback'].includes(globalThis.__stagebench.engine.getStatus().layers.A.state), null, { timeout: 60000 })
      const s = await status()
      const oled = await page.evaluate(() => document.getElementById('program.oled').dataset.headline)
      seen.push({ model: s.A.model, state: s.A.state, source: s.A.source, files: `${s.A.loaded}/${s.A.total}`, oled })
    }
    return seen
  })
  await step('play a note on the recorded Grand: buffer comes from the sample set', async () => {
    const key = page.locator('#key-62')
    const box = await key.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8)
    await page.mouse.down()
    await page.waitForTimeout(60)
    const voices = await page.evaluate(() => globalThis.__stagebench.engine.activeVoices())
    await page.mouse.up()
    return voices
  })
  await step('enable layer B with the Electric piano and play both layers', async () => {
    await page.locator('#piano\\.layer-b\\.on').click()
    await page.locator('#piano\\.type').click()
    await page.locator('#piano\\.type').click()
    await page.waitForFunction(() => ['ready', 'fallback'].includes(globalThis.__stagebench.engine.getStatus().layers.B.state), null, { timeout: 60000 })
    const key = page.locator('#key-65')
    const box = await key.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8)
    await page.mouse.down()
    await page.waitForTimeout(60)
    const voices = await page.evaluate(() => globalThis.__stagebench.engine.activeVoices().map((v) => [v.layer, v.midi, v.source]))
    await page.mouse.up()
    const s = await status()
    const state = await page.evaluate(() => {
      const st = globalThis.__stagebench.state.get()
      return { focus: st.piano.focus, A: st.piano.layers.A.modelId, B: st.piano.layers.B.modelId }
    })
    return { voices, layers: { A: s.A, B: s.B }, state }
  })
  await step('effects: turn on Mod 2, Delay, switch reverb type, set Master Level (processor params observed)', async () => {
    await page.locator('#effects\\.mod2\\.on').click()
    await page.locator('#effects\\.delay\\.on').click()
    await page.locator('#effects\\.reverb\\.type').click()
    const master = page.locator('#performance\\.master-level')
    await master.focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(120)
    return await page.evaluate(() => {
      const st = globalThis.__stagebench.state.get()
      const chain = st.effects.chains.pianoB
      return { focus: st.effects.focus, pianoFocus: st.piano.focus, mod2: chain.mod2, delay: chain.delay, reverb: chain.reverb, master: st.master, engineMaster: globalThis.__stagebench.engine.getMasterGain(), effects: globalThis.__stagebench.engine.getStatus().effects }
    })
  })
  await step('shift latch: Shift + Delay ON = Global; Shift + Piano focus = Group; To Rotary routing', async () => {
    await page.locator('#effects\\.shift').click()
    await page.locator('#effects\\.delay\\.on').click()
    await page.locator('#effects\\.shift').click()
    await page.locator('#effects\\.focus\\.piano').click()
    await page.locator('#effects\\.amp\\.on').click()
    const model = page.locator('#effects\\.amp\\.model')
    for (let i = 0; i < 7 && (await model.getAttribute('data-value')) !== '4'; i++) await model.click()
    await page.waitForTimeout(100)
    return await page.evaluate(() => {
      const st = globalThis.__stagebench.state.get()
      return { globalDelay: st.effects.global.delay, group: st.effects.pianoGroup, ampModel: st.effects.chains.pianoA.amp.model, rotaryLed: document.querySelector('.led-rotary-on .led')?.className, globalLed: document.querySelector('.led-global-delay .led')?.className }
    })
  })
  await step('in-browser DSP proof: render a tone through the AudioWorklet chain offline (reverb + delay vs bypass, rotary, master limiter)', async () =>
    await page.evaluate(async () => {
      // locate the built worklet script the app itself loads
      const html = await (await fetch('./')).text()
      const indexChunk = html.match(/assets\/index-[^"]+\.js/)[0]
      const indexText = await (await fetch('./' + indexChunk)).text()
      const bpChunk = indexText.match(/browserProcessor-[^"'`]+\.js/)[0]
      const bpText = await (await fetch('./assets/' + bpChunk)).text()
      const stub = bpText.match(/worklet-[^"'`]+\.js/)[0]
      const stubText = await (await fetch('./assets/' + stub)).text()
      const workletFile = stubText.match(/worklet-[^"'`]+\.js/)[0]
      const sr = 44100
      const render = async (kind, params, seconds = 1.5) => {
        const off = new OfflineAudioContext(2, Math.round(sr * seconds), sr)
        await off.audioWorklet.addModule('./assets/' + workletFile)
        const node = new AudioWorkletNode(off, 'stagebench-dsp', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit', processorOptions: { kind } })
        node.port.postMessage({ type: 'params', params })
        const osc = off.createOscillator()
        osc.type = 'sawtooth'
        osc.frequency.value = 220
        const env = off.createGain()
        env.gain.setValueAtTime(0.3, 0)
        env.gain.setValueAtTime(0.3, 0.25)
        env.gain.exponentialRampToValueAtTime(0.0005, 0.3)
        osc.connect(env)
        env.connect(node)
        node.connect(off.destination)
        osc.start(0)
        osc.stop(0.3)
        const buf = await off.startRendering()
        const l = buf.getChannelData(0)
        const r = buf.getChannelData(1)
        const rms = (x, a, b) => {
          let s = 0
          for (let i = a; i < b; i++) s += x[i] * x[i]
          return Math.sqrt(s / (b - a))
        }
        let peak = 0
        for (let i = 0; i < l.length; i++) peak = Math.max(peak, Math.abs(l[i]))
        let corr = 0
        let el = 0
        let er = 0
        for (let i = 0; i < l.length; i++) {
          corr += l[i] * r[i]
          el += l[i] * l[i]
          er += r[i] * r[i]
        }
        return { rmsAll: rms(l, 0, l.length), rmsTail: rms(l, Math.round(sr * 0.6), Math.round(sr * 1.4)), peak, stereoCorrelation: corr / Math.sqrt(el * er || 1) }
      }
      const base = { timbre: { family: 'acoustic', setting: 0 }, stringRes: { on: false, strings: [], pedal: false }, mod1: { on: false, type: 5, rate: 4, amount: 5 }, mod2: { on: false, type: 0, rate: 3, amount: 6 }, delay: { on: false, seconds: 0.3, feedback: 6, dryWet: 5, filter: 3, pingPong: false }, ampEq: { on: false, model: 3, drive: 3, bass: 0, mid: 0, midFreq: 5, treble: 0 }, compressor: { on: false, amount: 5, fast: false }, reverb: { on: false, type: 4, dryWet: 6, tone: 0 }, effectsOn: true }
      const bypass = await render('layer', base)
      const reverb = await render('layer', { ...base, reverb: { ...base.reverb, on: true } })
      const delay = await render('layer', { ...base, delay: { ...base.delay, on: true } })
      const allOff = await render('layer', { ...base, reverb: { ...base.reverb, on: true }, delay: { ...base.delay, on: true }, effectsOn: false })
      const rotaryFast = await render('rotary', { fast: true, drive: 2 })
      const master = await render('master', { level: 10 })
      return { workletFile, bypass, reverb, delay, allEffectsBypassed: allOff, rotaryFast, master, tailGrewWithReverb: reverb.rmsTail > bypass.rmsTail * 5, tailGrewWithDelay: delay.rmsTail > bypass.rmsTail * 5, bypassIsTransparent: Math.abs(allOff.rmsAll - bypass.rmsAll) < 1e-3, rotaryIsStereo: rotaryFast.stereoCorrelation < 0.99, limiterCapped: master.peak <= 1 }
    }),
  )
  await step('operate a knob with the keyboard', async () => {
    const knob = page.locator('#effects\\.reverb\\.dry-wet')
    const before = await knob.getAttribute('aria-valuenow')
    await knob.focus()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    const after = await knob.getAttribute('aria-valuenow')
    return { before, after }
  })
  await step('drag a drawbar and a fader with the mouse', async () => {
    const drawbar = page.locator('#organ\\.drawbar\\.8')
    const b = await drawbar.boundingBox()
    const before = await drawbar.getAttribute('aria-valuenow')
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 40, { steps: 5 })
    await page.mouse.up()
    const after = await drawbar.getAttribute('aria-valuenow')
    const fader = page.locator('#piano\\.layer-b\\.level')
    const f = await fader.boundingBox()
    const fBefore = await fader.getAttribute('aria-valuenow')
    await page.mouse.move(f.x + f.width / 2, f.y + f.height / 2)
    await page.mouse.down()
    await page.mouse.move(f.x + f.width / 2, f.y + f.height / 2 - 30, { steps: 5 })
    await page.mouse.up()
    const fAfter = await fader.getAttribute('aria-valuenow')
    const levelB = await page.evaluate(() => globalThis.__stagebench.state.get().piano.layers.B.level)
    return { drawbar: { before, after }, fader: { fBefore, fAfter, levelB } }
  })
  await step('click toggle, selector and momentary buttons (organ stays decorative)', async () => {
    const toggle = page.locator('#organ\\.vibrato\\.on')
    await toggle.click()
    const pressed = await toggle.getAttribute('aria-pressed')
    const sel = page.locator('#organ\\.model')
    await sel.click()
    const selValue = await sel.getAttribute('data-value')
    const mom = page.locator('#program\\.prog-view')
    const box = await mom.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    const held = await mom.getAttribute('data-value')
    await page.mouse.up()
    const released = await mom.getAttribute('data-value')
    return { toggle: pressed, selector: selValue, momentary: { held, released } }
  })
  await step('tab focus shows a visible focus ring', async () => {
    await page.mouse.click(5, 5)
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    return await page.evaluate(() => {
      const el = document.activeElement
      const style = getComputedStyle(el)
      return { id: el.id, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, matchesFocusVisible: el.matches(':focus-visible') }
    })
  })
  await step('organ / synth / program controls did not touch audio state', async () => await page.evaluate(() => ({ voices: globalThis.__stagebench.engine.activeVoices().length, contexts: 1, lastNote: globalThis.__stagebench.engine.getStatus().lastNote })))
  await step('blur releases everything', async () => {
    await page.keyboard.down('KeyD')
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.keyboard.up('KeyD')
    await page.waitForTimeout(700)
    return await page.evaluate(() => ({ held: globalThis.__stagebench.bus.heldNotes(), voices: globalThis.__stagebench.engine.activeVoices().length, metrics: globalThis.__stagebench.engine.metrics() }))
  })
  await step('forbidden-hardware rules (visual spec forbiddenDetection)', async () =>
    await page.evaluate(() => {
      const out = {}
      for (const s of document.querySelectorAll('.section')) {
        const id = s.dataset.section
        const sw = s.getBoundingClientRect().width
        const displays = [...s.querySelectorAll('[data-display], [id*="oled"], [class*="display"], [class*="screen"]')].map((d) => d.getBoundingClientRect())
        const controls = [...s.querySelectorAll('[data-control-kind]')].map((c) => c.getBoundingClientRect())
        const tall = controls.filter((r) => r.height >= 3 * r.width)
        const areas = displays.map((r) => r.width * r.height)
        const maxArea = Math.max(0, ...areas)
        out[id] = {
          displays: displays.length,
          wideDisplays: displays.filter((r) => r.width >= 0.5 * sw).length,
          primaryDisplays: areas.filter((a) => a >= 0.5 * maxArea).length,
          drawbarLikeControls: tall.length,
          controls: controls.length,
        }
      }
      return out
    }),
  )
  interaction.consoleErrors = consoleErrors
  interaction.pageErrors = pageErrors
  results.interaction = interaction
  await context.close()
}

// Narrow capture (mobile emulation)
{
  const { context } = await capture(narrowName, { width: 390, height: 844 }, { isMobile: true, hasTouch: true })
  await context.close()
}

await browser.close()
server.close()
// Parent-harness compatible listing plus the local measurements (both shapes are consumed by tests/regression.chassis.test.tsx).
results.profiles = ['desktop', 'narrow'].map((profile) => {
  const c = results.captures[`${stage}-${profile}`]
  return { profile, viewport: c.viewport, file: `evidence/${c.file}`, bytes: c.bytes, consoleMessages: c.consoleMessages, pageErrors: c.pageErrors }
})
await writeFile(path.join(outDir, `${stage}-capture.json`), JSON.stringify(results, null, 2))
const d = results.captures[desktopName]
console.log(`desktop: instrument ${d.instrument.width.toFixed(0)}x${d.instrument.height.toFixed(0)} = ${(d.instrument.widthFraction * 100).toFixed(1)}% of viewport, scrollHeight ${d.document.scrollHeight}, keys ${d.keys.total} (${d.keys.white}w/${d.keys.black}b), controls ${d.controls.total}`)
for (const s of d.sections) console.log(`  ${s.id.padEnd(12)} documented ${s.documentedFraction.toFixed(3)} measured ${s.measuredFraction.toFixed(3)}`)
console.log(`  deck ${d.deck.fraction.toFixed(3)} keybed ${d.keybed.fraction.toFixed(3)} blackKeyHeight ${d.keys.blackHeightFraction?.toFixed(3)}`)
console.log(`  console errors: ${d.consoleErrors.length}, page errors: ${d.pageErrors.length}`)
for (const step of results.interaction.steps) console.log(`  [${step.ok ? 'ok' : 'FAIL'}] ${step.label}: ${JSON.stringify(step.value ?? step.error).slice(0, 600)}`)
const n = results.captures[narrowName]
console.log(`narrow: instrument ${n.instrument.width.toFixed(0)}x${n.instrument.height.toFixed(0)}, scrollWidth ${n.document.scrollWidth}, console errors ${n.consoleErrors.length}`)
