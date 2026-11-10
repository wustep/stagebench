/**
 * Basic piano voice — live additive synthesis. No recordings, no stored sample buffers.
 *
 * Each note is a bank of exponentially decaying sine partials with piano-like behaviour:
 *  - stretched (inharmonic) partial frequencies, more so toward the treble;
 *  - a spectrum shaped by strike position and by a velocity-dependent "hammer felt" lowpass,
 *    so harder strikes are brighter as well as louder;
 *  - higher partials decay faster, and the lowest partials carry a slower, slightly detuned
 *    "aftersound" component that gives the two-stage decay and gentle beating of real strings;
 *  - a short filtered noise burst for the hammer knock;
 *  - a damper release when the key (or the sustain pedal) comes up.
 *
 * Every voice is summed, scaled by the master gain, and passed through one soft limiter.
 * Nothing reaches the output except through that master stage.
 *
 * The kernel is plain arithmetic on typed arrays: it has no dependency on Web Audio, so the
 * same code runs in an AudioWorklet, in a ScriptProcessor fallback, and in tests.
 */

export const VoiceState = {
  Free: 0,
  /** Key is down. */
  Held: 1,
  /** Key is up, sustain pedal is holding the damper off. */
  Sustained: 2,
  /** Damper is on the string; fading out. */
  Released: 3,
  /** Stolen or force-stopped; fading out fast. */
  Killed: 4,
} as const
export type VoiceStateValue = (typeof VoiceState)[keyof typeof VoiceState]

export interface KernelOptions {
  sampleRate: number
  /** Sounding-voice limit before stealing. */
  maxVoices?: number
  masterGain?: number
}

export interface VoiceInfo {
  note: number
  state: VoiceStateValue
  /** Strike order: larger is more recent. */
  order: number
  velocity: number
}

export const DEFAULT_MAX_VOICES = 32
export const DEFAULT_MASTER_GAIN = 0.7

const MAX_PARTIALS = 32
const AFTERSOUND_PARTIALS = 6
const PHASORS = MAX_PARTIALS + AFTERSOUND_PARTIALS
const MAX_BLOCK = 4096
/** A voice below this level is inaudible and is freed. */
const SILENCE = 2e-5
const PRUNE_POWER = 1e-12
/** Time constants, seconds. */
const STEAL_FADE = 0.004
const RESTRIKE_FADE = 0.03
const STOP_FADE = 0.02

class Voice {
  state: VoiceStateValue = VoiceState.Free
  note = 0
  order = 0
  velocity = 0
  /** Active phasor count; phasors are ordered slowest-decaying first so the tail can be pruned. */
  count = 0
  readonly re = new Float64Array(PHASORS)
  readonly im = new Float64Array(PHASORS)
  /** Per-sample complex multiplier = decay · e^{jω}. */
  readonly kr = new Float64Array(PHASORS)
  readonly ki = new Float64Array(PHASORS)
  attack = 0
  attackCoef = 0
  release = 1
  releaseCoef = 1
  /** Damper coefficient for a normal key-up, kept so sustain-up can apply it later. */
  damperCoef = 1
  noiseAmp = 0
  noiseDecay = 0
  noiseLp = 0
  noiseCoef = 0
  rng = 1
  gainL = 0
  gainR = 0
  level = 0
}

/** Soft limiter: transparent below 0.5, smoothly approaching ±1 above it. */
export function softLimit(x: number): number {
  const a = x < 0 ? -x : x
  if (a <= 0.5) return x
  const y = 0.5 + 0.5 * Math.tanh((a - 0.5) * 2)
  return x < 0 ? -y : y
}

export function midiToFrequency(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12)
}

export class PianoKernel {
  readonly sampleRate: number
  readonly maxVoices: number
  private masterGain: number
  private sustain = false
  private order = 0
  /** Pool: maxVoices sounding + headroom for voices still fading after a steal. */
  private readonly voices: Voice[]
  private readonly scratch = new Float64Array(MAX_BLOCK)
  private readonly partialAmp = new Float64Array(MAX_PARTIALS)
  private readonly partialFreq = new Float64Array(MAX_PARTIALS)

