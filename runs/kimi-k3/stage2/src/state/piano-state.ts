/**
 * Canonical piano performance state (Phase 2).
 *
 * One instance lives on the engine; the panel bindings write through it and
 * the renderer reads it. Everything here measurably changes rendered audio.
 */

export type KbTouch = 0 | 1 | 2 // Heavy, Medium, Light
export const KB_TOUCH_LABELS = ['Heavy', 'Medium', 'Light'] as const

export type DynComp = 0 | 1 | 2 | 3 // Off, 1, 2, 3
export type Unison = 0 | 1 | 2 | 3 // Off, 1, 2, 3

/** Timbre options; electric types add Dyno 1 / Dyno 2 (manual p. 26). */
export const TIMBRE_ACOUSTIC = ['Off', 'Soft', 'Mid', 'Bright'] as const
export const TIMBRE_ELECTRIC = ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2'] as const

export interface PianoPerfState {
  kbTouch: KbTouch
  dynComp: DynComp
  timbre: number // index into the active type family's timbre list
  unison: Unison
  softRelease: boolean
  stringRes: boolean
}

export const DEFAULT_PIANO_PERF: PianoPerfState = {
  kbTouch: 1, // Medium
  dynComp: 0,
  timbre: 0,
  unison: 0,
  softRelease: false,
  stringRes: false,
}

/**
 * KB Touch velocity curves (manual p. 25): Heavy needs harder strikes for the
 * same level, Light reaches full level sooner, Medium is neutral.
 */
export function applyKbTouch(velocity: number, touch: KbTouch): number {
  const v = Math.min(1, Math.max(0, velocity))
  switch (touch) {
    case 0:
      return Math.pow(v, 1.5)
    case 2:
      return Math.pow(v, 0.6)
    default:
      return v
  }
}

/**
 * Dyn Comp (manual p. 25): raises the level of softer strokes, narrowing the
 * dynamic range without changing timbre response. Level 3 compresses most.
 */
export function applyDynComp(gain: number, level: DynComp): number {
  if (level === 0) return gain
  const g = Math.max(0, gain)
  const strength = level / 3
  // Soft-knee upward compression toward a raised floor.
  const floor = 0.18 * strength
  const compressed = floor + (1 - floor) * Math.pow(g, 1 - 0.55 * strength)
  return compressed
}
