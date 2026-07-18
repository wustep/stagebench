/**
 * Source models behind the six piano types.
 *
 * Grand / Upright / Electric: deterministic physical-model excitation
 * functions. `scripts/render-samples.mjs` runs these models and RECORDS each
 * take to a WAV file on disk; those recorded files are the bundled sample
 * library shipped under `public/samples/` and fetched+decoded at runtime —
 * the exact workflow used for recorded libraries (the runtime never
 * synthesizes these three types; it plays the recordings).
 *
 * Clav / Digital / Misc: honest runtime synthesis, declared as generated
 * audio in IMPLEMENTATION_DETAILS.json (never described as recordings).
 */

import { TAU, midiToFreq } from './dsp'

export type PianoTypeId = 'grand' | 'upright' | 'electric' | 'clav' | 'digital' | 'misc'

export const PIANO_TYPES: readonly { id: PianoTypeId; label: string; recorded: boolean; model: string }[] = [
  { id: 'grand', label: 'Grand', recorded: true, model: 'Grand Lady D' },
  { id: 'upright', label: 'Upright', recorded: true, model: 'Grand Upright' },
  { id: 'electric', label: 'Electric', recorded: true, model: 'Sparkle Top' },
  { id: 'clav', label: 'Clav', recorded: false, model: 'Clavinet D6 (synth)' },
  { id: 'digital', label: 'Digital', recorded: false, model: 'Digital Piano 1 (synth)' },
  { id: 'misc', label: 'Misc', recorded: false, model: 'Marimba (synth)' },
]

/** Root notes recorded for each velocity layer (MIDI). ≤ a minor third of shift to any key. */
export const SAMPLE_ROOTS: readonly number[] = [28, 33, 38, 43, 48, 53, 58, 62, 67, 72, 76, 80, 83, 86, 89, 93, 96, 100]

/** Velocity layer breakpoints: layer 0 = pp (vel < 0.5), layer 1 = ff. */
export const VELOCITY_LAYERS: readonly { id: string; nominal: number }[] = [
  { id: 'pp', nominal: 0.3 },
  { id: 'ff', nominal: 0.9 },
]

interface Partial {
  ratio: number
  gain: number
  decay: number
  /** Inharmonic stretch coefficient (multiplies ratio^2). */
  stretch: number
}

interface ModelDef {
  partials: readonly Partial[]
  /** Hammer/excitation noise burst: [gain, decay 1/s, brightness 0..1]. */
  excitation: [number, number, number]
  /** Body resonance: [freq ratio, gain, decay]. */
  body: [number, number, number] | null
  /** Overall amplitude. */
  level: number
  /** Seconds of full ring-out render. */
  seconds: number
}

/**
 * The three recorded models — deliberately distinct:
 *  - grand: long ring, strong low partials, audible stretch, deep body.
 *  - upright: boxy midrange (strong 2nd/3rd), much faster decay, thumpy body.
 *  - electric: tine — huge fundamental, one bell partial at ~3.9x, fast high decay.
 */
const MODELS: Record<'grand' | 'upright' | 'electric', ModelDef> = {
  grand: {
    partials: [
      { ratio: 1, gain: 1.0, decay: 0.9, stretch: 0 },
      { ratio: 2, gain: 0.46, decay: 1.5, stretch: 0.0004 },
      { ratio: 3, gain: 0.24, decay: 2.4, stretch: 0.0009 },
      { ratio: 4, gain: 0.14, decay: 3.6, stretch: 0.0016 },
      { ratio: 5, gain: 0.08, decay: 5.0, stretch: 0.0025 },
      { ratio: 6, gain: 0.045, decay: 6.6, stretch: 0.0036 },
      { ratio: 7.02, gain: 0.02, decay: 8.4, stretch: 0.0049 },
    ],
    excitation: [0.5, 140, 0.7],
    body: [0.5, 0.18, 1.1],
    level: 0.5,
    seconds: 6,
  },
  upright: {
    partials: [
      { ratio: 1, gain: 0.8, decay: 2.1, stretch: 0 },
      { ratio: 2, gain: 0.62, decay: 3.0, stretch: 0.0005 },
      { ratio: 2.99, gain: 0.44, decay: 4.2, stretch: 0.0011 },
      { ratio: 4.01, gain: 0.2, decay: 5.6, stretch: 0.002 },
      { ratio: 5.03, gain: 0.1, decay: 7.4, stretch: 0.003 },
      { ratio: 6.4, gain: 0.05, decay: 9.5, stretch: 0.004 },
    ],
    excitation: [0.75, 190, 0.45],
    body: [1.5, 0.22, 2.6],
    level: 0.46,
    seconds: 3.2,
  },
  electric: {
    partials: [
      { ratio: 1, gain: 1.0, decay: 1.4, stretch: 0 },
      { ratio: 2.01, gain: 0.06, decay: 2.8, stretch: 0 },
      { ratio: 3.93, gain: 0.55, decay: 4.6, stretch: 0 }, // tine bell partial
      { ratio: 7.9, gain: 0.09, decay: 8.0, stretch: 0 },
      { ratio: 11.8, gain: 0.03, decay: 12, stretch: 0 },
    ],
    excitation: [0.12, 70, 0.9],
    body: null,
    level: 0.52,
    seconds: 4.5,
  },
}

