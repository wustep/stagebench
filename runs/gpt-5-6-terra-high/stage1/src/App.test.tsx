import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'

describe('Stage 4 surface', () => {
  afterEach(cleanup)

  it('models the 73 E-to-E keys and the only two OLED status screens', () => {
    render(<App />)
    expect(screen.getAllByRole('button', { name: /piano key$/i })).toHaveLength(73)
    expect(screen.getByRole('button', { name: 'E1 piano key' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'E7 piano key' })).toBeInTheDocument()
    expect(screen.getAllByRole('status')).toHaveLength(2)
  })

  it('makes decorative hardware keyboard-accessible presentation state', () => {
    render(<App />)
    const live = screen.getByRole('button', { name: /live mode/i })
    expect(live).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(live)
    expect(live).toHaveAttribute('aria-pressed', 'true')
    const dial = screen.getByLabelText('Program Dial') as HTMLInputElement
    fireEvent.change(dial, { target: { value: '82' } })
    expect(dial.value).toBe('82')
  })

  it('depresses and releases a pointer-played piano note', () => {
    render(<App />)
    const key = screen.getByRole('button', { name: 'E1 piano key' })
    fireEvent.pointerDown(key, { pointerId: 1 })
    expect(key).toHaveAttribute('aria-pressed', 'true')
    fireEvent.pointerUp(key, { pointerId: 1 })
    expect(key).toHaveAttribute('aria-pressed', 'false')
  })

  it('handles mapped keyboard notes and sustains with Space', () => {
    render(<App />)
    fireEvent.keyDown(window, { key: 'z', code: 'KeyZ' })
    expect(screen.getByRole('button', { name: 'C3 piano key' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyUp(window, { key: 'z', code: 'KeyZ' })
    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    expect(screen.getByRole('button', { name: 'SUSTAIN · SPACE' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyUp(window, { key: ' ', code: 'Space' })
  })
})
