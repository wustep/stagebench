/**
 * ORGAN ENGINE (specs/nord-stage-4.organ.json, manual p. 18–22). One OrganUnit renders BOTH organ layers (the layers
 * share one effect chain, manual p. 18) into one stereo block, from the canonical panel values:
 *
 *   B3 / B3 Bass  nine tonewheel partials (sines with the 32.7 Hz–5924 Hz tonewheel foldback), 3 dB drawbar steps,
 *                 key click (random contact transient, manual p. 20), single-triggered or POLY percussion on the 2nd or
 *                 3rd harmonic with Soft / Fast variants (p. 20), scanner vibrato / chorus (a modulated delay line;
 *                 chorus mixes it with the dry signal, p. 19). B3 Bass reads the 16′ and 8′ drawbars only (p. 21).
 *   Vox           seven partial drawbars (16′ 8′ 4′ 2′ and the II / III / IV mixtures) as a mix of a filtered "flute"
 *                 (triangle-like) and an unfiltered "reed" (sawtooth-like) tone set by the rightmost drawbar; drawbar 8
 *                 is unused (p. 20). V modes = oscillator pitch vibrato, C modes = scanner-style chorus, shared by both layers.
 *   Farf          nine register switches (pulled past half = on, p. 21): divide-down square generators at 16′ / 8′ / 4′ /
 *                 2⅔′ through a fixed voicing filter per register (Bass dark, Strings bright, Flute soft, Oboe nasal,
 *                 Trumpet brassy, 2⅔ bright). Vibrato as for Vox.
 *   Pipe 1 / 2    nine flute-like ranks (fundamental + weak 2nd / 3rd harmonic) with a soft attack and a breath "chiff";
 *                 Pipe 2 is a brighter principal registration (harmonics 1..10 at 1/n^0.95). Vibrato / chorus switches to
 *                 a less precisely tuned model: per-rank random detune with a slow drift (chorus), V modes add a tremulant.
 *
 * Everything is deterministic (seeded PRNG for clicks / detune), block-size independent (per-sample processing) and
 * allocation-free inside process(): voices come from a fixed pool of 16 per layer (the oldest is stolen). Organs have no
 * velocity response, so `velocity` is accepted but not used; the note `gain` (keyboard-zone crossfade) scales the note.
 *
 * Public contract: new OrganUnit(sr) · setParams(p: OrganParams) (full object) · handle(e: OrganEvent) ·
 * process(l, r, n) / reset() · voiceCount / percussionLevel / current · heldNotes(layer).
 */
import { DRAWBAR_RATIOS, FARF_REGISTER_RATIOS, VOX_DRAWBAR_RATIOS, activeDrawbars, defaultOrganParams, drawbarGain, farfRegisterOn, type OrganEvent, type OrganLayerId, type OrganLayerParams, type OrganParams } from './organTypes'
import { clamp, faderToGain, type StereoProcessor } from './types'
import { Biquad, DelayLine, Lfo, Rng, Smoother, TWO_PI, midiHz, msToSamples } from './util'

/* ---------- band-limited wavetables (mip-mapped by harmonic count) ---------- */

const TABLE_SIZE = 2048
const MIP_LEVELS = [1, 2, 4, 8, 16, 32, 64, 128] as const

function buildTable(harmonic: (n: number) => number, maxHarmonics: number): Float32Array {
  const t = new Float32Array(TABLE_SIZE + 1)
  for (let n = 1; n <= maxHarmonics; n++) {
    const a = harmonic(n)
    if (a === 0) continue
    for (let i = 0; i < TABLE_SIZE; i++) t[i] += a * Math.sin((TWO_PI * n * i) / TABLE_SIZE)
  }
  t[TABLE_SIZE] = t[0]
  return t
}

