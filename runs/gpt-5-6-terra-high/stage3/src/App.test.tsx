import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('Stage 4 surface', () => {
  it('renders the 73-key instrument surface', () => {
    render(<App />)
    expect(screen.getByRole('region', { name: /nord stage 4 73/i })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /play/i })).toHaveLength(73)
  })
})
