import { fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { deniedMidiBoundary, FakePort } from '../test/fakes'
import { renderApp } from '../test/renderApp'

function key(midi: number): HTMLElement {
  return document.querySelector(`[data-control-id="key-${midi}"]`) as HTMLElement
}

function statusOf(testId: string): string {
  return document.querySelector(`[data-testid="${testId}"]`)?.getAttribute('data-status') ?? ''
}

describe('piano.basic-inputs — all input paths feed one lifecycle', () => {
  it('pointer input plays a voice with pressure-position velocity fallback', () => {
    const { getContext } = renderApp()
    fireEvent.pointerDown(key(60), { pointerId: 1 })
    const context = getContext()!
    expect(context.oscillators().length).toBeGreaterThan(0)
    expect(context.oscillators().every((o) => o.started)).toBe(true)
    fireEvent.pointerUp(key(60), { pointerId: 1 })
  })

  it('independent multi-touch drives independent voices', () => {
    const { getContext } = renderApp()
    fireEvent.pointerDown(key(60), { pointerId: 21, pointerType: 'touch' })
    fireEvent.pointerDown(key(64), { pointerId: 22, pointerType: 'touch' })
    fireEvent.pointerDown(key(67), { pointerId: 23, pointerType: 'touch' })
    const context = getContext()!
    const perVoice = context.oscillators().length / 3
    expect(perVoice).toBeGreaterThanOrEqual(1)
    fireEvent.pointerUp(key(64), { pointerId: 22, pointerType: 'touch' })
    // The other two keys must still be held.
    expect(key(60).dataset.pressed).toBe('true')
    expect(key(67).dataset.pressed).toBe('true')
  })

  it('computer keyboard maps A/W/S/… to notes with repeat suppression and blur cleanup', () => {
    const { getContext } = renderApp()
    fireEvent.keyDown(window, { code: 'KeyA' })
    fireEvent.keyDown(window, { code: 'KeyS' })
    const count = getContext()!.oscillators().length
    fireEvent.keyDown(window, { code: 'KeyA', repeat: true })
    expect(getContext()!.oscillators().length).toBe(count)
    fireEvent.blur(window)
    expect(key(60).dataset.pressed).toBe('false')
    expect(key(62).dataset.pressed).toBe('false')
  })

  it('space bar sustain holds notes released while the pedal is down', () => {
    renderApp()
    fireEvent.keyDown(window, { code: 'Space' })
    fireEvent.keyDown(window, { code: 'KeyA' })
    fireEvent.keyUp(window, { code: 'KeyA' })
    // Key visual returns up but the voice sustains inside the engine.
    expect(key(60).dataset.pressed).toBe('false')
    fireEvent.keyUp(window, { code: 'Space' })
  })

  it('MIDI note/velocity input plays and visibly depresses keys', async () => {
    const { midiAccess } = renderApp()
    await waitFor(() => expect(statusOf('midi-status')).toBe('no-device'))
    const port = new FakePort('dev1', 'Fake 73')
    midiAccess.addPort(port)
    await waitFor(() => expect(statusOf('midi-status')).toBe('connected'))

    port.emit([0x90, 60, 100])
    await waitFor(() => expect(key(60).dataset.pressed).toBe('true'))
    port.emit([0x80, 60, 0])
    await waitFor(() => expect(key(60).dataset.pressed).toBe('false'))
  })

  it('MIDI sustain CC64 feeds the same sustain path as the space bar', async () => {
    const { midiAccess, getContext, timers } = renderApp()
    await waitFor(() => expect(statusOf('midi-status')).toBe('no-device'))
    const port = new FakePort('dev1', 'Fake 73')
    midiAccess.addPort(port)
    await waitFor(() => expect(statusOf('midi-status')).toBe('connected'))

    port.emit([0xb0, 64, 127])
    port.emit([0x90, 62, 90])
    port.emit([0x80, 62, 0])
    // Sustained: no oscillator has been asked to stop yet.
    expect(getContext()!.oscillators().some((o) => o.stopped)).toBe(false)
    port.emit([0xb0, 64, 0])
    await waitFor(() => expect(getContext()!.oscillators().every((o) => o.stopped)).toBe(true))
    timers.advance(3000)
  })

  it('MIDI disconnect cleans up owned notes and reports the state truthfully', async () => {
    const { midiAccess } = renderApp()
    await waitFor(() => expect(statusOf('midi-status')).toBe('no-device'))
    const port = new FakePort('dev1', 'Fake 73')
    midiAccess.addPort(port)
    await waitFor(() => expect(statusOf('midi-status')).toBe('connected'))

    port.emit([0x90, 60, 100])
    await waitFor(() => expect(key(60).dataset.pressed).toBe('true'))
    midiAccess.removePort(port)
    await waitFor(() => expect(statusOf('midi-status')).toBe('disconnected'))
    expect(key(60).dataset.pressed).toBe('false')
  })

  it('denied MIDI permission is reported without breaking other inputs', async () => {
    const { getContext } = renderApp(deniedMidiBoundary())
    await waitFor(() => expect(statusOf('midi-status')).toBe('denied'))
    fireEvent.pointerDown(key(60), { pointerId: 1 })
    expect(getContext()!.oscillators().length).toBeGreaterThan(0)
    fireEvent.pointerUp(key(60), { pointerId: 1 })
  })

  it('unsupported Web MIDI is reported truthfully', async () => {
    renderApp({})
    await waitFor(() => expect(statusOf('midi-status')).toBe('unsupported'))
  })

  it('unmount cleans up: no voices survive after the app is removed', () => {
    const { view, getContext, timers } = renderApp()
    fireEvent.pointerDown(key(60), { pointerId: 1 })
    view.unmount()
    timers.advance(3000)
    const context = getContext()!
    expect(context.oscillators().every((o) => o.stopped)).toBe(true)
    expect(context.closed).toBe(true)
  })
})
