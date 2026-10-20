import { describe, expect, it } from 'vitest'
import { KEYBED, KEYS, keyCounts, noteName } from './keybed'

describe('keybed for stage-4-73', () => {
  it('has exactly 73 keys: 43 white and 30 black, matching the variant spec', () => {
    expect(keyCounts()).toEqual({ total: 73, white: 43, black: 30 })
    expect(KEYBED.totalKeys).toBe(73)
    expect(KEYBED.whiteKeys).toBe(43)
    expect(KEYBED.blackKeys).toBe(30)
  })

  it('runs E to E: E1 (MIDI 28) through E7 (MIDI 100)', () => {
    expect(noteName(KEYBED.lowestNote)).toBe('E1')
    expect(noteName(KEYBED.highestNote)).toBe('E7')
    expect(KEYS[0].label).toBe('E1')
    expect(KEYS.at(-1)?.label).toBe('E7')
    expect(KEYS[0].color).toBe('white')
  })

  it('follows the white and black pattern of a piano (no black key on E-F or B-C)', () => {
    const pattern = KEYS.map((key) => (key.color === 'white' ? 'w' : 'b')).join('')
    // E F F# G G# A A# B C C# D D# E: no black key between E-F or B-C. Six octaves plus the final E.
    expect(pattern.startsWith('wwbwbwbwwbwbw')).toBe(true)
    expect(pattern.length).toBe(73)
    expect(pattern.endsWith('w')).toBe(true)
    expect(KEYS.every((key, index) => index === 0 || key.note === KEYS[index - 1].note + 1)).toBe(true)
  })

  it('spaces white keys evenly across the full width', () => {
    const whites = KEYS.filter((key) => key.color === 'white')
    const totalWidth = whites.reduce((sum, key) => sum + key.width, 0)
    expect(totalWidth).toBeCloseTo(1, 10)
    whites.forEach((key, index) => {
      expect(key.left).toBeCloseTo(index / 43, 10)
    })
  })

  it('centres each black key on the boundary between its neighbouring white keys', () => {
    const blacks = KEYS.filter((key) => key.color === 'black')
    for (const black of blacks) {
      const centre = black.left + black.width / 2
      const boundary = (black.whiteIndex + 1) / 43
      expect(centre).toBeCloseTo(boundary, 10)
    }
    expect(KEYBED.blackKeyHeightFraction).toBe(0.61)
  })
})
