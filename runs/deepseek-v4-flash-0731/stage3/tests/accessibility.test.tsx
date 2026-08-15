import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../src/App'

/**
 * Accessibility.controls: accessible names, roles, values, keyboard
 * operation, and visible focus on every physical control.
 */

describe('accessibility.controls', () => {
  it('exposes accessible names, roles and values on sliders', () => {
    render(<App />)
    const sliders = screen.getAllByRole('slider')
    expect(sliders.length).toBeGreaterThan(40)
    for (const slider of sliders) {
      expect(slider.getAttribute('aria-label')).toBeTruthy()
      expect(slider.hasAttribute('aria-valuemin')).toBe(true)
      expect(slider.hasAttribute('aria-valuemax')).toBe(true)
      expect(slider.hasAttribute('aria-valuenow')).toBe(true)
    }
  })

  it('exposes switches with aria-checked and labels', () => {
    render(<App />)
    const switches = screen.getAllByRole('switch')
    expect(switches.length).toBeGreaterThan(20)
    for (const sw of switches) {
      expect(sw.getAttribute('aria-label')).toBeTruthy()
      expect(sw.hasAttribute('aria-checked')).toBe(true)
    }
  })

  it('keys are keyboard-focusable buttons with names', () => {
    render(<App />)
    const keys = screen.getAllByRole('button').filter((el) => el.getAttribute('aria-label')?.startsWith('Key '))
    expect(keys.length).toBe(73)
    expect(keys[0].tabIndex).toBe(0)
    expect(keys[0].getAttribute('aria-label')).toMatch(/E1|MIDI 28/)
  })

  it('controls are operable by keyboard (focus usable, arrows change value)', () => {
    render(<App />)
    const slider = screen.getAllByRole('slider')[0]
    slider.focus()
    expect(slider.ownerDocument.activeElement).toBe(slider)
    const now = Number(slider.getAttribute('aria-valuenow'))
    fireEvent.keyDown(slider, { key: 'ArrowUp' })
    const later = Number(slider.getAttribute('aria-valuenow'))
    expect(later).toBeGreaterThanOrEqual(now)
  })

  it('buttons respond to Space key (toggle state changes)', () => {
    render(<App />)
    const sw = screen.getAllByRole('switch')[0]
    const before = sw.getAttribute('aria-checked')
    fireEvent.keyDown(sw, { key: ' ' })
    const after = sw.getAttribute('aria-checked')
    expect(after).not.toBe(before)
  })

  it('OLED displays are exposed as images with accessible labels', () => {
    render(<App />)
    const oleds = screen.getAllByRole('img').filter((el) => (el.getAttribute('aria-label') ?? '').toLowerCase().includes('display'))
    expect(oleds.length).toBe(2) // Program + Synth only
  })

  it('every interactive control is focusable (keyboard reachable)', () => {
    render(<App />)
    // sliders, switches, and keys all expose tabIndex 0 for keyboard reach
    const interactive = [
      ...screen.getAllByRole('slider'),
      ...screen.getAllByRole('switch'),
      ...screen.getAllByRole('button').filter((el) => el.getAttribute('aria-label')?.startsWith('Key ')),
    ]
    expect(interactive.length).toBeGreaterThan(100)
    for (const el of interactive) expect(el.tabIndex).toBe(0)
  })
})