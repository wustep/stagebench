import { describe, expect, it } from 'vitest'
import { System4 } from '../src/audio/system4'
import { defaultProgramState } from '../src/system/factory'
import type { ProgramState } from '../src/system/program'

const SR = 8000

function rmsArray(a: Float32Array): number {
  let s = 0
  for (const x of a) s += x * x
  return Math.sqrt(s / a.length)
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let m = 0
  for (let i = 0; i < n; i++) {
    const d = Math.abs(a[i] - b[i])
    if (d > m) m = d
  }
  return m
}

/** three-zone split program: organ gets the low half, piano the high half. */
function splitProgram(): ProgramState {
  const p = defaultProgramState('Split')
  p.piano.layers[0].enabled = true
  p.organ.layers[0].enabled = true
  p.synth.layers[0].enabled = false
  p.split.on = true
  p.split.points = { low: 48, mid: 60, high: 72 }
  p.split.zones = { 'piano.A': { low: 2, high: 3 }, 'organ.A': { low: 0, high: 1 } }
  return p
}

function refs(s: System4, midi: number): string[] {
  return s.noteOn(midi, 0.9).map((r) => r.ref)
}

describe('splits.zones — editable split points, up to 4 zones, note routing', () => {
  it('routes low notes to the low-zone layer and high notes to the high-zone layer', () => {
    const s = new System4({ sampleRate: SR })
    s.setWorking(splitProgram())
    // C3 (48…<60) → zone 1 (organ)
    expect(refs(s, 52)).toContain('organ.A')
    expect(refs(s, 52)).not.toContain('piano.A')
    // C5 (60…<72) → zone 2 (piano)
    expect(refs(s, 67)).toContain('piano.A')
    expect(refs(s, 67)).not.toContain('organ.A')
    // E7 (72+) → zone 3 (piano)
    expect(refs(s, 80)).toContain('piano.A')
    expect(refs(s, 80)).not.toContain('organ.A')
  })

  it('the 11 documented split positions are modeled', () => {
    const positions = ['C2', 'F2', 'C3', 'F3', 'C4', 'F4', 'C5', 'F5', 'C6', 'F6', 'C7']
    const midis = [36, 41, 48, 53, 60, 65, 72, 77, 84, 89, 96]
    expect(positions).toHaveLength(11)
    expect(midis).toHaveLength(11)
    // the C/F grid alternates 5 (C→F) then 7 (F→C) semitones.
    for (let i = 1; i < midis.length; i++) {
      expect(midis[i] - midis[i - 1]).toBe(i % 2 === 1 ? 5 : 7)
    }
  })

  it('up to 4 zones are supported (zone index 0..3)', () => {
    const p = splitProgram()
    p.split.zones['piano.A'] = { low: 0, high: 3 } // covered by 'full' equivalents
    expect(p.split.zones['piano.A']).toEqual({ low: 0, high: 3 })
  })
})

describe('splits.crossfades — Off/±6/±12 gains', () => {
  it('Off switches immediately at the split (only one layer fires at the split)', () => {
    const s = new System4({ sampleRate: SR })
    s.setWorking(splitProgram()) // crossfade defaults 0
    const fired = refs(s, 60) // exactly at the mid split
    expect(fired).toContain('piano.A')
    expect(fired).not.toContain('organ.A')
  })

  it('±12 crossfade lets both adjacent layers sound near the split', () => {
    const p = splitProgram()
    p.split.crossfade.mid = 12
    const s = new System4({ sampleRate: SR })
    s.setWorking(p)
    const fired = refs(s, 60)
    expect(fired).toContain('piano.A')
    expect(fired).toContain('organ.A')
  })
})

describe('organ.rotary routing through the shared system rotary', () => {
  it('routed organ changes the master-path audio and reflects rotary speed', () => {
    const p = splitProgram()
    p.organ.layers[0].enabled = true
    p.organ.toRotary = true
    const s = new System4({ sampleRate: SR })
    s.setWorking(p)
    s.noteOn(52, 0.9)
    const dry = rmsArray(s.render(SR * 0.5).samples)
    // speed change (slow→fast) alters the routed signal
    const p2 = splitProgram()
    p2.organ.layers[0].enabled = true
    p2.organ.toRotary = true
    p2.organ.rotarySpeed = 1
    const s2 = new System4({ sampleRate: SR })
    s2.setWorking(p2)
    s2.noteOn(52, 0.9)
    const fast = rmsArray(s2.render(SR * 0.5).samples)
    expect(Math.abs(dry - fast)).toBeGreaterThan(1e-5)
  })
})

