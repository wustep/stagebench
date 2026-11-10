/**
 * Stage 2 browser pass and captures.
 *
 * This is a Playwright snippet: a single async function that receives a `page`. It was run
 * through a Playwright session (Chromium) against `vite preview` of the production build:
 *
 *   pnpm build && pnpm exec vite preview --port 4327 --strictPort
 *
 * The parent capture harness named in the phase prompt is outside the workspace and was not
 * reachable; if it is run later it may add or overwrite files in evidence/.
 *
 * What it does, in a real browser with the real AudioWorklet and the real sample files:
 *   - plays every piano type and measures the level leaving the audio node (through an
 *     AnalyserNode that the script taps onto the node's output; the app itself has none);
 *   - operates the layer, piano, and effect controls and reads back LEDs and the Program display;
 *   - blocks one sample set and checks the labelled fallback;
 *   - records console messages and page errors;
 *   - takes the screenshots listed in IMPLEMENTATION_DETAILS.json.
 *
 * Output: evidence/stage2-desktop.png, stage2-effects-on.png, stage2-narrow.png, and the returned
 * report, which the session saved as evidence/stage2-capture.json (the snippet itself has no
 * file-system access, so the screenshots are written by Playwright and the report is returned).
 */
async (page) => {
  const BASE_URL = 'http://localhost:4327/'
  const OUT_DIR = '/Users/wustep/.stagebench/stagebench-cacd547e/work/claude-fable-5-2/stage2/candidate/evidence'
  const report = { version: 1, phase: 2, url: BASE_URL, capturedAt: new Date().toISOString(), steps: [], consoleMessages: [], pageErrors: [] }
  const step = (name, data) => report.steps.push({ name, ...data })

  // Console errors and warnings, with identical messages counted rather than repeated.
  page.on('console', (message) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return
    const known = report.consoleMessages.find((entry) => entry.type === message.type() && entry.text === message.text())
    if (known) known.count += 1
    else report.consoleMessages.push({ type: message.type(), text: message.text(), count: 1 })
  })
  page.on('pageerror', (error) => report.pageErrors.push(String(error)))

  // Start clean: no request blocking left over from an earlier, interrupted run.
  await page.unrouteAll()

  // Tap the one audio node's output so the level that would reach the speakers can be measured.
  await page.addInitScript(() => {
    // Install once per document, however many times this snippet has been run in the tab.
    if (window.__tapInstalled) return
    window.__tapInstalled = true
    const connect = AudioNode.prototype.connect
    window.__taps = []
    window.__contexts = new Set()
    AudioNode.prototype.connect = function (destination, ...rest) {
      window.__contexts.add(this.context)
      if (destination === this.context.destination) {
        const analyser = this.context.createAnalyser()
        analyser.fftSize = 8192
        connect.call(this, analyser)
        window.__taps.push(analyser)
        window.__destinationConnections = (window.__destinationConnections || 0) + 1
      }
      return connect.call(this, destination, ...rest)
    }
  })

  const level = () =>
    page.evaluate(() => {
      const analyser = window.__taps[window.__taps.length - 1]
      if (!analyser) return 0
      const data = new Float32Array(analyser.fftSize)
      analyser.getFloatTimeDomainData(data)
      let sum = 0
      for (const sample of data) sum += sample * sample
      return Math.sqrt(sum / data.length)
    })
  const text = (selector) => page.locator(selector).first().textContent()
  const oled = (line) => text(`#program-oled [data-line="${line}"]`)
  const led = (slug) => page.locator(`#led-${slug}`).getAttribute('data-mode')
  const status = () => text('[data-testid="audio-status"]')
  // A real mouse click at the centre of the control: pointer down, pointer up, click.
  const press = (id) => page.locator(`#${id}`).click({ timeout: 5000 })
  const shiftPress = async (id) => {
    await page.keyboard.down('Shift')
    await press(id)
    await page.keyboard.up('Shift')
  }
  const keyDown = (note) => page.locator(`#key-${note}`).dispatchEvent('pointerdown', { pointerId: 100 + note, pointerType: 'touch', bubbles: true })
  const keyUp = (note) => page.locator(`#key-${note}`).dispatchEvent('pointerup', { pointerId: 100 + note, pointerType: 'touch', bubbles: true })
  /** Play a note, measure the level while it rings, release it. */
  const play = async (note = 60, ms = 350) => {
    await keyDown(note)
    await page.waitForTimeout(ms)
    const rms = await level()
    await keyUp(note)
    await page.waitForTimeout(250)
    return Math.round(rms * 1e5) / 1e5
  }
  const waitReady = () => page.waitForFunction(() => document.querySelector('[data-testid="audio-status"]')?.textContent === 'Ready', null, { timeout: 15000 })

  try {
  // ── Desktop, untouched ──────────────────────────────────────────────────────
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(BASE_URL)
  await page.waitForSelector('#instrument')
  await page.waitForTimeout(800)
  step('load', { audio: await status(), model: await oled('model'), source: await oled('source'), layers: await oled('layers') })
  await page.screenshot({ path: `${OUT_DIR}/stage2-desktop.png` })

  // ── First key press: worklet + samples ──────────────────────────────────────
  await keyDown(60)
  await waitReady()
  await page.waitForTimeout(300)
  const first = await level()
  await keyUp(60)
  await page.waitForTimeout(300)
  step('first note', {
    audio: await status(),
    detail: await text('[data-status-kind="audio"] .chip__detail'),
    source: await oled('source'),
    rms: first,
    contexts: await page.evaluate(() => window.__contexts.size),
    destinationConnections: await page.evaluate(() => window.__destinationConnections),
    sampleRequests: await page.evaluate(() => performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/samples/')).length),
    foreignRequests: await page.evaluate(() => performance.getEntriesByType('resource').filter((entry) => !entry.name.startsWith(location.origin)).map((entry) => entry.name)),
  })

  // ── Six types ───────────────────────────────────────────────────────────────
  const types = []
  for (let type = 0; type < 6; type += 1) {
    await waitReady()
    types.push({
      type: await page.locator('#piano-type').getAttribute('data-step-label'),
      model: await oled('model'),
      source: await oled('source'),
      audio: await status(),
      rms: await play(60),
    })
    await press('piano-type')
    await page.waitForTimeout(150)
  }
  step('six types', { types })

  // ── Layers and piano controls ───────────────────────────────────────────────
  await press('piano-layer-b')
  await press('piano-type')
  await page.waitForTimeout(400)
  await waitReady()
  const layered = { layers: await oled('layers'), ledA: await led('piano-layer-a'), ledB: await led('piano-layer-b'), rms: await play(60), voices: await text('[data-testid="voice-count"]') }
  await shiftPress('piano-layer-a')
  layered.sustpedAfterShiftA = await led('piano-sustped')
  await shiftPress('piano-layer-a')
  layered.sustpedAgain = await led('piano-sustped')
  await press('piano-layer-b')
  layered.afterOff = await oled('layers')
  step('layers', layered)

  const controls = {}
  for (const id of ['piano-unison', 'piano-timbre', 'piano-kb-touch', 'piano-dyn-comp', 'piano-acoustics']) {
    await press(id)
    controls[id] = { step: await page.locator(`#${id}`).getAttribute('data-step-label'), notice: await oled('notice'), rms: await play(60, 250) }
  }
  step('piano controls', { controls })
  for (const id of ['piano-unison', 'piano-unison', 'piano-unison', 'piano-timbre', 'piano-timbre', 'piano-timbre', 'piano-kb-touch', 'piano-kb-touch', 'piano-dyn-comp', 'piano-dyn-comp', 'piano-dyn-comp', 'piano-acoustics', 'piano-acoustics', 'piano-acoustics']) await press(id)

  // ── Effects ─────────────────────────────────────────────────────────────────
  const effects = {}
  for (const id of ['fx-mod1-on', 'fx-mod2-on', 'fx-delay-on', 'fx-amp-on', 'fx-comp-on', 'fx-reverb-on']) {
    await press(id)
    effects[id] = { led: await led(id), rms: await play(60, 300) }
    await press(id)
  }
  // Tap tempo: two real taps 400 ms apart.
  await press('fx-delay-tap')
  await page.waitForTimeout(400)
  await press('fx-delay-tap')
  effects.tap = { notice: await oled('notice'), knob: await page.locator('#fx-delay-tempo').getAttribute('aria-description') }
  // To Rotary, fast.
  for (let presses = 0; presses < 3; presses += 1) await press('fx-amp-type')
  await press('fx-amp-on')
  await press('rotary-speed')
  effects.rotary = { ampType: await page.locator('#fx-amp-type').getAttribute('data-step-label'), rotaryOn: await led('rotary-on'), speed: await page.locator('#rotary-speed').getAttribute('data-step-label'), rms: await play(60, 400) }
  // Group and Global.
  await shiftPress('fx-focus-piano')
  effects.group = { focus: await page.locator('#fx-focus-piano').getAttribute('data-step-label'), ledA: await led('fx-focus-piano-a'), ledB: await led('fx-focus-piano-b') }
  await press('fx-reverb-on')
  await shiftPress('fx-reverb-on')
  effects.global = { led: await led('fx-reverb-global'), reverbOn: await page.locator('#fx-reverb-on').getAttribute('aria-pressed') }
  await press('fx-delay-on')
  await press('fx-mod2-on')
  effects.wet = { rms: await play(64, 400) }
  await page.waitForTimeout(200)
  await page.screenshot({ path: `${OUT_DIR}/stage2-effects-on.png` })
  // Master Level to zero: silence, with a note held.
  await keyDown(60)
  await page.waitForTimeout(200)
  const beforeMaster = await level()
  await page.locator('#perf-master-level').press('Home')
  await page.waitForTimeout(300)
  effects.master = { before: beforeMaster, atZero: await level(), value: await page.locator('#perf-master-level').getAttribute('aria-valuenow') }
  await page.locator('#perf-master-level').press('End')
  await keyUp(60)
  // All notes off drops the tails.
  await page.locator('#all-notes-off').click()
  await page.waitForTimeout(500)
  effects.afterPanic = { rms: await level(), voices: await text('[data-testid="voice-count"]') }
  step('effects', { effects })
  step('still one context', {
    contexts: await page.evaluate(() => window.__contexts.size),
    destinationConnections: await page.evaluate(() => window.__destinationConnections),
    state: await page.evaluate(() => [...window.__contexts][0].state),
    sampleRate: await page.evaluate(() => [...window.__contexts][0].sampleRate),
  })

  // ── Narrow viewport ─────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(BASE_URL)
  await page.waitForSelector('#instrument')
  await page.waitForTimeout(600)
  step('narrow', {
    overflowX: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    instrumentWidth: await page.evaluate(() => Math.round(document.querySelector('[data-instrument-frame]').getBoundingClientRect().width)),
  })
  await page.screenshot({ path: `${OUT_DIR}/stage2-narrow.png` })

  // ── Fallback: block the Upright samples ─────────────────────────────────────
  await page.setViewportSize({ width: 1440, height: 900 })
  // Everything above ran without a single console error or warning; record that before blocking requests.
  report.consoleMessagesBeforeFallbackStep = report.consoleMessages.reduce((sum, entry) => sum + entry.count, 0)
  report.pageErrorsBeforeFallbackStep = report.pageErrors.length
  await page.route('**/samples/upright/**', (route) => route.abort())
  await page.goto(BASE_URL)
  await page.waitForSelector('#instrument')
  await keyDown(60)
  await waitReady()
  await keyUp(60)
  await press('piano-type')
  await page.waitForFunction(() => document.querySelector('[data-testid="audio-status"]')?.textContent === 'Fallback', null, { timeout: 15000 })
  step('fallback', {
    audio: await status(),
    detail: await text('[data-status-kind="audio"] .chip__detail'),
    model: await oled('model'),
    source: await oled('source'),
    typeLed: await led('piano-type-upright'),
    rms: await play(60),
  })
  await press('piano-type')
  await waitReady()
  step('after fallback', { audio: await status(), model: await oled('model'), rms: await play(60) })
  await page.unroute('**/samples/upright/**')
  // The blocked requests above are the only console errors this pass is allowed to cause.
  report.expectedErrors = 'net::ERR_FAILED, once per samples/upright/* file (66), during the fallback step: those requests were blocked on purpose'

  // ── Geometry, read from the live DOM at both canonical viewports ───────────
  const measure = async (width, height) => {
    await page.setViewportSize({ width, height })
    await page.goto(BASE_URL)
    await page.waitForSelector('#instrument')
    await page.waitForTimeout(300)
    return page.evaluate(() => {
      const round = (n) => Math.round(n * 1000) / 1000
      const frame = document.querySelector('[data-instrument-frame]').getBoundingClientRect()
      const deck = document.querySelector('[data-region="deck"]').getBoundingClientRect()
      // The visual spec's displayElement rule: id, class, accessible name, or data attribute
      // containing "oled", "display", or "screen".
      const pattern = /oled|display|screen/i
      const displays = [...document.querySelectorAll('section[data-section] *')]
        .filter((e) =>
          [e.id, e.getAttribute('class') || '', e.getAttribute('aria-label') || '', ...[...e.attributes].filter((a) => a.name.startsWith('data-')).flatMap((a) => [a.name, a.value])].some((v) => pattern.test(v)),
        )
        .map((e) => e.id)
      return {
        viewport: [innerWidth, innerHeight],
        frame: [round(frame.left), round(frame.top), round(frame.width), round(frame.height)],
        widthFraction: round(frame.width / innerWidth),
        aspect: round(frame.width / frame.height),
        deckFraction: round(deck.height / frame.height),
        sections: [...document.querySelectorAll('section[data-section]')].map((s) => [s.dataset.section, round(s.getBoundingClientRect().width / frame.width)]),
        controls: document.querySelectorAll('[data-control-id]').length,
        functional: document.querySelectorAll('[data-decorative="false"]').length,
        keys: document.querySelectorAll('.key').length,
        displays,
        leds: document.querySelectorAll('.led[id]').length,
        litLeds: document.querySelectorAll('.led.is-lit').length,
        scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
        consoleHeight: round(document.querySelector('.console').getBoundingClientRect().height),
      }
    })
  }
  report.geometry = { desktop: await measure(1440, 900), narrow: await measure(390, 844) }
  report.browser = `Playwright Chromium ${page.context().browser().version()}`

  } catch (error) {
    // A failed step is part of the record, not a reason to lose it.
    report.error = String(error && error.stack ? error.stack : error)
    report.atFailure = { audio: await status().catch(() => null), oled: await text('#program-oled').catch(() => null) }
  }
  // The snippet has no file system access: its return value was saved as evidence/stage2-capture.json.
  return report
}
