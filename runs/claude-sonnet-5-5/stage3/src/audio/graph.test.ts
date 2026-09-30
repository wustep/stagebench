import { describe, expect, it } from 'vitest'
import { AMP_TYPES, REVERB_TYPES, defaultState, editFx, setRotary, type EngineState } from '../engine/state'
import { createHarness, FakeNode, type FakeAudioContext } from '../test-utils/fakes'
import { createInstrument } from './instrument'
import { createEngineStore } from '../engine/state'

/** effects.graph — one AudioContext, per-layer buses, ordered effects, master gain / limiter, one destination, cleanup. */

const setup = (edit: (s: EngineState) => EngineState = (s) => s) => {
  const h = createHarness()
  const state = createEngineStore(edit(defaultState()))
  const inst = createInstrument(h.deps, state)
  inst.wake()
  const ctx = h.ctx()!
  return { h, state, inst, ctx, graph: inst.sink.getGraph()! }
}

/** is there a path of connections from `from` to `to`? */
const reaches = (from: FakeNode, to: FakeNode, through?: (n: FakeNode) => boolean): boolean => {
  const seen = new Set<FakeNode>()
  const walk = (n: FakeNode): boolean => {
    if (n === to) return true
    if (seen.has(n)) return false
    seen.add(n)
    for (const o of n.outputs) if (o instanceof FakeNode && (!through || through(o) || o === to) && walk(o)) return true
    return false
  }
  return walk(from)
}
const node = (n: unknown) => n as FakeNode

