// Derives audio settings from the panel's presentation state. This is the one place where panel
// values become audio parameters, so every audible control is traceable to a single function. The
// presentation reducer owns the values; nothing here writes them. Morphs are applied to the state
// before this runs, so the derivation reads the morphed values.

import type { GraphSettings, ChainId } from '../audio/signalGraph'
import { DEFAULT_LAYER_EFFECTS, type LayerEffectSettings } from '../audio/effects/types'
import { TO_ROTARY_INDEX } from '../audio/effects/types'
import { pianoTypeAt, timbreStep, type PianoType } from '../audio/pianoModels'
import type { TimbreStepName } from '../audio/timbre'
import { activeSplitPoints, zoneRangeOf, type SplitPoint } from '../audio/zones'
import { type OrganModel, modelFromSwitches } from '../audio/organ/models'
import type { OrganVibrato, OrganPercussion } from '../audio/organ/organVoice'
import type { SynthVoiceSettings } from '../audio/synth/synthVoice'
import { ARP_DIRECTIONS, ARP_MODES, stepSeconds, rangeOctaves, type ArpDirection, type ArpMode } from '../audio/synth/arp'
import type { SynthLayerSettings, VoiceMode, NotePriority } from '../engine/synthLayerSink'
import { expRange } from '../audio/effects/nodes'
import { bpmFromKnob, transposeFromKnob } from './instrument'
import { layerKey, type PresentationState } from './hardware'

/** Piano settings that every voice reads when it starts. */
export interface VoiceSettings {
  type: PianoType
  /** KB Touch index: 0 Heavy, 1 Medium, 2 Light. */
  touch: number
  /** Dyn Comp level 0..3. */
  dynComp: number
  /** Unison level 0..3. */
  unison: number
  softRelease: boolean
  stringResonance: boolean
  /** Pitch-stick bend in cents, already gated by PSTICK. */
  bendCents: number
}

export interface OrganLayerConfig {
  on: boolean
  /** Fader position 0..1. Applied as level squared, so the fader tapers. */
  level: number
  octave: number
  zone: readonly [number, number]
  model: OrganModel
  drawbars: number[]
  vibrato: OrganVibrato
  percussion: OrganPercussion
}

export interface SynthLayerConfig {
  on: boolean
  level: number
  octave: number
  zone: readonly [number, number]
  voice: SynthLayerSettings
}

export interface ArpConfig {
  mode: ArpMode
  direction: ArpDirection
  octaves: number
  /** Seconds per step at the current tempo and rate. */
  stepSeconds: number
  /** Gate length as a fraction of a step. */
  gate: number
  hold: boolean
  run: boolean
}

export interface AudioSettings {
  graph: GraphSettings
  voice: VoiceSettings
  /** SUSTPED: whether the sustain input reaches the piano section at all. */
  sustainRouted: boolean
  /** Octave shift per piano layer in semitones: -12, 0, or +12. */
  octave: Record<'A' | 'B', number>
  /** Transpose in semitones, -6 to +6. Applies to every engine. */
  transpose: number
  piano: Record<'A' | 'B', { zone: readonly [number, number] }>
  organ: Record<'A' | 'B', OrganLayerConfig>
  synth: Record<'A' | 'B' | 'C', SynthLayerConfig>
  splits: SplitPoint[]
  arp: ArpConfig
  clock: { bpm: number; sync: boolean }
}

const PIANO_LAYERS = ['A', 'B'] as const
const ORGAN_LAYERS = ['A', 'B'] as const
const SYNTH_LAYERS = ['A', 'B', 'C'] as const
/** The organ model switch that selects each model. */
const MODEL_IDS: Readonly<Record<OrganModel, string>> = {
  b3: 'organ.model-b3',
  vox: 'organ.model-vox',
  farf: 'organ.model-farf',
  pipe1: 'organ.model-pipe-1',
  pipe2: 'organ.model-pipe-2',
}
const DRAWBAR_IDS = [
  'organ.drawbar-16',
  'organ.drawbar-5-1-3',
  'organ.drawbar-8',
  'organ.drawbar-4',
  'organ.drawbar-2-2-3',
  'organ.drawbar-2',
  'organ.drawbar-1-3-5',
  'organ.drawbar-1-1-3',
  'organ.drawbar-1',
] as const

/** Synced mod and LFO rates in beats per cycle: 1/4, 1/2, 1, 2, 4, 8 beats. */
const SYNC_RATE_BEATS = [4, 2, 1, 0.5, 0.25, 0.125] as const
/** Synced delay times in beats: 1/8 to 2 beats. */
const SYNC_DELAY_BEATS = [0.125, 0.25, 0.375, 0.5, 0.75, 1, 1.5, 2] as const

