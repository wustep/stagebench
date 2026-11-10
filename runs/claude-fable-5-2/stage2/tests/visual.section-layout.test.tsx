import { describe, expect, it } from 'vitest'
import { fitScale } from '../src/App'
import {
  DECK_HEIGHT,
  DESIGN,
  KEYBED_HEIGHT,
  PRESENTATION,
  REFERENCE_COLORS,
  SECTIONS,
  SECTION_ORDER,
  VARIANT,
  VERTICAL,
  toSectionX,
  toSectionY,
} from '../src/hardware/geometry'
import { mountApp } from './support/app'
import { SPEC_COLORS, SPEC_PRESENTATION, SPEC_SECTIONS, SPEC_VARIANT, SPEC_VERTICAL } from './support/spec'

/**
 * Feature: visual.section-layout
 * Six ordered sections at documented widths, 54/46 deck/keybed split, continuous chassis.
 */

describe('visual.section-layout: the geometry model', () => {
  it('has the six sections in panel order at the documented widths', () => {
    expect(SECTION_ORDER).toEqual(SPEC_SECTIONS.map((section) => section.id))
    SECTIONS.forEach((section, index) => {
      expect(section.fraction).toBe(SPEC_SECTIONS[index].fraction)
      expect(section.label).toBe(SPEC_SECTIONS[index].label)
      expect(section.width / DESIGN.width).toBeCloseTo(SPEC_SECTIONS[index].fraction, 10)
    })
    expect(SECTIONS.reduce((sum, section) => sum + section.fraction, 0)).toBeCloseTo(1, 10)
  })

  it('tiles the sections edge to edge across the whole chassis', () => {
    let cursor = 0
    for (const section of SECTIONS) {
      expect(section.x).toBeCloseTo(cursor, 6)
      cursor += section.width
    }
    expect(cursor).toBeCloseTo(DESIGN.width, 6)
  })

  it('splits the instrument 54 / 46 between deck and keybed', () => {
    expect(VERTICAL.deckFraction).toBe(SPEC_VERTICAL.deck)
    expect(VERTICAL.keybedFraction).toBe(SPEC_VERTICAL.keybed)
    expect(DECK_HEIGHT / DESIGN.height).toBeCloseTo(0.54, 10)
    expect(KEYBED_HEIGHT / DESIGN.height).toBeCloseTo(0.46, 10)
    expect(DECK_HEIGHT + KEYBED_HEIGHT).toBeCloseTo(DESIGN.height, 6)
  })

  it('uses the variant bounds and aspect ratio from the variants spec', () => {
    expect(DESIGN).toEqual(SPEC_VARIANT.bounds)
    expect(DESIGN.width / DESIGN.height).toBeCloseTo(SPEC_VARIANT.aspectRatio, 3)
    expect(VARIANT.id).toBe(SPEC_VARIANT.id)
    expect(REFERENCE_COLORS).toEqual(SPEC_COLORS)
  })

  it('maps photo coordinates into each section with one modest, monotonic scale', () => {
    for (const section of SECTIONS) {
      expect(toSectionX(section.id, section.photoX0)).toBe(0)
      expect(toSectionX(section.id, section.photoX1)).toBeCloseTo(section.width, 6)
      // Sections keep the photo's proportions to within 7 %.
      expect(section.scale).toBeGreaterThan(0.93)
      expect(section.scale).toBeLessThan(1.07)
    }
    SECTIONS.slice(1).forEach((section, index) => {
      expect(section.photoX0).toBe(SECTIONS[index].photoX1)
    })
    expect(toSectionY(VARIANT.photoBounds.y)).toBe(0)
  })
})

