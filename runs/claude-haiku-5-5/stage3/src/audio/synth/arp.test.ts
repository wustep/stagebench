// synth.arp-gate: the arpeggiator is deterministic under a fixed clock. Rate, sync, range, direction,
// gate length, and the held-note input are all checked on the step order and timing it produces.
import { describe, expect, it } from 'vitest'
import { ArpSequencer, arpPattern, expandNotes, rangeOctaves, stepSeconds, SYNC_DIVISIONS, type ArpSettings } from './arp'

const base: ArpSettings = { mode: 'arp', direction: 'up', octaves: 1, step: 0.5, gate: 0.5 }

/** The note-on sequence (note and time) an arpeggiator plays up to `until`, with a fixed call pattern. */
function onsets(held: number[], settings: ArpSettings, until: number, calls = 20): { time: number; note: number }[] {
  const sequencer = new ArpSequencer()
  sequencer.start(0)
  const out: { time: number; note: number }[] = []
  for (let call = 1; call <= calls; call += 1) {
    const now = (until * call) / calls
    for (const event of sequencer.advance(now, held, settings)) {
      if (event.type === 'on') out.push({ time: Number(event.time.toFixed(6)), note: event.note })
    }
  }
  return out
}

describe('synth.arp-gate: step timing and rate', () => {
  it('a free rate and a synced rate give the step lengths the panel shows', () => {
    expect(stepSeconds(0.5, 120, false)).toBeCloseTo(60 / (120 * 1.0), 9)
    // Synced to a quarter note at 120 BPM is half a second; the rate knob picks the division.
    expect(stepSeconds(0, 120, true)).toBeCloseTo(60 / 120 * SYNC_DIVISIONS[0], 9)
    expect(stepSeconds(0.99, 120, true)).toBeCloseTo(60 / 120 * SYNC_DIVISIONS[7], 9)
  })

  it('steps land on a fixed grid, the same however often the clock is polled', () => {
    const coarse = onsets([60, 64, 67], base, 2, 4)
    const fine = onsets([60, 64, 67], base, 2, 40)
    expect(fine).toEqual(coarse)
    expect(fine.map((event) => event.time)).toEqual([0, 0.5, 1, 1.5, 2])
  })

  it('the gate ends each step at its gate fraction', () => {
    const sequencer = new ArpSequencer()
    sequencer.start(0)
    // The step at 0.5 s is due, and its release lands a quarter-step later, at 0.625 s, for the caller to keep.
    const events = sequencer.advance(0.5, [60], { ...base, gate: 0.25 })
    expect(events).toEqual([
      { time: 0, type: 'on', note: 60 },
      { time: 0.125, type: 'off', note: 60 },
      { time: 0.5, type: 'on', note: 60 },
      { time: 0.625, type: 'off', note: 60 },
    ])
  })
})

describe('synth.arp-gate: range and direction', () => {
  it('range is one to four octaves, and each octave repeats the held notes up by twelve', () => {
    expect(rangeOctaves(0)).toBe(1)
    expect(rangeOctaves(1)).toBe(4)
    expect(expandNotes([60, 64], 2)).toEqual([60, 64, 72, 76])
  })

  it('direction orders the steps: up, down, up and down, and a seeded random that repeats', () => {
    const notes = [60, 64, 67]
    expect(arpPattern(notes, 'up', 4)).toEqual([60, 64, 67, 60])
    expect(arpPattern(notes, 'down', 4)).toEqual([67, 64, 60, 67])
    expect(arpPattern(notes, 'updown', 6)).toEqual([60, 64, 67, 64, 60, 64])
    const first = arpPattern(notes, 'random', 16, 7)
    expect(arpPattern(notes, 'random', 16, 7)).toEqual(first)
    expect(new Set(first).size).toBeGreaterThan(1)
  })
})

describe('synth.arp-gate: note input', () => {
  it('a poly arpeggiator sounds every held note on each step, and an arp sounds one', () => {
    // Up to 0.4 s only the first step (at 0 s) is due.
    const arp = onsets([60, 64], { ...base, mode: 'arp' }, 0.4, 2)
    const poly = onsets([60, 64], { ...base, mode: 'poly' }, 0.4, 2)
    expect(arp).toEqual([{ time: 0, note: 60 }])
    expect(poly).toEqual([
      { time: 0, note: 60 },
      { time: 0, note: 64 },
    ])
  })

  it('with no held notes the arpeggiator plays nothing, and stopping it returns no events', () => {
    expect(onsets([], base, 2)).toEqual([])
    const sequencer = new ArpSequencer()
    sequencer.start(0)
    sequencer.stop()
    expect(sequencer.advance(2, [60], base)).toEqual([])
    expect(sequencer.isRunning).toBe(false)
  })
})
