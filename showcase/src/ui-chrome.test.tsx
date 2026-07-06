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

  it('hides the whole panel from a button or the B shortcut, with a restore affordance', () => {
    renderApp()
    expect(screen.getByTestId('status-strip')).toBeInTheDocument()
    expect(screen.queryByTestId('panel-restore')).toBeNull()

    // The Hide button collapses the entire strip to a small restore pill.
    fireEvent.click(screen.getByTestId('panel-hide'))
    expect(screen.queryByTestId('status-strip')).toBeNull()
    const restore = screen.getByTestId('panel-restore')
    expect(restore).toBeInTheDocument()

    // The restore pill brings the panel back.
    fireEvent.click(restore)
    expect(screen.getByTestId('status-strip')).toBeInTheDocument()

    // B toggles it from anywhere on the page.
    fireEvent.keyDown(window, { code: 'KeyB' })
    expect(screen.queryByTestId('status-strip')).toBeNull()
    fireEvent.keyDown(window, { code: 'KeyB' })
    expect(screen.getByTestId('status-strip')).toBeInTheDocument()

    // Modified presses (Cmd/Ctrl+B) are left to the browser.
    fireEvent.keyDown(window, { code: 'KeyB', metaKey: true })
    expect(screen.getByTestId('status-strip')).toBeInTheDocument()
  })

  it('toggles dark mode from a button or the N shortcut, leaving the chassis untouched', () => {
    renderApp()
    const app = document.querySelector('.stage-app') as HTMLElement
    expect(app.getAttribute('data-theme')).toBe('light')
    // The instrument carries no theme attribute — dark mode never touches it.
    expect(screen.getByTestId('instrument').hasAttribute('data-theme')).toBe(false)

    const toggle = screen.getByTestId('theme-toggle')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(app.getAttribute('data-theme')).toBe('dark')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('instrument').hasAttribute('data-theme')).toBe(false)

    // N flips it back.
    fireEvent.keyDown(window, { code: 'KeyN' })
    expect(app.getAttribute('data-theme')).toBe('light')

    // Modified presses (Cmd+N new window) are left to the browser.
    fireEvent.keyDown(window, { code: 'KeyN', metaKey: true })
    expect(app.getAttribute('data-theme')).toBe('light')
  })

  it('persists theme and hidden-panel prefs alongside chrome through storage', () => {
    const storage = fakeStorageBoundary()
    const first = renderApp(undefined, undefined, storage)
    fireEvent.click(screen.getByTestId('theme-toggle'))
    fireEvent.click(screen.getByTestId('chrome-toggle'))
    const saved = storage.data.get('stagebench.ui.v1')!
    // Writing one preference must not clobber the others.
    expect(saved).toContain('"theme":"dark"')
    expect(saved).toContain('"chrome":"full"')

    first.view.unmount()
    renderApp(undefined, undefined, storage)
    expect((document.querySelector('.stage-app') as HTMLElement).getAttribute('data-theme')).toBe('dark')
    expect(screen.getByTestId('status-strip').className).not.toContain('chrome-minimal')
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

  it('measure mode (dev-only): live cqw cursor readout, drag-drawn boxes, Esc clears', () => {
    renderApp()
    expect(screen.queryByTestId('measure-overlay')).toBeNull()
    expect(screen.queryByTestId('measure-readout')).toBeNull()

    const toggle = screen.getByTestId('measure-toggle')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    const overlay = screen.getByTestId('measure-overlay')
    // A HUD, not chrome: aria-hidden and pointer-transparent to the a11y tree.
    expect(screen.getByTestId('measure-readout').getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByTestId('measure-cursor').textContent).toContain('move the pointer')

    // jsdom computes no layout; pin the chassis rect at 1000x500 so the
    // fraction math resolves to round numbers (1cqw = 10px here).
    overlay.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 500 }) as DOMRect

    fireEvent.pointerMove(overlay, { pointerId: 1, clientX: 250, clientY: 100 })
    // x: 250/1000 = 25cqw. y: 100px = 100/1000 of the WIDTH = 10cqw, and
    // 100/500 = 20% of the chassis height.
    expect(screen.getByTestId('measure-cursor').textContent).toBe('x 25.00 · y 10.00 cqw  (250, 100 px · y 20.0%H)')

    fireEvent.pointerDown(overlay, { pointerId: 1, clientX: 250, clientY: 100 })
    fireEvent.pointerMove(overlay, { pointerId: 1, clientX: 450, clientY: 200 })
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 450, clientY: 200 })
    const box = screen.getByTestId('measure-box')
    expect(box.style.left).toBe('25%')
    expect(box.style.width).toBe('20%')
    expect(box.textContent).toBe('20.00 × 10.00 cqw')
    expect(screen.getByTestId('measure-box-readout').textContent).toBe('w 20.00 · h 10.00 cqw  (200 × 100 px · h 20.0%H)')

    // A sub-3px drag is a stray click: no second box appears.
    fireEvent.pointerDown(overlay, { pointerId: 1, clientX: 600, clientY: 300 })
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 601, clientY: 301 })
    expect(screen.getAllByTestId('measure-box')).toHaveLength(1)

    fireEvent.keyDown(window, { code: 'Escape' })
    expect(screen.queryByTestId('measure-box')).toBeNull()
    expect(screen.queryByTestId('measure-box-readout')).toBeNull()

    fireEvent.click(toggle)
    expect(screen.queryByTestId('measure-overlay')).toBeNull()
    expect(screen.queryByTestId('measure-readout')).toBeNull()
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
