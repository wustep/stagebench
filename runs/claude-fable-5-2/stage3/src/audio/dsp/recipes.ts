import { midiToFrequency } from './kernel'
import type { RecipeId } from './params'

/**
 * Live additive synthesis recipes. Each one turns a note and a strike into a bank of
 * exponentially decaying sine partials. None of these is a recording, and the UI and
 * IMPLEMENTATION_DETAILS.json say so:
 *
 *  - `basic`        the Phase 1 piano voice; now the labelled fallback when a sample set fails
 *  - `clav-neck`    plucked-string model seen through a neck-position pickup (warmer)
 *  - `clav-bridge`  the same string through a bridge-position pickup (brighter, thinner)
 *  - `fm-piano`     a digital-piano tone in the style of an FM electric piano (tine + bell)
 *  - `vibraphone`   metal bar modes 1 : 4 : 10, long ring
 *  - `marimba`      wooden bar modes 1 : 3.93 : 9.2, short ring
 */

export const MAX_PARTIALS = 40

export interface PartialSpec {
  count: number
  /** Radians per sample. */
  omega: Float64Array
  /** Linear amplitudes; they sum to 1. */
  amp: Float64Array
  /** Decay, nepers per sample. */
  rate: Float64Array
  attackTime: number
  damperTime: number
  /** Strike noise, relative to the tone. */
  noiseAmp: number
  noiseTime: number
  noiseCutoff: number
  /** Loudness trim that puts this recipe level with the recorded pianos. */
  level: number
}

export function createPartialSpec(): PartialSpec {
  return {
    count: 0,
    omega: new Float64Array(MAX_PARTIALS),
    amp: new Float64Array(MAX_PARTIALS),
    rate: new Float64Array(MAX_PARTIALS),
    attackTime: 0.002,
    damperTime: 0.05,
    noiseAmp: 0,
    noiseTime: 0.012,
    noiseCutoff: 2000,
    level: 1,
  }
}

const LN1000 = 6.9078

/** Per-sample decay rate for a 60 dB decay time in seconds. */
function rateFor(t60: number, sampleRate: number): number {
  return LN1000 / (Math.max(0.01, t60) * sampleRate)
}

function push(spec: PartialSpec, frequency: number, amp: number, t60: number, sampleRate: number): void {
  if (spec.count >= MAX_PARTIALS || !(amp > 0) || frequency >= Math.min(sampleRate * 0.45, 15000)) return
  spec.omega[spec.count] = (2 * Math.PI * frequency) / sampleRate
  spec.amp[spec.count] = amp
  spec.rate[spec.count] = rateFor(t60, sampleRate)
  spec.count += 1
}

function basic(spec: PartialSpec, note: number, velocity: number, sr: number): void {
  const f0 = midiToFrequency(note)
  const inharmonicity = Math.min(0.012, 5e-5 * Math.pow(2, Math.max(0, note - 40) / 8))
  const stretchBase = Math.sqrt(1 + inharmonicity)
  const feltCutoff = 1200 + 7000 * Math.pow(velocity, 1.5)
  const slope = 1.9 - 0.8 * velocity
  const promptT60 = Math.min(9, Math.max(0.5, 6 * Math.pow(2, -(note - 36) / 20)))
  const detune = Math.pow(2, 0.9 / 1200)
  for (let n = 1; n <= 32; n += 1) {
    const f = (n * f0 * Math.sqrt(1 + inharmonicity * n * n)) / stretchBase
    const comb = Math.abs(Math.sin((Math.PI * n) / 8.3))
    const felt = 1 / Math.sqrt(1 + Math.pow(f / feltCutoff, 4))
    const amp = (comb / Math.pow(n, slope)) * felt
    const scale = 1 + 0.08 * Math.pow(n - 1, 1.6)
    if (n <= 6) {
      // Two-stage decay: a slower, slightly sharp aftersound under the prompt sound.
      push(spec, f * detune, amp * 0.22, (promptT60 * 3.5) / scale, sr)
      push(spec, f, amp * 0.78, promptT60 / scale, sr)
    } else {
      push(spec, f, amp, promptT60 / scale, sr)
    }
  }
  if (spec.count === 0) push(spec, Math.min(f0, 12000), 1, promptT60, sr)
  spec.attackTime = 0.004 - 0.003 * velocity
  spec.damperTime = 0.025 + 0.1 * Math.pow(2, -(note - 28) / 24)
  spec.noiseAmp = 0.06 * velocity
  spec.noiseTime = 0.012
  spec.noiseCutoff = Math.min(5000, 900 + f0 * 2)
}

