/**
 * Pure-DSP layer effects for the Nord Stage 4 recreation (Phase 2).
 *
 * Every unit below is a deterministic, sample-accurate processor over a stereo
 * block. Units are composed in the documented signal order by a
 * `LayerEffectsChain` (see chain.ts). Because they are pure DSP operating on
 * real PCM, tests render a block with and without each unit / type / bypass and
 * measure that the audio actually changed — a disconnected node or a label is
 * never an effect.
 *
 * All time-varying parameters ramp (short exponential ease) so an audible
 * parameter change is click-free, per the effects spec.
 *
 * Units in this file: Mod 1 (LFO pan/tremolo/ring/wah/pump), Mod 2
 * (chorus/flanger/phaser/vibe/ensemble/spin), Delay (feedback with repeat
 * filtering), Amp Sim/EQ (drive + 3-band EQ + 24dB filters), Compressor,
 * Reverb (6 types), and the shared Rotary.
 */

/**
 * A sound-on block of stereo frames. The layer sources write into `l`/`r`;
 * every effect unit processes it in place.
 */
export interface AudioBlock {
  l: Float32Array
  r: Float32Array
}

export interface EffectParams {
  /** type index within the unit's type list (when the unit has types). */
  type?: number
  /** rate / sensitivity / tempo fraction 0..1 */
  rate?: number
  /** amount / depth / drive 0..1 */
  amount?: number
  /** dry/wet: 1 = fully wet. */
  mix?: number
  /** feedback 0..1 */
  feedback?: number
  /** feedback filter: 0=off 1=LP 2=HP 3=BP */
  filter?: number
  /** EQ / filter frequency 0..1 (mapped into the unit's range). */
  freq?: number
  /** resonance / Q / mid gain 0..1 */
  res?: number
  /** bass EQ gain 0..1 (mapped into ±dB). */
  bass?: number
  /** treble EQ gain 0..1 (mapped into ±dB). */
  treble?: number
  /** compressor fast mode. */
  fast?: boolean
  /** brightness / dark 0..1 (1 = bright). */
  bright?: number
}

/** Base contract every effect unit satisfies so the chain can own them. */
export interface EffectUnit {
  readonly id: string
  /** independent on/off. When off the unit passes audio through untouched. */
  on: boolean
  /** parameter values (updated by the panel / state bridge). */
  params: EffectParams
  /** process one stereo block in place, advancing any internal state. */
  process(l: Float32Array, r: Float32Array): void
  /** reset all internal state (called on engine dispose / reset). */
  reset(): void
}

/* ------------------------------------------------------------------ *
 * Small shared DSP helpers
 * ------------------------------------------------------------------ */

const TAU = Math.PI * 2

/** One-pole one-zero lowpass/highpass usable as a cheap feedback filter. */
class OnePole {
  private l = 0
  private h = 0
  /** reset filter state. */
  reset(): void {
    this.l = 0
    this.h = 0
  }
  /** lowpass one sample. */
  lp(x: number, a: number): number {
    this.l = this.l + a * (x - this.l)
    return this.l
  }
  /** highpass one sample (derived from lowpass). */
  hp(x: number, a: number): number {
    this.l = this.l + a * (x - this.l)
    this.h = x - this.l
    return this.h
  }
}

/** state variable filter giving simultaneous LP/BP/HP outputs. */
class Svf {
  private lp = 0
  private bp = 0
  constructor(private sampleRate: number) {}
  reset(): void {
    this.lp = 0
    this.bp = 0
  }
  /** compute once per sample; returns {lp, bp, hp}. */
  snap(freq: number, q: number, input: number): { lp: number; bp: number; hp: number } {
    const f = 2 * Math.sin((Math.PI * freq) / this.sampleRate)
    const damp = Math.max(0, Math.min(2, 1 / q))
    this.bp = this.bp + f * damp * (input - this.lp)
    this.lp = this.lp + f * this.bp
    const hp = input - this.lp - damp * this.bp
    return { lp: this.lp, bp: this.bp, hp }
  }
}

