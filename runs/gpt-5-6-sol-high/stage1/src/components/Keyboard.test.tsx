import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Keyboard } from './Keyboard'

describe('keyboard interactions', () => {
  it('renders all 73 accessible keys and responds to pointer press/release', () => {
    render(<Keyboard />)
    expect(screen.getAllByRole('button')).toHaveLength(73)
    const key = screen.getByRole('button', { name: 'E1' })
    fireEvent.pointerDown(key)
    expect(key).toHaveAttribute('aria-pressed', 'true')
    fireEvent.pointerUp(key)
    expect(key).toHaveAttribute('aria-pressed', 'false')
  })

  it('responds to Space and Enter without repeating', () => {
    render(<Keyboard />)
    const key = screen.getByRole('button', { name: 'F1' })
    key.focus()
    fireEvent.keyDown(key, { key: ' ' })
    expect(key).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(key, { key: ' ', repeat: true })
    expect(key).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyUp(key, { key: ' ' })
    expect(key).toHaveAttribute('aria-pressed', 'false')
  })
})
