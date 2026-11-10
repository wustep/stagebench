import { describe, expect, it } from 'vitest'
import { VoiceState, midiToFrequency } from '../src/audio/dsp/kernel'
import { NoteLifecycle, clampVelocity, type NoteSink } from '../src/input/noteLifecycle'
import { equal, magnitudeAt, makeKernel, mono, peak, render, rms, rmsAt } from './support/signal'

/**
 * Feature: piano.basic-note-lifecycle
 * Note on/off, repeated and overlapping notes, release, all-notes-off, node cleanup.
 *
 * The kernel under test is the production synthesis code; every assertion about sound is
 * made on rendered samples.
 */

function recorder() {
  const calls: string[] = []
  const sink: NoteSink = {
    noteOn: (note, velocity) => calls.push(`on ${note} ${velocity.toFixed(2)}`),
    noteOff: (note) => calls.push(`off ${note}`),
    setSustain: (down) => calls.push(`sustain ${down}`),
    allNotesOff: () => calls.push('all-off'),
  }
  return { calls, sink }
}

describe('piano.basic-note-lifecycle: the voice', () => {
  it('is exactly silent until a note is struck, then is not', () => {
    const kernel = makeKernel()
    const before = render(kernel, 0.1)
    expect(peak(before.left)).toBe(0)
    expect(peak(before.right)).toBe(0)
    expect(kernel.voiceCount).toBe(0)

    kernel.noteOn(60, 0.8)
    const after = render(kernel, 0.2)
    expect(rms(after.left)).toBeGreaterThan(0.005)
    expect(rms(after.right)).toBeGreaterThan(0.005)
    expect(kernel.voiceCount).toBe(1)
  })

  it('plays the pitch of the key that was struck', () => {
    for (const note of [45, 57, 69, 81]) {
      const kernel = makeKernel()
      kernel.noteOn(note, 0.7)
      const signal = mono(render(kernel, 0.5))
      const onPitch = magnitudeAt(signal, midiToFrequency(note))
      const semitoneUp = magnitudeAt(signal, midiToFrequency(note + 1))
      const tritoneUp = magnitudeAt(signal, midiToFrequency(note + 6))
      expect(onPitch).toBeGreaterThan(semitoneUp * 4)
      expect(onPitch).toBeGreaterThan(tritoneUp * 8)
    }
  })

  it('starts without a click and decays like a struck string, not like an organ', () => {
    const kernel = makeKernel()
    kernel.noteOn(60, 0.8)
    const signal = mono(render(kernel, 2))
    // First sample is (near) zero: the attack ramps in.
    expect(Math.abs(signal[0])).toBeLessThan(0.01)
    const early = rmsAt(signal, 0.02, 0.2)
    const late = rmsAt(signal, 1.7, 0.2)
    expect(late).toBeLessThan(early * 0.6)
    expect(late).toBeGreaterThan(0)
  })

  it('releases on note off: a released note dies away far sooner than a held one', () => {
    const held = makeKernel()
    const released = makeKernel()
    held.noteOn(60, 0.8)
    released.noteOn(60, 0.8)
    render(held, 0.1)
    render(released, 0.1)
    released.noteOff(60)

    const heldTail = mono(render(held, 1))
    const releasedTail = mono(render(released, 1))
    expect(rmsAt(releasedTail, 0.5, 0.2)).toBeLessThan(rmsAt(heldTail, 0.5, 0.2) * 0.05)
    // The release is a fade, not a cut: right after note-off there is still signal.
    expect(rmsAt(releasedTail, 0, 0.02)).toBeGreaterThan(rmsAt(heldTail, 0, 0.02) * 0.3)

    expect(held.voiceCount).toBe(1)
    expect(released.voiceCount).toBe(0)
  })

  it('note off for a key that is not sounding does nothing', () => {
    const kernel = makeKernel()
    kernel.noteOn(60, 0.8)
    kernel.noteOff(72)
    render(kernel, 0.3)
    expect(kernel.describeVoices()).toEqual([expect.objectContaining({ note: 60, state: VoiceState.Held })])
  })

  it('repeated strikes of one key replace the ringing string instead of stacking voices', () => {
    const kernel = makeKernel()
    kernel.noteOn(60, 0.7)
    render(kernel, 0.6)
    const beforeRestrike = rmsAt(mono(render(kernel, 0.1)), 0, 0.1)

    kernel.noteOn(60, 0.7)
    kernel.noteOn(60, 0.7)
    const held = kernel.describeVoices().filter((voice) => voice.state === VoiceState.Held)
    expect(held).toHaveLength(1)

    const afterRestrike = mono(render(kernel, 0.4))
    // The new strike is audible over the decayed old one…
    expect(rmsAt(afterRestrike, 0.02, 0.1)).toBeGreaterThan(beforeRestrike * 1.2)
    // …and the replaced vibrations have faded out and been freed.
    expect(kernel.voiceCount).toBe(1)
  })

  it('overlapping notes are independent voices with independent releases', () => {
    const kernel = makeKernel()
    kernel.noteOn(60, 0.7)
    render(kernel, 0.05)
    kernel.noteOn(64, 0.7)
    render(kernel, 0.05)
    kernel.noteOn(67, 0.7)
    expect(kernel.voiceCount).toBe(3)

    const chord = mono(render(kernel, 0.3))
    for (const note of [60, 64, 67]) {
      expect(magnitudeAt(chord, midiToFrequency(note))).toBeGreaterThan(0.005)
    }

    kernel.noteOff(64)
    render(kernel, 0.8)
    const after = mono(render(kernel, 0.3))
    expect(kernel.describeVoices().map((voice) => voice.note)).toEqual([60, 67])
    expect(magnitudeAt(after, midiToFrequency(64))).toBeLessThan(magnitudeAt(after, midiToFrequency(60)) * 0.1)
    expect(magnitudeAt(after, midiToFrequency(67))).toBeGreaterThan(0.001)
  })

  it('all-notes-off stops every voice, lifts the pedal, and returns to exact silence', () => {
    const kernel = makeKernel()
    kernel.setSustain(true)
    for (const note of [40, 52, 60, 64, 67, 72, 84]) kernel.noteOn(note, 0.9)
    kernel.noteOff(60)
    render(kernel, 0.2)
    expect(kernel.voiceCount).toBe(7)

    kernel.allNotesOff()
    expect(kernel.sustainDown).toBe(false)
    const tail = render(kernel, 0.5)
    expect(kernel.voiceCount).toBe(0)
    expect(kernel.soundingCount()).toBe(0)
    const lastBlock = tail.left.subarray(tail.left.length - 128)
    expect(peak(lastBlock)).toBe(0)
  })

  it('frees a voice once its note has rung out, even while the key is still down', () => {
    const kernel = makeKernel()
    kernel.noteOn(96, 0.8)
    render(kernel, 8)
    expect(kernel.voiceCount).toBe(0)
  })

  it('returns voice bookkeeping to baseline after a long burst of notes', () => {
    const kernel = makeKernel()
    for (let round = 0; round < 6; round += 1) {
      for (let note = 36; note < 96; note += 3) {
        kernel.noteOn(note, 0.6)
        render(kernel, 0.01)
        kernel.noteOff(note)
      }
    }
    render(kernel, 1.5)
    expect(kernel.voiceCount).toBe(0)
    expect(kernel.describeVoices()).toEqual([])
    expect(peak(render(kernel, 0.05).left)).toBe(0)
  })

  it('renders the same samples for the same input', () => {
    const play = () => {
      const kernel = makeKernel()
      kernel.noteOn(48, 0.6)
      render(kernel, 0.05)
      kernel.noteOn(64, 0.9)
      const out = render(kernel, 0.3)
      return out
    }
    const first = play()
    const second = play()
    expect(equal(first.left, second.left)).toBe(true)
    expect(equal(first.right, second.right)).toBe(true)
  })
})

