// The six piano types and what sounds each one. Three are recorded sample sets bundled under
// public/samples/. Clav, Digital, and Misc are honest live synthesis (see synthVoices.ts); nothing
// here calls a synthesized voice a recording.
//
// Panel order matches the TYPE selector in specs/nord-stage-4.piano.json.

export type PianoSource = 'recorded' | 'synthesis'
export type SampleSetId = 'grand' | 'upright' | 'electric'
export type SynthKind = 'clav' | 'digital' | 'marimba'

export interface PianoType {
  id: string
  label: string
  source: PianoSource
  /** Model name shown in the piano status line. Every type has one model in this build. */
  model: string
  /** Recorded types name their bundled sample set. */
  sampleSet?: SampleSetId
  /** Synthesized types name their voice. */
  synth?: SynthKind
  /** Timbre steps for this type's family, in panel order. */
  timbre: readonly string[]
  /** String Resonance applies to acoustic grands and uprights only (manual p. 25). */
  stringResonance: boolean
  /** Soft Release is disabled for Clav-type sounds (manual p. 25). */
  softRelease: boolean
}

const ACOUSTIC_TIMBRE = ['Off', 'Soft', 'Mid', 'Bright'] as const
const ELECTRIC_TIMBRE = ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2'] as const

export const PIANO_TYPES: readonly PianoType[] = [
  {
    id: 'grand',
    label: 'Grand',
    source: 'recorded',
    model: 'Salamander Grand V3',
    sampleSet: 'grand',
    timbre: ACOUSTIC_TIMBRE,
    stringResonance: true,
    softRelease: true,
  },
  {
    id: 'upright',
    label: 'Upright',
    source: 'recorded',
    model: 'Upright KW',
    sampleSet: 'upright',
    timbre: ACOUSTIC_TIMBRE,
    stringResonance: true,
    softRelease: true,
  },
  {
    id: 'electric',
    label: 'Electric',
    source: 'recorded',
    model: 'Rhodes Mark I Stage 73 (jRhodes3d)',
    sampleSet: 'electric',
    timbre: ELECTRIC_TIMBRE,
    stringResonance: false,
    softRelease: true,
  },
  {
    id: 'clav',
    label: 'Clav',
    source: 'synthesis',
    model: 'Clav (synthesized)',
    synth: 'clav',
    timbre: ACOUSTIC_TIMBRE,
    stringResonance: false,
    softRelease: false,
  },
  {
    id: 'digital',
    label: 'Digital',
    source: 'synthesis',
    model: 'Digital FM (synthesized)',
    synth: 'digital',
    timbre: ACOUSTIC_TIMBRE,
    stringResonance: false,
    softRelease: true,
  },
  {
    id: 'misc',
    label: 'Misc',
    source: 'synthesis',
    model: 'Marimba (synthesized)',
    synth: 'marimba',
    timbre: ACOUSTIC_TIMBRE,
    stringResonance: false,
    softRelease: true,
  },
]

export const PIANO_TYPE_LABELS: readonly string[] = PIANO_TYPES.map((type) => type.label)

/** Number of Timbre positions for a type; the Timbre knob is read as this many equal steps. */
export function timbreStepCount(type: PianoType): number {
  return type.timbre.length
}

/**
 * Maps a 0..1 knob value onto the step index for a type. The knob has one more position than
 * the step count only at its very end, so 1.0 selects the last step.
 */
export function timbreStep(type: PianoType, knob: number): number {
  const steps = timbreStepCount(type)
  return Math.min(steps - 1, Math.max(0, Math.floor(knob * steps)))
}

export function pianoTypeAt(index: number): PianoType {
  const clamped = Math.min(PIANO_TYPES.length - 1, Math.max(0, Math.round(index)))
  return PIANO_TYPES[clamped]
}

/** KB Touch: three response curves (Heavy, Medium, Light) on the played velocity. */
export const KB_TOUCH_CURVES: readonly ((v: number) => number)[] = [
  (v) => Math.pow(v, 1.6), // Heavy: softer strokes sound quieter
  (v) => v,
  (v) => Math.pow(v, 0.65), // Light: the same stroke sounds louder
]

/**
 * Dyn Comp: raises the floor of softer strokes without touching timbre. Off keeps the full range;
 * levels 1-3 lift the floor (manual p. 25).
 */
export function dynCompGain(v: number, level: number): number {
  const floor = [0, 0.12, 0.26, 0.4][Math.min(3, Math.max(0, Math.round(level)))]
  return floor + (1 - floor) * v
}

/** Unison: detune in cents and stereo spread for levels Off, 1, 2, 3 (manual p. 26). */
export const UNISON_DETUNE_CENTS: readonly number[] = [0, 4, 9, 16]
export const UNISON_SPREAD: readonly number[] = [0, 0.35, 0.6, 0.85]
