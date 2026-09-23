import { describe, expect, it } from 'vitest'
import { BLACK_KEY_COUNT, HARDWARE_CONTROLS, KEY_MODEL, SECTIONS, WHITE_KEY_COUNT } from './hardware'

describe('normalized Stage 4 hardware model', () => {
  it('models the Stage 4 73 E-to-E action keybed and its exact key pattern', () => {
    expect(KEY_MODEL).toHaveLength(73)
    expect(KEY_MODEL[0]).toMatchObject({ midi: 40, note: 'E2', color: 'white' })
    expect(KEY_MODEL.at(-1)).toMatchObject({ midi: 112, note: 'E8', color: 'white' })
    expect(WHITE_KEY_COUNT).toBe(43)
    expect(BLACK_KEY_COUNT).toBe(30)
    expect(new Set(KEY_MODEL.map((key) => key.id)).size).toBe(73)
    expect(KEY_MODEL.filter((key) => key.color === 'black').every((key) => Number.isFinite(key.blackKeyOffset))).toBe(true)
  })

  it('keeps all six measured sections ordered and normalized to the full deck width', () => {
    expect(SECTIONS.map(({ id }) => id)).toEqual(['performance', 'organ', 'piano', 'program', 'synth', 'effects'])
    expect(SECTIONS.map(({ fraction }) => fraction)).toEqual([0.14, 0.2, 0.085, 0.125, 0.25, 0.2])
    expect(SECTIONS.reduce((sum, section) => sum + section.fraction, 0)).toBeCloseTo(1, 8)
  })

  it('assigns every physical control a unique stable ID, accessible name, and section', () => {
    expect(HARDWARE_CONTROLS.length).toBeGreaterThan(75)
    expect(new Set(HARDWARE_CONTROLS.map((control) => control.id)).size).toBe(HARDWARE_CONTROLS.length)
    expect(HARDWARE_CONTROLS.every((control) => control.id.length > 0 && control.name.length > 0)).toBe(true)
    expect(HARDWARE_CONTROLS.filter((control) => control.kind === 'drawbar')).toHaveLength(9)
    expect(new Set(HARDWARE_CONTROLS.map((control) => control.section))).toEqual(new Set(SECTIONS.map((section) => section.id)))
  })
})
