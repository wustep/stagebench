import { describe, expect, it } from 'vitest'
import { arpSteps } from '../src/audio/synth-engine'
import { PianoEngine } from '../src/audio/piano-engine'
import { createMockContextFactory } from '../src/test/mock-audio'

describe('synth.arp-gate', () => {
  it('deterministic step order by direction and range', () => {
    const notes = [60, 64, 67]
    const up = arpSteps(notes, 'Up', 1)
    expect(up).toEqual([60, 64, 67])
    const down = arpSteps(notes, 'Down', 1)
    expect(down).toEqual([67, 64, 60])
    const ud = arpSteps(notes, 'Up/Down', 1)
    expect(ud[0]).toBe(60)
    expect(ud).toContain(67)
    expect(ud.length).toBeGreaterThan(3)
    const r1 = arpSteps(notes, 'Random', 1, 1)
    const r2 = arpSteps(notes, 'Random', 1, 1)
    expect(r1).toEqual(r2)
    const oct2 = arpSteps(notes, 'Up', 2)
    expect(oct2).toContain(72)
    expect(oct2.length).toBe(6)
  })

  it('arp rate clock sync range hold run state', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    engine.setSynthState({ sectionOn: true })
    engine.updateSynthLayer('A', {
      enabled: true,
      arpOn: true,
      arpRun: true,
      arpHold: true,
      arpRate: 0.6,
      arpClockSync: true,
      arpRange: 2,
      arpDirection: 'Up',
      arpMode: 'Arp',
    })
    const ls = engine.getSynthState().layers.A
    expect(ls.arpRun).toBe(true)
    expect(ls.arpHold).toBe(true)
    expect(ls.arpRange).toBe(2)
    expect(ls.arpClockSync).toBe(true)
    engine.setProgramExtras({ masterClockBpm: 150 })
    expect(engine.getMasterClockBpm()).toBe(150)
    engine.dispose()
  })
})
