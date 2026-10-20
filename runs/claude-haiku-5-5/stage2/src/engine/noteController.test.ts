import { describe, expect, it } from 'vitest'
import type { VoiceHandle, VoiceSink } from '../audio/pianoVoice'
import { MAX_POLYPHONY, NoteController } from './noteController'

interface RecordedVoice {
  note: number
  velocity: number
  released: boolean
  stopped: boolean
  end: () => void
  handle: VoiceHandle
}

/** A voice sink that records every voice and lets a test decide when each one ends. */
class RecordingSink implements VoiceSink {
  readonly voices: RecordedVoice[] = []

  start(note: number, velocity: number, onEnded: () => void): VoiceHandle {
    let finished = false
    const end = () => {
      if (finished) return
      finished = true
      onEnded()
    }
    const voice: RecordedVoice = {
      note,
      velocity,
      released: false,
      stopped: false,
      end,
      handle: {
        release: () => {
          voice.released = true
        },
        stop: () => {
          voice.stopped = true
          end()
        },
      },
    }
    this.voices.push(voice)
    return voice.handle
  }
}

function setup(maxPolyphony?: number) {
  const sink = new RecordingSink()
  const heldSnapshots: number[][] = []
  const controller = new NoteController(sink, {
    maxPolyphony,
    onHeldNotesChange: (held) => heldSnapshots.push(Array.from(held).sort((a, b) => a - b)),
  })
  return { sink, controller, heldSnapshots }
}

describe('note lifecycle', () => {
  it('starts a voice on note-on and releases it on note-off', () => {
    const { sink, controller } = setup()
    expect(controller.noteOn('pointer:1', 60, 100)).toBe(true)
    expect(sink.voices[0].note).toBe(60)
    expect(sink.voices[0].velocity).toBe(100)

    expect(controller.noteOff('pointer:1', 60)).toBe(true)
    expect(sink.voices[0].released).toBe(true)
  })

  it('ignores notes outside the 73-key range', () => {
    const { sink, controller } = setup()
    expect(controller.noteOn('midi', 27, 100)).toBe(false)
    expect(controller.noteOn('midi', 101, 100)).toBe(false)
    expect(sink.voices).toHaveLength(0)
  })

  it('suppresses a repeat from the same source while the note is held', () => {
    const { sink, controller } = setup()
    expect(controller.noteOn('key:KeyA', 60, 100)).toBe(true)
    expect(controller.noteOn('key:KeyA', 60, 100)).toBe(false)
    expect(sink.voices).toHaveLength(1)
  })

  it('lets overlapping presses of the same note from different sources sound independently', () => {
    const { sink, controller } = setup()
    controller.noteOn('pointer:1', 64, 100)
    controller.noteOn('midi', 64, 90)
    expect(sink.voices).toHaveLength(2)

    controller.noteOff('pointer:1', 64)
    expect(sink.voices[0].released).toBe(true)
    expect(sink.voices[1].released).toBe(false)
  })

  it('reports held notes for the presentation layer and clears them on release', () => {
    const { controller, heldSnapshots } = setup()
    controller.noteOn('pointer:1', 60, 100)
    controller.noteOn('pointer:2', 64, 100)
    controller.noteOff('pointer:1', 60)
    expect(heldSnapshots).toEqual([[60], [60, 64], [64]])
  })

  it('removes a voice from the active count when it ends', () => {
    const { sink, controller } = setup()
    controller.noteOn('pointer:1', 60, 100)
    expect(controller.activeVoiceCount).toBe(1)
    sink.voices[0].end()
    expect(controller.activeVoiceCount).toBe(0)
    expect(controller.heldNotes.size).toBe(0)
  })

  it('treats a note-off for a note that is not held as a no-op', () => {
    const { controller } = setup()
    expect(controller.noteOff('pointer:9', 60)).toBe(false)
  })
})

