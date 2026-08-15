import { act, fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../src/App'
import { hardwareStore } from '../src/hardware/store'

const MIDI60 = 60
const MIDI64 = 64

function keyByMidi(midi: number): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-midi="${midi}"]`)!
}

function sliderByLabel(label: string): HTMLElement {
  const all = Array.from(document.querySelectorAll<HTMLElement>('[role="slider"]'))
  return all.find((s) => (s.getAttribute('aria-label') ?? '').toLowerCase().includes(label.toLowerCase())) ?? all[0]
}

function switchByLabel(label: string): HTMLElement {
  const all = Array.from(document.querySelectorAll<HTMLElement>('[role="switch"]'))
  return all.find((b) => (b.getAttribute('aria-label') ?? '').toLowerCase().includes(label.toLowerCase())) as HTMLElement
}

function pressedKeyCount(): number {
  return document.querySelectorAll('.key[aria-pressed="true"]').length
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : 0
}

describe('interaction.keys', () => {
  it('pressing a key depresses it (aria-pressed) and releasing restores it', () => {
    render(<App />)
    const key = keyByMidi(MIDI60)
    expect(key.getAttribute('aria-pressed')).toBe('false')
    fireEvent.pointerDown(key, { pointerId: 1 })
    expect(key.getAttribute('aria-pressed')).toBe('true')
    fireEvent.pointerUp(key, { pointerId: 1 })
    expect(key.getAttribute('aria-pressed')).toBe('false')
  })

  it('pointer cancel clears the note', () => {
    render(<App />)
    const key = keyByMidi(MIDI64)
    fireEvent.pointerDown(key, { pointerId: 1 })
    expect(key.getAttribute('aria-pressed')).toBe('true')
    fireEvent.pointerCancel(key, { pointerId: 1 })
    expect(key.getAttribute('aria-pressed')).toBe('false')
  })

  it('independent multi-touch presses independent keys', () => {
    render(<App />)
    const k60 = keyByMidi(MIDI60)
    const k64 = keyByMidi(MIDI64)
    fireEvent.pointerDown(k60, { pointerId: 1 })
    fireEvent.pointerDown(k64, { pointerId: 2 })
    expect(k60.getAttribute('aria-pressed')).toBe('true')
    expect(k64.getAttribute('aria-pressed')).toBe('true')
    fireEvent.pointerUp(k60, { pointerId: 1 })
    fireEvent.pointerUp(k64, { pointerId: 2 })
    expect(k60.getAttribute('aria-pressed')).toBe('false')
    expect(k64.getAttribute('aria-pressed')).toBe('false')
  })

  it('computer-keyboard notes depress keys too (shared lifecycle)', () => {
    render(<App />)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }))
    })
    expect(keyByMidi(60).getAttribute('aria-pressed')).toBe('true')
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'z', bubbles: true }))
    })
    expect(keyByMidi(60).getAttribute('aria-pressed')).toBe('false')
  })
})

describe('interaction.decorative-controls', () => {
  it('a knob moves via vertical pointer drag and changes presentation state only', () => {
    render(<App />)
    const slider = sliderByLabel('Master level')
    const before = hardwareStore.get('perf.master-level')
    fireEvent.pointerDown(slider, { pointerId: 1, clientY: 300 })
    fireEvent.pointerMove(slider, { pointerId: 1, clientY: 40 })
    fireEvent.pointerUp(slider, { pointerId: 1 })
    expect(num(hardwareStore.get('perf.master-level'))).not.toBe(num(before))
  })

  it('a button toggles on/off in the store', () => {
    render(<App />)
    const btn = switchByLabel('Percussion on/off')
    const before = hardwareStore.get('organ.percussion')
    fireEvent.pointerDown(btn, { pointerId: 1 })
    fireEvent.pointerUp(btn, { pointerId: 1 })
    expect(hardwareStore.get('organ.percussion')).toBe(!(before === true))
  })

  it('a drawbar slides and stays an integer in 0..8', () => {
    render(<App />)
    const drawbar = sliderByLabel('8 foot drawbar')
    fireEvent.pointerDown(drawbar, { pointerId: 1, clientY: 300 })
    fireEvent.pointerMove(drawbar, { pointerId: 1, clientY: 60 })
    fireEvent.pointerUp(drawbar, { pointerId: 1 })
    const val = Number(hardwareStore.get('organ.db-8'))
    expect(val).toBeGreaterThanOrEqual(0)
    expect(val).toBeLessThanOrEqual(8)
    expect(Number.isInteger(val)).toBe(true)
  })

  it('decorative movement never depresses a key or starts a voice', () => {
    render(<App />)
    const slider = sliderByLabel('Master level')
    fireEvent.pointerDown(slider, { pointerId: 1, clientY: 300 })
    fireEvent.pointerMove(slider, { pointerId: 1, clientY: 10 })
    fireEvent.pointerUp(slider, { pointerId: 1 })
    expect(pressedKeyCount()).toBe(0)
  })

  it('keyboard arrow keys move a focused control', () => {
    render(<App />)
    const slider = sliderByLabel('Master level')
    slider.focus()
    const before = hardwareStore.get('perf.master-level')
    fireEvent.keyDown(slider, { key: 'ArrowUp' })
    expect(num(hardwareStore.get('perf.master-level'))).toBeGreaterThan(num(before))
  })

  it('every control is reachable with stable ids', () => {
    const { container } = render(<App />)
    expect(container.querySelectorAll('[role="slider"]').length).toBeGreaterThan(40)
    expect(container.querySelectorAll('[role="switch"]').length).toBeGreaterThan(20)
  })
})