describe('effects.graph', () => {
  it('uses exactly one AudioContext for everything, however much is played and edited', () => {
    const { h, state, inst } = setup()
    inst.lifecycle.noteOn('a', 60, 100)
    state.update((s) => editFx(s, 'reverb', { on: true }))
    state.update((s) => setRotary(s, { fast: true }))
    state.update((s) => ({ ...s, layers: { ...s.layers, B: { ...s.layers.B, enabled: true } } }))
    inst.lifecycle.noteOn('b', 64, 100)
    expect(h.contexts).toHaveLength(1)
    inst.dispose()
  })

  it('has per-layer buses; a single node (the limiter) feeds the destination, after the master gain', () => {
    const { ctx, graph, inst } = setup()
    const feeders = ctx.nodes.filter((n) => n.outputs.has(ctx.destination))
    expect(feeders).toHaveLength(1)
    expect(feeders[0]).toBe(node(graph.limiter))
    expect(feeders[0].kind).toBe('compressor')
    expect(node(graph.layers.A.bus)).not.toBe(node(graph.layers.B.bus))
    // master gain → soft clip → limiter → destination
    expect(reaches(node(graph.master), node(graph.limiter))).toBe(true)
    expect(node(graph.softClip).outputs.has(node(graph.limiter))).toBe(true)
    // nothing that carries sound bypasses the master: every layer node reaches the destination only via the master gain
    for (const id of ['A', 'B'] as const) {
      const l = graph.layers[id]
      expect(reaches(node(l.bus), ctx.destination)).toBe(true)
      expect(reaches(node(l.bus), ctx.destination, (n) => n !== node(graph.master))).toBe(false)
      expect(reaches(node(l.level), node(graph.master))).toBe(true)
    }
    inst.dispose()
  })

  it('orders the six units: source → Mod 1 → Mod 2 → Delay → Amp/EQ → Compressor → Reverb → layer level', () => {
    const { graph, ctx, inst } = setup()
    for (const id of ['A', 'B'] as const) {
      const c = graph.layers[id].chain
      const order = [c.mod1, c.mod2, c.delay, c.amp, c.comp, c.reverb]
      expect(node(graph.layers[id].bus).outputs.size).toBe(1) // → timbre EQ
      expect(reaches(node(graph.layers[id].bus), node(c.input))).toBe(true)
      expect(node(c.input).outputs.has(node(order[0].input))).toBe(true)
      for (let i = 0; i < order.length - 1; i++) expect(node(order[i].output).outputs.has(node(order[i + 1].input)), `unit ${i} → ${i + 1}`).toBe(true)
      expect(node(order[5].output).outputs.has(node(c.output))).toBe(true)
      expect(node(c.output).outputs.has(node(graph.layers[id].level))).toBe(true)
      // no shortcut: a later unit never feeds an earlier one
      for (let i = 1; i < order.length; i++) for (let j = 0; j < i; j++) expect(reaches(node(order[i].output), node(order[j].input)), `${i} must not feed ${j}`).toBe(false)
    }
    void ctx
    inst.dispose()
  })

  it('the shared rotary sits after the Reverb and before the master, and exists once', () => {
    const { graph, state, inst } = setup()
    expect(graph.rotary).toBeNull() // nothing routed yet
    state.update((s) => editFx(editFx(s, 'amp', { type: 'To Rotary', on: true }), 'reverb', { on: true }))
    const rotary = graph.rotary!
    expect(rotary).not.toBeNull()
    const a = graph.layers.A
    expect(reaches(node(a.chain.reverb.output), node(rotary.input))).toBe(true)
    expect(reaches(node(rotary.output), node(graph.master))).toBe(true)
    expect(reaches(node(rotary.output), node(a.chain.reverb.input))).toBe(false)
    // both layers share the same rotary bus
    expect(reaches(node(graph.layers.B.level), node(rotary.input))).toBe(true)
    state.update((s) => setRotary(s, { fast: true }))
    expect(graph.rotary).toBe(rotary)
    inst.dispose()
  })

  it('Delay has a filtered feedback loop (delay → filter → gain → delay)', () => {
    const { graph, inst } = setup()
    const d = graph.layers.A.chain.delay
    const delays = (d as unknown as { delay: FakeNode }).delay
    const filter = [...delays.outputs].find((n) => (n as FakeNode).kind === 'biquad') as FakeNode
    expect(filter).toBeDefined()
    const gain = [...filter.outputs][0] as FakeNode
    expect(gain.kind).toBe('gain')
    expect(gain.outputs.has(delays)).toBe(true)
    inst.dispose()
  })

  it('parameter changes are ramped (click-free): switching units on/off schedules short ramps, never bare jumps', () => {
    const { ctx, state, inst } = setup()
    ctx.currentTime = 1
    const before = ctx.nodes.length
    state.update((s) => editFx(s, 'amp', { on: true, type: 'Twin' }))
    state.update((s) => editFx(s, 'reverb', { on: true, type: 'Hall' }))
    state.update((s) => editFx(s, 'comp', { on: true, amount: 0.9 }))
    expect(ctx.nodes.length).toBeGreaterThanOrEqual(before)
    let ramps = 0
    for (const n of ctx.nodes) {
      const gain = (n as unknown as { gain?: { events: Array<{ type: string; time: number }> } }).gain
      if (!gain?.events) continue
      for (const e of gain.events) {
        if (e.type === 'ramp') {
          ramps++
          expect(e.time).toBeGreaterThan(1)
          expect(e.time).toBeLessThanOrEqual(1.1)
        }
      }
    }
    expect(ramps).toBeGreaterThan(6)
    inst.dispose()
  })

  it('Compressor fast mode shortens attack and release', () => {
    const { ctx, state, inst } = setup()
    const compressors = () => ctx.nodes.filter((n) => n.kind === 'compressor') as unknown as Array<{ attack: { value: number }; release: { value: number } }>
    state.update((s) => editFx(s, 'comp', { on: true, amount: 0.9, fast: false }))
    const slow = compressors().map((c) => [c.attack.value, c.release.value])
    state.update((s) => editFx(s, 'comp', { fast: true }))
    const fast = compressors().map((c) => [c.attack.value, c.release.value])
    expect(fast.some((f, i) => f[0] < slow[i][0] && f[1] < slow[i][1])).toBe(true)
    inst.dispose()
  })

  it('every Reverb type gets its own generated impulse response, longest for Cathedral, shortest for Booth', () => {
    const { ctx, state, inst, h } = setup()
    const lengths: Record<string, number> = {}
    for (const type of REVERB_TYPES) {
      state.update((s) => editFx(s, 'reverb', { on: true, type }))
      h.scheduler.advance(400) // the previous impulse response is released after its crossfade
      const conv = ctx.nodes.filter((n) => n.kind === 'convolver').map((n) => (n as unknown as { buffer: { length: number } | null }).buffer).filter(Boolean)
      lengths[type] = Math.max(...conv.map((b) => b!.length))
    }
    expect(lengths.Booth).toBeLessThan(lengths.Room)
    expect(lengths.Room).toBeLessThan(lengths.Stage)
    expect(lengths.Stage).toBeLessThan(lengths.Hall)
    expect(lengths.Hall).toBeLessThan(lengths.Cathedral)
    inst.dispose()
  })

  it('cleans up: every node is disconnected, oscillators stopped, timers and listeners gone after dispose', () => {
    const { h, state, inst, ctx } = setup()
    inst.lifecycle.noteOn('a', 60, 100)
    inst.lifecycle.noteOn('b', 64, 100)
    state.update((s) => ({ ...s, layers: { ...s.layers, B: { ...s.layers.B, enabled: true } } }))
    for (const t of AMP_TYPES) state.update((s) => editFx(s, 'amp', { on: true, type: t }))
    state.update((s) => editFx(editFx(editFx(s, 'mod1', { on: true, type: 'Wah' }), 'mod2', { on: true, type: 'Ensemble' }), 'delay', { on: true, pingPong: true }))
    state.update((s) => editFx(s, 'mod1', { type: 'Pump' })) // a type switch schedules a retirement timer
    state.update((s) => editFx(s, 'amp', { type: 'To Rotary' }))
    inst.lifecycle.noteOff('a')
    inst.dispose()
    expect(ctx.closed).toBe(true)
    expect(ctx.liveNodes()).toHaveLength(0)
    expect(h.scheduler.pending).toBe(0)
    const oscillators = ctx.nodes.filter((n) => n.kind === 'oscillator') as unknown as Array<{ stopped: boolean }>
    expect(oscillators.length).toBeGreaterThan(4)
    expect(oscillators.every((o) => o.stopped)).toBe(true)
    expect(state.listenerCount()).toBe(0)
  })

  it('cleanup also holds after a changing session: the persistent graph never grows without bound', () => {
    const { state, inst, ctx, h } = setup()
    const steady = () => ctx.liveNodes().length
    for (const t of ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin'] as const) state.update((s) => editFx(s, 'mod2', { on: true, type: t }))
    h.scheduler.advance(1000)
    const afterSwitching = steady()
    for (let i = 0; i < 6; i++) for (const t of ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin'] as const) state.update((s) => editFx(s, 'mod2', { type: t }))
    h.scheduler.advance(1000)
    expect(steady()).toBe(afterSwitching)
    inst.dispose()
  })
})

export type { FakeAudioContext }
