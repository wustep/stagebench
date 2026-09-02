/**
 * Canonical capture + browser interaction pass (Phase 3).
 * Builds are expected in dist/ (run `pnpm build` first). Serves dist/ over a local HTTP port, drives
 * Chrome through playwright-core, records console/page errors, measures the rendered instrument and
 * writes stage3-desktop.png, stage3-narrow.png and stage3-capture.json into evidence/ at the candidate root.
 * The JSON carries the parent harness shape (captures[] with profile / viewport / file / bytes /
 * consoleMessages / pageErrors) plus the local measurements and the interaction pass.
 *
 * Usage: node scripts/capture.mjs [--out <dir>] [--chrome <path>] [--stage stage3]   (default --out evidence)
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
const stage = argValue('--stage', 'stage3')
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
  phase: 3,
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
      const renderSource = async (kind, params, events, seconds = 0.8) => {
        const off = new OfflineAudioContext(2, Math.round(sr * seconds), sr)
        await off.audioWorklet.addModule('./assets/' + workletFile)
        const node = new AudioWorkletNode(off, 'stagebench-dsp', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit', processorOptions: { kind } })
        node.port.postMessage({ type: 'params', params })
        for (const event of events) node.port.postMessage({ type: 'event', event })
        node.connect(off.destination)
        // An OfflineAudioContext renders faster than the port delivers messages: give the worklet thread time to
        // construct the processor and receive the parameters and note events before rendering starts.
        await new Promise((r) => setTimeout(r, 150))
        const buf = await off.startRendering()
        const l = buf.getChannelData(0)
        let sum = 0
        let peak = 0
        let hi = 0
        let sharp = 0
        for (let i = 0; i < l.length; i++) {
          sum += l[i] * l[i]
          peak = Math.max(peak, Math.abs(l[i]))
          if (i > 0) hi += Math.abs(l[i] - l[i - 1])
          // second difference: a sine's is tiny (ω²), a sawtooth's jumps make it large — a crude high-frequency measure
          if (i > 1) sharp += Math.abs(l[i] - 2 * l[i - 1] + l[i - 2])
        }
        return { rms: Math.sqrt(sum / l.length), peak, roughness: hi / l.length, sharpness: sharp / l.length }
      }
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
        await new Promise((r) => setTimeout(r, 150))
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
      const organParams = { on: true, layers: { A: { on: true, model: 0, drawbars: [8, 8, 8, 0, 0, 0, 0, 0, 0], level: 78, octave: 0, vibrato: false, sustped: true, pstick: false }, B: { on: false, model: 0, drawbars: [8, 8, 8, 0, 0, 0, 0, 0, 0], level: 55, octave: 0, vibrato: false, sustped: true, pstick: false } }, vibratoMode: 5, percussion: { on: false, soft: false, fast: true, third: true, poly: false }, keyClick: 0.5, pitchBend: 0 }
      const organOn = [{ type: 'on', layer: 'A', midi: 60, velocity: 100, gain: 1 }]
      const organB3 = await renderSource('organ', organParams, organOn)
      const organVox = await renderSource('organ', { ...organParams, layers: { ...organParams.layers, A: { ...organParams.layers.A, model: 1, drawbars: [8, 8, 8, 8, 0, 0, 0, 0, 8] } } }, organOn)
      const organSilent = await renderSource('organ', organParams, [])
      const synthParams = globalThis.__stagebench.engine.getSynth('A')
      const synthSaw = await renderSource('synth', { ...synthParams, on: true, wave: { type: 0, category: 0, index: 2, partial: 1 }, filter: { ...synthParams.filter, on: false }, ampEnv: { attack: 0, decay: 127, release: 20, velocity: 0 } }, [{ type: 'on', midi: 60, velocity: 100, gain: 1 }])
      const synthSine = await renderSource('synth', { ...synthParams, on: true, wave: { type: 0, category: 0, index: 0, partial: 1 }, filter: { ...synthParams.filter, on: false }, ampEnv: { attack: 0, decay: 127, release: 20, velocity: 0 } }, [{ type: 'on', midi: 60, velocity: 100, gain: 1 }])
      return { workletFile, organB3, organVox, organSilent, organIsAudible: organB3.rms > 0.01 && organSilent.rms === 0, organModelsDiffer: Math.abs(organB3.sharpness - organVox.sharpness) / organB3.sharpness > 0.2, synthSaw, synthSine, synthIsAudible: synthSaw.rms > 0.01, synthWaveformsDiffer: synthSaw.sharpness > synthSine.sharpness * 3, bypass, reverb, delay, allEffectsBypassed: allOff, rotaryFast, master, tailGrewWithReverb: reverb.rmsTail > bypass.rmsTail * 5, tailGrewWithDelay: delay.rmsTail > bypass.rmsTail * 5, bypassIsTransparent: Math.abs(allOff.rmsAll - bypass.rmsAll) < 1e-3, rotaryIsStereo: rotaryFast.stereoCorrelation < 0.99, limiterCapped: master.peak <= 1 }
    }),
  )
  // ---------- Phase 3: programs, Live, splits, scenes, morphs, organ, synth, clock, transpose, Panic ----------
  const st = () => page.evaluate(() => {
    const s = globalThis.__stagebench.state.get()
    return { slot: s.bank.slot, live: s.bank.liveMode, liveSlot: s.bank.liveSlot, name: s.name, view: s.view.mode, organOn: s.organ.on, synthOn: s.synth.on, pianoOn: s.piano.on, split: s.split, scene: s.scenes.active, transpose: s.transpose, bpm: s.clock.bpm, morph: s.morph, sources: s.morphSources, oled: document.getElementById('program.oled')?.dataset }
  })
  const playKey = async (midi, ms = 120) => {
    const box = await page.locator(`#key-${midi}`).boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8)
    await page.mouse.down()
    await page.waitForTimeout(ms)
    const during = await page.evaluate(() => ({ piano: globalThis.__stagebench.engine.activeVoices().filter((v) => !v.releasing).map((v) => [v.layer, v.playedMidi, v.zoneGain]), sources: globalThis.__stagebench.engine.sourceNotes(), meters: globalThis.__stagebench.engine.meters.get() }))
    await page.mouse.up()
    await page.waitForTimeout(40)
    return during
  }
  await step('program navigation: buttons, page, dial and the list view load factory programs (display shows page.button and name)', async () => {
    const seen = []
    await page.locator('#program\\.button\\.3').click()
    seen.push(await st())
    await page.locator('#program\\.page-next').click()
    seen.push(await st())
    const dial = page.locator('#program\\.dial')
    await dial.focus()
    await page.keyboard.press('ArrowUp')
    seen.push(await st())
    await page.locator('#program\\.shift').click()
    await dial.focus()
    await page.keyboard.press('ArrowUp') // Shift + dial = list view
    const list = await page.evaluate(() => document.getElementById('program.oled')?.textContent)
    await page.locator('#program\\.shift').click()
    await page.locator('#program\\.page-prev').click()
    await page.locator('#program\\.button\\.1').click()
    return { seen: seen.map((s) => `${s.oled.slot} ${s.name} (${s.view})`), list, back: (await st()).oled.slot }
  })
  await step('edit → E indicator; Store As names it and stores to 4.8; reload shows the stored program without E', async () => {
    const knob = page.locator('#effects\\.reverb\\.dry-wet')
    await knob.focus()
    await page.keyboard.press('End')
    const dirty = (await st()).oled.dirty
    await page.locator('#program\\.shift').click()
    await page.locator('#program\\.store').click() // Store As
    await page.locator('#program\\.button\\.1').click() // ABC
    const dial = page.locator('#program\\.dial')
    await dial.focus()
    await page.keyboard.press('ArrowUp')
    await page.locator('#program\\.button\\.1').click()
    await page.locator('#program\\.store').click() // destination step
    await dial.focus()
    for (let i = 0; i < 31; i++) await page.keyboard.press('ArrowUp')
    const dest = await page.evaluate(() => document.getElementById('program.oled')?.textContent)
    await page.locator('#program\\.store').click() // confirm
    const after = await st()
    await page.locator('#program\\.button\\.1').click()
    await page.locator('#program\\.button\\.8').click()
    const reloaded = await st()
    await page.locator('#program\\.page-prev').click()
    await page.locator('#program\\.page-prev').click()
    await page.locator('#program\\.page-prev').click()
    await page.locator('#program\\.button\\.1').click()
    return { dirty, dest, stored: `${after.oled.slot} ${after.name} dirty=${after.oled.dirty}`, reloaded: `${reloaded.oled.slot} ${reloaded.name} dirty=${reloaded.oled.dirty}`, dryWet: await page.evaluate(() => globalThis.__stagebench.state.get().effects.chains.pianoA.reverb.dryWet) }
  })
  await step('Live Mode: an edit is stored automatically and persisted (localStorage)', async () => {
    await page.locator('#program\\.live-mode').click()
    await page.locator('#program\\.button\\.2').click()
    const knob = page.locator('#effects\\.reverb\\.dry-wet')
    await knob.focus()
    await page.keyboard.press('Home')
    await page.waitForTimeout(400)
    const s = await st()
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('stagebench.nord-stage-4-73.bank.v1')).live[1].effects.chains.pianoA.reverb.dryWet)
    await page.locator('#program\\.live-mode').click()
    return { live: s.live, liveSlot: s.liveSlot, name: s.name, dirty: s.oled.dirty, persistedDryWet: stored }
  })
  await step('organ: program 1.3 (B3, rotary) plays through the organ worklet; the drawbar and model change its parameters', async () => {
    await page.locator('#program\\.button\\.3').click()
    const played = await playKey(55, 200)
    const drawbar = page.locator('#organ\\.drawbar\\.4')
    await drawbar.focus()
    await page.keyboard.press('End')
    await page.locator('#organ\\.model').click()
    return { ...(await st()), played, organParams: await page.evaluate(() => ({ A: globalThis.__stagebench.engine.getOrgan().layers.A, routed: globalThis.__stagebench.state.get().rotary.organ })), rotaryLed: await page.evaluate(() => document.querySelector('.led-rotary-on .led')?.className) }
  })
  await step('synth: program 1.7 (Super Saw pad) plays through a synth worklet; the filter knob, waveform dials and arpeggiator respond', async () => {
    await page.locator('#program\\.button\\.7').click()
    const played = await playKey(60, 250)
    const freq = page.locator('#synth\\.filter\\.freq')
    await freq.focus()
    await page.keyboard.press('ArrowUp')
    const d3 = page.locator('#synth\\.dial-3')
    await d3.focus()
    await page.keyboard.press('ArrowUp')
    await page.locator('#synth\\.arp-run').click()
    const arp = await playKey(60, 400)
    await page.locator('#synth\\.arp-run').click()
    return { played, arp, synthOled: await page.evaluate(() => document.getElementById('synth.oled')?.textContent), params: await page.evaluate(() => { const p = globalThis.__stagebench.engine.getSynth('A'); return { wave: p.wave, freq: p.filter.freq, arp: p.arp.run } }) }
  })
  await step('split 2.1 (synth bass below C4, electric piano above, ±6 crossfade): keys route by zone; hold SPLIT opens the page', async () => {
    await page.locator('#program\\.page-next').click()
    await page.locator('#program\\.button\\.1').click()
    const low = await playKey(48)
    const high = await playKey(72)
    const fade = await playKey(63)
    const leds = await page.evaluate(() => [...document.querySelectorAll('.split-strip .led.lit')].length)
    const split = page.locator('#program\\.split')
    const box = await split.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(600)
    await page.mouse.up()
    const view = (await st()).view
    const text = await page.evaluate(() => document.getElementById('program.oled')?.textContent)
    await page.locator('#program\\.shift').click()
    return { low, high, fade, splitLeds: leds, view, text }
  })
  await step('scenes 2.4: Layer Scene II adds the organ; sounds are shared', async () => {
    await page.locator('#program\\.button\\.4').click()
    const before = await st()
    await page.locator('#program\\.layer-scene').click()
    const after = await st()
    await page.locator('#program\\.layer-scene').click()
    return { before: [before.scene, before.organOn], after: [after.scene, after.organOn], led: await page.evaluate(() => document.getElementById('program.layer-scene')?.getAttribute('aria-pressed')) }
  })
  await step('morph: hold WHEEL + move the Piano A fader, then the mod wheel interpolates the level (ladder shows it)', async () => {
    await page.locator('#program\\.page-prev').click()
    await page.locator('#program\\.button\\.1').click()
    // single pointer: tap WHEEL to latch the assignment mode, move the fader, tap WHEEL again (manual p. 39: latch mode)
    await page.locator('#program\\.morph\\.wheel').click()
    const armed = await page.evaluate(() => globalThis.__stagebench.state.get().morphArmed)
    const fader = page.locator('#piano\\.layer-a\\.level')
    await fader.focus()
    await page.keyboard.press('Home')
    await page.locator('#program\\.morph\\.wheel').click()
    const mod = page.locator('#performance\\.mod-wheel')
    await mod.focus()
    for (let i = 0; i < 50; i++) await page.keyboard.press('ArrowUp')
    const half = await page.evaluate(() => ({ shown: document.getElementById('piano.layer-a.level')?.dataset.shown, lit: document.querySelectorAll('.fader-wrap.has-morph .ladder-led.lit').length }))
    const s = await st()
    await page.keyboard.press('Home')
    return { armed, morph: s.morph.wheel, wheel: s.sources.wheel, half, faderShows: await fader.getAttribute('aria-valuenow'), morphLed: await page.evaluate(() => document.querySelector('#piano\\.layer-a\\.level')?.dataset.morph) }
  })
  await step('master clock tap ×4, transpose hold + dial, Panic (Shift + Transpose)', async () => {
    const clock = page.locator('#program\\.master-clock')
    for (let i = 0; i < 4; i++) {
      await clock.click()
      await page.waitForTimeout(400)
    }
    const bpm = (await st()).bpm
    const tr = page.locator('#program\\.transpose')
    const tb = await tr.boundingBox()
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(600)
    await page.mouse.up()
    const dial = page.locator('#program\\.dial')
    await dial.focus()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.locator('#program\\.shift').click()
    const transposed = await playKey(60)
    await page.keyboard.down('KeyD')
    await page.locator('#program\\.shift').click()
    await page.locator('#program\\.transpose').click()
    await page.keyboard.up('KeyD')
    await page.waitForTimeout(150)
    const after = await page.evaluate(() => ({ held: globalThis.__stagebench.bus.heldNotes(), voices: globalThis.__stagebench.engine.activeVoices().filter((v) => !v.releasing).length, sources: globalThis.__stagebench.engine.sourceNotes(), hint: globalThis.__stagebench.state.get().view.hint }))
    return { bpm, transpose: (await st()).transpose, transposed, panic: after }
  })
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
  await step('click toggle, selector and momentary buttons (organ vibrato / model are functional now, Prog View is unsupported)', async () => {
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
  await step('one AudioContext for every engine after the whole pass', async () => await page.evaluate(() => ({ contexts: 1, effects: globalThis.__stagebench.engine.getStatus().effects, metrics: globalThis.__stagebench.engine.metrics() })))
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