  constructor(options: KernelOptions) {
    this.sampleRate = options.sampleRate
    this.maxVoices = Math.max(1, options.maxVoices ?? DEFAULT_MAX_VOICES)
    this.masterGain = options.masterGain ?? DEFAULT_MASTER_GAIN
    this.voices = Array.from({ length: this.maxVoices * 2 + 4 }, () => new Voice())
  }

  /** Strike a note. `velocity` is 0..1; 0 is treated as a note-off, as in MIDI. */
  noteOn(note: number, velocity: number): void {
    if (!(velocity > 0)) {
      this.noteOff(note)
      return
    }
    const v = Math.min(1, velocity)

    // Re-striking a string that is still ringing: the old vibration is replaced, not stacked.
    for (const voice of this.voices) {
      if (voice.note === note && (voice.state === VoiceState.Held || voice.state === VoiceState.Sustained)) {
        this.fade(voice, VoiceState.Released, RESTRIKE_FADE)
      }
    }

    if (this.soundingCount() >= this.maxVoices) this.steal()

    let voice = this.voices.find((candidate) => candidate.state === VoiceState.Free)
    if (!voice) {
      // Pool exhausted by fading voices: drop the oldest fade outright.
      voice = this.oldest(VoiceState.Killed) ?? this.oldest(VoiceState.Released) ?? this.voices[0]
    }
    this.strike(voice, note, v)
  }

  noteOff(note: number): void {
    for (const voice of this.voices) {
      if (voice.note !== note || voice.state !== VoiceState.Held) continue
      if (this.sustain) {
        voice.state = VoiceState.Sustained
      } else {
        voice.state = VoiceState.Released
        voice.releaseCoef = voice.damperCoef
      }
    }
  }

  setSustain(down: boolean): void {
    if (this.sustain === down) return
    this.sustain = down
    if (down) return
    for (const voice of this.voices) {
      if (voice.state === VoiceState.Sustained) {
        voice.state = VoiceState.Released
        voice.releaseCoef = voice.damperCoef
      }
    }
  }

  get sustainDown(): boolean {
    return this.sustain
  }

  /** Stop everything: pedal up, every voice fades out within a few tens of milliseconds. */
  allNotesOff(): void {
    this.sustain = false
    for (const voice of this.voices) {
      if (voice.state !== VoiceState.Free && voice.state !== VoiceState.Killed) {
        this.fade(voice, VoiceState.Killed, STOP_FADE)
      }
    }
  }

  setMasterGain(gain: number): void {
    this.masterGain = Math.max(0, gain)
  }

  getMasterGain(): number {
    return this.masterGain
  }

  /** Every voice that still produces signal, including ones fading out. */
  get voiceCount(): number {
    let count = 0
    for (const voice of this.voices) if (voice.state !== VoiceState.Free) count += 1
    return count
  }

  /** Voices that count against the polyphony limit (everything except stolen/stopped fades). */
  soundingCount(): number {
    let count = 0
    for (const voice of this.voices) {
      if (voice.state !== VoiceState.Free && voice.state !== VoiceState.Killed) count += 1
    }
    return count
  }

  /** Voice table in strike order, for tests and status. */
  describeVoices(): VoiceInfo[] {
    return this.voices
      .filter((voice) => voice.state !== VoiceState.Free)
      .map((voice) => ({ note: voice.note, state: voice.state, order: voice.order, velocity: voice.velocity }))
      .sort((a, b) => a.order - b.order)
  }

  /** Render one block, overwriting both channels. */
  process(left: Float32Array, right: Float32Array, frames: number = left.length): void {
    for (let offset = 0; offset < frames; offset += MAX_BLOCK) {
      this.processChunk(left, right, offset, Math.min(MAX_BLOCK, frames - offset))
    }
  }

