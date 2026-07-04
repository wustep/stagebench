import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp } from '../test/renderApp'

function key(midi: number): HTMLElement {
  return document.querySelector(`[data-control-id="key-${midi}"]`) as HTMLElement
}

describe('interaction.keys — visual press lifecycle', () => {
  it('pointer down depresses a key visually and starts a voice; pointer up releases', () => {
    const { getContext } = renderApp()
    const c4 = key(60)
    expect(c4.dataset.pressed).toBe('false')

    fireEvent.pointerDown(c4, { pointerId: 1, clientY: 30 })
    expect(c4.dataset.pressed).toBe('true')
    expect(c4).toHaveAttribute('aria-pressed', 'true')
    expect(getContext()!.oscillators().length).toBeGreaterThan(0)

    fireEvent.pointerUp(c4, { pointerId: 1 })
    expect(c4.dataset.pressed).toBe('false')
    expect(c4).toHaveAttribute('aria-pressed', 'false')
  })

  it('pointer cancel releases the key', () => {
    renderApp()
    const e3 = key(52)
    fireEvent.pointerDown(e3, { pointerId: 7 })
    expect(e3.dataset.pressed).toBe('true')
    fireEvent.pointerCancel(e3, { pointerId: 7 })
    expect(e3.dataset.pressed).toBe('false')
  })

  it('lost pointer capture releases the key', () => {
    renderApp()
    const g4 = key(67)
    fireEvent.pointerDown(g4, { pointerId: 3 })
    expect(g4.dataset.pressed).toBe('true')
    fireEvent.lostPointerCapture(g4, { pointerId: 3 })
    expect(g4.dataset.pressed).toBe('false')
  })

  it('two touches own their keys independently', () => {
    renderApp()
    const c4 = key(60)
    const e4 = key(64)
    fireEvent.pointerDown(c4, { pointerId: 11, pointerType: 'touch' })
    fireEvent.pointerDown(e4, { pointerId: 12, pointerType: 'touch' })
    expect(c4.dataset.pressed).toBe('true')
    expect(e4.dataset.pressed).toBe('true')

    // Lifting one finger must not release the other key.
    fireEvent.pointerUp(c4, { pointerId: 11, pointerType: 'touch' })
    expect(c4.dataset.pressed).toBe('false')
    expect(e4.dataset.pressed).toBe('true')
    fireEvent.pointerUp(e4, { pointerId: 12, pointerType: 'touch' })
    expect(e4.dataset.pressed).toBe('false')
  })

  it('a pointer up for a different pointer id does not release an owned key', () => {
    renderApp()
    const c4 = key(60)
    fireEvent.pointerDown(c4, { pointerId: 1 })
    fireEvent.pointerUp(c4, { pointerId: 99 })
    expect(c4.dataset.pressed).toBe('true')
    fireEvent.pointerUp(c4, { pointerId: 1 })
    expect(c4.dataset.pressed).toBe('false')
  })

  it('mapped computer keys press and release the matching keybed key', () => {
    renderApp()
    const c4 = key(60)
    fireEvent.keyDown(window, { code: 'KeyA' })
    expect(c4.dataset.pressed).toBe('true')
    fireEvent.keyUp(window, { code: 'KeyA' })
    expect(c4.dataset.pressed).toBe('false')
  })

  it('note keys keep playing while a panel button has focus (letters never operate buttons)', () => {
    renderApp()
    const button = document.querySelector<HTMLElement>('[data-control-id="piano-type"]')!
    button.focus()
    const c4 = key(60)
    fireEvent.keyDown(button, { code: 'KeyA' })
    expect(c4.dataset.pressed).toBe('true')
    fireEvent.keyUp(button, { code: 'KeyA' })
    expect(c4.dataset.pressed).toBe('false')
    // Space (button activation) must still NOT double as the sustain pedal
    // while the button is focused.
    fireEvent.keyDown(button, { code: 'Space' })
    expect(document.querySelector('[data-testid="sustain-pedal"]')!.getAttribute('aria-pressed')).toBe('false')
  })

  it('key repeat does not retrigger the note', () => {
    const { getContext } = renderApp()
    fireEvent.keyDown(window, { code: 'KeyA' })
    const after = getContext()!.oscillators().length
    fireEvent.keyDown(window, { code: 'KeyA', repeat: true })
    fireEvent.keyDown(window, { code: 'KeyA', repeat: true })
    expect(getContext()!.oscillators().length).toBe(after)
  })

  it('window blur releases keyboard-held keys', () => {
    renderApp()
    const c4 = key(60)
    fireEvent.keyDown(window, { code: 'KeyA' })
    expect(c4.dataset.pressed).toBe('true')
    fireEvent.blur(window)
    expect(c4.dataset.pressed).toBe('false')
  })

  it('a focused key is playable with Enter, with repeat suppression', () => {
    const { getContext } = renderApp()
    const c4 = key(60)
    c4.focus()
    fireEvent.keyDown(c4, { key: 'Enter' })
    expect(c4.dataset.pressed).toBe('true')
    const count = getContext()!.oscillators().length
    fireEvent.keyDown(c4, { key: 'Enter', repeat: true })
    expect(getContext()!.oscillators().length).toBe(count)
    fireEvent.keyUp(c4, { key: 'Enter' })
    expect(c4.dataset.pressed).toBe('false')
  })

})

describe('interaction.keys — accessible naming', () => {
  it('names keys by note and octave', () => {
    renderApp()
    expect(screen.getByRole('button', { name: 'E1 key' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'C4 key' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'E7 key' })).toBeInTheDocument()
  })

  it('renders keys in chromatic DOM order (tab/focus order matches pitch order)', () => {
    renderApp()
    const midis = [...screen.getByTestId('keybed').querySelectorAll('.key')].map((k) =>
      Number((k as HTMLElement).dataset.midi),
    )
    expect(midis).toHaveLength(73)
    expect(midis).toEqual([...midis].sort((a, b) => a - b))
  })
})