describe('sustain', () => {
  it('keeps a released note ringing while sustain is held, then releases it when sustain lifts', () => {
    const { sink, controller } = setup()
    controller.setSustain('pedal:ui', true)
    controller.noteOn('midi', 60, 100)
    controller.noteOff('midi', 60)
    expect(sink.voices[0].released).toBe(false)
    expect(controller.activeVoiceCount).toBe(1)

    controller.setSustain('pedal:ui', false)
    expect(sink.voices[0].released).toBe(true)
  })

  it('stays active while any sustain source holds it', () => {
    const { sink, controller } = setup()
    controller.setSustain('pedal:ui', true)
    controller.setSustain('midi', true)
    controller.noteOn('key:KeyA', 60, 100)
    controller.noteOff('key:KeyA', 60)

    controller.setSustain('pedal:ui', false)
    expect(controller.sustainActive).toBe(true)
    expect(sink.voices[0].released).toBe(false)

    controller.setSustain('midi', false)
    expect(controller.sustainActive).toBe(false)
    expect(sink.voices[0].released).toBe(true)
  })

  it('does not hold a note whose key is still down, and releases it on its own note-off after sustain lifts', () => {
    const { sink, controller } = setup()
    controller.setSustain('pedal:ui', true)
    controller.noteOn('pointer:1', 67, 100)
    controller.setSustain('pedal:ui', false)
    expect(sink.voices[0].released).toBe(false)
    controller.noteOff('pointer:1', 67)
    expect(sink.voices[0].released).toBe(true)
  })

  it('reports sustain changes once per transition', () => {
    const sink = new RecordingSink()
    const changes: boolean[] = []
    const controller = new NoteController(sink, { onSustainChange: (active) => changes.push(active) })
    controller.setSustain('pedal:ui', true)
    controller.setSustain('midi', true)
    controller.setSustain('pedal:ui', false)
    controller.setSustain('midi', false)
    expect(changes).toEqual([true, false])
  })
})

describe('polyphony and voice stealing', () => {
  it('caps concurrent voices at the polyphony limit', () => {
    const { sink, controller } = setup()
    for (let note = 40; note < 40 + MAX_POLYPHONY + 4; note += 1) {
      controller.noteOn(`pointer:${note}`, note, 100)
    }
    expect(controller.activeVoiceCount).toBe(MAX_POLYPHONY)
    expect(sink.voices.filter((voice) => voice.stopped)).toHaveLength(4)
  })

  it('steals the oldest released tail first, deterministically', () => {
    const { sink, controller } = setup(3)
    controller.noteOn('p:1', 60, 100)
    controller.noteOn('p:2', 62, 100)
    controller.noteOn('p:3', 64, 100)
    controller.noteOff('p:2', 62)
    controller.noteOn('p:4', 65, 100)

    expect(sink.voices[1].stopped).toBe(true)
    expect(sink.voices[0].stopped).toBe(false)
    expect(sink.voices[2].stopped).toBe(false)
  })

  it('then steals the oldest held voice when nothing is released', () => {
    const { sink, controller } = setup(2)
    controller.noteOn('p:1', 60, 100)
    controller.noteOn('p:2', 62, 100)
    controller.noteOn('p:3', 64, 100)
    expect(sink.voices[0].stopped).toBe(true)
    expect(sink.voices[1].stopped).toBe(false)
  })

  it('a stolen note cannot be released later and does not break the source that played it', () => {
    const { sink, controller } = setup(1)
    controller.noteOn('p:1', 60, 100)
    controller.noteOn('p:2', 62, 100)
    expect(sink.voices[0].stopped).toBe(true)
    expect(controller.noteOff('p:1', 60)).toBe(false)
    expect(controller.noteOff('p:2', 62)).toBe(true)
    expect(sink.voices[1].released).toBe(true)
  })
})

describe('cleanup', () => {
  it('allNotesOff releases every held and sustained voice', () => {
    const { sink, controller } = setup()
    controller.setSustain('pedal:ui', true)
    controller.noteOn('p:1', 60, 100)
    controller.noteOff('p:1', 60)
    controller.noteOn('p:2', 64, 100)
    controller.allNotesOff()
    expect(sink.voices.every((voice) => voice.released)).toBe(true)
    expect(controller.heldNotes.size).toBe(0)
  })

  it('releaseSource only touches the voices that source started', () => {
    const { sink, controller } = setup()
    controller.noteOn('midi', 60, 100)
    controller.noteOn('pointer:1', 64, 100)
    controller.releaseSource('midi')
    expect(sink.voices[0].released).toBe(true)
    expect(sink.voices[1].released).toBe(false)
  })

  it('stopAll hard-stops every owned voice and leaves no active voices', () => {
    const { sink, controller } = setup()
    controller.noteOn('p:1', 60, 100)
    controller.noteOn('p:2', 64, 100)
    controller.stopAll()
    expect(sink.voices.every((voice) => voice.stopped)).toBe(true)
    expect(controller.activeVoiceCount).toBe(0)
  })
})
