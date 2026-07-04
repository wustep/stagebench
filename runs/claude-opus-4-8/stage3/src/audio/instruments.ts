/**
 * Instrument registry for the six Piano types.
 *
 * Grand / Upright / Electric are backed by RECORDED, multi-sampled sets bundled
 * under public/samples/<set>/ (see scripts/fetch-samples.mjs and
 * IMPLEMENTATION_DETAILS.json for full provenance). Clav / Digital / Misc are
 * HONEST SYNTHESIS — declared as generated, never described as recordings.
 *
 * This module only declares metadata + the loader boundary; the actual sample
 * decode / buffer ownership lives in sampler.ts so it can be tested with an
 * injected fetch/decode.
 */

export type PianoTypeId = 'grand' | 'upright' | 'electric' | 'clav' | 'digital' | 'misc';

/** Display order matches the panel PIANO SELECT selector (Grand..Misc). */
export const PIANO_TYPES: readonly PianoTypeId[] = [
  'grand',
  'upright',
  'electric',
  'clav',
  'digital',
  'misc',
];

export interface SampledTypeDef {
  id: PianoTypeId;
  kind: 'sampled';
  label: string;
  model: string;
  /** Directory under public/samples/. */
  set: string;
  family: 'acoustic' | 'electric';
}

export interface SynthTypeDef {
  id: PianoTypeId;
  kind: 'synth';
  label: string;
  model: string;
  family: 'acoustic' | 'electric';
  /** Synthesis recipe id consumed by the synth voice. */
  recipe: 'clav' | 'digital' | 'mallet';
}

export type PianoTypeDef = SampledTypeDef | SynthTypeDef;

export const PIANO_TYPE_DEFS: Record<PianoTypeId, PianoTypeDef> = {
  grand: { id: 'grand', kind: 'sampled', label: 'Grand', model: 'Royal Grand', set: 'grand', family: 'acoustic' },
  upright: { id: 'upright', kind: 'sampled', label: 'Upright', model: 'Black Upright', set: 'upright', family: 'acoustic' },
  electric: { id: 'electric', kind: 'sampled', label: 'Electric', model: 'Tine EP', set: 'electric', family: 'electric' },
  clav: { id: 'clav', kind: 'synth', label: 'Clav', model: 'Clavinet D6', family: 'electric', recipe: 'clav' },
  digital: { id: 'digital', kind: 'synth', label: 'Digital', model: 'Digital Grand', family: 'acoustic', recipe: 'digital' },
  misc: { id: 'misc', kind: 'synth', label: 'Misc', model: 'Vibraphone', family: 'acoustic', recipe: 'mallet' },
};

/** Timbre option lists differ for acoustic vs electric families (piano spec). */
export const TIMBRE_ACOUSTIC = ['Off', 'Soft', 'Mid', 'Bright'] as const;
export const TIMBRE_ELECTRIC = ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2'] as const;

export interface SampleManifest {
  id: string;
  label: string;
  source: string;
  license: string;
  attribution: string;
  format: string;
  rootNotes: Array<{ note: string; midi: number; file: string }>;
}
