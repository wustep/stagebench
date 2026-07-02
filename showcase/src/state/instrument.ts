import { useSyncExternalStore } from 'react'
import { INSTRUMENTS, instrumentsOfType, PIANO_TYPES, type PianoType } from '../audio/library'

/**
 * Canonical Phase 2 instrument state: two Piano layers, per-layer effect
 * chains, effect focus/group/global routing, rotary, master volume.
 *
 * Honesty contract: everything in this store is REAL — the audio engine
 * subscribes to it and every field here audibly changes the signal graph
 * (or, for selection of unpopulated piano types, truthfully reports
 * "Piano not found"). Presentation-only controls (Organ/Synth/Program,
 * Phase 3 scope) never write here; they stay in the panel store.
 */

export type LayerId = 'A' | 'B'

export type Mod1Type = 'A-Pan' | 'Tremolo' | 'Ring Mod' | 'A-Wah' | 'Wah' | 'Pump'
export type Mod2Type = 'Phaser' | 'Flanger' | 'Vibe' | 'Chorus' | 'Ensemble' | 'Spin'
export type AmpType = 'Neutral EQ' | 'Twin' | 'JC' | 'Small' | 'LP24 Filter' | 'HP24 Filter' | 'To Rotary'
export type ReverbType = 'Room' | 'Stage' | 'Booth' | 'Hall' | 'Spring' | 'Cathedral'
export type DelayFilter = 'Off' | 'Low Pass' | 'High Pass' | 'Band Pass'
export type DelayEffect = 'Off' | 'Chorus' | 'Vibe' | 'Ensemble' | 'Flam' | 'Space'
export type RotarySpeed = 'slow' | 'fast' | 'stop'

export const MOD1_TYPES: readonly Mod1Type[] = ['A-Pan', 'Tremolo', 'Ring Mod', 'A-Wah', 'Wah', 'Pump']
export const MOD2_TYPES: readonly Mod2Type[] = ['Phaser', 'Flanger', 'Vibe', 'Chorus', 'Ensemble', 'Spin']
export const AMP_TYPES: readonly AmpType[] = ['Neutral EQ', 'Twin', 'JC', 'Small', 'LP24 Filter', 'HP24 Filter', 'To Rotary']
export const REVERB_TYPES: readonly ReverbType[] = ['Room', 'Stage', 'Booth', 'Hall', 'Spring', 'Cathedral']
export const DELAY_FILTERS: readonly DelayFilter[] = ['Off', 'Low Pass', 'High Pass', 'Band Pass']
export const DELAY_EFFECTS: readonly DelayEffect[] = ['Off', 'Chorus', 'Vibe', 'Ensemble', 'Flam', 'Space']

export interface Mod1State { on: boolean; type: Mod1Type; rate: number; amount: number }
export interface Mod2State { on: boolean; type: Mod2Type; rate: number; amount: number }
export interface DelayState {
  on: boolean
  tempo: number // 0..127 -> 20..1400 ms
  feedback: number // 0..127
  mix: number // 0..127 dry..wet
  filter: DelayFilter
  effect: DelayEffect
  analog: boolean
}
export interface AmpEqState {
  on: boolean
  type: AmpType
  drive: number
  bass: number
  mid: number
  treble: number
  freq: number // mid frequency / filter cutoff, 0..127
}
export interface CompState { on: boolean; amount: number; fast: boolean }
export interface ReverbState { on: boolean; type: ReverbType; mix: number; bright: boolean }

export interface EffectChainState {
  mod1: Mod1State
  mod2: Mod2State
  delay: DelayState
  ampEq: AmpEqState
  comp: CompState
  reverb: ReverbState
}

export interface PianoLayerState {
  enabled: boolean
  level: number // 0..127
  octave: -1 | 0 | 1
  type: PianoType
  /** Index into instrumentsOfType(type); selection of an unpopulated type keeps the previous audible instrument. */
  model: number
}

export interface PianoSharedState {
  sectionOn: boolean
  kbTouch: 0 | 1 | 2 // Heavy, Mid, Light
  dynComp: 0 | 1 | 2 | 3
  timbre: number // index into the timbre list for the focused layer's family
  unison: 0 | 1 | 2 | 3
  softRelease: boolean
  stringRes: boolean
  pedNoise: boolean
}

