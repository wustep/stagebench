import { describe, expect, it } from 'vitest'
import { PianoEngine } from '../src/audio/piano-engine'
import { createMockContextFactory } from '../src/test/mock-audio'

describe('piano.velocity-controls', () => {
  async function engine() {
    const { createContext } = createMockContextFactory()
    const e = new PianoEngine({ useInlineSamples: true, createContext })
    await e.init()
    return e
  }

  it('KB Touch changes measured energy directionally', async () => {
    const e = await engine()
    e.setPianoState({ kbTouch: 'Heavy' })
    const heavy = await e.measureEnergy({ velocity: 0.5 })
    e.setPianoState({ kbTouch: 'Light' })
    const light = await e.measureEnergy({ velocity: 0.5 })
    expect(light).toBeGreaterThan(heavy)
    e.dispose()
  })

  it('Dyn Comp raises soft strokes', async () => {
    const e = await engine()
    e.setPianoState({ dynComp: 'Off' })
    const off = await e.measureEnergy({ velocity: 0.25 })
    e.setPianoState({ dynComp: 3 })
    const on = await e.measureEnergy({ velocity: 0.25 })
    expect(on).toBeGreaterThan(off)
    e.dispose()
  })

  it('Timbre Bright vs Soft differs', async () => {
    const e = await engine()
    e.setPianoState({ timbre: 'Soft' })
    const soft = await e.measureEnergy({ velocity: 0.8 })
    e.setPianoState({ timbre: 'Bright' })
    const bright = await e.measureEnergy({ velocity: 0.8 })
    expect(bright).not.toBe(soft)
    e.dispose()
  })

  it('Unison increases energy', async () => {
    const e = await engine()
    e.setPianoState({ unison: 'Off' })
    const off = await e.measureEnergy({ velocity: 0.8 })
    e.setPianoState({ unison: 3 })
    const on = await e.measureEnergy({ velocity: 0.8 })
    expect(on).toBeGreaterThan(off)
    e.dispose()
  })

  it('Soft Release and String Res alter energy', async () => {
    const e = await engine()
    e.setPianoState({ softRelease: false, stringRes: false })
    const base = await e.measureEnergy({ velocity: 0.8 })
    e.setPianoState({ softRelease: true })
    const soft = await e.measureEnergy({ velocity: 0.8 })
    e.setPianoState({ stringRes: true })
    const res = await e.measureEnergy({ velocity: 0.8 })
    expect(soft).not.toBe(base)
    expect(res).not.toBe(soft)
    e.dispose()
  })

  it('Master Level scales energy', async () => {
    const e = await engine()
    e.setMasterLevel(0.2)
    const low = await e.measureEnergy({ velocity: 0.9 })
    e.setMasterLevel(1)
    const high = await e.measureEnergy({ velocity: 0.9 })
    expect(high).toBeGreaterThan(low)
    e.dispose()
  })
})
