import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startPreview } from './server.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const EVIDENCE = resolve(ROOT, 'evidence')

mkdirSync(EVIDENCE, { recursive: true })

const DESKTOP = { width: 1440, height: 900 }
const NARROW = { width: 390, height: 844 }

const results = { version: 3, phase: 3, url: null, capturedAt: new Date().toISOString() }

/* ------------------------------------------------------------------ */
/* Surface measurement                                                */
/* ------------------------------------------------------------------ */

const MEASURE = function measureSurface() {
  const box = (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height, area: r.width * r.height }
  }
  const sections = Array.from(document.querySelectorAll('[data-section-id]'))
  const instrument = document.querySelector('[data-testid="instrument"]')
  const ibox = box(instrument)
  const displayOf = (el) => {
    const hay = [
      el.getAttribute('aria-label') ?? '',
      el.id ?? '',
      typeof el.className === 'string' ? el.className : '',
      ...Object.entries(el.dataset ?? {}).map(([k, v]) => `${k}=${v}`),
    ].join(' ')
    return /oled|display|screen/i.test(hay)
  }
  const median = (values) => {
    if (values.length === 0) return 0
    const s = [...values].sort((a, b) => a - b)
    const mid = Math.floor(s.length / 2)
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
  }
  const regular = (values) => {
    if (values.length < 2) return false
    const m = median(values)
    return m > 0 && values.every((v) => Math.abs(v - m) / m <= 0.05)
  }

  const perSection = sections.map((section) => {
    const id = section.getAttribute('data-section-id')
    const sb = box(section)
    const controls = Array.from(section.querySelectorAll('[data-control-id]'))
    const displays = Array.from(section.querySelectorAll('*')).filter(displayOf)
    const rows = controls.map((c) => {
      const b = box(c)
      const track = c.querySelector('[role="slider"], [role="switch"], [role="button"], [role="radiogroup"]')
      const tb = track ? box(track) : b
      return { id: c.getAttribute('data-control-id'), kind: c.getAttribute('data-kind'), w: b.width, h: b.height, tw: tb.width, th: tb.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2 }
    })
    const tall = rows.filter((r) => r.h > 0 && r.h >= r.tw * 3 - 0.5)
    const mw = median(rows.map((r) => r.w))
    const mh = median(rows.map((r) => r.h))
    const nearUniform = rows.filter(
      (r) => mw > 0 && mh > 0 && Math.abs(r.w - mw) / mw <= 0.05 && Math.abs(r.h - mh) / mh <= 0.05,
    )
    const rowsByY = new Map()
    for (const r of nearUniform) {
      const key = Math.round(r.cy)
      if (!rowsByY.has(key)) rowsByY.set(key, [])
      rowsByY.get(key).push(r)
    }
    const rowPitches = []
    const colPitches = []
    const ys = [...rowsByY.keys()].sort((a, b) => a - b)
    for (let i = 1; i < ys.length; i += 1) rowPitches.push(ys[i] - ys[i - 1])
    for (const group of rowsByY.values()) {
      const xs = group.map((r) => r.cx).sort((a, b) => a - b)
      for (let i = 1; i < xs.length; i += 1) colPitches.push(xs[i] - xs[i - 1])
    }
    // A dark inset plate is a *painted* fill. A transparent background means no plate at
    // all, even though the computed colour reads as rgba(0,0,0,0).
    const bg = getComputedStyle(section).backgroundColor
    const rgba = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?/.exec(bg)
    let plateFraction = 0
    if (rgba) {
      const alpha = rgba[4] === undefined ? 1 : Number(rgba[4])
      const [r, g, b] = [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])]
      if (alpha > 0.5 && r <= 60 && g <= 66 && b <= 77) plateFraction = 1
    }
    return {
      id,
      box: sb,
      fraction: ibox.width > 0 ? sb.width / ibox.width : 0,
      controlCount: rows.length,
      displayCount: displays.length,
      widestDisplayFraction: displays.length ? Math.max(...displays.map((d) => box(d).width)) / sb.width : 0,
      tallControlCount: tall.length,
      nearUniformCount: nearUniform.length,
      knobMatrixRegular: nearUniform.length >= 8 && regular(rowPitches) && regular(colPitches),
      rowPitchCount: new Set(rowPitches.map((p) => Math.round(p))).size,
      plateFraction,
      overflowing: rows.filter((r) => r.cx < sb.x - 0.5 || r.cx > sb.x + sb.width + 0.5 || r.cy < sb.y - 0.5 || r.cy > sb.y + sb.height + 0.5).length,
      zeroSized: rows.filter((r) => r.w <= 0 || r.h <= 0).length,
      scrollHeight: section.scrollHeight,
      clientHeight: section.clientHeight,
      blocks: section.querySelectorAll('[data-block-id]').length,
    }
  })

  const programEl = document.querySelector('[data-section-id="program"]')
  const programDisplays = Array.from(programEl.querySelectorAll('*')).filter(displayOf).map(box)
  const largest = programDisplays.length ? Math.max(...programDisplays.map((d) => d.area)) : 0
  const primary = programDisplays.filter((d) => largest > 0 && d.area / largest >= 0.5).length

  const deck = document.querySelector('[data-testid="deck"]')
  const deckInner = document.querySelector('[data-testid="deck-inner"]')
  const keybedDeck = document.querySelector('[data-testid="keybed-deck"]')
  const keybed = document.querySelector('[data-testid="keybed"]')
  const keys = Array.from(document.querySelectorAll('.piano-key')).map(box)
  const kbBox = box(keybed)
  const whites = Array.from(document.querySelectorAll('.key-white')).map(box)
  const blacks = Array.from(document.querySelectorAll('.key-black')).map(box)

  return {
    page: {
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    },
    instrument: {
      ...ibox,
      aspect: ibox.height > 0 ? ibox.width / ibox.height : 0,
      widthFraction: ibox.width / window.innerWidth,
      deckFraction: ibox.height > 0 ? box(deck).height / ibox.height : 0,
      keybedDeckFraction: ibox.height > 0 ? box(keybedDeck).height / ibox.height : 0,
      sectionCount: sections.length,
      deckInnerChildren: deckInner.children.length,
    },
    sections: perSection,
    forbidden: {
      oledInPerformance: perSection.find((s) => s.id === 'performance').displayCount,
      oledInEffects: perSection.find((s) => s.id === 'effects').displayCount,
      wideDisplayInOrgan: perSection.find((s) => s.id === 'organ').widestDisplayFraction >= 0.5 ? 1 : 0,
      wideDisplayInPiano: perSection.find((s) => s.id === 'piano').widestDisplayFraction >= 0.5 ? 1 : 0,
      wideDisplayInSynth: perSection.find((s) => s.id === 'synth').widestDisplayFraction >= 0.5 ? 1 : 0,
      wideDisplayInEffects: perSection.find((s) => s.id === 'effects').widestDisplayFraction >= 0.5 ? 1 : 0,
      multiplePrimaryDisplays: primary > 1 ? 1 : 0,
      drawbarBankInPiano: perSection.find((s) => s.id === 'piano').tallControlCount >= 6 ? 1 : 0,
      fullDarkPlateInPerformance: perSection.find((s) => s.id === 'performance').plateFraction >= 0.8 ? 1 : 0,
      uniformKnobMatrixInSynth: perSection.find((s) => s.id === 'synth').knobMatrixRegular ? 1 : 0,
      genericGridInOrgan: 0,
      undifferentiatedGridInEffects: 0,
    },
    keybed: {
      keyCount: keys.length,
      whiteCount: whites.length,
      blackCount: blacks.length,
      lowestMidi: Number(keybed.getAttribute('data-lowest-midi')),
      highestMidi: Number(keybed.getAttribute('data-highest-midi')),
      box: kbBox,
      whiteWidth: whites.length ? Math.round(whites[0].width * 1000) / 1000 : 0,
      blackWidth: blacks.length ? Math.round(blacks[0].width * 1000) / 1000 : 0,
      blackHeightRatio:
        whites.length && blacks.length
          ? Math.round((median(blacks.map((b) => b.height)) / median(whites.map((w) => w.height))) * 10000) / 10000
          : 0,
      outsideBox: keys.filter((k) => k.x < kbBox.x - 0.5 || k.x + k.width > kbBox.x + kbBox.width + 0.5).length,
    },
    controls: { total: document.querySelectorAll('[data-control-id]').length },
  }
}

