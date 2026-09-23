import { fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp } from '../test/renderApp'
import { testAudioBoundary } from '../test/renderAudio'

function key(name: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(`[data-note="${name}"]`)
  if (!node) throw new Error(`missing key ${name}`)
  return node
}

describe('interaction.keys', () => {
  it('presses and releases a key from pointer down/up, including cancel', () => {
    renderApp()
    const note = key('C4')
    fireEvent.pointerDown(note, { pointerId: 1, clientY: 40 })
    expect(note).toHaveAttribute('aria-pressed', 'true')
    expect(note).toHaveAttribute('data-pressed', 'true')
    fireEvent.pointerUp(note, { pointerId: 1 })
    expect(note).toHaveAttribute('aria-pressed', 'false')

    fireEvent.pointerDown(note, { pointerId: 2, clientY: 10 })
    expect(note).toHaveAttribute('data-pressed', 'true')
    fireEvent.pointerCancel(note, { pointerId: 2 })
    expect(note).toHaveAttribute('data-pressed', 'false')
  })

  it('tracks independent touches and keyboard activation with repeat suppression', () => {
    renderApp({ audio: testAudioBoundary() })
    const c4 = key('C4')
    const e4 = key('E4')
    fireEvent.pointerDown(c4, { pointerId: 7, clientY: 30 })
    fireEvent.pointerDown(e4, { pointerId: 8, clientY: 30 })
    expect(c4).toHaveAttribute('data-pressed', 'true')
    expect(e4).toHaveAttribute('data-pressed', 'true')
    fireEvent.pointerUp(c4, { pointerId: 7 })
    expect(c4).toHaveAttribute('data-pressed', 'false')
    expect(e4).toHaveAttribute('data-pressed', 'true')

    c4.focus()
    fireEvent.keyDown(c4, { key: 'Enter' })
    const voices = document.querySelector('[data-testid="engine-status"]')?.getAttribute('data-voices')
    expect(Number(voices)).toBeGreaterThanOrEqual(2)
    fireEvent.keyDown(c4, { key: 'Enter', repeat: true })
    expect(c4).toHaveAttribute('data-pressed', 'true')
    expect(document.querySelector('[data-testid="engine-status"]')).toHaveAttribute('data-voices', voices!)
    fireEvent.keyUp(c4, { key: 'Enter' })
    expect(c4).toHaveAttribute('data-pressed', 'false')
    fireEvent.blur(c4)
  })
})
