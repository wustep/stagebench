import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp } from './test/renderApp'
import { fakeStorageBoundary } from './test/fakes'

describe('ui chrome — minimal by default with an INFO toggle', () => {
  it('defaults to minimal: the info block is collapsed by class, essentials remain', () => {
    renderApp()
    const footer = screen.getByTestId('status-strip')
    expect(footer.className).toContain('chrome-minimal')

    expect(screen.getByTestId('sustain-pedal')).toBeInTheDocument()
    expect(screen.getByTestId('ctrl-pedal')).toBeInTheDocument()
    const toggle = screen.getByTestId('chrome-toggle')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')

    const engineStatus = screen.getByTestId('engine-status')
    expect(engineStatus).toBeInTheDocument()
    const infoBlock = footer.querySelector('.chrome-info')
    expect(infoBlock).not.toBeNull()
    expect(infoBlock?.contains(engineStatus)).toBe(true)
  })

  it('the INFO toggle expands and collapses the strip', () => {
    renderApp()
    const footer = screen.getByTestId('status-strip')
    const toggle = screen.getByTestId('chrome-toggle')

    fireEvent.click(toggle)
    expect(footer.className).not.toContain('chrome-minimal')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(toggle)
    expect(footer.className).toContain('chrome-minimal')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
  })

  it('the preference persists through the storage boundary', () => {
    const storage = fakeStorageBoundary()
    const first = renderApp(undefined, undefined, storage)
    fireEvent.click(screen.getByTestId('chrome-toggle'))
    expect(storage.data.get('stagebench.ui.v1')).toContain('full')

    first.view.unmount()
    renderApp(undefined, undefined, storage)
    const footer = screen.getByTestId('status-strip')
    expect(footer.className).not.toContain('chrome-minimal')
  })

  it('status reporting stays truthful and queryable while minimal', () => {
    renderApp()
    fireEvent.pointerDown(document.querySelector('[data-control-id="key-60"]')!, { pointerId: 1 })
    expect(screen.getByTestId('engine-status').getAttribute('data-status')).not.toBe('error')
    fireEvent.pointerUp(document.querySelector('[data-control-id="key-60"]')!, { pointerId: 1 })

    fireEvent.click(screen.getByTestId('sustain-pedal'))
    expect(screen.getByTestId('pedal-status').textContent).toMatch(/sustain down/)
  })

  it('the magnifier lens renders an inert, aria-hidden clone without disturbing the real deck', () => {
    renderApp()
    expect(screen.queryByTestId('magnify-lens')).toBeNull()
    fireEvent.click(screen.getByTestId('magnify-toggle'))
    const lens = screen.getByTestId('magnify-lens')
    expect(lens.getAttribute('aria-hidden')).toBe('true')
    expect(lens.querySelector('.lens-canvas')?.hasAttribute('inert')).toBe(true)
    // The clone spans the whole chassis: the loupe works over the keybed
    // too, with played notes lighting up inside it (live render).
    expect(lens.querySelector('.keybed')).not.toBeNull()
    expect(lens.querySelectorAll('.keybed .key')).toHaveLength(73)
    // The cursor clone ships all four OS-styled glyphs and starts as the arrow.
    const lensCursor = lens.querySelector('.lens-cursor')
    expect(lensCursor?.getAttribute('data-cursor')).toBe('default')
    expect(['mac', 'win']).toContain(lensCursor?.getAttribute('data-os'))
    expect(lensCursor?.querySelectorAll('svg')).toHaveLength(4)
    // The interactive deck stays unique and intact (the clone carries no testid).
    const deck = screen.getByTestId('control-deck')
    expect(deck.querySelectorAll(':scope > [data-section]')).toHaveLength(6)
    fireEvent.click(screen.getByTestId('magnify-toggle'))
    expect(screen.queryByTestId('magnify-lens')).toBeNull()
  })

  it('the reference overlay ghosts the photo over the chassis at slider-set opacity', () => {
    renderApp()
    expect(screen.queryByTestId('reference-overlay')).toBeNull()
    expect(screen.queryByTestId('overlay-opacity')).toBeNull()

    const toggle = screen.getByTestId('overlay-toggle')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')

    // Decorative and non-interactive: the panel stays playable underneath.
    const ghost = screen.getByTestId('reference-overlay')
    expect(ghost.getAttribute('aria-hidden')).toBe('true')
    expect(ghost.getAttribute('data-mode')).toBe('ghost')
    expect(screen.getByTestId('chassis').contains(ghost)).toBe(true)
    expect(ghost.style.opacity).toBe('0.5')
    expect(ghost.querySelector('img')?.getAttribute('src')).toContain('/reference/nord-stage-4-73.jpg')

    fireEvent.change(screen.getByTestId('overlay-opacity'), { target: { value: '80' } })
    expect(ghost.style.opacity).toBe('0.8')

    fireEvent.click(toggle)
    expect(screen.queryByTestId('reference-overlay')).toBeNull()
  })

  it('diff and wipe modes: full-strength blend and a keyboard-driven seam', () => {
    renderApp()
    fireEvent.click(screen.getByTestId('overlay-toggle'))
    fireEvent.change(screen.getByTestId('overlay-opacity'), { target: { value: '40' } })

    fireEvent.click(screen.getByTestId('overlay-mode-diff'))
    const ghost = screen.getByTestId('reference-overlay')
    expect(ghost.getAttribute('data-mode')).toBe('diff')
    // Diff snaps to full strength (a dimmed diff reads as false matches).
    expect(ghost.style.opacity).toBe('1')
    expect(screen.queryByTestId('overlay-wipe')).toBeNull()

    fireEvent.click(screen.getByTestId('overlay-mode-wipe'))
    expect(ghost.getAttribute('data-mode')).toBe('wipe')
    expect(ghost.style.clipPath).toBe('inset(0 50% 0 0)')
    const seam = screen.getByTestId('overlay-wipe')
    expect(seam.getAttribute('aria-valuenow')).toBe('50')
    fireEvent.keyDown(seam, { key: 'ArrowLeft' })
    expect(seam.getAttribute('aria-valuenow')).toBe('49')
    fireEvent.keyDown(seam, { key: 'ArrowRight', shiftKey: true })
    expect(seam.getAttribute('aria-valuenow')).toBe('54')
    expect(ghost.style.clipPath).toBe('inset(0 46% 0 0)')

    fireEvent.click(screen.getByTestId('overlay-mode-ghost'))
    expect(screen.queryByTestId('overlay-wipe')).toBeNull()
  })

  it('holding V blinks the full photo over any mode, release restores it', () => {
    renderApp()
    fireEvent.click(screen.getByTestId('overlay-toggle'))
    fireEvent.click(screen.getByTestId('overlay-mode-diff'))
    fireEvent.change(screen.getByTestId('overlay-opacity'), { target: { value: '35' } })

    fireEvent.keyDown(window, { code: 'KeyV' })
    const ghost = screen.getByTestId('reference-overlay')
    expect(ghost.getAttribute('data-mode')).toBe('ghost')
    expect(ghost.style.opacity).toBe('1')

    fireEvent.keyUp(window, { code: 'KeyV' })
    expect(ghost.getAttribute('data-mode')).toBe('diff')
    expect(ghost.style.opacity).toBe('0.35')
  })

  it('arrow keys nudge the photo alignment, 0 resets, readout stays truthful', () => {
    renderApp()
    fireEvent.click(screen.getByTestId('overlay-toggle'))
    expect(screen.queryByTestId('overlay-nudge')).toBeNull()

    fireEvent.keyDown(window, { code: 'ArrowRight' })
    fireEvent.keyDown(window, { code: 'ArrowDown' })
    fireEvent.keyDown(window, { code: 'ArrowDown' })
    fireEvent.keyDown(window, { code: 'ArrowUp', shiftKey: true })
    expect(screen.getByTestId('overlay-nudge').textContent).toContain('Δ 0.1, 0.2 · ×1.002')
    const img = screen.getByTestId('reference-overlay').querySelector('img')!
    // dx of 0.1% of the chassis = 0.1 × crop.w in img-relative %.
    expect(img.style.transform).toBe('translate(0.0777%, 0.147%) scale(1.002)')

    fireEvent.keyDown(window, { code: 'Digit0' })
    expect(screen.queryByTestId('overlay-nudge')).toBeNull()
    expect(img.style.transform).toBe('translate(0%, 0%) scale(1)')
  })

  it('the magnifier lens clone carries the compare ghost too', () => {
    renderApp()
    fireEvent.click(screen.getByTestId('overlay-toggle'))
    fireEvent.click(screen.getByTestId('magnify-toggle'))
    const lens = screen.getByTestId('magnify-lens')
    expect(lens.querySelector('.reference-overlay')).not.toBeNull()
    // The wipe seam stays out of the lens: it is an input, the lens is inert.
    fireEvent.click(screen.getByTestId('overlay-mode-wipe'))
    expect(lens.querySelectorAll('.overlay-wipe')).toHaveLength(0)
  })

  it('a failed photo load reports unavailable instead of faking the overlay', () => {
    renderApp()
    fireEvent.click(screen.getByTestId('overlay-toggle'))
    // jsdom never loads images; fire the error the browser would raise
    // when the dev-server /reference bridge (or the photo) is absent.
    fireEvent.error(screen.getByTestId('reference-overlay').querySelector('img')!)
    expect(screen.queryByTestId('reference-overlay')).toBeNull()
    expect(screen.queryByTestId('overlay-opacity')).toBeNull()
    expect(screen.getByTestId('overlay-missing').textContent).toMatch(/unavailable/)
    // Toggling off and on re-arms the attempt (the photo may exist now).
    fireEvent.click(screen.getByTestId('overlay-toggle'))
    fireEvent.click(screen.getByTestId('overlay-toggle'))
    expect(screen.getByTestId('reference-overlay')).toBeInTheDocument()
    expect(screen.queryByTestId('overlay-missing')).toBeNull()
  })
})
