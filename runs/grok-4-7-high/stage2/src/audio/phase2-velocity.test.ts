import { fireEvent, screen } from '@testing-library/react'
import { OfflineAudioContext } from 'node-web-audio-api'
import { describe, expect, it } from 'vitest'
import { ManualTimers, type AudioBoundary, type AudioContextLike } from './boundaries'
import type { PianoEngine } from './engine'
import { renderApp } from '../test/renderApp'
import { meanAbsDiff, renderPiano, rms, zeroCrossings } from '../test/renderAudio'

async function note(setup: (engine: PianoEngine) => void, seconds = 0.45) {
  return renderPiano((engine) => {
    setup(engine)
    engine.noteOn(60, 0.35)
  }, seconds)
}

describe('piano.velocity-controls', () => {
  it('makes KB Touch, Dyn Comp, and Master Level move the rendered level', async () => {
    const heavy = await note((engine) => engine.setKbTouch('Heavy'))
    const light = await note((engine) => engine.setKbTouch('Light'))
    expect(rms(light.channel, 400, 6000)).toBeGreaterThan(rms(heavy.channel, 400, 6000) * 1.4)

    const plain = await renderPiano((engine) => engine.noteOn(60, 0.18), 0.4)
    const compressed = await renderPiano((engine) => {
      engine.setDynComp(3)
      engine.noteOn(60, 0.18)
    }, 0.4)
    expect(rms(compressed.channel, 400, 6000)).toBeGreaterThan(rms(plain.channel, 400, 6000) * 1.5)

    const quiet = await renderPiano((engine) => {
      engine.setMasterLevel(20)
      engine.noteOn(64, 0.8)
    }, 0.35)
    const loud = await renderPiano((engine) => {
      engine.setMasterLevel(100)
      engine.noteOn(64, 0.8)
    }, 0.35)
    expect(rms(loud.channel, 400, 5000)).toBeGreaterThan(rms(quiet.channel, 400, 5000) * 2)
  })

  it('makes Timbre, Unison, Soft Release, and String Res change the signal', async () => {
    const soft = await renderPiano((engine) => {
      engine.setFocusedTimbre('Soft')
      engine.noteOn(60, 0.85)
    }, 0.4)
    const bright = await renderPiano((engine) => {
      engine.setFocusedTimbre('Bright')
      engine.noteOn(60, 0.85)
    }, 0.4)
    expect(meanAbsDiff(soft.channel, bright.channel)).toBeGreaterThan(0.01)
    expect(zeroCrossings(bright.channel, 500, 4000)).not.toBe(zeroCrossings(soft.channel, 500, 4000))

    const single = await renderPiano((engine) => engine.noteOn(60, 0.8), 0.5)
    const unison = await renderPiano((engine) => {
      engine.setFocusedUnison(3)
      engine.noteOn(60, 0.8)
    }, 0.5)
    expect(meanAbsDiff(single.channel, unison.channel)).toBeGreaterThan(0.01)

    const short = await renderPiano((engine) => {
      engine.noteOn(60, 0.8)
      engine.noteOff(60, 0.1)
    }, 0.9)
    const long = await renderPiano((engine) => {
      engine.setFocusedSoftRelease(true)
      engine.noteOn(60, 0.8)
      engine.noteOff(60, 0.1)
    }, 0.9)
    expect(rms(long.channel, 18000, 28000)).toBeGreaterThan(rms(short.channel, 18000, 28000) * 1.3)

    const dry = await renderPiano((engine) => {
      engine.setSustain(true)
      engine.noteOn(60, 0.75)
    }, 0.5)
    const resonant = await renderPiano((engine) => {
      engine.setSustain(true)
      engine.setFocusedStringRes(true)
      engine.noteOn(60, 0.75)
    }, 0.5)
    expect(meanAbsDiff(dry.channel, resonant.channel)).toBeGreaterThan(0.004)
  })

  it('keeps Master Level and KB Touch panel values in agreement with the engine', () => {
    let engine: PianoEngine | null = null
    const timers = new ManualTimers()
    const context = new OfflineAudioContext(1, 44100, 44100)
    const audio: AudioBoundary = { createContext: () => context as unknown as AudioContextLike, timers }
    renderApp({
      audio,
      onEngine: (created) => {
        engine = created
      },
    })
    const master = screen.getByRole('slider', { name: 'Master Level' })
    fireEvent.keyDown(master, { key: 'ArrowDown' })
    expect(engine!.getMasterLevel()).toBe(Number(master.getAttribute('aria-valuenow')))
    const touch = screen.getByRole('button', { name: 'KB Touch Select' })
    fireEvent.click(touch)
    expect(touch).toHaveAttribute('data-cycle', '2')
    expect(engine!.getKbTouch()).toBe('Light')
    const timbre = screen.getByRole('button', { name: 'Piano Timbre Select' })
    fireEvent.click(timbre)
    expect(engine!.getLayer('A').timbre).toBe('Soft')
    expect(screen.getByTestId('engine-status')).toHaveAttribute('data-status', 'idle')
  })
})
