import { render, screen } from '@testing-library/react'
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
})