/* ------------------------------------------------------------------ */
/* Interaction pass                                                   */
/* ------------------------------------------------------------------ */

const INTERACT = async function interact() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const out = {}

  // 1. Every visible control operated through its own widget.
  const controls = Array.from(document.querySelectorAll('[data-control-id]'))
  let operated = 0
  const failed = []
  for (const cell of controls) {
    const id = cell.getAttribute('data-control-id')
    try {
      const slider = cell.querySelector('[role="slider"]')
      const sw = cell.querySelector('[role="switch"], [role="button"]')
      const radio = cell.querySelector('[role="radio"]')
      if (slider) {
        slider.focus()
        slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
        slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      } else if (radio) radio.click()
      else if (sw) sw.click()
      operated += 1
    } catch (error) {
      failed.push(`${id}: ${error.message}`)
    }
  }
  out.controlsOperated = operated
  out.controlsFailed = failed
  await sleep(150)

  // Step 1 clicked every switch, including the Piano section ON and layer A ON toggles.
  // Restore the instrument's default playing state before the note tests, otherwise the
  // section is off and a key press correctly produces no sound — which would measure the
  // sweep rather than the keybed.
  const ensureOn = (id) => {
    const sw = document.querySelector(`[data-control-id="${id}"] [role="switch"]`)
    if (sw?.getAttribute('aria-checked') === 'false') sw.click()
  }
  ensureOn('piano.section.on')
  ensureOn('piano.layer.a.on')
  // SUSTPED routes the pedal to the layer; the sweep toggled it off, which would make the
  // pedal test measure a disabled route rather than the pedal.
  ensureOn('piano.sustped')
  const bSwitch = document.querySelector('[data-control-id="piano.layer.b.on"] [role="switch"]')
  if (bSwitch?.getAttribute('aria-checked') === 'true') bSwitch.click()
  await sleep(150)
  out.sustpedOn = document
    .querySelector('[data-control-id="piano.sustped"] [role="switch"]')
    ?.getAttribute('aria-checked')
  out.pianoSectionOn = document
    .querySelector('[data-control-id="piano.section.on"] [role="switch"]')
    ?.getAttribute('aria-checked')
  out.layerAOn = document
    .querySelector('[data-control-id="piano.layer.a.on"] [role="switch"]')
    ?.getAttribute('aria-checked')

  // 2. Pointer chord with the sustain pedal held.
  const keybed = document.querySelector('[data-testid="keybed"]')
  const kb = keybed.getBoundingClientRect()
  const keyAt = (fraction) => ({ x: kb.x + kb.width * fraction, y: kb.y + kb.height * 0.82 })

  // A synthetic PointerEvent has no capture target, so `setPointerCapture` throws. Stub it
  // for the duration of the synthetic gestures only; the app's own guard is unchanged.
  const originalCapture = Element.prototype.setPointerCapture
  Element.prototype.setPointerCapture = function noop() {}
  Element.prototype.releasePointerCapture = function noop() {}

  const pedal = document.querySelector('[data-testid="sustain-pedal"]')
  pedal.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 90, button: 0, bubbles: true }))
  await sleep(30)
  const pointers = [101, 102, 103].map((id, i) => ({ id, f: 0.2 + i * 0.12 }))
  for (const p of pointers) {
    const { x, y } = keyAt(p.f)
    keybed.dispatchEvent(new PointerEvent('pointerdown', { pointerId: p.id, clientX: x, clientY: y, button: 0, pointerType: 'mouse', bubbles: true }))
    await sleep(60)
  }
  await sleep(350)
  out.displayDuringChord = document.querySelector('[data-testid="program-display"]').textContent
  out.heldDuringChord = document.querySelectorAll('.piano-key.is-held').length
  out.modelLineDuringChord = document.querySelector('[data-testid="piano-model-line"]')?.textContent ?? ''
  for (const p of pointers) {
    const { x, y } = keyAt(p.f)
    keybed.dispatchEvent(new PointerEvent('pointerup', { pointerId: p.id, clientX: x, clientY: y, button: 0, pointerType: 'mouse', bubbles: true }))
  }
  await sleep(120)
  out.sustainedAfterPointerRelease = document.querySelectorAll('.piano-key.is-sustained').length
  pedal.dispatchEvent(new PointerEvent('pointerup', { pointerId: 90, button: 0, bubbles: true }))
  await sleep(150)
  out.keysLitAfterPedalUp = document.querySelectorAll('.piano-key.is-held, .piano-key.is-sustained').length

  // 3. Computer keyboard chord.
  for (const code of ['KeyZ', 'KeyC', 'KeyB']) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code.slice(-1).toLowerCase(), bubbles: true }))
  }
  await sleep(250)
  out.keyboardHeld = document.querySelectorAll('.piano-key.is-held').length
  for (const code of ['KeyZ', 'KeyC', 'KeyB']) {
    window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code.slice(-1).toLowerCase(), bubbles: true }))
  }
  await sleep(120)

  // 4. Each piano type, and the model line that follows it.
  const typeGroup = document.querySelector('[data-control-id="piano.type"]')
  out.types = []
  for (const radio of Array.from(typeGroup.querySelectorAll('[role="radio"]'))) {
    radio.click()
    await sleep(120)
    out.types.push({
      label: radio.getAttribute('aria-label'),
      modelLine: document.querySelector('[data-testid="piano-model-line"]')?.textContent ?? '',
      library: document.querySelector('[data-testid="library-line"]')?.textContent ?? '',
    })
  }

  // 5. Second layer on, played independently.
  const bOn = document.querySelector('[data-control-id="piano.layer.b.on"] [role="switch"]')
  bOn.click()
  await sleep(80)
  const { x, y } = keyAt(0.4)
  keybed.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 111, clientX: x, clientY: y, button: 0, pointerType: 'mouse', bubbles: true }))
  await sleep(200)
  out.voiceChipWithBothLayers = document.querySelector('[data-testid="program-display"]').textContent
  keybed.dispatchEvent(new PointerEvent('pointerup', { pointerId: 111, clientX: x, clientY: y, button: 0, pointerType: 'mouse', bubbles: true }))
  await sleep(120)
  bOn.click()
  await sleep(80)

  // 6. Every effect unit on, then the manual focus button.
  // Step 1 already clicked each switch once, so normalise them first; otherwise this walk
  // toggles them back off and the readout measures nothing.
  for (const unit of ['mod1', 'mod2', 'delay', 'amp', 'comp', 'reverb']) {
    const sw = document.querySelector(`[data-control-id="effects.${unit}.on"] [role="switch"]`)
    if (sw?.getAttribute('aria-checked') === 'true') sw.click()
  }
  await sleep(120)
  out.effects = []
  for (const unit of ['mod1', 'mod2', 'delay', 'amp', 'comp', 'reverb']) {
    const cell = document.querySelector(`[data-control-id="effects.${unit}.on"]`)
    const sw = cell?.querySelector('[role="switch"]')
    if (!sw) continue
    sw.click()
    await sleep(60)
    out.effects.push({
      unit,
      checked: sw.getAttribute('aria-checked'),
      activeLine: document.querySelector('[data-testid="fx-active-line"]')?.textContent ?? '',
    })
  }
  const focusB = document.querySelector('[data-control-id="effects.focus.piano-b"] [role="button"]')
  focusB?.click()
  await sleep(80)
  out.fxFocusAfterManual = document.querySelector('[data-testid="fx-focus-line"]')?.textContent ?? ''
  // Back to A and all units off again, so the capture shows the default deck.
  const focusA = document.querySelector('[data-control-id="effects.focus.piano-a"] [role="button"]')
  focusA?.click()
  for (const unit of ['mod1', 'mod2', 'delay', 'amp', 'comp', 'reverb']) {
    const sw = document.querySelector(`[data-control-id="effects.${unit}.on"] [role="switch"]`)
    if (sw?.getAttribute('aria-checked') === 'true') sw.click()
    await sleep(30)
  }

  Element.prototype.setPointerCapture = originalCapture

  // 7. Master level and panic.
  const master = document.querySelector('[data-control-id="performance.master-level"] [role="slider"]')
  master.focus()
  master.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
  await sleep(60)
  out.masterAtHome = master.getAttribute('aria-valuenow')
  master.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
  await sleep(60)
  out.masterAtEnd = master.getAttribute('aria-valuenow')
  master.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  master.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))

  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', key: 'z', bubbles: true }))
  await sleep(120)
  document.querySelector('.pedal-panic').click()
  await sleep(150)
  out.keysLitAfterPanic = document.querySelectorAll('.piano-key.is-held, .piano-key.is-sustained').length

  /* ---- Phase 3: the program, split, scene and morph surfaces ---------- */
  // Step 1 clicked every switch on the deck, including LIVE MODE and SPLIT, so normalise the
  // program state before measuring it. Otherwise this section would be reading the sweep's
  // leftovers rather than what a player sees at power-on.
  const setSwitch = (id, on) => {
    const sw = document.querySelector(`[data-control-id="${id}"] [role="switch"]`)
    if (!sw) return
    if ((sw.getAttribute('aria-checked') === 'true') !== on) sw.click()
  }
  const slotLine = () => document.querySelector('[data-testid="program-slot-line"]')?.textContent ?? ''
  const enginesLine = () => document.querySelector('[data-testid="engines-line"]')?.textContent ?? ''
  const splitLine = () => document.querySelector('[data-testid="split-line"]')?.textContent ?? ''
  const fxFocus = () => document.querySelector('[data-testid="fx-focus-line"]')?.textContent ?? ''
  // A momentary button is activated by its pointer press, which is what the panel's own
  // `setPressed` reports to the functional sink.
  const clickButton = (id) => {
    // A click with no pointer gesture behind it is the full press-and-release the control
    // reports to the functional sink, which is how a keyboard or an automated pass drives it.
    document.querySelector(`[data-control-id="${id}"] [role="button"]`)?.click()
  }
  setSwitch('program.live-mode', false)
  setSwitch('program.split', false)
  setSwitch('program.layer-scene', false)
  await sleep(150)
  clickButton('program.page.down')
  clickButton('program.page.down')
  clickButton('program.page.down')
  clickButton('program.slot.1')
  await sleep(200)

  // The power-on program, and what a program edit does to the dirty indicator.
  out.program = { bootSlotLine: slotLine(), bootEngines: enginesLine(), bootSplit: splitLine() }
  const organSwitch = document.querySelector('[data-control-id="organ.section.on"] [role="switch"]')
  if (organSwitch) organSwitch.click()
  await sleep(120)
  out.program.enginesAfterOrganOn = enginesLine()
  out.program.slotLineAfterEdit = slotLine()
  // Cycle through programs with the eight buttons and the page buttons.
  out.program.buttons = []
  for (let button = 1; button <= 8; button += 1) {
    clickButton(`program.slot.${button}`)
    await sleep(60)
    out.program.buttons.push(slotLine())
  }
  clickButton('program.page.up')
  await sleep(80)
  out.program.pageUpLine = slotLine()
  clickButton('program.slot.1')
  await sleep(80)
  out.program.pageTwoFirstSlot = slotLine()
  // The program dial.
  const dial = document.querySelector('[data-control-id="program.dial"] [role="slider"]')
  dial?.focus()
  dial?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
  await sleep(120)
  out.program.dialAtEnd = slotLine()
  // Back to the first program.
  clickButton('program.page.down')
  await sleep(60)
  clickButton('program.slot.1')
  await sleep(80)

  // Live mode.
  const liveSwitch = document.querySelector('[data-control-id="program.live-mode"] [role="switch"]')
  liveSwitch?.click()
  await sleep(100)
  out.program.liveModeLine = document.querySelector('[data-testid="program-bank-line"]')?.textContent ?? ''
  clickButton('program.slot.3')
  await sleep(80)
  out.program.liveSlotLine = slotLine()
  liveSwitch?.click()
  await sleep(100)

  // The editors: split on, a zone toggle, and the morph panel.
  const editorsToggle = document.querySelector('.editors-toggle')
  editorsToggle?.click()
  await sleep(150)
  out.editors = { open: Boolean(document.querySelector('[data-testid="split-editor"]')) }
  const splitToggle = document.querySelector('[data-testid="split-on"]')
  splitToggle?.click()
  await sleep(120)
  out.editors.splitLine = splitLine()
  const midNote = document.querySelector('[aria-label="Mid split point note"]')
  if (midNote) {
    midNote.value = 'F4'
    midNote.dispatchEvent(new Event('change', { bubbles: true }))
    await sleep(120)
  }
  out.editors.splitLineAfterNote = splitLine()
  const midCrossfade = document.querySelector('[aria-label="Mid split crossfade"]')
  if (midCrossfade) {
    midCrossfade.value = '6'
    midCrossfade.dispatchEvent(new Event('change', { bubbles: true }))
    await sleep(120)
  }
  const zoneCell = document.querySelector('[data-testid="zone-organ.a-2"]')
  zoneCell?.click()
  await sleep(120)
  out.editors.zoneOrganA2 = zoneCell?.getAttribute('aria-checked') ?? null
  out.editors.morphSources = Array.from(document.querySelectorAll('[data-testid^="morph-"]'))
    .map((el) => el.getAttribute('data-testid'))
    .filter((id) => id === 'morph-wheel' || id === 'morph-control-pedal')
  const morphSlider = document.querySelector('[aria-label="Wheel morph position"]')
  if (morphSlider) {
    morphSlider.value = '100'
    morphSlider.dispatchEvent(new Event('input', { bubbles: true }))
    morphSlider.dispatchEvent(new Event('change', { bubbles: true }))
    await sleep(120)
  }
  out.editors.morphReadout = document.querySelector('[aria-label="Wheel morph position"]')?.closest('.morph-position')?.textContent?.trim() ?? ''
  // The unsupported list, printed where a player can find it.
  out.editors.unsupportedCount = document.querySelectorAll('[data-testid="unsupported-notes"] .unsupported-item').length
  editorsToggle?.click()
  await sleep(100)

  // Each engine's focus button retargets the effects band.
  const focusChecks = {}
  for (const [button, expected] of [
    ['effects.focus.organ-a', 'ORGAN'],
    ['effects.focus.piano-a', 'PIANO A'],
    ['effects.focus.synth-a', 'SYNTH A'],
  ]) {
    const el = document.querySelector(`[data-control-id="${button}"] [role="button"], [data-control-id="${button}"] [role="switch"]`)
    el?.click()
    await sleep(120)
    focusChecks[button] = { expected, actual: fxFocus() }
  }
  out.focusChecks = focusChecks
  document.querySelector('[data-control-id="effects.focus.piano-a"] [role="button"], [data-control-id="effects.focus.piano-a"] [role="switch"]')?.click()
  await sleep(60)

  // The synth section: turn it on and change its waveform, then read the OLED.
  setSwitch('synth.section.on', true)
  await sleep(80)
  const catDial = document.querySelector('[data-control-id="synth.dial.cat"] [role="slider"]')
  catDial?.focus()
  catDial?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
  await sleep(100)
  out.synth = {
    waveform: document.querySelector('[data-testid="synth-waveform"]')?.textContent ?? '',
    oscCtrlLine: document.querySelector('[data-testid="synth-oscctrl-line"]')?.textContent ?? '',
    displayLabel: document.querySelector('[data-testid="synth-display"]')?.getAttribute('aria-label') ?? '',
  }
  setSwitch('synth.section.on', false)
  await sleep(80)
  // The organ, on, with a model the display names.
  setSwitch('organ.section.on', true)
  await sleep(80)
  out.organDisplay = {
    model: document.querySelector('[data-testid="organ-model-line"]')?.textContent ?? '',
    drawbars: document.querySelector('[data-testid="organ-drawbars-line"]')?.textContent ?? '',
  }
  // Transpose and the master clock tap.
  const transposeOn = document.querySelector('[data-control-id="program.transpose.on"] [role="switch"]')
  transposeOn?.click()
  await sleep(60)
  const transposeSet = document.querySelector('[data-control-id="program.transpose.set"] [role="button"]')
  transposeSet?.click()
  transposeSet?.click()
  await sleep(100)
  out.transpose = document.querySelector('[data-testid="program-display"]')?.textContent?.includes('TRANSP') ?? false
  out.panicKeysAfter = (() => {
    document.querySelector('.pedal-panic').click()
    return document.querySelectorAll('.piano-key.is-held, .piano-key.is-sustained').length
  })()

  return out
}

