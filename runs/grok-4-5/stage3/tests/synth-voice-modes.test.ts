import { describe, expect, it } from 'vitest'
import { PianoEngine } from '../src/audio/piano-engine'
import { createMockContextFactory } from '../src/test/mock-audio'
import { LFO_DESTS, LFO_WAVES } from '../src/model/synth-types'

describe('synth.voice-modes', () => {
  it('poly mono legato and priority', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    engine.setPianoState({ sectionOn: false })
    engine.setSynthState({ sectionOn: true })
    engine.updateSynthLayer('A', { enabled: true, voiceMode: 'Poly' })
    engine.noteOn(60, 0.8)
    engine.noteOn(64, 0.8)
    expect(engine.getSynthVoiceCount()).toBe(2)
    engine.allNotesOff()

    engine.updateSynthLayer('A', { voiceMode: 'Mono' })
    engine.noteOn(60, 0.8)
    engine.noteOn(64, 0.8)
    expect(engine.getSynthVoiceCount()).toBe(1)
    engine.allNotesOff()

    engine.updateSynthLayer('A', { voiceMode: 'Legato', glide: 0.5, priority: 'High' })
    expect(engine.getSynthState().layers.A.priority).toBe('High')
    engine.noteOn(60, 0.8)
    engine.noteOn(67, 0.8)
    expect(engine.getSynthVoiceCount()).toBe(1)
    engine.dispose()
  })

  it('unison vibrato and LFO', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    engine.setSynthState({ sectionOn: true })
    engine.updateSynthLayer('A', {
      enabled: true,
      unison: 2,
      vibrato: 'On',
      vibratoRate: 5,
      vibratoAmount: 0.5,
      lfoWave: 'Triangle',
      lfoRate: 0.6,
      lfoAmount: 0.4,
      lfoDest: 'Filter Freq',
    })
    expect(LFO_WAVES).toContain('Sample & Hold')
    expect(LFO_DESTS).toContain('Osc Pitch')
    engine.noteOn(60, 0.8)
    expect(engine.getSynthVoiceCount()).toBe(1)
    expect(engine.getSynthState().layers.A.unison).toBe(2)
    expect(engine.getSynthState().layers.A.lfoDest).toBe('Filter Freq')
    engine.dispose()
  })
})
