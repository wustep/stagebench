import { describe, expect, it } from 'vitest'
import { COMPUTER_KEY_NOTES, translateKeyDown, translateKeyUp, type ComputerKeyEvent } from './computerKeys'
import { isKeyboardNote } from '../model/keybed'

function down(overrides: Partial<ComputerKeyEvent> & { code: string }): ComputerKeyEvent {
  return { repeat: false, ctrlKey: false, metaKey: false, altKey: false, target: null, ...overrides }
}

describe('computer keyboard mapping', () => {
  it('maps the 17 keys from C4 to E5, all inside the keybed range', () => {
    const notes = Object.values(COMPUTER_KEY_NOTES)
    expect(notes).toHaveLength(17)
    expect(COMPUTER_KEY_NOTES.KeyA).toBe(60)
    expect(COMPUTER_KEY_NOTES.Semicolon).toBe(76)
    expect(notes.every((note) => isKeyboardNote(note))).toBe(true)
  })

  it('turns a mapped key press into a note-on with a stable source', () => {
    expect(translateKeyDown(down({ code: 'KeyA' }))).toEqual({ type: 'note-on', source: 'key:KeyA', note: 60, velocity: 100 })
  })

  it('suppresses auto-repeat so the note is not retriggered', () => {
    expect(translateKeyDown(down({ code: 'KeyA', repeat: true }))).toEqual({ type: 'ignore' })
  })

  it('maps key release to note-off for the same source', () => {
    expect(translateKeyUp({ code: 'KeyK' })).toEqual({ type: 'note-off', source: 'key:KeyK', note: 72 })
  })

  it('treats Shift as sustain on press and off on release', () => {
    expect(translateKeyDown(down({ code: 'ShiftLeft' }))).toEqual({ type: 'sustain', on: true })
    expect(translateKeyUp({ code: 'ShiftRight' })).toEqual({ type: 'sustain', on: false })
  })

  it('leaves browser shortcuts alone when a modifier is held', () => {
    expect(translateKeyDown(down({ code: 'KeyA', ctrlKey: true }))).toEqual({ type: 'ignore' })
    expect(translateKeyDown(down({ code: 'KeyA', metaKey: true }))).toEqual({ type: 'ignore' })
    expect(translateKeyDown(down({ code: 'KeyA', altKey: true }))).toEqual({ type: 'ignore' })
  })

  it('ignores keys aimed at form fields', () => {
    const input = document.createElement('input')
    expect(translateKeyDown(down({ code: 'KeyA', target: input }))).toEqual({ type: 'ignore' })
  })

  it('ignores unmapped keys', () => {
    expect(translateKeyDown(down({ code: 'KeyZ' }))).toEqual({ type: 'ignore' })
    expect(translateKeyUp({ code: 'Tab' })).toEqual({ type: 'ignore' })
  })
})
