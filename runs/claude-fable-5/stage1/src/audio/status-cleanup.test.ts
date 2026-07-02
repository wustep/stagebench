import { describe, expect, it } from 'vitest'
import { fakeAudioBoundary } from '../test/fakes'
import { PianoEngine, type EngineStatusInfo } from './engine'
import { InstrumentController } from '../input/controller'

describe('piano.basic-status-cleanup', () => {
  it('reports idle before the first gesture, then loading and ready', () => {
    const { boundary } = fakeAudioBoundary()
    const engine = new PianoEngine(boundary)
    const seen: EngineStatusInfo[] = []
    engine.subscribe((info) => seen.push(info))
    expect(seen[0]!.status).toBe('idle')
    engine.ensureStarted()
    expect(seen.map((s) => s.status)).toEqual(['idle', 'loading', 'ready'])
    expect(engine.getStatus().message).toMatch(/generated synthesis/i)
  })

  it('reports a truthful error when the context cannot be created', () => {
    const { boundary } = fakeAudioBoundary({ failContext: true })
    const engine = new PianoEngine(boundary)
    engine.noteOn(60, 0.8)
    expect(engine.getStatus().status).toBe('error')
    expect(engine.getStatus().message).toMatch(/unavailable/i)
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('enters a truthful fallback when the preferred graph fails', () => {
    const { boundary, getContext } = fakeAudioBoundary({ failCompressor: true })
    const engine = new PianoEngine(boundary)
    engine.ensureStarted()
    expect(engine.getStatus().status).toBe('fallback')
    expect(engine.getStatus().message).toMatch(/reduced audio path/i)
    // The fallback still plays real notes into the destination.
    engine.noteOn(60, 0.8)
    expect(engine.heldVoiceCount()).toBe(1)
    expect(getContext()!.oscillators().every((o) => o.reachesDestination())).toBe(true)
  })

  it('reports a hard error when even the fallback graph fails', () => {
    const { boundary } = fakeAudioBoundary({ failGains: true })
    const engine = new PianoEngine(boundary)
    engine.ensureStarted()
    expect(engine.getStatus().status).toBe('error')
  })

  it('controller blur cleanup stops every owned voice without any panel button', () => {
    const { boundary, timers } = fakeAudioBoundary()
    const engine = new PianoEngine(boundary)
    const controller = new InstrumentController(engine)
    controller.noteOn(60, 0.8, 'keyboard')
    controller.noteOn(64, 0.8, 'pointer')
    controller.setSustain(true)
    controller.allNotesOff('blur')
    expect(controller.heldNotes()).toEqual([])
    expect(engine.isSustainDown()).toBe(false)
    timers.advance(2000)
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('unmount dispose stops voices immediately and closes the context', () => {
    const { boundary, getContext } = fakeAudioBoundary()
    const engine = new PianoEngine(boundary)
    const controller = new InstrumentController(engine)
    controller.noteOn(60, 0.8, 'midi')
    controller.setSustain(true)
    controller.noteOff(60, 'midi')
    controller.dispose()
    expect(engine.activeVoiceCount()).toBe(0)
    expect(getContext()!.closed).toBe(true)
    expect(engine.getStatus().status).toBe('idle')
  })

  it('per-source cleanup releases only notes owned by that source', () => {
    const { boundary } = fakeAudioBoundary()
    const engine = new PianoEngine(boundary)
    const controller = new InstrumentController(engine)
    controller.noteOn(60, 0.8, 'keyboard')
    controller.noteOn(64, 0.8, 'pointer')
    controller.releaseSource('keyboard')
    expect(controller.isNoteHeld(60)).toBe(false)
    expect(controller.isNoteHeld(64)).toBe(true)
  })

  it('a note held by two sources is released only after both let go', () => {
    const { boundary } = fakeAudioBoundary()
    const engine = new PianoEngine(boundary)
    const controller = new InstrumentController(engine)
    controller.noteOn(60, 0.8, 'keyboard')
    controller.noteOn(60, 0.8, 'midi')
    controller.noteOff(60, 'keyboard')
    expect(controller.isNoteHeld(60)).toBe(true)
    controller.noteOff(60, 'midi')
    expect(controller.isNoteHeld(60)).toBe(false)
  })

  it('ignores notes outside the 73-key E1–E7 range', () => {
    const { boundary } = fakeAudioBoundary()
    const controller = new InstrumentController(new PianoEngine(boundary))
    controller.noteOn(27, 0.8, 'midi')
    controller.noteOn(101, 0.8, 'midi')
    expect(controller.heldNotes()).toEqual([])
  })
})
