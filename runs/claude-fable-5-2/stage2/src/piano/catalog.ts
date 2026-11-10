import type { SampleSetId, SourceSpec, TimbreFamily } from '../audio/dsp/params'

/**
 * The piano library: six types, each with one or more models. This is plain data shared by
 * the panel state, the OLED, and the engine. A model is either a bundled set of recordings
 * or live synthesis, and says which; nothing synthesized is ever called a recording.
 */

export const PIANO_TYPES = ['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'] as const
export type PianoTypeName = (typeof PIANO_TYPES)[number]

export interface PianoModel {
  id: string
  /** Name shown on the Program display. These are the names of the real sources, not Nord model names. */
  name: string
  origin: 'recorded' | 'synthesized'
  source: SourceSpec
  /** Which Timbre settings apply: acoustic has Off/Soft/Mid/Bright, electric adds Dyno 1 and Dyno 2. */
  family: TimbreFamily
  /** Soft Release is disabled for Clav-type sounds (manual p. 25). */
  softRelease: boolean
  /** Sympathetic string resonance applies to instruments that have undamped strings to excite. */
  stringRes: boolean
  /** One line for the status console. */
  about: string
}

const recorded = (set: SampleSetId): SourceSpec => ({ kind: 'samples', set })

export const PIANO_MODELS: Readonly<Record<PianoTypeName, readonly PianoModel[]>> = {
  Grand: [
    {
      id: 'grand-salamander',
      name: 'Salamander Grand',
      origin: 'recorded',
      source: recorded('grand'),
      family: 'acoustic',
      softRelease: true,
      stringRes: true,
      about: 'Recorded Yamaha C5 grand (Salamander Grand Piano V3, Alexander Holm, CC BY 3.0): 30 roots, 3 velocity layers.',
    },
  ],
  Upright: [
    {
      id: 'upright-kw',
      name: 'Kawai Upright KW',
      origin: 'recorded',
      source: recorded('upright'),
      family: 'acoustic',
      softRelease: true,
      stringRes: true,
      about: 'Recorded Kawai upright (Upright Piano KW, FreePats, CC0): 30+ roots, 2 velocity layers.',
    },
  ],
  Electric: [
    {
      id: 'electric-ep200',
      name: 'EP200 Reed Piano',
      origin: 'recorded',
      source: recorded('electric'),
      family: 'electric',
      softRelease: true,
      stringRes: false,
      about: 'Recorded Wurlitzer EP200 reed electric piano (Greg Sullivan, CC BY 3.0): up to 13 roots, 4 velocity layers.',
    },
  ],
  Clav: [
    {
      id: 'clav-neck',
      name: 'Synth Clav Neck PU',
      origin: 'synthesized',
      source: { kind: 'partials', recipe: 'clav-neck' },
      family: 'acoustic',
      softRelease: false,
      stringRes: false,
      about: 'Synthesized clavinet (additive plucked-string model, neck pickup). Not a recording.',
    },
    {
      id: 'clav-bridge',
      name: 'Synth Clav Bridge PU',
      origin: 'synthesized',
      source: { kind: 'partials', recipe: 'clav-bridge' },
      family: 'acoustic',
      softRelease: false,
      stringRes: false,
      about: 'Synthesized clavinet (additive plucked-string model, bridge pickup). Not a recording.',
    },
  ],
  Digital: [
    {
      id: 'digital-fm',
      name: 'Synth FM Piano',
      origin: 'synthesized',
      source: { kind: 'partials', recipe: 'fm-piano' },
      family: 'electric',
      softRelease: true,
      stringRes: false,
      about: 'Synthesized digital piano in the style of an FM electric piano (additive). Not a recording.',
    },
  ],
  Misc: [
    {
      id: 'misc-vibraphone',
      name: 'Synth Vibraphone',
      origin: 'synthesized',
      source: { kind: 'partials', recipe: 'vibraphone' },
      family: 'acoustic',
      softRelease: true,
      stringRes: false,
      about: 'Synthesized vibraphone (bar modes 1:4:10, additive). Not a recording.',
    },
    {
      id: 'misc-marimba',
      name: 'Synth Marimba',
      origin: 'synthesized',
      source: { kind: 'partials', recipe: 'marimba' },
      family: 'acoustic',
      softRelease: true,
      stringRes: false,
      about: 'Synthesized marimba (bar modes 1:3.93:9.2, additive). Not a recording.',
    },
  ],
}

export function modelsOf(type: number): readonly PianoModel[] {
  return PIANO_MODELS[PIANO_TYPES[type] ?? 'Grand']
}

export function modelAt(type: number, index: number): PianoModel {
  const models = modelsOf(type)
  return models[((index % models.length) + models.length) % models.length]
}

/** Name of the labelled stand-in voice a recorded model falls back to when its samples are missing. */
export const FALLBACK_VOICE_NAME = 'Fallback Synth Piano'

export const SAMPLE_SET_LABEL: Record<SampleSetId, string> = {
  grand: 'Grand',
  upright: 'Upright',
  electric: 'Electric',
}
