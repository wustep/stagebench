/**
 * Stage 3 browser pass and captures.
 *
 * This is a Playwright snippet: a single async function that receives a `page`. It was run
 * through a Playwright session (Chromium) against `vite preview` of the production build:
 *
 *   pnpm build && pnpm exec vite preview --port 4337 --strictPort
 *
 * The parent capture harness named in the phase prompt is outside the workspace and was not
 * reachable; if it is run later it may add or overwrite files in evidence/.
 *
 * What it does, in a real browser with the real AudioWorklet and the real sample files:
 *   - loads factory programs with the Program buttons, Page buttons, dial, and list view, and
 *     measures the level leaving the audio node for a piano, an organ, and a synth program
 *     (through an AnalyserNode that the script taps onto the node's output; the app has none);
 *   - stores a program, checks the edited indicator, enters Live Mode, edits a Live slot, and
 *     reloads the page to see that both survived;
 *   - splits the keyboard, assigns zones, switches Layer Scenes, assigns and moves morphs;
 *   - plays every organ model and a waveform from every synth category;
 *   - holds notes and uses Panic;
 *   - records console messages and page errors, and takes the screenshots listed in
 *     IMPLEMENTATION_DETAILS.json.
 *
 * Output: evidence/stage3-desktop.png, stage3-organ-synth-on.png, stage3-narrow.png, and the
 * record of every step, evidence/stage3-browser-pass.json (summarised in evidence/stage3-capture.json).
 */
