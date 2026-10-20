// Morph: one source moves many destinations from a start value to an end value. The source amount
// is the Wheel (performance.mod-wheel) or the Control Pedal (performance.control-pedal). Morphs are
// applied to a copy of the panel state before audio settings are derived, so every audible path reads
// the morphed value and the panel keeps showing the values the player set.

import { getControl, isContinuous, type PresentationState } from './hardware'

export type MorphSource = 'wheel' | 'pedal'
export const MORPH_SOURCES: readonly MorphSource[] = ['wheel', 'pedal']

export interface MorphAssignment {
  /** Presentation key of the destination, e.g. `effects.delay-time@A` for a layer-scoped control. */
  key: string
  start: number
  end: number
}

export type MorphMap = Readonly<Record<MorphSource, readonly MorphAssignment[]>>

export const EMPTY_MORPHS: MorphMap = { wheel: [], pedal: [] }

/** The spec's destination list, by control ID. Each entry covers every layer or chain of that control. */
const DESTINATION_IDS: readonly string[] = [
  // Organ: layer level, drawbars, rotary speed.
  'organ.layer-a-level',
  'organ.layer-b-level',
  'organ.drawbar-16',
  'organ.drawbar-5-1-3',
  'organ.drawbar-8',
  'organ.drawbar-4',
  'organ.drawbar-2-2-3',
  'organ.drawbar-2',
  'organ.drawbar-1-3-5',
  'organ.drawbar-1-1-3',
  'organ.drawbar-1',
  'performance.rotary-speed',
  // Piano: layer level.
  'piano.layer-a-level',
  'piano.layer-b-level',
  // Synth: layer level, LFO rate and amount, osc ctrl, filter cutoff and resonance, arpeggiator rate.
  'synth.layer-a-level',
  'synth.layer-b-level',
  'synth.layer-c-level',
  'synth.lfo-rate',
  'synth.lfo-amount',
  'synth.osc-ctrl',
  'synth.filter-cutoff',
  'synth.filter-resonance',
  'synth.arp-rate',
  // Effects: Mod 1 rate and amount, Mod 2 amount, delay tempo, feedback, mix, EQ mid/filter freq, drive, reverb mix.
  'effects.mod1-rate',
  'effects.mod1-amount',
  'effects.mod2-amount',
  'effects.delay-time',
  'effects.delay-feedback',
  'effects.delay-level',
  'effects.amp-tone',
  'effects.amp-drive',
  'effects.reverb-level',
]

/** Whether a presentation key may be a morph destination: its control is continuous and listed by the spec. */
export function isMorphDestination(key: string): boolean {
  const id = key.split('@')[0]
  const control = getControl(id)
  return control !== undefined && isContinuous(control.kind) && DESTINATION_IDS.includes(id)
}

/** The amount a source contributes, 0..1. */
export function sourceAmount(state: PresentationState, source: MorphSource): number {
  const id = source === 'wheel' ? 'performance.mod-wheel' : 'performance.control-pedal'
  return state[id] ?? 0
}

/**
 * Returns the state with every morph destination interpolated: start + (end - start) * amount.
 * Assignments from both sources stack in order, so one destination may move with both.
 */
export function applyMorphs(state: PresentationState, morphs: MorphMap): PresentationState {
  let next: Record<string, number> | undefined
  for (const source of MORPH_SOURCES) {
    const amount = sourceAmount(state, source)
    for (const assignment of morphs[source]) {
      next ??= { ...state }
      next[assignment.key] = assignment.start + (assignment.end - assignment.start) * amount
    }
  }
  return next ?? state
}

/** The assignment for a key, if the source has one. */
export function assignmentFor(morphs: MorphMap, source: MorphSource, key: string): MorphAssignment | undefined {
  return morphs[source].find((assignment) => assignment.key === key)
}

/** Records a destination move while a source is in assign mode. Zeroing a destination back to its start removes it. */
export function assignMorph(morphs: MorphMap, source: MorphSource, key: string, start: number, end: number): MorphMap {
  const others = morphs[source].filter((assignment) => assignment.key !== key)
  const existing = assignmentFor(morphs, source, key)
  const startValue = existing?.start ?? start
  if (Math.abs(end - startValue) < 1e-9) {
    return { ...morphs, [source]: others }
  }
  return { ...morphs, [source]: [...others, { key, start: startValue, end }] }
}

/** Clears every assignment of one source. */
export function clearMorphSource(morphs: MorphMap, source: MorphSource): MorphMap {
  return { ...morphs, [source]: [] }
}
