/**
 * Organ DSP contract (specs/nord-stage-4.organ.json, manual p. 18–22). The OrganUnit (src/dsp/organ.ts) renders BOTH
 * organ layers into one stereo block processor (the two layers share one effect chain, manual p. 18), so a single
 * `organ` processor node sits in front of the shared organ LayerChain. Parameters are the canonical program values;
 * note events arrive as messages (ProcessorNodeLike.send) and are applied at the next block.
 */

/** Organ models in panel option order (src/hardware/controls.ts `organ.model`). */
export const ORGAN_MODELS = ['B3', 'Vox', 'Farf', 'Pipe 1', 'Pipe 2', 'B3 Bass'] as const
export type OrganModelName = (typeof ORGAN_MODELS)[number]
/** Vibrato / chorus positions in panel option order (`organ.vibrato.mode`). */
export const ORGAN_VIBRATO_MODES = ['V1', 'C1', 'V2', 'C2', 'V3', 'C3'] as const
export type OrganLayerId = 'A' | 'B'
export const ORGAN_LAYER_IDS: readonly OrganLayerId[] = ['A', 'B']

/** B3 / Pipe footages per drawbar and their frequency ratio to the 8′ fundamental (manual p. 19). */
export const DRAWBAR_FOOTAGES = ["16'", "5 1/3'", "8'", "4'", "2 2/3'", "2'", "1 3/5'", "1 1/3'", "1'"] as const
export const DRAWBAR_RATIOS = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8] as const
/** Vox: seven partial drawbars (16′ 8′ 4′ 2′ II III IV), drawbar 8 unused, drawbar 9 = filtered/unfiltered mix (manual p. 20). */
export const VOX_DRAWBAR_LEGENDS = ["16'", "8'", "4'", "2'", 'II', 'III', 'IV', '—', '∿/M'] as const
export const VOX_DRAWBAR_RATIOS: readonly (readonly number[])[] = [[0.5], [1], [2], [4], [3, 4], [5, 6, 8], [3, 4, 5, 8], [], []]
/** Farf registers (manual p. 21): drawbar pulled past half = register on. */
export const FARF_REGISTERS = ['Bass 16', 'Strings 16', 'Flute 8', 'Oboe 8', 'Trumpet 8', 'Strings 8', 'Flute 4', 'Strings 4', '2 2/3'] as const
export const FARF_REGISTER_RATIOS = [0.5, 0.5, 1, 1, 1, 1, 2, 2, 3] as const
export const FARF_ON_THRESHOLD = 4

/** Drawbar position 0..8 → linear gain (3 dB per step, 0 = off), as on a tonewheel organ. */
export function drawbarGain(position: number): number {
  const p = Math.max(0, Math.min(8, Math.round(position)))
  return p === 0 ? 0 : Math.pow(10, ((p - 8) * 3) / 20)
}

/** Farf register switch: on when pulled more than half way (manual p. 21). */
export const farfRegisterOn = (position: number) => position > FARF_ON_THRESHOLD

/** Which drawbars a model actually reads (B3 Bass: 16′ and 8′ only; Vox: drawbar 8 unused). */
export function activeDrawbars(model: number): boolean[] {
  if (model === 5) return [true, false, true, false, false, false, false, false, false]
  if (model === 1) return [true, true, true, true, true, true, true, false, true]
  return [true, true, true, true, true, true, true, true, true]
}

export interface OrganLayerParams {
  on: boolean
  /** Index into ORGAN_MODELS. */
  model: number
  /** Nine drawbar positions 0..8 (panel values; Farf reads them as switches). */
  drawbars: number[]
  /** Level fader 0..100 (faderToGain taper, morphable). */
  level: number
  /** Octave shift −1..1. */
  octave: number
  /** Vibrato / chorus on for this layer (B3 and Pipe per layer; Vox / Farf shared by the controller). */
  vibrato: boolean
  /** SUSTPED for this layer: sustain events hold its notes. */
  sustped: boolean
  /** PSTICK: the pitch stick bends this layer. */
  pstick: boolean
}

export interface OrganPercussionParams {
  on: boolean
  /** VOLUME SOFT. */
  soft: boolean
  /** DECAY FAST. */
  fast: boolean
  /** HARMONIC THIRD (else second). */
  third: boolean
  /** POLY (Shift + Volume): retrigger per note instead of single-triggered. */
  poly: boolean
}

export interface OrganParams {
  /** Section ON. */
  on: boolean
  layers: Record<OrganLayerId, OrganLayerParams>
  /** Index into ORGAN_VIBRATO_MODES (V1 C1 V2 C2 V3 C3). */
  vibratoMode: number
  percussion: OrganPercussionParams
  /** B3 key click level 0..1 (fixed by the benchmark: the Sound-menu level is excluded). */
  keyClick: number
  /** Pitch stick position −1..1 (±2 semitones on layers with PSTICK). */
  pitchBend: number
}

export type OrganEvent =
  | { type: 'on'; layer: OrganLayerId; midi: number; velocity: number; gain: number }
  | { type: 'off'; layer: OrganLayerId; midi: number }
  | { type: 'sustain'; on: boolean }
  | { type: 'allOff' }

export function defaultOrganLayerParams(overrides: Partial<OrganLayerParams> = {}): OrganLayerParams {
  return { on: false, model: 0, drawbars: [8, 8, 8, 0, 0, 0, 0, 0, 0], level: 78, octave: 0, vibrato: false, sustped: true, pstick: false, ...overrides }
}

export function defaultOrganParams(): OrganParams {
  return {
    on: false,
    layers: { A: defaultOrganLayerParams({ on: true, level: 78 }), B: defaultOrganLayerParams({ on: false, level: 55 }) },
    vibratoMode: 5,
    percussion: { on: false, soft: false, fast: true, third: true, poly: false },
    keyClick: 0.5,
    pitchBend: 0,
  }
}

export const KEY_CLICK_LEVEL = 0.5
