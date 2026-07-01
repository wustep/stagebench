import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('candidate starter', () => {
  it('renders the replaceable starter surface', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /stagebench candidate starter/i })).toBeInTheDocument()
  })
})
