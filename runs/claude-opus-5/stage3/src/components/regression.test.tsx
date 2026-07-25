import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { DESKTOP_VIEWPORT, DESKTOP_WIDTH_FRACTION, NARROW_VIEWPORT } from '../model/layout'
import { VARIANT } from '../model/variant'
import { createRig } from '../test/harness'

/**
 * Feature: regression.chassis
 *
 * jsdom does not lay anything out, so the presentation constraints are checked against the sizing
 * rule that actually ships in the stylesheet: the instrument width is
 * `min(<viewportFraction>vw, (100vh - <reserved>px) * <aspectRatio>)`.
 */
const stylesheet = readFileSync(resolve(dirname(import.meta.filename ?? ''), '..', 'styles.css'), 'utf8')

function readSizingRule() {
  const match = stylesheet.match(
    /\.instrument\s*\{[^}]*width:\s*min\((\d+(?:\.\d+)?)vw,\s*calc\(\(100vh - (\d+)px\) \* (\d+(?:\.\d+)?)\)\)/,
  )
  if (!match) throw new Error('instrument sizing rule not found in styles.css')
  return {
    viewportFraction: Number(match[1]) / 100,
    reservedPx: Number(match[2]),
    aspectRatio: Number(match[3]),
  }
}

function instrumentWidthAt(viewport: { width: number; height: number }) {
  const rule = readSizingRule()
  return Math.min(viewport.width * rule.viewportFraction, (viewport.height - rule.reservedPx) * rule.aspectRatio)
}

describe('presentation constraints', () => {
  it('sizes the instrument to the variant aspect ratio in CSS and in the DOM', () => {
    expect(readSizingRule().aspectRatio).toBeCloseTo(VARIANT.aspectRatio, 4)
    const { container } = render(<App boundaries={createRig().boundaries} />)
    expect(stylesheet).toMatch(/\.instrument\s*\{[^}]*aspect-ratio:\s*3\.0951/)
    const instrument = container.querySelector('.instrument') as HTMLElement
    expect(Number(instrument.getAttribute('data-aspect-ratio'))).toBeCloseTo(VARIANT.aspectRatio, 4)
  })

  it('fills 88-97% of a 1440x900 viewport', () => {
    const width = instrumentWidthAt(DESKTOP_VIEWPORT)
    const fraction = width / DESKTOP_VIEWPORT.width
    expect(fraction).toBeGreaterThanOrEqual(DESKTOP_WIDTH_FRACTION.minimum)
    expect(fraction).toBeLessThanOrEqual(DESKTOP_WIDTH_FRACTION.maximum)
  })

  it('leaves room for the status strip at 1440x900, so the instrument never needs vertical scroll', () => {
    const width = instrumentWidthAt(DESKTOP_VIEWPORT)
    const height = width / VARIANT.aspectRatio
    expect(height + readSizingRule().reservedPx).toBeLessThanOrEqual(DESKTOP_VIEWPORT.height)
  })

  it('drops to the full width of a 390x844 viewport instead of clipping the chassis', () => {
    expect(stylesheet).toMatch(/@media \(max-width: 720px\)\s*\{\s*\.instrument\s*\{\s*width: 100%;/)
    const width = instrumentWidthAt(NARROW_VIEWPORT)
    expect(width).toBeLessThanOrEqual(NARROW_VIEWPORT.width)
  })

  it('keeps the whole instrument inside one chassis element with no stray top-level boxes', () => {
    const { container } = render(<App boundaries={createRig().boundaries} />)
    const chassis = container.querySelectorAll('.chassis')
    expect(chassis).toHaveLength(1)
    const instrumentChildren = [...(container.querySelector('.instrument')?.children ?? [])]
    expect(instrumentChildren).toHaveLength(1)
    expect(instrumentChildren[0].className).toBe('chassis')
  })

  it('places the status strip after the instrument, never as a hero above it', () => {
    const { container } = render(<App boundaries={createRig().boundaries} />)
    const stage = container.querySelector('.stage')!
    const order = [...stage.children].map((child) => child.className)
    expect(order[0]).toBe('stage__viewport')
    expect(order.at(-1)).toBe('statusbar')
  })

  it('uses the spec reference colours for chassis, panel and keys', () => {
    for (const colour of ['#851a25', '#5a0c13', '#3c424d', '#0b0b0b', '#dcdcdc']) {
      expect(stylesheet.toLowerCase()).toContain(colour)
    }
  })

  it('renders no scrollable overflow inside the chassis', () => {
    expect(stylesheet).toMatch(/\.chassis\s*\{[^}]*overflow:\s*hidden/)
  })
})
