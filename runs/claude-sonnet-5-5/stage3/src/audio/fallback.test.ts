import { describe, expect, it } from 'vitest'
import { createEngineStore, defaultState, setType } from '../engine/state'
import { createHarness } from '../test-utils/fakes'
import { createInstrument } from './instrument'

const settle = () => new Promise((r) => setTimeout(r, 0))
const layersWith = (patch: object) => {
  const s = defaultState()
  return { ...s, layers: { ...s.layers, A: { ...s.layers.A, ...patch } } }
}

describe('piano.fallback — asset failure enters a labelled, playable fallback', () => {
  it('reports ready only after the recorded set has really loaded and decoded', async () => {
    const h = createHarness()
    const inst = createInstrument(h.deps)
    inst.lifecycle.noteOn('a', 60, 100)
    expect(inst.getSnapshot().audio.phase).toBe('loading')
    expect(inst.getSnapshot().audio.message).toMatch(/Loading recorded samples/)
    expect(inst.getSnapshot().models.A.phase).toBe('loading')
    await settle()
    await settle()
    expect(inst.getSnapshot().audio.phase).toBe('ready')
    expect(inst.getSnapshot().audio.message).toMatch(/Salamander Grand \(recorded samples\)/)
    expect(inst.getSnapshot().models.A).toMatchObject({ phase: 'ready', loaded: 90, total: 90 })
    expect(h.loaded.length).toBe(90)
    expect(h.loaded.every((u) => u.startsWith('samples/grand-salamander/'))).toBe(true)
    inst.dispose()
  })

  it('a missing file puts the app in a labelled fallback, keeps it playable, and never says ready', async () => {
    const h = createHarness({ samples: 'missing' })
    const inst = createInstrument(h.deps)
    inst.lifecycle.noteOn('a', 60, 100)
    // playable immediately, from the generated stand-in
    expect(inst.sink.liveVoices()).toEqual([expect.objectContaining({ origin: 'generated' })])
    await settle()
    await settle()
    const audio = inst.getSnapshot().audio
    expect(audio.phase).toBe('fallback')
    expect(audio.message).toMatch(/Piano not found: Salamander Grand/)
    expect(audio.message).toMatch(/Fallback voice: generated additive piano/)
    expect(inst.getSnapshot().models.A.phase).toBe('error')
    inst.lifecycle.noteOn('b', 64, 100)
    expect(inst.sink.liveVoices().map((v) => v.origin)).toEqual(['generated', 'generated'])
    const sources = h.ctx()!.voiceSources()
    expect(sources.length).toBe(2)
    for (const s of sources) expect(s.reachesDestination()).toBe(true)
    // never becomes "ready" by itself
    await settle()
    expect(inst.getSnapshot().audio.phase).toBe('fallback')
    inst.dispose()
  })

  it('a decode failure is handled the same way, and a plain oscillator remains if generated buffers are impossible too', async () => {
    const decode = createHarness({ audio: { failDecode: true } })
    const a = createInstrument(decode.deps)
    a.lifecycle.noteOn('a', 60, 100)
    await settle()
    await settle()
    expect(a.getSnapshot().audio.phase).toBe('fallback')
    expect(a.sink.liveVoices()[0].origin).toBe('generated')
    a.dispose()
    const none = createHarness({ audio: { failBuffers: true } })
    const b = createInstrument(none.deps)
    b.lifecycle.noteOn('a', 60, 100)
    await settle()
    await settle()
    expect(b.getSnapshot().audio.phase).toBe('fallback')
    expect(b.getSnapshot().audio.message).toMatch(/plain oscillator/)
    expect(b.sink.liveVoices().map((v) => v.origin)).toEqual(['oscillator'])
    b.dispose()
  })

  it('synthesised types do not depend on the sample files, and a failing model does not block the other layer', async () => {
    const h = createHarness({ samples: 'missing' })
    const state = createEngineStore(setType(defaultState(), 'Clav'))
    const inst = createInstrument(h.deps, state)
    inst.lifecycle.noteOn('a', 60, 100)
    await settle()
    await settle()
    expect(inst.getSnapshot().audio.phase).toBe('ready')
    expect(inst.getSnapshot().audio.message).toMatch(/live synthesis/)
    expect(inst.sink.liveVoices()[0].origin).toBe('synth')
    // enable a Grand layer B while its files are missing: fallback is reported for it, A keeps its synth voice
    state.update((s) => ({ ...s, layers: { ...s.layers, B: { ...s.layers.B, enabled: true, type: 'Grand' } } }))
    await settle()
    await settle()
    expect(inst.getSnapshot().audio.phase).toBe('fallback')
    inst.lifecycle.noteOn('b', 67, 100)
    expect(inst.sink.liveVoices().filter((v) => v.note === 67).map((v) => `${v.layer}:${v.origin}`).sort()).toEqual(['A:synth', 'B:generated'])
    inst.dispose()
  })

  it('switching to an available model recovers: recorded models load on demand, once', async () => {
    const h = createHarness()
    const state = createEngineStore(layersWith({ type: 'Upright' }))
    const inst = createInstrument(h.deps, state)
    inst.wake()
    await settle()
    await settle()
    expect(h.loaded.every((u) => u.startsWith('samples/upright-kw/'))).toBe(true)
    const count = h.loaded.length
    state.update((s) => setType(s, 'Grand'))
    await settle()
    await settle()
    state.update((s) => setType(s, 'Upright'))
    await settle()
    expect(h.loaded.length).toBe(count + 90) // Grand loaded once; Upright was already there
    expect(inst.getSnapshot().audio.phase).toBe('ready')
    inst.dispose()
  })

  it('disposing while samples are still loading leaves no timers, listeners or live nodes behind', async () => {
    const h = createHarness()
    const inst = createInstrument(h.deps)
    inst.lifecycle.noteOn('a', 60, 100)
    const ctx = h.ctx()!
    inst.dispose()
    await settle()
    await settle()
    expect(ctx.closed).toBe(true)
    expect(ctx.liveNodes()).toHaveLength(0)
    expect(h.scheduler.pending).toBe(0)
  })
})

