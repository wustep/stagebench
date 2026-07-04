import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from './App'
import { HARDWARE_CONTROLS, SECTIONS, VARIANT, generateKeybed } from './hardware'

describe('Nord Stage 4 phase 1 surface', () => {
  it('models the Stage 4 73 keybed exactly', () => {
    const keybed = generateKeybed()
    expect(keybed).toHaveLength(73)
    expect(keybed.filter((key) => key.color === 'white')).toHaveLength(43)
    expect(keybed.filter((key) => key.color === 'black')).toHaveLength(30)
    expect(keybed[0]).toEqual(expect.objectContaining({ note: 'E1', midi: 28, color: 'white' }))
    expect(keybed.at(-1)).toEqual(expect.objectContaining({ note: 'E7', midi: 100, color: 'white' }))
    expect(VARIANT.aspectRatio).toBeCloseTo(3.0951)
  })

  it('renders the six documented sections and dense control inventory', () => {
    render(<App />)
    for (const section of SECTIONS) {
      expect(screen.getByRole('region', { name: section.label })).toBeInTheDocument()
    }
    expect(SECTIONS.map((section) => section.fraction)).toEqual([0.13, 0.21, 0.15, 0.09, 0.21, 0.21])
    expect(new Set(HARDWARE_CONTROLS.map((control) => control.id)).size).toBe(HARDWARE_CONTROLS.length)
    expect(HARDWARE_CONTROLS.filter((control) => control.type === 'drawbar')).toHaveLength(9)
    expect(screen.getByText('A:11 Nord Stage 4')).toBeInTheDocument()
    expect(screen.getByText('OSC CTRL SOFT')).toBeInTheDocument()
    expect(screen.queryByText(/wide oled/i)).not.toBeInTheDocument()
  })

  it('presses and releases keybed notes by pointer and cleans up on cancel', () => {
    render(<App />)
    const c4 = screen.getByRole('button', { name: 'C4 piano key' })
    fireEvent.pointerDown(c4, { pointerId: 12, pressure: 0.6 })
    expect(c4).toHaveClass('is-pressed')
    expect(screen.getByText('Voices 1')).toBeInTheDocument()
    fireEvent.pointerUp(c4, { pointerId: 12 })
    expect(c4).not.toHaveClass('is-pressed')

    const d4 = screen.getByRole('button', { name: 'D4 piano key' })
    fireEvent.pointerDown(d4, { pointerId: 13, pressure: 0.7 })
    expect(d4).toHaveClass('is-pressed')
    fireEvent.pointerCancel(d4, { pointerId: 13 })
    expect(d4).not.toHaveClass('is-pressed')
  })

  it('supports mapped keyboard notes, repeat suppression, sustain, and blur cleanup', () => {
    render(<App />)
    fireEvent.keyDown(window, { key: 'a', repeat: false })
    fireEvent.keyDown(window, { key: 'a', repeat: true })
    expect(screen.getByRole('button', { name: 'C4 piano key' })).toHaveClass('is-pressed')
    expect(screen.getByText('Voices 1')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: ' ', repeat: false })
    expect(screen.getByText('Sustain on')).toBeInTheDocument()
    fireEvent.keyUp(window, { key: 'a' })
    expect(screen.getByRole('button', { name: 'C4 piano key' })).not.toHaveClass('is-pressed')
    fireEvent.keyUp(window, { key: ' ' })
    expect(screen.getByText('Sustain off')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 's', repeat: false })
    expect(screen.getByRole('button', { name: 'D4 piano key' })).toHaveClass('is-pressed')
    fireEvent.blur(window)
    expect(screen.getByRole('button', { name: 'D4 piano key' })).not.toHaveClass('is-pressed')
  })

  it('makes decorative controls accessible and presentation-only', () => {
    render(<App />)
    const master = screen.getByRole('slider', { name: /master level decorative knob/i })
    expect(master).toHaveAttribute('aria-valuenow', '0')
    fireEvent.keyDown(master, { key: 'ArrowUp' })
    expect(master).toHaveAttribute('aria-valuenow', '12')

    const organ = screen.getByRole('button', { name: /organ decorative button/i })
    expect(organ).toHaveAttribute('aria-pressed', 'false')
    fireEvent.pointerDown(organ)
    expect(organ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/Basic piano: ready generated synthesis/i)).toBeInTheDocument()
  })

  it('reports MIDI denied and disconnected states without requiring a device', async () => {
    render(<App />)
    const requestMIDIAccess = vi.fn().mockRejectedValue(new Error('denied'))
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: requestMIDIAccess })
    fireEvent.click(screen.getByRole('button', { name: 'Enable MIDI' }))
    expect(await screen.findByText('MIDI denied')).toBeInTheDocument()

    const inputs = new Map<string, { onmidimessage: ((event: { data: number[] }) => void) | null }>([
      ['fake', { onmidimessage: null }],
    ])
    const access = { inputs, onstatechange: null as null | ((event: { port: { state: string } }) => void) }
    requestMIDIAccess.mockResolvedValue(access)
    fireEvent.click(screen.getByRole('button', { name: 'Enable MIDI' }))
    expect(await screen.findByText('MIDI connected')).toBeInTheDocument()
    inputs.get('fake')?.onmidimessage?.({ data: [0x90, 60, 100] })
    await waitFor(() => expect(screen.getByText('Voices 1')).toBeInTheDocument())
    inputs.get('fake')?.onmidimessage?.({ data: [0xb0, 64, 127] })
    await waitFor(() => expect(screen.getByText('Sustain on')).toBeInTheDocument())
    access.onstatechange?.({ port: { state: 'disconnected' } })
    await waitFor(() => expect(screen.getByText('MIDI disconnected')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText('Voices 0')).toBeInTheDocument())
  })

  it('keeps the chassis as one visible application surface with status outside the instrument', () => {
    render(<App />)
    const instrument = screen.getByLabelText(/phase 1 surface/i)
    expect(instrument).toHaveAttribute('data-variant', 'stage-4-73')
    expect(within(instrument).getAllByRole('button', { name: /^[A-G][0-9] piano key$/i })).toHaveLength(43)
    expect(within(instrument).getAllByRole('button', { name: /black piano key/i })).toHaveLength(30)
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })
})
