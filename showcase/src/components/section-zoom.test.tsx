import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp } from '../test/renderApp'

/**
 * ui.section-zoom — the inspect/zoom overlay (narrow-legend-legibility,
 * SHOWCASE.md iteration 1's oldest open issue). Additive and opt-in: it must
 * not alter the default control-deck DOM/geometry the chassis regression
 * tests assert (verified here by re-running those assertions after the
 * overlay opens and closes).
 */
describe('ui.section-zoom', () => {
  it('opens with the Inspect button and closes with the close button', () => {
    renderApp()
    expect(screen.queryByRole('dialog', { name: 'Organ section magnified' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Organ section' }))
    const dialog = screen.getByRole('dialog', { name: 'Organ section magnified' })
    expect(dialog).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: 'Organ section magnified' })).toBeNull()
  })

  it('closes on Escape', () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Organ section' }))
    expect(screen.getByRole('dialog', { name: 'Organ section magnified' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Organ section magnified' })).toBeNull()
  })

  it('renders the real, operable section inside the dialog: a drawbar move writes canonical state', () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Organ Section On' }))
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Organ section' }))
    const dialog = screen.getByRole('dialog', { name: 'Organ section magnified' })
    // Query a known control id inside the dialog — the same live drawbar,
    // rendered again at the zoomed container width.
    const drawbars = screen.getAllByRole('slider', { name: 'Drawbar 9 (1′)' })
    const drawbarInDialog = drawbars.find((el) => dialog.contains(el))
    expect(drawbarInDialog).toBeTruthy()
    fireEvent.keyDown(drawbarInDialog!, { key: 'End' })
    // Canonical state: the OLED (outside the dialog) reflects the real write.
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Drawbar 9: 8/)
    expect(drawbarInDialog!.getAttribute('aria-valuenow')).toBe('8')
    // Initial focus traps on the close button.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
  })

  it('restores focus to the opener when the overlay closes', () => {
    renderApp()
    const inspect = screen.getByRole('button', { name: 'Inspect Organ section' })
    inspect.focus()
    fireEvent.click(inspect)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(inspect)
  })

  it('contains Tab focus inside the dialog, wrapping at the first/last focusable', () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Organ section' }))
    const dialog = screen.getByRole('dialog', { name: 'Organ section magnified' })
    const close = screen.getByRole('button', { name: 'Close' })
    // Initial focus sits on the close button — the dialog's first focusable.
    expect(document.activeElement).toBe(close)
    // Shift+Tab from the first focusable wraps to the last (inside the dialog).
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).not.toBe(close)
    // Tab from the last focusable wraps back to the first.
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
  })

  it('the default DOM without the overlay is unchanged (chassis regression assertions)', () => {
    renderApp()
    // Open and close the overlay first — its presence must not leave marks.
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Organ section' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    const deck = screen.getByTestId('control-deck')
    expect(deck.querySelectorAll(':scope > [data-section]')).toHaveLength(6)
    const totalWidth = [...deck.querySelectorAll(':scope > [data-section]')].reduce(
      (sum, el) => sum + parseFloat((el as HTMLElement).style.width),
      0,
    )
    expect(totalWidth).toBeCloseTo(100)

    const chassis = screen.getByTestId('chassis')
    const keybed = screen.getByTestId('keybed')
    expect(chassis.contains(keybed)).toBe(true)

    const app = document.querySelector('.stage-app')!
    expect(app.querySelector('[role="dialog"]')).toBeNull()
  })
})