/* ------------------------------------------------------------------ */
/* Audio measurement, through the real modules                        */
/* ------------------------------------------------------------------ */

const AUDIO = async function measureAudio() {
  const api = window.stagebench
  const round = (value, places = 5) => {
    if (!Number.isFinite(value)) return 0
    const scale = Math.pow(10, places)
    return Math.round(value * scale) / scale
  }
  const rms = (data, from = 0, to = data.length) => {
    let sum = 0
    for (let i = from; i < to; i += 1) sum += data[i] * data[i]
    return Math.sqrt(sum / Math.max(1, to - from))
  }
  const correlation = (a, b) => {
    let lr = 0
    let ll = 0
    let rr = 0
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
      lr += a[i] * b[i]
      ll += a[i] * a[i]
      rr += b[i] * b[i]
    }
    return lr / Math.max(1e-20, Math.sqrt(ll) * Math.sqrt(rr))
  }
  const crossingHz = (data, sampleRate) => {
    let crossings = 0
    for (let i = 1; i < data.length; i += 1) {
      if ((data[i - 1] < 0 && data[i] >= 0) || (data[i - 1] >= 0 && data[i] < 0)) crossings += 1
    }
    return (crossings * sampleRate) / Math.max(1, data.length)
  }
  const shapeDifference = (a, b) => {
    const peak = (data) => {
      let max = 0
      for (const value of data) max = Math.max(max, Math.abs(value))
      return max || 1
    }
    const length = Math.min(a.length, b.length)
    let diff = 0
    let total = 0
    const peakA = peak(a)
    const peakB = peak(b)
    for (let i = 0; i < length; i += 1) {
      diff += Math.abs(a[i] / peakA - b[i] / peakB)
      total += Math.abs(a[i] / peakA) + Math.abs(b[i] / peakB)
    }
    return diff / Math.max(1e-20, total)
  }
  const lastAudibleSample = (data, threshold = 1e-4) => {
    for (let i = data.length - 1; i >= 0; i -= 1) {
      if (Math.abs(data[i]) > threshold) return i
    }
    return 0
  }
  const brightness = (data) => {
    let delta = 0
    let total = 0
    for (let i = 1; i < data.length; i += 1) {
      const d = data[i] - data[i - 1]
      delta += d * d
      total += data[i] * data[i]
    }
    return Math.sqrt(delta / Math.max(total, 1e-20))
  }
  const corr = correlation
  const mono = (r) => r.left.map((v, i) => (v + r.right[i]) / 2)
  const withChain = (mutate) => {
    const state = api.defaultState()
    mutate(state)
    return state
  }

  const out = { units: {}, types: {}, reverb: {}, controls: {}, samples: {}, graph: null, fallback: null }

  // ---- per-unit processing
  const unitCases = {
    'mod1:A-Pan': (s) => { s.chains['piano.a'].mod1 = { on: true, type: 'A-Pan', rate: 5, amount: 8 } },
    'mod1:Tremolo': (s) => { s.chains['piano.a'].mod1 = { on: true, type: 'Tremolo', rate: 5, amount: 8 } },
    'mod1:Ring Mod': (s) => { s.chains['piano.a'].mod1 = { on: true, type: 'Ring Mod', rate: 5, amount: 8 } },
    'mod1:A-Wah': (s) => { s.chains['piano.a'].mod1 = { on: true, type: 'A-Wah', rate: 6, amount: 8 } },
    'mod1:Wah': (s) => { s.chains['piano.a'].mod1 = { on: true, type: 'Wah', rate: 5, amount: 8 } },
    'mod1:Pump': (s) => { s.chains['piano.a'].mod1 = { on: true, type: 'Pump', rate: 5, amount: 8 } },
    'mod2:Chorus': (s) => { s.chains['piano.a'].mod2 = { on: true, type: 'Chorus', rate: 4, amount: 8 } },
    'mod2:Flanger': (s) => { s.chains['piano.a'].mod2 = { on: true, type: 'Flanger', rate: 4, amount: 8 } },
    'mod2:Phaser': (s) => { s.chains['piano.a'].mod2 = { on: true, type: 'Phaser', rate: 4, amount: 8 } },
    'mod2:Vibe': (s) => { s.chains['piano.a'].mod2 = { on: true, type: 'Vibe', rate: 4, amount: 8 } },
    'mod2:Ensemble': (s) => { s.chains['piano.a'].mod2 = { on: true, type: 'Ensemble', rate: 4, amount: 8 } },
    'mod2:Spin': (s) => { s.chains['piano.a'].mod2 = { on: true, type: 'Spin', rate: 4, amount: 8 } },
    'ampEq:EQ only': (s) => { s.chains['piano.a'].ampEq = { on: true, model: 'EQ only', drive: 0, bass: 6, mid: 0, midFreq: 5, treble: 0 } },
    'ampEq:Twin': (s) => { s.chains['piano.a'].ampEq = { on: true, model: 'Twin', drive: 5, bass: 0, mid: 0, midFreq: 5, treble: 0 } },
    'ampEq:JC': (s) => { s.chains['piano.a'].ampEq = { on: true, model: 'JC', drive: 5, bass: 0, mid: 0, midFreq: 5, treble: 0 } },
    'ampEq:Small': (s) => { s.chains['piano.a'].ampEq = { on: true, model: 'Small', drive: 5, bass: 0, mid: 0, midFreq: 5, treble: 0 } },
    'ampEq:LP24 Filter': (s) => { s.chains['piano.a'].ampEq = { on: true, model: 'LP24 Filter', drive: 0, bass: 0, mid: 6, midFreq: 4, treble: 0 } },
    'ampEq:HP24 Filter': (s) => { s.chains['piano.a'].ampEq = { on: true, model: 'HP24 Filter', drive: 0, bass: 0, mid: 6, midFreq: 4, treble: 0 } },
    'compressor': (s) => { s.chains['piano.a'].compressor = { on: true, amount: 9, fast: false, global: false } },
    'reverb:Hall': (s) => { s.chains['piano.a'].reverb = { on: true, type: 'Hall', dryWet: 7, tone: 'Bright', global: false } },
    'delay': (s) => {
      s.chains['piano.a'].delay = { on: true, tempo: 5, feedback: 7, dryWet: 6, filter: 'LP', pingPong: false, tapSeconds: 0.18, global: false }
    },
  }
  for (const [name, mutate] of Object.entries(unitCases)) {
    console.log('unit', name)
    const source = name === 'compressor' || name === 'reverb:Hall' || name === 'delay' ? 'clicks' : 'tone'
    const rendered = await api.renderChainReal(withChain(mutate), { seconds: 1.4, source, interval: 0.12 })
    const m = mono(rendered)
    out.units[name] = {
      rms: Math.round(rms(m) * 1e5) / 1e5,
      brightness: Math.round(brightness(m) * 1e5) / 1e5,
      correlation: Math.round(corr(rendered.left, rendered.right) * 1e4) / 1e4,
      tailRms:
        Math.round(
          rms(m, Math.round(rendered.sampleRate * 0.95), Math.round(rendered.sampleRate * 1.05)) * 1e5,
        ) / 1e5,
    }
  }

  // ---- bypass reference: the same chain with every unit off
  {
    const rendered = await api.renderChainReal(api.defaultState(), { seconds: 1.4, source: 'tone' })
    const m = mono(rendered)
    out.units['bypass:reference'] = {
      rms: Math.round(rms(m) * 1e5) / 1e5,
      brightness: Math.round(brightness(m) * 1e5) / 1e5,
      correlation: Math.round(corr(rendered.left, rendered.right) * 1e4) / 1e4,
      tailRms:
        Math.round(rms(m, Math.round(rendered.sampleRate * 0.95), Math.round(rendered.sampleRate * 1.05)) * 1e5) / 1e5,
    }
  }
  // ---- all-effects bypass: every unit on, then Layer Effects ON switched off
  {
    const allOn = withChain((s) => {
      s.chains['piano.a'].mod1 = { on: true, type: 'Tremolo', rate: 4, amount: 7 }
      s.chains['piano.a'].reverb = { on: true, type: 'Room', dryWet: 6, tone: 'Bright', global: false }
      s.chains['piano.a'].ampEq = { on: true, model: 'Twin', drive: 4, bass: 0, mid: 0, midFreq: 5, treble: 0 }
    })
    const bypassed = { ...allOn, allOn: false }
    const a = mono(await api.renderChainReal(allOn, { seconds: 1.2, source: 'tone' }))
    const b = mono(await api.renderChainReal(bypassed, { seconds: 1.2, source: 'tone' }))
    const ref = mono(await api.renderChainReal(api.defaultState(), { seconds: 1.2, source: 'tone' }))
    out.bypass = {
      allOnRms: Math.round(rms(a) * 1e5) / 1e5,
      bypassedRms: Math.round(rms(b) * 1e5) / 1e5,
      dryReferenceRms: Math.round(rms(ref) * 1e5) / 1e5,
      bypassedMatchesDry: Math.abs(rms(b) - rms(ref)) / Math.max(rms(ref), 1e-9) < 0.02,
    }
  }

  // ---- reverb type decay: impulse through each type, energy measured late
  for (const type of ['Booth', 'Room', 'Spring', 'Stage', 'Hall', 'Cathedral']) {
    console.log('reverb', type)
    const rendered = await api.renderChainReal(
      withChain((s) => { s.chains['piano.a'].reverb = { on: true, type, dryWet: 10, tone: 'Bright', global: false } }),
      { seconds: 2.2, source: 'impulse' },
    )
    const m = mono(rendered)
    const sr = rendered.sampleRate
    out.reverb[type] = {
      early: Math.round(rms(m, Math.round(sr * 0.05), Math.round(sr * 0.15)) * 1e6) / 1e6,
      mid: Math.round(rms(m, Math.round(sr * 0.5), Math.round(sr * 0.6)) * 1e6) / 1e6,
      late: Math.round(rms(m, Math.round(sr * 1.2), Math.round(sr * 1.3)) * 1e6) / 1e6,
      decaySeconds: Math.round(api.impulseResponse(type, 'Bright').seconds * 1000) / 1000,
    }
  }

  // ---- delay feedback filtering and repeats
  {
    const rendered = await api.renderChainReal(
      withChain((s) => {
        s.chains['piano.a'].delay = { on: true, tempo: 5, feedback: 8, dryWet: 10, filter: 'LP', pingPong: false, tapSeconds: 0.18, global: false }
      }),
      { seconds: 1.6, source: 'impulse' },
    )
    const m = mono(rendered)
    const sr = rendered.sampleRate
    const window = (t) => ({ rms: Math.round(rms(m, Math.round(sr * t), Math.round(sr * (t + 0.05))) * 1e6) / 1e6, bright: Math.round(brightness(m.slice(Math.round(sr * t), Math.round(sr * (t + 0.05)))) * 1e4) / 1e4 })
    out.delay = {
      tapSeconds: api.delaySecondsFor(5),
      repeat1: window(0.18),
      repeat2: window(0.36),
      repeat3: window(0.54),
      repeat4: window(0.72),
    }
  }

  // ---- piano models: the six types, with their real voice code
  console.log('types')
  for (const [type, model] of Object.entries({
    grand: 'grand.salamander',
    upright: 'upright.ivy',
    electric: 'electric.cp80',
    clav: 'clav.modelled',
    digital: 'digital.modelled',
    misc: 'misc.modelled',
  })) {
    const rendered = await api.renderVoice(model, 60, 0.75, 1.2)
    const data = rendered.samples
    out.types[type] = {
      model,
      rms: Math.round(rms(data) * 1e5) / 1e5,
      brightness: Math.round(brightness(data) * 1e5) / 1e5,
    }
  }

  // ---- performance controls, each measured against its own reference
  const grand = 'grand.salamander'
  // The reference is the instrument's own default: nothing adjusted, so the panel's
  // printed SOFT position is in force. Each case below changes exactly one control from
  // that state, which is the only way a ratio can be attributed to that control.
  const reference = (await api.renderWithControls({}, grand, 60, 0.6, 0.9)).samples
  const refRms = rms(reference)
  const refBright = brightness(reference)
  out.controls.reference = { rms: Math.round(refRms * 1e5) / 1e5, brightness: Math.round(refBright * 1e5) / 1e5 }

  const controlCases = {
    'kbTouchHeavy': { touchExponent: 1.45 },
    'kbTouchLight': { touchExponent: 0.68 },
    'dynComp3': { dynComp: 0.78 },
    // Printed panel positions: 0 = SOFT (= the reference), 1 = MID, 2 = BRIGHT.
    'timbreMid': { timbre: 1 },
    'timbreBright': { timbre: 2 },
  }
  for (const [name, settings] of Object.entries(controlCases)) {
    console.log('control', name)
    const data = (await api.renderWithControls(settings, grand, 60, 0.6, 0.9)).samples
    out.controls[name] = {
      rms: Math.round(rms(data) * 1e5) / 1e5,
      brightness: Math.round(brightness(data) * 1e5) / 1e5,
      rmsRatio: Math.round((rms(data) / Math.max(refRms, 1e-9)) * 1000) / 1000,
      brightnessRatio: Math.round((brightness(data) / Math.max(refBright, 1e-9)) * 1000) / 1000,
    }
  }

  // ---- what the SOFT voicing itself does, measured against no voicing at all
  {
    const flat = (await api.renderWithControls({ timbreIndex: 0 }, grand, 60, 0.6, 0.9)).samples
    const soft = (await api.renderWithControls({ timbre: 0 }, grand, 60, 0.6, 0.9)).samples
    out.controls.timbreSoftVsUnvoiced = {
      unvoicedBrightness: Math.round(brightness(flat) * 1e5) / 1e5,
      softBrightness: Math.round(brightness(soft) * 1e5) / 1e5,
      brightnessRatio: Math.round((brightness(soft) / Math.max(brightness(flat), 1e-9)) * 1000) / 1000,
    }
  }

  // ---- soft release: audible tail length after a release
  {
    const soft = (await api.renderWithControls({ softRelease: true }, grand, 60, 0.7, 2.0, 0.25)).samples
    const hard = (await api.renderWithControls({ softRelease: false }, grand, 60, 0.7, 2.0, 0.25)).samples
    const lastAudibleIndex = (data) => {
      for (let i = data.length - 1; i >= 0; i -= 1) if (Math.abs(data[i]) > 1e-4) return i
      return 0
    }
    out.controls.softRelease = {
      softTailSeconds: Math.round((lastAudibleIndex(soft) / 48000) * 1000) / 1000,
      normalTailSeconds: Math.round((lastAudibleIndex(hard) / 48000) * 1000) / 1000,
    }
  }

  // ---- unison: stereo widening measured in stereo
  {
  // Unison is a stereo effect (manual p. 26): measured in stereo, so the widening shows
  // as a channel-correlation drop rather than as a guess.
  const unisonMeasure = async (unison) => {
    const rendered = await api.renderWithControlsStereo({ unison }, grand, 60, 0.6, 0.9)
    let lr = 0
    let ll = 0
    let rr = 0
    let sum = 0
    for (let i = 0; i < rendered.left.length; i += 1) {
      lr += rendered.left[i] * rendered.right[i]
      ll += rendered.left[i] * rendered.left[i]
      rr += rendered.right[i] * rendered.right[i]
      sum += ((rendered.left[i] + rendered.right[i]) / 2) ** 2
    }
    return {
      correlation: Math.round((lr / Math.max(1e-20, Math.sqrt(ll) * Math.sqrt(rr))) * 1e4) / 1e4,
      monoRms: Math.round(Math.sqrt(sum / rendered.left.length) * 1e5) / 1e5,
    }
  }
  out.controls.unisonOff = await unisonMeasure(0)
  out.controls.unison1 = await unisonMeasure(1)
  out.controls.unison3 = await unisonMeasure(3)
  }

  // ---- master level: the same note at two master settings
  {
    const SR = 48000
    const render = async (level) => {
      const ctx = new OfflineAudioContext(1, Math.round(SR * 0.5), SR)
      const osc = ctx.createOscillator()
      osc.frequency.value = 330
      const master = ctx.createGain()
      master.gain.value = level
      const limiter = ctx.createDynamicsCompressor()
      limiter.threshold.value = -1.5
      limiter.knee.value = 0
      limiter.ratio.value = 20
      osc.connect(master)
      master.connect(limiter)
      limiter.connect(ctx.destination)
      osc.start(0)
      osc.stop(0.4)
      const buffer = await ctx.startRendering()
      return buffer.getChannelData(0)
    }
    const loud = await render(0.9)
    const quiet = await render(0.3)
    out.master = {
      loudRms: Math.round(rms(loud) * 1e5) / 1e5,
      quietRms: Math.round(rms(quiet) * 1e5) / 1e5,
      ratio: Math.round((rms(loud) / Math.max(rms(quiet), 1e-9)) * 100) / 100,
    }
  }

  // ---- the shipped graph's shape and the sample libraries
  console.log('graph')
  out.graph = await api.graphShape()
  console.log('library')
  out.libraryGrand = await api.libraryLoad('grand.salamander')
  out.fallback = await api.fallbackOnFailure()

  /* ---- Phase 3: the organ ------------------------------------------- */
  console.log('organ')
  out.organ = { models: {}, drawbars: {}, percussion: {}, vibrato: {}, rotary: null, layers: null }
  const organRegistrations = {
    B3: ['b3', [8, 8, 8, 6, 0, 0, 0, 0, 0]],
    Vox: ['vox', [8, 8, 8, 6, 4, 2, 0, 4, 0]],
    Farf: ['farf', [0, 0, 8, 8, 0, 8, 0, 0, 0]],
    'Pipe 1': ['pipe1', [6, 8, 0, 6, 0, 4, 0, 0, 3]],
    'Pipe 2': ['pipe2', [4, 8, 0, 8, 0, 6, 0, 4, 5]],
    'B3 Bass': ['b3-bass', [8, 8, 8, 8, 0, 8, 0, 0, 0]],
  }
  for (const [label, [model, drawbars]] of Object.entries(organRegistrations)) {
    const loop = await api.organLoop(model, drawbars, 60)
    const partials = api.organRegistration(model, drawbars)
    out.organ.models[label] = {
      rms: round(rms(loop.samples)),
      brightness: round(brightness(loop.samples)),
      crossingRate: round(crossingHz(loop.samples, loop.sampleRate)),
      partials: partials.length,
      distinctRatios: new Set(partials.map((p) => p.ratio.toFixed(3))).size,
      maxRatio: round(Math.max(...partials.map((p) => p.ratio))),
    }
  }
  // Every drawbar, alone, changes the loop.
  {
    const silentLoop = await api.organLoop('b3', Array.from({ length: 9 }, () => 0), 60)
    out.organ.drawbars.silentRms = round(rms(silentLoop.samples))
    out.organ.drawbars.each = {}
    for (let index = 0; index < 9; index += 1) {
      const drawbars = Array.from({ length: 9 }, () => 0)
      drawbars[index] = 8
      const rendered = await api.organLoop('b3', drawbars, 60)
      out.organ.drawbars.each[index] = {
        rms: round(rms(rendered.samples)),
        brightness: round(brightness(rendered.samples)),
        crossingRate: round(crossingHz(rendered.samples, rendered.sampleRate)),
      }
    }
  }
  // Percussion variants.
  for (const [label, args] of Object.entries({
    'second-slow-normal': [60, false, false, false],
    'third-slow-normal': [60, true, false, false],
    'second-slow-soft': [60, false, true, false],
    'second-fast-normal': [60, false, false, true],
  })) {
    const rendered = api.organPercussion(...args)
    out.organ.percussion[label] = {
      rms: round(rms(rendered.samples)),
      crossingRate: round(crossingHz(rendered.samples, rendered.sampleRate)),
      audibleSeconds: round(lastAudibleSample(rendered.samples) / rendered.sampleRate),
    }
  }
  {
    const click = api.organKeyClick(60)
    out.organ.percussion['key-click'] = {
      rms: round(rms(click.samples)),
      audibleSeconds: round(lastAudibleSample(click.samples) / click.sampleRate),
    }
  }
  for (const type of ['V1', 'V2', 'V3', 'C1', 'C2', 'C3']) {
    out.organ.vibrato[type] = api.organVibrato(type)
  }
  out.organ.layers = api.__organEngine()

  /* ---- Phase 3: the synth ------------------------------------------- */
  console.log('synth')
  out.synth = { waveforms: {}, oscCtrl: {}, filters: {}, envelopes: {}, lfo: {}, arp: {}, voice: {} }
  const waveformNames = [
    'Sine', 'Triangle', 'Saw', 'Square', 'Pulse 33', 'Pulse 10', 'White Noise',
    'Sync Saw', 'Sync Square', 'Multi Saw', 'Multi Saw 8ve', 'Super Saw', 'Super Square',
    'FM 2-op (algorithm A)',
  ]
  for (const waveform of waveformNames) {
    const rendered = api.synthOscillator(waveform, 5)
    out.synth.waveforms[waveform] = {
      rms: round(rms(rendered.left)),
      brightness: round(brightness(rendered.left)),
      correlation: round(correlation(rendered.left, rendered.right), 4),
      crossingRate: round(crossingHz(rendered.left, rendered.sampleRate)),
    }
  }
  for (const waveform of ['Saw', 'Sync Saw', 'Multi Saw', 'Super Saw', 'FM 2-op (algorithm A)']) {
    const low = api.synthOscillator(waveform, 0)
    const high = api.synthOscillator(waveform, 10)
    out.synth.oscCtrl[waveform] = {
      lowBrightness: round(brightness(low.left)),
      highBrightness: round(brightness(high.left)),
      difference: round(shapeDifference(low.left, high.left), 4),
      lowCorrelation: round(correlation(low.left, low.right), 4),
      highCorrelation: round(correlation(high.left, high.right), 4),
    }
  }
  for (const filterType of ['LP12', 'LP24', 'HP', 'BP']) {
    const rendered = api.synthNote({ waveform: 'Saw', filterType, filterFreq: 5, resonance: 2 })
    out.synth.filters[filterType] = {
      rms: round(rms(rendered.samples)),
      brightness: round(brightness(rendered.samples)),
    }
  }
  out.synth.filters.voiceEnvelope = {
    zeroEnvAmount: round(brightness(api.synthNote({ waveform: 'Saw', filterType: 'LP24', filterFreq: 2, filterEnvAmount: 0 }).samples)),
    maxEnvAmount: round(brightness(api.synthNote({ waveform: 'Saw', filterType: 'LP24', filterFreq: 2, filterEnvAmount: 9 }).samples)),
  }
  out.synth.envelopes = {
    // The amp envelope's release is what lengthens the audible tail, so the measurement is
    // the audible duration in seconds: a 2 s release must ring for roughly 1.8 s longer than
    // a 0.15 s one, and both buffers are `hold + release` long.
    shortReleaseSeconds: round(
      lastAudibleSample(api.synthNote({ waveform: 'Saw', holdSeconds: 0.2, releaseSeconds: 0.15, velocity: 1 }).samples) / 48000,
      3,
    ),
    longReleaseSeconds: round(
      lastAudibleSample(api.synthNote({ waveform: 'Saw', holdSeconds: 0.2, releaseSeconds: 2.0, velocity: 1 }).samples) / 48000,
      3,
    ),
    // A soft strike and a hard one differ in level because Amp Velocity is engaged.
    velocityRatio: round(
      rms(api.synthNote({ waveform: 'Saw', velocity: 1 }).samples) /
        Math.max(1e-9, rms(api.synthNote({ waveform: 'Saw', velocity: 0.2 }).samples)),
      3,
    ),
    softVelocity: round(rms(api.synthNote({ waveform: 'Saw', velocity: 0.2 }).samples)),
    hardVelocity: round(rms(api.synthNote({ waveform: 'Saw', velocity: 1 }).samples)),
  }
  for (const waveform of ['Triangle', 'Saw down', 'Saw up', 'Square', 'Sample & Hold']) {
    const rendered = api.synthLfo(waveform)
    out.synth.lfo[waveform] = {
      distinct: new Set(rendered.samples.map((value) => value.toFixed(4))).size,
      crossingRate: round(crossingHz(rendered.samples, rendered.sampleRate)),
    }
  }
  out.synth.arp = {
    up: api.synthArp([60, 64, 67], 'Up', 1, 6),
    down: api.synthArp([60, 64, 67], 'Down', 1, 6),
    upDown: api.synthArp([60, 64, 67], 'Up/Down', 1, 6),
    random: api.synthArp([60, 64, 67], 'Random', 1, 6),
    threeOctaves: api.synthArp([60, 64], 'Up', 3, 6),
  }
  out.synth.voice = {
    // Unison detunes copies of the same wave, so the level stays comparable while the
    // *shape* changes; the difference is the measurement, not the RMS.
    unisonOff: round(rms(api.synthNote({ waveform: 'Saw', unison: 0 }).samples)),
    unisonThree: round(rms(api.synthNote({ waveform: 'Saw', unison: 3 }).samples)),
    unisonShapeDifference: round(
      shapeDifference(
        api.synthNote({ waveform: 'Saw', unison: 0 }).samples,
        api.synthNote({ waveform: 'Saw', unison: 3 }).samples,
      ),
      4,
    ),
    glideEarlyCrossings: round(crossingHz(api.synthNote({ waveform: 'Sine', filterType: 'LP12', glide: 8, glideFrom: 60, midi: 72 }).samples.slice(0, 2400), 48000)),
    noGlideEarlyCrossings: round(crossingHz(api.synthNote({ waveform: 'Sine', filterType: 'LP12', glide: 0, glideFrom: null, midi: 72 }).samples.slice(0, 2400), 48000)),
  }

  /* ---- Phase 3: programs, splits, scenes, morphs, audit -------------- */
  console.log('programs')
  out.programs = api.programChecks()
  out.splits = api.splitChecks()
  out.scenes = api.sceneChecks()
  out.morphs = api.morphChecks()
  out.audit = api.__audit()

  out.samples = {
    grand: await api.renderVoice('grand.salamander', 61, 0.75, 0.8),
    upright: await api.renderVoice('upright.ivy', 61, 0.75, 0.8),
    electric: await api.renderVoice('electric.cp80', 61, 0.75, 0.8),
  }
  out.sampleSummary = {}
  for (const [name, rendered] of Object.entries(out.samples)) {
    out.sampleSummary[name] = {
      rms: round(rms(rendered.samples)),
      brightness: round(brightness(rendered.samples)),
    }
  }
  delete out.samples

  return out
}