export interface InstrumentState {
  masterVolume: number // 0..127
  piano: PianoSharedState
  layers: Record<LayerId, PianoLayerState>
  focusedLayer: LayerId
  /** When true (Group mode), effect edits apply to both piano layer chains. */
  fxGroupPiano: boolean
  allFxOff: boolean
  chains: Record<LayerId, EffectChainState>
  fxGlobal: { delay: boolean; comp: boolean; reverb: boolean }
  rotary: { speed: RotarySpeed; drive: number }
  /** Truthful last-edit readout shown on the Program display. */
  lastEdit: string
  /** Set when a Clav/Digital/Misc type with no bundled model is selected. */
  pianoNotFound: PianoType | null
}

export const ACOUSTIC_TIMBRES = ['Off', 'Soft', 'Mid', 'Bright'] as const
export const ELECTRIC_TIMBRES = ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2'] as const

export function timbreListFor(type: PianoType): readonly string[] {
  return type === 'Electric' ? ELECTRIC_TIMBRES : ACOUSTIC_TIMBRES
}

function defaultChain(): EffectChainState {
  // Continuous defaults match the panel's initial knob pose (64 = 12 o'clock).
  return {
    mod1: { on: false, type: 'Tremolo', rate: 64, amount: 64 },
    mod2: { on: false, type: 'Chorus', rate: 64, amount: 64 },
    delay: { on: false, tempo: 64, feedback: 64, mix: 64, filter: 'Off', effect: 'Off', analog: false },
    ampEq: { on: false, type: 'Neutral EQ', drive: 64, bass: 64, mid: 64, treble: 64, freq: 64 },
    comp: { on: false, amount: 64, fast: false },
    reverb: { on: false, type: 'Hall', mix: 64, bright: true },
  }
}

export function initialInstrumentState(): InstrumentState {
  return {
    masterVolume: 100,
    piano: {
      sectionOn: true,
      kbTouch: 0,
      dynComp: 0,
      timbre: 0,
      unison: 0,
      softRelease: false,
      stringRes: false,
      pedNoise: false,
    },
    layers: {
      A: { enabled: true, level: 100, octave: 0, type: 'Grand', model: 0 },
      B: { enabled: false, level: 100, octave: 0, type: 'Electric', model: 0 },
    },
    focusedLayer: 'A',
    fxGroupPiano: false,
    allFxOff: false,
    chains: { A: defaultChain(), B: defaultChain() },
    fxGlobal: { delay: false, comp: false, reverb: false },
    rotary: { speed: 'slow', drive: 64 },
    lastEdit: '',
    pianoNotFound: null,
  }
}

export function selectedInstrumentId(layer: PianoLayerState): string | null {
  const models = instrumentsOfType(layer.type)
  return models[layer.model]?.id ?? null
}

type Listener = () => void

export class InstrumentStore {
  private state: InstrumentState = initialInstrumentState()
  private listeners = new Set<Listener>()

  getState = (): InstrumentState => this.state

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private commit(next: InstrumentState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }

  private patch(partial: Partial<InstrumentState>, lastEdit?: string): void {
    this.commit({ ...this.state, ...partial, lastEdit: lastEdit ?? this.state.lastEdit })
  }

  /* ------------------------------------------------------------ master -- */

  setMasterVolume(value: number): void {
    const clamped = clamp(value)
    this.patch({ masterVolume: clamped }, `Master Level ${clamped}`)
  }

  /* ------------------------------------------------------- piano layers -- */

  setLayerEnabled(layer: LayerId, enabled: boolean): void {
    const layers = { ...this.state.layers, [layer]: { ...this.state.layers[layer], enabled } }
    // Focus follows the layer being switched on; focusing a disabled layer is allowed on hardware.
    const focusedLayer = enabled ? layer : this.state.focusedLayer
    this.patch({ layers, focusedLayer }, `Piano ${layer} ${enabled ? 'On' : 'Off'}`)
  }

  toggleLayerEnabled(layer: LayerId): void {
    this.setLayerEnabled(layer, !this.state.layers[layer].enabled)
  }