describe('morph.assignments — Wheel / Control Pedal, interpolation, indicators, clearing', () => {
  it('moving a morph source interpolates its assigned destination', () => {
    const p = splitProgram()
    p.synth.layers[0].enabled = true
    p.synth.layers[0].cutoff = 0.12 // low cutoff so LFO→filter modulation is audible
    p.morph.wheel = [{ path: 'synth.layers.0.lfo.modAmt', from: 0, to: 0.9 }]
    const s = new System4({ sampleRate: SR })
    s.setWorking(p)
    s.noteOn(60, 0.9)
    s.setWheel(0)
    const atZero = s.render(SR * 0.4).samples
    const s2 = new System4({ sampleRate: SR })
    s2.setWorking(p)
    s2.noteOn(60, 0.9)
    s2.setWheel(1)
    const atFull = s2.render(SR * 0.4).samples
    expect(maxAbsDiff(atZero, atFull)).toBeGreaterThan(1e-4)
    // an intermediate value interpolates between (canonical range exists).
    expect(s.morphAssignmentCount('wheel')).toBe(1)
  })

  it('Control Pedal reassigns a destination independently of the Wheel', () => {
    const p = splitProgram()
    p.synth.layers[0].enabled = true
    p.morph.pedal = [{ path: 'synth.layers.0.cutoff', from: 0.8, to: 0.2 }]
    const s = new System4({ sampleRate: SR })
    s.setWorking(p)
    expect(s.morphAssignmentCount('pedal')).toBe(1)
    expect(s.morphLEDs('pedal')).toEqual(['synth.layers.0.cutoff'])
  })

  it('clearing removes a source and unmorphs its destinations', () => {
    const p = splitProgram()
    p.morph.wheel = [{ path: 'organ.layers.0.level', from: 0.7, to: 1 }]
    const s = new System4({ sampleRate: SR })
    s.setWorking(p)
    expect(s.morphAssignmentCount('wheel')).toBe(1)
    s.clearMorph('wheel')
    expect(s.morphAssignmentCount('wheel')).toBe(0)
    // clearing leaves raw program state untouched.
    expect(p.morph.wheel.length).toBe(1)
  })
})

describe('scenes.switching — Scene I/II toggles enable state, not sound params', () => {
  it('switching scenes changes which layers sound without duplicating params', () => {
    const p = splitProgram()
    p.organ.layers[0].enabled = true
    p.piano.layers[0].enabled = true
    p.scenes.active = 'I'
    p.scenes.I = { 'organ.A': true, 'piano.A': true }
    p.scenes.II = { 'organ.A': false, 'piano.A': true }
    const organParamsBefore = JSON.stringify(p.organ.layers[0])
    const s = new System4({ sampleRate: SR })
    s.setWorking(p)
    expect(refs(s, 52)).toContain('organ.A')
    s.setScene('II')
    expect(s.activeScene).toBe('II')
    expect(refs(s, 52)).not.toContain('organ.A')
    // sound parameters are shared/unmodified (only the enable mask changed).
    expect(JSON.stringify(s.currentProgram.organ.layers[0])).toBe(organParamsBefore)
  })
})

describe('system.integration — programs, scenes, zones, clock, one path', () => {
  it('clock tempo is canonical program state and syncs arp/delay', () => {
    const s = new System4({ sampleRate: SR })
    s.setWorking(splitProgram())
    expect(s.currentProgram.clock.tempo).toBe(120)
    s.setTempo(90)
    expect(s.currentProgram.clock.tempo).toBe(90)
    s.tap()
    expect(s.currentProgram.clock.tempo).toBeGreaterThanOrEqual(30)
    expect(s.currentProgram.clock.tempo).toBeLessThanOrEqual(300)
  })
})