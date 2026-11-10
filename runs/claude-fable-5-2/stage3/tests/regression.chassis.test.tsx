import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { act, fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { fitScale, ZOOM_STEPS } from '../src/App'
import { CHEEK_WIDTH, DECK_HEIGHT, DESIGN, KEYBED, SECTIONS } from '../src/hardware/geometry'
import { INVENTORY } from '../src/hardware/inventory'
import { KEYBED_MODEL } from '../src/hardware/keys'
import { mountApp } from './support/app'
import { SPEC_PRESENTATION, SPEC_VARIANT } from './support/spec'

/**
 * Feature: regression.chassis
 * No marketing hero, detached rails, missing keys, overflow, or clipped chassis
 * at 1440×900 and 390×844.
 */

const VIEWPORTS = [SPEC_PRESENTATION.desktop, SPEC_PRESENTATION.narrow]

function mountAt(viewport: { width: number; height: number }) {
  return mountApp((fake) => {
    fake.events.size = { ...viewport }
  })
}

describe('regression.chassis: no marketing hero', () => {
  it('puts the instrument first: nothing visible is rendered above it', () => {
    const app = mountApp()
    const appRoot = app.container.querySelector('.app')!
    const children = [...appRoot.children]
    // Skip link (off-screen until focused), then the stage, then the console below it.
    expect(children.map((child) => child.className.split(' ')[0])).toEqual(['skip-link', 'stage', 'console'])
    const stage = children[1]
    const visible = [...stage.children].filter((child) => !child.classList.contains('visually-hidden'))
    expect(visible).toHaveLength(1)
    expect(visible[0].classList.contains('instrument-frame')).toBe(true)
    expect(visible[0].firstElementChild?.id).toBe('instrument')
  })

  it('has no hero, banner, image, or reference photo anywhere', () => {
    const app = mountApp()
    expect(app.container.querySelectorAll('img, picture, video, canvas, [role="banner"], header')).toHaveLength(0)
    expect(app.container.querySelector('[class*="hero"], [class*="marketing"], [class*="banner"]')).toBeNull()
    expect(app.queryAllByRole('heading')).toHaveLength(1) // the visually hidden page title
    // The instrument is drawn, not photographed: no image is referenced from CSS or bundled as an asset.
    const css = readFileSync(join(process.cwd(), 'src', 'styles.css'), 'utf8')
    expect(css).not.toMatch(/url\(/)
    const sourceFiles = readdirSync(join(process.cwd(), 'src'), { recursive: true }) as string[]
    expect(sourceFiles.filter((file) => /\.(jpe?g|png|webp|gif|avif)$/i.test(file))).toEqual([])
  })
})

describe('regression.chassis: one attached chassis', () => {
  it('draws deck, keybed, cheeks, and rail inside one instrument element', () => {
    const app = mountApp()
    const instrument = app.control('instrument')
    for (const selector of [
      '[data-region="deck"]',
      '[data-region="keybed"]',
      '.chassis__deck',
      '.chassis__cheek--left',
      '.chassis__cheek--right',
      '.keybed__rail',
      '.chassis__lip',
    ]) {
      expect(instrument.querySelectorAll(selector), selector).toHaveLength(1)
    }
    expect(app.container.querySelectorAll('#instrument')).toHaveLength(1)
    // The deck ends exactly where the keybed begins.
    const deck = instrument.querySelector<HTMLElement>('[data-region="deck"]')!
    const slot = instrument.querySelector<HTMLElement>('.keybed-slot')!
    expect(parseFloat(slot.style.top)).toBe(parseFloat(deck.style.height))
    expect(parseFloat(deck.style.height)).toBe(DECK_HEIGHT)
    // The deck surface spans the full width; cheeks run the full height either side of the keys.
    expect(CHEEK_WIDTH).toBeLessThan(KEYBED.left)
    expect(DESIGN.width - CHEEK_WIDTH).toBeGreaterThan(KEYBED.right)
  })

  it('has no missing keys: 43 white keys tile the keybed with no gap or overlap', () => {
    const app = mountApp()
    const whites = [...app.container.querySelectorAll<HTMLElement>('.key--white')]
    const blacks = [...app.container.querySelectorAll<HTMLElement>('.key--black')]
    expect(whites).toHaveLength(43)
    expect(blacks).toHaveLength(30)
    let cursor = KEYBED.left
    for (const key of whites) {
      expect(parseFloat(key.style.left)).toBeCloseTo(cursor, 3)
      cursor += parseFloat(key.style.width)
    }
    expect(cursor).toBeCloseTo(KEYBED.right, 3)
    for (const key of blacks) {
      const left = parseFloat(key.style.left)
      expect(left).toBeGreaterThan(KEYBED.left)
      expect(left + parseFloat(key.style.width)).toBeLessThan(KEYBED.right)
    }
    expect(KEYBED_MODEL.keys.every((key) => app.control(key.id) !== null)).toBe(true)
  })

  it('keeps every key, control, LED, and legend inside the chassis outline', () => {
    for (const key of KEYBED_MODEL.keys) {
      expect(key.x).toBeGreaterThanOrEqual(CHEEK_WIDTH)
      expect(key.x + key.width).toBeLessThanOrEqual(DESIGN.width - CHEEK_WIDTH)
      expect(DECK_HEIGHT + key.length).toBeLessThan(DESIGN.height)
    }
    for (const section of SECTIONS) {
      const inventory = INVENTORY.sections.find((candidate) => candidate.id === section.id)!
      const xs = [
        ...inventory.controls.flatMap((control) => [control.x - control.w / 2, control.x + control.w / 2]),
        ...inventory.leds.map((led) => led.x),
        ...inventory.oleds.flatMap((oled) => [oled.x - oled.w / 2, oled.x + oled.w / 2]),
      ].map((x) => x + section.x)
      expect(Math.min(...xs)).toBeGreaterThan(CHEEK_WIDTH)
      expect(Math.max(...xs)).toBeLessThan(DESIGN.width - CHEEK_WIDTH)
      const ys = [
        ...inventory.controls.flatMap((control) => [control.y - control.h / 2, control.y + control.h / 2]),
        ...inventory.labels.map((label) => label.y),
        ...inventory.leds.map((led) => led.y),
      ]
      expect(Math.min(...ys)).toBeGreaterThan(0)
      expect(Math.max(...ys)).toBeLessThan(DECK_HEIGHT)
      // Legends may sit on a section boundary but never leave the chassis.
      for (const label of inventory.labels) {
        expect(label.x + section.x).toBeGreaterThan(0)
        expect(label.x + section.x).toBeLessThan(DESIGN.width)
      }
    }
  })
})

describe('regression.chassis: no overflow or clipping at the canonical viewports', () => {
  for (const viewport of VIEWPORTS) {
    it(`fits ${viewport.width}×${viewport.height} whole`, () => {
      const app = mountAt(viewport)
      const frame = app.container.querySelector<HTMLElement>('.instrument-frame')!
      const width = parseFloat(frame.style.width)
      const height = parseFloat(frame.style.height)
      const scale = fitScale(viewport)

      // The frame is exactly the scaled instrument: nothing is cropped, nothing spills.
      expect(width).toBeCloseTo(DESIGN.width * scale, 6)
      expect(height).toBeCloseTo(DESIGN.height * scale, 6)
      expect(width).toBeLessThanOrEqual(viewport.width)
      expect(height).toBeLessThan(viewport.height)
      expect(width / height).toBeCloseTo(SPEC_VARIANT.aspectRatio, 3)
      expect(width / viewport.width).toBeGreaterThanOrEqual(SPEC_PRESENTATION.widthFraction.minimum)
      expect(width / viewport.width).toBeLessThanOrEqual(SPEC_PRESENTATION.widthFraction.maximum)

      const instrument = app.control('instrument')
      expect(instrument.style.transform).toBe(`scale(${scale})`)
      expect(parseFloat(instrument.style.width)).toBe(DESIGN.width)
      // Default view is fitted, not zoomed: the stage is not a scroll area.
      expect(app.container.querySelector('.stage--zoomed')).toBeNull()
      expect(app.container.querySelectorAll('.key')).toHaveLength(73)
      expect(app.container.querySelectorAll('[data-control-id]')).toHaveLength(146)
    })
  }

  it('leaves room for the instrument above the fold at 1440×900', () => {
    const scale = fitScale(SPEC_PRESENTATION.desktop)
    const instrumentHeight = DESIGN.height * scale
    expect(instrumentHeight).toBeGreaterThan(400)
    // Stage padding + instrument + console reserve fit in the viewport height.
    expect(24 + instrumentHeight + 20 + 210).toBeLessThan(900)
  })

  it('refits when the viewport changes', () => {
    const app = mountAt(SPEC_PRESENTATION.desktop)
    const frame = app.container.querySelector<HTMLElement>('.instrument-frame')!
    const wide = parseFloat(frame.style.width)
    act(() => app.fake.events.emitResize(390, 844))
    const narrow = parseFloat(frame.style.width)
    expect(narrow).toBeLessThanOrEqual(390)
    expect(narrow).toBeLessThan(wide / 3)
    expect(app.container.querySelectorAll('.key')).toHaveLength(73)
  })

  it('zoom is opt-in, pans inside the stage, and returns to Fit', () => {
    const app = mountAt(SPEC_PRESENTATION.narrow)
    const frame = app.container.querySelector<HTMLElement>('.instrument-frame')!
    const fitted = parseFloat(frame.style.width)
    expect(ZOOM_STEPS[0]).toBe(1)
    expect(app.getByRole('button', { name: 'Zoom out' })).toBeDisabled()

    fireEvent.click(app.getByRole('button', { name: 'Zoom in' }))
    expect(parseFloat(frame.style.width)).toBeCloseTo(fitted * ZOOM_STEPS[1], 6)
    expect(app.container.querySelector('.stage')?.classList.contains('stage--zoomed')).toBe(true)
    expect(app.container.querySelector('.app')?.classList.contains('app--zoomed')).toBe(true)

    fireEvent.click(app.getByRole('button', { name: `${ZOOM_STEPS[1]}×` }))
    expect(parseFloat(frame.style.width)).toBeCloseTo(fitted, 6)
    expect(app.container.querySelector('.stage--zoomed')).toBeNull()
  })

  it('confines sideways scrolling to the zoomed stage and never lets the instrument overflow its own box', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'styles.css'), 'utf8')
    expect(css).toMatch(/\.stage--zoomed\s*\{[^}]*overflow:\s*auto/)
    expect(css).toMatch(/\.instrument\s*\{[^}]*overflow:\s*hidden/)
    expect(css).toMatch(/\.instrument\s*\{[^}]*transform-origin:\s*0 0/)
    // No fixed pixel widths on page chrome that could force a horizontal scrollbar at 390 px.
    expect(css).toMatch(/\.console\s*\{[^}]*width:\s*min\(94vw, 1180px\)/)
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8')
    expect(html).toMatch(/name="viewport" content="width=device-width, initial-scale=1"/)
  })
})