  setLayerLevel(layer: LayerId, level: number): void {
    const clamped = clamp(level)
    const layers = { ...this.state.layers, [layer]: { ...this.state.layers[layer], level: clamped } }
    this.patch({ layers }, `Piano ${layer} Level ${clamped}`)
  }

  setFocusedLayer(layer: LayerId): void {
    this.patch({ focusedLayer: layer }, `FX Focus Piano ${layer}`)
  }

  cycleFocusedLayer(): void {
    this.setFocusedLayer(this.state.focusedLayer === 'A' ? 'B' : 'A')
  }

  shiftOctave(layer: LayerId, delta: -1 | 1): void {
    const current = this.state.layers[layer].octave
    const next = Math.max(-1, Math.min(1, current + delta)) as -1 | 0 | 1
    const layers = { ...this.state.layers, [layer]: { ...this.state.layers[layer], octave: next } }
    this.patch({ layers }, `Piano ${layer} Octave ${next > 0 ? `+${next}` : next}`)
  }

  setPianoSectionOn(on: boolean): void {
    this.patch({ piano: { ...this.state.piano, sectionOn: on } }, `Piano Section ${on ? 'On' : 'Off'}`)
  }

  /* ---------------------------------------------------- piano selection -- */

  cyclePianoType(): void {
    const layer = this.state.focusedLayer
    const current = this.state.layers[layer].type
    const nextType = PIANO_TYPES[(PIANO_TYPES.indexOf(current) + 1) % PIANO_TYPES.length]!
    this.selectPianoType(nextType)
  }

  selectPianoType(type: PianoType): void {
    const layer = this.state.focusedLayer
    const populated = instrumentsOfType(type).length > 0
    const layers = { ...this.state.layers, [layer]: { ...this.state.layers[layer], type, model: 0 } }
    this.patch(
      { layers, pianoNotFound: populated ? null : type },
      populated ? `Piano ${layer}: ${instrumentsOfType(type)[0]!.name}` : `Piano not found (${type})`,
    )
  }

  selectPianoModel(model: number): void {
    const layer = this.state.focusedLayer
    const models = instrumentsOfType(this.state.layers[layer].type)
    if (models.length === 0) return
    const clamped = Math.max(0, Math.min(models.length - 1, Math.round(model)))
    const layers = { ...this.state.layers, [layer]: { ...this.state.layers[layer], model: clamped } }
    this.patch({ layers, pianoNotFound: null }, `Piano ${layer}: ${models[clamped]!.name}`)
  }

  /* -------------------------------------------------- piano performance -- */

  cycleKbTouch(): void {
    const next = ((this.state.piano.kbTouch + 1) % 3) as 0 | 1 | 2
    this.patch({ piano: { ...this.state.piano, kbTouch: next } }, `KB Touch ${['Heavy', 'Mid', 'Light'][next]}`)
  }

  cycleDynComp(): void {
    const next = ((this.state.piano.dynComp + 1) % 4) as 0 | 1 | 2 | 3
    this.patch({ piano: { ...this.state.piano, dynComp: next } }, `Dyn Comp ${next === 0 ? 'Off' : next}`)
  }

  cycleTimbre(): void {
    const list = timbreListFor(this.state.layers[this.state.focusedLayer].type)
    const next = (this.state.piano.timbre + 1) % list.length
    this.patch({ piano: { ...this.state.piano, timbre: next } }, `Timbre ${list[next]}`)
  }

  cycleUnison(): void {
    const next = ((this.state.piano.unison + 1) % 4) as 0 | 1 | 2 | 3
    this.patch({ piano: { ...this.state.piano, unison: next } }, `Unison ${next === 0 ? 'Off' : next}`)
  }

  cycleAcoustics(): void {
    // One button steps through: none -> Soft Rel -> +String Res -> +Ped Noise -> none.
    const { softRelease, stringRes, pedNoise } = this.state.piano
    let next: Pick<PianoSharedState, 'softRelease' | 'stringRes' | 'pedNoise'>
    if (!softRelease && !stringRes) next = { softRelease: true, stringRes: false, pedNoise: false }
    else if (softRelease && !stringRes) next = { softRelease: true, stringRes: true, pedNoise: false }
    else if (!pedNoise) next = { softRelease: true, stringRes: true, pedNoise: true }
    else next = { softRelease: false, stringRes: false, pedNoise: false }
    const label = next.pedNoise
      ? 'Acoustics: SoftRel+StringRes+PedNoise'
      : next.stringRes
        ? 'Acoustics: SoftRel+StringRes'
        : next.softRelease
          ? 'Acoustics: Soft Release'
          : 'Acoustics: Off'
    this.patch({ piano: { ...this.state.piano, ...next } }, label)
  }

