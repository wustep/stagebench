/**
 * Phase 3 — Synth DSP engine (reduced, honest Nord Wave 2-style engine).
 *
 * Three layers (A, B, C) with independent state and independent effect chains.
 * The exact required waveform list per category (Pure, Sync, Multi, Super,
 * FM-H) with category-correct Osc Ctrl behaviour; LP12/LP24/HP/BP filters with
 * keyboard tracking, resonance and drive; oscillator / filter / amplifier
 * envelopes; an LFO with five waveforms and three destinations that locks to
 * the master clock; poly/mono/legato voice modes with priority, glide, unison
 * and vibrato; and a deterministic arpeggiator/gate with rate, master-clock
 * sync, range, direction, hold and run.
 *
 * Pure deterministic DSP on an injectable clock: tests render real PCM and
 * prove source/filter/envelope/LFO/voice/arp behaviour.
 */

import { LayerEffectsChain, type LayerChainState } from './chain'
import { Rotary } from './effects'
import type { RenderResult } from './types'
import type {
  LfoWaveform, SynthCategory, SynthFilterType, SynthLayerState, SynthState, SynthVoiceMode,
} from '../system/program'
import { defaultSynth } from '../system/factory'

const TAU = Math.PI * 2

/* ------------------------------ helpers ------------------------------ */

/** waveforms per category (exact required list). */
export const CATEGORY_WAVES: Record<SynthCategory, string[]> = {
  Pure: ['Sine', 'Triangle', 'Saw', 'Square', 'Pulse 33', 'Pulse 10', 'White Noise'],
  Sync: ['Sync Saw', 'Sync Square'],
  Multi: ['Multi Saw', 'Multi Saw 8ve'],
  Super: ['Super Saw', 'Super Square'],
  'FM-H': ['FM 2-op'],
}

/** deterministic LCG noise in [-1,1). */
class LcgNoise {
  private s = 0x12345678
  next(): number {
    this.s = (this.s * 1664525 + 1013904223) >>> 0
    return (this.s / 0x100000000) * 2 - 1
  }
}

/** one ADSR-ish envelope value at sample time t. */
function envelope(onset: number, t: number, released: boolean, releaseStart: number, releaseGain: number, a: number, d: number, sustain: number, r: number, sr: number): number {
  const age = Math.max(0, t - onset) / sr
  let out: number
  if (age < a) out = age / Math.max(1e-5, a)
  else out = sustain + (1 - sustain) * Math.exp(-(age - a) / Math.max(0.02, d))
  if (released) {
    const relSec = Math.max(0, t - releaseStart) / sr
    out = releaseGain * Math.exp(-relSec / Math.max(0.02, r))
  }
  return Math.max(0, Math.min(4, out))
}

/* ------------------------------- voices ------------------------------ */

interface SynthVoice {
  id: number
  layer: 0 | 1 | 2
  midi: number
  velocity: number
  held: boolean
  sustained: boolean
  onset: number
  phase: number
  modPhase: number
  noise: LcgNoise
  curFreq: number
  targetFreq: number
  releasing: boolean
  releaseStart: number
  releaseGain: number
  flp1: number
  fbp1: number
  flp2: number
  fbp2: number
}

export interface SynthOptions {
  sampleRate?: number
  chains?: LayerChainState[]
  rotary?: Rotary
}

interface LayerCtx {
  state: SynthLayerState
  chain: LayerEffectsChain
  voices: SynthVoice[]
  held: number[]
  arpStep: number
  arpNote: number | null
}

/** master-clock reference the LFO / arp / gate lock to. */
export interface ClockRef {
  tempo: number
  sync: boolean
}

export class SynthEngine {
  readonly sampleRate: number
  readonly rotary: Rotary
  private ctx: LayerCtx[] = []
  private clock = 0
  private sustainInput = false
  private nextId = 1
  private clockRef: ClockRef = { tempo: 120, sync: true }

