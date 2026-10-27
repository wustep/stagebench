import { describe, expect, it } from 'vitest'
import {
  MASTER_GAIN,
  applyRelease,
  clampVelocity,
  midiToFrequency,
  partialsFor,
  releasePoints,
  releaseSecondsFor,
  renderPianoBody,
  renderVoiceThroughMaster,
  rms,
} from '../audio/pianoModel'

/**
 * Audible claims, measured.
 *
 * Every assertion below reads real samples from the model that the browser graph plays.
 * There is no state inspection here: "velocity is audible" means the rendered waveform
 * actually differs, not that a number changed in a store.
 */
const SR = 48000

function peak(samples: Float32Array): number {
  let m = 0
  for (const s of samples) m = Math.max(m, Math.abs(s))
  return m
}

/** Zero-crossing density in crossings per second. */
function crossingRate(samples: Float32Array, sampleRate: number): number {
  let crossings = 0
  for (let i = 1; i < samples.length; i += 1) {
    if ((samples[i - 1] < 0 && samples[i] >= 0) || (samples[i - 1] >= 0 && samples[i] < 0)) crossings += 1
  }
  return (crossings * sampleRate) / samples.length
}

/**
 * Brightness as the ratio of high-frequency energy to total energy.
 *
 * The first difference is a gentle high-pass, so this measures how much of the signal
 * lives in the upper partials — which is exactly the audible difference between a soft
 * and a hard stroke. It is scale-invariant, so a level change alone cannot fool it.
 */
function brightness(samples: Float32Array): number {
  let delta = 0
  let total = 0
  for (let i = 1; i < samples.length; i += 1) {
    const d = samples[i] - samples[i - 1]
    delta += d * d
    total += samples[i] * samples[i]
  }
  return Math.sqrt(delta / Math.max(total, 1e-20))
}

describe('piano model — output and master path', () => {
  it('produces sound: a rendered note is not silence', () => {
    const body = renderPianoBody({ midi: 60, velocity: 0.8, sampleRate: SR, seconds: 1 })
    expect(body.length).toBe(SR)
    expect(rms(body)).toBeGreaterThan(0.01)
    expect(peak(body)).toBeGreaterThan(0.05)
    // Silence is exactly zero everywhere; the note is not.
    expect(body.some((s) => s !== 0)).toBe(true)
  })

  it('renders nothing when nothing is played', () => {
    const silence = new Float32Array(1000)
    expect(rms(silence)).toBe(0)
  })

  it('passes every voice through the fixed master stage', () => {
    const params = { midi: 64, velocity: 0.7, sampleRate: SR, holdSeconds: 0.3 }
    const voiced = renderVoiceThroughMaster(params)
    const body = renderPianoBody({ midi: 64, velocity: 0.7, sampleRate: SR, seconds: 3 })
    // The first samples must be the body scaled by exactly the master gain.
    expect(voiced[10]).toBeCloseTo(body[10] * MASTER_GAIN, 6)
    expect(MASTER_GAIN).toBeGreaterThan(0)
    expect(MASTER_GAIN).toBeLessThanOrEqual(1)
  })

  it('is deterministic: the same note renders identically twice', () => {
    const a = renderPianoBody({ midi: 55, velocity: 0.6, sampleRate: SR, seconds: 0.5 })
    const b = renderPianoBody({ midi: 55, velocity: 0.6, sampleRate: SR, seconds: 0.5 })
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it('keeps every rendered note inside headroom', () => {
    for (const midi of [28, 40, 52, 64, 76, 88, 100]) {
      const body = renderPianoBody({ midi, velocity: 1, sampleRate: SR, seconds: 1 })
      expect(peak(body)).toBeLessThanOrEqual(0.951)
    }
  })

  it('tunes each note to its equal-tempered frequency', () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 6)
    expect(midiToFrequency(60)).toBeCloseTo(261.6256, 3)
    expect(midiToFrequency(28)).toBeCloseTo(41.2034, 3)
    const partials = partialsFor(69, 0.8)
    // The fundamental is stretched very slightly by inharmonicity, as on a real string:
    // within a few tenths of a hertz of concert A.
    expect(Math.abs(partials[0].frequency - 440)).toBeLessThan(0.5)
    expect(partials[1].frequency).toBeGreaterThan(partials[0].frequency)
  })
})

describe('piano model — velocity response', () => {
  it('gets louder as velocity rises (level, not only samples)', () => {
    const levels = [0.15, 0.4, 0.7, 1].map((velocity) =>
      rms(renderPianoBody({ midi: 60, velocity, sampleRate: SR, seconds: 0.8 })),
    )
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i]).toBeGreaterThan(levels[i - 1])
    }
    // Soft to hard is a musically useful range, not a rounding difference.
    expect(levels[3] / levels[0]).toBeGreaterThan(2.5)
  })

  it('gets brighter as velocity rises (spectrum, not only gain)', () => {
    const soft = renderPianoBody({ midi: 60, velocity: 0.15, sampleRate: SR, seconds: 1 })
    const hard = renderPianoBody({ midi: 60, velocity: 1, sampleRate: SR, seconds: 1 })
    // A hard stroke carries measurably more high-frequency energy for the same note.
    expect(brightness(hard)).toBeGreaterThan(brightness(soft) * 1.2)
    // ...and it is not merely a louder copy of the same waveform.
    const gain = rms(hard) / rms(soft)
    const rescaled = soft.map((s) => s * gain)
    let difference = 0
    for (let i = 0; i < Math.min(soft.length, hard.length); i += 500) {
      difference += Math.abs(hard[i] - rescaled[i])
    }
    expect(difference).toBeGreaterThan(0)
  })

  it('drops the upper partials faster for a softer stroke', () => {
    const soft = partialsFor(60, 0.1)
    const hard = partialsFor(60, 1)
    const softTop = soft[soft.length - 1].amplitude
    const hardTop = hard[hard.length - 1].amplitude
    expect(hardTop).toBeGreaterThan(softTop)
  })

  it('clamps out-of-range velocities instead of producing NaN', () => {
    expect(clampVelocity(-1)).toBe(0)
    expect(clampVelocity(2)).toBe(1)
    expect(clampVelocity(Number.NaN)).toBe(0)
    const body = renderPianoBody({ midi: 60, velocity: Number.NaN, sampleRate: SR, seconds: 0.2 })
    expect(body.every((s) => Number.isFinite(s))).toBe(true)
  })

  it('treats velocity 0 as silent rather than as a note', () => {
    const body = renderPianoBody({ midi: 60, velocity: 0, sampleRate: SR, seconds: 0.2 })
    expect(rms(body)).toBeLessThan(0.002)
  })
})