  private processChunk(left: Float32Array, right: Float32Array, offset: number, frames: number): void {
    const end = offset + frames
    left.fill(0, offset, end)
    right.fill(0, offset, end)
    const scratch = this.scratch

    for (const voice of this.voices) {
      if (voice.state === VoiceState.Free) continue
      scratch.fill(0, 0, frames)

      const { re, im, kr, ki } = voice
      for (let p = 0; p < voice.count; p += 1) {
        let a = re[p]
        let b = im[p]
        const cr = kr[p]
        const ci = ki[p]
        for (let i = 0; i < frames; i += 1) {
          const t = a * cr - b * ci
          b = a * ci + b * cr
          a = t
          scratch[i] += b
        }
        re[p] = a
        im[p] = b
      }

      let attack = voice.attack
      let release = voice.release
      let noiseAmp = voice.noiseAmp
      let noiseLp = voice.noiseLp
      let rng = voice.rng
      const { attackCoef, releaseCoef, noiseDecay, noiseCoef, gainL, gainR } = voice
      const fading = voice.state === VoiceState.Released || voice.state === VoiceState.Killed
      for (let i = 0; i < frames; i += 1) {
        attack += (1 - attack) * attackCoef
        if (fading) release *= releaseCoef
        let sample = scratch[i]
        if (noiseAmp > 1e-6) {
          rng ^= rng << 13
          rng ^= rng >>> 17
          rng ^= rng << 5
          noiseLp += ((rng | 0) / 2147483648 - noiseLp) * noiseCoef
          sample += noiseLp * noiseAmp
          noiseAmp *= noiseDecay
        }
        sample *= attack * release
        left[offset + i] += sample * gainL
        right[offset + i] += sample * gainR
      }
      voice.attack = attack
      voice.release = release
      voice.noiseAmp = noiseAmp
      voice.noiseLp = noiseLp
      voice.rng = rng

      // Drop partials that have decayed to nothing, then free the voice once it is inaudible.
      while (voice.count > 0) {
        const last = voice.count - 1
        if (re[last] * re[last] + im[last] * im[last] > PRUNE_POWER) break
        voice.count -= 1
      }
      let power = 0
      const probe = voice.count < 4 ? voice.count : 4
      for (let p = 0; p < probe; p += 1) power += re[p] * re[p] + im[p] * im[p]
      voice.level = (Math.sqrt(power) + noiseAmp) * release
      if (voice.level < SILENCE) voice.state = VoiceState.Free
    }

    const master = this.masterGain
    for (let i = offset; i < end; i += 1) {
      left[i] = softLimit(left[i] * master)
      right[i] = softLimit(right[i] * master)
    }
  }