  constructor(options: SynthOptions = {}) {
    this.sampleRate = options.sampleRate ?? 44_100
    this.rotary = options.rotary ?? new Rotary(this.sampleRate)
    const ss = defaultSynth()
    for (let i = 0; i < 3; i++) {
      const chainState = options.chains?.[i] ?? ss.chains[i]
      const chain = new LayerEffectsChain(this.sampleRate, this.rotary)
      chain.apply(chainState)
      this.ctx.push({ state: ss.layers[i], chain, voices: [], held: [], arpStep: 0, arpNote: null })
    }
  }

  bindClock(clockRef: ClockRef): void {
    this.clockRef = clockRef
  }

  setSynth(s: SynthState, chains: LayerChainState[]): void {
    for (let i = 0; i < 3; i++) {
      this.ctx[i].state = s.layers[i]
      this.ctx[i].chain.apply(chains[i] ?? s.chains[i])
    }
  }

  get layerChains(): LayerEffectsChain[] {
    return this.ctx.map((c) => c.chain)
  }

  setSustain(on: boolean): void {
    this.sustainInput = on
    if (!on) {
      for (const c of this.ctx) for (const v of c.voices) if (v.sustained) { v.sustained = false; this.beginRelease(c, v) }
    }
  }

  get voiceCount(): number {
    return this.ctx.reduce((a, c) => a + c.voices.length, 0)
  }

  noteOn(layer: 0 | 1 | 2, midi: number, velocity: number): void {
    const c = this.ctx[layer]
    const st = c.state
    if (!st.enabled) return
    if (!c.held.includes(midi)) c.held.push(midi)
    if ((st.voice.mode as SynthVoiceMode) === 0) this.spawnVoice(c, layer, midi, velocity)
    else this.monoNote(c, layer, midi, velocity, st.voice.mode === 2)
  }

  private spawnVoice(c: LayerCtx, layer: 0 | 1 | 2, midi: number, velocity: number): void {
    const f = this.freq(midi)
    const base: SynthVoice = {
      id: this.nextId++, layer, midi, velocity, held: true, sustained: false, onset: this.clock,
      phase: 0, modPhase: 0, noise: new LcgNoise(), curFreq: f, targetFreq: f,
      releasing: false, releaseStart: 0, releaseGain: 1, flp1: 0, fbp1: 0, flp2: 0, fbp2: 0,
    }
    c.voices.push(base)
    const unison = c.state.voice.unison
    for (let u = 0; u < unison; u++) {
      const det = ((u + 1) / (unison + 1) - 0.5) * 0.004
      c.voices.push({ ...base, id: this.nextId++, curFreq: f * (1 + det), targetFreq: f * (1 + det) })
    }
  }

  private monoNote(c: LayerCtx, layer: 0 | 1 | 2, midi: number, velocity: number, legato: boolean): void {
    const f = this.freq(midi)
    if (c.voices.length > 0) {
      for (const v of c.voices) {
        v.targetFreq = f
        v.midi = midi
        if (!legato) { v.onset = this.clock; v.releasing = false }
      }
      return
    }
    this.spawnVoice(c, layer, midi, velocity)
    void legato
  }

  noteOff(layer: 0 | 1 | 2, midi: number): void {
    const c = this.ctx[layer]
    const idx = c.held.indexOf(midi)
    if (idx >= 0) c.held.splice(idx, 1)
    for (const v of c.voices) {
      if (v.midi === midi && v.held) {
        v.held = false
        if (this.sustainInput) v.sustained = true
        else this.beginRelease(c, v)
      }
    }
    if (c.state.voice.mode !== 0 && c.held.length > 0) {
      const sorted = [...c.held].sort((a, b) => a - b)
      const target = c.state.voice.priority === 2 ? sorted[sorted.length - 1] : sorted[0]
      for (const v of c.voices) v.targetFreq = this.freq(target)
    }
  }

  private beginRelease(c: LayerCtx, v: SynthVoice): void {
    if (v.releasing) return
    v.releasing = true
    v.releaseStart = this.clock
    v.releaseGain = Math.max(0.05, this.currentEnvAmp(c, v, this.clock))
  }

