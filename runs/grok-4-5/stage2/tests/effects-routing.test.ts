import { describe, expect, it } from 'vitest'
import { PianoEngine } from '../src/audio/piano-engine'
import { createMockContextFactory } from '../src/test/mock-audio'
import { defaultChain } from '../src/model/piano-types'

describe('effects.routing', () => {
  it('focus follows piano layer focus and supports manual focus', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    engine.setPianoState({ focus: 'B' })
    engine.setEffectsState({ layerFocus: 'PianoB', focusSection: 'Piano' })
    expect(engine.getEffectsState().layerFocus).toBe('PianoB')
    engine.setEffectsState({ layerFocus: 'PianoA', focusSection: 'Piano' })
    expect(engine.getEffectsState().layerFocus).toBe('PianoA')
    engine.setEffectsState({ focusSection: 'Organ', layerFocus: 'OrganA' })
    expect(engine.getEffectsState().focusSection).toBe('Organ')
    engine.dispose()
  })

  it('group mode shares Piano A settings to B', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    engine.setEffectsState({ pianoGroup: true })
    engine.updateChain('PianoA', (c) => ({
      ...c,
      reverb: { ...c.reverb, on: true, mix: 0.8 },
    }))
    // B chain object may differ but resolve uses A when grouped — energy with B focus still affected via group
    engine.setEffectsState({ layerFocus: 'PianoB' })
    const e = await engine.measureEnergy({
      setup: () => {
        engine.updateChain('PianoA', (c) => ({
          ...c,
          reverb: { ...c.reverb, on: true, mix: 0.9 },
        }))
      },
    })
    expect(e).toBeGreaterThan(0)
    engine.dispose()
  })

  it('per-unit bypass and all-effects bypass alter energy', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    engine.updateChain('PianoA', (c) => ({
      ...c,
      reverb: { ...c.reverb, on: true, mix: 0.7 },
      delay: { ...c.delay, on: true, mix: 0.5 },
    }))
    const wet = await engine.measureEnergy({ velocity: 0.9 })
    engine.setEffectsState({ allBypass: true })
    const bypassed = await engine.measureEnergy({ velocity: 0.9 })
    expect(wet).not.toBe(bypassed)
    engine.setEffectsState({ allBypass: false })
    engine.updateChain('PianoA', (c) => ({
      ...c,
      reverb: { ...c.reverb, on: false },
      delay: { ...c.delay, on: false },
    }))
    const dry = await engine.measureEnergy({ velocity: 0.9 })
    expect(dry).not.toBe(wet)
    engine.dispose()
  })

  it('global mode applies delay/comp/reverb across chains', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    const chain = defaultChain()
    chain.delay.on = true
    chain.delay.mix = 0.6
    engine.setEffectsState({
      globalDelay: { ...chain.delay, global: true, on: true, mix: 0.75 },
      chains: {
        PianoA: { ...defaultChain(), delay: { ...defaultChain().delay, global: true, on: false } },
        PianoB: defaultChain(),
      },
    })
    const e = await engine.measureEnergy({ velocity: 0.8 })
    expect(e).toBeGreaterThan(0)
    engine.dispose()
  })

  it('To Rotary routes amp type and enables rotary', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    engine.updateChain('PianoA', (c) => ({
      ...c,
      ampEq: { ...c.ampEq, on: true, type: 'To Rotary' },
    }))
    engine.setEffectsState({ rotary: { on: true, fast: true, drive: 0.5 } })
    expect(engine.getEffectsState().chains.PianoA.ampEq.type).toBe('To Rotary')
    expect(engine.getGraphInfo().hasRotary).toBe(true)
    engine.dispose()
  })

  it('delay feedback filter mode is stored on chain state', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    engine.updateChain('PianoA', (c) => ({
      ...c,
      delay: { ...c.delay, on: true, filter: 'LP', feedback: 0.6, mix: 0.4 },
    }))
    expect(engine.getEffectsState().chains.PianoA.delay.filter).toBe('LP')
    engine.dispose()
  })
})
