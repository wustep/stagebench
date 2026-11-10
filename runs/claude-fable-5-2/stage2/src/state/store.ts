import { AmpType, DELAY_MAX_SECONDS, DELAY_MIN_SECONDS, delayKnobToSeconds, delaySecondsToKnob } from '../audio/dsp/params'
import { PIANO_TYPES } from '../piano/catalog'
import {
  AMP_TYPES,
  DELAY_FILTERS,
  GLOBAL_UNITS,
  KB_TOUCHES,
  LAYER_NAMES,
  LEVELS,
  MOD1_TYPES,
  MOD2_TYPES,
  REVERB_TONES,
  REVERB_TYPES,
  TIMBRES,
  UNIT_NAMES,
  createInitialState,
  effectiveSoftRelease,
  effectiveStringRes,
  fxTargets,
  layerModel,
  modelCount,
  timbreCount,
  type FxChainState,
  type GlobalUnitId,
  type PianoLayerState,
  type StageState,
  type UnitId,
} from './model'

type Listener = () => void

/** Knob parameters of the effect units, by unit. */
export type FxParam =
  | ['mod1', 'rate' | 'amount']
  | ['mod2', 'rate' | 'amount']
  | ['delay', 'tempo' | 'feedback' | 'mix']
  | ['amp', 'drive' | 'bass' | 'mid' | 'freq' | 'treble']
  | ['comp', 'amount']
  | ['reverb', 'mix']

const TYPE_LISTS: Partial<Record<UnitId, readonly string[]>> = {
  mod1: MOD1_TYPES,
  mod2: MOD2_TYPES,
  amp: AMP_TYPES,
  reverb: REVERB_TYPES,
}

/**
 * The canonical state and every action that can change it. Panel controls (through the
 * binder), tests, and nothing else call these methods; the audio engine and the UI only read.
 * Each action is a complete, named panel operation — the same thing a hand does on the
 * instrument — so there is exactly one implementation of what a control means.
 */
export class StageStore {
  private state: StageState = createInitialState()
  private listeners = new Set<Listener>()

  getState = (): StageState => this.state

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  get listenerCount(): number {
    return this.listeners.size
  }

  reset(): void {
    this.state = createInitialState()
    this.emit()
  }

