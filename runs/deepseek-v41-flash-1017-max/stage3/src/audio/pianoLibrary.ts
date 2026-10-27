/**
 * Piano library — types, models, and the honest distinction between recorded and
 * modelled sound sources.
 *
 * `specs/nord-stage-4.piano.json` requires six selectable types with at least one model
 * each, and requires Grand, Upright and Electric to be *recorded*, bundled, redistributable
 * sample sets. Clav, Digital and Misc are allowed to be honest synthesis, so they are
 * declared as modelled everywhere they are named — never presented as recordings.
 */
import type { PianoModelId, PianoTypeId } from './types'

export type SourceKind = 'recorded' | 'modelled'

export interface PianoModel {
  id: PianoModelId
  /** Name printed in the Program display, e.g. "Salamander Grand". */
  name: string
  type: PianoTypeId
  source: SourceKind
  /** One line of provenance, printed in INFO and recorded in IMPLEMENTATION_DETAILS. */
  provenance: string
  /** Character description used by the synth model and by the panel's list view. */
  character: string
  /** True when the model supports SOFT RELEASE (manual p. 25: not on Clav sounds). */
  softRelease: boolean
  /** True when STRING RES applies (manual p. 25: acoustic pianos only). */
  stringRes: boolean
}

export const PIANO_TYPES: readonly { id: PianoTypeId; label: string; legend: string }[] = [
  { id: 'grand', label: 'Grand', legend: 'GRAND' },
  { id: 'upright', label: 'Upright', legend: 'UPRIGHT' },
  { id: 'electric', label: 'Electric', legend: 'ELECTRIC' },
  { id: 'clav', label: 'Clav', legend: 'CLAV' },
  { id: 'digital', label: 'Digital', legend: 'DIGITAL' },
  { id: 'misc', label: 'Misc', legend: 'MISC' },
]

export const PIANO_MODELS: readonly PianoModel[] = [
  {
    id: 'grand.salamander',
    name: 'Salamander Grand',
    type: 'grand',
    source: 'recorded',
    provenance: 'Salamander Grand Piano V3 (Yamaha C5) by Alexander Holm — CC BY 3.0',
    character: 'Full concert grand',
    softRelease: true,
    stringRes: true,
  },
  {
    id: 'grand.studio',
    name: 'Studio Grand',
    type: 'grand',
    source: 'recorded',
    provenance: 'Salamander Grand Piano V3, bright velocity layer emphasis — CC BY 3.0',
    character: 'Bright studio grand',
    softRelease: true,
    stringRes: true,
  },
  {
    id: 'upright.ivy',
    name: 'Ivy Upright',
    type: 'upright',
    source: 'recorded',
    provenance: 'VSCO 2 CE Upright Piano, recorded by Ivy Audio / Simon Dalzell — CC0 1.0',
    character: 'Warm close-miked upright',
    softRelease: true,
    stringRes: true,
  },
  {
    id: 'electric.cp80',
    name: 'CP80 Electric Grand',
    type: 'electric',
    source: 'recorded',
    provenance: 'Greg Sullivan’s E-Pianos, Yamaha CP80 — CC BY 3.0',
    character: 'Tine electric grand',
    softRelease: true,
    stringRes: false,
  },
  {
    id: 'electric.wurlitzer',
    name: 'Wurlitzer EP200',
    type: 'electric',
    source: 'recorded',
    provenance: 'Greg Sullivan’s E-Pianos, Wurlitzer EP200 — CC BY 3.0',
    character: 'Reed electric piano',
    softRelease: true,
    stringRes: false,
  },
  {
    id: 'clav.modelled',
    name: 'Clav D6 (modelled)',
    type: 'clav',
    source: 'modelled',
    provenance: 'Synthesised for this candidate — no samples, no third-party material',
    character: 'Bright plucked clavinet',
    softRelease: false,
    stringRes: false,
  },
  {
    id: 'digital.modelled',
    name: 'Digital Layer (modelled)',
    type: 'digital',
    source: 'modelled',
    provenance: 'Synthesised for this candidate — no samples, no third-party material',
    character: 'Clean digital piano',
    softRelease: true,
    stringRes: false,
  },
  {
    id: 'misc.modelled',
    name: 'Mallet (modelled)',
    type: 'misc',
    source: 'modelled',
    provenance: 'Synthesised for this candidate — no samples, no third-party material',
    character: 'Marimba / vibraphone mallet',
    softRelease: false,
    stringRes: false,
  },
]

