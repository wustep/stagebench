/**
 * Morph engine: Wheel and Control Pedal morph sources with assignment,
 * interpolation, indicators, and clearing, per the programs spec.
 *
 * A morph assignment points at a whitespace-free dot path into the program
 * state ("synth.layers.0.lfo.rate") and carries the start (`from`) and end
 * (`to`) values. As a source moves 0 → 1 the destination interpolates from →
 * to. Multiple destinations per source; one destination per path (later
 * assignments for the same path replace the earlier). Shift + clear removes
 * all of a source's assignments; re-holding a source moving a destination back
 * to its start removes that single assignment.
 */

import type { ProgramState, MorphAssignment, MorphState } from './program'

/** parse "a.b.0.c" → segments. */
export function splitPath(path: string): (string | number)[] {
  return path.split('.').map((seg) => (/^\d+$/.test(seg) ? Number(seg) : seg))
}

/** deep-read a value by dot path (number segments index arrays). */
export function readPath(state: unknown, path: string): number | boolean | undefined {
  let cur: unknown = state
  for (const seg of splitPath(path)) {
    if (cur === null || cur === undefined) return undefined
    if (typeof seg === 'number') cur = (cur as unknown[])[seg]
    else cur = (cur as Record<string, unknown>)[seg]
  }
  return typeof cur === 'number' || typeof cur === 'boolean' ? (cur as number | boolean) : undefined
}

/** deep-write a value by dot path, preserving existing nested structure. */
export function writePath(state: ProgramState, path: string, value: number): void {
  const segs = splitPath(path)
  let cur: unknown = state
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i]
    const next = segs[i + 1]
    const existing = typeof seg === 'number'
      ? (cur as unknown[])[seg]
      : (cur as Record<string, unknown>)[seg as string]
    const child = typeof existing === 'object' && existing !== null
      ? existing
      : (typeof next === 'number' ? [] : {})
    if (typeof seg === 'number') (cur as unknown[])[seg] = child
    else (cur as Record<string, unknown>)[seg as string] = child
    cur = child
  }
  const last = segs[segs.length - 1]
  if (typeof last === 'number') (cur as unknown[])[last] = value
  else (cur as Record<string, unknown>)[last as string] = value
}

/** deep-clone a program (serialization round-trip). */
export function cloneProgram(p: ProgramState): ProgramState {
  return JSON.parse(JSON.stringify(p)) as ProgramState
}

/**
 * Apply every morph assignment for a source value (0..1) to a *working copy*
 * of the state, returning the morphed state. Raw stored state is never
 * mutated — morphs are a live overlay so storing after a morph keeps the
 * original start values (canonical behavior).
 */
export function applyMorphs(state: ProgramState, source: 0 | 1, value: number): ProgramState {
  const v = Math.max(0, Math.min(1, value))
  if (Array.isArray(state.morph) === false && !state.morph) return state
  const assignments = source === 0 ? state.morph.wheel : state.morph.pedal
  if (!assignments || assignments.length === 0) return state
  const work = cloneProgram(state)
  for (const a of assignments) {
    const current = readPath(work, a.path)
    if (typeof current !== 'number') continue
    const interp = a.from + (a.to - a.from) * v
    writePath(work, a.path, interp)
  }
  return work
}

/**
 * Bind/merge a source's assignments: assign one destination from→to. If the
 * same path already exists, replace it. Returns the updated MorphState.
 */
export function assignMorph(morph: MorphState, source: 0 | 1, a: MorphAssignment): MorphState {
  const list = [...(source === 0 ? morph.wheel : morph.pedal)]
  const idx = list.findIndex((x) => x.path === a.path)
  if (idx >= 0) list[idx] = a
  else list.push(a)
  return source === 0 ? { ...morph, wheel: list } : { ...morph, pedal: list }
}

/** remove one assignment by path (source moved back to start). */
export function removeMorph(morph: MorphState, source: 0 | 1, path: string): MorphState {
  const key = source === 0 ? 'wheel' : 'pedal'
  return { ...morph, [key]: (morph[key] as MorphAssignment[]).filter((x) => x.path !== path) }
}

/** clear all assignments for a source (Shift + source button). */
export function clearMorphs(morph: MorphState, source: 0 | 1): MorphState {
  const key = source === 0 ? 'wheel' : 'pedal'
  return { ...morph, [key]: [] }
}

/** collect every assigned path for an engine's morph-indicator LEDs. */
export function morphLEDs(state: ProgramState, source: 0 | 1): string[] {
  return (source === 0 ? state.morph.wheel : state.morph.pedal).map((a) => a.path)
}