/** A waveform stored once per harmonic budget; `select` picks the richest table that stays below Nyquist. */
class Wavetable {
  readonly levels: Float32Array[]
  constructor(harmonic: (n: number) => number) {
    this.levels = MIP_LEVELS.map((h) => buildTable(harmonic, h))
  }
  select(freq: number, sr: number): Float32Array {
    const limit = (0.45 * sr) / Math.max(1, freq)
    let idx = 0
    for (let i = 0; i < MIP_LEVELS.length; i++) if (MIP_LEVELS[i] <= limit) idx = i
    return this.levels[idx]
  }
}

function readTable(t: Float32Array, phase: number): number {
  const p = (phase - Math.floor(phase)) * TABLE_SIZE
  const i = p | 0
  return t[i] + (t[i + 1] - t[i]) * (p - i)
}

const SINE = new Wavetable((n) => (n === 1 ? 1 : 0))
/** Vox "reed" (unfiltered): sawtooth, fundamental amplitude 2/π. */
const SAW = new Wavetable((n) => ((2 / Math.PI) * (n % 2 === 1 ? 1 : -1)) / n)
/** Vox "flute" (filtered): triangle, odd harmonics at 1/n². */
const TRI = new Wavetable((n) => (n % 2 === 1 ? ((8 / (Math.PI * Math.PI)) * (((n - 1) / 2) % 2 === 0 ? 1 : -1)) / (n * n) : 0))
/** Farf divide-down generator: square, odd harmonics at 1/n. */
const SQUARE = new Wavetable((n) => (n % 2 === 1 ? 4 / Math.PI / n : 0))
/** Pipe 1: flute rank — a hollow, breathy spectrum (harmonics 1..5 at 1, 0.5, 0.3, 0.18, 0.08). */
const PIPE1_HARMONICS = [1, 0.5, 0.3, 0.18, 0.08]
const PIPE1 = new Wavetable((n) => (n <= PIPE1_HARMONICS.length ? PIPE1_HARMONICS[n - 1] / 2.06 : 0))
/** Pipe 2: principal rank — harmonics 1..10 at 1/n^0.95 (a much brighter, non-imitative principal chorus). */
const PIPE2 = new Wavetable((n) => (n <= 10 ? Math.pow(n, -0.95) / 3.07 : 0))
/** Continuous wind noise of a speaking pipe, relative to the registration. */
const PIPE_BREATH_LEVEL = 0.003

/* ---------- constants ---------- */

const MAX_VOICES = 16
const SLOTS = 9
/** Tonewheel generator limits (manual p. 19: authentic tuning of the tonewheels): partials fold back into this range. */
const TONEWHEEL_LOW = 32.7
const TONEWHEEL_HIGH = 5924
/** Amplitude of one rank at drawbar 8 (a single 8′ drawbar gives about 0.18 peak). */
const RANK_AMP = 0.18
const VOX_SLOT_RATIOS = [0.5, 1, 2, 3, 4, 5, 6, 8] as const
const FARF_SLOT_RATIOS = [0.5, 1, 2, 3] as const
const FARF_SLOT_OF_REGISTER = FARF_REGISTER_RATIOS.map((ratio) => FARF_SLOT_RATIOS.indexOf(ratio as 0.5 | 1 | 2 | 3))
const MODEL_B3 = 0
const MODEL_VOX = 1
const MODEL_FARF = 2
const MODEL_PIPE1 = 3
const MODEL_PIPE2 = 4
const MODEL_B3_BASS = 5
const isB3 = (m: number) => m === MODEL_B3 || m === MODEL_B3_BASS
const isPipe = (m: number) => m === MODEL_PIPE1 || m === MODEL_PIPE2
const isTransistor = (m: number) => m === MODEL_VOX || m === MODEL_FARF

