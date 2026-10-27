/**
 * Synth section state.
 *
 * Three layers (A, B, C), each with its own oscillator, filter, three envelopes, LFO,
 * voice mode and arpeggiator. Unlike the Organ's two layers, each Synth layer owns its own
 * effect chain (spec `independentEffectsPerLayer`), which lives in `effectState`.
 *
 * The Synth section is deliberately Analog-mode-only: Samples, Extern, LP M, LP+HP, the
 * extra oscillator categories and the FM Inharmonic algorithms are all spec-excluded, and
 * the panel's controls for them stay decorative and are listed as unsupported.
 */
import type { SynthLayerId } from './types'
import { SYNTH_LAYERS } from './types'
export type { SynthLayerId }
import {
  ARP_DIRECTIONS,
  ARP_MODES,
  FILTER_PANEL_ORDER,
  KEY_TRACKING,
  LFO_PANEL_ORDER,
  NOTE_PRIORITIES,
  VIBRATO_PANEL_ORDER,
  VOICE_MODES,
  cutoffHzFor,
  type ArpDirection,
  type ArpMode,
  type FilterType,
  type KeyTracking,
  type LfoWaveform,
  type NotePriority,
  type VibratoMode,
  type VoiceMode,
} from './synthModel'

export interface SynthEnvelopeState {
  /** Panel dial positions, 0..10. */
  attack: number
  decay: number
  release: number
  /** Velocity sensitivity 0..1, or 0 when the velocity switch is off. */
  velocity: number
  /** Filter/oscillator envelope amount; bipolar -1..1 for the oscillator envelope. */
  amount: number
}

export interface SynthArpState {
  mode: ArpMode
  /** True when the arpeggiator is running (ARP RUN). */
  run: boolean
  /** Rate knob 0..10 (or the gate's hardness in Gate mode). */
  rate: number
  /** Range/Env knob 0..10: octaves in Arp mode, gate hardness in Gate mode. */
  range: number
  direction: ArpDirection
  /** KB HOLD: keep sounding and running after the keys are lifted (manual p. 36). */
  hold: boolean
  /** Sync the step rate to the master clock. */
  clockSync: boolean
}

export interface SynthLayerState {
  id: SynthLayerId
  enabled: boolean
  level: number
  octave: number
  /** Waveform name from the spec's required list. */
  waveform: string
  /** Osc Ctrl 0..10, meaning depends on the waveform's category. */
  oscCtrl: number
  /** Env Amt for the oscillator envelope, bipolar -10..10 as printed. */
  oscEnvAmount: number
  /** Pitch: coarse semitones -24..24 and fine cents -50..50. */
  coarse: number
  fine: number
  /** Oscillator envelope: an amount target toggle (Env To Pitch) plus its own ADSR. */
  oscEnvToPitch: boolean
  oscEnv: SynthEnvelopeState
  /** Filter. */
  filterOn: boolean
  filterType: FilterType
  /** Freq knob 0..10. */
  filterFreq: number
  /** Res knob 0..10. */
  filterRes: number
  /** Env Amt knob 0..10. */
  filterEnvAmount: number
  keyTracking: KeyTracking
  /** Drive levels Off/1/2/3. */
  filterDrive: number
  filterEnv: SynthEnvelopeState
  /** Amplifier envelope. */
  ampEnv: SynthEnvelopeState
  /** Amp velocity levels Off/1/2/3. */
  ampVelocity: number
  lfo: {
    waveform: LfoWaveform
    /** Rate knob 0..10. */
    rate: number
    amount: number
    destinations: { pitch: boolean; oscCtrl: boolean; filter: boolean }
    clockSync: boolean
  }
  arp: SynthArpState
  voiceMode: VoiceMode
  priority: NotePriority
  glide: number
  /** Unison index 0..3 (Off, 1, 2, 3). */
  unison: number
  vibrato: VibratoMode
  vibratoRate: number
  vibratoAmount: number
  sustPed: boolean
  /** KB ZONE 1..4 assignment. */
  zones: [boolean, boolean, boolean, boolean]
}

export interface SynthState {
  sectionOn: boolean
  focused: SynthLayerId
  layers: Record<SynthLayerId, SynthLayerState>
  revision: number
}

/** The instrument's power-on Synth sound: a Super Saw pad on layer A, nothing else. */
export function defaultSynthLayer(id: SynthLayerId, enabled: boolean): SynthLayerState {
  return {
    id,
    enabled,
    level: enabled ? 66 : 0,
    octave: 0,
    waveform: enabled ? 'Super Saw' : 'Saw',
    oscCtrl: 4,
    oscEnvAmount: 0,
    coarse: 0,
    fine: 0,
    oscEnvToPitch: false,
    oscEnv: { attack: 0.6, decay: 4, release: 2.4, velocity: 0, amount: 0 },
    filterOn: true,
    filterType: 'LP24',
    filterFreq: 6.4,
    filterRes: 1.2,
    filterEnvAmount: 3,
    keyTracking: 'Off',
    filterDrive: 0,
    filterEnv: { attack: 0.4, decay: 5, release: 2, velocity: 0, amount: 0 },
    ampEnv: { attack: 0.7, decay: 6, release: 3, velocity: 0.6, amount: 0 },
    ampVelocity: 2,
    lfo: {
      waveform: 'Triangle',
      rate: 3.2,
      amount: 2,
      destinations: { pitch: false, oscCtrl: false, filter: false },
      clockSync: false,
    },
    arp: {
      mode: 'Poly',
      run: false,
      rate: 7,
      range: 0,
      direction: 'Up',
      hold: false,
      clockSync: true,
    },
    voiceMode: 'Poly',
    priority: 'Off',
    glide: 0,
    unison: 0,
    vibrato: 'Wheel',
    vibratoRate: 5,
    vibratoAmount: 2,
    sustPed: true,
    zones: [true, true, false, false],
  }
}

