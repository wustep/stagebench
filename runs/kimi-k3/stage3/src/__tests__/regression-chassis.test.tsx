import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { PianoEngine } from '../audio/engine'
import { FakeAudioBackend } from '../audio/fake-backend'
import { VARIANT } from '../hardware/variant'

function setup() {
  const engine = new PianoEngine(new FakeAudioBackend())
  return render(<App engine={engine} disableMidi />)
}

/**
 * regression.chassis — no marketing hero, detached rails, missing keys,
 * overflow, or clipped chassis at 1440x900 and 390x844.
 *
 * jsdom does not lay out, so these tests assert the structural and stylesheet
 * guarantees that produce correct layout; pixel evidence lives in the
 * canonical captures (stage1-desktop.png / stage1-narrow.png) and the visual
 * audit.
 */
describe('regression.chassis', () => {
  it('no marketing hero: the instrument is the first content of the page', () => {
    const { container } = setup()
    const page = container.querySelector('.page')!
    expect(page.firstElementChild).toBe(container.querySelector('[data-instrument]'))
  })

  it('no detached rails: deck and keybed are both inside the single chassis', () => {
    const { container } = setup()
    const chassis = container.querySelector('[data-instrument]')!
    expect(chassis.children.length).toBe(2)
    expect(chassis.children[0].classList.contains('deck')).toBe(true)
    expect(chassis.children[1].classList.contains('keybed-wrap')).toBe(true)
  })

  it('no missing keys: 73 keys inside the keybed, none outside', () => {
    const { container } = setup()
    const keybed = container.querySelector('[data-keybed]')!
    expect(keybed.querySelectorAll('[data-key-id]').length).toBe(73)
    expect(container.querySelector('[data-keybed]')!.contains(container.querySelector('[data-key-id="key.e7"]'))).toBe(true)
  })

  it('stylesheet pins the instrument to 88–97% viewport width with the variant aspect ratio', async () => {
    const styles = (await import('../styles.css?inline')) as Record<string, string>
    const css = styles.default ?? Object.values(styles).join('\n')
    expect(css).toMatch(/\.instrument\s*{[^}]*width:\s*94vw/)
    expect(css).toMatch(/aspect-ratio:\s*3\.0951/)
    expect(VARIANT.aspectRatio).toBeCloseTo(3.0951, 4)
    // No vertical scroll at desktop: the page centers without fixed heights exceeding viewport.
    expect(css).toMatch(/\.page\s*{[^}]*min-height:\s*100vh/)
    // Narrow viewport: instrument remains inspectable (horizontal scroll, not clipping).
    expect(css).toMatch(/@media\s*\(max-width:\s*700px\)/)
    expect(css).toMatch(/overflow-x:\s*auto/)
  })

  it('chassis is not clipped: instrument uses overflow hidden only for rounded corners, keybed fully inside', () => {
    const { container } = setup()
    const instrument = container.querySelector('[data-instrument]') as HTMLElement
    const keybed = container.querySelector('[data-keybed]') as HTMLElement
    expect(instrument.contains(keybed)).toBe(true)
    // Deck + keybed heights sum to 100% of the chassis (54 + 46).
    const deck = container.querySelector('.deck') as HTMLElement
    const wrap = container.querySelector('.keybed-wrap') as HTMLElement
    expect(parseFloat(deck.style.height) + parseFloat(wrap.style.height)).toBeCloseTo(100)
  })
})
