import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { PianoEngine } from '../audio/engine'
import { FakeAudioBackend } from '../audio/fake-backend'
import { SECTIONS, VERTICAL_ALLOCATION } from '../hardware/variant'

function renderApp() {
  const engine = new PianoEngine(new FakeAudioBackend())
  return render(<App engine={engine} disableMidi />)
}

describe('visual.section-layout', () => {
  it('renders six ordered sections at the documented widths', () => {
    const { container } = renderApp()
    const order = ['performance', 'organ', 'piano', 'program', 'synth', 'effects']
    const slots = [...container.querySelectorAll('[data-section-slot]')]
    expect(slots.map((s) => s.getAttribute('data-section-slot'))).toEqual(order)
    const fractions = Object.fromEntries(SECTIONS.map((s) => [s.id, s.fraction]))
    expect(fractions.performance).toBeCloseTo(0.14)
    expect(fractions.organ).toBeCloseTo(0.2)
    expect(fractions.piano).toBeCloseTo(0.085)
    expect(fractions.program).toBeCloseTo(0.125)
    expect(fractions.synth).toBeCloseTo(0.25)
    expect(fractions.effects).toBeCloseTo(0.2)
    const total = SECTIONS.reduce((a, s) => a + s.fraction, 0)
    expect(total).toBeCloseTo(1)
    // Each slot carries its fraction as its rendered width.
    for (const slot of slots) {
      const id = slot.getAttribute('data-section-slot')!
      const w = parseFloat((slot as HTMLElement).style.width)
      expect(w / 100).toBeCloseTo(fractions[id], 3)
    }
  })

  it('splits deck/keybed 54/46 within tolerance', () => {
    expect(VERTICAL_ALLOCATION.controlDeck).toBeCloseTo(0.54)
    expect(VERTICAL_ALLOCATION.keybed).toBeCloseTo(0.46)
    const { container } = renderApp()
    const deck = container.querySelector('.deck') as HTMLElement
    const keybedWrap = container.querySelector('.keybed-wrap') as HTMLElement
    expect(parseFloat(deck.style.height) / 100).toBeCloseTo(0.54)
    expect(parseFloat(keybedWrap.style.height) / 100).toBeCloseTo(0.46)
  })

  it('uses one continuous chassis wrapping deck and keybed', () => {
    const { container } = renderApp()
    const instrument = container.querySelector('[data-instrument]')
    expect(instrument).toBeTruthy()
    expect(instrument!.contains(container.querySelector('.deck'))).toBe(true)
    expect(instrument!.contains(container.querySelector('.keybed-wrap'))).toBe(true)
  })

  it('has no marketing hero above the instrument', () => {
    const { container } = renderApp()
    const instrument = container.querySelector('[data-instrument]')!
    expect(instrument.previousElementSibling).toBeNull()
    expect(container.querySelector('h1')).toBeNull()
  })
})
