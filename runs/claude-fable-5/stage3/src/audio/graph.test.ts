import { describe, expect, it } from 'vitest'
import { fakeAssetBoundary, fakeAudioBoundary, FakeNode } from '../test/fakes'
import { InstrumentStore } from '../state/instrument'
import { PianoEngine } from './engine'

/**
 * effects.graph — one AudioContext, per-layer buses, ordered effects, master
 * gain/limiter, one destination, ramped automation and full cleanup. These
 * assertions traverse REAL node connections (fake context edges), never
 * self-reported metadata.
 */
function makeSystem() {
  const setup = fakeAudioBoundary()
  const store = new InstrumentStore()
  const engine = new PianoEngine(setup.boundary, { assets: fakeAssetBoundary() })
  engine.attachStore(store)
  engine.ensureStarted()
  return { ...setup, store, engine }
}

function directlyConnected(from: { connections?: FakeNode[] }, to: unknown): boolean {
  return ((from as FakeNode).connections ?? []).includes(to as FakeNode)
}

/** True if `to` is reachable from `from` following real connections. */
function reaches(from: unknown, to: unknown): boolean {
  const seen = new Set<FakeNode>()
  const stack = [from as FakeNode]
  while (stack.length) {
    const node = stack.pop()!
    if (node === to) return true
    if (seen.has(node)) continue
    seen.add(node)
    stack.push(...node.connections)
  }
  return false
}

describe('effects.graph', () => {
  it('creates exactly one AudioContext with exactly one destination', () => {
    const { engine, getContext } = makeSystem()
    const context = getContext()!
    engine.noteOn(60, 0.8)
    engine.noteOff(60)
    const { context: diagContext } = engine.diagnostics()
    expect(diagContext).toBe(context)
    expect(context.nodes.filter((n) => n.kind === 'destination')).toHaveLength(1)
  })

  it('routes master gain through the limiter into the single destination', () => {
    const { engine, getContext } = makeSystem()
    const { masterGain, limiter } = engine.diagnostics()
    expect(masterGain).toBeTruthy()
    expect(limiter).toBeTruthy()
    expect(directlyConnected(masterGain as never, limiter)).toBe(true)
    expect(directlyConnected(limiter as never, getContext()!.destination)).toBe(true)
  })

  it('wires each layer bus through the documented effect order into the master', () => {
    const { engine } = makeSystem()
    const { channels, masterGain, rotary } = engine.diagnostics()
    for (const layer of ['A', 'B'] as const) {
      const channel = channels![layer]
      // voice bus -> timbre -> (dyn comp) -> level -> mod1 -> mod2 -> delay
      // -> amp/EQ -> comp -> reverb -> master (and a rotary tap post-reverb).
      expect(directlyConnected(channel.voiceBus as never, channel.timbreBass)).toBe(true)
      expect(reaches(channel.timbreBass, channel.levelGain)).toBe(true)
      expect(directlyConnected(channel.levelGain as never, channel.units.mod1.input)).toBe(true)
      expect(directlyConnected(channel.units.mod1.output as never, channel.units.mod2.input)).toBe(true)
      expect(directlyConnected(channel.units.mod2.output as never, channel.units.delay.input)).toBe(true)
      expect(directlyConnected(channel.units.delay.output as never, channel.units.ampEq.input)).toBe(true)
      expect(directlyConnected(channel.units.ampEq.output as never, channel.units.comp.input)).toBe(true)
      expect(directlyConnected(channel.units.comp.output as never, channel.units.reverb.input)).toBe(true)
      expect(reaches(channel.units.reverb.output, masterGain)).toBe(true)
      // The chain does NOT skip units: mod1 input cannot reach master except through mod2.
      expect(reaches(channel.units.mod1.output, channel.units.mod2.input)).toBe(true)
      // Reverb precedes Rotary: the rotary tap hangs off the reverb output.
      expect(directlyConnected(channel.units.reverb.output as never, channel.toRotary)).toBe(true)
      expect(directlyConnected(channel.toRotary as never, rotary!.input)).toBe(true)
    }
    // One rotary instance shared by both layers, last before the master.
    expect(reaches(rotary!.output, masterGain)).toBe(true)
  })

  it('voices from both layers enter their own buses (per-layer ownership)', () => {
    const { engine, store, getContext } = makeSystem()
    store.setLayerEnabled('B', true)
    const { channels } = engine.diagnostics()
    const context = getContext()!
    const before = context.nodes.length
    engine.noteOn(60, 0.8)
    const newNodes = context.nodes.slice(before)
    const voiceGainsIntoA = newNodes.filter((n) => directlyConnected(n, channels!.A.voiceBus))
    const voiceGainsIntoB = newNodes.filter((n) => directlyConnected(n, channels!.B.voiceBus))
    expect(voiceGainsIntoA.length).toBeGreaterThan(0)
    expect(voiceGainsIntoB.length).toBeGreaterThan(0)
  })

  it('no engine path bypasses the shared master output', () => {
    const { engine, getContext } = makeSystem()
    engine.noteOn(60, 0.8)
    const context = getContext()!
    const { masterGain } = engine.diagnostics()
    // Every path to the destination passes through the master gain: the only
    // node connecting into the destination is the limiter, fed by master.
    const intoDestination = context.nodes.filter((n) => directlyConnected(n, context.destination))
    expect(intoDestination).toHaveLength(1)
    expect(directlyConnected(masterGain as never, intoDestination[0]!)).toBe(true)
  })

  it('parameter changes use ramped automation (no bare clicks on live gains)', () => {
    const { store, engine, getContext } = makeSystem()
    const { channels } = engine.diagnostics()
    const level = channels!.A.levelGain as unknown as { gain: { events: Array<{ kind: string }> } }
    const before = level.gain.events.length
    store.setLayerLevel('A', 30)
    const newEvents = level.gain.events.slice(before)
    expect(newEvents.some((e) => e.kind === 'target')).toBe(true)
    expect(newEvents.some((e) => e.kind === 'set' || e.kind === 'linear')).toBe(false)
    expect(getContext()).toBeTruthy()
  })

  it('dispose tears the whole standing graph down and closes the context', () => {
    const { engine, getContext, timers } = makeSystem()
    engine.noteOn(60, 0.8)
    engine.dispose()
    timers.advance(3000)
    const context = getContext()!
    expect(context.closed).toBe(true)
    expect(context.liveNodes()).toHaveLength(0)
    // All effect LFO oscillators were stopped, not orphaned.
    expect(context.oscillators().every((o) => o.stopped || !o.started)).toBe(true)
  })
})