export function defaultSynthState(): SynthState {
  return {
    sectionOn: true,
    focused: 'synth.a',
    layers: {
      'synth.a': defaultSynthLayer('synth.a', true),
      'synth.b': defaultSynthLayer('synth.b', false),
      'synth.c': defaultSynthLayer('synth.c', false),
    },
    revision: 0,
  }
}

export function cloneSynthState(state: SynthState): SynthState {
  const cloneLayer = (layer: SynthLayerState): SynthLayerState => ({
    ...layer,
    oscEnv: { ...layer.oscEnv },
    filterEnv: { ...layer.filterEnv },
    ampEnv: { ...layer.ampEnv },
    lfo: { ...layer.lfo, destinations: { ...layer.lfo.destinations } },
    arp: { ...layer.arp },
    zones: [...layer.zones] as [boolean, boolean, boolean, boolean],
  })
  return {
    ...state,
    layers: {
      'synth.a': cloneLayer(state.layers['synth.a']),
      'synth.b': cloneLayer(state.layers['synth.b']),
      'synth.c': cloneLayer(state.layers['synth.c']),
    },
    revision: state.revision + 1,
  }
}

export interface SynthStore {
  get(): SynthState
  update(mutate: (draft: SynthState) => void): void
  subscribe(listener: (state: SynthState) => void): () => void
}

export function createSynthStore(initial?: SynthState): SynthStore {
  let state = initial ?? defaultSynthState()
  const listeners = new Set<(state: SynthState) => void>()
  return {
    get: () => state,
    update(mutate) {
      const draft = cloneSynthState(state)
      mutate(draft)
      state = draft
      for (const listener of listeners) listener(state)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** Layers that should sound for a new note in `zone`, in a stable order. */
export function activeSynthLayers(state: SynthState, zone: number): SynthLayerId[] {
  if (!state.sectionOn) return []
  return SYNTH_LAYERS.filter((id) => {
    const layer = state.layers[id]
    return layer.enabled && layer.zones[zone] === true
  })
}

/** The resolution a layer's filter cutoff should use, after tracking and the envelope. */
export function baseCutoff(layer: SynthLayerState): number {
  return cutoffHzFor(layer.filterFreq)
}

/* ------------------------------------------------------------------ */
/* Panel index helpers: printed order <-> canonical value              */
/* ------------------------------------------------------------------ */

export function filterPanelIndex(type: FilterType): number {
  return FILTER_PANEL_ORDER.indexOf(type)
}

export function filterFromPanel(index: number): FilterType {
  return FILTER_PANEL_ORDER[Math.max(0, Math.min(FILTER_PANEL_ORDER.length - 1, Math.round(index)))]
}

export function voiceModeFromPanel(index: number): VoiceMode {
  return VOICE_MODES[Math.max(0, Math.min(VOICE_MODES.length - 1, Math.round(index)))]
}

export function voiceModePanelIndex(mode: VoiceMode): number {
  return VOICE_MODES.indexOf(mode)
}

export function arpModeFromPanel(index: number): ArpMode {
  // The panel prints POLY / ARP / GATE left to right.
  return ARP_MODES[Math.max(0, Math.min(ARP_MODES.length - 1, Math.round(index)))]
}

export function arpModePanelIndex(mode: ArpMode): number {
  return ARP_MODES.indexOf(mode)
}

export function lfoWaveformFromPanel(index: number): LfoWaveform {
  return LFO_PANEL_ORDER[Math.max(0, Math.min(LFO_PANEL_ORDER.length - 1, Math.round(index)))]
}

export function lfoWaveformPanelIndex(waveform: LfoWaveform): number {
  return LFO_PANEL_ORDER.indexOf(waveform)
}

export function vibratoFromPanel(index: number): VibratoMode {
  return VIBRATO_PANEL_ORDER[Math.max(0, Math.min(VIBRATO_PANEL_ORDER.length - 1, Math.round(index)))]
}

export function vibratoPanelIndex(mode: VibratoMode): number {
  const index = VIBRATO_PANEL_ORDER.indexOf(mode)
  return index >= 0 ? index : 0
}

export function keyTrackingFromPanel(index: number): KeyTracking {
  return KEY_TRACKING[Math.max(0, Math.min(KEY_TRACKING.length - 1, Math.round(index)))]
}

export function keyTrackingPanelIndex(tracking: KeyTracking): number {
  return KEY_TRACKING.indexOf(tracking)
}

export function directionFromPanel(index: number): ArpDirection {
  return ARP_DIRECTIONS[Math.max(0, Math.min(ARP_DIRECTIONS.length - 1, Math.round(index)))]
}

export function priorityFromPanel(index: number): NotePriority {
  return NOTE_PRIORITIES[Math.max(0, Math.min(NOTE_PRIORITIES.length - 1, Math.round(index)))]
}
