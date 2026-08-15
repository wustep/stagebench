import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../src/App'

describe('App smoke', () => {
  it('renders the instrument chassis and keybed', () => {
    render(<App />)
    expect(screen.getByRole('main', { name: /nord stage 4 73/i })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /73-key piano keybed/i })).toBeInTheDocument()
  })
})