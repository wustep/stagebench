import { describe, expect, it } from 'vitest'
import { waveformSignature } from '../src/audio/synth-engine'
import { ALL_REQUIRED_WAVEFORMS, WAVEFORMS_BY_CATEGORY, categoryOf } from '../src/model/synth-types'
import { PianoEngine } from '../src/audio/piano-engine'
import { createMockContextFactory } from '../src/test/mock-audio'

describe('synth.sources', () => {
  it('three layers with independent state', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    engine.setPianoState({ sectionOn: false })
    engine.setSynthState({ sectionOn: true })
    engine.updateSynthLayer('A', { enabled: true, waveform: 'Saw', level: 0.8 })
    engine.updateSynthLayer('B', { enabled: true, waveform: 'Square', level: 0.5 })
    engine.updateSynthLayer('C', { enabled: true, waveform: 'Sine', level: 0.3 })
    engine.noteOn(60, 0.8)
    expect(engine.getSynthVoiceCount()).toBe(3)
    engine.allNotesOff()
    engine.dispose()
  })

  it('required waveforms cover Pure Sync Multi Super FM-H', () => {
    expect(WAVEFORMS_BY_CATEGORY.Pure.length).toBeGreaterThanOrEqual(7)
    expect(WAVEFORMS_BY_CATEGORY.Sync).toContain('Sync Saw')
    expect(WAVEFORMS_BY_CATEGORY.Multi).toContain('Multi Saw')
    expect(WAVEFORMS_BY_CATEGORY.Super).toContain('Super Saw')
    expect(WAVEFORMS_BY_CATEGORY['FM-H']).toContain('FM 2-op (algorithm A)')
    expect(ALL_REQUIRED_WAVEFORMS.length).toBeGreaterThanOrEqual(13)
  })

  it('categories are audibly distinct signatures', () => {
    const cats = ['Saw', 'Sync Saw', 'Multi Saw', 'Super Saw', 'FM 2-op (algorithm A)'] as const
    const sigs = cats.map((w) => waveformSignature(w))
    for (let i = 0; i < sigs.length; i++) {
      for (let j = i + 1; j < sigs.length; j++) {
        expect(sigs[i]![0]).not.toBe(sigs[j]![0])
      }
    }
    expect(categoryOf('Pulse 10')).toBe('Pure')
    expect(categoryOf('Sync Square')).toBe('Sync')
    expect(categoryOf('Super Square')).toBe('Super')
  })

  it('Osc Ctrl behaves per category', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    engine.setSynthState({ sectionOn: true })
    engine.updateSynthLayer('A', { waveform: 'Sine', oscCtrl: 0.9, enabled: true })
    expect(engine.getSynthState().layers.A.oscCtrl).toBe(0.9)
    engine.updateSynthLayer('A', { waveform: 'Sync Saw', oscCtrl: 0.7 })
    expect(categoryOf(engine.getSynthState().layers.A.waveform)).toBe('Sync')
    engine.updateSynthLayer('A', { waveform: 'FM 2-op (algorithm A)', oscCtrl: 0.5 })
    engine.noteOn(60, 0.8)
    expect(engine.getSynthVoiceCount()).toBe(1)
    engine.dispose()
  })
})
