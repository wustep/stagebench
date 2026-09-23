// Whole-app lifecycle: truthful status, every input wired through one engine to audible output,
// and cleanup on blur / hidden tab / MIDI disconnect / unmount back to baseline.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Workbench } from '../App'
import { FakeMidiInput, makeTestRuntime, type TestRuntime } from '../testing/fakes'
import { rms } from '../testing/simAudio'

afterEach(cleanup)

const key = (midi: number) => document.querySelector<HTMLElement>(`[data-note="${midi}"]`)!
const keybed = () => document.querySelector<HTMLElement>('.keybed')!
const pressed = (midi: number) => key(midi).getAttribute('aria-pressed') === 'true'
const voiceStatus = () => screen.getByTestId('voice-status').textContent
const ctxOf = (runtime: TestRuntime) => runtime.contexts[0]

async function mountReady(runtime: TestRuntime = makeTestRuntime()) {
  const utils = render(<Workbench runtime={runtime} />)
  await waitFor(() => expect(voiceStatus()).toBe('Ready'))
  return { ...utils, runtime }
}

async function enableMidi() {
  fireEvent.click(screen.getByRole('button', { name: 'Enable MIDI input' }))
  await waitFor(() => expect(screen.getByTestId('midi-status').textContent).not.toMatch(/Requesting/))
}

describe('piano.basic-status-cleanup — truthful status', () => {
  it('shows loading, then ready, and claims recorded samples only for the bundled packs (Phase 2)', async () => {
    const runtime = makeTestRuntime()
    render(<Workbench runtime={runtime} />)
    // First render reports generation in progress (not ready).
    expect(voiceStatus()).toMatch(/Loading|Ready/)
    await waitFor(() => expect(voiceStatus()).toBe('Ready'))
    expect(screen.getByTestId('audio-status')).toHaveTextContent('Audio starts on your first key press')
    expect(document.body.textContent).toMatch(/Grand, Upright and Electric play bundled recorded samples; Clav, Digital\s+and Misc are synthesized/)
    expect(screen.getByTestId('voice-detail')).toHaveTextContent(/Clav, Digital and Misc are synthesized in the browser/)
    expect(document.getElementById('program-oled')).toHaveTextContent('Salamander Grand')
    expect(document.getElementById('program-oled')).toHaveTextContent('Samples')
    expect(document.getElementById('synth-oled')).toHaveTextContent('Not built until Phase 3')
  })

  it('without Web Audio it reports an error and keeps the keys visually playable but silent', async () => {
    const runtime = makeTestRuntime({ audio: false })
    render(<Workbench runtime={runtime} />)
    expect(voiceStatus()).toBe('Error — no sound')
    expect(screen.getByTestId('audio-status')).toHaveTextContent('Web Audio unavailable')
    expect(document.getElementById('program-oled')).toHaveTextContent('No Web Audio')
    fireEvent.pointerDown(key(60), { pointerId: 1, pointerType: 'touch' })
    expect(pressed(60)).toBe(true)
    expect(runtime.contexts).toHaveLength(0)
    fireEvent.pointerUp(keybed(), { pointerId: 1, pointerType: 'touch' })
  })

  it('reports a suspended context truthfully and resumes it on the first key press', async () => {
    const runtime = makeTestRuntime({ contextState: 'suspended' })
    await mountReady(runtime)
    fireEvent.pointerDown(key(60), { pointerId: 1, pointerType: 'mouse', button: 0 })
    await waitFor(() => expect(screen.getByTestId('audio-status')).toHaveTextContent('Audio output running'))
    fireEvent.pointerUp(keybed(), { pointerId: 1 })
  })

  it('MIDI status: unsupported, denied (with retry) and connected are all shown truthfully', async () => {
    render(<Workbench runtime={makeTestRuntime({ midi: 'unsupported' })} />)
    expect(screen.getByTestId('midi-status')).toHaveTextContent('Web MIDI is not supported in this browser.')
    expect(screen.queryByRole('button', { name: /Enable MIDI/ })).toBeNull()
    cleanup()

    const denied = makeTestRuntime({ midi: 'deny' })
    render(<Workbench runtime={denied} />)
    await enableMidi()
    expect(screen.getByTestId('midi-status')).toHaveTextContent('MIDI access denied (SecurityError: permission denied).')
    expect(screen.getByRole('button', { name: 'Retry MIDI' })).toBeInTheDocument()
    cleanup()

    const granted = makeTestRuntime()
    render(<Workbench runtime={granted} />)
    await enableMidi()
    expect(screen.getByTestId('midi-status')).toHaveTextContent('MIDI enabled — no input devices connected.')
    act(() => granted.midiAccess.add(new FakeMidiInput('k1', 'Stage Keys')))
    expect(screen.getByTestId('midi-status')).toHaveTextContent('MIDI connected: Stage Keys')
  })
})