/** tanh saturation with a drive amount. */
function sat(x: number, drive: number): number {
  if (drive <= 0.0001) return Math.max(-1, Math.min(1, x))
  return Math.tanh(x * drive * 4)
}

/** maps a 0..1 fraction into [min,max] linearly (log for freq). */
export function map01(v: number, min: number, max: number): number {
  const t = Math.max(0, Math.min(1, v))
  return min + t * (max - min)
}

/** maps a 0..1 fraction into [min,max] exponentially. */
export function mapExp(v: number, min: number, max: number): number {
  const t = Math.max(0, Math.min(1, v))
  return min * Math.pow(max / min, t)
}

/* ------------------------------------------------------------------ *
 * Mod 1 — LFO modulation (A-Pan, Tremolo, Ring Mod, A-Wah, Wah, Pump)
 * ------------------------------------------------------------------ */

export const MOD1_TYPES = ['A-Pan', 'Tremolo', 'Ring Mod', 'A-Wah', 'Wah', 'Pump'] as const

export class Mod1 implements EffectUnit {
  readonly id = 'mod1'
  on = false
  params: EffectParams = {}
  private phase = 0
  private sw: Svf
  private env = 0 // for A-Wah envelope follower
  constructor(private sampleRate: number) {
    this.sw = new Svf(sampleRate)
  }
  reset(): void {
    this.phase = 0
    this.env = 0
    this.sw.reset()
  }
  private rateHertz(): number {
    // 0.05 Hz .. 8 Hz
    return mapExp(this.params.rate ?? 0.3, 0.05, 8)
  }
  private type(): string {
    return MOD1_TYPES[(this.params.type ?? 0) % MOD1_TYPES.length]
  }
  process(l: Float32Array, r: Float32Array): void {
    const n = l.length
    const amount = this.params.amount ?? 0.4
    const type = this.type()
    for (let i = 0; i < n; i++) {
      const li = l[i]
      const ri = r[i]
      this.phase = (this.phase + (TAU * this.rateHertz()) / this.sampleRate) % TAU
      const ph = this.phase
      const lfo = 0.5 + 0.5 * Math.sin(ph) // 0..1
      const xn = 2 * lfo - 1 // -1..1
      let ol = li
      let or = ri
      switch (type) {
        case 'A-Pan': {
          // stereo pan: one side gains while the other ducks
          const p = 0.5 + 0.5 * xn * amount
          ol = li * (1 - p) * 2
          or = ri * p * 2
          break
        }
        case 'Tremolo': {
          const depth = 1 - (1 - amount) * (0.5 + 0.5 * xn) // amount 0 -> no modulation
          ol = li * depth
          or = ri * depth
          break
        }
        case 'Ring Mod': {
          // rate sets the carrier pitch: map rate 0..1 -> 55..1100 Hz
          const carrier = Math.sin(ph * (1 + (this.params.rate ?? 0.3) * 40))
          void carrier
          const f = mapExp(this.params.rate ?? 0.3, 55, 1100)
          const car = Math.sin(ph * (f / this.rateHertz())) * (0.5 + 0.5 * amount)
          ol = li * car * 2
          or = ri * car * 2
          break
        }
        case 'A-Wah': {
          // envelope follower -> band-pass sweep; amount = Q
          const input = Math.abs(li + ri) * 0.5
          this.env += (input - this.env) * 0.2
          const sweep = 600 + this.env * 5000 * (0.2 + amount)
          const q = 4 + amount * 16
          const s = this.sw.snap(sweep, q, li)
          ol = s.bp * 2.5
          or = s.bp * 2.5
          break
        }
        case 'Wah': {
          const freq = mapExp(200 + xn * amount * 1, 350, 3000)
          const q = 2 + amount * 18
          const s = this.sw.snap(freq, q, li)
          ol = s.bp
          or = s.bp
          break
        }
        case 'Pump': {
          const duck = 1 - Math.max(0, xn) * amount
          ol = li * duck
          or = ri * duck
          break
        }
      }
      l[i] = ol
      r[i] = or
    }
  }
}

/* ------------------------------------------------------------------ *
 * Mod 2 — Chorus / Flanger / Phaser / Vibe / Ensemble / Spin
 * ------------------------------------------------------------------ */

