import { describe, expect, it } from 'vitest'
import { fakeAssetBoundary, fakeAudioBoundary } from '../test/fakes'
import { PianoEngine, type EngineStatusInfo } from './engine'
import { InstrumentController } from '../input/controller'

function makeEngine(options: Parameters<typeof fakeAudioBoundary>[0] = {}, assets = fakeAssetBoundary()) {
  const setup = fakeAudioBoundary(options)
  const engine = new PianoEngine(setup.boundary, { assets })
  return { ...setup, engine }
}

describe('piano.basic-status-cleanup', () => {
  it('reports idle before the first gesture, then loading and ready with recorded-sample truth', () => {
    const { engine } = makeEngine()
    const seen: EngineStatusInfo[] = []
    engine.subscribe((info) => seen.push(info))
    expect(seen[0]!.status).toBe('idle')
    engine.ensureStarted()
    const sequence = seen.map((s) => s.status).filter((status, i, all) => i === 0 || status !== all[i - 1])
    expect(sequence[0]).toBe('idle')
    expect(sequence).toContain('loading')
    expect(sequence[sequence.length - 1]).toBe('ready')
    expect(engine.getStatus().message).toMatch(/recorded samples/i)
    expect(engine.getStatus().message).toMatch(/Salamander Grand/)
  })

  it('reports a truthful error when the context cannot be created', () => {
    const { engine } = makeEngine({ failContext: true })
    engine.noteOn(60, 0.8)
    expect(engine.getStatus().status).toBe('error')
    expect(engine.getStatus().message).toMatch(/unavailable/i)
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('enters the labeled synthesized fallback when the sample library fails to load', () => {
    const { engine, getContext } = makeEngine({}, fakeAssetBoundary({ fail: true }))
    engine.ensureStarted()
    const context = getContext()!
    context.markStandingGraph()
    expect(engine.getStatus().status).toBe('fallback')
    expect(engine.getStatus().message).toMatch(/FALLBACK/)
    expect(engine.getStatus().message).toMatch(/synthesized/i)
    // The fallback still plays — oscillator voices with a real path out.
    engine.noteOn(60, 0.8)
    expect(engine.heldVoiceCount()).toBe(1)
    const voiceOscillators = context.voiceSources()
    expect(voiceOscillators.length).toBeGreaterThan(0)
    expect(voiceOscillators.every((o) => o.reachesDestination())).toBe(true)
  })

  it('falls back to a reduced audio path when the preferred graph fails, still playable', () => {
    const { engine, getContext } = makeEngine({ failFilters: true })
    engine.ensureStarted()
    const context = getContext()!
    context.markStandingGraph()
    expect(engine.getStatus().status).toBe('fallback')
    expect(engine.getStatus().message).toMatch(/reduced audio path/i)
    engine.noteOn(60, 0.8)
    expect(engine.heldVoiceCount()).toBe(1)
    const voiceOscillators = context.voiceSources()
    expect(voiceOscillators.length).toBeGreaterThan(0)
    expect(voiceOscillators.every((o) => o.reachesDestination())).toBe(true)
  })

  it('stays ready without a master limiter and says so (no silent degradation)', () => {
    const { engine } = makeEngine({ failCompressor: true })
    engine.ensureStarted()
    expect(engine.getStatus().status).toBe('ready')
    expect(engine.getStatus().message).toMatch(/no master limiter/i)
  })

  it('reports a hard error when even the fallback graph fails', () => {
    const { engine } = makeEngine({ failGains: true })
    engine.ensureStarted()
    expect(engine.getStatus().status).toBe('error')
  })

  it('controller blur cleanup stops every owned voice without any panel button', () => {
    const { engine, timers } = makeEngine()
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
    const { engine, getContext } = makeEngine()
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
    const { engine } = makeEngine()
    const controller = new InstrumentController(engine)
    controller.noteOn(60, 0.8, 'keyboard')
    controller.noteOn(64, 0.8, 'pointer')
    controller.releaseSource('keyboard')
    expect(controller.isNoteHeld(60)).toBe(false)
    expect(controller.isNoteHeld(64)).toBe(true)
  })

  it('a note held by two sources is released only after both let go', () => {
    const { engine } = makeEngine()
    const controller = new InstrumentController(engine)
    controller.noteOn(60, 0.8, 'keyboard')
    controller.noteOn(60, 0.8, 'midi')
    controller.noteOff(60, 'keyboard')
    expect(controller.isNoteHeld(60)).toBe(true)
    controller.noteOff(60, 'midi')
    expect(controller.isNoteHeld(60)).toBe(false)
  })

  it('ignores notes outside the 73-key E1–E7 range', () => {
    const { engine } = makeEngine()
    const controller = new InstrumentController(engine)
    controller.noteOn(27, 0.8, 'midi')
    controller.noteOn(101, 0.8, 'midi')
    expect(controller.heldNotes()).toEqual([])
  })
})