/** Vibrato / chorus depth tables indexed by level 0..2 (V1/C1, V2/C2, V3/C3; manual p. 19: depth grows across 1–3). */
const SCANNER_DEPTH_MS = [0.35, 0.7, 1.1]
const SCANNER_HZ = 7
const TRANSISTOR_CHORUS_DEPTH_MS = [0.25, 0.5, 0.8]
const VOX_VIBRATO_CENTS = [5, 9, 15]
const FARF_VIBRATO_CENTS = [4, 8, 13]
const TRANSISTOR_VIBRATO_HZ = [6, 6.5]
const PIPE_DETUNE_CENTS = [4, 8, 14]
const PIPE_TREMULANT_DEPTH = [0.12, 0.22, 0.32]
const PIPE_TREMULANT_HZ = 5
const PIPE_STATIC_DETUNE_CENTS = [0.6, -0.8, 0.4, -0.5, 0.9, -0.3, 0.7, -0.6, 0.5]

/** Percussion: normal / soft level and the decay time constants (fast ≈ 0.2 s, slow ≈ 0.9 s to −40 dB; manual p. 20). */
const PERC_LEVEL = 0.8
const PERC_SOFT_LEVEL = 0.4
const RNG_SEED = 0x5eed
const PERC_FAST_SECONDS = 0.2
const PERC_SLOW_SECONDS = 0.9

interface Voice {
  active: boolean
  midi: number
  /** Model the voice was started with (ORGAN_MODELS index). */
  model: number
  gain: number
  /** 8′ frequency of the note (octave shift applied). */
  hz: number
  keyDown: boolean
  sustained: boolean
  releasing: boolean
  env: number
  releaseK: number
  attackK: number
  age: number
  /** Per rank slot: phase 0..1, base frequency (foldback / detune applied) and the selected wavetables. */
  phases: Float64Array
  rankHz: Float64Array
  tables: Float32Array[]
  tables2: Float32Array[]
  percEnv: number
  clickLeft: number
  clickTotal: number
  clickLevel: number
  clickLp: number
  clickLpK: number
  /** Per-voice seeded noise source (clicks, chiff, wind), reseeded per note so layers stay independent. */
  rng: Rng
}

interface Register {
  a: Biquad
  b: Biquad | null
  gain: number
}

interface LayerRt {
  id: OrganLayerId
  voices: Voice[]
  level: Smoother
  rankGain: Smoother[]
  /** Smoothed rank gains for this sample. */
  g: Float64Array
  comp: number
  bendRatio: number
  scanner: DelayLine
  scanLfo: Lfo
  vibLfo: Lfo
  tremLfo: Lfo
  driftLfo: Lfo
  registers: Register[]
  bus: Float64Array
  on: boolean
  /** Notes started on this layer since reset (seeds the per-voice noise). */
  noteCount: number
}

export class OrganUnit implements StereoProcessor {
  private params: OrganParams = defaultOrganParams()
  private readonly layers: LayerRt[]
  private sustain = false
  private started = false
  private age = 0
  private readonly percK = { fast: 0, slow: 0 }

  constructor(readonly sampleRate: number) {
    const sr = sampleRate
    this.percK.fast = Math.exp(-1 / ((PERC_FAST_SECONDS / 4.6) * sr))
    this.percK.slow = Math.exp(-1 / ((PERC_SLOW_SECONDS / 4.6) * sr))
    this.layers = (['A', 'B'] as OrganLayerId[]).map((id) => this.makeLayer(id))
    this.applyParams(this.params, null)
  }

