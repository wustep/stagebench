import { describe, expect, it } from 'vitest'
import { createHarness } from '../test-utils/fakes'
import { createInstrument } from './instrument'
import { STEAL_FADE_SECONDS } from './webAudioSink'

const settle = () => new Promise((r) => setTimeout(r, 0))

describe('piano.basic-status-cleanup', () => {
  it('starts idle and does not touch audio until a note is played', () => {
    const h = createHarness()
    const inst = createInstrument(h.deps)
    expect(inst.getSnapshot().audio.phase).toBe('idle')
    expect(h.contexts).toHaveLength(0)
    inst.dispose()
  })

  it('reports loading then ready when the browser allows audio', async () => {
    const h = createHarness({ audio: { state: 'suspended' } })
    const inst = createInstrument(h.deps)
    inst.lifecycle.noteOn('t', 60, 100)
    expect(inst.getSnapshot().audio.phase).toBe('loading')
    await settle()
    expect(inst.getSnapshot().audio.phase).toBe('ready')
    inst.dispose()
  })

  it('reports an error, keeps tracking keys and never throws when Web Audio is missing', () => {
    const h = createHarness({ audio: 'none' })
    const inst = createInstrument(h.deps)
    inst.lifecycle.noteOn('t', 60, 100)
    expect(inst.getSnapshot().audio.phase).toBe('error')
    expect(inst.getSnapshot().audio.message).toMatch(/unavailable/i)
    expect(inst.getSnapshot().pressed.has(60)).toBe(true)
    inst.lifecycle.noteOff('t')
    expect(inst.getSnapshot().voices).toBe(0)
    inst.dispose()
  })

  it('reports an error when the browser blocks resume()', async () => {
    const h = createHarness({ audio: { state: 'suspended', resumeRejects: true } })
    const inst = createInstrument(h.deps)
    inst.lifecycle.noteOn('t', 60, 100)
    await settle()
    expect(inst.getSnapshot().audio.phase).toBe('error')
    inst.dispose()
  })

  it('falls back to a labelled oscillator voice when buffers cannot be created', async () => {
    const h = createHarness({ audio: { failBuffers: true } })
    const inst = createInstrument(h.deps)
    inst.lifecycle.noteOn('t', 60, 100)
    // Phase 2: the recorded samples are decoded asynchronously; the failure is reported once it is known
    expect(inst.getSnapshot().audio.phase).toBe('loading')
    await settle()
    const audio = inst.getSnapshot().audio
    expect(audio.phase).toBe('fallback')
    expect(audio.message).toMatch(/fallback/i)
    const sources = h.ctx()!.voiceSources()
    expect(sources).toHaveLength(1)
    expect(sources[0].kind).toBe('oscillator')
    inst.dispose()
  })

  it('routes every voice through voice gain → master → limiter → destination', () => {
    const h = createHarness()
    const inst = createInstrument(h.deps)
    inst.lifecycle.noteOn('a', 60, 100)
    inst.lifecycle.noteOn('b', 64, 100)
    const ctx = h.ctx()!
    const sources = ctx.voiceSources()
    expect(sources).toHaveLength(2)
    for (const s of sources) expect(s.reachesDestination()).toBe(true)
    // the only node connected to the destination is the limiter
    const feeders = ctx.nodes.filter((n) => n.outputs.has(ctx.destination))
    expect(feeders.map((n) => n.kind)).toEqual(['compressor'])
    inst.dispose()
  })

  it('returns to baseline node/timer counts after notes end', () => {
    const h = createHarness()
    const inst = createInstrument(h.deps)
    // Phase 2: the persistent graph (layers, effects, master, limiter) is the baseline; voices come and go on top of it
    inst.wake()
    const ctx = h.ctx()!
    const baseline = ctx.liveNodes().length
    expect(baseline).toBeGreaterThan(2)
    inst.lifecycle.noteOn('a', 60, 100)
    inst.lifecycle.noteOn('b', 64, 100)
    expect(ctx.liveNodes().length).toBeGreaterThan(baseline)
    inst.lifecycle.noteOff('a')
    inst.lifecycle.noteOff('b')
    expect(h.scheduler.pending).toBe(2)
    h.scheduler.advance(2000)
    expect(h.scheduler.pending).toBe(0)
    expect(ctx.liveNodes()).toHaveLength(baseline)
    expect(inst.sink.liveVoiceCount()).toBe(0)
    expect(inst.getSnapshot().voices).toBe(0)
    inst.dispose()
  })

  it('release ramps the voice to silence over its release time; sustain delays it', () => {
    const h = createHarness()
    const inst = createInstrument(h.deps)
    inst.lifecycle.sustain('p', true)
    inst.lifecycle.noteOn('a', 60, 100)
    const ctx = h.ctx()!
    ctx.currentTime = 1
    inst.lifecycle.noteOff('a')
    // the voice envelope is the gain the source is connected to
    const gainOf = () => [...ctx.voiceSources()[0].outputs][0] as unknown as { gain: { events: Array<{ type: string; value: number; time: number }> } }
    // sustained: no ramp to zero yet
    expect(gainOf().gain.events.some((e) => e.type === 'ramp' && e.value === 0)).toBe(false)
    ctx.currentTime = 2
    inst.lifecycle.sustain('p', false)
    const ramp = gainOf().gain.events.find((e) => e.type === 'ramp' && e.value === 0)
    expect(ramp).toBeDefined()
    expect(ramp!.time).toBeGreaterThan(2.1)
    expect(ramp!.time).toBeLessThan(3)
    inst.dispose()
  })

  it('stolen voices fade quickly and free their nodes', () => {
    const h = createHarness()
    const inst = createInstrument(h.deps)
    for (let n = 0; n < 26; n++) inst.lifecycle.noteOn(`s${n}`, 40 + (n % 30), 100)
    expect(inst.getSnapshot().voices).toBe(24)
    h.scheduler.advance(STEAL_FADE_SECONDS * 1000 + 100)
    expect(inst.sink.liveVoiceCount()).toBe(24)
    inst.dispose()
  })

  it('blur / hidden / pagehide stop every voice and clear pedals', () => {
    for (const trigger of ['blur', 'pagehide', 'hidden'] as const) {
      const h = createHarness()
      const inst = createInstrument(h.deps)
      inst.lifecycle.noteOn('a', 60, 100)
      inst.lifecycle.sustain('p', true)
      if (trigger === 'hidden') {
        h.doc.visibilityState = 'hidden'
        h.doc.emit('visibilitychange')
      } else h.win.emit(trigger)
      expect(inst.getSnapshot().voices).toBe(0)
      expect(inst.getSnapshot().sustain).toBe(false)
      expect(inst.getSnapshot().pressed.size).toBe(0)
      h.scheduler.advance(500)
      expect(inst.sink.liveVoiceCount()).toBe(0)
      inst.dispose()
    }
  })

  it('unmount stops every voice, closes the context and removes every listener and timer', () => {
    const h = createHarness()
    const baselineListeners = h.keys.count() + h.win.count() + h.doc.count()
    const inst = createInstrument(h.deps)
    expect(h.keys.count() + h.win.count() + h.doc.count()).toBeGreaterThan(baselineListeners)
    inst.lifecycle.noteOn('a', 60, 100)
    inst.lifecycle.noteOn('b', 64, 100)
    inst.lifecycle.noteOff('a')
    const ctx = h.ctx()!
    inst.dispose()
    expect(ctx.closed).toBe(true)
    expect(ctx.liveNodes()).toHaveLength(0)
    expect(h.scheduler.pending).toBe(0)
    expect(h.keys.count() + h.win.count() + h.doc.count()).toBe(baselineListeners)
    expect(inst.lifecycle.listenerCount()).toBe(0)
  })

  it('dispose is idempotent', () => {
    const h = createHarness()
    const inst = createInstrument(h.deps)
    inst.dispose()
    expect(() => inst.dispose()).not.toThrow()
  })
})
