import { describe, expect, it } from 'vitest'
import { DEFAULT_MAX_VOICES, VoiceState, softLimit } from '../src/audio/dsp/kernel'
import { brightness, makeKernel, mono, peak, render, rms, rmsAt, timeToSilence } from './support/signal'

/**
 * Feature: piano.basic-sustain-polyphony
 * Sustain transitions, concurrent voices, deterministic stealing, velocity response —
 * plus the rule that nothing bypasses the master stage.
 */

describe('piano.basic-sustain-polyphony: sustain', () => {
  it('holds a released note while the pedal is down and damps it when the pedal comes up', () => {
    const kernel = makeKernel()
    const reference = makeKernel()
    reference.noteOn(60, 0.8)
    kernel.noteOn(60, 0.8)
    render(reference, 0.1)
    render(kernel, 0.1)

    kernel.setSustain(true)
    kernel.noteOff(60)
    expect(kernel.describeVoices()[0].state).toBe(VoiceState.Sustained)

    const sustained = mono(render(kernel, 0.6))
    const held = mono(render(reference, 0.6))
    // Pedal down: the note rings on just as if the key were still held.
    expect(rmsAt(sustained, 0.4, 0.2)).toBeGreaterThan(rmsAt(held, 0.4, 0.2) * 0.9)

    kernel.setSustain(false)
    expect(kernel.describeVoices()[0].state).toBe(VoiceState.Released)
    const damped = mono(render(kernel, 1))
    expect(rmsAt(damped, 0.5, 0.2)).toBeLessThan(rmsAt(sustained, 0.4, 0.2) * 0.05)
    expect(kernel.voiceCount).toBe(0)
  })

  it('makes the same short key press last much longer with the pedal than without', () => {
    const play = (pedal: boolean) => {
      const kernel = makeKernel()
      kernel.setSustain(pedal)
      kernel.noteOn(64, 0.8)
      render(kernel, 0.08)
      kernel.noteOff(64)
      return timeToSilence(mono(render(kernel, 4)), 1e-3)
    }
    const dry = play(false)
    const wet = play(true)
    expect(dry).toBeLessThan(0.6)
    expect(wet).toBeGreaterThan(dry * 3)
  })

  it('does not bring back a note that was released before the pedal went down', () => {
    const kernel = makeKernel()
    kernel.noteOn(60, 0.8)
    render(kernel, 0.1)
    kernel.noteOff(60)
    render(kernel, 0.02)
    kernel.setSustain(true)
    expect(kernel.describeVoices()[0].state).toBe(VoiceState.Released)
    render(kernel, 1)
    expect(kernel.voiceCount).toBe(0)
  })

  it('keeps notes whose keys are still down when the pedal comes up', () => {
    const kernel = makeKernel()
    kernel.setSustain(true)
    kernel.noteOn(60, 0.8)
    kernel.noteOn(64, 0.8)
    kernel.noteOff(64)
    kernel.setSustain(false)
    render(kernel, 1)
    expect(kernel.describeVoices().map((voice) => [voice.note, voice.state])).toEqual([[60, VoiceState.Held]])
  })

  it('treats repeated pedal-down and pedal-up messages as idempotent', () => {
    const kernel = makeKernel()
    kernel.noteOn(60, 0.8)
    kernel.setSustain(true)
    kernel.setSustain(true)
    kernel.noteOff(60)
    kernel.setSustain(false)
    kernel.setSustain(false)
    expect(kernel.describeVoices()[0].state).toBe(VoiceState.Released)
  })
})