describe('visual.section-layout: fitting the viewport', () => {
  it('fills 88–97 % of a 1440×900 viewport with no vertical scroll', () => {
    const scale = fitScale(SPEC_PRESENTATION.desktop)
    const width = DESIGN.width * scale
    const height = DESIGN.height * scale
    expect(width / 1440).toBeGreaterThanOrEqual(SPEC_PRESENTATION.widthFraction.minimum)
    expect(width / 1440).toBeLessThanOrEqual(SPEC_PRESENTATION.widthFraction.maximum)
    expect(PRESENTATION.fitWidthFraction).toBeGreaterThanOrEqual(PRESENTATION.minWidthFraction)
    expect(PRESENTATION.fitWidthFraction).toBeLessThanOrEqual(PRESENTATION.maxWidthFraction)
    // Instrument plus the room reserved for the status console fits in 900 px.
    expect(height).toBeLessThan(900 - 210)
  })

  it('fits a 390×844 viewport without clipping', () => {
    const scale = fitScale(SPEC_PRESENTATION.narrow)
    const width = DESIGN.width * scale
    expect(width).toBeLessThanOrEqual(390)
    expect(width / 390).toBeGreaterThanOrEqual(0.88)
    expect(DESIGN.height * scale).toBeLessThan(844)
  })

  it('shrinks to fit a short, wide window instead of overflowing it', () => {
    const scale = fitScale({ width: 2400, height: 500 })
    expect(DESIGN.height * scale).toBeLessThanOrEqual(500 - 210)
    expect(fitScale({ width: 0, height: 0 })).toBeGreaterThan(0)
  })
})

describe('visual.section-layout: the rendered instrument', () => {
  it('renders the six sections in order, each at its documented width', () => {
    const app = mountApp()
    const sections = [...app.container.querySelectorAll<HTMLElement>('section[data-section]')]
    expect(sections.map((element) => element.dataset.section)).toEqual(SPEC_SECTIONS.map((section) => section.id))
    let cursor = 0
    sections.forEach((element, index) => {
      const width = parseFloat(element.style.width)
      expect(parseFloat(element.style.left)).toBeCloseTo(cursor, 3)
      expect(width / DESIGN.width).toBeCloseTo(SPEC_SECTIONS[index].fraction, 6)
      expect(element).toHaveAttribute('aria-label', SPEC_SECTIONS[index].label)
      expect(element.id).toBe(`section-${SPEC_SECTIONS[index].id}`)
      cursor += width
    })
    expect(cursor).toBeCloseTo(DESIGN.width, 3)
  })

  it('is one chassis: deck and keybed are stacked inside a single instrument element', () => {
    const app = mountApp()
    const instrument = app.control('instrument')
    expect(parseFloat(instrument.style.width)).toBe(DESIGN.width)
    expect(parseFloat(instrument.style.height)).toBe(DESIGN.height)
    expect(instrument).toHaveAttribute('data-variant', 'stage-4-73')

    const deck = instrument.querySelector<HTMLElement>('[data-region="deck"]')!
    const keybed = instrument.querySelector<HTMLElement>('[data-region="keybed"]')!
    expect(deck.parentElement).toBe(instrument)
    expect(instrument.contains(keybed)).toBe(true)
    const deckHeight = parseFloat(deck.style.height)
    const keybedHeight = parseFloat(keybed.style.height)
    expect(deckHeight / DESIGN.height).toBeCloseTo(0.54, 6)
    expect(keybedHeight / DESIGN.height).toBeCloseTo(0.46, 6)
    // The keybed starts exactly where the deck ends: no gap, no detached rail.
    expect(parseFloat(keybed.parentElement!.style.top)).toBeCloseTo(deckHeight, 3)
    expect(deckHeight + keybedHeight).toBeCloseTo(DESIGN.height, 3)
    // Every section lives in the deck.
    for (const section of instrument.querySelectorAll('section[data-section]')) {
      expect(section.parentElement).toBe(deck)
    }
  })

  it('scales the frame to the viewport and follows resizes', () => {
    const app = mountApp()
    const frame = app.container.querySelector<HTMLElement>('.instrument-frame')!
    expect(parseFloat(frame.style.width) / 1440).toBeCloseTo(0.94, 3)
    expect(parseFloat(frame.style.width) / parseFloat(frame.style.height)).toBeCloseTo(SPEC_VARIANT.aspectRatio, 3)
    expect(app.control('instrument').style.transform).toBe(`scale(${fitScale({ width: 1440, height: 900 })})`)
  })
})
