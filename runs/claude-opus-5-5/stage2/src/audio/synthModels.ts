// Honest synthesis for the Clav, Digital and Misc piano types (the piano spec allows synthesis
// for these three). Every function renders a mono PCM buffer at load time; nothing here is a
// recording, and IMPLEMENTATION_DETAILS.json lists each generator as a generated source.
import type { GeneratorId } from './instruments'
import { midiToHz } from './instruments'
import { renderPianoTone, type ToneOptions } from './pianoTone'

export interface GeneratorSpec {
  /** Root notes rendered (every `step` semitones E1…E7). */
  step: number
  render: (note: number, options: ToneOptions) => Float32Array
}

function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Partial {
  ratio: number
  amp: number
  /** Decay time constant (s). */
  tau: number
  detuneCents?: number
}

/** Additive renderer shared by the generators; normalized to 0.8 peak with short edge fades. */
function additive(note: number, seconds: number, partials: Partial[], options: ToneOptions, extra?: (t: number, i: number) => number): Float32Array {
  const sr = options.sampleRate ?? 32000
  const len = Math.max(16, Math.round(seconds * (options.durationScale ?? 1) * sr))
  const out = new Float64Array(len)
  const f0 = midiToHz(note)
  const nyq = sr * 0.45
  for (const p of partials) {
    const f = f0 * p.ratio * Math.pow(2, (p.detuneCents ?? 0) / 1200)
    if (f >= nyq || p.amp <= 0) continue
    const w = (2 * Math.PI * f) / sr
    const r = Math.exp(-1 / (p.tau * sr))
    // Damped sinusoid by recurrence: y[n] = 2 r cos(w) y[n-1] - r² y[n-2].
    const c1 = 2 * r * Math.cos(w)
    const c2 = r * r
    let y2 = 0
    let y1 = p.amp * r * Math.sin(w)
    const stop = Math.min(len, Math.ceil(p.tau * sr * 12))
    for (let i = 1; i < stop; i++) {
      out[i] += y1
      const y = c1 * y1 - c2 * y2
      y2 = y1
      y1 = y
    }
  }
  if (extra) for (let i = 0; i < len; i++) out[i] += extra(i / sr, i)
  let peakValue = 0
  for (const v of out) peakValue = Math.max(peakValue, Math.abs(v))
  const scale = peakValue > 0 ? 0.8 / peakValue : 0
  const res = new Float32Array(len)
  const fadeIn = Math.min(len, Math.round(0.0015 * sr))
  const fadeOut = Math.min(len, Math.round(0.05 * sr))
  for (let i = 0; i < len; i++) {
    let g = scale
    if (i < fadeIn) g *= i / fadeIn
    if (i >= len - fadeOut) g *= (len - i) / fadeOut
    res[i] = out[i] * g
  }
  return res
}

/** Clavinet: plucked-string harmonics shaped by the pickup comb (bridge + neck pickups). */
function clavinet(note: number, options: ToneOptions): Float32Array {
  const partials: Partial[] = []
  const pluck = 0.1
  const pickup = 0.07
  for (let k = 1; k <= 40; k++) {
    const amp = (Math.abs(Math.sin(Math.PI * k * pluck)) * Math.abs(Math.sin(Math.PI * k * pickup))) / Math.pow(k, 0.55)
    partials.push({ ratio: k * (1 + 0.00005 * k * k), amp, tau: 1.3 / (1 + 0.09 * k) * Math.pow(2, -(note - 48) / 30) })
  }
  const rand = prng(note * 31 + 7)
  // Short "tangent strike" click.
  return additive(note, 2.2, partials, options, (t) => (t < 0.004 ? (rand() * 2 - 1) * 0.15 * (1 - t / 0.004) : 0))
}

/** Harpsichord: bright plucked 8' + 4' choirs with slow decay. */
function harpsichord(note: number, options: ToneOptions): Float32Array {
  const partials: Partial[] = []
  for (let k = 1; k <= 36; k++) {
    const amp = Math.abs(Math.sin(Math.PI * k * 0.13)) / Math.pow(k, 0.45)
    partials.push({ ratio: k, amp, tau: 2.6 / (1 + 0.05 * k) * Math.pow(2, -(note - 48) / 36), detuneCents: 1.5 })
    partials.push({ ratio: 2 * k, amp: amp * 0.45, tau: 2 / (1 + 0.05 * k), detuneCents: -2 })
  }
  return additive(note, 3, partials, options)
}

/** Two-operator FM electric piano (DX-style tine bell over a sine body). */
function fmEpiano(note: number, options: ToneOptions): Float32Array {
  const sr = options.sampleRate ?? 32000
  const len = Math.max(16, Math.round(3 * (options.durationScale ?? 1) * sr))
  const f = midiToHz(note)
  const out = new Float32Array(len)
  const bodyTau = 1.6 * Math.pow(2, -(note - 60) / 30)
  for (let i = 0; i < len; i++) {
    const t = i / sr
    const index = 1.6 * Math.exp(-t / 0.25) + 0.25
    const body = Math.sin(2 * Math.PI * f * t + index * Math.sin(2 * Math.PI * f * t)) * Math.exp(-t / bodyTau)
    const tine = f * 14 < sr * 0.45 ? 0.25 * Math.sin(2 * Math.PI * f * 14 * t) * Math.exp(-t / 0.06) : 0
    out[i] = body + tine
  }
  let p = 0
  for (const v of out) p = Math.max(p, Math.abs(v))
  const fadeOut = Math.round(0.05 * sr)
  for (let i = 0; i < len; i++) {
    let g = 0.8 / (p || 1)
    if (i < 32) g *= i / 32
    if (i >= len - fadeOut) g *= (len - i) / fadeOut
    out[i] *= g
  }
  return out
}

/** Marimba: tuned wooden bar modes (1 : 3.9 : 9.2) with fast decays. */
function marimba(note: number, options: ToneOptions): Float32Array {
  const tau = 0.55 * Math.pow(2, -(note - 60) / 24)
  return additive(note, 1.6, [
    { ratio: 1, amp: 1, tau },
    { ratio: 3.93, amp: 0.3, tau: tau * 0.35 },
    { ratio: 9.24, amp: 0.12, tau: tau * 0.15 },
  ], options)
}

/** Vibraphone: metal bar modes (1 : 4 : 10) with long ringing decay. */
function vibraphone(note: number, options: ToneOptions): Float32Array {
  const tau = 2.4 * Math.pow(2, -(note - 60) / 30)
  return additive(note, 4, [
    { ratio: 1, amp: 1, tau },
    { ratio: 4, amp: 0.25, tau: tau * 0.3 },
    { ratio: 10.1, amp: 0.08, tau: tau * 0.1 },
  ], options)
}

export const GENERATORS: Record<GeneratorId, GeneratorSpec> = {
  'digital-piano': { step: 3, render: renderPianoTone },
  'fm-epiano': { step: 4, render: fmEpiano },
  clavinet: { step: 4, render: clavinet },
  harpsichord: { step: 4, render: harpsichord },
  marimba: { step: 4, render: marimba },
  vibraphone: { step: 4, render: vibraphone },
}

export function generatorRoots(step: number, low: number, high: number): number[] {
  const roots: number[] = []
  for (let n = low; n <= high; n += step) roots.push(n)
  if (roots[roots.length - 1] !== high) roots.push(high)
  return roots
}