async (page) => {
  const BASE_URL = 'http://localhost:4337/'
  const OUT_DIR = '/Users/wustep/.stagebench/stagebench-cacd547e/work/claude-fable-5-2/stage3/candidate/evidence'
  const report = { version: 1, phase: 3, url: BASE_URL, capturedAt: new Date().toISOString(), steps: [], consoleMessages: [], pageErrors: [] }
  const step = (name, data) => report.steps.push({ name, ...data })

  page.on('console', (message) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return
    const known = report.consoleMessages.find((entry) => entry.type === message.type() && entry.text === message.text())
    if (known) known.count += 1
    else report.consoleMessages.push({ type: message.type(), text: message.text(), count: 1 })
  })
  page.on('pageerror', (error) => report.pageErrors.push(String(error)))
  await page.unrouteAll()

  // Tap the one audio node's output so the level that would reach the speakers can be measured.
  await page.addInitScript(() => {
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
      return Math.round(Math.sqrt(sum / data.length) * 1e5) / 1e5
    })
  const text = (selector) => page.locator(selector).first().textContent()
  const oled = (line) => text(`#program-oled [data-line="${line}"]`)
  const program = () => oled('program-name')
  const led = (slug) => page.locator(`#led-${slug}`).getAttribute('data-mode')
  const status = () => text('[data-testid="audio-status"]')
  const press = (id) => page.locator(`#${id}`).click({ timeout: 5000 })
  const shiftPress = async (id) => {
    await page.keyboard.down('Shift')
    await press(id)
    await page.keyboard.up('Shift')
  }
  /** Keyboard keys on a focused knob, fader, drawbar, or dial. */
  const turn = async (id, key, times = 1) => {
    await page.locator(`#${id}`).focus()
    for (let i = 0; i < times; i += 1) await page.keyboard.press(key)
  }
  const keyDown = (note) => page.locator(`#key-${note}`).dispatchEvent('pointerdown', { pointerId: 100 + note, pointerType: 'touch', bubbles: true })
  const keyUp = (note) => page.locator(`#key-${note}`).dispatchEvent('pointerup', { pointerId: 100 + note, pointerType: 'touch', bubbles: true })
  const play = async (note = 60, ms = 350) => {
    await keyDown(note)
    await page.waitForTimeout(ms)
    const rms = await level()
    await keyUp(note)
    await page.waitForTimeout(250)
    return rms
  }
  const waitReady = () => page.waitForFunction(() => document.querySelector('[data-testid="audio-status"]')?.textContent === 'Ready', null, { timeout: 15000 })
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('stage4.programs.v1') || 'null'))
  const voices = () => text('[data-testid="voice-count"]')

  try {
    // ── Desktop, untouched ────────────────────────────────────────────────────
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(BASE_URL)
    await page.evaluate(() => localStorage.clear())
    await page.goto(BASE_URL)
    await page.waitForSelector('#instrument')
    await page.waitForTimeout(800)
    step('load', { audio: await status(), program: await program(), model: await oled('model'), layers: await oled('layers'), synthOled: await text('#synth-oled') })
    await page.screenshot({ path: `${OUT_DIR}/stage3-desktop.png` })

    // ── First key press: worklet + samples ────────────────────────────────────
    await keyDown(60)
    await waitReady()
    await page.waitForTimeout(300)
    const first = await level()
    await keyUp(60)
    await page.waitForTimeout(300)
    step('first note', {
      audio: await status(),
      rms: first,
      contexts: await page.evaluate(() => window.__contexts.size),
      destinationConnections: await page.evaluate(() => window.__destinationConnections),
      foreignRequests: await page.evaluate(() => performance.getEntriesByType('resource').filter((entry) => !entry.name.startsWith(location.origin)).map((entry) => entry.name)),
    })

    // ── Programs: buttons, pages, dial, list ──────────────────────────────────
    const programs = []
    for (const button of [2, 3, 5, 7]) {
      await press(`program-${button}`)
      await page.waitForTimeout(500)
      await waitReady()
      programs.push({ program: await program(), layers: await oled('layers'), model: await oled('model'), source: await oled('source'), rms: await play(60, 450), led: await led(`program-${button}`) })
    }
    await press('page-next')
    await page.waitForTimeout(200)
    const paged = await program()
    await turn('program-dial', 'ArrowUp', 3)
    const dialled = await program()
    await page.locator('#program-dial').focus()
    await page.keyboard.down('Shift')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.up('Shift')
    const list = { mode: await page.locator('#program-oled').getAttribute('data-mode'), header: await program(), rows: await page.locator('#program-oled .px-row--pre').allTextContents() }
    await press('shift')
    step('programs', { programs, afterPageNext: paged, afterDial: dialled, list, modeAfterExit: await page.locator('#program-oled').getAttribute('data-mode') })

    // ── Store, the edited indicator, Live Mode, and a reload ──────────────────
    await press('program-1')
    await press('page-prev')
    await page.waitForTimeout(300)
    const clean = { program: await program(), edited: await page.locator('#program-oled [data-line="edited"]').count() }
    await press('fx-reverb-on')
    await turn('fx-reverb-mix', 'End')
    const dirty = { edited: await page.locator('#program-oled [data-line="edited"]').count(), chip: await text('[data-testid="program-edited"]') }
    await shiftPress('store')
    const naming = { mode: await page.locator('#program-oled').getAttribute('data-mode'), big: await oled('big') }
    await turn('program-dial', 'ArrowUp', 1)
    const renamed = await oled('big')
    await press('store')
    await press('page-next')
    await press('page-next')
    await press('program-4')
    const destination = { big: await oled('big'), storeLed: await led('store') }
    await press('store')
    const storedProgram = { program: await program(), notice: await oled('notice'), edited: await page.locator('#program-oled [data-line="edited"]').count(), keys: Object.keys((await stored()).programs) }
    await press('live-mode')
    await press('program-5')
    await page.waitForTimeout(300)
    const live = { program: await program(), led: await led('live-mode') }
    await press('piano-layer-b')
    await page.waitForTimeout(200)
    live.afterEdit = { layers: await oled('layers'), liveKeys: Object.keys((await stored()).live), chip: await text('[data-testid="program-edited"]') }
    await page.reload()
    await page.waitForSelector('#instrument')
    await page.waitForTimeout(500)
    const reloaded = { program: await program() }
    await press('live-mode')
    await press('program-5')
    reloaded.live5 = { program: await program(), layers: await oled('layers') }
    await press('live-mode')
    await press('page-prev')
    await press('program-4')
    reloaded.program44 = { program: await program(), reverbOn: await led('fx-reverb-on'), edited: await page.locator('#program-oled [data-line="edited"]').count() }
    step('store and live', { clean, dirty, naming, renamed, destination, storedProgram, live, reloaded })

    // ── Organ: every model, drawbars, rotary ──────────────────────────────────
    await press('page-next')
    await press('program-1')
    const backHome = await program()
    await keyDown(60)
    await waitReady()
    await keyUp(60)
    await press('piano-on')
    await press('organ-on')
    const organ = []
    for (let model = 0; model < 6; model += 1) {
      organ.push({ model: await page.locator('#organ-model').getAttribute('data-step-label'), display: await oled('model'), source: await oled('source'), rms: await play(60, 400) })
      await press('organ-model')
    }
    await turn('organ-drawbar-1', 'Home')
    const pushedIn = { lit: await page.locator('[data-graph-for="organ-drawbar-1"] .is-lit').count(), notice: await oled('notice') }
    await turn('organ-drawbar-1', 'End')
    await press('organ-perc-on')
    await press('rotary-source')
    await press('rotary-speed')
    const rotary = { on: await led('rotary-on'), fast: await led('rotary-speed-fast'), perc: await led('organ-perc-on'), rms: await play(60, 600) }
    step('organ', { startedFrom: backHome, models: organ, pushedIn, pulledOut: await page.locator('[data-graph-for="organ-drawbar-1"] .is-lit').count(), rotary })

    // ── Synth: a waveform from every category, filter, arpeggiator ────────────
    await press('organ-on')
    await press('synth-on')
    const synth = []
    for (const turns of [0, 5, 2, 2, 2]) {
      await turn('synth-osc-dial-1', 'ArrowUp', turns)
      synth.push({ oled: await text('#synth-oled [data-line="bar"]'), footer: await text('#synth-oled [data-line="footer"]'), layers: await oled('layers'), rms: await play(57, 400) })
    }
    await turn('synth-filter-freq', 'End')
    await press('synth-amp-envelope')
    const envelope = { page: await page.locator('#synth-oled').getAttribute('data-page'), curve: await page.locator('#synth-oled [data-curve]').count(), dials: await text('#synth-oled [data-line="dials"]') }
    await press('synth-arp-run')
    await keyDown(48)
    await keyDown(55)
    await keyDown(60)
    const arpLevels = []
    for (let i = 0; i < 6; i += 1) {
      await page.waitForTimeout(90)
      arpLevels.push(await level())
    }
    await keyUp(48)
    await keyUp(55)
    await keyUp(60)
    await press('synth-arp-run')
    step('synth', { waveforms: synth, envelope, arp: { levels: arpLevels, runLed: 'pressed twice' } })
    await page.screenshot({ path: `${OUT_DIR}/stage3-organ-synth-on.png` })

    // ── Split and zones ───────────────────────────────────────────────────────
    await press('piano-on')
    await press('split')
    await shiftPress('synth-octave-down')
    await press('piano-layer-a')
    await shiftPress('piano-octave-up')
    const split = {
      led: await led('split'),
      splitLeds: await page.locator('[data-split-led][data-lit="true"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-split-led'))),
      pianoZones: await Promise.all([1, 2, 3, 4].map((zone) => led(`piano-kb-zone-${zone}`))),
      synthZones: await Promise.all([1, 2, 3, 4].map((zone) => led(`synth-kb-zone-${zone}`))),
    }
    await keyDown(48)
    await page.waitForTimeout(150)
    split.lowKeyVoices = await voices()
    await keyUp(48)
    await shiftPress('split')
    split.page = { mode: await page.locator('#program-oled').getAttribute('data-mode'), rows: await page.locator('#program-oled .px-row--pre').allTextContents() }
    await press('program-1')
    await press('program-3')
    await turn('program-dial', 'ArrowUp', 1)
    split.crossfade = await page.locator('#program-oled .px-row--pre').first().textContent()
    await press('shift')
    step('split and zones', split)

    // ── Layer Scenes ──────────────────────────────────────────────────────────
    await press('layer-scene')
    const sceneTwo = { led: await led('layer-scene'), notice: await oled('notice'), organ: await led('organ-on'), piano: await led('piano-on'), synth: await led('synth-on') }
    await press('layer-scene')
    step('scenes', { sceneTwo, sceneOne: { led: await led('layer-scene'), organ: await led('organ-on'), piano: await led('piano-on'), synth: await led('synth-on') } })

    // ── Morphs: wheel and control pedal ───────────────────────────────────────
    await press('morph-wheel')
    const latched = await led('morph-wheel')
    await turn('synth-filter-freq', 'Home')
    await turn('synth-layer-a-level', 'Home')
    await press('morph-wheel')
    const morph = { latched, assigned: await led('morph-wheel'), freqLed: await led('synth-filter-freq-morph'), notice: await oled('notice') }
    morph.ladderAtRest = await page.locator('[data-ladder-for="synth-layer-a-level"]').getAttribute('data-lit')
    await turn('perf-mod-wheel', 'End')
    morph.ladderWheelUp = await page.locator('[data-ladder-for="synth-layer-a-level"]').getAttribute('data-lit')
    morph.faderStillAt = await page.locator('#synth-layer-a-level').getAttribute('aria-valuenow')
    morph.knobText = await page.locator('#synth-filter-freq').getAttribute('data-value-text')
    await turn('perf-mod-wheel', 'Home')
    await press('morph-control-pedal')
    await turn('piano-layer-a-level', 'Home')
    await press('morph-control-pedal')
    await page.locator('#control-pedal').fill('127')
    morph.pedalLadder = await page.locator('[data-ladder-for="piano-layer-a-level"]').getAttribute('data-lit')
    await page.locator('#control-pedal').fill('0')
    await shiftPress('morph-wheel')
    await shiftPress('morph-control-pedal')
    morph.cleared = { wheel: await led('morph-wheel'), pedal: await led('morph-control-pedal') }
    step('morphs', morph)

    // ── Master Clock and transpose ────────────────────────────────────────────
    await press('mst-clk')
    const clock = { mode: await page.locator('#program-oled').getAttribute('data-mode'), big: await oled('big') }
    await turn('program-dial', 'ArrowUp', 10)
    clock.afterDial = await oled('big')
    await press('shift')
    await press('transpose')
    await turn('program-dial', 'ArrowUp', 2)
    clock.transpose = { big: await oled('big'), led: await led('transpose') }
    await press('transpose')
    step('clock and transpose', clock)

    // ── Panic ─────────────────────────────────────────────────────────────────
    await press('split')
    await keyDown(50)
    await keyDown(64)
    await page.waitForTimeout(300)
    const before = { rms: await level(), voices: await voices(), held: await text('[data-testid="held-count"]') }
    await shiftPress('transpose')
    await page.waitForTimeout(600)
    step('panic', { before, after: { rms: await level(), voices: await voices(), held: await text('[data-testid="held-count"]'), notice: await oled('notice') } })

    step('still one context', {
      contexts: await page.evaluate(() => window.__contexts.size),
      destinationConnections: await page.evaluate(() => window.__destinationConnections),
      audio: await status(),
      unsupportedListed: await page.locator('[data-testid="unsupported-controls"] [data-unsupported]').count(),
    })

    // ── Narrow ────────────────────────────────────────────────────────────────
    const measure = async (width, height) => {
      await page.setViewportSize({ width, height })
      await page.evaluate(() => localStorage.clear())
      await page.goto(BASE_URL)
      await page.waitForSelector('#instrument')
      await page.waitForTimeout(300)
      return page.evaluate(() => {
        const round = (n) => Math.round(n * 1000) / 1000
        const frame = document.querySelector('[data-instrument-frame]').getBoundingClientRect()
        const deck = document.querySelector('[data-region="deck"]').getBoundingClientRect()
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
          decorative: document.querySelectorAll('[data-decorative="true"]').length,
          keys: document.querySelectorAll('.key').length,
          displays,
          leds: document.querySelectorAll('.led[id]').length,
          litLeds: document.querySelectorAll('.led.is-lit').length,
          scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
        }
      })
    }
    report.geometry = { narrow: await measure(390, 844) }
    await page.screenshot({ path: `${OUT_DIR}/stage3-narrow.png` })
    report.geometry.desktop = await measure(1440, 900)
    report.browser = `Playwright Chromium ${page.context().browser().version()}`
  } catch (error) {
    report.error = String(error && error.stack ? error.stack : error)
    report.atFailure = { audio: await status().catch(() => null), oled: await text('#program-oled').catch(() => null) }
  }
  // Save the record beside the screenshots when the session can reach the file system;
  // otherwise it is returned and saved by hand.
  try {
    const fs = await import('node:fs')
    fs.writeFileSync(`${OUT_DIR}/stage3-browser-pass.json`, `${JSON.stringify(report, null, 2)}\n`)
    return { saved: 'evidence/stage3-browser-pass.json', steps: report.steps.map((entry) => entry.name), error: report.error ?? null, consoleMessages: report.consoleMessages, pageErrors: report.pageErrors }
  } catch {
    return report
  }
}
