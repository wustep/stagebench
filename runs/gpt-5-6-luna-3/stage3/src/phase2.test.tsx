import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'

afterEach(cleanup)

describe('Nord Stage 4 Phase 2 functional panel', () => {
  it('selects each piano family and keeps a playable labeled model state', () => {
    render(<App />)
    for (const family of ['UPRIGHT', 'ELECTRIC', 'CLAV', 'DIGITAL', 'MISC', 'GRAND']) {
      fireEvent.click(screen.getByRole('button', { name: family }))
      expect(screen.getByRole('status')).toHaveTextContent(new RegExp(`${family[0]}${family.slice(1).toLowerCase()}`))
    }
    expect(screen.getByText(/model A · A focused · fallback-ready/i)).toBeInTheDocument()
  })

  it('owns layers independently and routes focus to effects', () => {
    const { container } = render(<App />)
    const layerB = container.querySelector('#piano-layer-b-on') as HTMLElement
    fireEvent.click(layerB)
    expect(layerB).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(container.querySelector('#piano-layer-b-focus') as HTMLElement)
    expect(container.querySelector('#effects-focus-b')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Layer B octave up' }))
    expect(screen.getByText('OCT +12')).toBeInTheDocument()
  })

  it('exposes the performance controls as real state, not decorative toggles', () => {
    render(<App />)
    fireEvent.change(document.querySelector('#piano-kb-touch') as HTMLElement, { target: { value: 'Light' } })
    fireEvent.change(document.querySelector('#piano-dyn-comp') as HTMLElement, { target: { value: '3' } })
    fireEvent.change(document.querySelector('#piano-unison') as HTMLElement, { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'SOFT RELEASE' }))
    fireEvent.click(screen.getByRole('button', { name: 'STRING RES' }))
    expect(screen.getByRole('status')).toHaveTextContent(/fallback-ready/i)
    expect(screen.getByRole('button', { name: 'SOFT RELEASE' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'STRING RES' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('binds effect types, bypass, global targeting, rotary, and master level', () => {
    render(<App />)
    fireEvent.change(document.querySelector('#effects-mod1-type') as HTMLElement, { target: { value: 'Ring Mod' } })
    fireEvent.change(document.querySelector('#effects-reverb-type') as HTMLElement, { target: { value: 'Cathedral' } })
    fireEvent.click(document.querySelector('#effects-mod1-on') as HTMLElement)
    fireEvent.click(document.querySelector('#effects-delay-global') as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: 'TO ROTARY' }))
    fireEvent.click(screen.getByRole('button', { name: 'BYPASS ALL' }))
    expect(screen.getByRole('button', { name: 'TO ROTARY' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'BYPASS ALL' })).toHaveAttribute('aria-pressed', 'true')
    const master = screen.getByRole('slider', { name: 'MASTER LEVEL' })
    fireEvent.keyDown(master, { key: 'ArrowLeft' })
    expect(master).toHaveAttribute('aria-valuenow', '67')
  })
})
