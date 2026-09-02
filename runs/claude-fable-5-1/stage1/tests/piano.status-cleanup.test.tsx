import { act, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PianoEngine } from '../src/audio/engine'
import { FakeAudioContext, FakeTimers } from '../src/audio/fakeAudio'
import { keyEl, mountApp, quickRenderer, type Mounted } from './helpers'

let mounted: Mounted | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
})

describe('piano.basic-status-cleanup — truthful status and complete cleanup', () => {
  it('reports idle → loading → ready as the generated bank renders', async () => {
    const ctx = new FakeAudioContext(48000)
    const timers = new FakeTimers()
    const engine = new PianoEngine({ createContext: () => ctx, timers, renderer: quickRenderer, warmNotes: [60, 62, 64] })
    const seen: string[] = []
    engine.subscribe(() => seen.push(engine.getStatus().state))
    expect(engine.getStatus()).toMatchObject({ state: 'idle', voiceSource: 'none', contextState: null })
    await engine.start()
    expect(engine.getStatus()).toMatchObject({ state: 'loading', warmed: 0, warmTotal: 3, sampleRate: 48000, contextState: 'running' })
    timers.runNext()
    expect(engine.getStatus()).toMatchObject({ state: 'loading', warmed: 1 })
    timers.runNext()
    expect(engine.getStatus()).toMatchObject({ state: 'loading', warmed: 2 })
    timers.flush()
    expect(engine.getStatus()).toMatchObject({ state: 'ready', warmed: 3, voiceSource: 'generated-buffers' })
    expect(engine.getStatus().message).toMatch(/generated/i)
    expect(engine.getStatus().message).toMatch(/not a recording/i)
    expect(seen).toContain('loading')
    expect(seen.at(-1)).toBe('ready')
    expect(ctx.resumeCalls).toBe(1)
  })

  it('reports error when no audio context can be created, while keys still show presses', async () => {
    mounted = await mountApp({ audio: 'unavailable' })
    fireEvent.pointerDown(keyEl(60), { pointerId: 1, button: 0 })
    expect(keyEl(60)).toHaveAttribute('aria-pressed', 'true')
    expect(mounted.services.engine.getStatus()).toMatchObject({ state: 'error', voiceSource: 'none' })
    expect(document.getElementById('audio-status')?.dataset.state).toBe('error')
    expect(document.getElementById('audio-message')?.textContent).toMatch(/Audio unavailable/)
    expect(mounted.services.engine.activeVoices()).toEqual([])
    fireEvent.pointerUp(keyEl(60), { pointerId: 1 })
  })

  it('falls back to a labelled oscillator tone when the piano renderer fails', async () => {
    const ctx = new FakeAudioContext(48000)
    const timers = new FakeTimers()
    const engine = new PianoEngine({
      createContext: () => ctx,
      timers,
      warmNotes: [60],
      renderer: () => {
        throw new Error('bank exploded')
      },
    })
    await engine.start()
    timers.flush()
    expect(engine.getStatus()).toMatchObject({ state: 'fallback', voiceSource: 'fallback-oscillator' })
    expect(engine.getStatus().message).toMatch(/fallback/i)
    engine.noteOn(60, 100)
    expect(engine.activeVoices()[0].kind).toBe('fallback')
    expect(ctx.oscillators()).toHaveLength(1)
    expect(ctx.oscillators()[0].reachesDestination()).toBe(true)
    engine.noteOff(60)
    ctx.advance(1)
    expect(engine.activeVoices()).toEqual([])
    expect(engine.metrics().liveNodes).toBe(1)
  })

  it('the status strip and program display mirror the engine and MIDI state', async () => {
    mounted = await mountApp()
    expect(document.getElementById('audio-status')?.dataset.state).toBe('idle')
    expect(document.getElementById('midi-status')?.dataset.state).toBe('ready')
    await act(async () => {
      fireEvent.click(document.getElementById('start-audio')!)
    })
    expect(document.getElementById('audio-status')?.dataset.state).toBe('loading')
    await act(async () => {
      mounted!.world.timers.flush()
    })
    expect(document.getElementById('audio-status')?.dataset.state).toBe('ready')
    expect(document.getElementById('program.oled')?.textContent).toMatch(/Audio ready/)
    expect(document.getElementById('program.oled')?.textContent).toMatch(/MIDI ready/)
  })

  it('window blur stops every owned voice', async () => {
    mounted = await mountApp()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }))
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS' }))
    })
    expect(mounted.services.engine.activeVoices().filter((v) => !v.releasing)).toHaveLength(2)
    await act(async () => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(mounted.services.engine.activeVoices().every((v) => v.releasing)).toBe(true)
    mounted.world.ctx.advance(1)
    expect(mounted.services.engine.activeVoices()).toEqual([])
  })

  it('a MIDI disconnect releases the notes and sustain the device was holding', async () => {
    mounted = await mountApp()
    await act(async () => {
      mounted!.world.input.send([0xb0, 64, 127])
      mounted!.world.input.send([0x90, 60, 100])
      mounted!.world.input.send([0x90, 64, 100])
    })
    expect(mounted.services.bus.heldNotes()).toEqual([60, 64])
    expect(mounted.services.engine.isSustain()).toBe(true)
    await act(async () => {
      mounted!.world.access.disconnect(mounted!.world.input)
    })
    expect(mounted.services.midi.getStatus().state).toBe('disconnected')
    expect(mounted.services.bus.heldNotes()).toEqual([])
    expect(mounted.services.engine.isSustain()).toBe(false)
    expect(mounted.services.engine.activeVoices().every((v) => v.releasing)).toBe(true)
  })

  it('unmount stops every voice, disconnects the master path, closes the context and detaches listeners', async () => {
    mounted = await mountApp()
    fireEvent.pointerDown(keyEl(60), { pointerId: 1, button: 0 })
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }))
    })
    const { engine, bus } = mounted.services
    const ctx = mounted.world.ctx
    expect(engine.activeVoices()).toHaveLength(2)
    mounted.unmount()
    mounted = null
    expect(engine.activeVoices()).toEqual([])
    expect(engine.metrics()).toMatchObject({ activeVoices: 0, liveNodes: 0, hasContext: false })
    expect(ctx.liveNodes()).toEqual([])
    expect(ctx.state).toBe('closed')
    expect(bus.heldNotes()).toEqual([])
    // keyboard listeners are gone: a key press after unmount reaches nothing
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }))
    expect(bus.heldNotes()).toEqual([])
    expect(engine.activeVoices()).toEqual([])
  })
})