  private makeLayer(id: OrganLayerId): LayerRt {
    const sr = this.sampleRate
    const voices: Voice[] = []
    for (let i = 0; i < MAX_VOICES; i++) {
      voices.push({ active: false, midi: 0, model: 0, gain: 1, hz: 0, keyDown: false, sustained: false, releasing: false, env: 0, releaseK: 0, attackK: 0, age: 0, phases: new Float64Array(SLOTS), rankHz: new Float64Array(SLOTS), tables: Array.from({ length: SLOTS }, () => SINE.levels[0]), tables2: Array.from({ length: SLOTS }, () => SINE.levels[0]), percEnv: 0, clickLeft: 0, clickTotal: 1, clickLevel: 0, clickLp: 0, clickLpK: 0.35, rng: new Rng(RNG_SEED) })
    }
    const rankGain: Smoother[] = []
    for (let i = 0; i < SLOTS; i++) rankGain.push(new Smoother(sr, 5, 0))
    const biq = (setup: (b: Biquad) => void) => {
      const b = new Biquad()
      setup(b)
      return b
    }
    // Farf voicing filters (manual p. 21: register names describe the tonal character, Flute = soft, Oboe = reedy, Trumpet = brassy).
    const registers: Register[] = [
      { a: biq((b) => b.lowpass(sr, 350)), b: null, gain: 1.4 },
      { a: biq((b) => b.highpass(sr, 120)), b: biq((b) => b.peaking(sr, 2500, 1, 6)), gain: 0.9 },
      { a: biq((b) => b.lowpass(sr, 900)), b: null, gain: 1.2 },
      { a: biq((b) => b.bandpass(sr, 1300, 2.2)), b: null, gain: 2.2 },
      { a: biq((b) => b.highpass(sr, 400)), b: biq((b) => b.peaking(sr, 3000, 1.2, 8)), gain: 0.8 },
      { a: biq((b) => b.highpass(sr, 200)), b: biq((b) => b.peaking(sr, 2500, 1, 6)), gain: 0.9 },
      { a: biq((b) => b.lowpass(sr, 1800)), b: null, gain: 1.1 },
      { a: biq((b) => b.highpass(sr, 400)), b: biq((b) => b.peaking(sr, 3500, 1, 6)), gain: 0.85 },
      { a: biq((b) => b.highpass(sr, 900)), b: biq((b) => b.peaking(sr, 4000, 1, 4)), gain: 0.8 },
    ]
    return {
      id,
      voices,
      level: new Smoother(sr, 10, 0),
      rankGain,
      g: new Float64Array(SLOTS),
      comp: 1,
      bendRatio: 1,
      scanner: new DelayLine(msToSamples(6, sr)),
      scanLfo: new Lfo(sr, SCANNER_HZ),
      vibLfo: new Lfo(sr, TRANSISTOR_VIBRATO_HZ[0]),
      tremLfo: new Lfo(sr, PIPE_TREMULANT_HZ),
      driftLfo: new Lfo(sr, 0.15, id === 'A' ? 0 : 0.37),
      registers,
      bus: new Float64Array(SLOTS),
      on: false,
      noteCount: 0,
    }
  }

  /* ---------- status ---------- */

  get current(): OrganParams {
    return this.params
  }

  /** Voices sounding right now (including releasing ones), both layers. */
  get voiceCount(): number {
    let n = 0
    for (const L of this.layers) for (const v of L.voices) if (v.active) n++
    return n
  }

  /** Loudest percussion envelope currently running (0..1). */
  get percussionLevel(): number {
    let m = 0
    for (const L of this.layers) for (const v of L.voices) if (v.active && v.percEnv > m) m = v.percEnv
    return m
  }

  /** Keys held (down or sustained) on a layer. */
  heldNotes(layer: OrganLayerId): number[] {
    const L = this.layers[layer === 'A' ? 0 : 1]
    const out: number[] = []
    for (const v of L.voices) if (v.active && (v.keyDown || v.sustained)) out.push(v.midi)
    return out.sort((a, b) => a - b)
  }

  /* ---------- parameters ---------- */

  setParams(p: OrganParams) {
    const prev = this.params
    this.params = p
    this.applyParams(p, prev)
  }

  private layerParams(p: OrganParams, id: OrganLayerId): OrganLayerParams {
    return id === 'A' ? p.layers.A : p.layers.B
  }

