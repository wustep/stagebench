import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('continuous product-study chassis', () => {
  it('uses one connected instrument chassis and starts with the instrument', () => {
    const { container } = render(<App />)
    expect(container.querySelectorAll('[data-chassis]')).toHaveLength(1)
    expect(screen.getByRole('region', { name: 'Nord Stage 4 73 hardware' })).toBeInTheDocument()
    expect(container.querySelector('[data-marketing-hero]')).not.toBeInTheDocument()
    expect(container.querySelector('[data-chassis]')).toContainElement(screen.getByTestId('control-deck'))
    expect(container.querySelector('[data-chassis]')).toContainElement(screen.getByTestId('keybed'))
  })

  it('plays mapped computer keys, exposes sustain and panic, and updates contextual status', async () => {
    const { container } = render(<App />)
    const middleC = screen.getByRole('button', { name: 'C4' })
    fireEvent.keyDown(window, { key: 'a', code: 'KeyA' })
    expect(middleC).toHaveAttribute('aria-pressed', 'true')
    expect(container.querySelector('.performance-status')).toHaveTextContent('1 voice')
    fireEvent.keyUp(window, { key: 'a', code: 'KeyA' })
    expect(middleC).toHaveAttribute('aria-pressed', 'false')

    const sustain = screen.getByRole('button', { name: 'Sustain off' })
    fireEvent.click(sustain)
    expect(sustain).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Panic' }))
    expect(screen.getByRole('button', { name: 'Sustain off' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('operates Stage 3 layers, split, synth, preset, menu and effects from hardware controls', () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Synth enable' }))
    expect(screen.getByRole('button', { name: 'Synth enable' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Keyboard split' }))
    expect(container.querySelector('#program-display')).toHaveTextContent('SPLIT C4')

    fireEvent.click(screen.getByRole('button', { name: 'Synth layer C' }))
    expect(screen.getByRole('button', { name: 'Synth layer C' })).toHaveAttribute('aria-pressed', 'true')

    const waveform = screen.getByRole('slider', { name: 'Waveform' })
    fireEvent.keyDown(waveform, { key: 'End' })
    expect(container.querySelector('#synth-display')).toHaveTextContent('SQUARE')

    fireEvent.click(screen.getByRole('button', { name: 'Context menu' }))
    expect(container.querySelector('#program-display')).toHaveTextContent('PRESET LIBRARY')
    fireEvent.click(screen.getByRole('button', { name: 'Page' }))
    expect(container.querySelector('#program-display')).toHaveTextContent('KEYBOARD SPLIT')
    fireEvent.click(screen.getByRole('button', { name: 'Context menu' }))

    fireEvent.click(screen.getByRole('button', { name: 'Store' }))
    expect(container.querySelector('#program-display')).toHaveTextContent('User 4')

    fireEvent.click(screen.getByRole('button', { name: 'Effects Synth layer' }))
    const effectType = screen.getByRole('slider', { name: 'Effect 1 type' })
    fireEvent.keyDown(effectType, { key: 'End' })
    expect(container.querySelector('#effects-display')).toHaveTextContent('FLAM-DELAY')
  })
})
