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
    await page.screenshot({ path: `evidence/inspection-${viewport.width}.png` })
  }
  await page.getByRole('button', { name: 'Inspect surface' }).click()
  assert.equal(await page.locator('.instrument').evaluate(e => Math.round(e.getBoundingClientRect().width)), 1400)
  await page.locator('.instrument-viewport').evaluate(e => { e.scrollLeft = e.scrollWidth })
  assert.ok(await page.locator('#effects-effects-variation').isVisible())
  await page.getByRole('button', { name: 'Fit instrument' }).click()
  await page.setViewportSize({ width: 1440, height: 900 })
  const unreachable = await page.evaluate(() => [...document.querySelectorAll('.hardware input,.hardware button')].filter(e => { const r = e.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return hit !== e && !e.contains(hit) }).map(e => e.id))
  evidence.interactions.unreachable = unreachable
  await fs.writeFile('evidence/browser-pass.json', JSON.stringify(evidence, null, 2))
  assert.deepEqual(unreachable, [], `Unreachable controls: ${unreachable.join(', ')}`)
  const panel = page.locator('.hardware input,.hardware button')
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
  await page.getByText('Piano ready · synthesized voice').waitFor()
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
  assert.deepEqual(evidence.consoleErrors, [])
  await fs.writeFile('evidence/browser-pass.json', JSON.stringify(evidence, null, 2))
  await context.close()
  console.log('Browser geometry, all controls, keyboard, multi-touch, cleanup and real offline audio passed.')
  const metadata = await captureEvidence(path.join(root, '.canonical-capture'), { id: 'gpt-6-astra', phase: 1, url: server.url })
  for (const name of ['stage1-desktop.png', 'stage1-narrow.png', 'stage1-capture.json']) await fs.copyFile(path.join(root, '.canonical-capture/runs/gpt-6-astra/stage1/evidence', name), path.join(root, 'evidence', name))
  console.log(`Canonical captures complete: ${metadata.browser}`)
} finally { await browser.close(); await server.close() }