  /* ------------------------------------------------------------ effects -- */

  /** Chains an effect edit targets: focused layer, or both in Group/global mode. */
  private targetLayers(unit: keyof EffectChainState): LayerId[] {
    const global = (unit === 'delay' && this.state.fxGlobal.delay) || (unit === 'comp' && this.state.fxGlobal.comp) || (unit === 'reverb' && this.state.fxGlobal.reverb)
    if (global || this.state.fxGroupPiano) return ['A', 'B']
    return [this.state.focusedLayer]
  }

  updateUnit<K extends keyof EffectChainState>(unit: K, partial: Partial<EffectChainState[K]>, label?: string): void {
    const chains = { ...this.state.chains }
    for (const layer of this.targetLayers(unit)) {
      chains[layer] = { ...chains[layer], [unit]: { ...chains[layer][unit], ...partial } }
    }
    this.patch({ chains }, label)
  }

  toggleUnitOn(unit: keyof EffectChainState): void {
    const on = !this.state.chains[this.state.focusedLayer][unit].on
    this.updateUnit(unit, { on } as never, `${unitLabel(unit)} ${on ? 'On' : 'Off'}`)
  }

  cycleMod1Type(): void {
    const current = this.state.chains[this.state.focusedLayer].mod1.type
    const next = MOD1_TYPES[(MOD1_TYPES.indexOf(current) + 1) % MOD1_TYPES.length]!
    this.updateUnit('mod1', { type: next }, `Mod 1: ${next}`)
  }

  cycleMod2Type(): void {
    const current = this.state.chains[this.state.focusedLayer].mod2.type
    const next = MOD2_TYPES[(MOD2_TYPES.indexOf(current) + 1) % MOD2_TYPES.length]!
    this.updateUnit('mod2', { type: next }, `Mod 2: ${next}`)
  }

  cycleAmpType(): void {
    const current = this.state.chains[this.state.focusedLayer].ampEq.type
    const next = AMP_TYPES[(AMP_TYPES.indexOf(current) + 1) % AMP_TYPES.length]!
    this.updateUnit('ampEq', { type: next }, `Amp Sim/EQ: ${next}`)
  }

  cycleReverbType(): void {
    const current = this.state.chains[this.state.focusedLayer].reverb.type
    const next = REVERB_TYPES[(REVERB_TYPES.indexOf(current) + 1) % REVERB_TYPES.length]!
    this.updateUnit('reverb', { type: next }, `Reverb: ${next}`)
  }

  cycleDelayFilter(): void {
    const current = this.state.chains[this.state.focusedLayer].delay.filter
    const next = DELAY_FILTERS[(DELAY_FILTERS.indexOf(current) + 1) % DELAY_FILTERS.length]!
    this.updateUnit('delay', { filter: next }, `Delay Filter: ${next}`)
  }

  cycleDelayEffect(): void {
    const current = this.state.chains[this.state.focusedLayer].delay.effect
    const next = DELAY_EFFECTS[(DELAY_EFFECTS.indexOf(current) + 1) % DELAY_EFFECTS.length]!
    this.updateUnit('delay', { effect: next }, `Delay FX: ${next}`)
  }

  toggleDelayAnalog(): void {
    const analog = !this.state.chains[this.state.focusedLayer].delay.analog
    this.updateUnit('delay', { analog }, `Delay Analog ${analog ? 'On' : 'Off'}`)
  }

  toggleReverbBright(): void {
    const bright = !this.state.chains[this.state.focusedLayer].reverb.bright
    this.updateUnit('reverb', { bright }, `Reverb ${bright ? 'Bright' : 'Dark'}`)
  }

  setDelayTempoMs(ms: number): void {
    // Inverse of delayTempoMs mapping; used by tap tempo.
    const clampedMs = Math.max(20, Math.min(1400, ms))
    const value = clamp(Math.round(((clampedMs - 20) / (1400 - 20)) * 127))
    this.updateUnit('delay', { tempo: value }, `Delay Tempo ${Math.round(clampedMs)} ms`)
  }