const on = (state: PresentationState, id: string) => (state[id] ?? 0) >= 0.5
const num = (state: PresentationState, id: string, fallback = 0) => state[id] ?? fallback

/** The octave knob has three positions: low third is -12, middle is 0, top third is +12. */
export function octaveFromKnob(knob: number): number {
  if (knob < 1 / 3) return -12
  if (knob > 2 / 3) return 12
  return 0
}

/** Pitch stick: centre is 0, full deflection is ±2 semitones. */
export function bendFromStick(position: number): number {
  return (Math.min(1, Math.max(0, position)) - 0.5) * 400
}

/** Master clock: a rate expressed as beats per cycle, converted to Hz at the tempo. */
function syncedHz(beats: number, bpm: number): number {
  return bpm / 60 / beats
}

function layerEffects(state: PresentationState, chain: ChainId): LayerEffectSettings {
  const key = (id: string) => layerKey(id, chain)
  const value = (id: string, fallback: number) => state[key(id)] ?? fallback
  const defaults = DEFAULT_LAYER_EFFECTS
  return {
    mod1: {
      on: on(state, key('effects.mod1-on')),
      type: Math.round(value('effects.mod1-type', 0)),
      rate: value('effects.mod1-rate', defaults.mod1.rate),
      amount: value('effects.mod1-amount', defaults.mod1.amount),
    },
    mod2: {
      on: on(state, key('effects.mod2-on')),
      type: Math.round(value('effects.mod2-type', 0)),
      rate: value('effects.mod2-rate', defaults.mod2.rate),
      amount: value('effects.mod2-amount', defaults.mod2.amount),
    },
    delay: {
      on: on(state, key('effects.delay-on')),
      time: value('effects.delay-time', defaults.delay.time),
      feedback: value('effects.delay-feedback', defaults.delay.feedback),
      mix: value('effects.delay-level', defaults.delay.mix),
      filter: Math.round(value('effects.delay-filter', 0)),
    },
    amp: {
      on: on(state, key('effects.amp-on')),
      type: Math.round(value('effects.amp-type', 0)),
      drive: value('effects.amp-drive', defaults.amp.drive),
      bass: value('effects.eq-low', defaults.amp.bass),
      mid: value('effects.eq-mid', defaults.amp.mid),
      midFreq: value('effects.amp-tone', defaults.amp.midFreq),
      treble: value('effects.eq-high', defaults.amp.treble),
      level: value('effects.amp-level', defaults.amp.level),
    },
    comp: {
      on: on(state, key('effects.comp-on')),
      amount: value('effects.comp-amount', defaults.comp.amount),
      fast: on(state, key('effects.comp-fast')),
    },
    reverb: {
      on: on(state, key('effects.reverb-on')),
      type: Math.round(value('effects.reverb-type', defaults.reverb.type)),
      mix: value('effects.reverb-level', defaults.reverb.mix),
      bright: value('effects.reverb-size', defaults.reverb.bright),
    },
  }
}

/** Synced delay and mod rates: the knob is set so the unit runs at the clock's beat value. */
function clockedEffects(effects: LayerEffectSettings, bpm: number): LayerEffectSettings {
  const delayBeats = SYNC_DELAY_BEATS[Math.min(SYNC_DELAY_BEATS.length - 1, Math.round(effects.delay.time * (SYNC_DELAY_BEATS.length - 1)))]
  const delayMs = (60000 / bpm) * delayBeats
  const time = Math.min(1, Math.max(0, (delayMs - 60) / 940))
  // Mod 1 A-Pan and Tremolo are LFO types with a known rate range; they follow the clock.
  let mod1 = effects.mod1
  if (mod1.type === 0 || mod1.type === 1) {
    const [low, high] = mod1.type === 0 ? [0.1, 4] : [0.5, 10]
    const beats = SYNC_RATE_BEATS[Math.min(SYNC_RATE_BEATS.length - 1, Math.round(mod1.rate * (SYNC_RATE_BEATS.length - 1)))]
    const hz = syncedHz(beats, bpm)
    mod1 = { ...mod1, rate: Math.min(1, Math.max(0, Math.log(hz / low) / Math.log(high / low))) }
  }
  return { ...effects, delay: { ...effects.delay, time }, mod1 }
}

