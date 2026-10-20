// Derives audio settings from the panel's presentation state. This is the one place where panel
// values become audio parameters, so every audible control is traceable to a single function. The
// presentation reducer owns the values; nothing here writes them.

import type { GraphSettings, LayerGraphSettings, LayerId } from '../audio/signalGraph'
import { DEFAULT_LAYER_EFFECTS, type LayerEffectSettings } from '../audio/effects/types'
import { TO_ROTARY_INDEX } from '../audio/effects/types'
import { pianoTypeAt, timbreStep, type PianoType } from '../audio/pianoModels'
import type { TimbreStepName } from '../audio/timbre'
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

export interface AudioSettings {
  graph: GraphSettings
  voice: VoiceSettings
  /** SUSTPED: whether the sustain input reaches the piano section at all. */
  sustainRouted: boolean
  /** Octave shift per layer in semitones: -12, 0, or +12. */
  octave: Record<LayerId, number>
}

const LAYER_IDS: readonly LayerId[] = ['A', 'B']

function on(state: PresentationState, id: string): boolean {
  return (state[id] ?? 0) >= 0.5
}

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

function layerEffects(state: PresentationState, layer: LayerId): LayerEffectSettings {
  const key = (id: string) => layerKey(id, layer)
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

/** Derives every audio setting from the panel state. Pure: the same state always gives the same settings. */
export function deriveAudioSettings(state: PresentationState): AudioSettings {
  const type = pianoTypeAt(Math.round(state['piano.type'] ?? 0))
  const timbreName: TimbreStepName = type.timbre[timbreStep(type, state['piano.timbre'] ?? 0)] as TimbreStepName

  const layers = {} as Record<LayerId, LayerGraphSettings>
  for (const layer of LAYER_IDS) {
    const focusKeyOn = layer === 'A' ? 'piano.layer-a-on' : 'piano.layer-b-on'
    const levelKey = layer === 'A' ? 'piano.layer-a-level' : 'piano.layer-b-level'
    const effects = layerEffects(state, layer)
    layers[layer] = {
      on: on(state, focusKeyOn),
      level: state[levelKey] ?? 0,
      toRotary: effects.amp.type === TO_ROTARY_INDEX,
      effects,
    }
  }

  const rotaryFast = on(state, 'performance.rotary-speed')
  const graph: GraphSettings = {
    master: state['performance.master-level'] ?? 0.7,
    effectsOn: on(state, 'effects.all-on'),
    sectionOn: on(state, 'piano.section-on'),
    timbre: timbreName,
    rotary: {
      fast: rotaryFast,
      brake: on(state, 'performance.rotary-brake'),
      level: state['performance.rotary-level'] ?? 0.5,
    },
    layers,
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
  }
}
