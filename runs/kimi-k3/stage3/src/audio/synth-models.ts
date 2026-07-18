/**
 * Synth oscillator sources (Phase 3, specs/nord-stage-4.synth.json).
 *
 * The required waveform list with genuinely different DSP per category:
 *  - Pure: plain shapes + noise (Osc Ctrl: no effect, manual p. 29)
 *  - Sync: slave oscillator re-triggered by the master (Osc Ctrl: relative pitch)
 *  - Multi: stacked saws (Osc Ctrl: detune between them)
 *  - Super: detuned stack (Osc Ctrl: width of the stack)
 *  - FM-H: 2-op FM, one harmonic algorithm (Osc Ctrl: FM amount)
 * Oscillators take (freq, ctrl) per `render` call so envelopes, LFO, and
 * glide modulate them without rebuilding closures. Naive geometric waves are
 * deliberate: their aliasing is part of the analog-style character; tests
 * assert tolerant relationships.
 */

import { TAU, makeNoise } from './dsp'

export interface Oscillator {
  /** Render n samples at the given frequency (Hz) and Osc Ctrl (0..1). */
  render(freq: number, ctrl: number, n: number, sr: number, out: Float32Array, offset: number): void
}

const PULSE_WIDTH: Record<number, number> = { 4: 0.33, 5: 0.1 }

/** Create the oscillator for a SYNTH_WAVES index. */
export function createOscillator(wave: number, seed = 0): Oscillator {
  switch (wave) {
    case 0: // Sine
    case 1: // Triangle
    case 2: // Saw
    case 3: // Square
    case 4: // Pulse 33
    case 5: {
      // Pulse 10
      let phase = 0
      const pw = PULSE_WIDTH[wave]
      return {
        render(freq, _ctrl, n, sr, out, offset) {
          for (let i = 0; i < n; i++) {
            phase = (phase + freq / sr) % 1
            switch (wave) {
              case 0:
                out[offset + i] = Math.sin(TAU * phase)
                break
              case 1:
                out[offset + i] = 4 * Math.abs(phase - 0.5) - 1
                break
              case 2:
                out[offset + i] = 2 * phase - 1
                break
              case 3:
                out[offset + i] = phase < 0.5 ? 1 : -1
                break
              default:
                out[offset + i] = phase < pw ? 1 : -1
            }
          }
        },
      }
    }
    case 6: {
      // White Noise (deterministic per voice seed).
      const noise = makeNoise(0x51ab ^ (seed * 7919))
      return {
        render(_freq, _ctrl, n, _sr, out, offset) {
          for (let i = 0; i < n; i++) out[offset + i] = noise()
        },
      }
    }
    case 7:
    case 8: {
      // Sync Saw / Sync Square: master at base freq resets a slave running at
      // (1 + ctrl * 3.9) × base; Osc Ctrl sweeps the characteristic timbre.
      let master = 0
      let slave = 0
      return {
        render(freq, ctrl, n, sr, out, offset) {
          const ratio = 1 + ctrl * 3.9
          for (let i = 0; i < n; i++) {
            master += freq / sr
            if (master >= 1) {
              master %= 1
              slave = 0
            }
            slave = (slave + (freq * ratio) / sr) % 1
            out[offset + i] = wave === 7 ? 2 * slave - 1 : slave < 0.5 ? 1 : -1
          }
        },
      }
    }
    case 9:
    case 10: {
      // Multi Saw / Multi Saw 8ve: three stacked saws; ctrl = detune spread;
      // the 8ve variant adds one stack an octave up.
      const stack = [
        { off: -1, gain: 0.34, phase: 0 },
        { off: 0, gain: 0.33, phase: 0.31 },
        { off: 1, gain: 0.33, phase: 0.63 },
        { off: -1, gain: 0.2, phase: 0.11 },
        { off: 0, gain: 0.2, phase: 0.47 },
      ]
      return {
        render(freq, ctrl, n, sr, out, offset) {
          const spread = ctrl * 0.03
          const count = wave === 10 ? 5 : 3
          for (let i = 0; i < n; i++) {
            let s = 0
            for (let k = 0; k < count; k++) {
              const o = stack[k]
              const oct = wave === 10 && k >= 3 ? 2 : 1
              o.phase = (o.phase + (freq * oct * (1 + o.off * spread)) / sr) % 1
              s += (2 * o.phase - 1) * o.gain
            }
            out[offset + i] = s
          }
        },
      }
    }
    case 11:
    case 12: {
      // Super Saw / Super Square: 5-voice detuned stack; ctrl = width.
      const offsets = [-2, -1, 0, 1, 2]
      const gains = [0.14, 0.18, 0.36, 0.18, 0.14]
      const voices = offsets.map((o, i) => ({ off: o, gain: gains[i], phase: i * 0.2 }))
      return {
        render(freq, ctrl, n, sr, out, offset) {
          const width = ctrl * 0.045
          for (let i = 0; i < n; i++) {
            let s = 0
            for (const v of voices) {
              v.phase = (v.phase + (freq * (1 + v.off * width)) / sr) % 1
              s += (wave === 11 ? 2 * v.phase - 1 : v.phase < 0.5 ? 1 : -1) * v.gain
            }
            out[offset + i] = s
          }
        },
      }
    }
    default: {
      // FM 2-op (algorithm A): modulator at 1.5× carrier; ctrl = FM amount.
      let cPhase = 0
      let mPhase = 0
      return {
        render(freq, ctrl, n, sr, out, offset) {
          const index = ctrl * 6
          for (let i = 0; i < n; i++) {
            mPhase = (mPhase + (freq * 1.5) / sr) % 1
            const mod = Math.sin(TAU * mPhase) * index
            cPhase = (cPhase + freq / sr) % 1
            out[offset + i] = Math.sin(TAU * cPhase + mod)
          }
        },
      }
    }
  }
}