describe('piano.basic-inputs — every input through the app reaches the audible piano', () => {
  it('pointer, touch, computer key and MIDI notes all sound and depress keys', async () => {
    const { runtime } = await mountReady()
    await enableMidi()
    const input = new FakeMidiInput('k1', 'Stage Keys')
    act(() => runtime.midiAccess.add(input))

    fireEvent.pointerDown(key(48), { pointerId: 1, pointerType: 'mouse', button: 0 })
    fireEvent.pointerDown(key(55), { pointerId: 2, pointerType: 'touch' })
    act(() => {
      runtime.window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }))
    })
    act(() => input.send([0x90, 72, 100]))
    expect([pressed(48), pressed(55), pressed(60), pressed(72)]).toEqual([true, true, true, true])
    expect(screen.getByTestId('voice-count')).toHaveTextContent('4 / 24 voices')
    expect(rms(ctxOf(runtime).render(0.2))).toBeGreaterThan(0.02)
  })

  it('the on-screen sustain toggle holds released notes', async () => {
    const { runtime } = await mountReady()
    fireEvent.click(screen.getByRole('button', { name: 'Sustain pedal up' }))
    expect(screen.getByTestId('voice-count')).toHaveTextContent('sustain down')
    fireEvent.pointerDown(key(60), { pointerId: 1, pointerType: 'mouse', button: 0 })
    fireEvent.pointerUp(keybed(), { pointerId: 1 })
    const ctx = ctxOf(runtime)
    ctx.render(0.5)
    expect(ctx.liveSourceCount()).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Sustain pedal down' }))
    ctx.render(1.5)
    expect(ctx.liveSourceCount()).toBe(0)
  })
})

describe('piano.basic-status-cleanup — cleanup returns to baseline', () => {
  it('window blur silences every owned voice from every input', async () => {
    const { runtime } = await mountReady()
    await enableMidi()
    const input = new FakeMidiInput('k1', 'Stage Keys')
    act(() => runtime.midiAccess.add(input))
    fireEvent.pointerDown(key(48), { pointerId: 1, pointerType: 'touch' })
    act(() => {
      runtime.window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }))
    })
    act(() => input.send([0x90, 72, 100]))
    const ctx = ctxOf(runtime)
    expect(ctx.liveSourceCount()).toBe(3)
    act(() => {
      runtime.window.dispatchEvent(new Event('blur'))
    })
    expect([pressed(48), pressed(60), pressed(72)]).toEqual([false, false, false])
    act(() => {
      ctx.render(0.5)
    })
    expect(ctx.liveSourceCount()).toBe(0)
    expect(rms(ctx.render(0.1))).toBe(0)
    await waitFor(() => expect(screen.getByTestId('voice-count')).toHaveTextContent('0 / 24 voices'))
  })

  it('a hidden tab silences everything', async () => {
    const { runtime } = await mountReady()
    fireEvent.pointerDown(key(60), { pointerId: 1, pointerType: 'touch' })
    act(() => {
      runtime.doc.visibilityState = 'hidden'
      runtime.doc.dispatchEvent(new Event('visibilitychange'))
    })
    expect(pressed(60)).toBe(false)
    const ctx = ctxOf(runtime)
    ctx.render(0.5)
    expect(ctx.liveSourceCount()).toBe(0)
  })

  it('MIDI disconnect releases that device’s notes and says so', async () => {
    const { runtime } = await mountReady()
    await enableMidi()
    const input = new FakeMidiInput('k1', 'Stage Keys')
    act(() => runtime.midiAccess.add(input))
    act(() => input.send([0x90, 64, 100]))
    expect(pressed(64)).toBe(true)
    act(() => runtime.midiAccess.disconnect('k1'))
    expect(pressed(64)).toBe(false)
    expect(screen.getByTestId('midi-status')).toHaveTextContent('MIDI input disconnected; its notes were released.')
  })

  it('all-notes-off button clears held notes and sustain', async () => {
    const { runtime } = await mountReady()
    fireEvent.click(screen.getByRole('button', { name: 'Sustain pedal up' }))
    fireEvent.pointerDown(key(60), { pointerId: 1, pointerType: 'touch' })
    fireEvent.click(screen.getByRole('button', { name: 'All notes off' }))
    expect(pressed(60)).toBe(false)
    expect(screen.getByTestId('voice-count')).not.toHaveTextContent('sustain down')
    const ctx = ctxOf(runtime)
    ctx.render(0.3)
    expect(ctx.liveSourceCount()).toBe(0)
  })

  it('unmount stops every voice, closes audio, detaches MIDI and removes every listener', async () => {
    const runtime = makeTestRuntime()
    const baseline = { window: runtime.window.listenerCount, doc: runtime.doc.listenerCount }
    const { unmount } = await mountReady(runtime)
    await enableMidi()
    const input = new FakeMidiInput('k1', 'Stage Keys')
    act(() => runtime.midiAccess.add(input))
    expect(runtime.window.listenerCount).toBeGreaterThan(baseline.window)
    fireEvent.pointerDown(key(60), { pointerId: 1, pointerType: 'touch' })
    act(() => {
      runtime.window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }))
    })
    act(() => input.send([0x90, 72, 100]))
    const ctx = ctxOf(runtime)
    expect(ctx.liveSourceCount()).toBe(3)

    unmount()

    expect(ctx.liveSourceCount()).toBe(0)
    expect(ctx.closed).toBe(true)
    expect(input.onmidimessage).toBeNull()
    expect(runtime.midiAccess.onstatechange).toBeNull()
    expect(runtime.window.listenerCount).toBe(baseline.window)
    expect(runtime.doc.listenerCount).toBe(baseline.doc)
    // Late events after unmount do nothing.
    input.send([0x90, 60, 100])
    runtime.window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }))
    expect(ctx.liveSourceCount()).toBe(0)
  })
})