describe('piano.basic-sustain-polyphony: polyphony and stealing', () => {
  it('sounds many notes at once', () => {
    const one = makeKernel()
    one.noteOn(60, 0.5)
    const many = makeKernel()
    const chord = [36, 43, 48, 52, 55, 60, 64, 67, 72, 76]
    for (const note of chord) many.noteOn(note, 0.5)
    expect(many.voiceCount).toBe(chord.length)
    expect(rms(mono(render(many, 0.3)))).toBeGreaterThan(rms(mono(render(one, 0.3))) * 1.5)
  })

  it('has at least 32 voices by default and never exceeds its limit', () => {
    expect(DEFAULT_MAX_VOICES).toBeGreaterThanOrEqual(32)
    const kernel = makeKernel()
    for (let note = 28; note <= 100; note += 1) {
      kernel.noteOn(note, 0.5)
      expect(kernel.soundingCount()).toBeLessThanOrEqual(DEFAULT_MAX_VOICES)
    }
    expect(kernel.soundingCount()).toBe(DEFAULT_MAX_VOICES)
  })

  it('steals the oldest held note when every voice is a held key', () => {
    const kernel = makeKernel({ maxVoices: 4 })
    for (const note of [60, 62, 64, 65]) {
      kernel.noteOn(note, 0.7)
      render(kernel, 0.01)
    }
    kernel.noteOn(67, 0.7)
    const voices = kernel.describeVoices()
    expect(voices.find((voice) => voice.note === 60)?.state).toBe(VoiceState.Killed)
    expect(voices.filter((voice) => voice.state === VoiceState.Held).map((voice) => voice.note)).toEqual([62, 64, 65, 67])
    expect(kernel.soundingCount()).toBe(4)

    // The stolen voice fades in milliseconds and its slot is returned.
    render(kernel, 0.1)
    expect(kernel.voiceCount).toBe(4)
  })

  it('steals a released voice before a pedal-held one, and a pedal-held one before a held key', () => {
    const released = makeKernel({ maxVoices: 3 })
    released.noteOn(60, 0.7)
    released.noteOn(62, 0.7)
    released.noteOn(64, 0.7)
    render(released, 0.05)
    released.noteOff(62) // newest of the three is irrelevant: 62 is the only released voice
    released.noteOn(65, 0.7)
    expect(released.describeVoices().find((voice) => voice.note === 62)?.state).toBe(VoiceState.Killed)
    expect(released.describeVoices().find((voice) => voice.note === 60)?.state).toBe(VoiceState.Held)

    const sustained = makeKernel({ maxVoices: 3 })
    sustained.setSustain(true)
    sustained.noteOn(60, 0.7)
    sustained.noteOn(62, 0.7)
    sustained.noteOn(64, 0.7)
    sustained.noteOff(64) // newest note, but it is only held by the pedal
    sustained.noteOn(65, 0.7)
    expect(sustained.describeVoices().find((voice) => voice.note === 64)?.state).toBe(VoiceState.Killed)
    expect(sustained.describeVoices().find((voice) => voice.note === 60)?.state).toBe(VoiceState.Held)
  })

  it('steals deterministically: the same sequence always picks the same victims', () => {
    const run = () => {
      const kernel = makeKernel({ maxVoices: 5 })
      const victims: number[] = []
      const sequence = [60, 64, 67, 72, 55, 48, 76, 79, 62, 65, 69, 50]
      sequence.forEach((note, index) => {
        if (index % 3 === 1) kernel.noteOff(sequence[index - 1])
        kernel.noteOn(note, 0.6)
        for (const voice of kernel.describeVoices()) {
          if (voice.state === VoiceState.Killed && !victims.includes(voice.note)) victims.push(voice.note)
        }
        render(kernel, 0.004)
      })
      return victims
    }
    const first = run()
    expect(first.length).toBeGreaterThan(3)
    expect(run()).toEqual(first)
    expect(run()).toEqual(first)
  })

  it('keeps the audio continuous when a voice is stolen (no dropout, no blow-up)', () => {
    const kernel = makeKernel({ maxVoices: 2 })
    kernel.noteOn(60, 0.8)
    kernel.noteOn(64, 0.8)
    render(kernel, 0.1)
    kernel.noteOn(67, 0.8)
    const out = mono(render(kernel, 0.1))
    expect(rms(out)).toBeGreaterThan(0.005)
    expect(peak(out)).toBeLessThanOrEqual(1)
  })
})

describe('piano.basic-sustain-polyphony: velocity response', () => {
  const strike = (velocity: number) => {
    const kernel = makeKernel()
    kernel.noteOn(60, velocity)
    return mono(render(kernel, 0.4))
  }

  it('gets louder as velocity rises', () => {
    const levels = [0.15, 0.35, 0.6, 0.8, 1].map((velocity) => rms(strike(velocity)))
    for (let index = 1; index < levels.length; index += 1) {
      expect(levels[index]).toBeGreaterThan(levels[index - 1] * 1.2)
    }
    // A wide, usable dynamic range between the softest and hardest strike.
    expect(levels[levels.length - 1] / levels[0]).toBeGreaterThan(10)
  })

  it('gets brighter as velocity rises, not just louder', () => {
    const soft = brightness(strike(0.2))
    const medium = brightness(strike(0.6))
    const hard = brightness(strike(1))
    expect(medium).toBeGreaterThan(soft * 1.1)
    expect(hard).toBeGreaterThan(medium * 1.1)
  })

  it('treats velocity zero as a note off, as MIDI does', () => {
    const kernel = makeKernel()
    kernel.noteOn(60, 0.8)
    kernel.noteOn(60, 0)
    expect(kernel.describeVoices()[0].state).toBe(VoiceState.Released)
    const silent = makeKernel()
    silent.noteOn(60, 0)
    expect(silent.voiceCount).toBe(0)
  })
})

describe('piano.basic-sustain-polyphony: master path', () => {
  it('scales everything with the master gain, and gain zero is exact silence', () => {
    const play = (gain: number) => {
      const kernel = makeKernel()
      kernel.setMasterGain(gain)
      kernel.noteOn(60, 0.5)
      kernel.noteOn(67, 0.5)
      return mono(render(kernel, 0.3))
    }
    const full = rms(play(0.7))
    const half = rms(play(0.35))
    expect(half / full).toBeGreaterThan(0.45)
    expect(half / full).toBeLessThan(0.55)
    expect(peak(play(0))).toBe(0)
  })

  it('never exceeds full scale, even with every voice struck as hard as possible', () => {
    const kernel = makeKernel()
    kernel.setSustain(true)
    for (let note = 36; note < 36 + DEFAULT_MAX_VOICES; note += 1) kernel.noteOn(note, 1)
    const out = render(kernel, 0.5)
    expect(peak(out.left)).toBeLessThanOrEqual(1)
    expect(peak(out.right)).toBeLessThanOrEqual(1)
    expect(rms(out.left)).toBeGreaterThan(0.1)
  })

  it('uses a limiter that is transparent at normal levels and bounded above them', () => {
    expect(softLimit(0.3)).toBe(0.3)
    expect(softLimit(-0.5)).toBe(-0.5)
    expect(softLimit(0.8)).toBeLessThan(0.8)
    expect(softLimit(0.8)).toBeGreaterThan(0.5)
    expect(softLimit(50)).toBeLessThanOrEqual(1)
    expect(softLimit(-50)).toBeGreaterThanOrEqual(-1)
    expect(softLimit(-0.9)).toBeCloseTo(-softLimit(0.9), 12)
  })
})
