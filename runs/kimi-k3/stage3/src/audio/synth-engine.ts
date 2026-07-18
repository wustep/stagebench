/**
 * Synth voice + arpeggiator/gate engine (Phase 3).
 *
 * Pure deterministic DSP: each voice renders mono samples through its
 * oscillator, filter (LP12/LP24/HP/BP with tracking/resonance/drive), three
 * envelopes, and LFO. The arpeggiator/gate is a pure step sequencer —
 * deterministic under a fixed clock — consumed by the render orchestrator
 * (offline/test path) and by the browser backend (real-time path).
 */

import { Biquad, TAU, clamp, clamp01, makeNoise, midiToFreq } from './dsp'
import { createOscillator, SynthEnvelope, type Oscillator } from './synth-models'
import { SYNC_DIVISION_BEATS, type SynthLayerState } from '../state/synth-state'

// ---------------------------------------------------------------- filter

const TRACK_SCALE = [0, 1 / 3, 2 / 3, 1] as const

/** Cutoff Hz for a note: base knob sweep × keyboard tracking. */
export function filterCutoffHz(layer: SynthLayerState, note: number): number {
  const base = 30 * Math.pow(6000 / 30, clamp01(layer.filterFreq / 127))
  const track = TRACK_SCALE[clamp(0, 3, layer.filterKbTrack) as 0 | 1 | 2 | 3]
  const semis = (note - 60) * track
  return clamp(base * Math.pow(2, semis / 12), 25, 16000)
}

function resonanceQ(res: number): number {
  return 0.6 + clamp01(res / 127) * 11
}

function driveGain(level: number): number {
  return [1, 2.2, 4.5, 8][clamp(0, 3, level) as 0 | 1 | 2 | 3]
}

/** Stateful per-voice filter (one or two biquads + tanh drive). */
export class SynthFilter {
  private b1 = new Biquad()
  private b2 = new Biquad()

  process(x: number, layer: SynthLayerState, cutoffHz: number, sr: number): number {
    const q = resonanceQ(layer.filterRes)
    const g = driveGain(layer.filterDrive)
    const driven = Math.tanh(x * g) / Math.tanh(g)
    switch (layer.filterType) {
      case 0:
        this.b1.set('lowpass', sr, cutoffHz, q)
        return this.b1.next(driven)
      case 1:
        this.b1.set('lowpass', sr, cutoffHz, q)
        this.b2.set('lowpass', sr, cutoffHz, Math.max(0.5, q * 0.5))
        return this.b2.next(this.b1.next(driven))
      case 2:
        this.b1.set('highpass', sr, cutoffHz, q)
        return this.b1.next(driven)
      default:
        this.b1.set('bandpass', sr, cutoffHz, Math.max(0.8, q))
        return this.b1.next(driven)
    }
  }
}

// ---------------------------------------------------------------- LFO

export interface LfoState {
  phase: number
  shValue: number
  noise: () => number
}

export function createLfoState(seed: number): LfoState {
  return { phase: 0, shValue: 0, noise: makeNoise(0xc0ffee ^ (seed * 131)) }
}

/** LFO rate in Hz; when synced, derived from the master clock. */
export function lfoRateHz(layer: SynthLayerState, bpm: number): number {
  if (layer.lfoSync) {
    const idx = clamp(0, SYNC_DIVISION_BEATS.length - 1, Math.round(layer.lfoRate) % SYNC_DIVISION_BEATS.length)
    return bpm / 60 / SYNC_DIVISION_BEATS[idx]
  }
  return 0.05 + Math.pow(clamp01(layer.lfoRate / 127), 1.8) * 24
}

/** Advance the LFO one sample; returns value in [-1,1]. */
export function lfoNext(st: LfoState, layer: SynthLayerState, rateHz: number, sr: number): number {
  const prev = st.phase
  st.phase = (st.phase + rateHz / sr) % 1
  switch (layer.lfoWave) {
    case 0:
      return 4 * Math.abs(st.phase - 0.5) - 1
    case 1: // Saw down
      return 1 - 2 * st.phase
    case 2: // Saw up
      return 2 * st.phase - 1
    case 3:
      return st.phase < 0.5 ? 1 : -1
    default: {
      // Sample & Hold: new value each cycle.
      if (st.phase < prev) st.shValue = st.noise()
      return st.shValue
    }
  }
}

