import { afterEach, describe, expect, it } from 'vitest'
import App from './App'
import { cleanup, render, screen } from '@testing-library/react'

describe('app shell', () => {
  afterEach(() => cleanup())

  it('renders the Nord Stage 4 instrument', () => {
    render(<App />)
    expect(screen.getByTestId('instrument')).toBeInTheDocument()
    expect(screen.getByTestId('keybed')).toHaveAttribute('data-key-count', '73')
  })
})