  private update(change: (draft: StageState) => void): void {
    const draft = structuredClone(this.state)
    change(draft)
    this.state = draft
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  // ── Master, rotary, pitch stick ─────────────────────────────────────────────

  setMaster(value: number): void {
    this.update((s) => {
      s.master = clamp(value, 0, 10)
      s.notice = `Master Level ${s.master.toFixed(1)}`
    })
  }

  setPitchStick(value: number): void {
    if (value === this.state.pitchStick) return
    this.update((s) => {
      s.pitchStick = clamp(value, -100, 100)
    })
  }

  toggleRotarySpeed(): void {
    this.update((s) => {
      s.rotary.fast = !s.rotary.fast
      s.notice = `Rotary ${s.rotary.fast ? 'Fast' : s.rotary.stopMode ? 'Stop' : 'Slow'}`
    })
  }

  toggleRotaryStopMode(): void {
    this.update((s) => {
      s.rotary.stopMode = !s.rotary.stopMode
      s.notice = `Rotary Stop Mode ${s.rotary.stopMode ? 'On' : 'Off'}`
    })
  }

  setRotaryDrive(value: number): void {
    this.update((s) => {
      s.rotary.drive = clamp(value, 0, 10)
      s.notice = `Rotary Drive ${s.rotary.drive.toFixed(1)}`
    })
  }

  // ── Piano section ───────────────────────────────────────────────────────────

  togglePianoOn(): void {
    this.update((s) => {
      s.piano.on = !s.piano.on
      s.notice = `Piano ${s.piano.on ? 'On' : 'Off'}`
    })
  }

  /**
   * A layer button. Off → the layer turns on and takes focus. On but not focused → it takes
   * focus. On and focused → it turns off and focus passes to the other layer (the last layer
   * stays on; the section's On button silences the Piano). Effect focus follows.
   */
  pressLayer(index: number): void {
    this.update((s) => {
      const layer = s.piano.layers[index]
      const other = s.piano.layers[1 - index]
      if (!layer.on) {
        layer.on = true
        focus(s, index)
        s.notice = `Layer ${LAYER_NAMES[index]} On`
      } else if (s.piano.focus !== index) {
        focus(s, index)
        s.notice = `Layer ${LAYER_NAMES[index]} focus`
      } else if (other.on) {
        layer.on = false
        focus(s, 1 - index)
        s.notice = `Layer ${LAYER_NAMES[index]} Off`
      } else {
        s.notice = `Layer ${LAYER_NAMES[index]} is the only layer on`
      }
    })
  }

  /** Set a layer on or off directly (keeps at least the focus valid). */
  setLayerOn(index: number, on: boolean): void {
    this.update((s) => {
      s.piano.layers[index].on = on
      if (on) focus(s, index)
      else if (s.piano.focus === index && s.piano.layers[1 - index].on) focus(s, 1 - index)
    })
  }

  focusLayer(index: number): void {
    this.update((s) => focus(s, index))
  }

  toggleSustPed(): void {
    this.update((s) => {
      s.piano.sustPed = !s.piano.sustPed
      s.notice = `Sustain Pedal ${s.piano.sustPed ? 'On' : 'Off'}`
    })
  }

  togglePStick(): void {
    this.update((s) => {
      s.piano.pStick = !s.piano.pStick
      s.notice = `Pitch Stick ${s.piano.pStick ? 'On' : 'Off'}`
    })
  }

  setLayerLevel(index: number, value: number): void {
    this.update((s) => {
      s.piano.layers[index].level = clamp(value, 0, 100)
      s.notice = `Layer ${LAYER_NAMES[index]} Level ${Math.round(s.piano.layers[index].level)}`
    })
  }

  shiftOctave(direction: -1 | 1): void {
    this.editLayer((layer, s, name) => {
      layer.octave = clamp(layer.octave + direction, -1, 1)
      s.notice = `Layer ${name} Octave ${layer.octave > 0 ? '+' : ''}${layer.octave}`
    })
  }

  /** The Piano Select type button: next of the six types. */
  nextType(): void {
    this.setType((this.focused().type + 1) % PIANO_TYPES.length)
  }

  setType(type: number): void {
    this.editLayer((layer, s, name) => {
      layer.type = clamp(Math.round(type), 0, PIANO_TYPES.length - 1)
      if (layer.timbre >= timbreCount(layer)) layer.timbre = 0
      s.notice = `Layer ${name}: ${layerModel(layer).name}`
    })
  }

  /** The Piano Select dial: step through the models of the current type (stops at either end). */
  turnModel(detents: number): void {
    this.editLayer((layer, s, name) => {
      const next = clamp((layer.models[layer.type] ?? 0) + detents, 0, modelCount(layer) - 1)
      layer.models[layer.type] = next
      if (layer.timbre >= timbreCount(layer)) layer.timbre = 0
      s.notice = `Layer ${name}: ${layerModel(layer).name} (${next + 1}/${modelCount(layer)})`
    })
  }

  nextTimbre(): void {
    this.editLayer((layer, s) => {
      layer.timbre = (layer.timbre + 1) % timbreCount(layer)
      s.notice = `Timbre ${TIMBRES[layer.timbre]}`
    })
  }

  setTimbre(timbre: number): void {
    this.editLayer((layer) => {
      layer.timbre = clamp(Math.round(timbre), 0, timbreCount(layer) - 1)
    })
  }

  nextKbTouch(): void {
    this.editLayer((layer, s) => {
      layer.kbTouch = (layer.kbTouch + 1) % KB_TOUCHES.length
      s.notice = `KB Touch ${KB_TOUCHES[layer.kbTouch]}`
    })
  }

  nextDynComp(): void {
    this.editLayer((layer, s) => {
      layer.dynComp = (layer.dynComp + 1) % LEVELS.length
      s.notice = `Dyn Comp ${LEVELS[layer.dynComp]}`
    })
  }

  nextUnison(): void {
    this.editLayer((layer, s) => {
      layer.unison = (layer.unison + 1) % LEVELS.length
      s.notice = `Unison ${LEVELS[layer.unison]}`
    })
  }

  /**
   * The Acoustics button steps Off → Soft Release → String Res → both, skipping whatever the
   * current model does not support (no Soft Release on a Clav, no string resonance without strings).
   */
  nextAcoustics(): void {
    this.editLayer((layer, s) => {
      const model = layerModel(layer)
      const options: Array<[boolean, boolean]> = [[false, false]]
      if (model.softRelease) options.push([true, false])
      if (model.stringRes) options.push([false, true])
      if (model.softRelease && model.stringRes) options.push([true, true])
      const now = options.findIndex(
        ([soft, res]) => soft === effectiveSoftRelease(layer) && res === effectiveStringRes(layer),
      )
      const [soft, res] = options[(now + 1) % options.length]
      if (model.softRelease) layer.softRelease = soft
      if (model.stringRes) layer.stringRes = res
      s.notice =
        options.length === 1
          ? `${model.name}: no Soft Release or String Res`
          : `Soft Release ${soft ? 'On' : 'Off'}, String Res ${res ? 'On' : 'Off'}`
    })
  }

  setLayer(index: number, change: (layer: PianoLayerState) => void): void {
    this.update((s) => change(s.piano.layers[index]))
  }

  // ── Layer Effects ───────────────────────────────────────────────────────────

  toggleFxOn(): void {
    this.update((s) => {
      s.fx.on = !s.fx.on
      s.notice = s.fx.on ? 'Layer Effects On' : 'All Effects Off'
    })
  }

  /** The FX Focus Piano button: move effect focus to the other Piano layer. */
  nextFxFocus(): void {
    this.update((s) => {
      s.fx.focus = 1 - s.fx.focus
      s.notice = `FX Focus Piano ${LAYER_NAMES[s.fx.focus]}`
    })
  }

  setFxFocus(index: number): void {
    this.update((s) => {
      s.fx.focus = index === 1 ? 1 : 0
    })
  }

  /** Group (Shift + FX Focus Piano): entering copies the focused layer's effects to the other layer. */
  toggleGroup(): void {
    this.update((s) => {
      s.fx.group = !s.fx.group
      if (s.fx.group) s.fx.chains[1 - s.fx.focus] = structuredClone(s.fx.chains[s.fx.focus])
      s.notice = `Piano FX Group ${s.fx.group ? 'On' : 'Off'}`
    })
  }

  /** A unit's On button. */
  toggleUnit(unit: UnitId): void {
    this.update((s) => {
      const on = !s.fx.chains[s.fx.focus][unit].on
      for (const index of fxTargets(s, unit)) s.fx.chains[index][unit].on = on
      s.notice = `${UNIT_NAMES[unit]} ${on ? 'On' : 'Off'}`
    })
  }

  /** Global (Shift + On) for Delay, Compressor, Reverb: entering copies the focused unit to every layer. */
  toggleGlobal(unit: GlobalUnitId): void {
    this.update((s) => {
      s.fx.global[unit] = !s.fx.global[unit]
      if (s.fx.global[unit]) {
        const source = s.fx.chains[s.fx.focus]
        const target = s.fx.chains[1 - s.fx.focus]
        if (unit === 'delay') target.delay = { ...source.delay }
        else if (unit === 'comp') target.comp = { ...source.comp }
        else target.reverb = { ...source.reverb }
      }
      s.notice = `${UNIT_NAMES[unit]} Global ${s.fx.global[unit] ? 'On' : 'Off'}`
    })
  }

  /** A unit's type selector: next type. */
  nextUnitType(unit: 'mod1' | 'mod2' | 'amp' | 'reverb'): void {
    const list = TYPE_LISTS[unit] ?? []
    this.setUnitType(unit, (this.state.fx.chains[this.state.fx.focus][unit].type + 1) % list.length)
  }

  setUnitType(unit: 'mod1' | 'mod2' | 'amp' | 'reverb', type: number): void {
    const list = TYPE_LISTS[unit] ?? []
    this.update((s) => {
      const next = clamp(Math.round(type), 0, list.length - 1)
      for (const index of fxTargets(s, unit)) s.fx.chains[index][unit].type = next
      s.notice = `${UNIT_NAMES[unit]}: ${list[next]}`
    })
  }

  nextDelayFilter(): void {
    this.update((s) => {
      const next = (s.fx.chains[s.fx.focus].delay.filter + 1) % DELAY_FILTERS.length
      for (const index of fxTargets(s, 'delay')) s.fx.chains[index].delay.filter = next
      s.notice = `Delay Filter ${DELAY_FILTERS[next]}`
    })
  }

  toggleDelayPingPong(): void {
    this.update((s) => {
      const next = !s.fx.chains[s.fx.focus].delay.pingPong
      for (const index of fxTargets(s, 'delay')) s.fx.chains[index].delay.pingPong = next
      s.notice = `Delay Ping Pong ${next ? 'On' : 'Off'}`
    })
  }

  nextReverbTone(): void {
    this.update((s) => {
      const next = (s.fx.chains[s.fx.focus].reverb.tone + 1) % REVERB_TONES.length
      for (const index of fxTargets(s, 'reverb')) s.fx.chains[index].reverb.tone = next
      s.notice = `Reverb ${REVERB_TONES[next] === 'Off' ? 'Bright/Dark Off' : REVERB_TONES[next]}`
    })
  }

  setCompFast(fast: boolean): void {
    this.update((s) => {
      for (const index of fxTargets(s, 'comp')) s.fx.chains[index].comp.fast = fast
      s.notice = `Compressor Fast ${fast ? 'On' : 'Off'}`
    })
  }

  /** A knob of an effect unit, in panel units. */
  setFxParam(param: FxParam, value: number): void {
    const [unit, name] = param
    this.update((s) => {
      for (const index of fxTargets(s, unit)) {
        const chain = s.fx.chains[index]
        const target = chain[unit] as unknown as Record<string, number>
        const bipolar = unit === 'amp' && (name === 'bass' || name === 'mid' || name === 'treble')
        target[name] = bipolar ? clamp(value, -15, 15) : clamp(value, 0, 10)
        if (unit === 'delay' && name === 'tempo') chain.delay.seconds = delayKnobToSeconds(chain.delay.tempo / 10)
      }
      s.notice = describeParam(s.fx.chains[s.fx.focus], param)
    })
  }

  /** Tap tempo: set the delay time to an exact interval; the Tempo knob follows. */
  setDelaySeconds(seconds: number): void {
    this.update((s) => {
      const time = clamp(seconds, DELAY_MIN_SECONDS, DELAY_MAX_SECONDS)
      for (const index of fxTargets(s, 'delay')) {
        s.fx.chains[index].delay.seconds = time
        s.fx.chains[index].delay.tempo = Math.round(delaySecondsToKnob(time) * 100) / 10
      }
      s.notice = `Delay Tap ${Math.round(time * 1000)} ms (${Math.round(60 / time)} BPM)`
    })
  }

  setChain(index: number, change: (chain: FxChainState) => void): void {
    this.update((s) => change(s.fx.chains[index]))
  }

  setNotice(notice: string): void {
    if (notice === this.state.notice) return
    this.update((s) => {
      s.notice = notice
    })
  }

  private focused(): PianoLayerState {
    return this.state.piano.layers[this.state.piano.focus]
  }

  private editLayer(change: (layer: PianoLayerState, state: StageState, name: string) => void): void {
    this.update((s) => change(s.piano.layers[s.piano.focus], s, LAYER_NAMES[s.piano.focus]))
  }
}

/** Pressing a Piano layer button focuses the layer and, with it, its effects (manual p. 23, 48). */
function focus(state: StageState, index: number): void {
  state.piano.focus = index
  state.fx.focus = index
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function formatHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)} kHz` : `${hz >= 100 ? Math.round(hz) : hz.toFixed(hz >= 10 ? 1 : 2)} Hz`
}

export function describeParam(chain: FxChainState, [unit, name]: FxParam): string {
  const label = UNIT_NAMES[unit]
  if (unit === 'delay' && name === 'tempo') return `Delay ${Math.round(chain.delay.seconds * 1000)} ms`
  if (unit === 'amp') {
    const filter = chain.amp.type === AmpType.LP24 || chain.amp.type === AmpType.HP24
    if (name === 'freq') return filter ? `Filter Freq ${chain.amp.freq.toFixed(1)}` : `EQ Mid Freq ${chain.amp.freq.toFixed(1)}`
    if (name === 'mid') return filter ? `Filter Res ${(((chain.amp.mid + 15) / 30) * 10).toFixed(1)}` : `EQ Mid ${signed(chain.amp.mid)} dB`
    if (name === 'bass') return `EQ Bass ${signed(chain.amp.bass)} dB`
    if (name === 'treble') return `EQ Treble ${signed(chain.amp.treble)} dB`
    return `Drive ${chain.amp.drive.toFixed(1)}`
  }
  const value = (chain[unit] as unknown as Record<string, number>)[name]
  const title = name === 'mix' ? 'Dry/Wet' : name.charAt(0).toUpperCase() + name.slice(1)
  return `${label} ${title} ${value.toFixed(1)}`
}

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}`
}

export { GLOBAL_UNITS }
