import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { emptyKeys, NoteLifecycle } from './notes'

function instrument(limit = 3) {
  const playing: { release: Mock<(seconds?: number) => void>; stop: Mock<() => void>; ended: () => void }[] = []
  const output = {
    play: vi.fn((_note: number, _velocity: number, ended: () => void) => {
      const voice = { release: vi.fn(), stop: vi.fn(ended), ended }
      playing.push(voice)
      return voice
    }),
    stopAll: vi.fn(() => { for (const voice of playing) voice.stop() }),
  }
  const keys = vi.fn()
  return { notes: new NoteLifecycle(output, keys, limit), keys, playing, output }
}

describe('note ownership', () => {
  it('reattacks overlapping pitches and releases each source exactly once', () => {
    const { notes, playing, keys, output } = instrument()
    notes.press('a', 60, 30)
    notes.press('a', 60, 30)
    notes.press('b', 60, 95)
    expect(output.play).toHaveBeenCalledTimes(2)
    notes.release('a')
    notes.release('a')
    expect(playing[0].release).toHaveBeenCalledOnce()
    expect(playing[1].release).not.toHaveBeenCalled()
    expect(keys).toHaveBeenLastCalledWith({ held: new Set([60]), sustained: new Set() })
    notes.release('b')
    expect(playing[1].release).toHaveBeenCalledOnce()
    playing[0].ended()
    playing[1].ended()
    expect(keys).toHaveBeenLastCalledWith(emptyKeys)
  })

  it('steals releasing voices first, then sustained voices, then oldest pressed voices', () => {
    const { notes, playing, keys } = instrument()
    notes.press('held', 60, 80)
    notes.press('pedal', 62, 80)
    notes.press('tail', 64, 80)
    notes.release('tail')
    notes.sustain('local', true)
    notes.release('pedal')
    notes.press('new', 66, 80)
    expect(playing[2].release).toHaveBeenLastCalledWith(0.016)
    expect(playing[0].release).not.toHaveBeenCalled()
    notes.press('newer', 67, 80)
    expect(playing[1].release).toHaveBeenLastCalledWith(0.016)
    notes.press('newest', 69, 80)
    expect(playing[0].release).toHaveBeenLastCalledWith(0.016)
    expect(keys).toHaveBeenLastCalledWith({ held: new Set([60, 66, 67, 69]), sustained: new Set() })
    notes.allNotesOff()
    expect(keys).toHaveBeenLastCalledWith(emptyKeys)
    expect(playing.every((voice) => voice.stop.mock.calls.length === 1)).toBe(true)
  })
})
