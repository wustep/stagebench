import { describe, expect, it } from 'vitest'
import { PresetLibrary, type ProgramState } from './Presets'

const PROGRAM: ProgramState = {
  name: 'Split Horizon',
  layers: { focusedLayer: 'synth-a', splitPoints: [60], layers: [] },
  organ: { model: 'b3', drawbars: [8, 7, 6, 5, 4, 3, 2, 1, 0], percussion: { enabled: true, harmonic: 3, soft: false, fast: true }, rotary: 'fast', drive: 0.4, activeNotes: [] },
  synth: { parameters: { oscillator: { waveform: 'sawtooth', shape: 0.5, detune: 0 }, filter: { type: 'lp24', frequency: 2400, resonance: 0.3, drive: 0.1 }, envelope: { attack: 0.01, decay: 0.4, sustain: 0.8, release: 0.7 }, modulation: { lfoRate: 4, lfoAmount: 0.2, destination: 'filter' } }, activeNotes: [] },
  effects: { 'synth-a': [{ type: 'chorus', mix: 0.4, bypassed: false, parameters: {} }] },
  morphs: [{ source: 'wheel', target: 'synth.filter', from: 20, to: 90, min: 0, max: 100 }],
}

describe('preset round-trip', () => {
  it('saves and loads a faithful deep copy of supported instrument state', () => {
    const library = new PresetLibrary()
    const id = library.save(PROGRAM)
    PROGRAM.organ.drawbars[0] = 0
    const loaded = library.load(id)
    expect(loaded?.name).toBe('Split Horizon')
    expect(loaded?.organ.drawbars[0]).toBe(8)
    expect(loaded?.layers.splitPoints).toEqual([60])
    expect(loaded?.effects['synth-a'][0].type).toBe('chorus')
    loaded!.name = 'Changed'
    expect(library.load(id)?.name).toBe('Split Horizon')
  })

  it('browses factory and user patches without throwing for missing IDs', () => {
    const library = new PresetLibrary([PROGRAM])
    library.save({ ...PROGRAM, name: 'User Lead' }, 'user-1')
    expect(library.list().map((preset) => preset.name)).toEqual(['Split Horizon', 'User Lead'])
    expect(library.load('missing')).toBeNull()
  })
})
