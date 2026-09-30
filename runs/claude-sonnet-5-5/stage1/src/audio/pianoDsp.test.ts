import { describe, expect, it } from 'vitest'
import {
  bufferSeconds,
  decayTau,
  midiToHz,
  releaseSeconds,
  renderPianoNote,
  rms,
  velocityGain,
  velocityLayer,
} from './pianoDsp'

const SR = 16000

/** energy above 2 kHz relative to the total, via a crude one-pole high-pass */
const brightness = (samples: Float32Array): number => {
  let prev = 0
  let hp = 0
  let hpEnergy = 0
  let total = 0
  for (const s of samples) {
    hp = 0.6 * (hp + s - prev)
    prev = s
    hpEnergy += hp * hp
    total += s * s
  }
  return hpEnergy / (total || 1)
}

describe('piano.basic-sustain-polyphony — generated voice signal', () => {
  it('a rendered note differs from silence', () => {
    const out = renderPianoNote(60, 90, SR)
    expect(out.length).toBeGreaterThan(SR)
    expect(rms(out)).toBeGreaterThan(0.02)
    expect(Math.max(...out.map(Math.abs))).toBeCloseTo(1, 1)
  })

  it('is deterministic', () => {
    const a = renderPianoNote(64, 100, SR)
    const b = renderPianoNote(64, 100, SR)
    expect(Array.from(a.slice(0, 500))).toEqual(Array.from(b.slice(0, 500)))
  })

  it('different notes have different pitch content', () => {
    const zeroCrossings = (x: Float32Array) => {
      let n = 0
      for (let i = 1; i < 4000; i++) if (x[i - 1] < 0 && x[i] >= 0) n++
      return n
    }
    const low = zeroCrossings(renderPianoNote(48, 90, SR))
    const high = zeroCrossings(renderPianoNote(72, 90, SR))
    expect(high).toBeGreaterThan(low * 2.5)
    expect(midiToHz(69)).toBe(440)
  })

  it('velocity moves the output level in the expected direction', () => {
    expect(velocityGain(120)).toBeGreaterThan(velocityGain(60))
    expect(velocityGain(60)).toBeGreaterThan(velocityGain(20))
    expect(velocityGain(1)).toBeGreaterThan(0)
    expect(velocityGain(127)).toBeLessThanOrEqual(1)
    const soft = renderPianoNote(60, 20, SR)
    const hard = renderPianoNote(60, 120, SR)
    const softLevel = rms(soft) * velocityGain(20)
    const hardLevel = rms(hard) * velocityGain(120)
    expect(hardLevel).toBeGreaterThan(softLevel * 3)
  })

  it('harder strikes are brighter, softer strikes are darker', () => {
    expect(velocityLayer(10)).toBe(0)
    expect(velocityLayer(127)).toBe(3)
    expect(brightness(renderPianoNote(60, 120, SR))).toBeGreaterThan(brightness(renderPianoNote(60, 20, SR)))
  })

  it('the note decays: late energy is well below early energy', () => {
    const out = renderPianoNote(60, 90, SR)
    const early = rms(out, SR * 0.05, SR * 0.4)
    const late = rms(out, SR * 1.2, SR * 1.5)
    expect(late).toBeLessThan(early * 0.7)
  })

  it('low notes ring longer and release slower than high notes', () => {
    expect(decayTau(36)).toBeGreaterThan(decayTau(96))
    expect(bufferSeconds(36)).toBeGreaterThan(bufferSeconds(96))
    expect(releaseSeconds(36)).toBeGreaterThan(releaseSeconds(96))
  })

  it('release changes duration: a released note is silent sooner than a sustained one', () => {
    const note = renderPianoNote(60, 90, SR)
    const end = Math.floor(SR * 1.0)
    const noteOff = Math.floor(SR * 0.2)
    const releaseSamples = Math.floor(releaseSeconds(60) * SR)
    const sustained = rms(note, end - 2000, end)
    // apply the same linear release the sink schedules
    const released = new Float32Array(note.length)
    for (let i = 0; i < note.length; i++) {
      const g = i < noteOff ? 1 : Math.max(0, 1 - (i - noteOff) / releaseSamples)
      released[i] = note[i] * g
    }
    expect(rms(released, end - 2000, end)).toBe(0)
    expect(sustained).toBeGreaterThan(0.005)
  })
})