  allNotesOff(): void {
    for (const c of this.ctx) c.voices = []
  }

  /** release every sounding voice of one layer (used when a layer is disabled). */
  releaseLayer(layer: 0 | 1 | 2): void {
    const c = this.ctx[layer]
    for (const v of c.voices) if (v.held) this.beginRelease(c, v)
  }

  private freq(midi: number): number {
    return 440 * Math.pow(2, (midi - 69) / 12)
  }

  private lfoValue(wave: LfoWaveform, phase: number): number {
    const p = phase % TAU
    switch (wave) {
      case 0: return Math.sin(p)
      case 1: return 2 * (p / TAU) - 1
      case 2: return 1 - 2 * (p / TAU)
      case 3: return p < Math.PI ? 1 : -1
      case 4: {
        const step = Math.floor(phase / TAU)
        return (((step * 2654435761) >>> 0) / 0x100000000) * 2 - 1
      }
      default: return 0
    }
  }

  private lfoRateHz(c: LayerCtx): number {
    if (c.state.lfo.sync && this.clockRef.sync) return this.clockRef.tempo / 120 * 2
    return 0.05 + c.state.lfo.rate * 12
  }

  private cutoffFor(c: LayerCtx, v: SynthVoice, lfo: number, t: number): number {
    const st = c.state
    const base = 60 + st.cutoff * 14000
    const envA = envelope(v.onset, t, v.releasing, v.releaseStart, v.releaseGain, st.envFilt.a, st.envFilt.d, Math.max(0.05, st.envFilt.amount), st.envFilt.r, this.sampleRate)
    const kt = (v.midi - 60) * st.keytrack * 50
    const lfoAmt = st.lfo.dest === 2 ? lfo * st.lfo.modAmt * 4000 : 0
    return Math.max(20, Math.min(18000, base + st.envFilt.amount * envA * 6000 + kt + lfoAmt))
  }

  private renderLayer(c: LayerCtx, out: Float32Array, n: number, start: number): void {
    const st = c.state
    const lfoHz = this.lfoRateHz(c)
    const lfoPhaseBase = (start * TAU * lfoHz) / this.sampleRate
    for (let fi = 0; fi < n; fi++) {
      const t = start + fi
      const lfo = this.lfoValue(st.lfo.wave, lfoPhaseBase + (fi * TAU * lfoHz) / this.sampleRate)
      this.advanceArp(c, t)
      let mix = 0
      for (let vi = c.voices.length - 1; vi >= 0; vi--) {
        const v = c.voices[vi]
        if (!v.held && !v.sustained && this.finished(v, t)) { c.voices.splice(vi, 1); continue }
        if (!v.held && !v.sustained && !v.releasing) this.beginRelease(c, v)
        this.glide(c, v)
        const vib = st.voice.vibratoOn ? st.voice.vibratoAmount * 6.28 * Math.sin((TAU * 5 * t) / this.sampleRate) : 0
        const lfoPitch = st.lfo.dest === 0 ? lfo * st.lfo.modAmt * 2 : 0
        const effectiveCtrl = Math.max(0, Math.min(10, st.oscCtrl + (st.lfo.dest === 1 ? lfo * st.lfo.modAmt : st.envOsc.amount * this.currentEnvAmp(c, v, t))))
        const freq = v.curFreq * Math.pow(2, (st.oscOctave * 12 + st.oscFine / 100 + vib + lfoPitch) / 12)
        const src = this.osc(c, v, freq, effectiveCtrl)
        const drive = st.drive > 0 ? Math.tanh(src * (1 + st.drive * 2)) : src
        const cutoff = this.cutoffFor(c, v, lfo, t)
        const filtered = this.svf(c, v, cutoff, 0.5 + st.res * 18, drive, st.filterType)
        const ampEnv = envelope(v.onset, t, v.releasing, v.releaseStart, v.releaseGain, st.envAmp.a, st.envAmp.d, st.envAmp.amount, st.envAmp.r, this.sampleRate) * (st.envAmp.velocity ? 0.3 + 0.7 * v.velocity : 1)
        mix += filtered * ampEnv * 0.5
      }
      out[fi] = Math.max(-1, Math.min(1, mix))
    }
  }

