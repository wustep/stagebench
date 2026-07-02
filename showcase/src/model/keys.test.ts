import { describe, expect, it } from 'vitest'
import { BLACK_KEY_WIDTH, buildKeys, KEYS, midiToName, WHITE_KEY_COUNT } from './keys'
import { VARIANT } from './variant'

describe('visual.key-count — stage-4-73 keybed model', () => {
  it('models exactly 73 keys', () => {
    expect(KEYS).toHaveLength(73)
    expect(KEYS).toHaveLength(VARIANT.keyboard.totalKeys)
  })

  it('spans E1 (MIDI 28) to E7 (MIDI 100)', () => {
    expect(KEYS[0]!.midi).toBe(28)
    expect(KEYS[0]!.name).toBe('E1')
    expect(KEYS.at(-1)!.midi).toBe(100)
    expect(KEYS.at(-1)!.name).toBe('E7')
    expect(KEYS[0]!.isBlack).toBe(false)
    expect(KEYS.at(-1)!.isBlack).toBe(false)
  })

  it('has 43 white and 30 black keys', () => {
    expect(KEYS.filter((k) => !k.isBlack)).toHaveLength(43)
    expect(KEYS.filter((k) => k.isBlack)).toHaveLength(30)
    expect(WHITE_KEY_COUNT).toBe(43)
  })

  it('has contiguous MIDI numbers and unique stable ids', () => {
    const ids = new Set(KEYS.map((k) => k.id))
    expect(ids.size).toBe(73)
    for (let i = 1; i < KEYS.length; i++) {
      expect(KEYS[i]!.midi).toBe(KEYS[i - 1]!.midi + 1)
    }
    expect(KEYS[32]!.id).toBe(`key-${KEYS[32]!.midi}`)
  })

  it('follows the standard black/white octave pattern from E', () => {
    const pattern = KEYS.slice(0, 12).map((k) => (k.isBlack ? 'b' : 'w')).join('')
    // E F F# G G# A A# B C C# D D#
    expect(pattern).toBe('wwbwbwbwwbwb')
  })

  it('positions white keys on a uniform grid and black keys between neighbours', () => {
    const whites = KEYS.filter((k) => !k.isBlack)
    whites.forEach((k, i) => {
      expect(k.x).toBe(i)
      expect(k.w).toBe(1)
    })
    for (const black of KEYS.filter((k) => k.isBlack)) {
      expect(black.w).toBeCloseTo(BLACK_KEY_WIDTH)
      // Black key must sit strictly inside the keybed and overlap the
      // boundary between its neighbouring white keys.
      const boundary = black.whiteIndex + 1
      expect(black.x).toBeGreaterThan(black.whiteIndex)
      expect(black.x + black.w).toBeLessThan(boundary + 1)
      expect(black.x).toBeLessThan(boundary)
      expect(black.x + black.w).toBeGreaterThan(boundary)
    }
  })

  it('never places two black keys adjacently', () => {
    for (let i = 1; i < KEYS.length; i++) {
      expect(KEYS[i]!.isBlack && KEYS[i - 1]!.isBlack).toBe(false)
    }
  })

  it('declares the 0.61 black key height fraction for rendering', () => {
    expect(VARIANT.keyboard.blackKeyHeightFraction).toBeCloseTo(0.61)
  })

  it('is deterministic', () => {
    expect(buildKeys()).toEqual(KEYS)
    expect(midiToName(60)).toBe('C4')
    expect(midiToName(28)).toBe('E1')
  })
})