// ---------------------------------------------------------------- voice

export interface SynthVoiceInit {
  note: number
  velocity: number
  /** Starting note for glide (constant-rate portamento), if any. */
  glideFrom: number | null
  seed: number
}

/**
 * One synth voice. `render` fills `n` samples; `noteOff()` starts the
 * release; `isDone` reports full decay.
 */
export class SynthVoice {
  private filter = new SynthFilter()
  private osc: Oscillator
  private oscEnv: SynthEnvelope
  private filterEnv: SynthEnvelope
  private ampEnv: SynthEnvelope
  private lfo: LfoState
  private readonly layer: SynthLayerState
  private readonly note: number
  private readonly glideFrom: number | null
  private glideT = 0
  private t = 0
  readonly velocity: number

  constructor(layer: SynthLayerState, init: SynthVoiceInit, private sr: number) {
    this.layer = layer
    this.note = init.note
    this.velocity = init.velocity
    this.glideFrom = init.glideFrom
    this.lfo = createLfoState(init.seed)
    this.osc = createOscillator(layer.oscWave, init.seed)
    this.oscEnv = new SynthEnvelope({ ...layer.oscEnv, playedVelocity: init.velocity })
    this.filterEnv = new SynthEnvelope({ ...layer.filterEnv, playedVelocity: init.velocity })
    this.ampEnv = new SynthEnvelope({ ...layer.ampEnv, playedVelocity: init.velocity })
  }

  noteOff(): void {
    this.oscEnv.noteOff()
    this.filterEnv.noteOff()
    this.ampEnv.noteOff()
  }

  get isDone(): boolean {
    return this.ampEnv.isDone
  }

  /** Current pitch in MIDI (with glide), before vibrato/LFO. */
  private baseNote(dt: number): number {
    if (this.glideFrom === null || this.layer.glide <= 0) return this.note
    this.glideT += dt
    const span = this.note - this.glideFrom
    // Constant-rate: knob 0..127 → 0.02..2.5 s per octave.
    const seconds = (Math.abs(span) / 12) * (0.02 + Math.pow(this.layer.glide / 127, 1.6) * 2.5) + 0.005
    const k = Math.min(1, this.glideT / seconds)
    return this.glideFrom + span * k
  }

  render(n: number, bpm: number, transpose: number, wheelPos: number, out: Float32Array, offset = 0): void {
    const layer = this.layer
    const sr = this.sr
    const dt = 1 / sr
    const lfoHz = lfoRateHz(layer, bpm)
    const lfoAmt = clamp01(layer.lfoAmount / 127)
    const vibratoHz = 2 + clamp01(layer.vibratoRate / 127) * 6
    const vibratoOn = layer.vibrato === 1 || (layer.vibrato === 2 && wheelPos > 0.01)
    const vibratoDepthSemis = (clamp01(layer.vibratoAmount / 127) * 70 * (layer.vibrato === 2 ? wheelPos : 1)) / 100
    const freqs = new Float32Array(n)
    const ctrls = new Float32Array(n)
    const gains = new Float32Array(n)
    const cutoffs = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const t = this.t
      const oscE = this.oscEnv.next(dt)
      const filtE = this.filterEnv.next(dt)
      const ampE = this.ampEnv.next(dt)
      const lfoV = layer.lfoDest === 0 ? 0 : lfoNext(this.lfo, layer, lfoHz, sr) * lfoAmt
      // Pitch: base + transpose + coarse/fine + vibrato + LFO→pitch + oscEnv→pitch
      let semis = this.baseNote(dt) + transpose + layer.oscCoarse + layer.oscFine / 100
      if (vibratoOn) semis += vibratoDepthSemis * Math.sin(TAU * vibratoHz * t)
      if (layer.lfoDest === 1) semis += lfoV * 2
      if (layer.envToPitch) semis += (layer.oscEnv.amount / 64) * 24 * oscE
      freqs[i] = midiToFreq(clamp(semis, 0, 127))
      // Osc Ctrl: base + LFO→ctrl + oscEnv→ctrl
      let ctrl = clamp01(layer.oscCtrl / 127)
      if (layer.lfoDest === 2) ctrl = clamp01(ctrl + lfoV * 0.5)
      if (!layer.envToPitch && layer.oscEnv.amount !== 0) ctrl = clamp01(ctrl + (layer.oscEnv.amount / 64) * oscE * 0.5)
      ctrls[i] = ctrl
      // Filter: cutoff + tracking + env + LFO→filter
      const tracked = filterCutoffHz(layer, Math.round(clamp(semis, 0, 127)))
      const envOct = clamp01(layer.filterEnvAmt / 127) * 4
      let cutoff = tracked * Math.pow(2, filtE * envOct)
      if (layer.lfoDest === 3) cutoff *= Math.pow(2, lfoV * 4)
      cutoffs[i] = clamp(cutoff, 25, 16000)
      gains[i] = ampE
      this.t += dt
    }
    // Oscillators are phase accumulators, so per-sample (freq, ctrl) must be
    // fed sample-wise; envelopes/LFO already computed above.
    for (let i = 0; i < n; i++) {
      const one = new Float32Array(1)
      this.osc.render(freqs[i], ctrls[i], 1, sr, one, 0)
      const y = this.filter.process(one[0], layer, cutoffs[i], sr)
      out[offset + i] += y * gains[i] * 0.5
    }
  }
}

