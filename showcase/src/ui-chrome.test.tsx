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
})