describe('piano.basic-note-lifecycle: the shared lifecycle', () => {
  const range = { lowNote: 28, highNote: 100 }

  it('turns a press and release into one note on and one note off', () => {
    const { calls, sink } = recorder()
    const lifecycle = new NoteLifecycle(sink, range)
    expect(lifecycle.press('pointer:1', 60, 0.8)).toBe(true)
    expect(lifecycle.isHeld(60)).toBe(true)
    lifecycle.release('pointer:1', 60)
    expect(lifecycle.isHeld(60)).toBe(false)
    expect(calls).toEqual(['on 60 0.80', 'off 60'])
  })

  it('ignores a repeated press from the same source and a release from a stranger', () => {
    const { calls, sink } = recorder()
    const lifecycle = new NoteLifecycle(sink, range)
    lifecycle.press('kbd:KeyA', 60, 0.7)
    expect(lifecycle.press('kbd:KeyA', 60, 0.7)).toBe(false)
    lifecycle.release('pointer:9', 60)
    expect(calls).toEqual(['on 60 0.70'])
    expect(lifecycle.isHeld(60)).toBe(true)
  })

  it('re-strikes when a second source presses a held note, and releases only with the last holder', () => {
    const { calls, sink } = recorder()
    const lifecycle = new NoteLifecycle(sink, range)
    lifecycle.press('pointer:1', 60, 0.5)
    lifecycle.press('midi:in:0', 60, 0.9)
    lifecycle.release('pointer:1', 60)
    expect(lifecycle.isHeld(60)).toBe(true)
    lifecycle.release('midi:in:0', 60)
    expect(calls).toEqual(['on 60 0.50', 'on 60 0.90', 'off 60'])
  })

  it('rejects notes outside the 73-key range', () => {
    const { calls, sink } = recorder()
    const lifecycle = new NoteLifecycle(sink, range)
    expect(lifecycle.press('midi:in:0', 27, 0.8)).toBe(false)
    expect(lifecycle.press('midi:in:0', 101, 0.8)).toBe(false)
    expect(lifecycle.press('midi:in:0', 60.5, 0.8)).toBe(false)
    expect(lifecycle.press('midi:in:0', 28, 0.8)).toBe(true)
    expect(lifecycle.press('midi:in:0', 100, 0.8)).toBe(true)
    expect(calls).toEqual(['on 28 0.80', 'on 100 0.80'])
  })

  it('drops everything one source holds without touching other sources', () => {
    const { calls, sink } = recorder()
    const lifecycle = new NoteLifecycle(sink, range)
    lifecycle.press('midi:a:0', 60, 0.8)
    lifecycle.press('midi:a:1', 62, 0.8)
    lifecycle.press('midi:b:0', 64, 0.8)
    lifecycle.setSustain('midi:a:0', true)
    calls.length = 0
    lifecycle.releaseSource('midi:a')
    expect(calls).toEqual(['off 60', 'off 62', 'sustain false'])
    expect(lifecycle.getSnapshot()).toEqual({ held: [64], sustain: false })
  })

  it('all-notes-off clears holders and the pedal and tells the sink', () => {
    const { calls, sink } = recorder()
    const lifecycle = new NoteLifecycle(sink, range)
    lifecycle.press('pointer:1', 60, 0.8)
    lifecycle.setSustain('kbd:sustain', true)
    calls.length = 0
    lifecycle.allNotesOff()
    expect(calls).toEqual(['all-off'])
    expect(lifecycle.getSnapshot()).toEqual({ held: [], sustain: false })
    // A late release for a note that was cleared is harmless.
    lifecycle.release('pointer:1', 60)
    expect(calls).toEqual(['all-off'])
  })

  it('publishes held notes in order and only when something changed', () => {
    const { sink } = recorder()
    const lifecycle = new NoteLifecycle(sink, range)
    let notifications = 0
    const unsubscribe = lifecycle.subscribe(() => {
      notifications += 1
    })
    lifecycle.press('a', 67, 0.5)
    lifecycle.press('a', 60, 0.5)
    lifecycle.press('b', 60, 0.5)
    expect(lifecycle.getSnapshot().held).toEqual([60, 67])
    expect(notifications).toBe(2)
    unsubscribe()
    expect(lifecycle.listenerCount).toBe(0)
  })

  it('clamps velocities into the playable range', () => {
    expect(clampVelocity(2)).toBe(1)
    expect(clampVelocity(-1)).toBe(0.02)
    expect(clampVelocity(Number.NaN)).toBe(0.7)
    expect(clampVelocity(0.5)).toBe(0.5)
  })
})