// ---------------------------------------------------------------- arpeggiator / gate

export interface ArpStep {
  /** Notes that start at this step. */
  notes: number[]
  /** True when the step re-triggers envelopes (gate close between steps). */
  gate: boolean
}

/**
 * Deterministic arpeggiator/gate step sequencer.
 *
 * Given the held note set (sorted unique MIDI), range in octaves, direction,
 * and mode, `step()` returns the next event. A seeded LCG drives Random so a
 * fixed clock + note set is reproducible.
 */
export class Arpeggiator {
  private index = 0
  private lcg = makeNoise(0xa249 ^ 0x2545)

  /** Expanded note pool per the current settings. */
  static pool(notes: number[], range: number, mode: number): number[] {
    const unique = [...new Set(notes)].sort((a, b) => a - b)
    if (unique.length === 0) return []
    if (mode === 1 || mode === 2) return unique // Poly / Gate: the chord itself
    const out: number[] = []
    for (let o = 0; o < Math.max(1, range); o++) {
      for (const n of unique) out.push(n + o * 12)
    }
    return out
  }

  reset(): void {
    this.index = 0
  }

  /** Next step for a layer; `pool` from Arpeggiator.pool. */
  step(layer: SynthLayerState, pool: number[]): ArpStep {
    if (pool.length === 0) return { notes: [], gate: false }
    if (layer.arpMode === 1 || layer.arpMode === 2) {
      // Poly / Gate: every step plays the whole held chord.
      return { notes: pool, gate: true }
    }
    let note: number
    switch (layer.arpDirection) {
      case 0: // Up
        note = pool[this.index % pool.length]
        this.index++
        break
      case 1: // Down
        note = pool[pool.length - 1 - (this.index % pool.length)]
        this.index++
        break
      case 2: {
        // Up/Down (ping-pong, endpoints not repeated)
        const cycle = pool.length > 1 ? pool.length * 2 - 2 : 1
        const k = this.index % cycle
        note = k < pool.length ? pool[k] : pool[cycle - k]
        this.index++
        break
      }
      default: {
        // Random (seeded → deterministic)
        note = pool[Math.abs(Math.floor(this.lcg() * 0x7fff)) % pool.length]
        this.index++
        break
      }
    }
    return { notes: [note], gate: true }
  }

  /** Test seam: the raw sequence of upcoming single notes without state peeking. */
  sequence(layer: SynthLayerState, pool: number[], count: number): number[] {
    const out: number[] = []
    for (let i = 0; i < count; i++) {
      const s = this.step(layer, pool)
      out.push(s.notes[0] ?? -1)
    }
    return out
  }
}

/** Steps per second for the arp/gate under free rate or clock sync. */
export function arpStepsPerSecond(layer: SynthLayerState, bpm: number): number {
  if (layer.arpSync) {
    const idx = clamp(0, SYNC_DIVISION_BEATS.length - 1, Math.round(layer.arpRate) % SYNC_DIVISION_BEATS.length)
    return bpm / 60 / SYNC_DIVISION_BEATS[idx]
  }
  // Free: quarter-note BPM 30..300 mapped across the knob.
  const qbpm = 30 + clamp01(layer.arpRate / 127) * 270
  return qbpm / 60
}
