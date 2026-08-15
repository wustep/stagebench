import type { Clock, EngineEvents, RenderResult, Voice } from './types'

export const DEFAULT_SAMPLE_RATE = 44_100

const TWOPI = Math.PI * 2

// Fixed partial template for the basic "bright acoustic" piano-like voice.
// (partial index relative to fundamental, base amplitude). Inharmonicity of a
// real grand is approximated by slightly sharpening high partials (below).
const PARTIALS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 1.0, 1.0],
  [2, 0.42, 2.0],
  [3, 0.22, 3.0],
  [4, 0.12, 4.0],
  [5, 0.06, 5.01],
  [6, 0.035, 6.02],
  [7, 0.018, 7.04],
  [8, 0.01, 8.07],
]

export const MAX_VOICES = 32

// Envelope time constants in seconds.
const ATTACK_S = 0.004
const DECAY_S = 0.16
const RELEASE_S = 0.5
const SUSTAIN_LEVEL = 0.32

interface ActiveVoice {
  id: number
  midi: number
  velocity: number
  held: boolean
  sustained: boolean
  onset: number // sample clock at onset
  gain: number // velocity-derived gain (0..1)
  phase: Float64Array
  releasing: boolean
  /** envelope gain captured when release began. */
  releaseGain: number
  releaseStart: number
}

function plainVoice(voice: ActiveVoice): Voice {
  return { id: voice.id, midi: voice.midi, velocity: voice.velocity, held: voice.held, sustained: voice.sustained, onset: voice.onset }
}

/**
 * Deterministic piano-like synthesizer: one fundamental plus a slightly
 * inharmonic decaying partial stack with an ADSR-ish envelope. Pure DSP —
 * `render(n)` advances an internal sample clock and returns PCM, so behavior
 * is measurable without Web Audio or a device. The browser player drains this
 * engine into the speakers.
 */
export class PianoEngine {
  readonly sampleRate: number
  readonly clock: Clock
  readonly maxVoices = MAX_VOICES
  private voices: ActiveVoice[] = []
  private nextId = 1
  private sampleClock = 0
  private sustain = false
  private events: EngineEvents

  constructor(options: { sampleRate?: number; clock?: Clock; events?: EngineEvents } = {}) {
    this.sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE
    this.clock = options.clock ?? { now: () => performance.now() }
    this.events = options.events ?? {}
  }

  get voiceCount(): number {
    return this.voices.length
  }

  get isSustain(): boolean {
    return this.sustain
  }

  /** Include only still-audible voices (sounding or in release). */
  get activeVoiceDetails(): Voice[] {
    return this.voices.map(plainVoice)
  }

  private freq(midi: number): number {
    return 440 * Math.pow(2, (midi - 69) / 12)
  }

  noteOn(midi: number, velocity: number): Voice {
    const v = Math.max(0, Math.min(1, velocity))
    const id = this.nextId++
    const onset = this.sampleClock
    if (this.voices.length >= MAX_VOICES) {
      let oldestIndex = 0
      for (let i = 1; i < this.voices.length; i++) {
        if (this.voices[i].onset < this.voices[oldestIndex].onset) oldestIndex = i
      }
      const stolen = this.voices.splice(oldestIndex, 1)[0]
      this.events.onVoiceEnd?.(plainVoice(stolen))
    }
    const voice: ActiveVoice = {
      id, midi, velocity: v, held: true, sustained: false, onset,
      gain: Math.pow(v, 1.12) * 0.95,
      phase: new Float64Array(PARTIALS.length),
      releasing: false, releaseGain: 0, releaseStart: 0,
    }
    this.voices.push(voice)
    this.voices.sort((a, b) => a.onset - b.onset) // oldest-first
    this.events.onVoiceStart?.(plainVoice(voice))
    return plainVoice(voice)
  }

  noteOff(midi: number): void {
    for (const voice of this.voices) {
      if (voice.midi === midi && voice.held) {
        voice.held = false
        if (this.sustain) voice.sustained = true
        else this.beginRelease(voice)
        break
      }
    }
  }

  private beginRelease(voice: ActiveVoice): void {
    if (voice.releasing) return
    voice.releasing = true
    voice.releaseGain = this.gainAt(voice, this.sampleClock)
    voice.releaseStart = this.sampleClock
  }

  /** envelope level at an arbitrary sample clock. */
  private gainAt(voice: ActiveVoice, sample: number): number {
    const age = Math.max(0, sample - voice.onset)
    const ageSec = age / this.sampleRate
    if (ageSec < ATTACK_S) return (ageSec / ATTACK_S)
    const body = SUSTAIN_LEVEL + (1 - SUSTAIN_LEVEL) * Math.exp(-(ageSec - ATTACK_S) / DECAY_S)
    return body
  }

  /** envelope level at an arbitrary sample clock. */
  private currentGain(voice: ActiveVoice, sample: number): number {
    if (!voice.releasing) return this.gainAt(voice, sample)
    const relSec = Math.max(0, sample - voice.releaseStart) / this.sampleRate
    return voice.releaseGain * Math.exp(-relSec / RELEASE_S)
  }

  setSustain(on: boolean): void {
    this.sustain = on
    if (!on) {
      for (const voice of this.voices) {
        if (voice.sustained) {
          voice.sustained = false
          this.beginRelease(voice)
        }
      }
    }
  }

  allNotesOff(): void {
    for (const voice of this.voices) this.events.onVoiceEnd?.(plainVoice(voice))
    this.voices = []
  }

  /** Render a block of `frames` samples, advancing the sample clock. */
  render(frames: number): RenderResult {
    const out = new Float32Array(Math.max(0, Math.floor(frames)))
    if (out.length === 0) return { samples: out, peak: 0 }
    const start = this.sampleClock
    let peak = 0
    for (let i = 0; i < out.length; i++) {
      const t = start + i
      let sample = 0
      for (let vi = this.voices.length - 1; vi >= 0; vi--) {
        const voice = this.voices[vi]
        const g = this.currentGain(voice, t)
        if (g <= 0.0005 && voice.releasing) {
          this.events.onVoiceEnd?.(plainVoice(voice))
          this.voices.splice(vi, 1)
          continue
        }
        const freq = this.freq(voice.midi)
        // brightness: higher velocity excites upper partials more.
        const bright = 0.35 + 0.65 * voice.velocity
        let s = 0
        for (let p = 0; p < PARTIALS.length; p++) {
          const [, amp, mult] = PARTIALS[p]
          const partialAmp = amp * Math.pow(bright, (mult - 1) * 0.62)
          const hFreq = freq * mult
          voice.phase[p] = (voice.phase[p] + TWOPI * hFreq / this.sampleRate) % TWOPI
          s += partialAmp * Math.sin(voice.phase[p])
        }
        sample += s * g * voice.gain
      }
      const abs = Math.abs(sample)
      if (abs > peak) peak = abs
      out[i] = sample
    }
    this.sampleClock = start + out.length
    return { samples: out, peak }
  }
}