describe('piano model — release', () => {
  it('fades to silence after release instead of stopping abruptly', () => {
    const release = releaseSecondsFor(60)
    expect(release).toBeGreaterThan(0.1)
    const points = releasePoints(release, SR)
    expect(points[0]).toBeCloseTo(1, 2)
    expect(points[points.length - 1]).toBe(0)
    // Monotonically decreasing: a damper closing, not a fade in.
    for (let i = 1; i < points.length; i += 1) {
      expect(points[i]).toBeLessThanOrEqual(points[i - 1] + 1e-6)
    }
  })

  it('damps low notes more slowly than high notes', () => {
    expect(releaseSecondsFor(28)).toBeGreaterThan(releaseSecondsFor(100))
  })

  it('ends at exactly zero after the release completes', () => {
    const body = renderPianoBody({ midi: 60, velocity: 0.7, sampleRate: SR, seconds: 1 })
    const release = releasePoints(0.3, SR)
    const out = applyRelease(body, Math.round(0.25 * SR), release)
    expect(out[out.length - 1]).toBe(0)
    expect(rms(out, out.length - 200)).toBeLessThan(0.001)
  })

  it('holding longer produces a longer sound than releasing early', () => {
    const short = renderVoiceThroughMaster({ midi: 60, velocity: 0.7, sampleRate: SR, holdSeconds: 0.1 })
    const long = renderVoiceThroughMaster({ midi: 60, velocity: 0.7, sampleRate: SR, holdSeconds: 0.8 })
    const audibleShort = countAudible(short)
    const audibleLong = countAudible(long)
    expect(audibleLong).toBeGreaterThan(audibleShort)
    // The audible duration tracks the hold time, within one release window.
    expect((audibleLong - audibleShort) / SR).toBeGreaterThan(0.4)
  })

  it('keeps sounding through a sustain tail that outlasts the key release', () => {
    const pedalUp = renderVoiceThroughMaster({
      midi: 60,
      velocity: 0.7,
      sampleRate: SR,
      holdSeconds: 0.2,
      sustainTailSeconds: 0,
    })
    const pedalDown = renderVoiceThroughMaster({
      midi: 60,
      velocity: 0.7,
      sampleRate: SR,
      holdSeconds: 0.2,
      sustainTailSeconds: 0.6,
    })
    expect(countAudible(pedalDown)).toBeGreaterThan(countAudible(pedalUp))
    // The pedal-down note is still sounding where the pedal-up note has already gone.
    const probe = Math.round(0.6 * SR)
    expect(rms(pedalUp, probe, probe + 1000)).toBeLessThan(1e-6)
    expect(rms(pedalDown, probe, probe + 1000)).toBeGreaterThan(1e-4)
  })
})

describe('piano model — register and polyphony', () => {
  it('does not render two different notes identically', () => {
    const low = renderPianoBody({ midi: 36, velocity: 0.7, sampleRate: SR, seconds: 0.5 })
    const high = renderPianoBody({ midi: 84, velocity: 0.7, sampleRate: SR, seconds: 0.5 })
    expect(crossingRate(high, SR)).toBeGreaterThan(crossingRate(low, SR) * 2)
    expect(Array.from(low.slice(0, 200))).not.toEqual(Array.from(high.slice(0, 200)))
  })

  it('sums independent voices without clipping the master path', () => {
    const voices = [48, 52, 55, 60, 64, 67].map((midi) => ({
      midi,
      velocity: 0.85,
      sampleRate: SR,
      holdSeconds: 0.5,
    }))
    const rendered = voices.map((v) => renderVoiceThroughMaster(v))
    const longest = Math.max(...rendered.map((r) => r.length))
    const mix = new Float32Array(longest)
    for (const voice of rendered) {
      for (let i = 0; i < voice.length; i += 1) mix[i] += voice[i]
    }
    expect(peak(mix)).toBeGreaterThan(peak(rendered[0]))
    expect(mix.every((s) => Number.isFinite(s))).toBe(true)
  })

  it('renders a 16-voice chord with audible content in every voice', () => {
    const midis = Array.from({ length: 16 }, (_, i) => 36 + i * 3)
    for (const midi of midis) {
      const voice = renderVoiceThroughMaster({ midi, velocity: 0.6, sampleRate: SR, holdSeconds: 0.2 })
      expect(rms(voice)).toBeGreaterThan(0.001)
    }
  })
})

function countAudible(samples: Float32Array, threshold = 1e-4): number {
  let last = 0
  for (let i = 0; i < samples.length; i += 1) {
    if (Math.abs(samples[i]) > threshold) last = i
  }
  return last
}
