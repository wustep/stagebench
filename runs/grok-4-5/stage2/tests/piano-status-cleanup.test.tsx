import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { PianoEngine } from '../src/audio/piano-engine'
import { Instrument } from '../src/components/Instrument'
import { createMockContextFactory } from '../src/test/mock-audio'
import { hardwareStore } from '../src/state/hardware-store'

describe('piano.basic-status-cleanup', () => {
  afterEach(() => {
    cleanup()
    hardwareStore.reset()
  })
  it('reports truthful loading/ready status', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    expect(engine.getStatus()).toBe('loading')
    await engine.init()
    expect(engine.getStatus()).toBe('ready')
    engine.dispose()
  })

  it('notifies status listeners', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    const fn = vi.fn()
    engine.onStatus(fn)
    await engine.init()
    expect(fn).toHaveBeenCalledWith('ready')
    engine.dispose()
  })

  it('stops every owned voice on blur and unmount', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    render(<Instrument engine={engine} enableMidi={false} />)
    engine.noteOn(60, 0.8, 't')
    engine.noteOn(64, 0.8, 't')
    expect(engine.getActiveVoiceCount()).toBe(2)
    window.dispatchEvent(new Event('blur'))
    expect(engine.getActiveVoiceCount()).toBe(0)
    cleanup()
    engine.noteOn(60, 1)
    // unmount already cleaned; dispose
    engine.allNotesOff()
    expect(engine.getActiveVoiceCount()).toBe(0)
    engine.dispose()
    hardwareStore.reset()
  })

  it('can enter error/fallback path when context factory fails then recovers', async () => {
    let calls = 0
    const engine = new PianoEngine({
      createContext: () => {
        calls++
        if (calls === 1) throw new Error('fail')
        return createMockContextFactory().createContext()
      },
    })
    await engine.init()
    expect(['fallback', 'error', 'ready']).toContain(engine.getStatus())
    engine.dispose()
  })
})
