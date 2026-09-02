/**
 * The piano library registry: six types, their models in dial order, and the truthful source kind of
 * each model. Recorded models point at a bundled sample set (public/samples/<setId>/manifest.json);
 * generated models are rendered by code at runtime and are never described as recordings.
 */
export const PIANO_TYPES = ['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'] as const
export type PianoType = (typeof PIANO_TYPES)[number]

export type TimbreFamily = 'acoustic' | 'electric'

export interface PianoModel {
  id: string
  type: PianoType
  name: string
  kind: 'recorded' | 'generated'
  /** Bundled sample set id (recorded models). */
  setId?: string
  /** Short truthful source line for the display and status strip. */
  source: string
  license: string
  family: TimbreFamily
  /** Soft Release is disabled for Clav-type sounds (manual p. 25). */
  softReleaseSupported: boolean
}

export const PIANO_MODELS: readonly PianoModel[] = [
  { id: 'grand-salamander', type: 'Grand', name: 'Salamander C5', kind: 'recorded', setId: 'grand-salamander', source: 'Salamander Grand Piano V3 (Alexander Holm, Yamaha C5)', license: 'CC-BY-3.0', family: 'acoustic', softReleaseSupported: true },
  { id: 'upright-kw', type: 'Upright', name: 'Kawai Upright KW', kind: 'recorded', setId: 'upright-kw', source: 'Upright Piano KW (FreePats, Kawai upright)', license: 'CC0-1.0', family: 'acoustic', softReleaseSupported: true },
  { id: 'electric-wurlitzer-200', type: 'Electric', name: 'Wurlitzer EP200', kind: 'recorded', setId: 'electric-wurlitzer-200', source: "Greg Sullivan's E-Pianos (Wurlitzer EP200 reed piano)", license: 'CC-BY-3.0', family: 'electric', softReleaseSupported: true },
  { id: 'electric-pianet-t', type: 'Electric', name: 'Hohner Pianet T', kind: 'recorded', setId: 'electric-pianet-t', source: "Greg Sullivan's E-Pianos (Hohner Pianet T reed piano)", license: 'CC-BY-3.0', family: 'electric', softReleaseSupported: true },
  { id: 'electric-cp80', type: 'Electric', name: 'Yamaha CP80', kind: 'recorded', setId: 'electric-cp80', source: "Greg Sullivan's E-Pianos (Yamaha CP80 electric grand)", license: 'CC-BY-3.0', family: 'electric', softReleaseSupported: true },
  { id: 'clav-harpsichord', type: 'Clav', name: 'Harpsichord', kind: 'recorded', setId: 'clav-harpsichord', source: 'VCSL harpsichord (Versilian Studios)', license: 'CC0-1.0', family: 'acoustic', softReleaseSupported: false },
  { id: 'digital-tx81z-fm', type: 'Digital', name: 'TX81Z FM Piano', kind: 'recorded', setId: 'digital-tx81z-fm', source: 'VCSL TX81Z FM Piano (Versilian Studios, recorded from a Yamaha TX81Z)', license: 'CC0-1.0', family: 'electric', softReleaseSupported: true },
  { id: 'digital-additive', type: 'Digital', name: 'Additive Piano (generated)', kind: 'generated', source: 'Generated at runtime by additive synthesis (src/audio/pianoRenderer.ts); not a recording', license: 'Original code', family: 'acoustic', softReleaseSupported: true },
  { id: 'misc-marimba', type: 'Misc', name: 'Marimba', kind: 'recorded', setId: 'misc-marimba', source: 'VCSL marimba (Versilian Studios)', license: 'CC0-1.0', family: 'acoustic', softReleaseSupported: true },
]

export const MODEL_BY_ID: ReadonlyMap<string, PianoModel> = new Map(PIANO_MODELS.map((m) => [m.id, m]))

export function modelsOfType(type: PianoType): PianoModel[] {
  return PIANO_MODELS.filter((m) => m.type === type)
}

export function defaultModelFor(type: PianoType): PianoModel {
  const list = modelsOfType(type)
  if (list.length === 0) throw new Error(`No model registered for ${type}`)
  return list[0]
}

export function getModel(id: string): PianoModel {
  const m = MODEL_BY_ID.get(id)
  if (!m) throw new Error(`Unknown piano model ${id}`)
  return m
}

/** Next / previous model within the same type (wraps around). */
export function stepModel(id: string, direction: 1 | -1): PianoModel {
  const current = getModel(id)
  const list = modelsOfType(current.type)
  const i = list.findIndex((m) => m.id === id)
  return list[(i + direction + list.length) % list.length]
}

export const DEFAULT_MODEL_ID = PIANO_MODELS[0].id
