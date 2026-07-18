/**
 * Organ source models (Phase 3, specs/nord-stage-4.organ.json).
 *
 * Each model renders a mono voice buffer from its drawbar spectrum with
 * genuinely different additive content — B3 (nine tonewheel partials with
 * tapering + key click + percussion envelope), B3 Bass (B3 reuse limited to
 * 16′+8′), Vox (seven partials + filtered/unfiltered mix drawbar), Farf
 * (register switches gating a bright stack), Pipe 1 (nine flute ranks, slow
 * attack), Pipe 2 (Pipe 1 reuse with a brighter principal registration).
 * All synthesis is deterministic (seeded noise, phase accumulators).
 */

import { TAU, midiToFreq, makeNoise } from './dsp'
import type { OrganLayerState } from '../state/organ-state'

export interface OrganVoiceSpec {
  note: number // target MIDI (layer octave + transpose already applied)
  velocity: number
  seconds: number
  sampleRate: number
}

/** Drawbar gain mapping 0..8 (hardware taper: roughly exponential). */
function drawbarGain(pos: number): number {
  if (pos <= 0) return 0
  return Math.pow(pos / 8, 1.6)
}

/** B3 tonewheel partials: harmonic multiplier + tonewheel taper per drawbar index. */
const B3_PARTIALS: readonly { ratio: number; taper: number }[] = [
  { ratio: 0.5, taper: 1.0 }, // 16'
  { ratio: 1.5, taper: 0.89 }, // 5 1/3'
  { ratio: 1, taper: 1.0 }, // 8'
  { ratio: 2, taper: 0.79 }, // 4'
  { ratio: 3, taper: 0.63 }, // 2 2/3'
  { ratio: 4, taper: 0.56 }, // 2'
  { ratio: 5, taper: 0.5 }, // 1 3/5'
  { ratio: 6, taper: 0.45 }, // 1 1/3'
  { ratio: 8, taper: 0.4 }, // 1'
]

/** Vox: seven partial drawbars (indexes 0..6) + mix drawbar (index 8). */
const VOX_PARTIALS: readonly { ratio: number; taper: number }[] = [
  { ratio: 0.5, taper: 1.0 }, // 16'
  { ratio: 1, taper: 1.0 }, // 8'
  { ratio: 2, taper: 0.8 }, // 4'
  { ratio: 2.66, taper: 0.55 }, // 2 2/3' (mutation-ish quint)
  { ratio: 4, taper: 0.5 }, // 2'
  { ratio: 8, taper: 0.35 }, // 1' (brilliant)
  { ratio: 1.5, taper: 0.4 }, // IV mix rank
]

/** Vox core enrichment (transistor reediness — even-harmonic rich). */
const VOX_ENRICH: readonly { ratio: number; gain: number }[] = [
  { ratio: 2.0, gain: 0.5 },
  { ratio: 6.0, gain: 0.28 },
  { ratio: 10.0, gain: 0.16 },
]

/** Farf register switches: each drawbar gates a footage of a bright stack. */
const FARF_REGISTERS: readonly { ratio: number; gain: number }[] = [
  { ratio: 0.5, gain: 0.8 }, // Bass 16'
  { ratio: 1, gain: 1.0 }, // 8'
  { ratio: 1.5, gain: 0.45 }, // Quint 5 1/3
  { ratio: 2, gain: 0.8 }, // 4'
  { ratio: 3, gain: 0.5 }, // 2 2/3
  { ratio: 4, gain: 0.7 }, // 2'
  { ratio: 5, gain: 0.4 }, // 1 3/5
  { ratio: 6, gain: 0.35 }, // 1 1/3
  { ratio: 8, gain: 0.55 }, // 1' (brilliant)
]

/** Pipe ranks 16'..1': flute-ish (weak evens). */
const PIPE_RATIOS = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8] as const

interface PartialVoice {
  ratio: number
  gain: number
}