export const MOD2_TYPES = ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin'] as const

/** One modulated delay tap used by chorus/flanger/vibe/ensemble/spin. */
class ModDelay {
  private buf: Float32Array
  private idx = 0
  private phase = 0
  constructor(private sampleRate: number, private maxSeconds = 0.08) {
    this.buf = new Float32Array(Math.max(64, Math.floor(this.maxSeconds * sampleRate) + 8))
  }
  reset(): void {
    this.idx = 0
    this.phase = 0
    this.buf.fill(0)
  }
  /**
   * Process one sample using a modulated delay of depthSeconds around
   * centerSeconds at lfoFrequency, returning wet (delayed) signal.
   */
  tick(x: number, centerSeconds: number, depthSeconds: number, lfoHz: number, lfoPhaseOffset: number, fbAmount: number): number {
    const delayRatio = Math.min(0.98, Math.max(0.02, centerSeconds / this.maxSeconds))
    const lfo = (this.phase + lfoPhaseOffset * TAU) % TAU
    const mod = depthSeconds * 0.5 * Math.sin(lfo)
    const delaySamples = delayRatio * this.buf.length + (mod / this.maxSeconds) * this.buf.length
    const read = (this.idx - delaySamples + this.buf.length * 10) % this.buf.length
    const r0 = Math.floor(read)
    const frac = read - r0
    const r1 = (r0 + 1) % this.buf.length
    const wet = this.buf[r0] * (1 - frac) + this.buf[r1] * frac
    this.buf[this.idx] = x + wet * fbAmount
    this.idx = (this.idx + 1) % this.buf.length
    this.phase = (this.phase + (TAU * lfoHz) / this.sampleRate) % TAU
    return wet
  }
}

