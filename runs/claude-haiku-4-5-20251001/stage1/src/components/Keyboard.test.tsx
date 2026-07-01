import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { act } from 'react'
import Keyboard from './Keyboard'

describe('Keyboard Component', () => {
  it('should render 88 total keys', () => {
    const { container } = render(<Keyboard />)
    const whiteKeys = container.querySelectorAll('.keyboard-white-key')
    const blackKeys = container.querySelectorAll('.keyboard-black-key')
    const totalKeys = whiteKeys.length + blackKeys.length
    expect(totalKeys).toBe(88)
  })

  it('should have exactly 52 white keys', () => {
    const { container } = render(<Keyboard />)
    const whiteKeys = container.querySelectorAll('.keyboard-white-key')
    expect(whiteKeys.length).toBe(52)
  })

  it('should have exactly 36 black keys', () => {
    const { container } = render(<Keyboard />)
    const blackKeys = container.querySelectorAll('.keyboard-black-key')
    expect(blackKeys.length).toBe(36)
  })

  it('should have correct MIDI note range A0-C8 (21-108)', () => {
    const { container } = render(<Keyboard />)
    const keys = container.querySelectorAll('.keyboard-key')
    const midiNotes: number[] = []

    keys.forEach((key) => {
      const midiNote = parseInt(key.getAttribute('data-midi-note') || '0', 10)
      midiNotes.push(midiNote)
    })

    midiNotes.sort((a, b) => a - b)

    // Should start at A0 (21) and end at C8 (108)
    expect(Math.min(...midiNotes)).toBe(21)
    expect(Math.max(...midiNotes)).toBe(108)
  })

  it('should render white keys with correct pattern', () => {
    const { container } = render(<Keyboard />)
    const whiteKeys = container.querySelectorAll('.keyboard-white-key')

    expect(whiteKeys.length).toBe(52)

    // First white key should be A0 (MIDI 21)
    const firstKey = whiteKeys[0]
    expect(firstKey.getAttribute('data-midi-note')).toBe('21')
  })

  it('should render black keys with correct pattern', () => {
    const { container } = render(<Keyboard />)
    const blackKeys = container.querySelectorAll('.keyboard-black-key')

    // Black key pattern in one octave: C#, D#, F#, G#, A#
    // (no black key between B-C or E-F)
    expect(blackKeys.length).toBe(36)
  })

  it('should support key press state', async () => {
    const { container } = render(<Keyboard />)
    const whiteKey = container.querySelector('.keyboard-white-key') as HTMLButtonElement

    expect(whiteKey.classList.contains('pressed')).toBe(false)

    await act(async () => {
      whiteKey.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })

    expect(whiteKey.classList.contains('pressed')).toBe(true)

    await act(async () => {
      whiteKey.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })

    expect(whiteKey.classList.contains('pressed')).toBe(false)
  })

  it('should have accessible attributes', () => {
    const { container } = render(<Keyboard />)
    const keys = container.querySelectorAll('.keyboard-key')

    keys.forEach((key) => {
      expect(key.getAttribute('aria-label')).toBeTruthy()
      expect(key.getAttribute('aria-pressed')).toBeTruthy()
    })
  })
})