  private applyParams(p: OrganParams, prev: OrganParams | null) {
    for (const L of this.layers) {
      const lp = this.layerParams(p, L.id)
      const wasOn = prev ? prev.on && this.layerParams(prev, L.id).on : false
      const on = !!(p.on && lp.on)
      L.on = on
      L.level.set(faderToGain(clamp(lp.level, 0, 100)))
      L.bendRatio = lp.pstick ? Math.pow(2, (clamp(p.pitchBend, -1, 1) * 2) / 12) : 1
      const model = clamp(Math.round(lp.model), 0, 5)
      const d = (i: number) => clamp(Math.round(lp.drawbars[i] ?? 0), 0, 8)
      let sum = 0
      const targets = Array.from({ length: SLOTS }, () => 0)
      if (isB3(model) || isPipe(model)) {
        const active = activeDrawbars(model)
        for (let i = 0; i < SLOTS; i++) targets[i] = active[i] ? drawbarGain(d(i)) : 0
      } else if (model === MODEL_VOX) {
        for (let r = 0; r < 7; r++) {
          const ratios = VOX_DRAWBAR_RATIOS[r]
          const g = drawbarGain(d(r)) / Math.sqrt(ratios.length)
          for (const ratio of ratios) targets[VOX_SLOT_RATIOS.indexOf(ratio as 0.5 | 1 | 2 | 3 | 4 | 5 | 6 | 8)] += g
        }
      } else {
        for (let r = 0; r < SLOTS; r++) targets[r] = farfRegisterOn(d(r)) ? 1 : 0
      }
      for (let i = 0; i < SLOTS; i++) {
        sum += targets[i]
        L.rankGain[i].set(targets[i])
      }
      // Energy robbing / loading of the generator: many drawbars add less than linearly (manual p. 19).
      L.comp = 1 / Math.sqrt(0.6 + 0.4 * sum)
      if (!this.started) {
        L.level.snap(L.level.target)
        for (const s of L.rankGain) s.snap(s.target)
      }
      if (wasOn && !on) this.releaseLayer(L, 4)
      if (prev && this.layerParams(prev, L.id).sustped && !lp.sustped) for (const v of L.voices) if (v.active && v.sustained && !v.keyDown) this.release(v, 3)
    }
  }

  /* ---------- events ---------- */

  handle(e: OrganEvent) {
    switch (e.type) {
      case 'on':
        this.noteOn(e.layer, e.midi, e.gain)
        return
      case 'off':
        this.noteOff(e.layer, e.midi)
        return
      case 'sustain':
        this.setSustain(!!e.on)
        return
      case 'allOff':
        this.sustain = false
        for (const L of this.layers) this.releaseLayer(L, 3)
        return
      default:
        return
    }
  }

