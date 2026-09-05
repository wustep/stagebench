import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'
import { serveDirectory, captureEvidence } from './parent-harness/run/capture.mjs'
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.resolve('.playwright-browsers')
const { chromium } = await import('playwright')
const root = process.cwd(), server = await serveDirectory(path.join(root, 'dist')), browser = await chromium.launch({ headless: true })
const evidence = { consoleErrors: [], geometry: [], interactions: [], audio: {} }
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true }), page = await context.newPage()
  page.on('pageerror', e => evidence.consoleErrors.push(e.message)); page.on('console', m => { if (m.type() === 'error') evidence.consoleErrors.push(m.text()) })
  await page.goto(server.url)
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    const geometry = await page.evaluate(() => { const rect = document.querySelector('.instrument').getBoundingClientRect(); return { width: innerWidth, height: innerHeight, bodyWidth: document.documentElement.scrollWidth, bodyHeight: document.documentElement.scrollHeight, chassis: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, keys: document.querySelectorAll('.piano-key').length, white: document.querySelectorAll('.white-key').length, controls: document.querySelectorAll('.hardware').length, oleds: document.querySelectorAll('.oled').length } })
    evidence.geometry.push(geometry); assert.equal(geometry.keys, 73); assert.equal(geometry.white, 43); assert.equal(geometry.controls, 155); assert.equal(geometry.oleds, 2); assert.ok(geometry.bodyWidth <= viewport.width); assert.ok(geometry.chassis.y + geometry.chassis.height < viewport.height); assert.ok(Math.abs(geometry.chassis.width / geometry.chassis.height - 3.0951) < .001)
    await page.screenshot({ path: `evidence/stage3-inspection-${viewport.width}.png` })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  const unreachable = await page.evaluate(() => [...document.querySelectorAll('.hardware input,.hardware button')].filter(e => { const r = e.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return hit !== e && !e.contains(hit) }).map(e => e.id)); assert.deepEqual(unreachable, [])
  await page.locator('#program-store').click({ modifiers: ['Shift'] }); await page.getByLabel('Program name', { exact: true }).fill('Browser Roundtrip'); await page.getByRole('button', { name: 'Accept name', exact: true }).click(); await page.locator('#program-program-8').click(); await page.getByRole('button', { name: 'Confirm Store', exact: true }).click(); assert.match(await page.locator('.program-oled').textContent(), /Browser Roundtrip/)
  await page.locator('#program-prog-view').click(); assert.equal(await page.getByRole('button', { name: /^4\.8 / }).count(), 1); await page.locator('#program-prog-view').click()
  await page.locator('#program-live-mode').click(); await page.locator('#synth-layer-a').click(); await page.locator('#synth-osc-control').fill('85'); await page.reload(); await page.locator('#program-live-mode').click(); assert.equal(await page.locator('#synth-osc-control').inputValue(), '85'); evidence.interactions.push('Store As, audition, named reload, 32 numeric slots and persistent Live edits')
  await page.locator('#program-split-on').click(); await page.getByLabel('Mid split position', { exact: true }).selectOption('5'); await page.getByLabel('Mid crossfade', { exact: true }).selectOption('2'); await page.getByLabel('Synth A first zone', { exact: true }).fill('2'); assert.equal(await page.locator('.split-leds i').count(), 1)
  await page.locator('#program-scene-b').click(); assert.match(await page.locator('.program-oled').textContent(), /SCENE II/); await page.locator('#program-scene-a').click()
  await page.locator('#program-wheel-morph').click(); await page.locator('#synth-osc-control').fill('40'); assert.equal(await page.locator('[data-control-id=synth-osc-control]').getAttribute('data-morph'), 'true'); await page.locator('#performance-modulation-wheel').fill('70'); await page.locator('#program-wheel-morph').click({ modifiers: ['Shift'] }); evidence.interactions.push('Editable splits, crossfade, zones, Scenes I/II, Wheel assignment, source movement and clearing')
  await page.locator('#program-exit').click(); await page.locator('#program-live-mode').click(); await page.locator('#program-program-2').click(); await page.getByRole('button', { name: 'Activate audio', exact: true }).click(); await page.locator('h1').click(); await page.keyboard.down('a'); await page.waitForTimeout(150); assert.equal(await page.locator('.piano-key[aria-pressed=true]').count(), 1); await page.keyboard.up('a'); await page.locator('#organ-organ-model').click(); await page.locator('#organ-drawbar-16').fill('50')
  await page.locator('#program-program-6').click(); await page.locator('#synth-amp-envelope').click(); await page.getByLabel('Synth waveform', { exact: true }).selectOption('13'); await page.getByLabel('oscEnv attack', { exact: true }).fill('.25'); await page.getByRole('button', { name: 'Arp run', exact: true }).click(); await page.getByRole('button', { name: 'Keyboard hold', exact: true }).click(); await page.locator('h1').click(); await page.keyboard.down('d'); await page.waitForTimeout(150); await page.keyboard.up('d'); await page.locator('#program-transpose').click({ modifiers: ['Shift'] }); assert.equal(await page.locator('.piano-key[aria-pressed=true]').count(), 0); await page.locator('#program-exit').click(); evidence.interactions.push('Organ model/drawbar, Synth FM/envelopes/arp/hold, one-context activation, Panic')
  // Import the production engine, using the exact Vite-built AudioWorklet in OfflineAudioContext.
  const moduleNames = ['phase2-state', 'system-state', 'library', 'audio', 'layer-audio', 'system-engine']
  const modules = Object.fromEntries(await Promise.all(moduleNames.map(async name => [name, ts.transpileModule(await fs.readFile(`src/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText])))
  const worker = (await fs.readdir('dist/assets')).find(n => n.startsWith('processor-') && n.endsWith('.js'))
  evidence.audio = await page.evaluate(async ({ modules, moduleNames, workerUrl }) => {
    const urls = {}
    for (const name of moduleNames) { let source = modules[name]; for (const [dependency, url] of Object.entries(urls)) source = source.replaceAll(`'./${dependency}'`, JSON.stringify(url)).replaceAll(`"./${dependency}"`, JSON.stringify(url)); source = source.replaceAll("'./processor.ts?worker&url'", JSON.stringify(workerUrl)).replace(/import processorUrl from ([^;]+);/, 'const processorUrl = $1;'); urls[name] = URL.createObjectURL(new Blob([source], { type: 'text/javascript' })) }
    const { LayerAudio } = await import(urls['layer-audio']), { SystemEngine } = await import(urls['system-engine'])
    async function render(kind, master = .7) {
      const ctx = new OfflineAudioContext(2, 48000, 48000), errors = []; let contexts = 0
      const facade = new Proxy(ctx, { get(t, key) { if (key === 'state') return 'running'; if (key === 'close') return async () => {}; const v = Reflect.get(t, key, t); return typeof v === 'function' ? v.bind(t) : v } })
      const audio = new LayerAudio(undefined, () => { contexts++; return facade }, () => { const n = new AudioWorkletNode(ctx, 'stage-piano', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] }); n.onprocessorerror = () => errors.push('processorerror'); return n })
      const engine = new SystemEngine(audio, { getItem: () => null, setItem() {} }); engine.set({ master }); engine.setLayer('A', { enabled: kind === 'all' }); engine.extraLayer('Oa', { enabled: kind !== 'synth', model: kind === 'vox' ? 2 : kind === 'pipe' ? 4 : 0 }); engine.extraLayer('Sa', { enabled: kind === 'synth' || kind === 'all', wave: 13, ctrl: .7 }); if (kind === 'all') { engine.extraLayer('Ob', { enabled: true, model: 3 }); engine.extraLayer('Sb', { enabled: true, wave: 11 }); engine.extraLayer('Sc', { enabled: true, wave: 7 }); engine.setLayer('B', { enabled: true }); engine.focusExtra('Sc'); engine.global('delay', true); engine.effect('delay', { on: true, wet: .3 }) }
      await engine.on('test', 60, 110); await audio.flush(); const before = audio.diagnostics
      const pause = ctx.suspend(.25).then(async () => { engine.off('test'); await audio.flush(); await ctx.resume() }); const buffer = await ctx.startRendering(); await pause
      const data = buffer.getChannelData(0), energy = (from, to) => { let sum = 0; for (let i = from; i < to; i++) sum += data[i] ** 2; return sum / (to - from) }
      const result = { contexts, before, errors, attack: energy(1000, 10000), tail: energy(35000, 45000), signature: Array.from(data.filter((_, i) => i % 197 === 0)) }; engine.dispose(); result.cleanup = audio.diagnostics; return result
    }
    const result = { b3: await render('b3'), vox: await render('vox'), pipe: await render('pipe'), synth: await render('synth'), all: await render('all'), mute: await render('all', 0) }; Object.values(urls).forEach(url => URL.revokeObjectURL(url)); return result
  }, { modules, moduleNames, workerUrl: new URL(`assets/${worker}`, server.url).href })
  for (const [name, result] of Object.entries(evidence.audio)) { assert.equal(result.contexts, 1); assert.deepEqual(result.errors, []); assert.deepEqual(result.cleanup, { contexts: 0, nodes: 0, voices: 0, listeners: 0, timers: 0 }); if (name !== 'mute') assert.ok(result.attack > 1e-5); else assert.ok(result.tail < 1e-12) }
  assert.equal(evidence.audio.all.before.voices, 7); assert.notDeepEqual(evidence.audio.b3.signature, evidence.audio.vox.signature); assert.notDeepEqual(evidence.audio.b3.signature, evidence.audio.pipe.signature); assert.notDeepEqual(evidence.audio.synth.signature, evidence.audio.b3.signature); assert.deepEqual(evidence.consoleErrors, [])
  await fs.writeFile('evidence/stage3-browser-pass.json', JSON.stringify(evidence, null, 2)); await context.close()
  const metadata = await captureEvidence(path.join(root, '.canonical-capture'), { id: 'gpt-6-astra', phase: 3, url: server.url })
  for (const name of ['stage3-desktop.png', 'stage3-narrow.png', 'stage3-capture.json']) await fs.copyFile(path.join(root, '.canonical-capture/runs/gpt-6-astra/stage3/evidence', name), path.join(root, 'evidence', name))
  console.log(`Phase 3 browser interaction, audio, cleanup and canonical captures passed: ${metadata.browser}`)
} catch (error) { await fs.writeFile('evidence/stage3-browser-pass.json', JSON.stringify({ ...evidence, failure: String(error) }, null, 2)); throw error } finally { await browser.close(); await server.close() }
