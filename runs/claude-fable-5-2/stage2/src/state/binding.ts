import { AmpType, filterFrequency, midFrequency, mod1Rate, mod2Rate, ringFrequency, Mod1Type } from '../audio/dsp/params'
import { FUNCTIONAL_BUTTON_IDS, FUNCTIONAL_RANGE_IDS, SHIFT_BUTTON_IDS } from '../hardware/functional'
import type { HardwareStore, LedMode } from '../hardware/store'
import { PIANO_TYPES } from '../piano/catalog'
import {
  effectiveSoftRelease,
  effectiveStringRes,
  layerModel,
  routedToRotary,
  timbreCount,
  type FxChainState,
  type StageState,
} from './model'
import { formatHz, type FxParam, type StageStore } from './store'

/**
 * Connects the panel hardware to the canonical state, in both directions.
 *
 *  hardware → state: when a functional control is pressed or moved, the matching StageStore
 *                    action runs. A button's own stepping indicator is ignored: what the
 *                    press means is decided here, with Shift taken into account.
 *  state → hardware: after every change the panel is rewritten from the canonical state —
 *                    knob positions for the focused layer, selector LEDs, on/off LEDs, the
 *                    blinking focus LED, value texts. The panel can never drift from the sound.
 *
 * Shift: hold either Shift button (touch, or keyboard focus on it), or hold the computer's
 * Shift key, while operating a control. For a single mouse pointer, a click on Shift latches
 * it for the next control; a second click releases it.
 */

/** Sample sets that failed to load, and live meters, as seen by the audio engine. */
export interface EngineView {
  failedTypes: readonly number[]
  compressor: readonly boolean[]
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

const TYPE_LED_SLUGS = ['grand', 'upright', 'electric', 'clav', 'digital', 'misc'] as const
/** Two taps further apart than this start a new tempo instead of setting one. */
const TAP_TIMEOUT_MS = 2000

export class PanelBinder {
  private readonly hardware: HardwareStore
  private readonly stage: StageStore
  private readonly now: () => number
  private readonly seenPresses = new Map<string, number>()
  private readonly seenValues = new Map<string, number>()
  private unsubscribe: Array<() => void> = []
  private syncing = false
  private shiftKey = false
  private shiftLatched = false
  private shiftWasHeld = false
  private shiftUsed = false
  private lastTap: number | null = null
  private engine: EngineView = { failedTypes: [], compressor: [] }

  constructor(hardware: HardwareStore, stage: StageStore, now: () => number) {
    this.hardware = hardware
    this.stage = stage
    this.now = now
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

    let acted = false
    for (const id of FUNCTIONAL_BUTTON_IDS) {
      const count = hardware.getPressCount(id)
      const before = this.seenPresses.get(id) ?? 0
      if (count === before) continue
      this.seenPresses.set(id, count)
      acted = true
      for (let press = before; press < count; press += 1) this.onButton(id)
    }
    for (const id of FUNCTIONAL_RANGE_IDS) {
      const value = hardware.getValue(id)
      const before = this.seenValues.get(id) ?? value
      if (value === before) continue
      this.seenValues.set(id, value)
      acted = true
      this.onRange(id, value, before)
    }
    // Always finish by redrawing the panel from the canonical state: a button's own stepping
    // indicator is never the truth, and an action that changed nothing must still undo it.
    void acted
    this.sync()
  }

