/**
 * Phase 2 piano type catalog: six selectable types with at least one model
 * each. Grand / Upright / Electric resolve to bundled recorded sample sets
 * (see `public/samples/manifest.json`); Clav / Digital / Misc are honest
 * live synthesis, rendered by `render.ts` / `graph.ts`.
 *
 * No Phase 1 module is touched; this is a pure catalog + routing table.
 */

export type PianoTypeId = 'grand' | 'upright' | 'electric' | 'clav' | 'digital' | 'misc';

export type LayerId = 'A' | 'B';

export type TimbreName = 'Off' | 'Soft' | 'Mid' | 'Bright' | 'Dyno 1' | 'Dyno 2';

export type KbTouchName = 'Heavy' | 'Medium' | 'Light';

export interface PianoModel {
  id: string;
  label: string;
  /** Sampled sets load bundled WAV assets; synth types render live. */
  source: 'samples' | 'synth';
  /** Sample-set directory under `public/samples/` (sampled sets only). */
  setId?: 'grand' | 'upright' | 'electric';
  /** Acoustic-family timbre table, or electric Dyno table. */
  timbreFamily: 'acoustic' | 'electric';
}

export interface PianoType {
  id: PianoTypeId;
  label: string;
  models: PianoModel[];
}

export const PIANO_TYPES: PianoType[] = [
  {
    id: 'grand',
    label: 'Grand',
    models: [
      { id: 'grand-studio', label: 'Studio Concert', source: 'samples', setId: 'grand', timbreFamily: 'acoustic' },
    ],
  },
  {
    id: 'upright',
    label: 'Upright',
    models: [
      { id: 'upright-studio', label: 'Studio Upright', source: 'samples', setId: 'upright', timbreFamily: 'acoustic' },
    ],
  },
  {
    id: 'electric',
    label: 'Electric',
    models: [
      { id: 'electric-tine', label: 'Stage Tine', source: 'samples', setId: 'electric', timbreFamily: 'electric' },
    ],
  },
  {
    id: 'clav',
    label: 'Clav',
    models: [{ id: 'clav-d6', label: 'Clavinet D6 (synth)', source: 'synth', timbreFamily: 'electric' }],
  },
  {
    id: 'digital',
    label: 'Digital',
    models: [{ id: 'digital-stage', label: 'Stage Digital (synth)', source: 'synth', timbreFamily: 'acoustic' }],
  },
  {
    id: 'misc',
    label: 'Misc',
    models: [{ id: 'misc-marimba', label: 'Marimba (synth)', source: 'synth', timbreFamily: 'acoustic' }],
  },
];

export function typeById(id: PianoTypeId): PianoType {
  const found = PIANO_TYPES.find((t) => t.id === id);
  if (!found) throw new Error(`unknown piano type: ${id}`);
  return found;
}

export interface LayerPianoState {
  enabled: boolean;
  type: PianoTypeId;
  model: number;
  level: number; // 0..10 UI fader
  /** Octave shift index 0..4 → -2..+2 (x12 semitones). Default 2 (0). */
  octave: number;
  /** SUSTPED: route sustain input to this layer. */
  sustPed: boolean;
  /** PSTICK: pitch stick bends this layer ±2 semitones. */
  pStick: boolean;
  kbTouch: KbTouchName;
  /** Dyn Comp 0..3 (Off/1/2/3). */
  dynComp: number;
  timbre: TimbreName;
  /** Unison 0..3 (Off/1/2/3). */
  unison: number;
  softRelease: boolean;
  stringRes: boolean;
}

export const DEFAULT_LAYER_PIANO: LayerPianoState = {
  enabled: true,
  type: 'grand',
  model: 0,
  level: 8,
  octave: 2,
  sustPed: true,
  pStick: true,
  kbTouch: 'Medium',
  dynComp: 0,
  timbre: 'Off',
  unison: 0,
  softRelease: false,
  stringRes: false,
};

export function defaultLayerPiano(overrides: Partial<LayerPianoState> = {}): LayerPianoState {
  return { ...DEFAULT_LAYER_PIANO, ...overrides };
}

/** Octave index 0..4 → semitone offset. */
export function octaveSemitones(index: number): number {
  return (Math.min(4, Math.max(0, index)) - 2) * 12;
}

/** Level fader 0..10 → linear gain 0..~1.12. */
export function layerLevelGain(level: number): number {
  const clamped = Math.min(10, Math.max(0, level));
  return clamped <= 0 ? 0 : 0.35 + (clamped / 10) * 0.77;
}

export function modelOf(layer: LayerPianoState): PianoModel {
  const type = typeById(layer.type);
  return type.models[Math.min(type.models.length - 1, Math.max(0, layer.model))];
}

/** Timbre table per family (spec `timbre.behavior`). */
export const TIMBRE_OPTIONS: Record<'acoustic' | 'electric', TimbreName[]> = {
  acoustic: ['Off', 'Soft', 'Mid', 'Bright'],
  electric: ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2'],
};

export const KB_TOUCH_OPTIONS: KbTouchName[] = ['Heavy', 'Medium', 'Light'];

export const MODEL_DIAL_MAX = 8;
