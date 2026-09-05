import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'
import { serveDirectory, captureEvidence } from './parent-harness/run/capture.mjs'
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.resolve('.playwright-browsers')
const { chromium } = await import('playwright')
const root = process.cwd()
const server = await serveDirectory(path.join(root, 'dist'))
const browser = await chromium.launch({ headless: true })
const evidence = { geometry: [], interactions: {}, audio: {}, consoleErrors: [] }
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true })
  const page = await context.newPage()
  page.on('pageerror', error => evidence.consoleErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') evidence.consoleErrors.push(message.text()) })
  await page.goto(server.url)
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    const bounds = await page.evaluate(() => {
      const rect = selector => { const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect(); return { x, y, width, height } }
      const chassis = rect('.instrument'), deck = rect('.deck'), keybed = rect('.keybed')
      return { viewport: { width: innerWidth, height: innerHeight }, chassis, deck, keybed, sections: [...document.querySelectorAll('[data-section]')].map(s => ({ id: s.dataset.section, fraction: s.getBoundingClientRect().width / deck.width })), white: document.querySelectorAll('.white-key').length, black: document.querySelectorAll('.black-key').length, blackHeightFraction: rect('.black-key').height / keybed.height, widthFraction: chassis.width / innerWidth, deckFraction: (keybed.y - chassis.y) / chassis.height, bodyWidth: document.documentElement.scrollWidth, bodyHeight: document.documentElement.scrollHeight }
    })
    evidence.geometry.push(bounds)
    assert.equal(bounds.white, 43); assert.equal(bounds.black, 30)
    assert.ok(Math.abs(bounds.chassis.width / bounds.chassis.height - 3.0951) < .001)
    assert.ok(Math.abs(bounds.deckFraction - .54) < .001)
    assert.ok(Math.abs(bounds.blackHeightFraction - .61) < .001)
    assert.ok(bounds.widthFraction >= .88 && bounds.widthFraction <= .97)
    assert.ok(bounds.chassis.x >= 0 && bounds.chassis.x + bounds.chassis.width <= viewport.width)
    assert.ok(bounds.bodyWidth <= viewport.width && bounds.bodyHeight <= viewport.height)
    ;[.14, .2, .085, .125, .25, .2].forEach((fraction, i) => assert.ok(Math.abs(bounds.sections[i].fraction - fraction) < .001))
    await page.screenshot({ path: `evidence/stage2-inspection-${viewport.width}.png` })
  }
  await page.getByRole('button', { name: 'Inspect surface' }).click()
  assert.equal(await page.locator('.instrument').evaluate(e => Math.round(e.getBoundingClientRect().width)), 1400)
  await page.locator('.instrument-viewport').evaluate(e => { e.scrollLeft = e.scrollWidth })
  assert.ok(await page.locator('#effects-effects-variation').isVisible())
  await page.getByRole('button', { name: 'Fit instrument' }).click()
  await page.setViewportSize({ width: 1440, height: 900 })
  const unreachable = await page.evaluate(() => [...document.querySelectorAll('.hardware input,.hardware button')].filter(e => { const r = e.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return hit !== e && !e.contains(hit) }).map(e => e.id))
  evidence.interactions.unreachable = unreachable
  await fs.writeFile('evidence/stage2-browser-pass.json', JSON.stringify(evidence, null, 2))
  assert.deepEqual(unreachable, [], `Unreachable controls: ${unreachable.join(', ')}`)
  const panel = page.locator('.hardware input[aria-label*=decorative],.hardware button[aria-label*=decorative]')
  for (const element of await panel.all()) {
    const tag = await element.evaluate(e => e.tagName)
    await element.focus()
    if (tag === 'INPUT') {
      await element.press('Home'); await element.press('ArrowRight'); assert.equal(await element.inputValue(), '1')
      const box = await element.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 7, box.y + box.height / 2 - 9); await page.mouse.up()
      assert.ok(Number(await element.inputValue()) > 1)
    } else {
      const before = await element.getAttribute('aria-pressed'); await element.press('Space'); assert.notEqual(await element.getAttribute('aria-pressed'), before); await element.click(); assert.equal(await element.getAttribute('aria-pressed'), before)
    }
  }
  evidence.interactions.panelControls = await panel.count()
  assert.ok(await page.getByText('Piano asleep · play a key to begin').isVisible(), 'Panel interaction must not initialize audio')
  await page.locator('h1').click()
  await page.keyboard.down('a'); await page.keyboard.down('a'); await page.waitForTimeout(150)
  assert.equal(await page.locator('.piano-key[aria-pressed=true]').count(), 1)
  await page.keyboard.up('a'); assert.equal(await page.locator('.piano-key[aria-pressed=true]').count(), 0)
  await page.getByText('Playable fallback · synthesized piano library').waitFor()
  const c = await page.locator('#key-60').boundingBox(), e = await page.locator('#key-64').boundingBox()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x + c.width / 2, y: c.y + c.height * .85, id: 1 }, { x: e.x + e.width / 2, y: e.y + e.height * .85, id: 2 }] })
  assert.equal(await page.locator('.piano-key[aria-pressed=true]').count(), 2)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: e.x + e.width / 2, y: e.y + e.height * .85, id: 2 }] })
  assert.equal(await page.locator('.piano-key[aria-pressed=true]').count(), 1)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  assert.equal(await page.locator('.piano-key[aria-pressed=true]').count(), 0)
  await page.mouse.move(c.x + c.width / 2, c.y + c.height * .85); await page.mouse.down(); await page.mouse.move(10, 10); await page.mouse.up()
  assert.equal(await page.locator('.piano-key[aria-pressed=true]').count(), 0)
  await page.keyboard.down('s'); await page.evaluate(() => window.dispatchEvent(new Event('blur'))); assert.equal(await page.locator('.piano-key[aria-pressed=true]').count(), 0); await page.keyboard.up('s')
  evidence.interactions.keyboardRepeat = true; evidence.interactions.independentTouch = true; evidence.interactions.cancelBlurCaptureRelease = true
  // Execute the actual production audio implementation in Chromium's OfflineAudioContext.
  const source = ts.transpileModule(await fs.readFile('src/audio.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
  evidence.audio = await page.evaluate(async source => {
    const blob = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    const { BrowserAudio, PianoEngine, velocityGain } = await import(blob)
    URL.revokeObjectURL(blob)
    async function render(velocity, sustained) {
      const ctx = new OfflineAudioContext(1, 44100, 44100)
      const facade = new Proxy(ctx, { get(target, name) { if (name === 'state') return 'running'; if (name === 'close') return async () => {}; const value = Reflect.get(target, name, target); return typeof value === 'function' ? value.bind(target) : value } })
      const engine = new PianoEngine(new BrowserAudio(() => facade))
      await engine.on('test', 60, velocity)
      if (sustained) engine.sustain('test-pedal', true)
      const pause = ctx.suspend(.15).then(async () => { engine.off('test'); await ctx.resume() })
      const buffer = await ctx.startRendering(); await pause
      const data = buffer.getChannelData(0)
      const energy = (from, to) => { let e = 0; for (let i = Math.floor(from * 44100); i < Math.floor(to * 44100); i++) e += data[i] ** 2; return e / ((to - from) * 44100) }
      const result = { attack: energy(.02, .12), tail: energy(.55, .85), peak: data.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0) }
      engine.dispose(); result.remainingVoices = engine.notes.size
      return result
    }
    const soft = await render(35, false), loud = await render(115, false), sustained = await render(115, true)
    return { soft, loud, sustained, velocityEnergyRatio: loud.attack / soft.attack, expectedRatio: (velocityGain(115) / velocityGain(35)) ** 2, source: 'Actual BrowserAudio → generated AudioBufferSource → velocity/release Gain → 0.32 master Gain → OfflineAudioContext destination' }
  }, source)
  assert.ok(evidence.audio.loud.attack > .001)
  assert.ok(evidence.audio.velocityEnergyRatio > 8)
  assert.ok(Math.abs(evidence.audio.velocityEnergyRatio / evidence.audio.expectedRatio - 1) < .01)
  assert.ok(evidence.audio.loud.tail < 1e-10)
  assert.ok(evidence.audio.sustained.tail > .0001)
  assert.equal(evidence.audio.sustained.remainingVoices, 0)

  // Bundle-free module loader for the actual TypeScript production classes; the
  // AudioWorklet itself is the exact Vite-built asset served with the app.
  const moduleNames = ['phase2-state', 'library', 'audio', 'layer-audio']
  const modules = Object.fromEntries(await Promise.all(moduleNames.map(async name => [name, ts.transpileModule(await fs.readFile(`src/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText])))
  const worker = (await fs.readdir('dist/assets')).find(name => name.startsWith('processor-') && name.endsWith('.js'))
  assert.ok(worker, 'Production AudioWorklet was built')
  evidence.phase2Audio = await page.evaluate(async ({ modules, workerUrl }) => {
    const urls = {}
    for (const name of ['phase2-state', 'library', 'audio', 'layer-audio']) {
      let source = modules[name]
      for (const [dependency, url] of Object.entries(urls)) source = source.replaceAll(`'./${dependency}'`, JSON.stringify(url)).replaceAll(`"./${dependency}"`, JSON.stringify(url))
      source = source.replaceAll("'./processor.ts?worker&url'", JSON.stringify(workerUrl))
      // worker&url is a build-time URL import, not an executable module import.
      source = source.replace(/import processorUrl from ([^;]+);/, 'const processorUrl = $1;')
      urls[name] = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    }
    const { LayerAudio, LayeredPianoEngine } = await import(urls['layer-audio'])
    async function render(options = {}) {
      const ctx = new OfflineAudioContext(2, 48000, 48000)
      const facade = new Proxy(ctx, { get(target, name) { if (name === 'state') return 'running'; if (name === 'close') return async () => {}; const value = Reflect.get(target, name, target); return typeof value === 'function' ? value.bind(target) : value } })
      let contexts = 0
      const processorErrors = []
      const audio = new LayerAudio(undefined, () => { contexts++; return facade }, () => { const node = new AudioWorkletNode(ctx, 'stage-piano', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] }); node.onprocessorerror = e => processorErrors.push(String(e.message ?? 'Processor failed')); return node })
      const engine = new LayeredPianoEngine(audio)
      if (options.layer) engine.setLayer('A', options.layer)
      if (options.master !== undefined) engine.set({ master: options.master })
      if (options.second) engine.setLayer('B', { enabled: true, type: 'Digital', octave: 1 })
      if (options.effects) for (const [unit, patch] of Object.entries(options.effects)) engine.effect(unit, patch)
      if (options.rotary) engine.set({ rotary: { on: true, fast: true, drive: .7 } })
      await engine.on('test', 60, options.velocity ?? 95)
      if (engine.status !== 'ready') throw new Error(engine.error)
      if (options.sustain) engine.sustain('test', true)
      await audio.flush()
      const before = { diagnostics: audio.diagnostics, notes: engine.notes.size, status: engine.status, error: engine.error }
      const pause = ctx.suspend(.15).then(async () => { engine.off('test'); await audio.flush(); await ctx.resume() })
      const result = await ctx.startRendering(); await pause
      const left = result.getChannelData(0), right = result.getChannelData(1)
      const energy = (from, to) => { let sum = 0; for (let i = Math.floor(from * 48000); i < Math.floor(to * 48000); i++) sum += left[i] ** 2; return sum / ((to - from) * 48000) }
      const metrics = { before, processorErrors, attack: energy(.02, .12), tail: energy(.55, .85), signature: Array.from(left.filter((_, i) => i % 97 === 0)), stereo: left.reduce((sum, v, i) => sum + (v - right[i]) ** 2, 0) / left.length, contexts, status: audio.library.status }
      engine.dispose(); metrics.cleanup = audio.diagnostics; return metrics
    }
    const result = { plain: await render(), soft: await render({ velocity: 30 }), sustain: await render({ sustain: true }), pedalDisabled: await render({ sustain: true, layer: { sustped: false } }), masterZero: await render({ master: 0 }), layered: await render({ second: true }), unison: await render({ layer: { unison: 3 } }), fx: await render({ effects: { delay: { on: true, wet: .7, feedback: .8, rate: .1 }, ampEq: { on: true, type: 6 }, reverb: { on: true, wet: .6, type: 4 } }, rotary: true }) }
    for (const url of Object.values(urls)) URL.revokeObjectURL(url)
    return result
  }, { modules, workerUrl: new URL(`assets/${worker}`, server.url).href })
  await fs.writeFile('evidence/stage2-browser-pass.json', JSON.stringify(evidence, null, 2))
  const audio2 = evidence.phase2Audio
  assert.ok(audio2.plain.attack > .0001)
  assert.ok(audio2.plain.attack > audio2.soft.attack * 8)
  assert.ok(audio2.plain.tail < 1e-10)
  assert.ok(audio2.sustain.tail > .00001)
  assert.ok(audio2.pedalDisabled.tail < 1e-10)
  assert.ok(audio2.masterZero.tail < 1e-12)
  assert.notDeepEqual(audio2.layered.signature, audio2.plain.signature)
  assert.ok(audio2.unison.stereo > 1e-6)
  assert.ok(audio2.fx.tail > 1e-8)
  for (const result of Object.values(audio2)) { assert.equal(result.contexts, 1); assert.equal(result.status, 'fallback'); assert.deepEqual(result.cleanup, { contexts: 0, nodes: 0, voices: 0, listeners: 0, timers: 0 }) }
  await page.locator('#piano-piano-type').click()
  assert.ok((await page.locator('#piano-piano-type').getAttribute('aria-label')).includes('Upright'))
  await page.locator('#performance-master-level').fill('25')
  assert.equal(await page.locator('#performance-master-level').inputValue(), '25')
  await page.locator('.sound-editor summary').click()
  await page.getByRole('button', { name: 'Enable Piano B', exact: true }).click()
  await page.getByRole('button', { name: 'Focus Piano B', exact: true }).click()
  assert.ok((await page.locator('.sound-editor summary').textContent()).includes('FX Piano B'))
  await page.getByRole('button', { name: 'Piano group mode', exact: true }).click()
  await page.locator('#effects-delay-on').click({ modifiers: ['Shift'] })
  assert.equal(await page.getByRole('button', { name: 'delay global', exact: true }).getAttribute('aria-pressed'), 'true')
  await page.getByRole('button', { name: 'All effects on', exact: true }).click()
  await page.getByRole('button', { name: 'Stop notes', exact: true }).click()
  await page.locator('.sound-editor summary').click()

  assert.deepEqual(evidence.consoleErrors, [])
  await fs.writeFile('evidence/stage2-browser-pass.json', JSON.stringify(evidence, null, 2))
  await context.close()
  console.log('Browser geometry, all controls, keyboard, multi-touch, cleanup and real offline audio passed.')
  const metadata = await captureEvidence(path.join(root, '.canonical-capture'), { id: 'gpt-6-astra', phase: 2, url: server.url })
  for (const name of ['stage2-desktop.png', 'stage2-narrow.png', 'stage2-capture.json']) await fs.copyFile(path.join(root, '.canonical-capture/runs/gpt-6-astra/stage2/evidence', name), path.join(root, 'evidence', name))
  console.log(`Canonical captures complete: ${metadata.browser}`)
} finally { await browser.close(); await server.close() }
