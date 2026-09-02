import { act, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CHAIN_ORDER } from '../src/dsp/chain'
import { masterKnobToGain } from '../src/dsp/types'
import { FakeProcessorNode } from '../src/audio/fakeAudio'
import { el, flush, keyEl, mountApp, type Mounted } from './helpers'

let mounted: Mounted | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
})

/** Starts audio (creating the one context) and lets the async DSP host wiring settle. */
async function startAudio(m: Mounted) {
  await act(async () => {
    fireEvent.click(el('start-audio'))
  })
  for (let i = 0; i < 4; i++) await flush()
  await act(async () => {
    m.world.timers.flush()
  })
}

describe('effects.graph — one AudioContext, layer buses, ordered effects, master gain/limiter, one destination, cleanup', () => {
  it('builds exactly one context whose voices reach the single destination through bus → chain → level → master gain → limiter', async () => {
    mounted = await mountApp()
    const { engine } = mounted.services
    const { world } = mounted
    await startAudio(mounted)
    expect(world.contexts).toHaveLength(1)
    expect(engine.getStatus().effects).toBe('worklet')
    const ctx = world.ctx
    // Phase 3: Piano A / B, the shared Organ chain and Synth A / B / C = six layer chains on the one context.
    expect(ctx.processors('layer')).toHaveLength(6)
    expect(ctx.processors('organ')).toHaveLength(1)
    expect(ctx.processors('synth')).toHaveLength(3)
    expect(ctx.processors('rotary')).toHaveLength(1)
    expect(ctx.processors('master')).toHaveLength(1)
    // play on both layers
    fireEvent.click(el('piano.layer-b.on'))
    fireEvent.pointerDown(keyEl(60), { pointerId: 1, button: 0 })
    fireEvent.pointerDown(keyEl(64), { pointerId: 2, button: 0 })
    expect(world.contexts).toHaveLength(1)
    const voices = engine.activeVoices()
    expect(voices.map((v) => v.layer).sort()).toEqual(['A', 'A', 'B', 'B'])
    for (const source of ctx.sources()) {
      const paths = ctx.pathsToDestination(source)
      expect(paths).toHaveLength(1)
      expect(paths[0].join(' > ')).toBe('source > gain > gain > layer > gain > gain > master > destination')
    }
    // the master limiter is the only node feeding the destination; every layer chain feeds the master gain
    const master = ctx.processors('master')[0]
    expect(ctx.liveNodes().filter((n) => n.connections.includes(ctx.destination))).toEqual([master])
    const masterGain = ctx.gains()[0]
    expect(masterGain.connections).toEqual([master])
    for (const layer of ctx.processors('layer')) expect(layer.connections).toHaveLength(1)
    fireEvent.pointerUp(keyEl(60), { pointerId: 1 })
    fireEvent.pointerUp(keyEl(64), { pointerId: 2 })
    expect(engine.getStatus().effects).toBe('worklet')
  })

  it('keeps the documented unit order inside every layer chain and routes To Rotary between reverb and the master path', async () => {
    mounted = await mountApp()
    const { world } = mounted
    const { state } = mounted.services
    await startAudio(mounted)
    expect([...CHAIN_ORDER]).toEqual(['timbre', 'stringRes', 'mod1', 'mod2', 'delay', 'ampEq', 'compressor', 'reverb'])
    // route layer A into the shared rotary: Amp Sim/EQ on + model "To rotary"
    fireEvent.click(el('effects.amp.on'))
    const model = el('effects.amp.model')
    while (Number(model.dataset.value) !== 4) fireEvent.click(model)
    expect(state.get().effects.chains.pianoA.amp.model).toBe(4)
    fireEvent.pointerDown(keyEl(60), { pointerId: 1, button: 0 })
    const ctx = world.ctx
    const source = ctx.sources().at(-1)!
    const paths = ctx.pathsToDestination(source)
    expect(paths).toHaveLength(1)
    expect(paths[0].join(' > ')).toBe('source > gain > gain > layer > gain > rotary > gain > master > destination')
    expect(document.querySelector('.led-rotary-on .led')?.className).toContain('lit')
    // back to the direct path
    fireEvent.click(el('effects.amp.on'))
    expect(ctx.pathsToDestination(source)[0].join(' > ')).toBe('source > gain > gain > layer > gain > gain > master > destination')
    expect(document.querySelector('.led-rotary-on .led')?.className).not.toContain('lit')
    fireEvent.pointerUp(keyEl(60), { pointerId: 1 })
  })

  it('carries panel parameters into the processors with ramps: reverb dry/wet, layer level, master level', async () => {
    mounted = await mountApp()
    const { world } = mounted
    await startAudio(mounted)
    const ctx = world.ctx
    const [procA] = ctx.processors('layer')
    expect((procA.params.reverb as { dryWet: number }).dryWet).toBe(6)
    fireEvent.keyDown(el('effects.reverb.dry-wet'), { key: 'End' })
    expect((procA.params.reverb as { dryWet: number }).dryWet).toBe(10)
    const levelA = ctx.gains()[2]
    fireEvent.keyDown(el('piano.layer-a.level'), { key: 'Home' })
    expect(levelA.gain.events.at(-1)).toMatchObject({ type: 'target', value: 0 })
    fireEvent.keyDown(el('performance.master-level'), { key: 'Home' })
    const master = ctx.gains()[0]
    expect(master.gain.events.at(-1)).toMatchObject({ type: 'target', value: masterKnobToGain(0) })
    fireEvent.keyDown(el('performance.master-level'), { key: 'End' })
    expect(master.gain.events.at(-1)).toMatchObject({ type: 'target', value: 1 })
    expect(ctx.processors('master')[0].params).toEqual({ level: 10 })
  })

  it('cleans up everything on unmount: processors disposed, no live nodes, context closed', async () => {
    mounted = await mountApp()
    const { world, services } = mounted
    await startAudio(mounted)
    fireEvent.pointerDown(keyEl(60), { pointerId: 1, button: 0 })
    const ctx = world.ctx
    const processors = ctx.processors()
    expect(processors).toHaveLength(12) // master, rotary, 6 chains, organ, 3 synth layers (Phase 3)
    mounted.unmount()
    mounted = null
    expect(processors.every((p) => p.disposed)).toBe(true)
    expect(ctx.liveNodes()).toEqual([])
    expect(ctx.state).toBe('closed')
    expect(services.engine.metrics()).toMatchObject({ liveNodes: 0, hasContext: false })
    expect(ctx.nodes.every((n) => !(n instanceof FakeProcessorNode) || n.disposed)).toBe(true)
  })

  it('reports effects as unavailable when no DSP host exists and still reaches the destination through the master gain', async () => {
    mounted = await mountApp({ processors: 'fail' })
    const { world } = mounted
    const { engine } = mounted.services
    await startAudio(mounted)
    expect(engine.getStatus().effects).toBe('unavailable')
    expect(document.getElementById('effects-status')?.dataset.state).toBe('unavailable')
    fireEvent.pointerDown(keyEl(60), { pointerId: 1, button: 0 })
    const source = world.ctx.sources().at(-1)!
    expect(world.ctx.pathsToDestination(source)[0].join(' > ')).toBe('source > gain > gain > gain > gain > destination')
    fireEvent.pointerUp(keyEl(60), { pointerId: 1 })
  })
})
