import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp } from '../test/renderApp'

describe('regression.chassis', () => {
  it('renders no marketing hero heading above the instrument', () => {
    renderApp()
    expect(document.querySelector('h1')).toBeNull()
    expect(document.querySelector('h2')).toBeNull()
    // The first child of the app is the instrument itself.
    const app = document.querySelector('.stage-app')!
    expect((app.firstElementChild as HTMLElement).dataset.testid ?? app.firstElementChild!.getAttribute('data-testid')).toBe(
      'instrument',
    )
  })

  it('does not render the reference photograph or any raster image', () => {
    renderApp()
    expect(document.querySelector('img')).toBeNull()
    expect(document.body.innerHTML).not.toMatch(/nord-stage-4-73\.jpg/)
  })

  it('keeps the keybed inside the chassis (no detached frame)', () => {
    renderApp()
    const chassis = screen.getByTestId('chassis')
    const keybed = screen.getByTestId('keybed')
    expect(chassis.contains(keybed)).toBe(true)
    // Rails and cheeks are chassis children, not siblings of the instrument.
    expect(chassis.querySelector('.top-rail')).toBeTruthy()
    expect(chassis.querySelector('.bottom-rail')).toBeTruthy()
  })

  it('renders the full 73-key keybed with no missing keys', () => {
    renderApp()
    const keybed = screen.getByTestId('keybed')
    const keys = [...keybed.querySelectorAll('.key')]
    expect(keys).toHaveLength(73)
    const midis = keys.map((k) => Number((k as HTMLElement).dataset.midi)).sort((a, b) => a - b)
    expect(midis[0]).toBe(28)
    expect(midis.at(-1)).toBe(100)
    expect(new Set(midis).size).toBe(73)
  })

  it('positions every key within the keybed bounds (no clipped keys)', () => {
    renderApp()
    const keys = [...document.querySelectorAll('.key')] as HTMLElement[]
    for (const key of keys) {
      const left = parseFloat(key.style.left)
      const width = parseFloat(key.style.width)
      expect(left).toBeGreaterThanOrEqual(0)
      expect(left + width).toBeLessThanOrEqual(100.0001)
    }
  })

  it('renders all six sections inside the deck (no dropped or clipped sections)', () => {
    renderApp()
    const deck = screen.getByTestId('control-deck')
    expect(deck.querySelectorAll(':scope > [data-section]')).toHaveLength(6)
    const totalWidth = [...deck.querySelectorAll(':scope > [data-section]')].reduce(
      (sum, el) => sum + parseFloat((el as HTMLElement).style.width),
      0,
    )
    expect(totalWidth).toBeCloseTo(100)
  })

  it('uses the aspect-locked chassis so the instrument cannot render as a generic slab', () => {
    renderApp()
    const chassis = screen.getByTestId('chassis')
    expect(chassis.className).toContain('chassis')
    // The keybed block and deck block partition the full chassis height.
    const deckBlock = screen.getByTestId('deck-block')
    const keysBlock = screen.getByTestId('keys-block')
    expect(parseFloat(deckBlock.style.height) + parseFloat(keysBlock.style.height)).toBe(100)
  })
})