function clav(spec: PartialSpec, note: number, velocity: number, sr: number, pickup: number): void {
  const f0 = midiToFrequency(note)
  const t60 = Math.min(4, Math.max(0.35, 2.4 * Math.pow(2, -(note - 48) / 30)))
  const brightness = 3000 + 9000 * velocity
  for (let n = 1; n <= 36; n += 1) {
    const f = n * f0 * Math.sqrt(1 + 2e-5 * n * n)
    // A string plucked close to its end, heard through a pickup at `pickup` along its length.
    const pluck = Math.abs(Math.sin(Math.PI * n * 0.11))
    const seen = Math.abs(Math.sin(Math.PI * n * pickup))
    const rolloff = 1 / Math.sqrt(1 + Math.pow(f / brightness, 2))
    const amp = (pluck * (0.15 + seen) * rolloff) / Math.pow(n, 0.6 - 0.2 * velocity)
    push(spec, f, amp, t60 / (1 + 0.05 * Math.pow(n - 1, 1.3)), sr)
  }
  if (spec.count === 0) push(spec, Math.min(f0, 12000), 1, t60, sr)
  spec.attackTime = 0.0008
  spec.damperTime = 0.018
  spec.noiseAmp = 0.12 * velocity
  spec.noiseTime = 0.006
  spec.noiseCutoff = 4500
}

function fmPiano(spec: PartialSpec, note: number, velocity: number, sr: number): void {
  const f0 = midiToFrequency(note)
  const body = Math.min(7, Math.max(0.8, 4.5 * Math.pow(2, -(note - 48) / 24)))
  const bell = velocity * velocity
  push(spec, f0, 1, body, sr)
  push(spec, f0 * Math.pow(2, 2.2 / 1200), 0.35, body * 1.3, sr)
  push(spec, f0 * 2, 0.28 + 0.2 * velocity, body * 0.7, sr)
  push(spec, f0 * 3, 0.08 + 0.14 * velocity, body * 0.45, sr)
  push(spec, f0 * 4, 0.03 + 0.1 * bell, body * 0.3, sr)
  // The "tine": a high, slightly inharmonic cluster that rings briefly and grows with velocity.
  const tine = f0 * 14 > 9000 ? 7 : 14
  push(spec, f0 * tine * 0.999, 0.05 + 0.45 * bell, 0.45, sr)
  push(spec, f0 * (tine + 1) * 1.002, 0.02 + 0.22 * bell, 0.3, sr)
  push(spec, f0 * (tine - 1) * 1.001, 0.02 + 0.18 * bell, 0.3, sr)
  spec.attackTime = 0.0015
  spec.damperTime = 0.07
  spec.noiseAmp = 0.015 * velocity
  spec.noiseTime = 0.004
  spec.noiseCutoff = 6000
}

function bar(spec: PartialSpec, note: number, velocity: number, sr: number, metal: boolean): void {
  const f0 = midiToFrequency(note)
  const register = Math.pow(2, -(note - 60) / 30)
  if (metal) {
    const ring = Math.min(9, Math.max(1.2, 5.5 * register))
    push(spec, f0, 1, ring, sr)
    push(spec, f0 * 1.0015, 0.2, ring * 0.9, sr)
    push(spec, f0 * 4, 0.12 + 0.3 * velocity, ring * 0.22, sr)
    push(spec, f0 * 10, 0.03 + 0.18 * velocity * velocity, ring * 0.06, sr)
    spec.damperTime = 0.09
  } else {
    const ring = Math.min(2.2, Math.max(0.25, 0.9 * register))
    push(spec, f0, 1, ring, sr)
    push(spec, f0 * 3.93, 0.1 + 0.3 * velocity, ring * 0.3, sr)
    push(spec, f0 * 9.2, 0.02 + 0.14 * velocity * velocity, ring * 0.1, sr)
    spec.damperTime = 0.06
  }
  spec.attackTime = 0.001
  spec.noiseAmp = (metal ? 0.05 : 0.14) * velocity
  spec.noiseTime = metal ? 0.004 : 0.008
  spec.noiseCutoff = metal ? 5000 : 1800
}

/** Fill `spec` for one strike. `velocity` (0..1) shapes the spectrum only; loudness is the caller's. */
export function buildPartials(recipe: RecipeId, note: number, velocity: number, sampleRate: number, spec: PartialSpec): void {
  spec.count = 0
  spec.level = 1
  switch (recipe) {
    case 'clav-neck':
      clav(spec, note, velocity, sampleRate, 0.27)
      spec.level = 1.7
      break
    case 'clav-bridge':
      clav(spec, note, velocity, sampleRate, 0.085)
      spec.level = 1.7
      break
    case 'fm-piano':
      fmPiano(spec, note, velocity, sampleRate)
      break
    case 'vibraphone':
      bar(spec, note, velocity, sampleRate, true)
      spec.level = 0.85
      break
    case 'marimba':
      bar(spec, note, velocity, sampleRate, false)
      spec.level = 1.25
      break
    default:
      basic(spec, note, velocity, sampleRate)
  }
  let sum = 0
  for (let p = 0; p < spec.count; p += 1) sum += spec.amp[p]
  for (let p = 0; p < spec.count; p += 1) spec.amp[p] /= sum
  // Slowest-decaying first, so a voice can drop its dead partials from the end.
  for (let i = 1; i < spec.count; i += 1) {
    const omega = spec.omega[i]
    const amp = spec.amp[i]
    const rate = spec.rate[i]
    let j = i - 1
    while (j >= 0 && spec.rate[j] > rate) {
      spec.omega[j + 1] = spec.omega[j]
      spec.amp[j + 1] = spec.amp[j]
      spec.rate[j + 1] = spec.rate[j]
      j -= 1
    }
    spec.omega[j + 1] = omega
    spec.amp[j + 1] = amp
    spec.rate[j + 1] = rate
  }
}
