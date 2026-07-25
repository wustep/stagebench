import type { SampleSetId } from './sampleLibrary'
import type { PianoTypeId, TimbreId } from './settings'

/**
 * The six selectable piano types and their models.
 *
 * Honesty: `source` says exactly where each type's sound comes from. Grand, Upright and Electric
 * play the bundled *recordings* in `public/samples/`. Clav, Digital and Misc are *synthesis* —
 * the piano spec allows that for those three, and `IMPLEMENTATION_DETAILS.json` says so. A model
 * is a voicing of its type's source, never a claim of a different instrument recording.
 */

export interface PianoModelSpec {
  readonly id: string
  readonly name: string
  /** Multiplies the voice's tone-filter cutoff; > 1 is a brighter voicing. */
  readonly brightness: number
  /** Multiplies the note release time. */
  readonly release: number
  /** Extra note on this model's voicing, surfaced in the UI and the details file. */
  readonly note: string
}

export interface PianoTypeSpec {
  readonly id: PianoTypeId
  readonly label: string
  /** Which timbre options the panel offers: Dyno 1/2 are electric-piano preamp emulations. */
  readonly family: 'acoustic' | 'electric'
  readonly source: 'recorded' | 'synthesised'
  /** Present exactly when `source` is `recorded`. */
  readonly sampleSet?: SampleSetId
  readonly models: readonly PianoModelSpec[]
  /** Soft Release is disabled for clavinet-type sounds (manual p. 25). */
  readonly supportsSoftRelease: boolean
}

export const PIANO_TYPES: readonly PianoTypeSpec[] = [
  {
    id: 'grand',
    label: 'Grand',
    family: 'acoustic',
    source: 'recorded',
    sampleSet: 'grand',
    supportsSoftRelease: true,
    models: [
      {
        id: 'grand-concert',
        name: 'Concert Grand YDP',
        brightness: 1,
        release: 1,
        note: 'Yamaha Disklavier Pro recordings, played flat.',
      },
      {
        id: 'grand-mellow',
        name: 'Concert Grand Mellow',
        brightness: 0.62,
        release: 1.25,
        note: 'The same recordings with a darker voicing filter and a longer damper release.',
      },
    ],
  },
  {
    id: 'upright',
    label: 'Upright',
    family: 'acoustic',
    source: 'recorded',
    sampleSet: 'upright',
    supportsSoftRelease: true,
    models: [
      {
        id: 'upright-kw',
        name: 'Upright KW',
        brightness: 1,
        release: 1,
        note: 'Kawai upright recordings, played flat.',
      },
      {
        id: 'upright-close',
        name: 'Upright KW Close',
        brightness: 1.45,
        release: 0.82,
        note: 'The same recordings voiced brighter and shorter, closer to a lid-up upright.',
      },
    ],
  },
  {
    id: 'electric',
    label: 'Electric',
    family: 'electric',
    source: 'recorded',
    sampleSet: 'electric',
    supportsSoftRelease: true,
    models: [
      {
        id: 'electric-tine',
        name: 'Tine EP',
        brightness: 1,
        release: 1,
        note: 'Rhodes-style tine electric piano recordings, played flat.',
      },
      {
        id: 'electric-tine-bright',
        name: 'Tine EP Bright',
        brightness: 1.7,
        release: 0.9,
        note: 'The same recordings with the bark of a harder tine setting.',
      },
    ],
  },
  {
    id: 'clav',
    label: 'Clav',
    family: 'electric',
    source: 'synthesised',
    supportsSoftRelease: false,
    models: [
      {
        id: 'clav-synth',
        name: 'Clav (synthesised)',
        brightness: 1,
        release: 1,
        note: 'Plucked clavinet character built from oscillators — not a recording.',
      },
    ],
  },
  {
    id: 'digital',
    label: 'Digital',
    family: 'electric',
    source: 'synthesised',
    supportsSoftRelease: true,
    models: [
      {
        id: 'digital-synth',
        name: 'Digital (synthesised)',
        brightness: 1,
        release: 1,
        note: 'FM-style bell/digital piano character built from oscillators — not a recording.',
      },
    ],
  },
  {
    id: 'misc',
    label: 'Misc',
    family: 'acoustic',
    source: 'synthesised',
    supportsSoftRelease: true,
    models: [
      {
        id: 'misc-mallet',
        name: 'Mallet (synthesised)',
        brightness: 1,
        release: 1,
        note: 'Marimba-style mallet character built from oscillators — not a recording.',
      },
    ],
  },
]

const TYPES_BY_ID = new Map(PIANO_TYPES.map((type) => [type.id, type]))

export function pianoType(id: PianoTypeId): PianoTypeSpec {
  const found = TYPES_BY_ID.get(id)
  if (!found) throw new Error(`Unknown piano type: ${id}`)
  return found
}

export function pianoModel(id: PianoTypeId, index: number): PianoModelSpec {
  const type = pianoType(id)
  return type.models[Math.min(Math.max(0, Math.round(index)), type.models.length - 1)]
}

/** Timbre options the panel offers for a type: Dyno 1/2 only exist on electric pianos. */
export function timbreOptionsFor(id: PianoTypeId): readonly TimbreId[] {
  const acoustic: readonly TimbreId[] = ['off', 'soft', 'mid', 'bright']
  return pianoType(id).family === 'electric' ? [...acoustic, 'dyno1', 'dyno2'] : acoustic
}

export function timbreIsAvailable(id: PianoTypeId, timbre: TimbreId): boolean {
  return timbreOptionsFor(id).includes(timbre)
}
