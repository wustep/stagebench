// Synth oscillator sources. Each waveform in the spec's required list maps to one recipe of members
// (an oscillator, a pulse wave, a noise bed, or a modulator). The category decides what Osc Ctrl does:
//
//   Pure    no effect (manual p. 29)
//   Sync    relative pitch of the synced oscillator (manual p. 29)
//   Multi   detune between the stacked saws (manual p. 30)
//   Super   detune and width of the stack (manual p. 30)
//   FM-H    FM modulation amount (manual p. 30)
//
// Hard sync is approximated: a second oscillator at a relative pitch gives the buzzy sync colour without
// a real reset. The approximation is declared in IMPLEMENTATION_DETAILS.json.

import type { OscillatorType } from '../audioBoundary'

export type SourceCategory = 'Pure' | 'Sync' | 'Multi' | 'Super' | 'FM-H'

export interface WaveformSpec {
  name: string
  category: SourceCategory
}

/** The required waveform list, in the order the panel's cycle steps through it. */
export const WAVEFORMS: readonly WaveformSpec[] = [
  { name: 'Sine', category: 'Pure' },
  { name: 'Triangle', category: 'Pure' },
  { name: 'Saw', category: 'Pure' },
  { name: 'Square', category: 'Pure' },
  { name: 'Pulse 33', category: 'Pure' },
  { name: 'Pulse 10', category: 'Pure' },
  { name: 'White Noise', category: 'Pure' },
  { name: 'Sync Saw', category: 'Sync' },
  { name: 'Sync Square', category: 'Sync' },
  { name: 'Multi Saw', category: 'Multi' },
  { name: 'Multi Saw 8ve', category: 'Multi' },
  { name: 'Super Saw', category: 'Super' },
  { name: 'Super Square', category: 'Super' },
  { name: 'FM 2-op (algorithm A)', category: 'FM-H' },
]

export type SourceMember =
  | { kind: 'osc'; type: OscillatorType; semitones: number; cents: number; gain: number }
  | { kind: 'pulse'; duty: number; semitones: number; cents: number; gain: number }
  | { kind: 'noise'; gain: number }

export interface SourceRecipe {
  members: SourceMember[]
  /** FM modulator depth in Hz at a modulator ratio of 2 to the carrier, or 0 when there is no FM. */
  fmDepthHz: number
}

/** Osc Ctrl knob 0..1 mapped to the category's own unit: cents for stacks, semitones for sync, a depth for FM. */
export function ctrlAmount(ctrl: number): number {
  return Math.min(1, Math.max(0, ctrl))
}

/** Stacked saws and squares: the spread in cents at full Osc Ctrl. */
const MULTI_CENTS = 18
const SUPER_CENTS = 26

/** Symmetric spread of `count` values across [-width, width]. */
function spread(count: number, width: number): number[] {
  if (count === 1) return [0]
  return Array.from({ length: count }, (_, index) => (2 * index) / (count - 1) - 1).map((value) => value * width)
}

export function sourceRecipe(index: number, ctrl: number): SourceRecipe {
  const waveform = WAVEFORMS[Math.min(WAVEFORMS.length - 1, Math.max(0, index))]
  const amount = ctrlAmount(ctrl)
  const osc = (type: OscillatorType, semitones: number, cents: number, gain: number): SourceMember => ({ kind: 'osc', type, semitones, cents, gain })
  switch (waveform.name) {
    case 'Sine':
      return { members: [osc('sine', 0, 0, 1)], fmDepthHz: 0 }
    case 'Triangle':
      return { members: [osc('triangle', 0, 0, 1)], fmDepthHz: 0 }
    case 'Saw':
      return { members: [osc('sawtooth', 0, 0, 1)], fmDepthHz: 0 }
    case 'Square':
      return { members: [osc('square', 0, 0, 1)], fmDepthHz: 0 }
    case 'Pulse 33':
      return { members: [{ kind: 'pulse', duty: 1 / 3, semitones: 0, cents: 0, gain: 1 }], fmDepthHz: 0 }
    case 'Pulse 10':
      return { members: [{ kind: 'pulse', duty: 0.1, semitones: 0, cents: 0, gain: 1 }], fmDepthHz: 0 }
    case 'White Noise':
      return { members: [{ kind: 'noise', gain: 1 }], fmDepthHz: 0 }
    case 'Sync Saw':
    case 'Sync Square': {
      // Relative pitch of the synced oscillator: one octave of ratio at full Osc Ctrl, up to 4x.
      const type: OscillatorType = waveform.name === 'Sync Saw' ? 'sawtooth' : 'square'
      const semitones = 12 * Math.log2(1 + 3 * amount)
      return { members: [osc(type, 0, 0, 0.6), osc(type, semitones, 0, 0.5)], fmDepthHz: 0 }
    }
    case 'Multi Saw':
      return { members: spread(3, MULTI_CENTS * amount).map((cents) => osc('sawtooth', 0, cents, 1 / Math.sqrt(3))), fmDepthHz: 0 }
    case 'Multi Saw 8ve': {
      const cents = spread(2, MULTI_CENTS * amount)
      return { members: cents.map((detune) => osc('sawtooth', 0, detune, 0.6)).concat([osc('sawtooth', 12, 0, 0.3)]), fmDepthHz: 0 }
    }
    case 'Super Saw':
      return { members: spread(7, SUPER_CENTS * amount).map((cents) => osc('sawtooth', 0, cents, 1 / Math.sqrt(7))), fmDepthHz: 0 }
    case 'Super Square':
      return { members: spread(5, SUPER_CENTS * amount).map((cents) => osc('square', 0, cents, 1 / Math.sqrt(5))), fmDepthHz: 0 }
    case 'FM 2-op (algorithm A)':
      // The carrier is a sine; the modulator's depth is the Osc Ctrl amount, in Hz per unit of carrier pitch.
      return { members: [osc('sine', 0, 0, 1)], fmDepthHz: amount * 3 }
    default:
      return { members: [osc('sine', 0, 0, 1)], fmDepthHz: 0 }
  }
}

/** Fourier cosine coefficients of a pulse with the given duty, for a periodic wave. The DC term is zero. */
export function pulseCoefficients(duty: number, harmonics = 64): Float32Array {
  const real = new Float32Array(harmonics + 1)
  for (let n = 1; n <= harmonics; n += 1) {
    real[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty)
  }
  return real
}

/** Deterministic random harmonics for the Sample & Hold LFO shape: a fixed stepped-looking cycle. */
export function sampleHoldCoefficients(harmonics = 16): Float32Array {
  const real = new Float32Array(harmonics + 1)
  let state = 0x9e3779b9
  for (let n = 1; n <= harmonics; n += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    real[n] = (state / 0x100000000 - 0.5) / n
  }
  return real
}