  private onButton(id: string): void {
    const stage = this.stage
    if ((SHIFT_BUTTON_IDS as readonly string[]).includes(id)) {
      // A Shift press that modified nothing toggles the latch; one that was used does not.
      if (!this.shiftUsed) this.shiftLatched = !this.shiftLatched
      this.shiftUsed = false
      this.sync()
      return
    }
    const shift = this.takeShift()
    switch (id) {
      case 'piano-on':
        stage.togglePianoOn()
        break
      case 'piano-layer-a':
        if (shift) stage.toggleSustPed()
        else stage.pressLayer(0)
        break
      case 'piano-layer-b':
        if (shift) stage.togglePStick()
        else stage.pressLayer(1)
        break
      case 'piano-type':
        // Shift + type is INFO, which the piano spec excludes.
        if (shift) stage.setNotice('Piano Info is not available')
        else stage.nextType()
        break
      case 'piano-timbre':
        stage.nextTimbre()
        break
      case 'piano-octave-down':
        // Shift + Octave Shift is KB Zone assignment, a Phase 3 feature.
        if (shift) stage.setNotice('KB Zones arrive in Phase 3')
        else stage.shiftOctave(-1)
        break
      case 'piano-octave-up':
        if (shift) stage.setNotice('KB Zones arrive in Phase 3')
        else stage.shiftOctave(1)
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
      case 'fx-on':
        stage.toggleFxOn()
        break
      case 'fx-focus-piano':
        if (shift) stage.toggleGroup()
        else stage.nextFxFocus()
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
      case 'rotary-speed':
        stage.toggleRotarySpeed()
        break
      case 'rotary-stop-mode':
        // Shift + Stop Mode is the stop Angle, which the effects spec excludes.
        if (shift) stage.setNotice('Rotary stop angle is not available')
        else stage.toggleRotaryStopMode()
        break
      default:
        this.sync()
    }
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

  private onRange(id: string, value: number, before: number): void {
    const stage = this.stage
    switch (id) {
      case 'perf-master-level':
        stage.setMaster(value)
        return
      case 'perf-pitch-stick':
        stage.setPitchStick(value)
        return
      case 'rotary-drive':
        stage.setRotaryDrive(value)
        return
      case 'piano-layer-a-level':
        stage.setLayerLevel(0, value)
        return
      case 'piano-layer-b-level':
        stage.setLayerLevel(1, value)
        return
      case 'piano-model': {
        // Endless dial: the shortest way round between two positions is the turn that was made.
        const span = 24
        let detents = value - before
        if (detents > span / 2) detents -= span
        if (detents < -span / 2) detents += span
        // Shift + dial is the List view, which is optional and not implemented.
        if (this.takeShift()) stage.setNotice('Model List view is not available')
        else stage.turnModel(Math.round(detents))
        return
      }
      case 'fx-comp-amount':
        // Shift + Amount switches Fast mode: clockwise on, anticlockwise off. The amount stays put.
        if (this.takeShift()) {
          stage.setCompFast(value > before)
          return
        }
        stage.setFxParam(FX_KNOBS[id], value)
        return
      default: {
        const param = FX_KNOBS[id]
        if (param) stage.setFxParam(param, value)
        else this.sync()
      }
    }
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

  private write(state: StageState): void {
    const hw = this.hardware
    const { piano, fx, rotary } = state
    const layer = piano.layers[piano.focus]
    const chain = fx.chains[fx.focus]
    const led = (slug: string, mode: LedMode | boolean) =>
      hw.setLed(`led-${slug}`, mode === true ? 'on' : mode === false ? 'off' : mode)

    // Performance band.
    hw.setValue('perf-master-level', state.master)
    hw.setValue('rotary-drive', rotary.drive)
    hw.setStep('rotary-speed', rotary.fast ? 1 : 0)
    hw.setStep('rotary-stop-mode', rotary.stopMode ? 1 : 0)
    led('rotary-on', piano.on && [0, 1].some((index) => piano.layers[index].on && routedToRotary(state, index)))

    // Piano section.
    hw.setStep('piano-on', piano.on ? 1 : 0)
    led('piano-fx-focus', true)
    led('piano-sustped', piano.sustPed)
    led('piano-pstick', piano.pStick)
    const both = piano.layers[0].on && piano.layers[1].on
    ;(['a', 'b'] as const).forEach((letter, index) => {
      const item = piano.layers[index]
      hw.setStep(`piano-layer-${letter}`, item.on ? 1 : 0)
      // With both layers on, the focused one blinks (manual p. 23).
      led(`piano-layer-${letter}`, !item.on ? 'off' : both && piano.focus === index ? 'blink' : 'on')
      hw.setValue(`piano-layer-${letter}-level`, item.level)
    })
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

    // Layer Effects.
    hw.setStep('fx-on', fx.on ? 1 : 0)
    hw.setStep('fx-focus-piano', fx.group ? 3 : fx.focus + 1)
    this.writeChain(chain)
    led('fx-delay-global', fx.global.delay)
    led('fx-comp-global', fx.global.comp)
    led('fx-reverb-global', fx.global.reverb)
    led('fx-delay-ping-pong', chain.delay.pingPong)
    led('fx-comp-fast', chain.comp.fast)
    led('fx-comp-active', fx.on && chain.comp.on && this.engine.compressor[fx.focus] === true)
    // The Drive LED shows that overdrive is actually being applied (manual p. 51).
    led('fx-drive-on', fx.on && chain.amp.on && chain.amp.drive > 0)

    for (const id of SHIFT_BUTTON_IDS) hw.setLatched(id, this.shiftLatched)
  }

  private writeChain(chain: FxChainState): void {
    const hw = this.hardware
    hw.setStep('fx-mod1-type', chain.mod1.type)
    hw.setStep('fx-mod1-on', chain.mod1.on ? 1 : 0)
    hw.setValue('fx-mod1-rate', chain.mod1.rate)
    hw.setValue('fx-mod1-amount', chain.mod1.amount)
    hw.setValueText(
      'fx-mod1-rate',
      chain.mod1.type === Mod1Type.RingMod
        ? formatHz(ringFrequency(chain.mod1.rate / 10))
        : chain.mod1.type === Mod1Type.AWah
          ? `sensitivity ${chain.mod1.rate.toFixed(1)}`
          : formatHz(mod1Rate(chain.mod1.rate / 10)),
    )
    hw.setStep('fx-mod2-type', chain.mod2.type)
    hw.setStep('fx-mod2-on', chain.mod2.on ? 1 : 0)
    hw.setValue('fx-mod2-rate', chain.mod2.rate)
    hw.setValue('fx-mod2-amount', chain.mod2.amount)
    hw.setValueText('fx-mod2-rate', formatHz(mod2Rate(chain.mod2.rate / 10)))

    hw.setStep('fx-amp-type', chain.amp.type)
    hw.setStep('fx-amp-on', chain.amp.on ? 1 : 0)
    hw.setValue('fx-drive', chain.amp.drive)
    hw.setValue('fx-eq-bass', chain.amp.bass)
    hw.setValue('fx-eq-mid', chain.amp.mid)
    hw.setValue('fx-eq-mid-freq', chain.amp.freq)
    hw.setValue('fx-eq-treble', chain.amp.treble)
    const filter = chain.amp.type === AmpType.LP24 || chain.amp.type === AmpType.HP24
    hw.setValueText(
      'fx-eq-mid-freq',
      filter ? `cutoff ${formatHz(filterFrequency(chain.amp.freq / 10))}` : formatHz(midFrequency(chain.amp.freq / 10)),
    )
    hw.setValueText('fx-eq-mid', filter ? `resonance ${(((chain.amp.mid + 15) / 30) * 10).toFixed(1)} of 10` : null)

    hw.setStep('fx-delay-on', chain.delay.on ? 1 : 0)
    hw.setStep('fx-delay-filter', chain.delay.filter)
    hw.setValue('fx-delay-tempo', chain.delay.tempo)
    hw.setValue('fx-delay-feedback', chain.delay.feedback)
    hw.setValue('fx-delay-mix', chain.delay.mix)
    hw.setValueText('fx-delay-tempo', `${Math.round(chain.delay.seconds * 1000)} ms`)

    hw.setStep('fx-comp-on', chain.comp.on ? 1 : 0)
    hw.setValue('fx-comp-amount', chain.comp.amount)

    hw.setStep('fx-reverb-on', chain.reverb.on ? 1 : 0)
    hw.setStep('fx-reverb-type', chain.reverb.type)
    hw.setStep('fx-reverb-tone', chain.reverb.tone)
    hw.setValue('fx-reverb-mix', chain.reverb.mix)
  }
}
