import { AmpType, clockDivision, filterFrequency, midFrequency, mod1Rate, mod2Rate, ringFrequency, Mod1Type } from '../audio/dsp/params'
import { FUNCTIONAL_BUTTON_IDS, FUNCTIONAL_RANGE_IDS, SHIFT_BUTTON_IDS } from '../hardware/functional'
import type { HardwareStore, LedMode } from '../hardware/store'
import { organModel } from '../organ/catalog'
import { PIANO_TYPES } from '../piano/catalog'
import { waveform } from '../synth/catalog'
import {
  LAYER_NAMES,
  PROGRAMS_PER_PAGE,
  activePoints,
  chainOwner,
  effectiveSoftRelease,
  effectiveStringRes,
  layerModel,
  rotaryInUse,
  timbreCount,
  zoneLeds,
  type FxChainState,
  type SoundSection,
  type StageState,
  type SynthPage,
} from './model'
import { MORPH_SOURCE_NAMES, morphSourcesOf, morphedValue, type MorphSource } from './morph'
import { describeSynthKnob, formatHz, type FxParam, type StageStore, type SynthKnob } from './store'

/**
 * Connects the panel hardware to the canonical state, in both directions.
 *
 *  hardware → state: when a functional control is pressed or moved, the matching StageStore
 *                    action runs. A button's own stepping indicator is ignored: what the
 *                    press means is decided here, with Shift taken into account.
 *  state → hardware: after every change the panel is rewritten from the canonical state —
 *                    knob positions for the focused layer, selector LEDs, on/off LEDs, the
 *                    blinking focus LED, morph LEDs and LED graphs, value texts. The panel can
 *                    never drift from the sound.
 *
 * Shift: hold either Shift button (touch, or keyboard focus on it), or hold the computer's
 * Shift key, while operating a control. For a single mouse pointer, a click on Shift latches
 * it for the next control; a second click releases it. While the Program display is on an
 * editing page (Store, naming, split, clock, …) or a Morph Assign is latched, a press of
 * Shift is Exit instead.
 *
 * Hold: Split, Mst Clk, and Transp have a hold function (▼ on the panel) that opens their page;
 * a press of half a second or more is that function. A Morph Assign button assigns while it is
 * held down (with a second finger on the control) and latches on a plain press. Each hold
 * function also has a single-pointer way in, described in the README.
 */

/** Sample sets that failed to load, and live meters, as seen by the audio engine. */
export interface EngineView {
  failedTypes: readonly number[]
  compressor: readonly boolean[]
}

/** Things a panel control can ask for that are not state: they act on the session. */
export interface PanelActions {
  /** Panic (Shift + Transpose): all notes off and held performance inputs reset. */
  panic?: () => void
}

const FX_KNOBS: Record<string, FxParam> = {
  'fx-mod1-rate': ['mod1', 'rate'],
  'fx-mod1-amount': ['mod1', 'amount'],
  'fx-mod2-rate': ['mod2', 'rate'],
  'fx-mod2-amount': ['mod2', 'amount'],
  'fx-drive': ['amp', 'drive'],
  'fx-eq-bass': ['amp', 'bass'],
  'fx-eq-mid-freq': ['amp', 'freq'],
  'fx-eq-mid': ['amp', 'mid'],
  'fx-eq-treble': ['amp', 'treble'],
  'fx-delay-tempo': ['delay', 'tempo'],
  'fx-delay-mix': ['delay', 'mix'],
  'fx-delay-feedback': ['delay', 'feedback'],
  'fx-comp-amount': ['comp', 'amount'],
  'fx-reverb-mix': ['reverb', 'mix'],
}

const SYNTH_KNOBS: Record<string, SynthKnob> = {
  'synth-osc-ctrl': 'ctrl',
  'synth-osc-env-amt': 'oscEnv.amount',
  'synth-filter-freq': 'filter.freq',
  'synth-filter-res': 'filter.res',
  'synth-filter-env-amt': 'filter.envAmt',
  'synth-lfo-rate': 'lfo.rate',
  'synth-lfo-amount': 'lfo.amount',
  'synth-arp-rate': 'arp.rate',
  'synth-arp-range': 'arp.range',
  'synth-glide': 'voice.glide',
}

/** Morph LED of each morphable knob (the LED's slug, without `led-`). */
const MORPH_LEDS: Record<string, string> = {
  'synth-osc-ctrl': 'synth-osc-ctrl-morph',
  'synth-osc-env-amt': 'synth-osc-env-amt-morph',
  'synth-filter-freq': 'synth-filter-freq-morph',
  'synth-filter-res': 'synth-filter-res-morph',
  'synth-filter-env-amt': 'synth-filter-env-amt-morph',
  'synth-lfo-rate': 'synth-lfo-rate-morph',
  'synth-lfo-amount': 'synth-lfo-amount-morph',
  'synth-arp-rate': 'synth-arp-rate-morph',
  'synth-arp-range': 'synth-arp-range-morph',
  'fx-mod1-rate': 'fx-mod1-rate-morph',
  'fx-mod1-amount': 'fx-mod1-amount-morph',
  'fx-mod2-rate': 'fx-mod2-rate-morph',
  'fx-mod2-amount': 'fx-mod2-amount-morph',
  'fx-drive': 'fx-drive-morph',
  'fx-eq-mid-freq': 'fx-eq-freq-morph',
  'fx-delay-tempo': 'fx-delay-tempo-morph',
  'fx-delay-mix': 'fx-delay-mix-morph',
  'fx-delay-feedback': 'fx-delay-feedback-morph',
  'fx-reverb-mix': 'fx-reverb-mix-morph',
}

