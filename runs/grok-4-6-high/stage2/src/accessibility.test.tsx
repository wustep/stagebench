import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import { INTERACTIVE_CONTROLS } from './model/controls'
import { KEYBED } from './model/keys'

describe('accessibility.controls', () => {
  it('gives every control and key an accessible name, role, and keyboard path', () => {
    render(<App deps={{ autoMidi: false }} />)
    for (const key of KEYBED) {
      const node = document.getElementById(key.id)
      expect(node, key.id).toBeTruthy()
      expect(node).toHaveAttribute('aria-label', key.name)
      expect(node?.tagName).toBe('BUTTON')
      expect(node).toHaveAttribute('aria-pressed')
    }
    for (const control of INTERACTIVE_CONTROLS) {
      const node = document.getElementById(control.id)
      expect(node, control.id).toBeTruthy()
      expect(node).toHaveAttribute('aria-label', control.label)
      if (control.kind === 'button') {
        expect(node).toHaveAttribute('aria-pressed')
        fireEvent.keyDown(node!, { key: 'Enter' })
        expect(node).toHaveAttribute('aria-pressed')
      } else {
        expect(node).toHaveAttribute('role', 'slider')
        expect(node).toHaveAttribute('aria-valuenow')
        fireEvent.keyDown(node!, { key: 'ArrowRight' })
        expect(node).toHaveAttribute('aria-valuenow')
      }
    }
    expect(screen.getByLabelText('Program display')).toHaveAttribute('role', 'status')
    expect(screen.getByLabelText('Synth display')).toHaveAttribute('role', 'status')
    const master = screen.getByLabelText('Master Level')
    master.focus()
    expect(document.activeElement).toBe(master)
  }, 15000)
})
