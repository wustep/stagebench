import { describe, expect, it } from 'vitest'
import {
  BLACK_KEY_WIDTH_RATIO,
  KEYBED,
  buildKeybed,
  countWhiteKeys,
  isBlackMidi,
  midiToFrequency,
  midiToName,
} from './keyboard'
import { VARIANT } from './variant'

/** Feature: visual.key-count */
describe('variant keybed model', () => {
  it('has the exact key count the Stage 4 73 variant specifies', () => {
    expect(VARIANT.totalKeys).toBe(73)
    expect(KEYBED).toHaveLength(73)
  })

  it('spans E to E inclusive', () => {
    expect(KEYBED[0].name).toBe('E1')
    expect(KEYBED.at(-1)?.name).toBe('E7')
    expect(KEYBED[0].midi).toBe(VARIANT.lowestMidi)
    expect(KEYBED.at(-1)?.midi).toBe(VARIANT.highestMidi)
    expect(VARIANT.highestMidi - VARIANT.lowestMidi + 1).toBe(VARIANT.totalKeys)
  })

  it('splits into 43 white and 30 black keys', () => {
    const white = KEYBED.filter((key) => key.color === 'white')
    const black = KEYBED.filter((key) => key.color === 'black')
    expect(white).toHaveLength(VARIANT.whiteKeys)
    expect(black).toHaveLength(VARIANT.blackKeys)
    expect(countWhiteKeys(VARIANT.lowestMidi, VARIANT.highestMidi)).toBe(43)
  })

  it('places black keys on the correct pitch classes only', () => {
    for (const key of KEYBED) {
      expect(key.color === 'black').toBe(isBlackMidi(key.midi))
      expect(key.name.includes('#')).toBe(key.color === 'black')
    }
  })

  it('repeats the E-to-E black key pattern six times without a black key between B/C and E/F', () => {
    const pattern = KEYBED.map((key) => (key.color === 'black' ? 'b' : 'w')).join('')
    // E F F# G G# A A# B C C# D D# — six times, then the final E.
    expect(pattern).toBe('wwbwbwbwwbwb'.repeat(6) + 'w')
  })

  it('tiles white keys edge to edge across the full keybed width', () => {
    const white = KEYBED.filter((key) => key.color === 'white')
    const width = 1 / VARIANT.whiteKeys
    white.forEach((key, index) => {
      expect(key.width).toBeCloseTo(width, 10)
      expect(key.x).toBeCloseTo(index * width, 10)
    })
    const last = white.at(-1)!
    expect(last.x + last.width).toBeCloseTo(1, 10)
  })

  it('centres each black key on the boundary between the white keys it sits between', () => {
    const whiteWidth = 1 / VARIANT.whiteKeys
    for (const key of KEYBED) {
      if (key.color !== 'black') continue
      expect(key.width).toBeCloseTo(whiteWidth * BLACK_KEY_WIDTH_RATIO, 10)
      const centre = key.x + key.width / 2
      expect(centre).toBeCloseTo((key.whiteIndex + 1) * whiteWidth, 10)
    }
  })

  it('makes black keys shorter than white keys by the documented fraction', () => {
    expect(VARIANT.blackKeyHeightFraction).toBe(0.61)
    for (const key of KEYBED) {
      expect(key.height).toBe(key.color === 'black' ? 0.61 : 1)
    }
  })

  it('gives every key a unique, stable id', () => {
    const ids = new Set(KEYBED.map((key) => key.id))
    expect(ids.size).toBe(73)
    expect(KEYBED[0].id).toBe('key-28')
  })

  it('names and tunes notes with middle C = C4 = 60 = 261.6Hz', () => {
    expect(midiToName(60)).toBe('C4')
    expect(midiToName(69)).toBe('A4')
    expect(midiToFrequency(69)).toBeCloseTo(440, 6)
    expect(midiToFrequency(60)).toBeCloseTo(261.6255653, 5)
    expect(midiToFrequency(81)).toBeCloseTo(880, 6)
  })

  it('builds other ranges from the same generator', () => {
    const octave = buildKeybed({ ...VARIANT, lowestMidi: 60, highestMidi: 71, totalKeys: 12 })
    expect(octave).toHaveLength(12)
    expect(octave.filter((key) => key.color === 'black')).toHaveLength(5)
  })
})