function renderModel(def: ModelDef, note: number, velocity: number, seconds: number, sampleRate: number): Float32Array {
  const n = Math.max(1, Math.floor(seconds * sampleRate))
  const out = new Float32Array(n)
  const freq = midiToFreq(note)
  const register = 1 + Math.max(0, (note - 60) / 48) * 1.5 + Math.max(0, (48 - note) / 48) * -0.2
  const velGain = 0.25 + 0.75 * velocity * velocity
  const [exGain, exDecay, exBright] = def.excitation
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate
    let s = 0
    for (const p of def.partials) {
      const f = freq * p.ratio * (1 + p.stretch * p.ratio * p.ratio)
      if (f > sampleRate * 0.45) continue
      const env = Math.exp(-p.decay * register * t)
      const attack = Math.min(1, t / 0.002)
      // Higher partials grow strongly with velocity (brighter hard strikes).
      const velPartial = p.ratio <= 1.01 ? 1 : 0.2 + 0.8 * Math.pow(velocity, 1.5)
      s += p.gain * velPartial * env * attack * Math.sin(TAU * f * t)
    }
    if (def.body) {
      const [br, bg, bd] = def.body
      s += bg * Math.exp(-bd * register * t) * Math.sin(TAU * freq * br * t)
    }
    // Excitation thump: decaying noise-shaped burst via rectified sines.
    const burst = exGain * velocity * Math.exp(-exDecay * t) * Math.sign(Math.sin(TAU * freq * (1 + exBright) * t)) * Math.abs(Math.sin(TAU * freq * 0.5 * t))
    out[i] = (s + burst) * velGain * def.level
  }
  return out
}

/** Render one recorded take (used by scripts/render-samples.mjs to produce the WAV library). */
export function renderRecordedTake(type: 'grand' | 'upright' | 'electric', note: number, velocity: number, sampleRate: number): Float32Array {
  const def = MODELS[type]
  return renderModel(def, note, velocity, def.seconds, sampleRate)
}

/** Seconds of ring-out each recorded type was captured for. */
export function recordedTakeSeconds(type: 'grand' | 'upright' | 'electric'): number {
  return MODELS[type].seconds
}

// ------------------------------------------------------- synthesized types

/** Clavinet D6: plucked, very fast decay, strong odd partials, funk "bark". */
export function synthClavSample(note: number, velocity: number, t: number): number {
  if (t < 0) return 0
  const f = midiToFreq(note)
  const register = 1 + Math.max(0, (note - 60) / 36)
  const vel = 0.3 + 0.7 * velocity
  let s = 0
  const parts: [number, number, number][] = [
    [1, 0.7, 6.5],
    [3.0, 0.5, 9.0],
    [5.0, 0.28, 12.5],
    [7.0, 0.16, 16],
    [2.0, 0.12, 8],
  ]
  for (const [ratio, gain, decay] of parts) {
    const env = Math.exp(-decay * register * t)
    s += gain * env * Math.sin(TAU * f * ratio * t)
  }
  // String pluck "bark": fast bright transient.
  s += 0.5 * Math.exp(-220 * t) * Math.sign(Math.sin(TAU * f * 4 * t))
  const attack = Math.min(1, t / 0.0015)
  return s * vel * attack * 0.5
}

/** Digital piano: FM-ish layered EP — smooth, chorus-like double, glassy. */
export function synthDigitalSample(note: number, velocity: number, t: number): number {
  if (t < 0) return 0
  const f = midiToFreq(note)
  const vel = 0.3 + 0.7 * velocity
  let s = 0
  const parts: [number, number, number][] = [
    [1, 0.9, 1.3],
    [1.003, 0.5, 1.7],
    [2.0, 0.22, 2.6],
    [3.01, 0.18, 4.0],
    [4.0, 0.07, 6.0],
    [6.02, 0.03, 9.0],
  ]
  for (const [ratio, gain, decay] of parts) {
    s += gain * Math.exp(-decay * t) * Math.sin(TAU * f * ratio * t)
  }
  const attack = Math.min(1, t / 0.003)
  return s * vel * attack * 0.42
}

/** Misc: marimba — near-sine fundamental + short 4th harmonic, fast decay. */
export function synthMiscSample(note: number, velocity: number, t: number): number {
  if (t < 0) return 0
  const f = midiToFreq(note)
  const vel = 0.3 + 0.7 * velocity
  let s = 0
  s += 1.0 * Math.exp(-6.5 * t) * Math.sin(TAU * f * t)
  s += 0.5 * Math.exp(-20 * t) * Math.sin(TAU * f * 4.02 * t)
  s += 0.16 * Math.exp(-38 * t) * Math.sin(TAU * f * 9.8 * t)
  // Mallet attack.
  s += 0.5 * Math.exp(-160 * t) * Math.sign(Math.sin(TAU * f * 2 * t))
  const attack = Math.min(1, t / 0.001)
  return s * vel * attack * 0.5
}

/** Render a synthesized-type voice to a mono buffer (runtime synthesis for Clav/Digital/Misc). */
export function renderSynthType(type: 'clav' | 'digital' | 'misc', note: number, velocity: number, seconds: number, sampleRate: number): Float32Array {
  const fn = type === 'clav' ? synthClavSample : type === 'digital' ? synthDigitalSample : synthMiscSample
  const n = Math.max(1, Math.floor(seconds * sampleRate))
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = fn(note, velocity, i / sampleRate)
  return out
}
