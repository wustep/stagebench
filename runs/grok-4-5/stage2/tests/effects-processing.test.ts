import { describe, expect, it } from 'vitest'
import { PianoEngine } from '../src/audio/piano-engine'
import { createMockContextFactory } from '../src/test/mock-audio'
import {
  AMP_TYPES,
  MOD1_TYPES,
  MOD2_TYPES,
  REVERB_TYPES,
  type AmpType,
  type Mod1Type,
  type Mod2Type,
  type ReverbType,
} from '../src/model/piano-types'

describe('effects.processing', () => {
  async function base() {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    return engine
  }

  it('Mod 1 types each change rendered energy vs bypass', async () => {
    const engine = await base()
    const dry = await engine.measureEnergy({ velocity: 0.85 })
    const energies: number[] = []
    for (const type of MOD1_TYPES) {
      engine.updateChain('PianoA', (c) => ({
        ...c,
        mod1: { on: true, type: type as Mod1Type, rate: 0.5, amount: 0.7 },
      }))
      energies.push(await engine.measureEnergy({ velocity: 0.85 }))
    }
    expect(energies.some((e) => e !== dry)).toBe(true)
    // not all types identical
    expect(new Set(energies.map((e) => e.toFixed(5))).size).toBeGreaterThan(1)
    engine.dispose()
  })

  it('Mod 2 types each change rendered energy', async () => {
    const engine = await base()
    const dry = await engine.measureEnergy({ velocity: 0.85 })
    const energies: number[] = []
    for (const type of MOD2_TYPES) {
      engine.updateChain('PianoA', (c) => ({
        ...c,
        mod2: { on: true, type: type as Mod2Type, rate: 0.5, amount: 0.7 },
      }))
      energies.push(await engine.measureEnergy({ velocity: 0.85 }))
    }
    expect(energies.some((e) => e !== dry)).toBe(true)
    expect(new Set(energies.map((e) => e.toFixed(5))).size).toBeGreaterThan(1)
    engine.dispose()
  })

  it('Delay dry/wet and feedback change energy', async () => {
    const engine = await base()
    engine.updateChain('PianoA', (c) => ({
      ...c,
      delay: { ...c.delay, on: true, mix: 0.1, feedback: 0.1, tempo: 0.4, filter: 'Off' },
    }))
    const low = await engine.measureEnergy({ velocity: 0.9 })
    engine.updateChain('PianoA', (c) => ({
      ...c,
      delay: { ...c.delay, on: true, mix: 0.9, feedback: 0.7, tempo: 0.4, filter: 'LP' },
    }))
    const high = await engine.measureEnergy({ velocity: 0.9 })
    expect(high).not.toBe(low)
    engine.dispose()
  })

  it('Amp types are audibly distinct', async () => {
    const engine = await base()
    const energies: number[] = []
    for (const type of AMP_TYPES) {
      engine.updateChain('PianoA', (c) => ({
        ...c,
        ampEq: {
          on: true,
          type: type as AmpType,
          drive: 0.6,
          bass: 0.6,
          mid: 0.5,
          midFreq: 0.5,
          treble: 0.6,
        },
      }))
      energies.push(await engine.measureEnergy({ velocity: 0.9 }))
    }
    expect(new Set(energies.map((e) => e.toFixed(5))).size).toBeGreaterThan(1)
    engine.dispose()
  })

  it('Compressor amount changes dynamics proxy', async () => {
    const engine = await base()
    engine.updateChain('PianoA', (c) => ({
      ...c,
      compressor: { on: true, amount: 0.1, fast: false, global: false },
    }))
    const low = await engine.measureEnergy({ velocity: 0.9 })
    engine.updateChain('PianoA', (c) => ({
      ...c,
      compressor: { on: true, amount: 0.95, fast: true, global: false },
    }))
    const high = await engine.measureEnergy({ velocity: 0.9 })
    expect(high).not.toBe(low)
    engine.dispose()
  })

  it('Reverb types are distinct', async () => {
    const engine = await base()
    const energies: number[] = []
    for (const type of REVERB_TYPES) {
      engine.updateChain('PianoA', (c) => ({
        ...c,
        reverb: { on: true, type: type as ReverbType, mix: 0.7, time: 0.6, bright: true, global: false },
      }))
      energies.push(await engine.measureEnergy({ velocity: 0.85 }))
    }
    expect(new Set(energies.map((e) => e.toFixed(5))).size).toBeGreaterThan(1)
    engine.dispose()
  })
})