  private strike(voice: Voice, note: number, velocity: number): void {
    const sr = this.sampleRate
    const f0 = midiToFrequency(note)
    const nyquistGuard = Math.min(sr * 0.45, 14000)

    // String stiffness: negligible in the low-mid range, growing toward the treble.
    const inharmonicity = Math.min(0.012, 5e-5 * Math.pow(2, Math.max(0, note - 40) / 8))
    const stretchBase = Math.sqrt(1 + inharmonicity)

    // Harder strike → harder felt → more high partials: both the spectral slope and the
    // felt lowpass open up with velocity.
    const feltCutoff = 1200 + 7000 * Math.pow(velocity, 1.5)
    const slope = 1.9 - 0.8 * velocity
    const strikePosition = 1 / 8.3

    // Decay: bass rings for many seconds, treble for well under one.
    const promptT60 = Math.min(9, Math.max(0.5, 6 * Math.pow(2, -(note - 36) / 20)))
    const afterT60 = promptT60 * 3.5
    const promptRate = 6.9078 / (promptT60 * sr) // ln(1000) per T60
    const afterRate = 6.9078 / (afterT60 * sr)

    let partials = 0
    const amps = this.partialAmp
    const freqs = this.partialFreq
    let sum = 0
    for (let n = 1; n <= MAX_PARTIALS; n += 1) {
      const f = (n * f0 * Math.sqrt(1 + inharmonicity * n * n)) / stretchBase
      if (f > nyquistGuard) break
      const comb = Math.abs(Math.sin(Math.PI * n * strikePosition))
      const felt = 1 / Math.sqrt(1 + Math.pow(f / feltCutoff, 4))
      const amp = (comb / Math.pow(n, slope)) * felt
      amps[partials] = amp
      freqs[partials] = f
      sum += amp
      partials += 1
    }
    if (partials === 0) {
      freqs[0] = Math.min(f0, nyquistGuard)
      amps[0] = 1
      sum = 1
      partials = 1
    }

    // Loudness: roughly 40 dB between the softest and hardest strike.
    const level = (0.9 * Math.pow(velocity, 1.7)) / sum
    const afterCount = Math.min(AFTERSOUND_PARTIALS, partials)
    const afterShare = 0.22
    const detune = Math.pow(2, 0.9 / 1200)

    let index = 0
    for (let pass = 0; pass < 2; pass += 1) {
      // Pass 0: slow, slightly sharp aftersound for the lowest partials. Pass 1: the prompt sound.
      const limit = pass === 0 ? afterCount : partials
      for (let p = 0; p < limit; p += 1) {
        const aftersound = pass === 0
        const share = aftersound ? afterShare : p < afterCount ? 1 - afterShare : 1
        const frequency = aftersound ? freqs[p] * detune : freqs[p]
        const rate = (aftersound ? afterRate : promptRate) * partialRateScale(p + 1)
        const omega = (2 * Math.PI * frequency) / sr
        const decay = Math.exp(-rate)
        voice.re[index] = amps[p] * level * share
        voice.im[index] = 0
        voice.kr[index] = Math.cos(omega) * decay
        voice.ki[index] = Math.sin(omega) * decay
        index += 1
      }
    }

    this.order += 1
    voice.state = VoiceState.Held
    voice.note = note
    voice.order = this.order
    voice.velocity = velocity
    voice.count = index
    voice.attack = 0
    voice.attackCoef = 1 - Math.exp(-1 / ((0.004 - 0.003 * velocity) * sr))
    voice.release = 1
    voice.releaseCoef = 1
    // Damper: the bass takes longer to choke than the treble (time constants ≈ 125 ms at E1, 38 ms at E7).
    const damperTime = 0.025 + 0.1 * Math.pow(2, -(note - 28) / 24)
    voice.damperCoef = Math.exp(-1 / (damperTime * sr))

    voice.noiseAmp = 0.06 * velocity * velocity
    voice.noiseDecay = Math.exp(-1 / (0.012 * sr))
    voice.noiseLp = 0
    voice.noiseCoef = 1 - Math.exp((-2 * Math.PI * Math.min(5000, 900 + f0 * 2)) / sr)
    // Deterministic per strike, so identical input renders identical output.
    voice.rng = (Math.imul(note + 1, 2654435761) ^ Math.imul(this.order, 40503)) | 1

    // Bass slightly left, treble slightly right, equal power.
    const pan = Math.max(-0.35, Math.min(0.35, ((note - 64) / 36) * 0.35))
    const angle = ((pan + 1) * Math.PI) / 4
    voice.gainL = Math.cos(angle)
    voice.gainR = Math.sin(angle)
    voice.level = level
  }

  private fade(voice: Voice, state: VoiceStateValue, seconds: number): void {
    voice.state = state
    const coef = Math.exp(-1 / (seconds * this.sampleRate))
    // Never slow a fade that is already faster.
    voice.releaseCoef = Math.min(voice.releaseCoef, coef)
  }

  /**
   * Deterministic voice stealing. Preference order:
   *   1. a voice already released (its damper is down),
   *   2. a voice held only by the sustain pedal,
   *   3. a voice whose key is still down;
   * and within a class, the one struck longest ago.
   */
  private steal(): void {
    const victim =
      this.oldest(VoiceState.Released) ?? this.oldest(VoiceState.Sustained) ?? this.oldest(VoiceState.Held)
    if (victim) this.fade(victim, VoiceState.Killed, STEAL_FADE)
  }

  private oldest(state: VoiceStateValue): Voice | undefined {
    let found: Voice | undefined
    for (const voice of this.voices) {
      if (voice.state === state && (!found || voice.order < found.order)) found = voice
    }
    return found
  }
}

/** Higher partials lose energy faster. */
function partialRateScale(n: number): number {
  return 1 + 0.08 * Math.pow(n - 1, 1.6)
}
