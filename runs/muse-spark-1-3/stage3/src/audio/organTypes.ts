/**
 * Phase 3 organ type catalog: two layers (A, B) sharing one effect chain.
 * Four required-distinct engines (B3, Vox, Farf, Pipe 1); B3 Bass reuses the
 * B3 engine limited to 16' + 8' drawbars, Pipe 2 reuses Pipe 1 with a
 * brighter principal registration (both documented in the organ spec).
 * Pure catalog + state; rendering lives in `organRender.ts`.
 */

export type OrganModelId = 'B3' | 'B3 Bass' | 'Vox' | 'Farf' | 'Pipe 1' | 'Pipe 2';

export type OrganLayerId = 'A' | 'B';

export const ORGAN_MODELS: OrganModelId[] = ['B3', 'B3 Bass', 'Vox', 'Farf', 'Pipe 1', 'Pipe 2'];

export type VibChorusPos = 'C1' | 'C2' | 'C3' | 'V1' | 'V2' | 'V3';

export const VIB_CHORUS_POSITIONS: VibChorusPos[] = ['C1', 'C2', 'C3', 'V1', 'V2', 'V3'];

export interface B3Percussion {
  on: boolean;
  /** false = Normal, true = Soft. */
  soft: boolean;
  /** false = Slow, true = Fast decay. */
  fast: boolean;
  /** false = 2nd harmonic, true = 3rd harmonic. */
  third: boolean;
}

export interface OrganLayerState {
  enabled: boolean;
  model: OrganModelId;
  /** Nine drawbar positions 0..8 (Farf: pulled past half = on). */
  drawbars: number[];
  /** Level fader 0..10 (morphable). */
  level: number;
  /** Octave shift index 0..4 → -2..+2 (x12 semitones). */
  octave: number;
  sustPed: boolean;
  pStick: boolean;
  percussion: B3Percussion;
  keyClick: boolean;
  vibChorus: VibChorusPos;
  /** Per-layer on/off for B3 (spec: vibrato/chorus C1-C3/V1-V3 with per-layer on/off). */
  vibOn: boolean;
}

export const DEFAULT_ORGAN_LAYER: OrganLayerState = {
  enabled: true,
  model: 'B3',
  drawbars: [8, 6, 8, 6, 4, 2, 0, 0, 4],
  level: 8,
  octave: 2,
  sustPed: true,
  pStick: true,
  percussion: { on: false, soft: false, fast: false, third: false },
  keyClick: true,
  vibChorus: 'C3',
  vibOn: false,
};

export function defaultOrganLayer(overrides: Partial<OrganLayerState> = {}): OrganLayerState {
  return {
    ...DEFAULT_ORGAN_LAYER,
    ...overrides,
    drawbars: [...(overrides.drawbars ?? DEFAULT_ORGAN_LAYER.drawbars)],
    percussion: { ...DEFAULT_ORGAN_LAYER.percussion, ...(overrides.percussion ?? {}) },
  };
}

export function clampDrawbar(v: number): number {
  return Math.min(8, Math.max(0, Math.round(v)));
}

/** Octave index 0..4 → semitone offset. */
export function organOctaveSemitones(index: number): number {
  return (Math.min(4, Math.max(0, index)) - 2) * 12;
}

/** B3 footages (drawbar legends, manual p. 19). */
export const B3_FOOTAGES = ["16'", "5 1/3'", "8'", "4'", "2 2/3'", "2'", "1 3/5'", "1 1/3'", "1'"] as const;

/** B3 harmonic ratios relative to the played note (footage → ratio). */
export const B3_RATIOS = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8] as const;

/** Vox: seven partials + filtered/unfiltered mix (rightmost drawbar). */
export const VOX_RATIOS = [0.5, 1, 2, 4, 8, 16, 2.01] as const;

/** Farf register names (manual p. 21 table). */
export const FARF_REGISTERS = ['BASS16', 'STR16', 'FLUTE8', 'OBOE8', 'TRMP8', 'STR8', 'FLUTE4', 'STR4', '2 2/3'] as const;

/** Pipe ranks 16'..1' reuse the B3 footing ratios. */
export const PIPE_RATIOS = B3_RATIOS;

/** Rotary speeds: organ adds morphable Stop (effects spec optional, claimed). */
export type OrganRotarySpeed = 'slow' | 'fast' | 'stop';
