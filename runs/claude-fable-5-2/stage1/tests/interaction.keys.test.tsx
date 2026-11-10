import { act, fireEvent, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { KEYBED_MODEL } from '../src/hardware/keys'
import { mountApp } from './support/app'

/**
 * Feature: interaction.keys
 * Pointer/touch/keyboard key press, release, and cancel/blur behaviour on the rendered keybed.
 */

describe('interaction.keys', () => {
  it('every key depresses on pointer down and comes back up on pointer up', () => {
    const app = mountApp()
    for (const key of KEYBED_MODEL.keys) {
      const element = app.key(key.note)
      fireEvent.pointerDown(element, { pointerId: 1 })
      expect(element).toHaveAttribute('aria-pressed', 'true')
      expect(element.className).toContain('is-down')
      fireEvent.pointerUp(element, { pointerId: 1 })
      expect(element).toHaveAttribute('aria-pressed', 'false')
      expect(element.className).not.toContain('is-down')
    }
  })

  it('pointer cancel and lost pointer capture both release the key', () => {
    const app = mountApp()
    fireEvent.pointerDown(app.key(60), { pointerId: 3 })
    fireEvent.pointerCancel(app.key(60), { pointerId: 3 })
    expect(app.key(60)).toHaveAttribute('aria-pressed', 'false')

    fireEvent.pointerDown(app.key(61), { pointerId: 4 })
    fireEvent.lostPointerCapture(app.key(61), { pointerId: 4 })
    expect(app.key(61)).toHaveAttribute('aria-pressed', 'false')
  })

  it('sliding a pressed pointer onto another key plays that key and releases the first', () => {
    const app = mountApp()
    const doc = app.container.ownerDocument
    const original = doc.elementFromPoint
    doc.elementFromPoint = () => app.key(62)
    try {
      fireEvent.pointerDown(app.key(60), { pointerId: 1 })
      fireEvent.pointerMove(app.key(60), { pointerId: 1, clientX: 50, clientY: 50 })
      expect(app.key(60)).toHaveAttribute('aria-pressed', 'false')
      expect(app.key(62)).toHaveAttribute('aria-pressed', 'true')
      // A pointer that is not down does nothing when it moves.
      fireEvent.pointerMove(app.key(64), { pointerId: 99, clientX: 50, clientY: 50 })
      fireEvent.pointerUp(app.key(62), { pointerId: 1 })
      expect(app.key(62)).toHaveAttribute('aria-pressed', 'false')
    } finally {
      doc.elementFromPoint = original
    }
  })

  it('sliding off the keybed keeps the last key until the pointer lifts', () => {
    const app = mountApp()
    const doc = app.container.ownerDocument
    const original = doc.elementFromPoint
    doc.elementFromPoint = () => doc.body
    try {
      fireEvent.pointerDown(app.key(60), { pointerId: 1 })
      fireEvent.pointerMove(app.key(60), { pointerId: 1, clientX: 0, clientY: 0 })
      expect(app.key(60)).toHaveAttribute('aria-pressed', 'true')
      fireEvent.pointerUp(doc.body, { pointerId: 1 })
    } finally {
      doc.elementFromPoint = original
    }
  })

  it('a focused key plays with Enter or Space, once per press, and releases on key up', async () => {
    const app = mountApp()
    const key = app.key(60)
    key.focus()
    fireEvent.keyDown(key, { key: 'Enter' })
    await app.settle()
    expect(key).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(key, { key: 'Enter', repeat: true })
    fireEvent.keyDown(key, { key: 'Enter', repeat: true })
    expect(app.fake.audio.node.received.filter((message) => message.type === 'noteOn')).toHaveLength(1)
    fireEvent.keyUp(key, { key: 'Enter' })
    expect(key).toHaveAttribute('aria-pressed', 'false')

    fireEvent.keyDown(key, { key: ' ' })
    expect(key).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyUp(key, { key: ' ' })
    expect(key).toHaveAttribute('aria-pressed', 'false')
  })

  it('arrow keys walk the keybed by semitone with a single tab stop', () => {
    const app = mountApp()
    const keybed = app.control('keybed')
    const tabbable = () => within(keybed).getAllByRole('button').filter((element) => element.tabIndex === 0)
    expect(tabbable().map((element) => element.id)).toEqual(['key-60'])

    app.key(60).focus()
    fireEvent.keyDown(app.key(60), { key: 'ArrowRight' })
    expect(app.container.ownerDocument.activeElement).toBe(app.key(61))
    expect(tabbable().map((element) => element.id)).toEqual(['key-61'])
    fireEvent.keyDown(app.key(61), { key: 'ArrowLeft' })
    fireEvent.keyDown(app.key(60), { key: 'ArrowLeft' })
    expect(app.container.ownerDocument.activeElement).toBe(app.key(59))
    fireEvent.keyDown(app.key(59), { key: 'PageUp' })
    expect(app.container.ownerDocument.activeElement).toBe(app.key(71))
    fireEvent.keyDown(app.key(71), { key: 'Home' })
    expect(app.container.ownerDocument.activeElement).toBe(app.key(28))
    fireEvent.keyDown(app.key(28), { key: 'ArrowLeft' })
    expect(app.container.ownerDocument.activeElement).toBe(app.key(28))
    fireEvent.keyDown(app.key(28), { key: 'End' })
    expect(app.container.ownerDocument.activeElement).toBe(app.key(100))
    fireEvent.keyDown(app.key(100), { key: 'ArrowRight' })
    expect(app.container.ownerDocument.activeElement).toBe(app.key(100))
  })

  it('a key held from the keyboard is released when focus moves away', () => {
    const app = mountApp()
    const key = app.key(60)
    key.focus()
    fireEvent.keyDown(key, { key: 'Enter' })
    expect(key).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(key, { key: 'ArrowRight' })
    expect(key).toHaveAttribute('aria-pressed', 'false')

    fireEvent.keyDown(app.key(61), { key: ' ' })
    expect(app.key(61)).toHaveAttribute('aria-pressed', 'true')
    act(() => app.key(61).blur())
    expect(app.key(61)).toHaveAttribute('aria-pressed', 'false')
  })

  it('window blur releases every key, however it was pressed', () => {
    const app = mountApp()
    fireEvent.pointerDown(app.key(60), { pointerId: 1 })
    fireEvent.pointerDown(app.key(67), { pointerId: 2, pointerType: 'touch' })
    act(() => {
      app.fake.events.key('down', 'KeyD')
    })
    for (const note of [60, 64, 67]) expect(app.key(note)).toHaveAttribute('aria-pressed', 'true')

    act(() => app.fake.events.emitBlur())
    for (const note of [60, 64, 67]) expect(app.key(note)).toHaveAttribute('aria-pressed', 'false')

    // Late pointer-up events after the blur are harmless and the key works again.
    fireEvent.pointerUp(app.key(60), { pointerId: 1 })
    fireEvent.pointerDown(app.key(60), { pointerId: 1 })
    expect(app.key(60)).toHaveAttribute('aria-pressed', 'true')
  })

  it('mouse presses do not steal keyboard focus from where the player left it', () => {
    const app = mountApp()
    const notPrevented = fireEvent.mouseDown(app.key(60))
    expect(notPrevented).toBe(false)
  })
})