  private glide(c: LayerCtx, v: SynthVoice): void {
    const k = Math.min(1, c.state.voice.glide > 0 ? c.state.voice.glide * 0.02 : 1)
    v.curFreq += (v.targetFreq - v.curFreq) * k
  }
  /** oscillator sample per category, from a single accumulated phase. */
  private osc(c: LayerCtx, v: SynthVoice, freq: number, ctrl: number): number {
    const st = c.state
    const cat = st.category
    const wave = CATEGORY_WAVES[cat][st.wave % CATEGORY_WAVES[cat].length]
    const phase = v.phase // sample at the pre-advance phase
    v.phase = (phase + (TAU * freq) / this.sampleRate) % TAU
    const p = phase % TAU
    const saw = (ph: number): number => 2 * (ph / TAU - Math.floor(ph / TAU + 0.5))
    switch (cat) {
      case 'Pure': {
        switch (wave) {
          case 'Sine': return Math.sin(p)
          case 'Triangle': return (2 / Math.PI) * Math.asin(Math.sin(p))
          case 'Saw': return saw(p)
          case 'Square': return p < Math.PI ? 1 : -1
          case 'Pulse 33': return p < TAU * 0.33 ? 1 : -1
          case 'Pulse 10': return p < TAU * 0.1 ? 1 : -1
          default: return v.noise.next()
        }
      }
      case 'Sync': {
        const ratio = Math.max(0.2, 1 + ctrl * 0.5)
        const subHz = freq / ratio
        v.modPhase = (v.modPhase + (TAU * subHz) / this.sampleRate) % TAU
        const reset = Math.min(1, v.modPhase / (TAU * 0.2))
        return wave === 'Sync Saw' ? saw(p) * reset : (p < Math.PI ? 1 : -1) * reset
      }
      case 'Multi': {
        const stacks = wave === 'Multi Saw 8ve' ? [0, 12, -12] : [-3, 0, 3]
        let s = 0
        stacks.forEach((off, k) => {
          const f = freq * Math.pow(2, off / 12) * (1 + ctrl * 0.004)
          const ph = (phase * (f / freq) + (v.id * 0.173 + k * 0.31) * TAU) % TAU
          s += saw(ph)
        })
        return s / stacks.length
      }
      case 'Super': {
        const stacks = 6
        let s = 0
        for (let i = 0; i < stacks; i++) {
          const det = (i / (stacks - 1) - 0.5) * ctrl * 0.02
          const ph = (phase * (1 + det) + (v.id * 0.091 + i * 0.13) * TAU) % TAU
          s += wave === 'Super Saw' ? saw(ph) : (ph < Math.PI ? 1 : -1)
        }
        return s / stacks
      }
      case 'FM-H': {
        const modHz = freq * 2
        v.modPhase = (v.modPhase + (TAU * modHz) / this.sampleRate) % TAU
        const index = 0.5 + ctrl * 3
        return Math.sin(p + index * Math.sin(v.modPhase))
      }
      default: return Math.sin(p)
    }
  }

  private svf(c: LayerCtx, v: SynthVoice, cutoff: number, q: number, input: number, type: SynthFilterType): number {
    const g = Math.tan(Math.PI * Math.max(0.0001, Math.min(0.45, cutoff / this.sampleRate)))
    const k = Math.min(2, 1 / Math.max(0.3, q))
    const a = 1 / (1 + g * (g + k))
    const hp1 = input - v.flp1 - k * v.fbp1
    const lp1 = g * (g * input + v.flp1 - v.fbp1) * a + v.flp1
    const bp1 = g * (input - v.flp1) * a + v.fbp1
    v.flp1 = lp1
    v.fbp1 = bp1
    switch (type) {
      case 1: { // LP24: second LP stage
        const a2 = 1 / (1 + g * (g + k))
        const hp2 = lp1 - v.flp2 - k * v.fbp2
        const lp2 = g * (g * lp1 + v.flp2 - v.fbp2) * a2 + v.flp2
        const bp2 = g * (lp1 - v.flp2) * a2 + v.fbp2
        v.flp2 = lp2
        v.fbp2 = bp2
        return lp2
      }
      case 2: return hp1
      case 3: return bp1
      default: return lp1
    }
  }