export function modelsForType(type: PianoTypeId): PianoModel[] {
  return PIANO_MODELS.filter((m) => m.type === type)
}

export function modelById(id: PianoModelId): PianoModel | undefined {
  return PIANO_MODELS.find((m) => m.id === id)
}

export function defaultModelForType(type: PianoTypeId): PianoModel {
  const found = modelsForType(type)[0]
  if (!found) throw new Error(`no piano model for type ${type}`)
  return found
}

/**
 * Timbre positions per type family (manual p. 26).
 *
 * The panel prints one shared five-position list ("SOFT, MID, BRIGHT, DYNO 1, DYNO 2"),
 * because that is what the hardware prints. Each family interprets those positions with
 * its own voicings: acoustic pianos have Soft/Mid/Bright and no Dyno settings, electric
 * pianos have all five, and a Clavinet uses its own pickup-EQ names. A position a family
 * does not define resolves to that family's nearest defined voicing, and the Program
 * display prints the voicing that is actually in force — so the LED position and the sound
 * never disagree silently.
 */
export const TIMBRE_ACOUSTIC = ['Off', 'Soft', 'Mid', 'Bright'] as const
export const TIMBRE_ELECTRIC = ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2'] as const
export const TIMBRE_CLAV = ['Off', 'Soft', 'Treble', 'Brilliant', 'Soft+Treble'] as const

export function timbreOptionsFor(type: PianoTypeId): readonly string[] {
  if (type === 'electric') return TIMBRE_ELECTRIC
  if (type === 'clav') return TIMBRE_CLAV
  return TIMBRE_ACOUSTIC
}

/**
 * Resolves a printed panel position (0..4 = SOFT, MID, BRIGHT, DYNO 1, DYNO 2) into the
 * voicing index of `type`'s own list.
 *
 * The panel has no "Off" position — its first printed position is SOFT — so position 0
 * maps to the family's first *voicing* (SOFT), not to that list's own leading "Off" entry.
 * Acoustic pianos stop at BRIGHT, so their Dyno positions stay at BRIGHT rather than
 * silently borrowing an electric-piano voicing.
 */
export function timbreIndexFor(type: PianoTypeId, panelPosition: number): number {
  const options = timbreOptionsFor(type)
  const clamped = Math.max(0, Math.min(4, Math.round(panelPosition)))
  return Math.min(options.length - 1, clamped + 1)
}

/** The voicing name actually in force, for the display. */
export function timbreLabelFor(type: PianoTypeId, panelPosition: number): string {
  return timbreOptionsFor(type)[timbreIndexFor(type, panelPosition)]
}

/** KB Touch curves: index 0 = HEAVY, 1 = MEDIUM, 2 = LIGHT (manual p. 25). */
export const KB_TOUCH_CURVES = [
  { label: 'HEAVY', exponent: 1.45 },
  { label: 'MED', exponent: 1.0 },
  { label: 'LIGHT', exponent: 0.68 },
] as const

/** Dyn Comp settings: index 0 = OFF, then 1..3 with increasing compression (manual p. 25). */
export const DYN_COMP_AMOUNTS = [0, 0.34, 0.58, 0.78] as const

/** Unison settings: index 0 = OFF, then 1..3 with increasing detune (manual p. 26). */
export const UNISON_DETUNE_CENTS = [0, 4.5, 10, 18] as const
export const UNISON_STEREO_SPREAD = [0, 0.28, 0.5, 0.72] as const

export function typeIdForLabel(label: string): PianoTypeId | undefined {
  return PIANO_TYPES.find((t) => t.legend === label.toUpperCase())?.id
}

export function typeLabel(type: PianoTypeId): string {
  return PIANO_TYPES.find((t) => t.id === type)?.legend ?? type.toUpperCase()
}
