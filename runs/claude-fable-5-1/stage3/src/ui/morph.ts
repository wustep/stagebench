import { morphAssignmentsFor, morphPathFor, morphedValueFor } from '../state/morphPaths'
import { useInstrumentState } from './context'

/** True when the value a control currently edits has a Wheel or Control Pedal morph (green morph LED, manual p. 39). */
export function useMorphAssigned(id: string): boolean {
  return useInstrumentState((s) => {
    const path = morphPathFor(id, s)
    if (!path) return false
    return s.morph.wheel.some((a) => a.path === path) || s.morph.pedal.some((a) => a.path === path)
  })
}

/** The morphed value of a control's destination (null when nothing is assigned) for LED ladders. */
export function useMorphedValue(id: string): number | null {
  return useInstrumentState((s) => morphedValueFor(id, s))
}

/** Assignment summary text for a control (title attribute). */
export function useMorphTitle(id: string): string | undefined {
  return useInstrumentState((s) => {
    const a = morphAssignmentsFor(id, s)
    const parts: string[] = []
    if (a.wheel) parts.push(`Wheel morph ${a.wheel.start} → ${a.wheel.end}`)
    if (a.pedal) parts.push(`Control pedal morph ${a.pedal.start} → ${a.pedal.end}`)
    return parts.length ? parts.join(' · ') : undefined
  })
}