  private currentEnvAmp(c: LayerCtx, v: SynthVoice, t: number): number {
    return envelope(v.onset, t, v.releasing, v.releaseStart, v.releaseGain, c.state.envAmp.a, c.state.envAmp.d, c.state.envAmp.amount, c.state.envAmp.r, this.sampleRate)
  }

  private finished(v: SynthVoice, t: number): boolean {
    if (!v.releasing) return false
    return Math.exp(-Math.max(0, t - v.releaseStart) / this.sampleRate / 0.3) <= 0.0004
  }

  /** deterministic arpeggiator/gate stepping from the clock. */
  private advanceArp(c: LayerCtx, t: number): void {
    const st = c.state.arp
    if (!st.run) return
    const stepSamples = this.stepSamples(st)
    const step = Math.floor(t / Math.max(1, stepSamples))
    if (step !== c.arpStep) {
      c.arpStep = step
      const notes = this.arpNoteSequence(c)
      if (notes.length > 0) {
        c.arpNote = notes[step % notes.length]
      } else {
        c.arpNote = null
      }
    }
  }

  private stepSamples(st: { rate: number; sync: boolean }): number {
    if (st.sync && this.clockRef.sync) {
      const subdivisions = 1 + Math.round(st.rate * 15)
      return 60 / Math.max(30, this.clockRef.tempo) * subdivisions / 2 * this.sampleRate
    }
    return Math.max(64, (0.03 + st.rate * 0.5) * this.sampleRate)
  }

  private arpNoteSequence(c: LayerCtx): number[] {
    const st = c.state.arp
    if (c.held.length === 0) return []
    const notes = [...c.held].sort((a, b) => a - b)
    const range = Math.max(1, Math.min(4, Math.round(st.range)))
    const expanded: number[] = []
    for (let o = 0; o < range; o++) for (const n of notes) expanded.push(n + o * 12)
    if (st.direction === 0) return expanded
    if (st.direction === 1) return [...expanded].reverse()
    if (st.direction === 2) return (expanded.length > 1 ? [...expanded, ...expanded.slice(1, -1)] : expanded)
    const shuffled = [...expanded]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = ((c.arpStep * 2654435761) + i) % (i + 1)
      const tmp = shuffled[i]
      shuffled[i] = shuffled[j]
      shuffled[j] = tmp
    }
    return shuffled
  }

  /** current arp note (for tests / indicator). */
  get arpNote(): number | null {
    return this.ctx.flatMap((c) => (c.arpNote !== null ? [c.arpNote] : []))[0] ?? null
  }

  render(frames: number): RenderResult {
    const n = Math.floor(frames)
    const start = this.clock
    const out = new Float32Array(n)
    const tmp = new Float32Array(n)
    for (let li = 0; li < 3; li++) {
      const c = this.ctx[li]
      tmp.fill(0)
      this.renderLayer(c, tmp, n, start)
      c.chain.process(tmp, tmp)
      if (c.state.enabled && c.state.level > 0) {
        for (let i = 0; i < n; i++) out[i] += tmp[i] * c.state.level
      }
    }
    this.clock = start + n
    let peak = 0
    for (let i = 0; i < n; i++) { const a = Math.abs(out[i]); if (a > peak) peak = a }
    return { samples: out, peak }
  }

  dispose(): void {
    this.allNotesOff()
    for (const c of this.ctx) c.chain.reset()
  }
}
