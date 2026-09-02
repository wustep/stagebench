import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DECK_FRACTION, INSTRUMENT_ASPECT, KEYBED_FRACTION, SECTIONS, instrumentWidthFor } from '../src/hardware/sections'
import { InstrumentContext } from '../src/ui/context'
import { Instrument } from '../src/ui/Instrument'
import { createServices } from '../src/ui/createServices'
import { engineOptions, makeWorld } from './helpers'

const DOCUMENTED = { performance: 0.14, organ: 0.2, piano: 0.085, program: 0.125, synth: 0.25, effects: 0.2 }

function mount() {
  const services = createServices(makeWorld().boundaries, engineOptions)
  return render(
    <InstrumentContext.Provider value={services}>
      <Instrument />
    </InstrumentContext.Provider>,
  )
}

describe('visual.section-layout — six sections, 54/46 split, continuous chassis', () => {
  it('declares the six sections in order at the documented fractions summing to one', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(['performance', 'organ', 'piano', 'program', 'synth', 'effects'])
    for (const s of SECTIONS) expect(s.fraction).toBe(DOCUMENTED[s.id])
    expect(SECTIONS.reduce((a, s) => a + s.fraction, 0)).toBeCloseTo(1, 9)
    expect(DECK_FRACTION).toBe(0.54)
    expect(KEYBED_FRACTION).toBe(0.46)
    expect(INSTRUMENT_ASPECT).toBeCloseTo(3.0951, 3)
  })

  it('renders the sections left to right at those widths inside one deck', () => {
    const { container } = mount()
    const sections = [...container.querySelectorAll('#deck .section')] as HTMLElement[]
    expect(sections.map((s) => s.dataset.section)).toEqual(['performance', 'organ', 'piano', 'program', 'synth', 'effects'])
    let left = 0
    for (const s of sections) {
      const fraction = DOCUMENTED[s.dataset.section as keyof typeof DOCUMENTED]
      expect(Number(s.dataset.fraction)).toBe(fraction)
      expect(parseFloat(s.style.left)).toBeCloseTo(left * 100, 6)
      expect(parseFloat(s.style.width)).toBeCloseTo(fraction * 100, 6)
      expect(s.getAttribute('aria-label')).toMatch(/section$/)
      left += fraction
    }
    expect(left).toBeCloseTo(1, 9)
  })

  it('splits the instrument 54% deck / 46% keybed on one continuous chassis', () => {
    const { container } = mount()
    const instrument = container.querySelector('#instrument') as HTMLElement
    const deck = container.querySelector('#deck') as HTMLElement
    const keybed = container.querySelector('#keybed') as HTMLElement
    expect(deck.style.height).toBe('54%')
    expect(keybed.style.height).toBe('46%')
    expect(instrument.style.aspectRatio).toBe('9013 / 2912')
    // the same element owns the deck, the keybed and the chassis: nothing is detached
    expect(deck.parentElement).toBe(instrument)
    expect(keybed.parentElement).toBe(instrument)
    expect(container.querySelector('#chassis')?.parentElement).toBe(instrument)
    expect(container.querySelectorAll('#instrument').length).toBe(1)
    expect(instrument.getAttribute('data-variant')).toBe('stage-4-73')
  })

  it('surface treatments follow the visual spec: red performance/program areas, dark inset plates elsewhere', () => {
    const { container } = mount()
    for (const s of SECTIONS) {
      const el = container.querySelector(`#section-${s.id}`)!
      const hasPanel = el.querySelector(':scope > .panel') !== null
      expect(hasPanel).toBe(s.surface === 'dark inset plate with red perimeter')
    }
  })

  it('sizing rule fills 88–97% of a 1440x900 viewport without vertical scroll and fits 390x844', () => {
    const desktop = instrumentWidthFor(1440, 900)
    expect(desktop / 1440).toBeGreaterThanOrEqual(0.88)
    expect(desktop / 1440).toBeLessThanOrEqual(0.97)
    expect(desktop / INSTRUMENT_ASPECT + 150).toBeLessThanOrEqual(900)
    const narrow = instrumentWidthFor(390, 844)
    expect(narrow).toBeLessThanOrEqual(390)
    expect(narrow / INSTRUMENT_ASPECT + 150).toBeLessThanOrEqual(844)
  })
})
