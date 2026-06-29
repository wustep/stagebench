import { describe, expect, it, vi } from 'vitest'
import { ComputerKeyboardInput, COMPUTER_KEY_MAP } from './InputController'

describe('computer keyboard mapping', () => {
  it('maps a chromatic row, suppresses repeat, and releases mapped keys', () => {
    const noteOn = vi.fn()
    const noteOff = vi.fn()
    const input = new ComputerKeyboardInput({ noteOn, noteOff })
    expect(COMPUTER_KEY_MAP.a).toBe(60)
    expect(COMPUTER_KEY_MAP.k).toBe(72)
    expect(input.keyDown('a', false)).toBe(true)
    expect(input.keyDown('a', true)).toBe(false)
    expect(input.keyDown('?', false)).toBe(false)
    expect(noteOn).toHaveBeenCalledTimes(1)
    expect(noteOn).toHaveBeenCalledWith(60, 104)
    input.keyUp('a')
    expect(noteOff).toHaveBeenCalledWith(60)
  })

  it('cleans every held computer key on window blur', () => {
    const noteOn = vi.fn()
    const noteOff = vi.fn()
    const input = new ComputerKeyboardInput({ noteOn, noteOff })
    input.keyDown('a', false)
    input.keyDown('d', false)
    input.releaseAll()
    expect(noteOff.mock.calls).toEqual([[60], [64]])
    expect(input.heldNotes()).toEqual([])
  })
})