  toggleFxGroupPiano(): void {
    const fxGroupPiano = !this.state.fxGroupPiano
    if (fxGroupPiano) {
      // Entering group mode applies the focused layer's chain to the group (manual p.48).
      const focused = this.state.chains[this.state.focusedLayer]
      this.patch(
        { fxGroupPiano, chains: { A: structuredCloneChain(focused), B: structuredCloneChain(focused) } },
        'Piano FX Group On',
      )
    } else {
      this.patch({ fxGroupPiano }, 'Piano FX Group Off')
    }
  }

  toggleFxGlobal(unit: 'delay' | 'comp' | 'reverb'): void {
    const value = !this.state.fxGlobal[unit]
    const fxGlobal = { ...this.state.fxGlobal, [unit]: value }
    if (value) {
      // Entering global mode mirrors the focused layer's unit settings everywhere.
      const focused = this.state.chains[this.state.focusedLayer][unit]
      const chains = {
        A: { ...this.state.chains.A, [unit]: { ...focused } },
        B: { ...this.state.chains.B, [unit]: { ...focused } },
      }
      this.patch({ fxGlobal, chains }, `${unitLabel(unit)} Global On`)
    } else {
      this.patch({ fxGlobal }, `${unitLabel(unit)} Global Off`)
    }
  }

  toggleAllFxOff(): void {
    const allFxOff = !this.state.allFxOff
    this.patch({ allFxOff }, allFxOff ? 'All FX Off' : 'All FX Restored')
  }

  /* ------------------------------------------------------------- rotary -- */

  toggleRotarySpeed(): void {
    const speed = this.state.rotary.speed === 'fast' ? 'slow' : 'fast'
    this.patch({ rotary: { ...this.state.rotary, speed } }, `Rotary ${speed === 'fast' ? 'Fast' : 'Slow'}`)
  }

  toggleRotaryStop(): void {
    const speed: RotarySpeed = this.state.rotary.speed === 'stop' ? 'slow' : 'stop'
    this.patch({ rotary: { ...this.state.rotary, speed } }, `Rotary ${speed === 'stop' ? 'Stop' : 'Slow'}`)
  }

  setRotaryDrive(value: number): void {
    const clamped = clamp(value)
    this.patch({ rotary: { ...this.state.rotary, drive: clamped } }, `Rotary Drive ${clamped}`)
  }

  setLastEdit(text: string): void {
    this.patch({}, text)
  }
}

function clamp(value: number): number {
  return Math.max(0, Math.min(127, Math.round(value)))
}

function structuredCloneChain(chain: EffectChainState): EffectChainState {
  return {
    mod1: { ...chain.mod1 },
    mod2: { ...chain.mod2 },
    delay: { ...chain.delay },
    ampEq: { ...chain.ampEq },
    comp: { ...chain.comp },
    reverb: { ...chain.reverb },
  }
}

function unitLabel(unit: keyof EffectChainState): string {
  return { mod1: 'Mod 1', mod2: 'Mod 2', delay: 'Delay', ampEq: 'Amp Sim/EQ', comp: 'Comp', reverb: 'Reverb' }[unit]
}

export function useInstrumentState(store: InstrumentStore): InstrumentState {
  return useSyncExternalStore(store.subscribe, store.getState)
}

/** Mapped physical values used by both the engine and the display readouts. */
export const mappings = {
  /** 0..127 -> gain (squared taper). */
  levelToGain(value: number): number {
    const x = value / 127
    return x * x
  },
  delayTempoMs(value: number): number {
    return 20 + (value / 127) * (1400 - 20)
  },
  lfoRateHz(value: number): number {
    return 0.1 + Math.pow(value / 127, 2) * 9.9
  },
  eqGainDb(value: number): number {
    return ((value - 64) / 63.5) * 15
  },
  midFreqHz(value: number): number {
    return 200 * Math.pow(8000 / 200, value / 127)
  },
  filterFreqHz(value: number): number {
    return 40 * Math.pow(16000 / 40, value / 127)
  },
}

export { INSTRUMENTS }
