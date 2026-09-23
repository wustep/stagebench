import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MidiBoundary } from '../input/midi'
import { HARDWARE_CONTROLS } from '../model/hardware'
import { UNSUPPORTED_CONTROLS, isUnsupportedControl } from '../model/unsupported'
import { renderApp } from '../test/renderApp'
import type { PianoEngine } from '../audio/engine'

describe('hardware.bindings', () => {
  it('binds every control that is not spec-excluded and lists the excluded ones', async () => {
    let engine: PianoEngine | null = null
    renderApp({ onEngine: (created) => { engine = created } })
    const nodes = document.querySelectorAll('[data-panel-control="true"]')
    expect(nodes.length).toBe(HARDWARE_CONTROLS.length)
    for (const control of HARDWARE_CONTROLS) {
      const node = document.querySelector(`[data-control-id="${control.id}"]`)
      expect(node, control.id).toBeTruthy()
      if (isUnsupportedControl(control.id)) {
        expect(node).toHaveAttribute('data-decorative', 'true')
        expect(node).toHaveAttribute('data-bound', 'false')
      } else {
        expect(node).toHaveAttribute('data-decorative', 'false')
        expect(node).toHaveAttribute('data-bound', 'true')
      }
    }
    const listed = screen.getByTestId('unsupported-controls')
    for (const entry of UNSUPPORTED_CONTROLS) expect(listed).toHaveTextContent(entry.id)
    expect(screen.getByRole('slider', { name: 'Control Pedal' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Morph Assign Wheel' }))
    const level = document.querySelector('[data-control-id="organ-level-a"]') as HTMLElement
    level.focus()
    fireEvent.keyDown(level, { key: 'ArrowDown' })
    expect(level).toHaveAttribute('data-morph', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Morph Assign Wheel' }))

    fireEvent.click(screen.getByRole('button', { name: 'Nudge mid split' }))
    expect(document.querySelector('[data-midi="65"]')).toHaveAttribute('data-split-led', 'true')

    fireEvent.click(document.querySelector('[data-control-id="shift"]')!)
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Program Dial' }), { key: 'ArrowRight' })
    expect(screen.getByTestId('program-list')).toBeTruthy()

    fireEvent.change(screen.getByRole('slider', { name: 'Control Pedal' }), { target: { value: '90' } })
    expect(engine!.getProgramView().pedal).toBe(90)
  })
})

describe('programs.navigation', () => {
  it('shows MIDI denial on the program OLED', async () => {
    const denied: MidiBoundary = {
      isSupported: () => true,
      requestAccess: async () => {
        throw new DOMException('denied', 'SecurityError')
      },
    }
    renderApp({ midi: denied })
    await waitFor(() => expect(screen.getByTestId('midi-status')).toHaveTextContent('MIDI DENIED'))
  })
})
