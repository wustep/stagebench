import { describe, expect, it } from 'vitest'
import { PianoEngine } from '../src/audio/piano-engine'
import { familyForType, SAMPLE_ROOTS } from '../src/audio/sample-library'
import { createMockContextFactory } from '../src/test/mock-audio'
import { PIANO_TYPES, type PianoType } from '../src/model/piano-types'

describe('piano.instrument-library', () => {
  it('selects all six piano types with at least one model each', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    expect(engine.getStatus()).toBe('ready')

    for (const type of PIANO_TYPES) {
      engine.setPianoState({ type, modelIndex: 0 })
      expect(engine.getPianoState().type).toBe(type)
      const id = engine.noteOn(60, 0.8, 'lib')
      expect(id).toBeTruthy()
      engine.allNotesOff()
    }
    engine.dispose()
  })

  it('Grand/Upright/Electric are sample families with multi-root coverage', () => {
    expect(familyForType('Grand')).toBe('grand')
    expect(familyForType('Upright')).toBe('upright')
    expect(familyForType('Electric')).toBe('electric')
    expect(familyForType('Clav')).toBeNull()
    expect(SAMPLE_ROOTS.length).toBeGreaterThanOrEqual(8)
  })

  it('types produce distinct signatures (not identical copies)', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    const types: PianoType[] = ['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc']
    const sigs: number[][] = []
    for (const t of types) {
      sigs.push(await engine.typeSignature(t, 60))
    }
    // pairwise at least one band differs
    for (let i = 0; i < sigs.length; i++) {
      for (let j = i + 1; j < sigs.length; j++) {
        const same = sigs[i]!.every((v, k) => Math.abs(v - sigs[j]![k]!) < 1e-12)
        expect(same, `${types[i]} vs ${types[j]} identical`).toBe(false)
      }
    }
    engine.dispose()
  })

  it('measureEnergy differs across Grand vs Electric', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    engine.setPianoState({ type: 'Grand' })
    const g = await engine.measureEnergy({ midi: 60, velocity: 0.9 })
    engine.setPianoState({ type: 'Electric' })
    const e = await engine.measureEnergy({ midi: 60, velocity: 0.9 })
    engine.setPianoState({ type: 'Upright' })
    const u = await engine.measureEnergy({ midi: 60, velocity: 0.9 })
    expect(g).toBeGreaterThan(0)
    expect(e).toBeGreaterThan(0)
    expect(u).toBeGreaterThan(0)
    // not all identical
    expect(new Set([g.toFixed(6), e.toFixed(6), u.toFixed(6)]).size).toBeGreaterThan(1)
    engine.dispose()
  })
})
