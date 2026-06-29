import { describe, expect, it, vi } from 'vitest'
import { SynthEngine, type SynthAudioBackend, type SynthVoice } from './SynthEngine'

class FakeSynthAudio implements SynthAudioBackend {
  starts: SynthVoice[] = []
  stops: SynthVoice[] = []
  startVoice(layer: string, midi: number, velocity: number, parameters: Parameters<SynthAudioBackend['startVoice']>[3]) {
    const voice = { id: `${layer}-${midi}-${this.starts.length}`, layer, midi, velocity, parameters }
    this.starts.push(voice)
    return voice
  }
  stopVoice(voice: SynthVoice) { this.stops.push(voice) }
  update = vi.fn()
  async resume() {}
}

describe('SynthEngine', () => {
  it('clamps oscillator, filter, envelope and modulation parameters', () => {
    const audio = new FakeSynthAudio()
    const synth = new SynthEngine(audio)
    synth.setOscillator({ waveform: 'square', shape: 1.2, detune: -120 })
    synth.setFilter({ type: 'hp24', frequency: 22000, resonance: -1, drive: 2 })
    synth.setEnvelope({ attack: -1, decay: 3, sustain: 2, release: 11 })
    synth.setModulation({ lfoRate: 22, lfoAmount: -1, destination: 'pitch' })
    expect(synth.snapshot().parameters).toMatchObject({
      oscillator: { waveform: 'square', shape: 1, detune: -100 },
      filter: { type: 'hp24', frequency: 20000, resonance: 0, drive: 1 },
      envelope: { attack: 0, decay: 3, sustain: 1, release: 10 },
      modulation: { lfoRate: 20, lfoAmount: 0, destination: 'pitch' },
    })
    expect(audio.update).toHaveBeenCalled()
  })

  it('uses a parameter snapshot for layer-aware note lifecycle', () => {
    const audio = new FakeSynthAudio()
    const synth = new SynthEngine(audio)
    synth.setOscillator({ waveform: 'sawtooth' })
    synth.noteOn('synth-a', 64, 111)
    synth.noteOn('synth-b', 67, 99)
    expect(audio.starts[0].parameters.oscillator.waveform).toBe('sawtooth')
    synth.noteOff('synth-a', 64)
    expect(synth.snapshot().activeNotes).toEqual([{ layer: 'synth-b', midi: 67 }])
    synth.allNotesOff()
    expect(audio.stops).toHaveLength(2)
  })
})
