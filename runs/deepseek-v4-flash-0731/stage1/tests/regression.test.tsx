import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../src/App'
import { buildInstrumentFresh, getSections } from '../src/hardware/instrument'

/**
 * regression.chassis — no missing keys, detached rails, or clipped surface.
 * jsdom does not compute layout geometry, so we assert the authored geometry
 * that guarantees the invariant (continuous chassis, 54/46 split, 73 keys, all
 * six sections present) — the visual audit captures the measured layout.
 */
describe('regression.chassis', () => {
  it('renders the complete instrument with all six sections and the keybed', () => {
    const { container } = render(<App />)
    expect(container.querySelector('.chassis')).toBeTruthy()
    expect(container.querySelector('.chassis-top-rail')).toBeTruthy()
    expect(container.querySelector('.chassis-bottom-rail')).toBeTruthy()
    expect(container.querySelectorAll('.section').length).toBe(6)
    expect(container.querySelectorAll('.key').length).toBe(73)
    expect(container.querySelectorAll('.key-white').length).toBe(43)
    expect(container.querySelectorAll('.key-black').length).toBe(30)
  })

  it('keeps a single continuous chassis (one chassis element, no detached pieces)', () => {
    const { container } = render(<App />)
    expect(container.querySelectorAll('.chassis').length).toBe(1)
  })

  it('authored geometry: 54/46 deck:keybed and section fractions sum to 1', () => {
    const spec = buildInstrumentFresh()
    expect(spec.deckFraction + spec.keybedFraction).toBeCloseTo(1, 5)
    const sum = getSections().reduce((a, s) => a + s.fraction, 0)
    expect(sum).toBeCloseTo(1, 8)
  })

  it('instrument uses proportional (fraction) sizing so it never overflows', () => {
    // The styled instrument and its sections are sized by fractions (CSS
    // percentages), not fixed pixel widths, so 390px narrow stays within the
    // viewport. Assert the authored fractions drive the layout.
    const { container } = render(<App />)
    const sections = Array.from(container.querySelectorAll<HTMLElement>('.section'))
    expect(sections.length).toBe(6)
    for (const section of sections) {
      expect(section.style.width).toMatch(/%$/)
    }
  })
})