function synthVoiceSettings(state: PresentationState, layer: (typeof SYNTH_LAYERS)[number], bpm: number, clockSync: boolean): SynthVoiceSettings {
  const key = (id: string) => layerKey(id, layer)
  const v = (id: string, fallback = 0) => num(state, key(id), fallback)
  const lfoRate = clockSync
    ? syncedHz(SYNC_RATE_BEATS[Math.min(SYNC_RATE_BEATS.length - 1, Math.round(v('synth.lfo-rate') * (SYNC_RATE_BEATS.length - 1)))], bpm)
    : expRange(v('synth.lfo-rate'), 0.1, 20)
  const vibratoWheel = v('synth.vib-mode') >= 0.5
  const wheel = num(state, 'performance.mod-wheel')
  return {
    source: Math.round(v('synth.osc-type')),
    ctrl: v('synth.osc-ctrl', 0.3),
    filterType: Math.round(v('synth.filter-type')),
    filterTrack: Math.round(v('synth.filter-track')),
    filterDrive: Math.round(v('synth.filter-drive')),
    cutoff: v('synth.filter-cutoff', 0.7),
    resonance: v('synth.filter-resonance', 0.2),
    filterEnvAmount: v('synth.filter-env', 0.4),
    amp: { attack: v('synth.env-attack'), decay: v('synth.env-decay', 0.4), release: v('synth.env-release', 0.3), velocity: Math.round(v('synth.env-velocity', 2)) },
    filterEnv: { attack: v('synth.fenv-attack'), decay: v('synth.fenv-decay', 0.3), release: v('synth.fenv-release', 0.3), velocity: on(state, key('synth.fenv-velocity')) ? 1 : 0 },
    oscEnv: {
      attack: v('synth.oenv-attack'),
      decay: v('synth.oenv-decay', 0.2),
      release: v('synth.oenv-release', 0.2),
      velocity: on(state, key('synth.oenv-velocity')) ? 1 : 0,
      pitch: v('synth.oenv-pitch', 0.5),
    },
    lfo: {
      rateHz: lfoRate,
      amount: v('synth.lfo-amount'),
      wave: Math.round(v('synth.lfo-wave')),
      toPitch: on(state, key('synth.lfo-to-pitch')),
      toCtrl: on(state, key('synth.lfo-to-ctrl')),
      toFilter: on(state, key('synth.lfo-to-filter')),
    },
    vibrato: {
      on: v('synth.vib-amount', 0.3) > 0,
      rateHz: expRange(v('synth.vib-rate', 0.4), 2, 8),
      depth: v('synth.vib-amount', 0.3) * (vibratoWheel ? wheel : 1),
    },
    unison: Math.round(v('synth.voice-unison')),
  }
}