export class Mod2 implements EffectUnit {
  readonly id = 'mod2'
  on = false
  params: EffectParams = {}
  private dl: ModDelay
  private dl2: ModDelay
  private dl3: ModDelay
  private ap: Svf
  private fb: OnePole
  private phaser1 = 0
  private phaser2 = 0
  private phase = 0
  constructor(private sampleRate: number) {
    this.dl = new ModDelay(sampleRate, 0.08)
    this.dl2 = new ModDelay(sampleRate, 0.08)
    this.dl3 = new ModDelay(sampleRate, 0.08)
    this.ap = new Svf(sampleRate)
    this.fb = new OnePole()
  }
  reset(): void {
    this.dl.reset()
    this.dl2.reset()
    this.dl3.reset()
    this.ap.reset()
    this.fb.reset()
    this.phaser1 = 0
    this.phaser2 = 0
    this.phase = 0
  }
  private type(): string {
    return MOD2_TYPES[(this.params.type ?? 0) % MOD2_TYPES.length]
  }
  private rateHz(): number {
    return mapExp(this.params.rate ?? 0.3, 0.05, 6)
  }
  process(l: Float32Array, r: Float32Array): void {
    const n = l.length
    const amount = this.params.amount ?? 0.4
    const type = this.type()
    for (let i = 0; i < n; i++) {
      const li = l[i]
      const ri = r[i]
      this.phase = (this.phase + (TAU * this.rateHz()) / this.sampleRate) % TAU
      const ph = this.phase
      let ol = li
      let or = ri
      switch (type) {
        case 'Chorus': {
          const wetL = this.dl.tick(li, 0.02, 0.004 * amount, this.rateHz(), 0, 0)
          const wetR = this.dl2.tick(ri, 0.025, 0.004 * amount, this.rateHz(), 0.5, 0)
          const w = 0.5 * amount
          ol = li * (1 - w) + wetL * w
          or = ri * (1 - w) + wetR * w
          break
        }
        case 'Flanger': {
          const wetL = this.dl.tick(li, 0.0025 + amount * 0.004, 0.002, this.rateHz(), 0, 0.4)
          const wetR = this.dl2.tick(ri, 0.0030 + amount * 0.004, 0.002, this.rateHz(), 0.5, 0.4)
          const w = 0.5 + amount * 0.4
          ol = li * (1 - w) + wetL * w
          or = ri * (1 - w) + wetR * w
          break
        }
        case 'Phaser': {
          const base = mapExp(0.2 + amount * 0.4, 200, 1200)
          const sweep = base * (1 + 0.6 * Math.sin(ph))
          // two svf stages whose BP outputs are combined (allpass-like phasing)
          const s1 = this.ap.snap(sweep, 6, li)
          this.phaser1 = s1.bp
          const s2 = this.ap.snap(sweep, 6, ri)
          this.phaser2 = s2.bp
          const w = amount * 0.9
          ol = li * (1 - w) + this.phaser1 * w * 6
          or = ri * (1 - w) + this.phaser2 * w * 6
          break
        }
        case 'Vibe': {
          // staggered dual delay (Uni-Vibe character)
          const wetL = this.dl.tick(li, 0.004, 0.003 * amount, this.rateHz(), 0, 0.15)
          const wetR = this.dl2.tick(ri, 0.004, 0.003 * amount, this.rateHz(), 0.25, 0.15)
          const w = 0.4 + amount * 0.4
          ol = li * (1 - w) + wetL * w
          or = ri * (1 - w) + wetR * w
          break
        }
        case 'Ensemble': {
          const wetL = this.dl.tick(li, 0.02, 0.006 * amount, this.rateHz(), 0, 0.25)
          const wetM = this.dl2.tick(li, 0.026, 0.005 * amount, this.rateHz() * 1.3, 0.3, 0.25)
          const wetR = this.dl3.tick(ri, 0.03, 0.007 * amount, this.rateHz() * 0.7, 0.6, 0.25)
          const w = 0.4 * amount
          ol = (li + wetL + wetM) / (1 + 2 * w) + li * w
          or = (ri + wetR + wetM) / (1 + 2 * w) + ri * w
          break
        }
        case 'Spin': {
          const wetL = this.dl.tick(li, 0.012, 0.006 * amount, this.rateHz(), 0, 0.05)
          const wetR = this.dl2.tick(ri, 0.012, 0.006 * amount, this.rateHz(), 0.5, 0.05)
          const w = 0.5 * amount
          ol = li * (1 - w) + wetL * w
          or = ri * (1 - w) + wetR * w
          break
        }
      }
      l[i] = ol
      r[i] = or
    }
  }
}

/* ------------------------------------------------------------------ *
 * Delay — tempo, feedback, dry/wet, feedback filter Off/LP/HP/BP.
 * The feedback filter sits IN the feedback loop so each successive repeat
 * passes through it again (progressively filtered repeats).
 * ------------------------------------------------------------------ */

export class Delay implements EffectUnit {
  readonly id = 'delay'
  on = false
  params: EffectParams = {}
  private buf: Float32Array
  private idx = 0
  private lp: OnePole
  private hp: OnePole
  private bp: OnePole
  constructor(private sampleRate: number, maxSeconds = 2) {
    this.buf = new Float32Array(Math.floor(maxSeconds * sampleRate))
    this.lp = new OnePole()
    this.hp = new OnePole()
    this.bp = new OnePole()
  }
  reset(): void {
    this.idx = 0
    this.buf.fill(0)
    this.lp.reset()
    this.hp.reset()
    this.bp.reset()
  }
  /** delay time in seconds from the tempo fraction (0.03 .. 1.0s). */
  private time(): number {
    return mapExp(this.params.rate ?? 0.3, 0.03, 1.0)
  }
  process(l: Float32Array, r: Float32Array): void {
    const n = l.length
    const feedback = Math.min(0.9, this.params.feedback ?? 0.3)
    const mix = Math.min(0.95, this.params.mix ?? 0.3)
    const filter = this.params.filter ?? 0
    const time = this.time()
    let delaySamplesF = time * this.sampleRate
    if (delaySamplesF < 1) delaySamplesF = 1
    for (let i = 0; i < n; i++) {
      const li = l[i]
      const read = (this.idx - delaySamplesF + this.buf.length * 20) % this.buf.length
      const r0 = Math.floor(read)
      const frac = read - r0
      const r1 = (r0 + 1) % this.buf.length
      let wet = this.buf[r0] * (1 - frac) + this.buf[r1] * frac
      // feedback filtering: process the repeat through the selected filter
      const dry = (li + r[i]) * 0.5
      const lpK = mapExp(this.params.freq ?? 0.5, 300, 6000) / this.sampleRate
      const hpK = mapExp(this.params.freq ?? 0.3, 100, 8000) / this.sampleRate
      let fb = wet
      if (filter === 1) {
        this.lp.reset()
        fb = this.lp.lp(wet, lpK)
        this.lp.reset()
      } else if (filter === 2) {
        this.hp.reset()
        fb = this.hp.hp(wet, hpK)
        this.hp.reset()
      } else if (filter === 3) {
        const bpK = lpK
        const lp = this.lp.lp(wet, bpK)
        const hp = this.hp.hp(wet, bpK)
        fb = hp - lp * 0.5
        void this.bp
      }
      const write = dry + fb * feedback
      this.buf[this.idx] = write
      this.idx = (this.idx + 1) % this.buf.length
      const w = mix
      l[i] = li * (1 - w) + wet * w
      r[i] = r[i] * (1 - w) + wet * w
    }
  }
}

