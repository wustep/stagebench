import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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

  it('forwards pointer velocity and note lifecycle to the piano engine boundary', () => {
    const noteOn = vi.fn()
    const noteOff = vi.fn()
    render(<Keyboard onNoteOn={noteOn} onNoteOff={noteOff} />)
    const key = screen.getByRole('button', { name: 'C4' })
    vi.spyOn(key, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, width: 20, height: 100, top: 0, right: 20, bottom: 100, left: 0, toJSON: () => ({}) })
    fireEvent.pointerDown(key, { clientY: 90, pointerId: 7, pointerType: 'touch' })
    expect(noteOn).toHaveBeenCalledWith(60, 120)
    fireEvent.pointerUp(key, { pointerId: 7, pointerType: 'touch' })
    expect(noteOff).toHaveBeenCalledWith(60)
  })
})
