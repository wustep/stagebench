import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { PianoOutput } from './audio'
import { HARDWARE_CONTROLS } from './hardware'
import type { MidiAccessLike } from './App'

class FakePianoOutput implements PianoOutput {
  calls: Array<{ kind: 'on' | 'off' | 'all-off'; id?: string; midi?: number; velocity?: number }> = []
  disposed = false

  noteOn(id: string, midi: number, velocity: number) { this.calls.push({ kind: 'on', id, midi, velocity }) }
  noteOff(id: string) { this.calls.push({ kind: 'off', id }) }
  allNotesOff() { this.calls.push({ kind: 'all-off' }) }
  dispose() { this.disposed = true }
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function mountApp(midiAccessFactory?: () => Promise<MidiAccessLike>) {
  const output = new FakePianoOutput()
  const rendered = render(<App audioOutputFactory={() => output} midiAccessFactory={midiAccessFactory} />)
  return { ...rendered, output }
}

describe('Stage 4 73 surface', () => {
  it('renders the exact E2–E8 73-key hammer action keybed with the measured black and white pattern', async () => {
    const { container } = mountApp()
    await waitFor(() => expect(screen.getByText('Ready · generated piano synthesis')).toBeInTheDocument())
    const keybed = container.querySelector('[data-key-count="73"]')
    const keys = Array.from(container.querySelectorAll('[data-key-id]'))
    expect(keybed).toHaveAttribute('aria-label', '73-key hammer action keybed, E2 to E8')
    expect(keys).toHaveLength(73)
    expect(keys.filter((key) => key.getAttribute('data-key-color') === 'white')).toHaveLength(43)
    expect(keys.filter((key) => key.getAttribute('data-key-color') === 'black')).toHaveLength(30)
    expect(screen.getByRole('button', { name: 'E2 piano key' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'E8 piano key' })).toBeInTheDocument()
  })

  it('lays out all six sections in the measured order and gives only Program and Synth primary displays', () => {
    const { container } = mountApp()
    const sections = Array.from(container.querySelectorAll('[data-section-id]'))
    expect(sections.map((section) => section.getAttribute('data-section-id'))).toEqual(['performance', 'organ', 'piano', 'program', 'synth', 'effects'])
    expect(sections.map((section) => Number.parseFloat((section as HTMLElement).style.flexBasis))).toEqual([14, 20, 8.5, 12.5, 25, 20])
    expect(container.querySelectorAll('[data-primary-display]')).toHaveLength(2)
    expect(container.querySelector('[data-primary-display="program"]')).toHaveAttribute('aria-label', 'Program OLED, decorative in Phase 1')
    expect(container.querySelector('[data-primary-display="synth"]')).toHaveAttribute('aria-label', 'Synth OLED, decorative in Phase 1')
    expect(within(sections[1] as HTMLElement).getAllByRole('slider', { name: /organ drawbar/i })).toHaveLength(9)
    expect(within(sections[1] as HTMLElement).getAllByLabelText(/organ drawbar/i)).toHaveLength(9)
  })

  it('keeps a stable accessible control inventory and lets decorative controls change presentation only', () => {
    const { container, output } = mountApp()
    expect(container.querySelectorAll('[data-control-id]')).toHaveLength(HARDWARE_CONTROLS.length)
    expect(new Set(Array.from(container.querySelectorAll('[data-control-id]'), (node) => node.getAttribute('data-control-id'))).size).toBe(HARDWARE_CONTROLS.length)
    const control = screen.getByRole('button', { name: 'Percussion On' })
    expect(control).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(control)
    expect(control).toHaveAttribute('aria-pressed', 'true')
    const master = screen.getByRole('slider', { name: 'Master Level' })
    master.focus()
    expect(master).toHaveFocus()
    fireEvent.change(master, { target: { value: '75' } })
    expect(master).toHaveValue('75')
    expect(output.calls).toEqual([])
  })

  it('plays and releases independent pointer notes, including cancel cleanup', () => {
    const { output } = mountApp()
    const e2 = screen.getByRole('button', { name: 'E2 piano key' })
    const f2 = screen.getByRole('button', { name: 'F2 piano key' })
    fireEvent.pointerDown(e2, { pointerId: 7, pointerType: 'touch' })
    fireEvent.pointerDown(f2, { pointerId: 8, pointerType: 'touch' })
    expect(output.calls.filter((call) => call.kind === 'on').map((call) => call.midi)).toEqual([40, 41])
    expect(e2).toHaveAttribute('aria-pressed', 'true')
    fireEvent.pointerUp(e2, { pointerId: 7, pointerType: 'touch' })
    expect(e2).toHaveAttribute('aria-pressed', 'false')
    expect(f2).toHaveAttribute('aria-pressed', 'true')
    fireEvent.pointerCancel(f2, { pointerId: 8, pointerType: 'touch' })
    expect(f2).toHaveAttribute('aria-pressed', 'false')
    expect(output.calls.filter((call) => call.kind === 'off')).toHaveLength(2)
  })

  it('maps computer keys, suppresses repeats, applies Space sustain, and releases every owned note on blur', () => {
    const { output } = mountApp()
    fireEvent.keyDown(window, { code: 'KeyA', key: 'a' })
    fireEvent.keyDown(window, { code: 'KeyA', key: 'a', repeat: true })
    fireEvent.keyDown(window, { code: 'KeyS', key: 's' })
    expect(output.calls.filter((call) => call.kind === 'on')).toHaveLength(2)
    expect(output.calls.filter((call) => call.kind === 'on').map((call) => call.velocity)).toEqual([88, 88])
    fireEvent.keyDown(window, { code: 'Space', key: ' ' })
    fireEvent.keyUp(window, { code: 'KeyA', key: 'a' })
    expect(output.calls.filter((call) => call.kind === 'off')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Sustain pedal' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyUp(window, { code: 'Space', key: ' ' })
    expect(output.calls.filter((call) => call.kind === 'off')).toHaveLength(1)
    fireEvent.keyUp(window, { code: 'KeyS', key: 's' })
    fireEvent(window, new Event('blur'))
    expect(output.calls.filter((call) => call.kind === 'all-off')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Sustain pedal' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('supports MIDI note velocity and sustain CC64 through the injected MIDI boundary', async () => {
    const input: { id: string; state: string; onmidimessage: ((event: { data: Uint8Array }) => void) | null } = { id: 'midi-in', state: 'connected', onmidimessage: null }
    const stateListeners = new Set<(event: { port?: { id?: string; state?: string; type?: string } }) => void>()
    const access: MidiAccessLike = {
      inputs: new Map([['midi-in', input]]),
      addEventListener: (_type, listener) => stateListeners.add(listener),
      removeEventListener: (_type, listener) => stateListeners.delete(listener),
    }
    const { output } = mountApp(async () => access)
    fireEvent.click(screen.getByRole('button', { name: 'Connect MIDI' }))
    await screen.findByText('MIDI connected')
    expect(input.onmidimessage).toBeTypeOf('function')
    input.onmidimessage?.({ data: new Uint8Array([0x92, 60, 109]) })
    expect(output.calls.at(-1)).toMatchObject({ kind: 'on', midi: 60, velocity: 109 })
    input.onmidimessage?.({ data: new Uint8Array([0xb2, 64, 127]) })
    input.onmidimessage?.({ data: new Uint8Array([0x82, 60, 0]) })
    expect(output.calls.filter((call) => call.kind === 'off')).toHaveLength(0)
    input.onmidimessage?.({ data: new Uint8Array([0xb2, 64, 0]) })
    expect(output.calls.filter((call) => call.kind === 'off')).toHaveLength(1)
    act(() => stateListeners.forEach((listener) => listener({ port: { id: 'midi-in', state: 'disconnected', type: 'input' } })))
    expect(screen.getByText('MIDI disconnected')).toBeInTheDocument()
  })

  it('reports denied MIDI access and stops all voices on component cleanup', async () => {
    const { output, unmount } = mountApp(async () => { throw new DOMException('Permission denied', 'NotAllowedError') })
    fireEvent.click(screen.getByRole('button', { name: 'Connect MIDI' }))
    expect(await screen.findByText('MIDI permission denied')).toBeInTheDocument()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'E3 piano key' }), { pointerId: 4 })
    unmount()
    expect(output.calls.some((call) => call.kind === 'all-off')).toBe(true)
    expect(output.disposed).toBe(true)
  })

  it('keeps the chassis complete and fits the two required viewport proportions without a marketing hero', () => {
    const { container } = mountApp()
    expect(container.querySelector('h1')).not.toBeInTheDocument()
    const instrument = container.querySelector('.instrument')
    expect(instrument).toHaveAttribute('data-instrument', 'stage-4-73')
    expect(instrument).toHaveClass('instrument')
    expect(container.querySelector('.keybed')).toBeInTheDocument()
    expect(container.querySelector('.instrument-top-rail')).toBeInTheDocument()
    expect(container.querySelector('.deck-front-rail')).toBeInTheDocument()
  })
})
