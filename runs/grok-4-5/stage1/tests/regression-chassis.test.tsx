import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from '../src/App'
import { VARIANT } from '../src/model/variant'
import { SECTION_LAYOUT, VERTICAL_ALLOCATION } from '../src/model/hardware'

describe('regression.chassis', () => {
  afterEach(() => cleanup())

  it('renders continuous chassis with full keybed and no marketing hero', () => {
    render(<App />)
    const instrument = screen.getByTestId('instrument')
    expect(instrument).toBeInTheDocument()
    expect(instrument).toHaveAttribute('data-variant', 'stage-4-73')

    // No marketing hero
    expect(document.querySelector('[data-testid="marketing-hero"]')).toBeNull()
    expect(document.querySelector('img[src*="nord"]')).not.toBeInTheDocument()

    // Full key count in DOM
    const keys = document.querySelectorAll('[data-key-midi]')
    expect(keys.length).toBe(VARIANT.keyboard.totalKeys)

    // Six sections present on continuous deck
    for (const s of SECTION_LAYOUT) {
      expect(screen.getByTestId(`section-${s.id}`)).toBeInTheDocument()
    }

    // Deck + keybed present (continuous chassis)
    expect(screen.getByTestId('control-deck')).toBeInTheDocument()
    expect(screen.getByTestId('keybed')).toBeInTheDocument()
    expect(screen.getByTestId('keybed')).toHaveAttribute('data-key-count', '73')

    // Vertical allocation CSS vars
    const style = instrument.getAttribute('style') ?? ''
    expect(style).toContain(String(VERTICAL_ALLOCATION.controlDeck))
    expect(style).toContain(String(VERTICAL_ALLOCATION.keybed))
  })

  it('uses aspect ratio matching the 73 variant silhouette', () => {
    expect(VARIANT.aspectRatio).toBeCloseTo(3.0951, 3)
  })
})