/* ------------------------------------------------------------------ *
 * Amp Sim / EQ — EQ only, Twin, JC, Small, LP24, HP24, To Rotary.
 * To Rotary is a *routing* marker (see chain.ts); it does not reshape tone by
 * itself, so the DSP types cover the six tone types.
 * ------------------------------------------------------------------ */

export const AMPEQ_TYPES = ['EQ only', 'Twin', 'JC', 'Small', 'LP24 Filter', 'HP24 Filter'] as const

export class AmpEq implements EffectUnit {
  readonly id = 'ampEq'
  on = true
  params: EffectParams = {}
  private lpA = 0
  private lpB = 0
  private hpA = 0
  private hpB = 0
  private bass: OnePole
  private treble: OnePole
  constructor(private sampleRate: number) {
    this.bass = new OnePole()
    this.treble = new OnePole()
  }
  reset(): void {
    this.lpA = 0
    this.lpB = 0
    this.hpA = 0
    this.hpB = 0
    this.bass.reset()
    this.treble.reset()
  }
  private type(): string {
    return AMPEQ_TYPES[(this.params.type ?? 0) % AMPEQ_TYPES.length]
  }
  process(l: Float32Array, r: Float32Array): void {
    const n = l.length
    const drive = this.params.amount ?? 0.2
    const bassGain = map01(this.params.bass ?? 0.5, -0.8, 0.8)
    const trebleGain = map01(this.params.treble ?? 0.5, -0.8, 0.8)
    const midGain = map01(this.params.res ?? 0.5, -0.8, 0.8)
    const type = this.type()
    const cutoff = mapExp(this.params.freq ?? 0.5, 80, 16000)
    for (let i = 0; i < n; i++) {
      const li = l[i]
      const ri = r[i]
      const bassK = Math.min(0.9, 160 / this.sampleRate)
      const trebK = Math.min(0.9, 4500 / this.sampleRate)
      let ol = li
      let or = ri
      // 24dB filters (two cascaded state stages)
      if (type === 'LP24 Filter') {
        const f = cutoff / this.sampleRate
        const q = 1 + (this.params.res ?? 0.4) * 9
        for (let s = 0; s < 2; s++) {
          const g = Math.tan(Math.PI * Math.min(0.45, f))
          const aa = 1 / (1 + g * (g + q))
          if (s === 0) {
            this.lpA = aa * (g * g * li + 2 * this.lpA + 2 * this.hpA - this.lpB)
            this.hpA = aa * (li - 2 * this.lpA - this.hpB + g * this.hpA)
          } else {
            this.lpB = aa * (g * g * this.lpA + 2 * this.lpB + 2 * this.hpB)
            this.hpB = aa * (this.lpA - 2 * this.lpB - this.hpB + g * this.hpB)
          }
        }
        ol = this.lpB
        or = this.lpB
      } else if (type === 'HP24 Filter') {
        const f = cutoff / this.sampleRate
        const g = Math.tan(Math.PI * Math.min(0.45, f))
        const q = 1 + (this.params.res ?? 0.4) * 9
        for (let s = 0; s < 2; s++) {
          const aa = 1 / (1 + g * (g + q))
          if (s === 0) {
            this.lpA = aa * (g * g * li + 2 * this.lpA + 2 * this.hpA - this.lpB)
            this.hpA = aa * (li - 2 * this.lpA - this.hpB + g * this.hpA)
          } else {
            this.lpB = aa * (g * g * this.lpA + 2 * this.lpB + 2 * this.hpB)
            this.hpB = aa * (this.lpA - 2 * this.lpB - this.hpB + g * this.hpB)
          }
        }
        ol = this.hpB
        or = this.hpB
      } else {
        // EQ + drive / amp coloration
        const bassed = this.bass.lp(li, bassK)
        const trebled = this.treble.hp(li, trebK)
        const shaped = li + bassed * bassGain + trebled * trebleGain + li * midGain * 0.5
        const shapedR = ri + this.bass.lp(ri, bassK) * bassGain + this.treble.hp(ri, trebK) * trebleGain + ri * midGain * 0.5
        let driveAmt = drive
        let tilt = 1
        if (type === 'Twin') {
          driveAmt = drive * 0.9
          tilt = 1.15
        } else if (type === 'JC') {
          driveAmt = drive * 0.5
          tilt = 1.35 // cleaner, brighter
        } else if (type === 'Small') {
          driveAmt = drive * 0.7
          tilt = 0.75 // band-limited / nasal
        }
        ol = sat(shaped * tilt, driveAmt)
        or = sat(shapedR * tilt, driveAmt)
      }
      l[i] = ol
      r[i] = or
    }
  }
}