  private noteOn(layerId: OrganLayerId, midi: number, gain: number) {
    const L = this.layers[layerId === 'A' ? 0 : 1]
    if (!L.on) return
    const lp = this.layerParams(this.params, layerId)
    const model = clamp(Math.round(lp.model), 0, 5)
    let sounding = 0
    for (const v of L.voices) {
      if (!v.active) continue
      if (v.midi === midi && (v.keyDown || v.sustained)) this.release(v, 1.5)
      else if (v.keyDown || v.sustained) sounding++
    }
    const v = this.allocate(L)
    const sr = this.sampleRate
    v.active = true
    v.midi = midi
    v.model = model
    v.gain = clamp(gain, 0, 1)
    v.hz = midiHz(midi + clamp(Math.round(lp.octave), -1, 1) * 12)
    v.keyDown = true
    v.sustained = false
    v.releasing = false
    v.env = 0
    v.age = ++this.age
    L.noteCount++
    v.rng = new Rng((RNG_SEED + (layerId === 'A' ? 0 : 7919) + L.noteCount * 104729) >>> 0)
    const attackMs = isPipe(model) ? 8 : 1.5
    const releaseMs = isPipe(model) ? 12 : 3
    v.attackK = 1 - Math.exp(-1000 / (attackMs * sr))
    v.releaseK = 1 - Math.exp(-1000 / (releaseMs * sr))
    v.percEnv = 0
    v.clickLeft = 0
    v.clickLevel = 0
    v.clickLp = 0
    const level = ((this.params.vibratoMode % 6) / 2) | 0
    if (isB3(model)) {
      for (let i = 0; i < SLOTS; i++) {
        let f = v.hz * DRAWBAR_RATIOS[i]
        while (f > TONEWHEEL_HIGH) f /= 2
        while (f < TONEWHEEL_LOW) f *= 2
        v.rankHz[i] = f
        v.phases[i] = 0
        v.tables[i] = SINE.levels[0]
      }
      const p = this.params.percussion
      if (model === MODEL_B3 && p.on && (p.poly || sounding === 0)) v.percEnv = 1
      if (this.params.keyClick > 0) {
        v.clickTotal = Math.max(1, Math.round(0.004 * sr))
        v.clickLeft = v.clickTotal
        v.clickLevel = 0.12 * clamp(this.params.keyClick, 0, 1)
        v.clickLpK = 0.35
      }
    } else if (model === MODEL_VOX) {
      for (let i = 0; i < SLOTS; i++) {
        const f = i < VOX_SLOT_RATIOS.length ? v.hz * VOX_SLOT_RATIOS[i] : 0
        v.rankHz[i] = f
        v.phases[i] = 0
        v.tables[i] = TRI.select(f * 1.06, sr)
        v.tables2[i] = SAW.select(f * 1.06, sr)
      }
    } else if (model === MODEL_FARF) {
      for (let i = 0; i < SLOTS; i++) {
        const f = i < FARF_SLOT_RATIOS.length ? v.hz * FARF_SLOT_RATIOS[i] : 0
        v.rankHz[i] = f
        v.phases[i] = 0
        v.tables[i] = SQUARE.select(f * 1.06, sr)
      }
    } else {
      const table = model === MODEL_PIPE2 ? PIPE2 : PIPE1
      for (let i = 0; i < SLOTS; i++) {
        // Chorus / vibrato switches the pipes to a less precisely tuned model (manual p. 21).
        const cents = lp.vibrato ? (v.rng.next() * 2 - 1) * PIPE_DETUNE_CENTS[level] : PIPE_STATIC_DETUNE_CENTS[i]
        const f = v.hz * DRAWBAR_RATIOS[i] * Math.pow(2, cents / 1200)
        v.rankHz[i] = f
        v.phases[i] = 0
        v.tables[i] = table.select(f * 1.04, sr)
      }
      // Breath / chiff transient of a speaking pipe.
      v.clickTotal = Math.max(1, Math.round(0.035 * sr))
      v.clickLeft = v.clickTotal
      v.clickLevel = 0.05
      v.clickLpK = 0.12
    }
  }

  private allocate(L: LayerRt): Voice {
    let best: Voice | null = null
    for (const v of L.voices) if (!v.active) return v
    for (const v of L.voices) if (v.releasing && (!best || v.env < best.env)) best = v
    if (!best) for (const v of L.voices) if (!best || v.age < best.age) best = v
    return best!
  }

  private noteOff(layerId: OrganLayerId, midi: number) {
    const L = this.layers[layerId === 'A' ? 0 : 1]
    const lp = this.layerParams(this.params, layerId)
    for (const v of L.voices) {
      if (!v.active || v.midi !== midi || !v.keyDown) continue
      v.keyDown = false
      if (this.sustain && lp.sustped) v.sustained = true
      else this.release(v)
    }
  }

  private setSustain(on: boolean) {
    if (this.sustain === on) return
    this.sustain = on
    if (on) return
    for (const L of this.layers) for (const v of L.voices) if (v.active && v.sustained && !v.keyDown) this.release(v)
  }

  private release(v: Voice, ms?: number) {
    if (v.releasing) return
    v.keyDown = false
    v.sustained = false
    v.releasing = true
    if (ms !== undefined) v.releaseK = 1 - Math.exp(-1000 / (ms * this.sampleRate))
    // B3 key-off click (a softer contact bounce than the attack).
    if (isB3(v.model) && this.params.keyClick > 0) {
      v.clickTotal = Math.max(1, Math.round(0.003 * this.sampleRate))
      v.clickLeft = v.clickTotal
      v.clickLevel = 0.06 * clamp(this.params.keyClick, 0, 1)
    }
  }

  private releaseLayer(L: LayerRt, ms: number) {
    for (const v of L.voices) if (v.active) this.release(v, ms)
  }

