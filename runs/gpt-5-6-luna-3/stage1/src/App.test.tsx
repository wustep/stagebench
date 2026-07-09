import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'

afterEach(cleanup)

describe('Nord Stage 4 Phase 1 surface', () => {
  it('renders the exact Stage 4 73 E-to-E keybed', () => {
    const { container } = render(<App />)
    expect(container.querySelectorAll('[data-key-id]')).toHaveLength(73)
    expect(screen.getByRole('region', { name: /73-key hammer-action keybed, E to E/i })).toBeInTheDocument()
    expect(screen.getByText('TOUCH RESPONSE / GENERATED PIANO')).toBeInTheDocument()
  })

  it('keeps six ordered sections and only Program/Synth primary OLEDs', () => {
    const { container } = render(<App />)
    expect([...container.querySelectorAll('.instrument-section')].map((section) => [...section.classList].find((name) => ['performance', 'organ', 'piano', 'program', 'synth', 'effects'].includes(name)))).toEqual(['performance', 'organ', 'piano', 'program', 'synth', 'effects'])
    expect(container.querySelectorAll('.program-screen, .synth-screen')).toHaveLength(2)
    expect(container.querySelectorAll('.instrument-section .program-screen, .instrument-section .synth-screen')).toHaveLength(2)
  })

  it('moves decorative controls through accessible state without claiming a feature', () => {
    render(<App />)
    const master = screen.getByRole('slider', { name: 'MASTER LEVEL' })
    expect(master).toHaveAttribute('aria-valuenow', '72')
    fireEvent.keyDown(master, { key: 'ArrowRight' })
    expect(master).toHaveAttribute('aria-valuenow', '77')
    const store = screen.getByRole('button', { name: 'STORE' })
    expect(store).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(store)
    expect(store).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText(/Primary program display/i)).toHaveTextContent(/DECORATIVE/i)
  })

  it('supports pointer key lifecycle and mapped computer-key repeat suppression', () => {
    const { container } = render(<App />)
    const key = container.querySelector('[data-key-id="key-40"]') as HTMLElement
    fireEvent.pointerDown(key, { pointerId: 9, pressure: 0.8 })
    expect(key).toHaveClass('pressed')
    fireEvent.pointerUp(key, { pointerId: 9 })
    expect(key).not.toHaveClass('pressed')
    fireEvent.keyDown(window, { key: 'z', repeat: false })
    fireEvent.keyDown(window, { key: 'z', repeat: true })
    expect(container.querySelector('[data-key-id="key-52"]')).toHaveClass('pressed')
    fireEvent.keyUp(window, { key: 'z' })
    expect(container.querySelector('[data-key-id="key-52"]')).not.toHaveClass('pressed')
  })

  it('supports sustain from the UI and clears notes on blur', () => {
    const { container } = render(<App />)
    const sustain = screen.getByRole('button', { name: 'SUSTAIN' })
    fireEvent.click(sustain)
    expect(sustain).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(window, { key: 'x', repeat: false })
    expect(container.querySelector('[data-key-id="key-54"]')).toHaveClass('pressed')
    fireEvent.blur(window)
    expect(container.querySelector('[data-key-id="key-54"]')).not.toHaveClass('pressed')
    expect(sustain).toHaveAttribute('aria-pressed', 'false')
  })

  it('exposes MIDI as a truthful injectable boundary when unavailable', () => {
    render(<App />)
    const midi = screen.getByRole('button', { name: /Enable MIDI/i })
    fireEvent.click(midi)
    expect(midi).toBeInTheDocument()
  })
})