const SYNTH_PAGE_BUTTONS: Record<string, SynthPage> = {
  'synth-osc-pitch': 'pitch',
  'synth-osc-envelope': 'oscEnv',
  'synth-filter-type': 'filter',
  'synth-filter-envelope': 'filterEnv',
  'synth-amp-envelope': 'ampEnv',
  'synth-lfo-waveform': 'lfo',
  'synth-arp-menu': 'arp',
  'synth-vibrato-menu': 'vibrato',
}

/** Indicator position of the Vibrato selector for each vibrato mode (the A.T. position is skipped). */
const VIBRATO_STEPS = [0, 1, 2, 3, 5] as const

const TYPE_LED_SLUGS = ['grand', 'upright', 'electric', 'clav', 'digital', 'misc'] as const
const LETTERS = ['a', 'b', 'c'] as const
/** Two taps further apart than this start a new tempo instead of setting one. */
const TAP_TIMEOUT_MS = 2000
/** A press held at least this long is the "hold" (▼) function printed under some buttons. */
const HOLD_MS = 500
/** Buttons with a hold function: the split page, the tempo page, the transpose page, Morph Assign. */
const HOLD_BUTTON_IDS = ['split', 'mst-clk', 'transpose', 'morph-wheel', 'morph-control-pedal'] as const
const MORPH_BUTTONS: Record<string, MorphSource> = { 'morph-wheel': 'wheel', 'morph-control-pedal': 'pedal' }
/** The Master Clock wants at least this many taps (manual p. 40). */
const CLOCK_TAPS = 4
const DIAL_DETENTS = 24

export class PanelBinder {
  private readonly hardware: HardwareStore
  private readonly stage: StageStore
  private readonly now: () => number
  private readonly actions: PanelActions
  private readonly seenPresses = new Map<string, number>()
  private readonly seenValues = new Map<string, number>()
  private unsubscribe: Array<() => void> = []
  private syncing = false
  private shiftKey = false
  private shiftLatched = false
  private shiftWasHeld = false
  private shiftUsed = false
  private lastTap: number | null = null
  private clockTaps: number[] = []
  /** When each hold-capable button went down, and Morph Assign buttons that assigned something while held. */
  private readonly pressedAt = new Map<string, number>()
  private readonly morphUsed = new Set<string>()
  private engine: EngineView = { failedTypes: [], compressor: [] }

  constructor(hardware: HardwareStore, stage: StageStore, now: () => number, actions: PanelActions = {}) {
    this.hardware = hardware
    this.stage = stage
    this.now = now
    this.actions = actions
  }