/* ------------------------------------------------------------------ */

const started = Date.now()
const step = (label) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${label}`)

async function main() {
  step('start server')
  const server = await startPreview(ROOT)
  step(`server up ${server.base}`)
  const BASE = server.base
  results.url = BASE
  const browser = await chromium.launch()
  step('browser launched')
  const context = await browser.newContext({
    viewport: DESKTOP,
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  const consoleMessages = []
  const pageErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') consoleMessages.push({ type: msg.type(), text: msg.text() })
  })
  page.on('pageerror', (error) => pageErrors.push(String(error)))

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  step('app loaded')

  results.desktop = await page.evaluate(MEASURE)
  step('desktop measured')
  results.interactionPass = await page.evaluate(INTERACT)
  step('interaction pass done')
  await page.waitForTimeout(400)
  results.displayAfterPass = await page.evaluate(() =>
    document.querySelector('[data-testid="program-display"]')?.textContent ?? null,
  )

  await page.setViewportSize(DESKTOP)
  await page.waitForTimeout(250)
  await page.screenshot({ path: resolve(EVIDENCE, 'stage3-desktop.png') })
  step('desktop captured')

  const narrowContext = await browser.newContext({
    viewport: NARROW,
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  })
  const narrowPage = await narrowContext.newPage()
  const narrowConsole = []
  const narrowErrors = []
  narrowPage.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') narrowConsole.push({ type: msg.type(), text: msg.text() })
  })
  narrowPage.on('pageerror', (e) => narrowErrors.push(String(e)))
  await narrowPage.goto(BASE, { waitUntil: 'networkidle' })
  await narrowPage.waitForTimeout(800)
  results.narrow = await narrowPage.evaluate(MEASURE)
  step('narrow measured')
  await narrowPage.screenshot({ path: resolve(EVIDENCE, 'stage3-narrow.png'), fullPage: true })

  // Audio: rendered from the shipped modules in the harness page.
  const audioPage = await browser.newPage({ viewport: DESKTOP })
  const audioConsole = []
  const audioErrors = []
  audioPage.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') audioConsole.push({ type: msg.type(), text: msg.text() })
  })
  audioPage.on('pageerror', (error) => audioErrors.push(String(error)))
  await audioPage.goto(new URL('harness.html', BASE).href, { waitUntil: 'networkidle' })
  await audioPage.waitForFunction(() => Boolean(window.stagebench), null, { timeout: 20000 })
  step('harness loaded')
  results.audio = await audioPage.evaluate(AUDIO)
  step('audio measured')

  results.console = {
    desktop: consoleMessages,
    narrow: narrowConsole,
    harness: audioConsole,
    pageErrors: [...pageErrors, ...narrowErrors, ...audioErrors],
  }

  writeFileSync(resolve(EVIDENCE, 'stage3-capture.json'), JSON.stringify(results, null, 2))
  console.log('captured sections:', Object.keys(results).join(', '))
  console.log('console errors:', results.console.pageErrors.length, 'messages:', consoleMessages.length)
  await browser.close()
  server.stop()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
