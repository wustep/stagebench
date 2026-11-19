export type MorphSourceId = 'wheel' | 'controlPedal'

/**
 * Canonical morph destinations documented in specs/nord-stage-4.programs.json:
 * - Organ: Layer Level, Drawbars (0..8), Rotary Speed
 * - Piano: Layer Level
 * - Synth: Layer Level, LFO Rate, Osc Ctrl, LFO Amount, Filter Freq, Filter Resonance, Arp/Gate Rate
 * - Effects: Mod 1 Rate, Mod 1 Amount, Mod 2 Amount, Delay Tempo, Delay Feedback, Delay Dry/Wet,
 *            EQ Mid/Filter Freq, Drive Amount, Reverb Dry/Wet
 */
export type FxChainKey = 'pianoA' | 'pianoB' | 'organ' | 'synthA' | 'synthB' | 'synthC'

export type MorphTargetId =
  | 'organ:A:level'
  | 'organ:B:level'
  | `organ:A:drawbar:${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`
  | `organ:B:drawbar:${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`
  | 'rotary:speed'
  | 'piano:A:level'
  | 'piano:B:level'
  | `synth:${'A' | 'B' | 'C'}:level`
  | `synth:${'A' | 'B' | 'C'}:lfoRate`
  | `synth:${'A' | 'B' | 'C'}:oscCtrl`
  | `synth:${'A' | 'B' | 'C'}:lfoAmt`
  | `synth:${'A' | 'B' | 'C'}:filterFreq`
  | `synth:${'A' | 'B' | 'C'}:filterRes`
  | `synth:${'A' | 'B' | 'C'}:arpRate`
  | `fx:${FxChainKey}:mod1Rate`
  | `fx:${FxChainKey}:mod1Amt`
  | `fx:${FxChainKey}:mod2Amt`
  | `fx:${FxChainKey}:delayTempo`
  | `fx:${FxChainKey}:delayFeedback`
  | `fx:${FxChainKey}:delayDryWet`
  | `fx:${FxChainKey}:eqMidFreq`
  | `fx:${FxChainKey}:drive`
  | `fx:${FxChainKey}:reverbDryWet`

export interface MorphAssignment {
  readonly target: MorphTargetId
  readonly start: number
  readonly end: number
}

export interface MorphState {
  readonly wheel: readonly MorphAssignment[]
  readonly controlPedal: readonly MorphAssignment[]
}

export interface MorphInputValues {
  readonly wheel: number // 0..100
  readonly controlPedal: number // 0..100
}

export function createEmptyMorphState(): MorphState {
  return {
    wheel: [],
    controlPedal: [],
  }
}

/**
 * Adds or updates a morph assignment for a source.
 * If `end === start` (zeroed range), removes that single assignment per manual p. 39.
 */
export function upsertMorphAssignment(
  morphs: MorphState,
  source: MorphSourceId,
  target: MorphTargetId,
  start: number,
  end: number,
): MorphState {
  const list = morphs[source]
  const existing = list.find((a) => a.target === target)
  const effectiveStart = existing ? existing.start : start

  if (Math.abs(end - effectiveStart) < 1e-6) {
    // Re-holding and zeroing a control removes that single assignment
    const nextList = list.filter((a) => a.target !== target)
    return { ...morphs, [source]: nextList }
  }

  const nextAssignment: MorphAssignment = { target, start: effectiveStart, end }
  const nextList = existing
    ? list.map((a) => (a.target === target ? nextAssignment : a))
    : [...list, nextAssignment]
  return { ...morphs, [source]: nextList }
}

/**
 * Clears all assignments for a specific morph source (Shift + source button, manual p. 39).
 */
export function clearMorphSource(morphs: MorphState, source: MorphSourceId): MorphState {
  if (morphs[source].length === 0) return morphs
  return { ...morphs, [source]: [] }
}

/**
 * Resolves the effective morphed parameter value given its base value, active morph assignments,
 * and current Wheel / Control Pedal positions (0..100).
 * Supports positive and negative (inverted) sweeps and simultaneous sources.
 */
export function resolveMorphedValue(
  baseValue: number,
  target: MorphTargetId,
  morphs: MorphState,
  inputs: MorphInputValues,
  min = 0,
  max = 100,
): number {
  let value = baseValue
  const wheelAssign = morphs.wheel.find((a) => a.target === target)
  if (wheelAssign) {
    const t = Math.max(0, Math.min(1, inputs.wheel / 100))
    value += (wheelAssign.end - wheelAssign.start) * t
  }
  const pedAssign = morphs.controlPedal.find((a) => a.target === target)
  if (pedAssign) {
    const t = Math.max(0, Math.min(1, inputs.controlPedal / 100))
    value += (pedAssign.end - pedAssign.start) * t
  }
  return Math.max(min, Math.min(max, value))
}

export interface MorphIndicatorInfo {
  readonly assigned: boolean
  readonly sources: readonly MorphSourceId[]
  readonly rangeStart: number
  readonly rangeEnd: number
}

/**
 * Returns indicator metadata for hardware green morph LEDs and fader/drawbar range graphs.
 */
export function getMorphIndicatorInfo(
  target: MorphTargetId | null,
  morphs: MorphState,
  baseValue: number,
): MorphIndicatorInfo {
  if (!target) {
    return { assigned: false, sources: [], rangeStart: baseValue, rangeEnd: baseValue }
  }
  const sources: MorphSourceId[] = []
  let rangeStart = baseValue
  let rangeEnd = baseValue
  const wheelAssign = morphs.wheel.find((a) => a.target === target)
  if (wheelAssign) {
    sources.push('wheel')
    rangeStart = wheelAssign.start
    rangeEnd = wheelAssign.end
  }
  const pedAssign = morphs.controlPedal.find((a) => a.target === target)
  if (pedAssign) {
    sources.push('controlPedal')
    if (!wheelAssign) {
      rangeStart = pedAssign.start
      rangeEnd = pedAssign.end
    } else {
      rangeStart = Math.min(rangeStart, pedAssign.start)
      rangeEnd = Math.max(rangeEnd, pedAssign.end)
    }
  }
  return {
    assigned: sources.length > 0,
    sources,
    rangeStart,
    rangeEnd,
  }
}

export function getMorphTargetMinMax(target: MorphTargetId): { min: number; max: number } {
  if (target.includes(':drawbar:')) return { min: 0, max: 8 }
  if (target === 'rotary:speed') return { min: 0, max: 1 }
  return { min: 0, max: 100 }
}
