import { describe, expect, it } from 'vitest'
import { VARIANT } from '../hardware/variant'
import {
  BLACK_KEY_WIDTH_RATIO,
  assertKeybed,
  buildKeybed,
  isBlackMidi,
  keybedRangeLabel,
  midiToName,
} from '../hardware/keybed'

/**
 * visual.key-count — exact variant key count, range, white/black pattern and geometry.
 *
 * The pattern is derived from the MIDI range, so these tests re-derive it independently
 * from the printed note names rather than trusting the builder.
 */
describe('visual.key-count', () => {
  it('models exactly 73 keys, E to E (MIDI 28..100), as the variant declares', () => {
    expect(VARIANT.totalKeys).toBe(73)
    expect(VARIANT.lowestMidi).toBe(28)
    expect(VARIANT.highestMidi).toBe(100)
    expect(VARIANT.whiteKeys).toBe(43)
    expect(VARIANT.blackKeys).toBe(30)
    expect(VARIANT.rangeLabel).toBe('E to E')
    expect(VARIANT.keyAction).toBe('hammer action')
  })

  it('builds 73 contiguous chromatic keys with 43 white and 30 black', () => {
    const keys = buildKeybed(VARIANT)
    expect(keys).toHaveLength(73)
    expect(keys.filter((k) => k.color === 'white')).toHaveLength(43)
    expect(keys.filter((k) => k.color === 'black')).toHaveLength(30)
    expect(() => assertKeybed(keys, VARIANT)).not.toThrow()
  })

  it('starts and ends on E, one E-to-E span of six octaves plus a fifth', () => {
    const keys = buildKeybed(VARIANT)
    expect(keys[0].name).toBe('E1')
    expect(keys[73 - 1].name).toBe('E7')
    // E1 -> E7 is 72 semitones, i.e. six full octaves.
    expect(keys[73 - 1].midi - keys[0].midi).toBe(72)
    expect(keybedRangeLabel(VARIANT)).toBe('E to E')
  })

  it('reproduces the physical white/black pattern key by key', () => {
    const keys = buildKeybed(VARIANT)
    const expectedWhite = new Set(['E1', 'F1', 'G1', 'A1', 'B1'])
    for (const name of expectedWhite) {
      expect(keys.find((k) => k.name === name)?.color).toBe('white')
    }
    for (const name of ['F#1', 'G#1', 'A#1']) {
      expect(keys.find((k) => k.name === name)?.color).toBe('black')
    }
    // No E# or B# exists anywhere in the range.
    expect(keys.some((k) => k.name.startsWith('E#') || k.name.startsWith('B#'))).toBe(false)
    // Every black key is a pitch class in {1,3,6,8,10}.
    for (const key of keys.filter((k) => k.color === 'black')) {
      expect([1, 3, 6, 8, 10]).toContain(key.midi % 12)
    }
  })

  it('gives every key a stable unique id', () => {
    const keys = buildKeybed(VARIANT)
    const ids = new Set(keys.map((k) => k.id))
    expect(ids.size).toBe(73)
    expect(ids.has('key.e1')).toBe(true)
    expect(ids.has('key.c#4')).toBe(true)
    expect(ids.has('key.e7')).toBe(true)
  })

  it('lays white keys out edge to edge across the full keybed width', () => {
    const keys = buildKeybed(VARIANT)
    const white = keys.filter((k) => k.color === 'white')
    expect(white[0].left).toBeCloseTo(0, 10)
    const last = white[white.length - 1]
    expect(last.left + last.width).toBeCloseTo(1, 10)
    // Uniform white width, no gaps, no overlaps.
    const width = white[0].width
    for (let i = 0; i < white.length; i += 1) {
      expect(white[i].width).toBeCloseTo(width, 10)
      expect(white[i].left).toBeCloseTo(i * width, 10)
    }
  })

  it('centres each black key on the seam between its neighbours and sets its height', () => {
    const keys = buildKeybed(VARIANT)
    const whiteWidth = 1 / 43
    const blackWidth = whiteWidth * BLACK_KEY_WIDTH_RATIO
    for (const black of keys.filter((k) => k.color === 'black')) {
      expect(black.width).toBeCloseTo(blackWidth, 10)
      // Its centre sits on a white-key seam.
      const centre = black.left + black.width / 2
      const seamIndex = Math.round(centre / whiteWidth)
      expect(centre).toBeCloseTo(seamIndex * whiteWidth, 10)
      expect(black.height).toBeCloseTo(VARIANT.blackKeyHeightFraction, 10)
    }
    // Black keys never extend past the keybed edges.
    for (const key of keys) {
      expect(key.left).toBeGreaterThanOrEqual(0)
      expect(key.left + key.width).toBeLessThanOrEqual(1)
    }
  })

  it('gives black keys the declared 0.61 height of the white keys', () => {
    expect(VARIANT.blackKeyHeightFraction).toBeCloseTo(0.61, 2)
    const keys = buildKeybed(VARIANT)
    expect(keys.find((k) => k.color === 'black')?.height).toBeCloseTo(0.61, 5)
    expect(keys.find((k) => k.color === 'white')?.height).toBe(1)
  })

  it('names notes with the conventional scientific pitch notation', () => {
    expect(midiToName(28)).toBe('E1')
    expect(midiToName(60)).toBe('C4')
    expect(midiToName(61)).toBe('C#4')
    expect(midiToName(100)).toBe('E7')
    expect(isBlackMidi(61)).toBe(true)
    expect(isBlackMidi(60)).toBe(false)
  })

  it('refuses a keybed that does not match the variant', () => {
    const keys = buildKeybed(VARIANT)
    expect(() => assertKeybed(keys.slice(1), VARIANT)).toThrow(/keys, variant declares/)
    const shifted = keys.map((k) => ({ ...k, midi: k.midi - 1 }))
    expect(() => assertKeybed(shifted, VARIANT)).toThrow()
  })
})