/** Derives every audio setting from the panel state. Pure: the same state always gives the same settings. */
export function deriveAudioSettings(state: PresentationState): AudioSettings {
  const type = pianoTypeAt(Math.round(state['piano.type'] ?? 0))
  const timbreName: TimbreStepName = type.timbre[timbreStep(type, state['piano.timbre'] ?? 0)] as TimbreStepName
  const bpm = bpmFromKnob(num(state, 'program.clock-bpm', 0.4))
  const clockSync = on(state, 'program.clock-sync')
  const transpose = transposeFromKnob(num(state, 'program.transpose', 0.5))
  const splits = activeSplitPoints(
    on(state, 'program.split'),
    [num(state, 'program.split-low'), num(state, 'program.split-mid'), num(state, 'program.split-high')].map((value) => Math.round(value)),
    [num(state, 'program.xfade-low'), num(state, 'program.xfade-mid'), num(state, 'program.xfade-high')].map((value) => Math.round(value)),
  )

  const layers = {} as GraphSettings['layers']

  // Piano layers.
  for (const layer of PIANO_LAYERS) {
    const effects = layerEffects(state, layer)
    layers[layer] = {
      on: on(state, layer === 'A' ? 'piano.layer-a-on' : 'piano.layer-b-on'),
      level: state[layer === 'A' ? 'piano.layer-a-level' : 'piano.layer-b-level'] ?? 0,
      toRotary: effects.amp.type === TO_ROTARY_INDEX,
      effects: clockedEffects(effects, bpm),
    }
  }

  // Organ: one shared chain. The layers' levels reach it through their own gains.
  const organOn = ORGAN_LAYERS.some((layer) => on(state, `organ.layer-${layer.toLowerCase()}-on`))
  layers.O = {
    on: organOn,
    level: 1,
    toRotary: on(state, 'performance.rotary-organ'),
    effects: clockedEffects(layerEffects(state, 'O'), bpm),
  }

  // Synth layers: one chain each.
  for (const layer of SYNTH_LAYERS) {
    const effects = layerEffects(state, `S${layer}` as ChainId)
    layers[`S${layer}` as ChainId] = {
      on: on(state, `synth.layer-${layer.toLowerCase()}-on`),
      level: state[`synth.layer-${layer.toLowerCase()}-level`] ?? 0,
      toRotary: effects.amp.type === TO_ROTARY_INDEX,
      effects: clockedEffects(effects, bpm),
    }
  }

  const graph: GraphSettings = {
    master: state['performance.master-level'] ?? 0.7,
    effectsOn: on(state, 'effects.all-on'),
    sectionOn: on(state, 'piano.section-on'),
    timbre: timbreName,
    rotary: {
      fast: (state['performance.rotary-speed'] ?? 0) >= 0.5,
      brake: on(state, 'performance.rotary-brake'),
      level: state['performance.rotary-level'] ?? 0.5,
      speed: state['performance.rotary-speed'] ?? 0,
    },
    layers,
  }

  const organ = {} as Record<'A' | 'B', OrganLayerConfig>
  for (const layer of ORGAN_LAYERS) {
    const key = (id: string) => layerKey(id, layer)
    const switches = Object.fromEntries((Object.keys(MODEL_IDS) as OrganModel[]).map((model) => [model, num(state, key(MODEL_IDS[model]))])) as Record<OrganModel, number>
    organ[layer] = {
      on: on(state, `organ.layer-${layer.toLowerCase()}-on`),
      level: num(state, `organ.layer-${layer.toLowerCase()}-level`, 0.5),
      octave: octaveFromKnob(num(state, `organ.layer-${layer.toLowerCase()}-octave`, 0.5)),
      zone: zoneRangeOf(Math.round(num(state, `organ.layer-${layer.toLowerCase()}-zone`, 9))),
      model: modelFromSwitches(switches),
      drawbars: DRAWBAR_IDS.map((id) => num(state, key(id))),
      vibrato: { on: on(state, key('organ.vib-on')), type: Math.round(num(state, key('organ.vib-type'))), depth: num(state, key('organ.vib-depth'), 0.4) },
      percussion: {
        on: on(state, key('organ.perc-on')),
        soft: on(state, key('organ.perc-soft')),
        fast: on(state, key('organ.perc-fast')),
        third: on(state, key('organ.perc-harmonic')),
        volume: num(state, key('organ.perc-volume'), 0.5),
      },
    }
  }

  const synth = {} as Record<'A' | 'B' | 'C', SynthLayerConfig>
  for (const layer of SYNTH_LAYERS) {
    const lower = layer.toLowerCase()
    synth[layer] = {
      on: on(state, `synth.layer-${lower}-on`),
      level: num(state, `synth.layer-${lower}-level`, 0.5),
      octave: octaveFromKnob(num(state, `synth.layer-${lower}-octave`, 0.5)),
      zone: zoneRangeOf(Math.round(num(state, `synth.layer-${lower}-zone`, 9))),
      voice: {
        voice: synthVoiceSettings(state, layer, bpm, clockSync),
        mode: (['poly', 'mono', 'legato'] as const)[Math.round(num(state, layerKey('synth.voice-mode', layer)))] as VoiceMode,
        priority: (['off', 'low', 'high'] as const)[Math.round(num(state, layerKey('synth.voice-priority', layer)))] as NotePriority,
        glide: num(state, layerKey('synth.voice-glide', layer)),
        pitchOffset: octaveFromKnob(num(state, `synth.layer-${lower}-octave`, 0.5)) + transpose,
      },
    }
  }

  const arpStep = stepSeconds(num(state, 'synth.arp-rate', 0.5), bpm, clockSync)
  const arp: ArpConfig = {
    mode: ARP_MODES[Math.round(num(state, 'synth.arp-mode'))] ?? 'arp',
    direction: ARP_DIRECTIONS[Math.round(num(state, 'synth.arp-direction'))] ?? 'up',
    octaves: rangeOctaves(num(state, 'synth.arp-range', 0.3)),
    stepSeconds: arpStep,
    gate: 0.5,
    hold: on(state, 'synth.arp-hold'),
    run: on(state, 'synth.arp-run'),
  }

  return {
    graph,
    voice: {
      type,
      touch: Math.round(state['piano.kb-touch'] ?? 1),
      dynComp: Math.round(state['piano.dyn-comp'] ?? 0),
      unison: Math.round(state['piano.unison'] ?? 0),
      softRelease: on(state, 'piano.soft-release'),
      stringResonance: on(state, 'piano.string-res'),
      bendCents: on(state, 'piano.pstick') ? bendFromStick(state['performance.pitch-stick'] ?? 0.5) : 0,
    },
    sustainRouted: on(state, 'piano.sustped'),
    octave: {
      A: octaveFromKnob(state['piano.layer-a-octave'] ?? 0.5),
      B: octaveFromKnob(state['piano.layer-b-octave'] ?? 0.5),
    },
    transpose,
    piano: {
      A: { zone: zoneRangeOf(Math.round(num(state, 'piano.layer-a-zone', 9))) },
      B: { zone: zoneRangeOf(Math.round(num(state, 'piano.layer-b-zone', 9))) },
    },
    organ,
    synth,
    splits,
    arp,
    clock: { bpm, sync: clockSync },
  }
}
