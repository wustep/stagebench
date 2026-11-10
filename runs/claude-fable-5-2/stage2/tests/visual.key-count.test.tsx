import { within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { KEYBED, KEYBED_HEIGHT, VARIANT } from '../src/hardware/geometry'
import { KEYBED_MODEL, buildKeybed, isBlackNote, noteFrequency, noteName } from '../src/hardware/keys'
import { mountApp } from './support/app'
import { SPEC_VARIANT } from './support/spec'

/**
 * Feature: visual.key-count
 * Exact variant key count, range, white/black pattern, and geometry.
 */

const whites = KEYBED_MODEL.keys.filter((key) => key.color === 'white')
const blacks = KEYBED_MODEL.keys.filter((key) => key.color === 'black')

describe('visual.key-count: the model', () => {
  it('has exactly 73 keys: 43 white and 30 black', () => {
    expect(KEYBED_MODEL.keys).toHaveLength(SPEC_VARIANT.totalKeys)
    expect(whites).toHaveLength(SPEC_VARIANT.whiteKeys)
    expect(blacks).toHaveLength(SPEC_VARIANT.blackKeys)
    expect(VARIANT.keyboard.totalKeys).toBe(73)
  })

  it('runs E to E: E1 (MIDI 28) up to E7 (MIDI 100), chromatically, with no gaps', () => {
    expect(KEYBED_MODEL.keys[0]).toMatchObject({ note: 28, name: 'E1', color: 'white' })
    expect(KEYBED_MODEL.keys.at(-1)).toMatchObject({ note: 100, name: 'E7', color: 'white' })
    KEYBED_MODEL.keys.forEach((key, index) => {
      expect(key.note).toBe(28 + index)
      expect(key.index).toBe(index)
      expect(key.id).toBe(`key-${key.note}`)
    })
    expect(noteName(60)).toBe('C4')
    expect(noteFrequency(69)).toBe(440)
  })

  it('follows the piano white/black pattern from its first key', () => {
    // E F F# G G# A A# B C C# D D# then repeating.
    const firstOctave = KEYBED_MODEL.keys.slice(0, 12).map((key) => key.name.replace(/\d/, ''))
    expect(firstOctave).toEqual(['E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B', 'C', 'C#', 'D', 'D#'])
    for (const key of KEYBED_MODEL.keys) {
      expect(key.color).toBe(isBlackNote(key.note) ? 'black' : 'white')
      expect(key.color === 'black').toBe(key.name.includes('#'))
    }
    // The photo's left end: E and F side by side, then three black keys, then a gap before C#.
    const startColors = KEYBED_MODEL.keys.slice(0, 10).map((key) => key.color[0]).join('')
    expect(startColors).toBe('wwbwbwbwwb')
    // The right end: ... C7 C#7 D7 D#7 E7.
    expect(KEYBED_MODEL.keys.slice(-5).map((key) => key.name)).toEqual(['C7', 'C#7', 'D7', 'D#7', 'E7'])
    // Every octave has the same seven white and five black keys.
    for (let octave = 2; octave <= 6; octave += 1) {
      const inOctave = KEYBED_MODEL.keys.filter((key) => key.octave === octave)
      expect(inOctave).toHaveLength(12)
      expect(inOctave.filter((key) => key.color === 'black')).toHaveLength(5)
    }
  })

  it('lays white keys edge to edge at one width across the photo-measured keybed', () => {
    const width = (KEYBED.right - KEYBED.left) / 43
    whites.forEach((key, index) => {
      expect(key.width).toBeCloseTo(width, 6)
      expect(key.x).toBeCloseTo(KEYBED.left + index * width, 6)
      expect(key.length).toBe(KEYBED.whiteKeyLength)
    })
    expect(whites.at(-1)!.x + whites.at(-1)!.width).toBeCloseTo(KEYBED.right, 6)
  })

  it('makes black keys 61 % of the white key length and centres them on the joint', () => {
    for (const key of blacks) {
      expect(key.length / KEYBED.whiteKeyLength).toBeCloseTo(SPEC_VARIANT.blackKeyHeightFraction, 6)
      expect(key.width).toBeLessThan(KEYBED_MODEL.whiteKeyWidth)
      expect(key.width).toBeGreaterThan(KEYBED_MODEL.whiteKeyWidth * 0.5)
      const below = whites.find((white) => white.note === key.note - 1)!
      const joint = below.x + below.width
      expect(key.x + key.width / 2).toBeCloseTo(joint, 6)
    }
  })

  it('keeps the keybed inside the instrument and within its 46 % band', () => {
    expect(KEYBED.left).toBeGreaterThan(0)
    expect(KEYBED.right).toBeLessThan(VARIANT.photoBounds.width)
    expect(KEYBED.whiteKeyLength).toBeLessThan(KEYBED_HEIGHT)
    // Left and right margins are the cheeks: equal within a few px, as on the photo.
    expect(Math.abs(KEYBED.left - (VARIANT.photoBounds.width - KEYBED.right))).toBeLessThan(20)
  })

  it('refuses to build a keybed that starts or ends on a black key', () => {
    expect(() => buildKeybed(29, 100)).not.toThrow()
    expect(() => buildKeybed(30, 100)).toThrow()
    expect(() => buildKeybed(28, 99)).toThrow()
    // The other variants' ranges build too, so the model is not hard-wired to 73 keys.
    expect(buildKeybed(21, 108).keys).toHaveLength(88)
  })
})

describe('visual.key-count: the rendered keybed', () => {
  it('renders one playable button per key, in pitch order, at the modelled geometry', () => {
    const app = mountApp()
    const keybed = app.control('keybed')
    const rendered = within(keybed).getAllByRole('button')
    expect(rendered).toHaveLength(73)
    expect(keybed).toHaveAttribute('data-key-count', '73')
    expect(keybed.getAttribute('aria-label')).toMatch(/73 keys, E1 to E7/)

    rendered.forEach((element, index) => {
      const key = KEYBED_MODEL.keys[index]
      expect(element.id).toBe(key.id)
      expect(element).toHaveAttribute('data-note', String(key.note))
      expect(element).toHaveAttribute('data-key-color', key.color)
      expect(parseFloat(element.style.left)).toBeCloseTo(key.x, 3)
      expect(parseFloat(element.style.width)).toBeCloseTo(key.width, 3)
      expect(parseFloat(element.style.height)).toBeCloseTo(key.length, 3)
    })
    expect(rendered.filter((element) => element.dataset.keyColor === 'white')).toHaveLength(43)
    expect(rendered.filter((element) => element.dataset.keyColor === 'black')).toHaveLength(30)
  })
})