  /* ---------- rendering ---------- */

  process(l: Float32Array, r: Float32Array, n: number) {
    this.started = true
    const p = this.params
    const sr = this.sampleRate
    const vibLevel = ((clamp(Math.round(p.vibratoMode), 0, 5) % 6) / 2) | 0
    const chorusMode = clamp(Math.round(p.vibratoMode), 0, 5) % 2 === 1
    const percK = p.percussion.fast ? this.percK.fast : this.percK.slow
    const percAmp = p.percussion.soft ? PERC_SOFT_LEVEL : PERC_LEVEL
    const percSlot = p.percussion.third ? 4 : 3
    const voxMix = clamp((p.layers.A.drawbars[8] ?? 0) / 8, 0, 1)
    const voxMixB = clamp((p.layers.B.drawbars[8] ?? 0) / 8, 0, 1)
    for (let i = 0; i < n; i++) {
      let out = 0
      for (let li = 0; li < 2; li++) {
        const L = this.layers[li]
        const lp = li === 0 ? p.layers.A : p.layers.B
        const model = clamp(Math.round(lp.model), 0, 5)
        const g = L.g
        let anyRank = false
        for (let s = 0; s < SLOTS; s++) {
          g[s] = L.rankGain[s].next()
          if (g[s] > 1e-5) anyRank = true
        }
        // Layer-wide modulators.
        let vibRatio = 1
        let drift = 1
        if (lp.vibrato && isTransistor(model) && !chorusMode) {
          L.vibLfo.setRate(TRANSISTOR_VIBRATO_HZ[model === MODEL_VOX ? 0 : 1])
          L.vibLfo.advance()
          const cents = (model === MODEL_VOX ? VOX_VIBRATO_CENTS : FARF_VIBRATO_CENTS)[vibLevel]
          vibRatio = Math.pow(2, (cents * L.vibLfo.sin()) / 1200)
        }
        if (isPipe(model)) {
          L.driftLfo.advance()
          if (lp.vibrato) drift = 1 + 0.0006 * (vibLevel + 1) * L.driftLfo.sin()
        }
        const inc = (L.bendRatio * vibRatio * drift) / sr
        const mix = li === 0 ? voxMix : voxMixB
        const bus = L.bus
        if (model === MODEL_FARF) bus.fill(0)
        let sum = 0
        for (let vi = 0; vi < MAX_VOICES; vi++) {
          const v = L.voices[vi]
          if (!v.active) continue
          // Amplitude envelope (one-pole attack / release, click-free).
          if (v.releasing) {
            v.env -= v.env * v.releaseK
            if (v.env < 1e-4) {
              v.active = false
              v.env = 0
              continue
            }
          } else v.env += (1 - v.env) * v.attackK
          const amp = v.env * v.gain
          let x = 0
          if (isB3(model)) {
            if (v.percEnv > 0) {
              v.percEnv *= percK
              if (v.percEnv < 1e-4) v.percEnv = 0
            }
            for (let s = 0; s < SLOTS; s++) {
              let gs = g[s]
              if (s === percSlot && v.percEnv > 0) gs += percAmp * v.percEnv
              if (gs <= 1e-5) {
                v.phases[s] += v.rankHz[s] * inc
                continue
              }
              const ph = v.phases[s]
              x += gs * readTable(SINE.levels[0], ph)
              v.phases[s] = ph + v.rankHz[s] * inc
            }
            x *= RANK_AMP
          } else if (model === MODEL_VOX) {
            for (let s = 0; s < VOX_SLOT_RATIOS.length; s++) {
              const gs = g[s]
              const ph = v.phases[s]
              v.phases[s] = ph + v.rankHz[s] * inc
              if (gs <= 1e-5) continue
              x += gs * (readTable(v.tables[s], ph) * (1 - mix) + readTable(v.tables2[s], ph) * mix)
            }
            x *= RANK_AMP
          } else if (model === MODEL_FARF) {
            if (anyRank) {
              for (let s = 0; s < FARF_SLOT_RATIOS.length; s++) {
                const ph = v.phases[s]
                v.phases[s] = ph + v.rankHz[s] * inc
                let used = false
                for (let reg = 0; reg < SLOTS; reg++) if (FARF_SLOT_OF_REGISTER[reg] === s && g[reg] > 1e-5) used = true
                if (!used) continue
                const osc = readTable(v.tables[s], ph) * amp * RANK_AMP
                for (let reg = 0; reg < SLOTS; reg++) if (FARF_SLOT_OF_REGISTER[reg] === s && g[reg] > 1e-5) bus[reg] += osc
              }
            }
          } else {
            let sumG = 0
            for (let s = 0; s < SLOTS; s++) {
              const gs = g[s]
              const ph = v.phases[s]
              v.phases[s] = ph + v.rankHz[s] * inc
              if (gs <= 1e-5) continue
              sumG += gs
              x += gs * readTable(v.tables[s], ph)
            }
            // Wind noise of the speaking pipes, scaled with the registration.
            if (sumG > 0) x += (v.rng.next() * 2 - 1) * PIPE_BREATH_LEVEL * Math.sqrt(sumG)
            x *= RANK_AMP
          }
          // Key click (B3) / breath chiff (Pipe): a short, seeded noise transient.
          if (v.clickLeft > 0) {
            const e = v.clickLeft / v.clickTotal
            v.clickLp += (v.rng.next() * 2 - 1 - v.clickLp) * v.clickLpK
            x += v.clickLp * v.clickLevel * e * e * v.gain
            v.clickLeft--
          }
          if (model !== MODEL_FARF) sum += x * amp
        }
        if (model === MODEL_FARF) {
          for (let reg = 0; reg < SLOTS; reg++) {
            const gr = g[reg]
            const R = L.registers[reg]
            if (gr <= 1e-5) {
              // keep the filter memories quiet while the register is off
              continue
            }
            let y = R.a.process(bus[reg])
            if (R.b) y = R.b.process(y)
            sum += y * R.gain * gr
          }
        }
        // Layer-level vibrato / chorus.
        if (lp.vibrato) {
          if (isB3(model) || (isTransistor(model) && chorusMode)) {
            const depth = isB3(model) ? SCANNER_DEPTH_MS[vibLevel] : TRANSISTOR_CHORUS_DEPTH_MS[vibLevel]
            L.scanLfo.setRate(isB3(model) ? SCANNER_HZ : model === MODEL_VOX ? 6 : 6.5)
            L.scanLfo.advance()
            const d = msToSamples(0.5 + depth * (0.5 + 0.5 * L.scanLfo.sin()), sr)
            const delayed = L.scanner.read(d)
            L.scanner.write(sum)
            sum = chorusMode ? 0.5 * (sum + delayed) : delayed
          } else if (isPipe(model) && !chorusMode) {
            L.tremLfo.advance()
            sum *= 1 - PIPE_TREMULANT_DEPTH[vibLevel] * 0.5 * (1 - L.tremLfo.sin())
          } else if (isTransistor(model)) {
            L.scanner.write(sum)
          }
        } else {
          L.scanner.write(sum)
        }
        out += sum * L.level.next() * L.comp
      }
      l[i] = out
      r[i] = out
    }
  }

  reset() {
    this.sustain = false
    for (const L of this.layers) {
      for (const v of L.voices) {
        v.active = false
        v.keyDown = false
        v.sustained = false
        v.releasing = false
        v.env = 0
        v.percEnv = 0
        v.clickLeft = 0
      }
      L.level.snap(L.level.target)
      for (const s of L.rankGain) s.snap(s.target)
      L.scanner.reset()
      L.scanLfo.reset()
      L.vibLfo.reset()
      L.tremLfo.reset()
      L.driftLfo.reset(L.id === 'A' ? 0 : 0.37)
      for (const R of L.registers) {
        R.a.reset()
        R.b?.reset()
      }
      L.bus.fill(0)
      L.noteCount = 0
    }
  }
}
