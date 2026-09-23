import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HARDWARE_CONTROLS } from '../model/hardware'
import { renderApp } from '../test/renderApp'

describe('accessibility.controls', () => {
  it('exposes names, roles, and values, and operates from the keyboard with a visible focus ring', () => {
    renderApp()
    for (const control of HARDWARE_CONTROLS) {
      const node = document.querySelector<HTMLElement>(`[data-control-id="${control.id}"]`)
      expect(node, control.id).toBeTruthy()
      expect(node?.getAttribute('aria-label') || node?.textContent?.trim().length).toBeTruthy()
      if (control.type === 'button') {
        expect(node?.tagName).toBe('BUTTON')
        expect(node).toHaveAttribute('aria-pressed')
      } else {
        expect(node).toHaveAttribute('role', 'slider')
        expect(node).toHaveAttribute('aria-valuenow')
        expect(node).toHaveAttribute('aria-valuemin')
        expect(node).toHaveAttribute('aria-valuemax')
        expect(node?.tabIndex).toBe(0)
      }
    }

    const keybed = screen.getByRole('group', { name: /73-key hammer action keybed, E1 to E7/i })
    expect(keybed).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /key$/i })).toHaveLength(73)

    const dial = screen.getByRole('slider', { name: 'Program Dial' })
    dial.focus()
    expect(dial).toHaveFocus()
    fireEvent.keyDown(dial, { key: 'ArrowRight' })
    expect(Number(dial.getAttribute('aria-valuenow'))).toBeGreaterThan(0)
    fireEvent.keyDown(dial, { key: 'Home' })
    expect(dial).toHaveAttribute('aria-valuenow', '0')

    const shift = screen.getByRole('button', { name: 'Shift/Exit' })
    shift.focus()
    fireEvent.keyDown(shift, { key: 'Enter' })
    fireEvent.keyUp(shift, { key: 'Enter' })
    expect(shift).toHaveAttribute('aria-pressed', 'true')

    const css = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')
    expect(css).toMatch(/:focus-visible/)
  })
})
