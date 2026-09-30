import manifest from './manifest.json'

export type PianoType = 'Grand' | 'Upright' | 'Electric' | 'Clav' | 'Digital' | 'Misc'
export const PIANO_TYPES: readonly PianoType[] = ['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc']

/** Recorded models are played from bundled sample files; synth models are live synthesis (never called recordings). */
export type SynthKind = 'clav-neck' | 'clav-bridge' | 'clav-both' | 'clav-out-of-phase' | 'digital-fm-ep' | 'digital-layered' | 'misc-marimba' | 'misc-vibes'

export interface ModelInfo {
  id: string
  type: PianoType
  name: string
  kind: 'recorded' | 'synth'
  synth?: SynthKind
  /** honest one-line description shown in the details / provenance */
  description: string
}

export interface ManifestSample {
  file: string
  root: number
  cents: number
  sampleRate: number
  durationSec: number
  bytes: number
  source: string
  /** RMS of the first half second of the stored file (used to level every sample to the velocity curve) */
  rms: number
}
export interface ManifestLayer {
  /** nominal MIDI velocity at the centre of the recorded layer */
  velocity: number
  samples: ManifestSample[]
}
export interface ManifestModel {
  id: string
  type: PianoType
  name: string
  author: string
  license: string
  licenseUrl: string
  sourceUrl: string
  mirrorUrl?: string | null
  attribution: string
  encoding: string
  layers: ManifestLayer[]
}

export const RECORDED: readonly ManifestModel[] = (manifest as { models: ManifestModel[] }).models

const recorded = (m: ManifestModel): ModelInfo => ({ id: m.id, type: m.type, name: m.name, kind: 'recorded', description: `Recorded samples: ${m.attribution}` })

const synth = (id: string, type: PianoType, name: string, kind: SynthKind, description: string): ModelInfo => ({ id, type, name, kind: 'synth', synth: kind, description })

/**
 * Every model, grouped by type. Counts are 1, 2 or 4 so the 32-detent endless model dial wraps consistently.
 * Grand and Upright each have a single recorded model, Electric has two.
 */
export const MODELS: Record<PianoType, ModelInfo[]> = {
  Grand: RECORDED.filter((m) => m.type === 'Grand').map(recorded),
  Upright: RECORDED.filter((m) => m.type === 'Upright').map(recorded),
  Electric: RECORDED.filter((m) => m.type === 'Electric').map(recorded),
  Clav: [
    synth('clav-a', 'Clav', 'Clav A (neck pickup)', 'clav-neck', 'Live synthesis: plucked sawtooth string, warm neck-pickup filtering'),
    synth('clav-b', 'Clav', 'Clav B (bridge pickup)', 'clav-bridge', 'Live synthesis: plucked sawtooth string, bright bridge-pickup filtering'),
    synth('clav-c', 'Clav', 'Clav C (both, in phase)', 'clav-both', 'Live synthesis: plucked sawtooth string, both pickups in phase (full)'),
    synth('clav-d', 'Clav', 'Clav D (out of phase)', 'clav-out-of-phase', 'Live synthesis: plucked sawtooth string, pickups out of phase (thin)'),
  ],
  Digital: [
    synth('digital-fm', 'Digital', 'Digital FM E.P.', 'digital-fm-ep', 'Live synthesis: two-operator FM electric piano'),
    synth('digital-layer', 'Digital', 'Layered Piano + Pad', 'digital-layered', 'Live synthesis: additive piano layered with a soft pad'),
  ],
  Misc: [
    synth('misc-marimba', 'Misc', 'Marimba', 'misc-marimba', 'Live synthesis: sine partials at marimba ratios with a short decay'),
    synth('misc-vibes', 'Misc', 'Vibraphone', 'misc-vibes', 'Live synthesis: sine partials with motor tremolo and a long decay'),
  ],
}

export const ALL_MODELS: readonly ModelInfo[] = PIANO_TYPES.flatMap((t) => MODELS[t])

export const modelById = (id: string): ModelInfo | undefined => ALL_MODELS.find((m) => m.id === id)
export const recordedById = (id: string): ManifestModel | undefined => RECORDED.find((m) => m.id === id)

export const modelFor = (type: PianoType, index: number): ModelInfo => {
  const list = MODELS[type]
  return list[((index % list.length) + list.length) % list.length]
}

/** Timbre choices per family: the electric family adds the two Dyno preamp settings. */
export type Timbre = 'Off' | 'Soft' | 'Mid' | 'Bright' | 'Dyno 1' | 'Dyno 2'
export const TIMBRES: readonly Timbre[] = ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2']
export const timbresFor = (type: PianoType): readonly Timbre[] => (type === 'Electric' ? TIMBRES : TIMBRES.slice(0, 4))
export const isAcoustic = (type: PianoType): boolean => type === 'Grand' || type === 'Upright'
export const softReleaseAvailable = (type: PianoType): boolean => type !== 'Clav'
export const stringResAvailable = (type: PianoType): boolean => isAcoustic(type)