describe('piano.pedals — MIDI CC64 honours SUSTPED per layer', () => {
  it('CC64 down sustains only layers whose SUSTPED is on; CC64 up releases them', async () => {
    const h = createHarness()
    const state = createEngineStore(
      (() => {
        const s = defaultState()
        return { ...s, layers: { A: { ...s.layers.A, sustPed: true }, B: { ...s.layers.B, enabled: true, sustPed: false } } }
      })(),
    )
    const inst = createInstrument(h.deps, state)
    await inst.midi.connect()
    h.midiInput.send(0xb0, 64, 127)
    h.midiInput.send(0x90, 60, 100)
    h.midiInput.send(0x80, 60, 0)
    expect(inst.lifecycle.getVoices().map((v) => `${v.layer}:${v.state}`).sort()).toEqual(['A:sustained', 'B:releasing'])
    h.midiInput.send(0xb0, 64, 0)
    expect(inst.lifecycle.getVoices().every((v) => v.state === 'releasing')).toBe(true)
    inst.dispose()
  })

  it('toggling SUSTPED while the pedal is down applies to notes that are already sounding', () => {
    const h = createHarness()
    const state = createEngineStore(defaultState())
    const inst = createInstrument(h.deps, state)
    inst.lifecycle.sustain('p', true)
    inst.lifecycle.noteOn('a', 60, 100)
    inst.lifecycle.noteOff('a')
    expect(inst.lifecycle.getVoices()[0].state).toBe('sustained')
    state.update((s) => ({ ...s, layers: { ...s.layers, A: { ...s.layers.A, sustPed: false } } }))
    expect(inst.lifecycle.getVoices()[0].state).toBe('releasing')
    inst.dispose()
  })

  it('turning a layer or the whole Piano section off releases its voices instead of leaving them hanging', () => {
    const h = createHarness()
    const state = createEngineStore(defaultState())
    const inst = createInstrument(h.deps, state)
    inst.lifecycle.noteOn('a', 60, 100)
    state.update((s) => ({ ...s, pianoOn: false }))
    expect(inst.lifecycle.getVoices()[0].state).toBe('releasing')
    inst.lifecycle.noteOn('b', 62, 100) // section off: the key moves, nothing sounds
    expect(inst.getSnapshot().pressed.has(62)).toBe(true)
    expect(inst.lifecycle.getVoices()).toHaveLength(1)
    inst.dispose()
  })
})
