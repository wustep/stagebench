import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp } from './test/renderApp'

// Inherited starter smoke test, updated to the replaced Phase 1 surface
// (the starter explicitly instructs replacing its placeholder markup).
describe('candidate application', () => {
  it('renders the Nord Stage 4 73 instrument surface', () => {
    renderApp()
    expect(screen.getByRole('region', { name: /nord stage 4 73/i })).toBeInTheDocument()
    expect(screen.getByTestId('keybed')).toBeInTheDocument()
  })

  it('reports a truthful initial audio status', () => {
    renderApp()
    expect(screen.getByTestId('engine-status').getAttribute('data-status')).toBe('idle')
    expect(screen.getByTestId('engine-status').textContent).toMatch(/first key press/i)
  })
})