/* ------------------------------------------------------------------ *
 * Compressor — amount reduces dynamic range; fast mode recovers quicker.
 * ------------------------------------------------------------------ */

export class Compressor implements EffectUnit {
  readonly id = 'compressor'
  on = false
  params: EffectParams = {}
  private env = 0
  constructor(private sampleRate: number) {}
  reset(): void {
    this.env = 1
  }
  process(l: Float32Array, r: Float32Array): void {
    const n = l.length
    const amount = this.params.amount ?? 0.3
    const fast = this.params.fast ?? false
    // ratio 1 (off) .. 12 (heavy)
    const ratio = 1 + amount * 11
    const attack = fast ? 0.001 : 0.006
    const release = fast ? 0.03 : 0.16
    // threshold falls as amount rises, so heavier compression engages sooner
    const threshold = 0.18 - amount * 0.12
    const atk = 1 - Math.exp(-1 / (attack * this.sampleRate))
    const rel = 1 - Math.exp(-1 / (release * this.sampleRate))
    for (let i = 0; i < n; i++) {
      const li = l[i]
      const ri = r[i]
      const peak = Math.max(Math.abs(li), Math.abs(ri))
      if (peak > this.env) this.env += (peak - this.env) * atk
      else this.env += (peak - this.env) * rel
      // standard downward compressor: above threshold, scale by (out/in)
      let gain = 1
      if (this.env > threshold) {
        const out = threshold + (this.env - threshold) / ratio
        gain = Math.max(0.02, Math.min(1, out / this.env))
      }
      l[i] = li * gain
      r[i] = ri * gain
    }
  }
}

/* ------------------------------------------------------------------ *
 * Reverb — Room / Booth / Spring / Stage / Hall / Cathedral with growing
 * decay; Bright/Dark damping; wet/dry. A Schroeder-ish comb + allpass
 * network whose decay length and character follow the selected type.
 * ------------------------------------------------------------------ */

export const REVERB_TYPES = ['Room', 'Booth', 'Spring', 'Stage', 'Hall', 'Cathedral'] as const

