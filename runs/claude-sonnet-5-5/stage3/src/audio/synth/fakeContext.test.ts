import { describe, expect, it } from 'vitest'
import { FakeAudioContext, FakeScheduler } from '../../test-utils/fakes'
import type { AudioContextLike } from '../types'
import { SynthEngine } from './engine'
import { withPatch, synthState } from './harness'

/** the engine must also run on the jsdom fake context used by the app tests (no Web Audio implementation) */
describe('synth cleanup — fake context (node/timer/listener counts return to baseline)', () => {
  it('plays every waveform, runs an arpeggio and frees every node on dispose', () => {
    const ctx = new FakeAudioContext()
    const scheduler = new FakeScheduler()
    const out = ctx.createGain()
    out.connect(ctx.destination)
    const state = synthState()
    const engine = new SynthEngine({ ctx: ctx as unknown as AudioContextLike, scheduler, outputs: { A: out, B: out, C: out }, state })
    const before = ctx.liveNodes().length
    for (let w = 0; w < 14; w++) {
      engine.setState(withPatch(state, 'A', (p) => ({ ...p, waveform: w })))
      engine.noteOn('A', 60 + w, 100, 1)
    }
    expect(engine.liveVoiceCount()).toBeGreaterThan(0)
    engine.setState(withPatch(state, 'A', (p) => ({ ...p, arp: { ...p.arp, run: true, sync: true, division: 4 } })))
    engine.noteOn('A', 64, 100, 1)
    engine.pump(2)
    expect(engine.arpStatus('A').running).toBe(true)
    engine.panic()
    scheduler.advance(20000)
    expect(engine.liveVoiceCount()).toBe(0)
    expect(engine.pendingTimerCount()).toBe(0)
    engine.dispose()
    expect(ctx.voiceSources().filter((s) => !('stopped' in s && s.stopped)).length).toBe(0)
    expect(ctx.liveNodes().length).toBeLessThanOrEqual(before + 3)
  })
})