  attach(): void {
    if (this.unsubscribe.length > 0) return
    this.remember()
    this.sync()
    this.unsubscribe = [
      this.hardware.subscribe(() => this.onHardware()),
      this.stage.subscribe(() => this.sync()),
    ]
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribe) unsubscribe()
    this.unsubscribe = []
  }

  /** The computer keyboard's Shift key, as a third Shift button. */
  setShiftKey(down: boolean): void {
    this.shiftKey = down
  }

  /** True while the next control will be read as Shift + control. */
  get shiftActive(): boolean {
    return this.shiftHeld || this.shiftLatched
  }

  setEngineView(view: EngineView): void {
    this.engine = view
    this.sync()
  }

  private get shiftHeld(): boolean {
    return this.shiftKey || SHIFT_BUTTON_IDS.some((id) => this.hardware.isPressed(id))
  }

  /** Reads and consumes the Shift state for one control action. */
  private takeShift(): boolean {
    if (this.shiftHeld) {
      this.shiftUsed = true
      return true
    }
    if (this.shiftLatched) {
      this.shiftLatched = false
      return true
    }
    return false
  }

  private remember(): void {
    for (const id of FUNCTIONAL_BUTTON_IDS) this.seenPresses.set(id, this.hardware.getPressCount(id))
    for (const id of FUNCTIONAL_RANGE_IDS) this.seenValues.set(id, this.hardware.getValue(id))
  }

  // ── Hardware → state ────────────────────────────────────────────────────────

  private onHardware(): void {
    if (this.syncing) return
    const hardware = this.hardware

    const held = SHIFT_BUTTON_IDS.some((id) => hardware.isPressed(id))
    if (held && !this.shiftWasHeld) this.shiftUsed = false
    this.shiftWasHeld = held

    for (const id of HOLD_BUTTON_IDS) {
      const down = hardware.isPressed(id)
      if (down && !this.pressedAt.has(id)) this.pressedAt.set(id, this.now())
      // Let go without counting (slid off, cancelled): forget it.
      else if (!down && this.pressedAt.has(id) && hardware.getPressCount(id) === (this.seenPresses.get(id) ?? 0)) {
        this.pressedAt.delete(id)
        this.morphUsed.delete(id)
      }
    }

    for (const id of FUNCTIONAL_BUTTON_IDS) {
      const count = hardware.getPressCount(id)
      const before = this.seenPresses.get(id) ?? 0
      if (count === before) continue
      this.seenPresses.set(id, count)
      for (let press = before; press < count; press += 1) this.onButton(id)
    }
    for (const id of FUNCTIONAL_RANGE_IDS) {
      const value = hardware.getValue(id)
      const before = this.seenValues.get(id) ?? value
      if (value === before) continue
      this.seenValues.set(id, value)
      this.onRange(id, value, before)
    }
    // Always finish by redrawing the panel from the canonical state: a button's own stepping
    // indicator is never the truth, and an action that changed nothing must still undo it.
    this.sync()
  }

  private onButton(id: string): void {
    const stage = this.stage
    if ((SHIFT_BUTTON_IDS as readonly string[]).includes(id)) {
      if (!this.shiftUsed) {
        // On an editing page Shift is Exit. Otherwise a Shift press that modified nothing
        // toggles the latch; one that was used does not.
        if (stage.editing) stage.exit()
        else this.shiftLatched = !this.shiftLatched
      }
      this.shiftUsed = false
      this.sync()
      return
    }
    const shift = this.takeShift()
    const state = stage.getState()
    const assign = this.morphSource(state)
    // How long the button was down: a long press is its hold function.
    const downAt = this.pressedAt.get(id)
    const held = downAt !== undefined && this.now() - downAt >= HOLD_MS
    this.pressedAt.delete(id)

    const program = id.match(/^program-([1-8])$/)
    if (program) {
      stage.pressProgramButton(Number(program[1]) - 1)
      return
    }
    const layerButton = id.match(/^(organ|piano|synth)-layer-([abc])$/)
    if (layerButton) {
      const section = layerButton[1] as SoundSection
      const index = LETTERS.indexOf(layerButton[2] as 'a' | 'b' | 'c')
      if (!shift) stage.pressSectionLayer(section, index)
      else if (index === 0) stage.toggleSectionSustPed(section)
      else if (index === 1) stage.toggleSectionPStick(section)
      // Shift + Synth Layer C is Pan, which is not part of the synth spec.
      else stage.setNotice('Layer Pan is not available')
      return
    }
    const octave = id.match(/^(organ|piano|synth)-octave-(down|up)$/)
    if (octave) {
      const section = octave[1] as SoundSection
      const direction = octave[2] === 'up' ? 1 : -1
      // Shift + Octave Shift is KB Zone.
      if (shift) stage.shiftZone(section, direction)
      else stage.shiftSectionOctave(section, direction)
      return
    }
    const sectionOn = id.match(/^(organ|piano|synth)-on$/)
    if (sectionOn) {
      stage.toggleSectionOn(sectionOn[1] as SoundSection)
      return
    }
    const page = SYNTH_PAGE_BUTTONS[id]
    if (page) {
      this.synthPageButton(id, page, shift)
      return
    }

    switch (id) {
      // ── Program ──
      case 'store':
        stage.pressStore(shift)
        break
      case 'page-prev':
      case 'page-next':
        // Shift + Page is Bank; there is one bank.
        if (shift) stage.setNotice('There is one bank of 32 programs')
        else stage.page(id === 'page-next' ? 1 : -1)
        break
      case 'live-mode':
        stage.toggleLive()
        break
      case 'layer-scene':
        stage.toggleScene()
        break
      case 'split':
        // Holding Split opens the Keyboard Split page; so does Shift + Split, for a single pointer.
        if (shift || held) stage.openSplit()
        else stage.toggleSplit()
        break
      case 'mst-clk':
        // Shift + Mst Clk is Pedal Tap, which the programs spec excludes.
        if (shift) stage.setNotice('Pedal Tap is not available')
        // Holding it brings up the tempo page for the dial; a short press is also a tap.
        else if (held) stage.openClock()
        else this.tapClock()
        break
      case 'transpose':
        if (shift) {
          this.actions.panic?.()
          stage.setPitchStick(0)
          stage.setNotice('Panic: all notes off')
        } else if (held) stage.openTranspose()
        else stage.pressTranspose()
        break
      case 'morph-wheel':
      case 'morph-control-pedal': {
        const source = MORPH_BUTTONS[id]
        // Held while a control was moved: the assignment is made, and letting go ends it.
        const used = this.morphUsed.delete(id)
        if (shift) stage.clearMorph(source)
        else if (used) this.sync()
        else stage.toggleMorphAssign(source)
        break
      }

      // ── Organ ──
      case 'organ-model':
        stage.nextOrganModel()
        break
      case 'organ-vibrato-type':
        stage.nextVibType()
        break
      case 'organ-vibrato-on':
        stage.toggleVibrato()
        break
      case 'organ-perc-volume-soft':
        // Shift + Volume Soft is Poly percussion, optional and not implemented.
        if (shift) stage.setNotice('Percussion Poly is not available')
        else stage.togglePercussion('soft')
        break
      case 'organ-perc-decay-fast':
        stage.togglePercussion('fast')
        break
      case 'organ-perc-harmonic-third':
        stage.togglePercussion('third')
        break
      case 'organ-perc-on':
        stage.togglePercussion('on')
        break

      // ── Piano ──
      case 'piano-type':
        // Shift + type is INFO, which the piano spec excludes.
        if (shift) stage.setNotice('Piano Info is not available')
        else stage.nextType()
        break
      case 'piano-timbre':
        stage.nextTimbre()
        break
      case 'piano-acoustics':
        // Shift + Acoustics is Pedal Noise, which the piano spec excludes.
        if (shift) stage.setNotice('Pedal Noise is not available')
        else stage.nextAcoustics()
        break
      case 'piano-unison':
        stage.nextUnison()
        break
      case 'piano-kb-touch':
        stage.nextKbTouch()
        break
      case 'piano-dyn-comp':
        stage.nextDynComp()
        break

      // ── Synth ──
      case 'synth-waveform':
        if (shift) stage.initSynthSound()
        else stage.setSynthPage('osc')
        break
      case 'synth-kb-hold':
        // Shift + KB Hold is Exclude, which the synth spec excludes.
        if (shift) stage.setNotice('KB Hold Exclude is not available')
        else stage.toggleHold()
        break
      case 'synth-arp-run':
        if (shift) stage.toggleKbSync()
        else stage.toggleArpRun()
        break
      case 'synth-lfo-dest':
        stage.nextLfoDest()
        break
      case 'synth-arp-mode':
        // Shift + Arp mode is Pattern, which the synth spec excludes.
        if (shift) stage.setNotice('Arpeggiator Pattern is not available')
        else stage.nextArpMode()
        break
      case 'synth-voice-mode':
        // Shift + Voice mode steps the note priority: last note, Lo, Hi.
        if (shift) stage.nextPriority()
        else stage.nextVoiceMode()
        break
      case 'synth-vibrato-mode':
        stage.nextVibratoMode()
        break
      case 'synth-filter-on':
        stage.toggleFilterOn()
        break
      case 'synth-unison':
        stage.nextSynthUnison()
        break

      // ── Layer Effects ──
      case 'fx-on':
        stage.toggleFxOn()
        break
      case 'fx-focus-organ':
        // Shift + FX Focus Organ is All FX Off.
        if (shift) stage.toggleFxOn()
        else stage.nextFxFocus('organ')
        break
      case 'fx-focus-piano':
        if (shift) stage.toggleGroup('piano')
        else stage.nextFxFocus('piano')
        break
      case 'fx-focus-synth':
        if (shift) stage.toggleGroup('synth')
        else stage.nextFxFocus('synth')
        break
      case 'fx-mod1-type':
      case 'fx-mod2-type':
      case 'fx-amp-type':
      case 'fx-reverb-type': {
        const unit = id === 'fx-mod1-type' ? 'mod1' : id === 'fx-mod2-type' ? 'mod2' : id === 'fx-amp-type' ? 'amp' : 'reverb'
        // Shift + selector is Variation / Chorale, which the effects spec excludes.
        if (shift) stage.setNotice('Variations are not available')
        else stage.nextUnitType(unit)
        break
      }
      case 'fx-mod1-on':
        stage.toggleUnit('mod1')
        break
      case 'fx-mod2-on':
        stage.toggleUnit('mod2')
        break
      case 'fx-amp-on':
        stage.toggleUnit('amp')
        break
      case 'fx-delay-on':
        if (shift) stage.toggleGlobal('delay')
        else stage.toggleUnit('delay')
        break
      case 'fx-comp-on':
        if (shift) stage.toggleGlobal('comp')
        else stage.toggleUnit('comp')
        break
      case 'fx-reverb-on':
        if (shift) stage.toggleGlobal('reverb')
        else stage.toggleUnit('reverb')
        break
      case 'fx-delay-filter':
        if (shift) stage.toggleDelayPingPong()
        else stage.nextDelayFilter()
        break
      case 'fx-reverb-tone':
        stage.nextReverbTone()
        break
      case 'fx-delay-tap':
        // Shift + Tap is Analog mode, which the effects spec excludes.
        if (shift) stage.setNotice('Analog delay mode is not available')
        else this.tap()
        break

      // ── Rotary Speaker ──
      case 'rotary-speed':
        // With a Morph Assign latched, the speed button assigns (or removes) the rotor-speed morph.
        if (assign) this.noteMorphUse()
        if (assign) stage.setMorph(assign, 'rotary.speed', morphSourcesOf(state, 'rotary.speed').includes(assign) ? (state.rotary.fast ? 1 : 0) : state.rotary.fast ? 0 : 1)
        else stage.toggleRotarySpeed()
        break
      case 'rotary-stop-mode':
        // Shift + Stop Mode is the stop Angle, which the effects spec excludes.
        if (shift) stage.setNotice('Rotary stop angle is not available')
        else stage.toggleRotaryStopMode()
        break
      case 'rotary-source':
        // Shift + Organ is Close Mic, which the effects spec excludes.
        if (shift) stage.setNotice('Rotary close mic is not available')
        else stage.toggleRotaryOrgan()
        break
      default:
        // Every functional button has a case above; if one ever does not, it says so instead of doing nothing.
        stage.setNotice(`No binding for ${id}`)
    }
  }

  /** The Synth buttons that put a page on the Synth display. Several have a Shift function of their own. */
  private synthPageButton(id: string, page: SynthPage, shift: boolean): void {
    const stage = this.stage
    const showing = stage.getState().ui.synthPage === page
    if (shift) {
      switch (id) {
        case 'synth-osc-pitch':
          return stage.toggleEnvToPitch()
        case 'synth-osc-envelope':
          return stage.toggleEnvVelocity('oscEnv')
        case 'synth-filter-envelope':
          return stage.toggleEnvVelocity('filterEnv')
        case 'synth-amp-envelope':
          return stage.nextAmpVelocity()
        case 'synth-vibrato-menu':
          return stage.setSynthPage(page)
        default:
          // Shift + LFO Waveform / Filter Type / Arp Menu is Group, which the synth spec excludes.
          return stage.setNotice('Synth Group modes are not available')
      }
    }
    // Filter Type and LFO Waveform step their value once their page is showing; the first press shows it.
    if (showing && id === 'synth-filter-type') stage.nextFilterType()
    else if (showing && id === 'synth-lfo-waveform') stage.nextLfoWave()
    else if (id === 'synth-filter-type' || id === 'synth-lfo-waveform') stage.setSynthPage(page)
    else stage.toggleSynthPage(page)
  }

  private tap(): void {
    const time = this.now()
    const previous = this.lastTap
    this.lastTap = time
    if (previous === null || time - previous > TAP_TIMEOUT_MS || time - previous < 20) {
      this.stage.setNotice('Delay Tap: tap again to set the tempo')
      return
    }
    this.stage.setDelaySeconds((time - previous) / 1000)
  }

  /** Mst Clk: the first press shows the tempo page; four or more evenly spaced presses set the tempo. */
  private tapClock(): void {
    const time = this.now()
    const last = this.clockTaps[this.clockTaps.length - 1]
    if (last !== undefined && (time - last > TAP_TIMEOUT_MS || time - last < 20)) this.clockTaps = []
    this.clockTaps.push(time)
    this.stage.openClock()
    const taps = this.clockTaps
    if (taps.length < CLOCK_TAPS) {
      if (taps.length > 1) this.stage.setNotice(`Master Clock tap ${taps.length} of ${CLOCK_TAPS}`)
      return
    }
    const interval = (taps[taps.length - 1] - taps[0]) / (taps.length - 1)
    this.stage.setBpm(60000 / interval, 'Master Clock tap')
    if (taps.length > 8) taps.shift()
  }

  /** Turn of an endless dial between two positions: the shortest way round is the turn that was made. */
  private detents(value: number, before: number): number {
    let detents = value - before
    if (detents > DIAL_DETENTS / 2) detents -= DIAL_DETENTS
    if (detents < -DIAL_DETENTS / 2) detents += DIAL_DETENTS
    return Math.round(detents)
  }

  /**
   * The source a moved control is being assigned to, if any: a Morph Assign button that is being
   * held down right now (the instrument's own gesture, for two fingers), or one that is latched.
   */
  private morphSource(state: StageState): MorphSource | null {
    for (const [id, source] of Object.entries(MORPH_BUTTONS)) if (this.hardware.isPressed(id)) return source
    return state.ui.morphAssign
  }

  /** Remember that a held Morph Assign button was used, so that releasing it does not latch it. */
  private noteMorphUse(): void {
    for (const id of Object.keys(MORPH_BUTTONS)) if (this.hardware.isPressed(id)) this.morphUsed.add(id)
  }

  /** The morph destination a panel control edits right now, or null if it is not morphable. */
  private morphPath(id: string, state: StageState): string | null {
    const fader = id.match(/^(organ|piano|synth)-layer-([abc])-level$/)
    if (fader) return `${fader[1]}.layers.${LETTERS.indexOf(fader[2] as 'a')}.level`
    const drawbar = id.match(/^organ-drawbar-([1-9])$/)
    if (drawbar) return `organ.layers.${state.organ.focus}.drawbars.${Number(drawbar[1]) - 1}`
    const synth = SYNTH_KNOBS[id]
    if (synth && id in MORPH_LEDS) return `synth.layers.${state.synth.focus}.${synth}`
    const fx = FX_KNOBS[id]
    if (fx && id in MORPH_LEDS) return `fx.chains.${state.fx.focus}.${fx[0]}.${fx[1]}`
    return null
  }

  private onRange(id: string, value: number, before: number): void {
    const stage = this.stage
    const state = stage.getState()

    // Dials, the wheel, the stick, and Master Level are never morph destinations.
    switch (id) {
      case 'perf-master-level':
        stage.setMaster(value)
        return
      case 'perf-pitch-stick':
        stage.setPitchStick(value)
        return
      case 'perf-mod-wheel':
        stage.setWheel(value / 127)
        return
      case 'program-dial': {
        const detents = this.detents(value, before)
        if (this.takeShift()) stage.openList(detents)
        else stage.turnProgramDial(detents)
        return
      }
      case 'piano-model':
        // Shift + dial is the List view, which is optional and not implemented.
        if (this.takeShift()) stage.setNotice('Model List view is not available')
        else stage.turnModel(this.detents(value, before))
        return
      case 'synth-osc-dial-1':
      case 'synth-osc-dial-2':
      case 'synth-osc-dial-3':
        stage.turnSynthDial(Number(id.slice(-1)) - 1, this.detents(value, before))
        return
    }

    // Shift + turn locks a rate to the Master Clock (clockwise) or frees it (anticlockwise);
    // on the compressor it switches Fast mode. The knob's own value stays put.
    if (id === 'synth-lfo-rate' || id === 'synth-arp-rate' || id === 'fx-mod1-rate' || id === 'fx-delay-tempo' || id === 'fx-comp-amount') {
      if (this.takeShift()) {
        const on = value > before
        if (id === 'synth-lfo-rate') stage.setSynthSync('lfo', on)
        else if (id === 'synth-arp-rate') stage.setSynthSync('arp', on)
        else if (id === 'fx-mod1-rate') stage.setFxSync('mod1', on)
        else if (id === 'fx-delay-tempo') stage.setFxSync('delay', on)
        else stage.setCompFast(on)
        return
      }
    }

    // A latched Morph Assign: moving a destination sets where that source's morph ends.
    const assign = this.morphSource(state)
    if (assign) {
      this.noteMorphUse()
      const path = this.morphPath(id, state)
      if (path) stage.setMorph(assign, path, value)
      else stage.setNotice(`Morph ${MORPH_SOURCE_NAMES[assign]}: that control is not a morph destination`)
      return
    }

    const fader = id.match(/^(organ|piano|synth)-layer-([abc])-level$/)
    if (fader) {
      stage.setSectionLayerLevel(fader[1] as SoundSection, LETTERS.indexOf(fader[2] as 'a'), value)
      return
    }
    const drawbar = id.match(/^organ-drawbar-([1-9])$/)
    if (drawbar) {
      stage.setDrawbar(Number(drawbar[1]) - 1, value)
      return
    }
    if (id === 'rotary-drive') {
      stage.setRotaryDrive(value)
      return
    }
    const synth = SYNTH_KNOBS[id]
    if (synth) {
      stage.setSynthKnob(synth, value)
      return
    }
    const param = FX_KNOBS[id]
    if (param) stage.setFxParam(param, value)
    else stage.setNotice(`No binding for ${id}`)
  }

  // ── State → hardware ────────────────────────────────────────────────────────

  private sync(): void {
    if (this.syncing) return
    this.syncing = true
    try {
      this.hardware.batch(() => this.write(this.stage.getState()))
      this.remember()
    } finally {
      this.syncing = false
    }
  }

  private led(slug: string, mode: LedMode | boolean): void {
    this.hardware.setLed(`led-${slug}`, mode === true ? 'on' : mode === false ? 'off' : mode)
  }

  /**
   * Put a morphable control where it belongs: at its stored value, or — while its source's
   * Morph Assign is latched — at the value the morph ends on, so it can be adjusted from there.
   * Its morph LED, value text, and LED graph follow.
   */
  private morphable(id: string, state: StageState, base: number, text: string | null = null): void {
    const hw = this.hardware
    const path = this.morphPath(id, state)
    const sources = path ? morphSourcesOf(state, path) : []
    const assign = this.morphSource(state)
    const assigned = path && assign ? state.morph[assign].find((item) => item.path === path) : undefined
    hw.setValue(id, assigned ? assigned.to : base)
    const ledSlug = MORPH_LEDS[id]
    if (ledSlug) this.led(ledSlug, sources.length > 0)
    if (!path || sources.length === 0) {
      hw.setValueText(id, text)
      hw.setMeter(id, null)
      return
    }
    const now = morphedValue(state, path)
    const ends = sources.map((source) => `${MORPH_SOURCE_NAMES[source]} to ${format(state.morph[source].find((item) => item.path === path)!.to)}`)
    hw.setValueText(id, `${text ? `${text}; ` : ''}morph from ${format(base)}: ${ends.join(', ')}; now ${format(now)}`)
    hw.setMeter(id, Math.round(now * 100) / 100)
  }

  private write(state: StageState): void {
    const hw = this.hardware
    const { piano, organ, synth, fx, rotary, ui, nav } = state
    const led = (slug: string, mode: LedMode | boolean) => this.led(slug, mode)

    // ── Performance band ──
    hw.setValue('perf-master-level', state.master)
    hw.setValue('perf-mod-wheel', Math.round(state.wheel * 127))
    hw.setValue('rotary-drive', rotary.drive)
    hw.setStep('rotary-speed', rotary.fast ? 1 : 0)
    hw.setStep('rotary-stop-mode', rotary.stopMode ? 1 : 0)
    hw.setStep('rotary-source', rotary.organ ? 1 : 0)
    led('rotary-on', rotaryInUse(state))
    led('rotary-morph', morphSourcesOf(state, 'rotary.speed').length > 0)

    // ── Layer strips, shared by the three sections ──
    for (const section of ['organ', 'piano', 'synth'] as const) {
      const part = state[section]
      const count = part.layers.filter((layer) => layer.on).length
      hw.setStep(`${section}-on`, part.on ? 1 : 0)
      led(`${section}-fx-focus`, chainOwner(fx.focus).section === section)
      led(`${section}-sustped`, part.sustPed)
      led(`${section}-pstick`, part.pStick)
      part.layers.forEach((item, index) => {
        const letter = LETTERS[index]
        hw.setStep(`${section}-layer-${letter}`, item.on ? 1 : 0)
        // With more than one layer on, the focused one blinks (manual p. 23).
        led(`${section}-layer-${letter}`, !item.on ? 'off' : count > 1 && part.focus === index ? 'blink' : 'on')
        this.morphable(`${section}-layer-${letter}-level`, state, item.level)
      })
      zoneLeds(state, part.layers[part.focus].zone).forEach((lit, zone) => led(`${section}-kb-zone-${zone + 1}`, lit))
    }

    // ── Organ ──
    const organLayer = organ.layers[organ.focus]
    const organInfo = organModel(organLayer.model)
    hw.setStep('organ-model', organLayer.model)
    hw.setStep('organ-vibrato-type', organ.vibType)
    hw.setStep('organ-vibrato-on', organLayer.vibOn ? 1 : 0)
    hw.setStep('organ-perc-on', organLayer.perc.on ? 1 : 0)
    hw.setStep('organ-perc-volume-soft', organLayer.perc.soft ? 1 : 0)
    hw.setStep('organ-perc-decay-fast', organLayer.perc.fast ? 1 : 0)
    hw.setStep('organ-perc-harmonic-third', organLayer.perc.third ? 1 : 0)
    organLayer.drawbars.forEach((value, bar) => {
      const legend = organInfo.drawbars[bar]
      const text = legend === null ? `not used by ${organInfo.name}` : organInfo.tabs ? `${legend}: ${value > 4 ? 'on' : 'off'}` : `${organInfo.name} ${legend}`
      this.morphable(`organ-drawbar-${bar + 1}`, state, value, text)
    })

    // ── Piano ──
    const layer = piano.layers[piano.focus]
    hw.setStep('piano-type', layer.type)
    const failed = layerModel(layer).origin === 'recorded' && this.engine.failedTypes.includes(layer.type)
    TYPE_LED_SLUGS.forEach((slug, index) => {
      // A model whose samples are missing makes its type LED flash (manual p. 24).
      led(`piano-type-${slug}`, index !== layer.type ? 'off' : failed ? 'blink' : 'on')
    })
    hw.setStep('piano-timbre', layer.timbre < timbreCount(layer) ? layer.timbre : 0)
    hw.setStep('piano-kb-touch', layer.kbTouch)
    hw.setStep('piano-dyn-comp', layer.dynComp)
    hw.setStep('piano-unison', layer.unison)
    hw.setStep('piano-acoustics', (effectiveSoftRelease(layer) ? 1 : 0) + (effectiveStringRes(layer) ? 2 : 0))
    hw.setValueText('piano-model', `${PIANO_TYPES[layer.type]}: ${layerModel(layer).name}`)

    // ── Program ──
    const storing = ui.mode === 'store' || ui.mode === 'name'
    hw.setStep('store', storing ? 1 : 0)
    led('store', storing ? 'blink' : 'off')
    hw.setStep('live-mode', (ui.mode === 'store' ? ui.store.dest.live : nav.live) ? 1 : 0)
    hw.setStep('layer-scene', state.scene.active)
    hw.setStep('transpose', state.transpose.on ? 1 : 0)
    hw.setStep('mst-clk', ui.mode === 'clock' ? 1 : 0)
    const points = activePoints(state)
    hw.setStep('split', state.split.on ? 1 : 0)
    led('split-low', points[0])
    led('split-high', points[2])
    const shown = ui.mode === 'store' ? ui.store.dest : nav
    for (let button = 0; button < PROGRAMS_PER_PAGE; button += 1) {
      const lit = (shown.slot % PROGRAMS_PER_PAGE) === button
      hw.setStep(`program-${button + 1}`, lit ? 1 : 0)
      // While a Store destination is being chosen, its button flashes.
      led(`program-${button + 1}`, !lit ? 'off' : ui.mode === 'store' ? 'blink' : 'on')
    }
    for (const [id, source] of [['morph-wheel', 'wheel'], ['morph-control-pedal', 'pedal']] as const) {
      const assigned = state.morph[source].length > 0
      const latched = ui.morphAssign === source
      hw.setStep(id, assigned || latched ? 1 : 0)
      led(id, latched ? 'blink' : assigned ? 'on' : 'off')
    }
    hw.setValueText(
      'program-dial',
      ui.mode === 'clock'
        ? `${state.clock.bpm} BPM`
        : ui.mode === 'transpose'
          ? `transpose ${state.transpose.semitones}`
          : `${nav.live ? `Live ${nav.slot + 1}` : `Program ${Math.floor(nav.slot / PROGRAMS_PER_PAGE) + 1}.${(nav.slot % PROGRAMS_PER_PAGE) + 1}`}: ${state.name}`,
    )

    // ── Synth ──
    const synthLayer = synth.layers[synth.focus]
    const { bpm } = state.clock
    hw.setStep('synth-kb-hold', synth.hold ? 1 : 0)
    hw.setStep('synth-arp-run', synthLayer.arp.run ? 1 : 0)
    led('synth-kb-sync', synthLayer.arp.kbSync)
    hw.setStep('synth-lfo-dest', synthLayer.lfo.dest)
    hw.setStep('synth-arp-mode', synthLayer.arp.mode)
    hw.setStep('synth-voice-mode', synthLayer.voice.mode)
    led('synth-voice-lo', synthLayer.voice.priority === 1)
    led('synth-voice-hi', synthLayer.voice.priority === 2)
    hw.setStep('synth-vibrato-mode', VIBRATO_STEPS[synthLayer.voice.vibrato] ?? 0)
    hw.setStep('synth-unison', synthLayer.voice.unison)
    hw.setStep('synth-filter-on', synthLayer.filter.on ? 1 : 0)
    for (const [id, page] of Object.entries(SYNTH_PAGE_BUTTONS)) hw.setStep(id, ui.synthPage === page ? 1 : 0)
    led('synth-lfo-mst-clk', synthLayer.lfo.sync)
    led('synth-arp-mst-clk', synthLayer.arp.sync)
    led('synth-osc-env-to-pitch', synthLayer.oscEnv.toPitch)
    led('synth-osc-velocity', synthLayer.oscEnv.velocity)
    led('synth-filter-velocity', synthLayer.filterEnv.velocity)
    led('synth-amp-velocity-1', synthLayer.ampEnv.velocity === 1 || synthLayer.ampEnv.velocity === 3)
    led('synth-amp-velocity-2', synthLayer.ampEnv.velocity >= 2)
    for (const [id, knob] of Object.entries(SYNTH_KNOBS)) {
      const [group, key] = knob.includes('.') ? knob.split('.') : [null, knob]
      const holder = (group ? (synthLayer as unknown as Record<string, Record<string, number>>)[group] : (synthLayer as unknown as Record<string, number>)) as Record<string, number>
      this.morphable(id, state, holder[key], describeSynthKnob(synthLayer, knob, bpm))
    }
    const wave = waveform(synthLayer.wave)
    for (const dial of ['synth-osc-dial-1', 'synth-osc-dial-2', 'synth-osc-dial-3']) {
      hw.setValueText(dial, `Synth ${LAYER_NAMES[synth.focus]}: ${wave.category} ${wave.name}, ${ui.synthPage} page`)
    }

    // ── Layer Effects ──
    const chain = fx.chains[fx.focus]
    const owner = chainOwner(fx.focus)
    hw.setStep('fx-on', fx.on ? 1 : 0)
    hw.setStep('fx-focus-organ', owner.section === 'organ' ? 1 : 0)
    hw.setStep('fx-focus-piano', owner.section !== 'piano' ? 0 : fx.pianoGroup ? 3 : owner.layer + 1)
    hw.setStep('fx-focus-synth', owner.section !== 'synth' ? 0 : fx.synthGroup ? 4 : owner.layer + 1)
    this.writeChain(chain, state)
    led('fx-delay-global', fx.global.delay)
    led('fx-comp-global', fx.global.comp)
    led('fx-reverb-global', fx.global.reverb)
    led('fx-delay-ping-pong', chain.delay.pingPong)
    led('fx-comp-fast', chain.comp.fast)
    led('fx-comp-active', fx.on && chain.comp.on && this.engine.compressor[fx.focus] === true)
    // The Drive LED shows that overdrive is actually being applied (manual p. 51).
    led('fx-drive-on', fx.on && chain.amp.on && chain.amp.drive > 0)
    led('fx-mod1-mst-clk', chain.mod1.sync)
    led('fx-delay-mst-clk', chain.delay.sync)

    for (const id of SHIFT_BUTTON_IDS) hw.setLatched(id, this.shiftLatched)
  }

  private writeChain(chain: FxChainState, state: StageState): void {
    const hw = this.hardware
    const { bpm } = state.clock
    hw.setStep('fx-mod1-type', chain.mod1.type)
    hw.setStep('fx-mod1-on', chain.mod1.on ? 1 : 0)
    this.morphable(
      'fx-mod1-rate',
      state,
      chain.mod1.rate,
      chain.mod1.sync
        ? `${clockDivision(chain.mod1.rate).label} at ${bpm} BPM`
        : chain.mod1.type === Mod1Type.RingMod
          ? formatHz(ringFrequency(chain.mod1.rate / 10))
          : chain.mod1.type === Mod1Type.AWah
            ? `sensitivity ${chain.mod1.rate.toFixed(1)}`
            : formatHz(mod1Rate(chain.mod1.rate / 10)),
    )
    this.morphable('fx-mod1-amount', state, chain.mod1.amount)
    hw.setStep('fx-mod2-type', chain.mod2.type)
    hw.setStep('fx-mod2-on', chain.mod2.on ? 1 : 0)
    this.morphable('fx-mod2-rate', state, chain.mod2.rate, formatHz(mod2Rate(chain.mod2.rate / 10)))
    this.morphable('fx-mod2-amount', state, chain.mod2.amount)

    hw.setStep('fx-amp-type', chain.amp.type)
    hw.setStep('fx-amp-on', chain.amp.on ? 1 : 0)
    this.morphable('fx-drive', state, chain.amp.drive)
    hw.setValue('fx-eq-bass', chain.amp.bass)
    hw.setValue('fx-eq-mid', chain.amp.mid)
    hw.setValue('fx-eq-treble', chain.amp.treble)
    const filter = chain.amp.type === AmpType.LP24 || chain.amp.type === AmpType.HP24
    this.morphable(
      'fx-eq-mid-freq',
      state,
      chain.amp.freq,
      filter ? `cutoff ${formatHz(filterFrequency(chain.amp.freq / 10))}` : formatHz(midFrequency(chain.amp.freq / 10)),
    )
    hw.setValueText('fx-eq-mid', filter ? `resonance ${(((chain.amp.mid + 15) / 30) * 10).toFixed(1)} of 10` : null)

    hw.setStep('fx-delay-on', chain.delay.on ? 1 : 0)
    hw.setStep('fx-delay-filter', chain.delay.filter)
    this.morphable(
      'fx-delay-tempo',
      state,
      chain.delay.tempo,
      chain.delay.sync ? `${clockDivision(chain.delay.tempo).label} at ${bpm} BPM` : `${Math.round(chain.delay.seconds * 1000)} ms`,
    )
    this.morphable('fx-delay-feedback', state, chain.delay.feedback)
    this.morphable('fx-delay-mix', state, chain.delay.mix)

    hw.setStep('fx-comp-on', chain.comp.on ? 1 : 0)
    hw.setValue('fx-comp-amount', chain.comp.amount)

    hw.setStep('fx-reverb-on', chain.reverb.on ? 1 : 0)
    hw.setStep('fx-reverb-type', chain.reverb.type)
    hw.setStep('fx-reverb-tone', chain.reverb.tone)
    this.morphable('fx-reverb-mix', state, chain.reverb.mix)
  }
}

function format(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