function spectrumFor(layer: OrganLayerState): { partials: PartialVoice[]; kind: 'b3' | 'vox' | 'farf' | 'pipe' } {
  const model = layer.model
  const db = layer.drawbars
  if (model === 0 || model === 1) {
    // B3 / B3 Bass (bass: reuse B3 engine limited to 16' and 8' drawbars).
    const partials: PartialVoice[] = []
    for (let i = 0; i < 9; i++) {
      if (model === 1 && i !== 0 && i !== 2) continue
      const g = drawbarGain(db[i]) * B3_PARTIALS[i].taper
      if (g > 0) partials.push({ ratio: B3_PARTIALS[i].ratio, gain: g })
    }
    return { partials, kind: 'b3' }
  }
  if (model === 2) {
    // Vox: 7 partials (indexes 0..6) + mix drawbar (index 8) blending
    // filtered (mellow) vs unfiltered (bright) content of the whole stack.
    const partials: PartialVoice[] = []
    const mix = drawbarGain(db[8])
    const bright = mix // unfiltered share
    const mellow = 1 - mix * 0.7 // filtered share keeps lows
    for (let i = 0; i < 7; i++) {
      const base = drawbarGain(db[i]) * VOX_PARTIALS[i].taper
      if (base <= 0) continue
      const g = base * (VOX_PARTIALS[i].ratio >= 4 ? bright * 1.4 : mellow)
      if (g > 0.001) partials.push({ ratio: VOX_PARTIALS[i].ratio, gain: g })
    }
    // Transistor edge: strong even-harmonic enrichment distinct from the
    // tonewheel set (Vox is bright and reedy).
    for (const e of VOX_ENRICH) partials.push({ ratio: e.ratio, gain: e.gain })
    return { partials, kind: 'vox' }
  }
  if (model === 3) {
    // Farf: on/off register switches — pulled past half (position > 4) = on.
    // The combo core is a buzzy sawtooth-ish stack (strong full harmonic
    // series), gated per register — distinctly nasal next to the Vox reeds.
    const partials: PartialVoice[] = []
    for (let i = 0; i < 9; i++) {
      if (db[i] > 4) partials.push({ ratio: FARF_REGISTERS[i].ratio, gain: FARF_REGISTERS[i].gain })
    }
    for (let h = 2; h <= 7; h++) partials.push({ ratio: h, gain: 0.3 / h })
    return { partials, kind: 'farf' }
  }
  // Pipe 1 / Pipe 2 (principal brighter: stronger high ranks).
  const partials: PartialVoice[] = []
  for (let i = 0; i < 9; i++) {
    let g = drawbarGain(db[i])
    if (g <= 0) continue
    const even = i % 2 === 1 // odd-order partials (2nd, 4th, 6th ranks) weaker for flute color
    g *= even ? 0.55 : 1
    if (model === 5) g *= 0.5 + (i / 8) * 0.9 // Pipe 2: brighter principal registration
    if (g > 0.001) partials.push({ ratio: PIPE_RATIOS[i], gain: g })
  }
  return { partials, kind: 'pipe' }
}

/**
 * Render one organ voice (mono). `vibratoCents` is a function of time (sec)
 * supplied by the caller for vibrato/chorus (kept out of the source so the
 * same buffer code serves tests and the browser).
 */
export function renderOrganVoice(layer: OrganLayerState, spec: OrganVoiceSpec, vibratoCents: (t: number) => number): Float32Array {
  const sr = spec.sampleRate
  const n = Math.max(1, Math.floor(spec.seconds * sr))
  const out = new Float32Array(n)
  const { partials, kind } = spectrumFor(layer)
  if (partials.length === 0) return out
  const freq = midiToFreq(spec.note)
  const totalGain = partials.reduce((s, p) => s + p.gain, 0) || 1
  const velGain = 0.3 + 0.7 * spec.velocity
  // Per-kind envelope: organs sustain; pipes attack slowly; farf has a fast
  // bright settle; b3 clicks on attack.
  const attack = kind === 'pipe' ? 0.045 : kind === 'vox' ? 0.008 : 0.004
  const phases = partials.map(() => 0)
  const noise = makeNoise(0x9e3779b9 + spec.note * 97)
  const perc = layer.percussion
  const b3 = kind === 'b3' && layer.model === 0
  const percDecay = perc.fast ? 26 : 5 // 1/s
  const percGain = b3 && perc.on ? (perc.soft ? 0.14 : 0.42) : 0
  const percRatio = perc.third ? 3 : 2 // third harmonic vs second
  let clickLeft = b3 ? Math.floor(0.012 * sr) : 0 // key click: short random transient
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const env = Math.min(1, t / attack)
    const cents = vibratoCents(t)
    const bend = Math.pow(2, cents / 1200)
    let s = 0
    for (let p = 0; p < partials.length; p++) {
      phases[p] = (phases[p] + (freq * partials[p].ratio * bend) / sr) % 1
      let w = Math.sin(TAU * phases[p])
      if (kind === 'farf') {
        // Buzzy transistor edge: blend toward a squarish shape.
        w = w * 0.7 + Math.sign(w) * Math.pow(Math.abs(w), 0.6) * 0.3
      }
      s += w * partials[p].gain
    }
    s /= totalGain
    // Percussion: single decaying attack partial (retrigger handled by the
    // engine's all-keys-released gate; each rendered voice includes its own).
    if (percGain > 0) {
      const penv = Math.exp(-t * percDecay)
      s += Math.sin(TAU * freq * percRatio * bend * t) * percGain * penv
      // Fast decay additionally pulls the drawbar body down early (the
      // percussion envelope robs the tonewheels, manual p. 20 behavior).
      if (perc.fast) s *= 0.35 + 0.65 * (1 - Math.exp(-t * 30))
    }
    // Key click: deterministic noise burst at attack.
    if (clickLeft > 0) {
      s += noise() * 0.12 * (clickLeft / (0.012 * sr))
      clickLeft--
    }
    out[i] = s * env * velGain * 0.5
  }
  return out
}

/** Vibrato/chorus as a cents-vs-time function (depth grows 1→3; C mixes dry+mod — approximated as deeper mixed sweep). */
export function makeVibratoFn(mode: number, on: boolean): (t: number) => number {
  if (!on) return () => 0
  // mode: 0..2 = V1..V3, 3..5 = C1..C3
  const idx = mode % 3
  const isChorus = mode >= 3
  const rate = 6.9 // Hz, classic scanner rate
  const depthCents = [14, 28, 48][idx] * (isChorus ? 0.75 : 1) * (isChorus ? 1 : 1)
  return (t) => depthCents * Math.sin(TAU * rate * t)
}
