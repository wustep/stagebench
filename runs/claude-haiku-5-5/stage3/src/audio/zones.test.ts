// splits.zones: split points at the documented positions, up to four zones, note routing, and crossfades.
import { describe, expect, it } from 'vitest'
import { activeSplitPoints, layerZoneGain, SPLIT_NOTES, zoneRangeOf, zoneWeights } from './zones'

describe('splits.zones: split points and zones', () => {
  it('has the eleven documented split positions, C2 to C7', () => {
    expect(SPLIT_NOTES).toHaveLength(11)
    expect(SPLIT_NOTES[0]).toBe(36)
    expect(SPLIT_NOTES[SPLIT_NOTES.length - 1]).toBe(96)
  })

  it('with split off there is one zone; with split on, each active point makes another zone, up to four', () => {
    expect(activeSplitPoints(false, [1, 5, 9], [0, 0, 0])).toEqual([])
    expect(activeSplitPoints(true, [0, 5, 0], [0, 0, 0])).toEqual([{ note: 60, crossfade: 0 }])
    const three = activeSplitPoints(true, [3, 5, 9], [0, 1, 2])
    expect(three.map((point) => point.note)).toEqual([48, 60, 84])
    expect(zoneWeights(50, three)).toHaveLength(4)
  })

  it('a note below the split goes to the lower zone, and a note above it to the upper zone (crossfade Off)', () => {
    const points = activeSplitPoints(true, [0, 5, 0], [0, 0, 0])
    expect(zoneWeights(59, points)).toEqual([1, 0])
    expect(zoneWeights(60, points)).toEqual([0, 1])
  })

  it('a ±6 or ±12 crossfade fades the two zones across that many semitones on each side of the point', () => {
    const six = activeSplitPoints(true, [0, 5, 0], [0, 1, 0])
    expect(zoneWeights(54, six)[1]).toBeCloseTo(0, 6)
    expect(zoneWeights(66, six)[1]).toBeCloseTo(1, 6)
    expect(zoneWeights(60, six)[1]).toBeCloseTo(0.5, 6)
    const twelve = activeSplitPoints(true, [0, 5, 0], [0, 2, 0])
    expect(zoneWeights(48, twelve)[1]).toBeCloseTo(0, 6)
    expect(zoneWeights(72, twelve)[1]).toBeCloseTo(1, 6)
    expect(zoneWeights(64, twelve)[1]).toBeGreaterThan(zoneWeights(62, twelve)[1])
  })

  it('zone weights always sum to one, so a note keeps its level across a crossfade', () => {
    const points = activeSplitPoints(true, [3, 5, 9], [2, 2, 2])
    for (let note = 36; note <= 96; note += 1) {
      const weights = zoneWeights(note, points)
      expect(weights.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 6)
    }
  })

  it('a layer plays a note with the sum of the zone weights in its range', () => {
    const points = activeSplitPoints(true, [0, 5, 0], [0, 0, 0])
    const weights = zoneWeights(64, points)
    expect(layerZoneGain(weights, zoneRangeOf(0))).toBe(0)
    expect(layerZoneGain(weights, zoneRangeOf(1))).toBe(1)
    expect(layerZoneGain(weights, zoneRangeOf(9))).toBe(1)
  })

  it('the panel zone cycle offers ten contiguous ranges of the four zones', () => {
    expect(zoneRangeOf(0)).toEqual([1, 1])
    expect(zoneRangeOf(4)).toEqual([1, 2])
    expect(zoneRangeOf(9)).toEqual([1, 4])
  })
})
