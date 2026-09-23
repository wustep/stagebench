import { describe, expect, it } from 'vitest'
import { KEYS, WHITE_KEY_COUNT, midiToName } from './keys'
import { VARIANT } from './variant'

describe('visual.key-count', () => {
  it('models the Stage 4 73 keybed: 73 keys, E1–E7, 43 white and 30 black', () => {
    expect(VARIANT.keyboard.totalKeys).toBe(73)
    expect(VARIANT.keyboard.whiteKeys).toBe(43)
    expect(VARIANT.keyboard.blackKeys).toBe(30)
    expect(VARIANT.keyboard.range).toBe('E to E')
    expect(KEYS).toHaveLength(73)
    expect(WHITE_KEY_COUNT).toBe(43)
    expect(KEYS.filter((key) => key.isBlack)).toHaveLength(30)
    expect(KEYS[0]).toMatchObject({ midi: 28, name: 'E1', isBlack: false, id: 'key-28' })
    expect(KEYS.at(-1)).toMatchObject({ midi: 100, name: 'E7', isBlack: false, id: 'key-100' })
    expect(midiToName(60)).toBe('C4')
    const pattern = KEYS.map((key) => (key.isBlack ? 'b' : 'w')).join('')
    expect(pattern.startsWith('wwbwbwbwwbwb')).toBe(true)
    expect(pattern.endsWith('wwbwbw')).toBe(true)
  })

  it('places black keys between whites and keeps them narrower and shorter', () => {
    const cSharp = KEYS.find((key) => key.name === 'F#1')
    expect(cSharp?.isBlack).toBe(true)
    expect(cSharp!.w).toBeLessThan(1)
    expect(cSharp!.x).toBeGreaterThan(0)
    expect(VARIANT.keyboard.blackKeyHeightFraction).toBeCloseTo(0.61, 2)
    const whites = KEYS.filter((key) => !key.isBlack)
    expect(whites.map((key) => key.whiteIndex)).toEqual(whites.map((_, index) => index))
  })
})
