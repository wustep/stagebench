/**
 * Morph system (Phase 3, specs/nord-stage-4.programs.json `morph`).
 *
 * Sources: modulation Wheel and Control Pedal (aftertouch is spec-excluded).
 * An assignment maps one destination control to a from→to range on the
 * control's own scale; moving the source interpolates every destination.
 * Sources live in [0,1].
 */

export type MorphSource = 'wheel' | 'ctrlPedal'
export const MORPH_SOURCES: readonly MorphSource[] = ['wheel', 'ctrlPedal']

export interface MorphAssignment {
  /** Destination control id (panel control). */
  controlId: string
  /** Value when the source is at 0. */
  from: number
  /** Value when the source is at 1. May be below `from` (inverse morph). */
  to: number
}

export interface MorphState {
  wheel: MorphAssignment[]
  ctrlPedal: MorphAssignment[]
}

export function defaultMorphState(): MorphState {
  return { wheel: [], ctrlPedal: [] }
}

/**
 * Morphable destinations, per the programs spec `morph.destinations`.
 * Used by the binding audit: assigning any other control is rejected.
 */
export const MORPHABLE_CONTROLS: ReadonlySet<string> = new Set([
  // organ: Layer Level, Drawbars, Rotary Speed
  'organ.level',
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `organ.drawbar.${n}`),
  'organ.rotarySpeed',
  // piano: Layer Level
  'piano.level',
  // synth: Layer Level, LFO Rate, Osc Ctrl, LFO Amount, Filter Freq/Res, Arp Rate
  'synth.level',
  'synth.lfoRate',
  'synth.oscShape',
  'synth.lfoAmount',
  'synth.filterCutoff',
  'synth.filterResonance',
  'synth.arpRate',
  // effects: Mod1 Rate/Amount, Mod2 Amount, Delay Tempo/Feedback/DryWet,
  // EQ Mid/Filter Freq, Drive, Reverb Dry/Wet
  'fx.effect1Rate',
  'fx.effect1Amount',
  'fx.effect2Amount',
  'fx.delayRate',
  'fx.delayFeedback',
  'fx.delayMix',
  'fx.eqMidGain',
  'fx.ampDrive',
  'fx.reverbAmount',
])

export function isMorphableControl(id: string): boolean {
  return MORPHABLE_CONTROLS.has(id)
}

/** Interpolated destination value for a source position in [0,1]. */
export function morphValue(a: MorphAssignment, pos: number): number {
  const p = Math.min(1, Math.max(0, pos))
  return a.from + (a.to - a.from) * p
}
