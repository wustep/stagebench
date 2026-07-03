import type { OrganModelId } from '../state/instrument'

/**
 * Partial recipes for the six modeled organ engines (spec:
 * nord-stage-4.organ.json, manual p. 18-22). All are GENERATED live
 * additive/subtractive synthesis — declared as digital models, never as
 * recordings — and are audibly distinct by construction:
 *
 * - B3     tonewheel: nine pure-sine partials at the classic footage ratios,
 *          plus percussion, key click and the vib/chorus scanner.
 * - Vox    transistor: seven reedy sawtooth partials; the 8th drawbar is
 *          unused (as on the original) and the 9th mixes a filtered (soft,
 *          dark) against the unfiltered (bright) signal (manual p. 21).
 * - Farf   transistor: buzzy square/saw register voices; drawbars act as
 *          on/off switches — pulled past half engages the register
 *          (manual p. 21-22).
 * - Pipe1  pipe: nine sine ranks with per-rank ensemble detune and a chiff
 *          attack transient instead of a key click.
 * - B3Bass (spec optional, "may reuse the B3 engine limited to 16' and 8'
 *          drawbars"): the same B3 tonewheel partials/key-click, but only
 *          drawbars 0 (16') and 2 (8') carry a partial — every other
 *          drawbar, including 1 (5⅓'), is silent — and percussion is
 *          unavailable, matching a Nord bass preset's stripped registration.
 * - Pipe2  (spec optional, "may reuse Pipe 1 with a brighter principal
 *          registration"): the same ranks/chiff as Pipe 1, but ranks 0-2
 *          switch from sine to triangle (brighter low ranks), ranks 4-8 get
 *          +60% level, and ensemble detune widens across all ranks — a
 *          brighter, busier principal chorus.
 *
 * Simplifications vs the real instrument, declared honestly: no tonewheel
 * folding/wear modeling, no contact-bounce modeling, registers approximate
 * the Farfisa voices by waveform/level rather than measured filters.
 */

export interface OrganPartial {
  /** Drawbar index 0..8 that controls this partial. */
  drawbar: number
  /** Frequency ratio relative to the 8' fundamental of the played note. */
  ratio: number
  wave: 'sine' | 'triangle' | 'square' | 'sawtooth'
  /** Recipe level scale applied before the drawbar taper. */
  level: number
  /** Fixed detune in cents (pipe ensemble character). */
  detune?: number
}

export interface OrganModelRecipe {
  partials: OrganPartial[]
  /** 'drawbar' = continuous -2.5 dB/step taper; 'switch' = on past half (Farf). */
  taper: 'drawbar' | 'switch'
  /** Attack transient: B3 key click, pipe chiff, or none (transistor models). */
  click: 'b3' | 'chiff' | null
  /** B3 percussion availability (manual p. 20: B3 only). */
  percussion: boolean
  /** Vox only: drawbar 9 crossfades filtered (dark) vs unfiltered (bright). */
  voxToneMix: boolean
}

/** Classic tonewheel footage ratios relative to 8': 16, 5⅓, 8, 4, 2⅔, 2, 1⅗, 1⅓, 1. */
const B3_RATIOS = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8] as const

export const ORGAN_MODEL_RECIPES: Record<OrganModelId, OrganModelRecipe> = {
  B3: {
    partials: B3_RATIOS.map((ratio, drawbar) => ({ drawbar, ratio, wave: 'sine' as const, level: 1 })),
    taper: 'drawbar',
    click: 'b3',
    percussion: true,
    voxToneMix: false,
  },
  Vox: {
    // Seven level drawbars; index 7 unused; index 8 = tone mix (engine-level).
    partials: [0.5, 1, 2, 3, 4, 5, 6].map((ratio, drawbar) => ({
      drawbar,
      ratio,
      wave: 'sawtooth' as const,
      level: 0.45,
    })),
    taper: 'drawbar',
    click: null,
    percussion: false,
    voxToneMix: true,
  },
  Farf: {
    // Register voices, named on the panel legends (BASS16 … 2⅔–1).
    partials: [
      { drawbar: 0, ratio: 0.5, wave: 'square', level: 0.9 },
      { drawbar: 1, ratio: 0.5, wave: 'sawtooth', level: 0.7 },
      { drawbar: 2, ratio: 1, wave: 'triangle', level: 1 },
      { drawbar: 3, ratio: 1, wave: 'square', level: 0.55 },
      { drawbar: 4, ratio: 1, wave: 'sawtooth', level: 0.7 },
      { drawbar: 5, ratio: 1, wave: 'sawtooth', level: 0.5, detune: 8 },
      { drawbar: 6, ratio: 2, wave: 'triangle', level: 0.85 },
      { drawbar: 7, ratio: 2, wave: 'sawtooth', level: 0.5 },
      { drawbar: 8, ratio: 4, wave: 'square', level: 0.4 },
    ],
    taper: 'switch',
    click: null,
    percussion: false,
    voxToneMix: false,
  },
  Pipe1: {
    partials: B3_RATIOS.map((ratio, drawbar) => ({
      drawbar,
      ratio,
      wave: 'sine' as const,
      level: 1,
      detune: (drawbar % 2 === 0 ? 1 : -1) * (3 + drawbar),
    })),
    taper: 'drawbar',
    click: 'chiff',
    percussion: false,
    voxToneMix: false,
  },
  // B3 Bass (spec optional): B3's tonewheel partials and key click, limited
  // to the 16' and 8' drawbars — the rest of the stack is simply absent, so
  // pulling any other drawbar has no audible effect.
  B3Bass: {
    partials: [
      { drawbar: 0, ratio: 0.5, wave: 'sine' as const, level: 1 }, // 16'
      { drawbar: 2, ratio: 1, wave: 'sine' as const, level: 1 }, // 8'
    ],
    taper: 'drawbar',
    click: 'b3',
    percussion: false,
    voxToneMix: false,
  },
  // Pipe 2 (spec optional): Pipe 1's ranks/detune/chiff with a brighter
  // principal registration — triangle waves on the bottom three ranks,
  // sine above, and the top five ranks boosted for a brighter chorus.
  Pipe2: {
    partials: B3_RATIOS.map((ratio, drawbar) => ({
      drawbar,
      ratio,
      wave: (drawbar <= 2 ? 'triangle' : 'sine') satisfies OrganPartial['wave'],
      level: drawbar >= 4 ? 1.6 : 1,
      // Wider ensemble detune than Pipe 1 (brighter, busier chorus beating).
      detune: (drawbar % 2 === 0 ? 1 : -1) * (6 + drawbar * 2),
    })),
    taper: 'drawbar',
    click: 'chiff',
    percussion: false,
    voxToneMix: false,
  },
}

/** Drawbar value 0..8 -> partial gain for the recipe's taper. */
export function drawbarPartialGain(recipe: OrganModelRecipe, value: number): number {
  if (recipe.taper === 'switch') return value > 4 ? 1 : 0
  if (value <= 0) return 0
  return Math.pow(10, ((value - 8) * 2.5) / 20)
}
