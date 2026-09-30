/**
 * Arpeggiator / gate sequencing as pure functions: with a fixed clock and note set the (time, note) steps are exactly
 * reproducible. Nothing here touches Web Audio.
 */
import type { ArpDirection } from '../../engine/synth'

export const ARP_RANDOM_SEED = 0x4e4f5244 // "NORD"
export const MAX_NOTE = 120

/** mulberry32: deterministic PRNG, one call per value */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** the held notes, sorted ascending and repeated one octave higher per extra octave of range */
export function expandNotes(notes: readonly number[], octaves: number): number[] {
  const base = Array.from(new Set(notes)).sort((a, b) => a - b)
  const out: number[] = []
  for (let o = 0; o < Math.max(1, Math.round(octaves)); o++) for (const n of base) if (n + 12 * o <= MAX_NOTE) out.push(n + 12 * o)
  return out
}

/** one full cycle of the arpeggio. `random` returns the pool (a random cycle has no fixed order, see `arpNoteForStep`). */
export function buildArpSequence(notes: readonly number[], octaves: number, direction: ArpDirection): number[] {
  const pool = expandNotes(notes, octaves)
  switch (direction) {
    case 'down':
      return [...pool].reverse()
    case 'updown': {
      if (pool.length < 3) return pool.length === 2 ? [pool[0], pool[1]] : pool
      const down = [...pool].reverse().slice(1, -1)
      return [...pool, ...down]
    }
    default:
      return pool
  }
}

/** index of the random pick for `step`, stateless so a step can be scheduled in any order */
export function randomIndex(poolLength: number, step: number, seed = ARP_RANDOM_SEED): number {
  if (poolLength <= 0) return 0
  const next = mulberry32((seed ^ Math.imul(step + 1, 0x9e3779b1)) >>> 0)
  next() // decorrelate neighbouring steps
  return Math.floor(next() * poolLength) % poolLength
}

/** the single note the arpeggio plays at `step` (mode Arp), or null with no notes held */
export function arpNoteForStep(notes: readonly number[], octaves: number, direction: ArpDirection, step: number, seed = ARP_RANDOM_SEED): number | null {
  if (direction === 'random') {
    const pool = expandNotes(notes, octaves)
    return pool.length ? pool[randomIndex(pool.length, step, seed)] : null
  }
  const seq = buildArpSequence(notes, octaves, direction)
  return seq.length ? seq[((step % seq.length) + seq.length) % seq.length] : null
}

/** the whole held chord at `step` (mode Poly): transposed up an octave per step within the range, so the range is audible */
export function arpChordForStep(notes: readonly number[], octaves: number, step: number): number[] {
  const base = Array.from(new Set(notes)).sort((a, b) => a - b)
  const shift = 12 * (((step % Math.max(1, octaves)) + Math.max(1, octaves)) % Math.max(1, octaves))
  return base.map((n) => n + shift).filter((n) => n <= MAX_NOTE)
}

/** the notes that sound at `step` for a mode ('gate' plays the held chord itself and is not sequenced here) */
export function arpStepNotes(mode: 'arp' | 'poly', notes: readonly number[], octaves: number, direction: ArpDirection, step: number, seed = ARP_RANDOM_SEED): number[] {
  if (mode === 'poly') return arpChordForStep(notes, octaves, step)
  const n = arpNoteForStep(notes, octaves, direction, step, seed)
  return n === null ? [] : [n]
}

export interface Grid {
  /** time of step 0 of the current grid segment */
  origin: number
  /** index (within the segment) of the next unscheduled step */
  index: number
  stepSeconds: number
}

export const gridTime = (g: Grid, index = g.index): number => g.origin + index * g.stepSeconds

/** the first grid line at or after `t` on a grid anchored at `origin` (master-clock lock) */
export function gridStartIndex(origin: number, stepSeconds: number, t: number): number {
  return Math.max(0, Math.ceil((t - origin) / stepSeconds - 1e-9))
}

/** steps whose start lies in [gridTime(g), until); advances the grid. Returns absolute times. */
export function takeSteps(g: Grid, until: number): Array<{ index: number; time: number }> {
  const out: Array<{ index: number; time: number }> = []
  for (let guard = 0; gridTime(g) < until && guard < 4096; guard++) {
    out.push({ index: g.index, time: gridTime(g) })
    g.index++
  }
  return out
}

/** re-base the grid after the step length changed: the next unscheduled step keeps its time, later steps use the new length */
export function retimeGrid(g: Grid, stepSeconds: number): void {
  if (Math.abs(stepSeconds - g.stepSeconds) < 1e-12) return
  g.origin = gridTime(g)
  g.index = 0
  g.stepSeconds = stepSeconds
}

/** fraction of a step that a note (Arp/Poly) sounds before its release */
export const ARP_NOTE_LENGTH = 0.8
/** gate duty: fraction of a step that the gate is open */
export const GATE_DUTY = 0.5

export interface GateStep {
  /** gate starts opening */
  open: number
  /** gate fully open */
  openEnd: number
  /** gate starts closing */
  close: number
  /** gate fully closed */
  closeEnd: number
}

/** gate timing for the step starting at `time`; `hardness` 0..1 (the Range knob) is how sharp the edges are */
export function gateStep(time: number, stepSeconds: number, hardness: number): GateStep {
  const h = Math.min(1, Math.max(0, hardness))
  const open = stepSeconds * GATE_DUTY
  const edge = 0.002 + (1 - h) * open * 0.45
  return { open: time, openEnd: time + edge, close: time + open - edge, closeEnd: time + open }
}
