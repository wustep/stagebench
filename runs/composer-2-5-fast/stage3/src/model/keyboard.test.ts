import { describe, expect, it } from 'vitest'
import { KEYBED, KEYBOARD } from '../model/keyboard'

describe('visual.key-count', () => {
  it('models 73 keys in E-E range with correct white/black counts', () => {
    expect(KEYBOARD.totalKeys).toBe(73)
    expect(KEYBOARD.whiteKeys).toBe(43)
    expect(KEYBOARD.blackKeys).toBe(30)
    expect(KEYBOARD.lowMidi).toBe(28)
    expect(KEYBOARD.highMidi).toBe(100)
    expect(KEYBED).toHaveLength(73)
    expect(KEYBED[0]!.noteName).toBe('E1')
    expect(KEYBED.at(-1)!.noteName).toBe('E7')
  })

  it('assigns stable key IDs and colors', () => {
    const whites = KEYBED.filter((k) => k.color === 'white')
    const blacks = KEYBED.filter((k) => k.color === 'black')
    expect(whites).toHaveLength(43)
    expect(blacks).toHaveLength(30)
    expect(new Set(KEYBED.map((k) => k.id)).size).toBe(73)
  })
})
