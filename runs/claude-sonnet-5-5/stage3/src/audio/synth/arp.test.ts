import { describe, expect, it } from 'vitest'
import {
  ARP_NOTE_LENGTH,
  arpChordForStep,
  arpNoteForStep,
  arpStepNotes,
  buildArpSequence,
  expandNotes,
  gateStep,
  gridStartIndex,
  gridTime,
  randomIndex,
  retimeGrid,
  takeSteps,
  type Grid,
} from './arp'

describe('synth.arp-gate — pure sequencing', () => {
  const chord = [67, 60, 64]

  it('expands and orders the held notes across octaves', () => {
    expect(expandNotes(chord, 1)).toEqual([60, 64, 67])
    expect(expandNotes(chord, 2)).toEqual([60, 64, 67, 72, 76, 79])
    expect(expandNotes([60, 60, 64], 1)).toEqual([60, 64])
    expect(expandNotes([118], 3)).toEqual([118]) // never above the top of the range
  })

  it('builds up, down and up/down cycles', () => {
    expect(buildArpSequence(chord, 1, 'up')).toEqual([60, 64, 67])
    expect(buildArpSequence(chord, 1, 'down')).toEqual([67, 64, 60])
    expect(buildArpSequence(chord, 1, 'updown')).toEqual([60, 64, 67, 64])
    expect(buildArpSequence(chord, 2, 'updown')).toEqual([60, 64, 67, 72, 76, 79, 76, 72, 67, 64])
    expect(buildArpSequence([60, 64], 1, 'updown')).toEqual([60, 64])
    expect(buildArpSequence([60], 1, 'updown')).toEqual([60])
    expect(buildArpSequence([], 1, 'up')).toEqual([])
  })

  it('steps wrap around the cycle', () => {
    const notes = Array.from({ length: 8 }, (_, i) => arpNoteForStep(chord, 1, 'up', i))
    expect(notes).toEqual([60, 64, 67, 60, 64, 67, 60, 64])
    expect(arpNoteForStep([], 1, 'up', 0)).toBeNull()
  })

  it('random is a stateless fixed sequence that only picks held notes', () => {
    const a = Array.from({ length: 24 }, (_, i) => arpNoteForStep(chord, 2, 'random', i))
    const b = Array.from({ length: 24 }, (_, i) => arpNoteForStep(chord, 2, 'random', i))
    expect(a).toEqual(b)
    expect(new Set(a).size).toBeGreaterThan(3)
    for (const n of a) expect(expandNotes(chord, 2)).toContain(n)
    // asking for step 10 first gives the same as asking in order
    expect(arpNoteForStep(chord, 2, 'random', 10)).toBe(a[10])
    expect(randomIndex(0, 3)).toBe(0)
    const seqFor = (seed: number) => Array.from({ length: 16 }, (_, i) => randomIndex(7, i, seed))
    expect(seqFor(1)).not.toEqual(seqFor(2))
  })

  it('Poly steps play the whole chord, moving up an octave per step within the range', () => {
    expect(arpChordForStep(chord, 1, 0)).toEqual([60, 64, 67])
    expect(arpChordForStep(chord, 2, 1)).toEqual([72, 76, 79])
    expect(arpChordForStep(chord, 2, 2)).toEqual([60, 64, 67])
    expect(arpStepNotes('poly', chord, 2, 'up', 1)).toEqual([72, 76, 79])
    expect(arpStepNotes('arp', chord, 1, 'down', 1)).toEqual([64])
    expect(arpStepNotes('arp', [], 1, 'down', 1)).toEqual([])
  })

  it('the step grid is exact, idempotent and re-timed without losing the next step', () => {
    const start = gridStartIndex(0, 0.5, 0.13)
    expect(start).toBe(1)
    expect(gridStartIndex(0, 0.5, 0.5)).toBe(1)
    expect(gridStartIndex(0, 0.5, 0)).toBe(0)
    expect(gridStartIndex(0.13, 0.5, 0.13)).toBe(0)
    const g: Grid = { origin: 0, index: start, stepSeconds: 0.5 }
    expect(takeSteps(g, 2).map((s) => s.time)).toEqual([0.5, 1, 1.5])
    expect(takeSteps(g, 2)).toEqual([]) // already taken
    expect(takeSteps(g, 2.01).map((s) => s.time)).toEqual([2])
    retimeGrid(g, 0.25)
    expect(gridTime(g)).toBe(2.5)
    expect(takeSteps(g, 3).map((s) => s.time)).toEqual([2.5, 2.75])
    retimeGrid(g, 0.25) // same length: nothing changes
    expect(gridTime(g)).toBe(3)
  })

  it('the gate opens for half a step; hardness sets the edge time', () => {
    const hard = gateStep(1, 0.5, 1)
    const soft = gateStep(1, 0.5, 0)
    expect(hard.open).toBe(1)
    expect(hard.closeEnd).toBeCloseTo(1.25)
    expect(soft.closeEnd).toBeCloseTo(1.25)
    expect(hard.openEnd - hard.open).toBeLessThan(0.005)
    expect(soft.openEnd - soft.open).toBeGreaterThan(0.05)
    expect(soft.close).toBeGreaterThan(soft.openEnd)
    expect(ARP_NOTE_LENGTH).toBeLessThan(1)
  })
})
