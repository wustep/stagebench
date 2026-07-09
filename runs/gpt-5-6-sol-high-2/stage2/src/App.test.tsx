import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from './App'
import { ALL_CONTROLS } from './hardware'
import type { MidiAccessLike } from './inputs'
import { PianoNoteEngine } from './piano'
import { FakeVoiceBackend } from './test-fakes'

function renderInstrument(requestMidiAccess?: () => Promise<MidiAccessLike>) {
  const backend = new FakeVoiceBackend()
  const engine = new PianoNoteEngine(backend)
  const view = render(<App engine={engine} requestMidiAccess={requestMidiAccess} />)
  return { backend, engine, ...view }
}

describe('complete Stage 4 surface', () => {
  it('renders the continuous six-section chassis, exact keybed, and only two primary OLEDs', () => {
    const { container } = renderInstrument()
    expect(screen.getByRole('article', { name: /Nord Stage 4 73 browser instrument/i })).toBeInTheDocument()
    expect(container.querySelectorAll('[data-section]')).toHaveLength(6)
    expect([...container.querySelectorAll('[data-section]')].map((node) => node.getAttribute('data-section'))).toEqual([
      'performance', 'organ', 'piano', 'program', 'synth', 'effects',
    ])
    expect(container.querySelectorAll('.piano-key')).toHaveLength(73)
    expect(container.querySelectorAll('.white-key')).toHaveLength(43)
    expect(container.querySelectorAll('.black-key')).toHaveLength(30)
    expect(container.querySelectorAll('[data-primary-oled]')).toHaveLength(2)
  })

  it('gives every panel input a stable ID and accessible name while keeping inherited sections decorative', () => {
    const { container, backend } = renderInstrument()
    expect(container.querySelectorAll('[data-control-id]')).toHaveLength(ALL_CONTROLS.length)
    const ids = [...container.querySelectorAll<HTMLElement>('[data-control-id]')].map((item) => item.dataset.controlId)
    expect(new Set(ids).size).toBe(ALL_CONTROLS.length)
    for (const item of container.querySelectorAll<HTMLElement>('[data-control-id]')) {
      expect(item).toHaveAccessibleName()
      if (/^(organ|program|synth)-/.test(item.dataset.controlId ?? '')) expect(item.dataset.functional).toBe('false')
    }
    const store = screen.getByRole('button', { name: /Store program \(decorative\)/i })
    expect(store).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(store)
    expect(store).toHaveAttribute('aria-pressed', 'true')
    expect(backend.events).toHaveLength(0)
    const filter = screen.getByRole('slider', { name: /Filter frequency \(decorative\)/i })
    fireEvent.change(filter, { target: { value: '83' } })
    expect(filter).toHaveValue('83')
    expect(backend.events).toHaveLength(0)
  })

  it('binds Phase 2 Piano, effects, sustain, and Master controls to canonical feedback', () => {
    const { container } = renderInstrument()
    const upright = screen.getByRole('button', { name: /Upright piano type/i })
    fireEvent.click(upright)
    expect(upright).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /Piano layer B/i }))
    expect(screen.getByRole('button', { name: /Effects focus Piano B/i })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /Delay on/i }))
    expect(screen.getByRole('button', { name: /Delay on/i })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /Sustain pedal off/i }))
    expect(screen.getByRole('button', { name: /Sustain pedal on/i })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.change(screen.getByRole('slider', { name: 'Master level' }), { target: { value: '31' } })
    expect(screen.getByRole('slider', { name: 'Master level' })).toHaveValue('31')
    expect(container.querySelectorAll('[data-functional="true"]').length).toBeGreaterThan(40)
  })

  it('plays and releases from pointer and mapped keyboard, then clears on blur', () => {
    const { backend, engine } = renderInstrument()
    const middleC = screen.getByRole('button', { name: 'C4 piano key' })
    fireEvent.pointerDown(middleC, { pointerId: 7, clientY: 10 })
    expect(engine.snapshot().activeNotes).toContain(60)
    fireEvent.pointerUp(middleC, { pointerId: 7 })
    expect(engine.snapshot().activeVoiceCount).toBe(0)
    fireEvent.keyDown(window, { code: 'KeyA' })
    fireEvent.keyDown(window, { code: 'KeyA', repeat: true })
    expect(backend.events.filter((event) => event.type === 'start')).toHaveLength(2)
    fireEvent.blur(window)
    expect(engine.snapshot().activeVoiceCount).toBe(0)
  })

  it('reports MIDI denial without claiming a connection', async () => {
    renderInstrument(vi.fn().mockRejectedValue(new Error('denied')))
    const midiButton = screen.getByRole('button', { name: 'MIDI not connected' })
    fireEvent.click(midiButton)
    expect(await screen.findByRole('button', { name: 'MIDI access denied' })).toBeInTheDocument()
  })

  it('uses semantic section labels for landmark navigation', () => {
    renderInstrument()
    const organ = screen.getByRole('region', { name: 'Organ section' })
    expect(within(organ).getByRole('heading', { name: 'Organ' })).toBeInTheDocument()
    expect(within(organ).getAllByRole('slider', { name: /Organ drawbar/ })).toHaveLength(9)
  })
})