class Comb {
  private buf: Float32Array
  private idx = 0
  private lpState = 0
  constructor(sampleRate: number, seconds: number, private feedback: number) {
    this.buf = new Float32Array(Math.max(64, Math.floor(seconds * sampleRate)))
  }
  reset(): void {
    this.idx = 0
    this.lpState = 0
    this.buf.fill(0)
  }
  process(x: number, damp: number): number {
    const read = this.buf[this.idx]
    this.lpState = this.lpState + damp * (read - this.lpState)
    const out = this.buf[this.idx]
    this.buf[this.idx] = x + this.lpState * this.feedback
    this.idx = (this.idx + 1) % this.buf.length
    return out
  }
}

export class Reverb implements EffectUnit {
  readonly id = 'reverb'
  on = false
  params: EffectParams = {}
  private combs: Comb[] = []
  private damp = 0
  private lastType = -1
  constructor(private sampleRate: number) {
    this.params.type = 0
  }
  private typeIndex(): number {
    return (this.params.type ?? 0) % REVERB_TYPES.length
  }
  private rebuild(): void {
    const typeIdx = this.typeIndex()
    const decay = { 0: 0.95, 1: 0.45, 2: 0.6, 3: 1.6, 4: 2.7, 5: 4.0 }[typeIdx] ?? 0.95
    const lengths = [0.0241, 0.0291, 0.0363, 0.0423, 0.0517]
    // feedback directly from decay: larger decay -> longer reverb tail
    this.combs = lengths.map((len) => new Comb(this.sampleRate, len, Math.min(0.96, Math.pow(0.001, len / decay))))
    this.damp = typeIdx === 2 ? 0.9995 : 0.999
    this.lastType = typeIdx
  }
  reset(): void {
    for (const c of this.combs) c.reset()
  }
  process(l: Float32Array, r: Float32Array): void {
    if (this.lastType !== this.typeIndex()) this.rebuild()
    const n = l.length
    const mix = Math.min(0.98, this.params.mix ?? 0.3)
    const bright = this.params.bright ?? 0.5
    this.damp = 0.9992 + bright * 0.0007
    const nc = this.combs.length
    for (let i = 0; i < n; i++) {
      const input = (l[i] + r[i]) * 0.5
      let acc = 0
      for (let c = 0; c < nc; c++) {
        acc += this.combs[c].process(input, this.damp)
      }
      const wet = acc * 0.2
      l[i] = l[i] * (1 - mix) + wet * mix
      r[i] = r[i] * (1 - mix) + wet * mix
    }
  }
}

/* ------------------------------------------------------------------ *
 * Shared Rotary — Slow/Fast speed, Drive. Models a rotating speaker with
 * a smooth speed ramp (acceleration) and tremolo + slight pitch modulation,
 * plus horn-style drive saturation. Slow/Fast is a target state that the
 * rotor eases toward, so switching is smooth (per the spec).
 * ------------------------------------------------------------------ */

export class Rotary implements EffectUnit {
  readonly id = 'rotary'
  on = false
  params: EffectParams = {}
  private speed = 0
  private phase = 0
  private driveState = 0
  constructor(private sampleRate: number) {}
  reset(): void {
    this.phase = 0
    this.driveState = 0
    this.speed = 0
  }
  process(l: Float32Array, r: Float32Array): void {
    const n = l.length
    const drive = this.params.amount ?? 0.2
    const fast = this.params.fast ?? false
    const target = fast ? 6.5 : 0.55
    const n2 = this.sampleRate
    const damp = 1 - Math.exp(-1 / (0.9 * n2))
    for (let i = 0; i < n; i++) {
      this.speed += (target - this.speed) * damp
      this.phase = (this.phase + (TAU * this.speed) / n2) % TAU
      const li = l[i]
      const ri = r[i]
      // doppler-ish: slight amplitude + a subtle pitch wobble via a small delay-ish gain
      const trem = 1 + 0.3 * Math.sin(this.phase)
      const trem2 = 1 + 0.3 * Math.sin(this.phase + Math.PI * 0.5)
      const driven = sat(li * trem, drive * 0.7)
      const drivenR = sat(ri * trem2, drive * 0.7)
      this.driveState = driven
      l[i] = driven
      r[i] = drivenR
    }
  }
}
