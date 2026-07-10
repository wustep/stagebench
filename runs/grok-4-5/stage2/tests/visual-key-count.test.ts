import { describe, expect, it } from 'vitest'
import {
  KEYBED,
  VARIANT,
  blackKeyCount,
  buildKeybed,
  isBlackMidi,
  whiteKeyCount,
  midiToName,
} from '../src/model/variant'

describe('visual.key-count', () => {
  it('models exact Stage 4 73 key count, range, and white/black pattern', () => {
    expect(VARIANT.id).toBe('stage-4-73')
    expect(VARIANT.keyboard.totalKeys).toBe(73)
    expect(VARIANT.keyboard.whiteKeys).toBe(43)
    expect(VARIANT.keyboard.blackKeys).toBe(30)
    expect(VARIANT.keyboard.range).toBe('E to E')
    expect(VARIANT.keyboard.lowestMidi).toBe(28)
    expect(VARIANT.keyboard.highestMidi).toBe(100)
  })

  it('builds 73 keys with correct white/black counts and geometry pattern', () => {
    const keys = buildKeybed()
    expect(keys).toHaveLength(73)
    expect(whiteKeyCount()).toBe(43)
    expect(blackKeyCount()).toBe(30)
    expect(keys[0].name).toBe('E1')
    expect(keys[keys.length - 1].name).toBe('E7')
    expect(keys[0].color).toBe('white')
    expect(keys[keys.length - 1].color).toBe('white')
    // Black key pattern within octave
    for (const k of keys) {
      expect(k.color === 'black').toBe(isBlackMidi(k.midi))
      expect(k.name).toBe(midiToName(k.midi))
    }
    expect(KEYBED).toHaveLength(73)
  })

  it('uses documented black key height fraction', () => {
    expect(VARIANT.keyboard.blackKeyHeightFraction).toBe(0.61)
  })
})
