import { describe, expect, it, vi } from 'vitest'
import { OrganEngine, type OrganAudioBackend, type OrganVoice } from './OrganEngine'

class FakeOrganAudio implements OrganAudioBackend {
  starts: OrganVoice[] = []
  stops: OrganVoice[] = []
  startVoice(layer: string, midi: number, velocity: number, harmonics: number[]) {
    const voice = { id: `${layer}-${midi}-${this.starts.length}`, layer, midi, velocity, harmonics }
    this.starts.push(voice)
    return voice
  }
  stopVoice(voice: OrganVoice) { this.stops.push(voice) }
  setRotary = vi.fn()
  setDrive = vi.fn()
  async resume() {}
}

describe('OrganEngine', () => {
  it('models drawbars, six organ models, percussion and rotary', () => {
    const audio = new FakeOrganAudio()
    const organ = new OrganEngine(audio)
    organ.setModel('vox')
    organ.setDrawbar(0, 8)
    organ.setDrawbar(8, -2)
    organ.setPercussion({ enabled: true, harmonic: 3, soft: true, fast: true })
    organ.setRotary('fast')
    organ.setDrive(1.4)
    expect(organ.snapshot()).toMatchObject({
      model: 'vox', drawbars: [8, 5, 4, 3, 2, 2, 1, 1, 0],
      percussion: { enabled: true, harmonic: 3, soft: true, fast: true },
      rotary: 'fast', drive: 1,
    })
    expect(audio.setRotary).toHaveBeenCalledWith('fast')
  })

  it('starts, retriggers and releases notes independently per layer', () => {
    const audio = new FakeOrganAudio()
    const organ = new OrganEngine(audio)
    organ.noteOn('organ-a', 60, 100)
    organ.noteOn('organ-b', 60, 90)
    organ.noteOn('organ-a', 60, 80)
    expect(audio.starts).toHaveLength(3)
    expect(audio.starts[0].harmonics).toHaveLength(9)
    expect(audio.stops[0]).toBe(audio.starts[0])
    organ.noteOff('organ-a', 60)
    expect(organ.snapshot().activeNotes).toEqual([{ layer: 'organ-b', midi: 60 }])
    organ.allNotesOff()
    expect(organ.snapshot().activeNotes).toEqual([])
  })
})
