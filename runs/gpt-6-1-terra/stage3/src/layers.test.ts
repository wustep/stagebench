import { describe, expect, it, vi } from 'vitest'
import { LayeredPiano, type WebAudioBackend } from './audio'

describe('piano layer voice ownership', () => {
 it('releases only the non-sustained layer and cleans up a disabled layer', () => {
  const voices: { layer: number; note: number; release: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = []
  const backend = { start: (note: number, _velocity: number, layer: number) => { const voice = { layer, note, release: vi.fn(), stop: vi.fn() }; voices.push(voice); return voice }, stopAll: vi.fn(), close: vi.fn(), setPedal: vi.fn() }
  const piano = new LayeredPiano(backend as unknown as WebAudioBackend)
  piano.setEnabled(1, true); piano.setOctave(1, 1); piano.setSustainEnabled(1, false)
  piano.sustain(true); piano.on('c', 60, 90); piano.off('c')
  expect(voices.map(v => [v.layer, v.note])).toEqual([[0, 60], [1, 72]])
  expect(voices[0].release).not.toHaveBeenCalled(); expect(voices[1].release).toHaveBeenCalledOnce()
  piano.sustain(false); expect(voices[0].release).toHaveBeenCalledOnce()
  piano.on('d', 62, 100); piano.setEnabled(1, false)
  expect(voices[3].stop).toHaveBeenCalledOnce(); expect(voices[2].stop).not.toHaveBeenCalled()
  piano.close(); expect(voices[2].stop).toHaveBeenCalledOnce(); expect(backend.close).toHaveBeenCalledOnce()
 })
})