/** Envelope generator with attack/decay(=sustain at max)/release + velocity. */
export interface EnvParams {
  attack: number // 0..127
  decay: number // 0..127 (127 = sustain at full until release)
  release: number // 0..127
  velocity: number // 0 = none, >0 scales velocity influence
  /** Caller supplies the played velocity 0..1. */
  playedVelocity: number
}

const ENV_MIN = 0.002
function envTime(v: number): number {
  return ENV_MIN + Math.pow(Math.min(127, Math.max(0, v)) / 127, 2.2) * 6
}

export class SynthEnvelope {
  private stage: 'attack' | 'decay' | 'sustain' | 'release' | 'off' = 'attack'
  private level = 0
  private releaseFrom = 0
  private releaseT = 0
  private readonly a: number
  private readonly d: number
  private readonly r: number
  private readonly velScale: number
  private readonly sustainMode: boolean

  constructor(p: EnvParams) {
    this.a = envTime(p.attack)
    this.d = envTime(p.decay)
    this.r = envTime(p.release)
    this.sustainMode = p.decay >= 127
    // velocity levels: amp Off/1/2/3; others 0/1 toggle.
    const strength = Math.min(3, Math.max(0, p.velocity)) / 3
    this.velScale = 1 - strength * 0.7 + strength * 0.7 * Math.min(1, Math.max(0, p.playedVelocity))
  }

  noteOff(): void {
    if (this.stage === 'off' || this.stage === 'release') return
    this.stage = 'release'
    this.releaseFrom = this.level
    this.releaseT = 0
  }

  get isDone(): boolean {
    return this.stage === 'off'
  }

  next(dt: number): number {
    switch (this.stage) {
      case 'attack':
        this.level += dt / this.a
        if (this.level >= 1) {
          this.level = 1
          this.stage = this.sustainMode ? 'sustain' : 'decay'
        }
        break
      case 'decay':
        // Decay → 0 (no sustain level; at max it's sustain mode).
        this.level -= dt / this.d
        if (this.level <= 0) {
          this.level = 0
          this.stage = 'off'
        }
        break
      case 'sustain':
        break
      case 'release':
        this.releaseT += dt
        this.level = this.releaseFrom * Math.max(0, 1 - this.releaseT / this.r)
        if (this.level <= 0) this.stage = 'off'
        break
      case 'off':
        return 0
    }
    return this.level * this.velScale
  }
}
