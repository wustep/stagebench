import { describe, expect, it, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import App from '../App'
import { createMemoryStorage } from '../audio/programStore'
import { SECTIONS } from '../hardware/catalog'
import { VARIANT } from '../hardware/variant'

/**
 * regression.chassis — no marketing hero, no detached rails, no missing keys, no
 * overflow, and no clipped chassis at 1440x900 or 390x844.
 *
 * jsdom does not lay out, so these tests assert the structural facts that make those
 * viewport claims true: a single continuous chassis element that contains the deck and
 * the keybed, nothing above the instrument, six sections as its only deck children, and
 * a complete keybed. The measured pixel geometry is recorded in `stage1-visual-audit.md`
 * and produced by the capture pass in a real browser.
 */
afterEach(() => cleanup())

describe('regression.chassis', () => {
  it('renders one chassis containing both the deck and the keybed', () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    const chassis = screen.getByTestId('instrument')
    const deck = screen.getByTestId('deck')
    const keybedDeck = screen.getByTestId('keybed-deck')
    expect(chassis.contains(deck)).toBe(true)
    expect(chassis.contains(keybedDeck)).toBe(true)
    // Both bands live inside the same element, so the chassis is continuous rather than
    // two detached rails.
    expect(deck.parentElement).toBe(chassis)
    expect(keybedDeck.parentElement).toBe(chassis)
    expect(document.querySelectorAll('[data-testid="instrument"]')).toHaveLength(1)
  })

  it('puts nothing above the instrument: no hero, no title block, no marketing copy', () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    const main = document.querySelector('main') as HTMLElement
    const chassis = screen.getByTestId('instrument')
    // The instrument is the first rendered child of the page container.
    expect(main.firstElementChild).toBe(chassis)
    // No h1/h2 hero headings anywhere.
    expect(document.querySelectorAll('h1')).toHaveLength(0)
    expect(document.querySelectorAll('h2')).toHaveLength(0)
    expect(main.textContent).not.toMatch(/introducing|experience the|buy now|discover the/i)
  })

  it('does not use the reference photograph as a background', () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    // No background image anywhere, and no image elements at all.
    expect(document.querySelectorAll('img')).toHaveLength(0)
    const chassis = screen.getByTestId('instrument')
    expect(chassis.style.backgroundImage).toBe('')
    expect(chassis.getAttribute('style') ?? '').not.toMatch(/url\(/)
  })

  it('renders all six sections as direct children of the deck', () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    const deckInner = screen.getByTestId('deck-inner')
    const sections = Array.from(deckInner.children).filter((el) =>
      el.hasAttribute('data-section-id'),
    )
    expect(sections.map((el) => el.getAttribute('data-section-id'))).toEqual(
      SECTIONS.map((s) => s.id),
    )
  })

  it('renders a complete keybed with no missing keys', () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    expect(document.querySelectorAll('.piano-key')).toHaveLength(VARIANT.totalKeys)
    for (let midi = VARIANT.lowestMidi; midi <= VARIANT.highestMidi; midi += 1) {
      expect(document.querySelector(`[data-midi="${midi}"]`), `key ${midi}`).not.toBeNull()
    }
  })

  it('does not clip the keybed: every key sits inside the keybed box', () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    const keys = Array.from(document.querySelectorAll<HTMLElement>('.piano-key'))
    for (const key of keys) {
      const left = Number.parseFloat(key.style.left)
      const width = Number.parseFloat(key.style.width)
      expect(left, key.dataset.note).toBeGreaterThanOrEqual(-0.001)
      expect(left + width, key.dataset.note).toBeLessThanOrEqual(100.001)
    }
  })

  it('declares the variant aspect ratio on the chassis itself', () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    const chassis = screen.getByTestId('instrument')
    expect(Number(chassis.getAttribute('data-aspect'))).toBeCloseTo(3.0951, 3)
  })

  it('keeps the deck and keybed as sibling bands, so neither collapses', () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    const deck = screen.getByTestId('deck')
    const keybedDeck = screen.getByTestId('keybed-deck')
    // Exactly two bands inside the chassis, in deck-then-keybed order.
    const bands = Array.from(screen.getByTestId('instrument').children).filter(
      (el) => el.tagName !== 'DIV' || !el.classList.contains('rail-serial'),
    )
    expect(bands.indexOf(deck)).toBeLessThan(bands.indexOf(keybedDeck))
    expect(deck.nextElementSibling).toBe(keybedDeck)
  })

  it('does not render a horizontal scroll container inside the instrument', () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-testid="instrument"] *'))) {
      expect(el.style.overflowX, el.className).not.toBe('scroll')
      expect(el.style.overflowX, el.className).not.toBe('auto')
    }
  })

  it('keeps the front rail attached to the keybed rather than floating', () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    const keybedDeck = screen.getByTestId('keybed-deck')
    const rail = keybedDeck.querySelector('.front-rail')
    expect(rail).not.toBeNull()
    expect(rail?.parentElement).toBe(keybedDeck)
  })
})
