// Amp Sim/EQ (manual p. 52) and Compressor (manual p. 52).
// Amp Sim: EQ only, three amp models (Small, JC, Twin: distinct drive curves and speaker voicing —
// documented approximations), resonant 24 dB LP/HP filters (Freq = cutoff, Mid = resonance), and
// To Rotary (EQ only here; the engine routes the layer into the shared Rotary). The 3-band EQ
// (bass 100 Hz, mid 200 Hz–8 kHz, treble 4 kHz, ±15 dB) follows every type.
import type { AmpState, AmpType, CompState } from '../../model/sound'
import type { AudioContextLike, BiquadLike, CompressorLike, GainLike, WaveShaperLike } from '../webAudioTypes'
import { bipolarDb, expRange, FxUnit, glideTo, makeCurve, rampTo, TypeBranches, unit } from './common'

export const EQ_BASS_HZ = 100
export const EQ_TREBLE_HZ = 4000
export const EQ_RANGE_DB = 15
export const midFreq = (v: number) => expRange(v, 200, 8000)

interface AmpModel {
  curve: (x: number) => number
  /** Speaker/cabinet voicing: [type, freq, q, gain]. */
  cab: [string, number, number, number][]
  makeup: number
}

const AMPS: Record<'small' | 'jc' | 'twin', AmpModel> = {
  // Small combo: asymmetric soft clip into a boxy, band-limited speaker.
  small: {
    curve: (x) => (x >= 0 ? Math.tanh(2.2 * x) : Math.tanh(1.4 * x) * 1.1),
    cab: [['highpass', 180, 0.7, 0], ['peaking', 1100, 1.2, 6], ['lowpass', 2600, 1, 0]],
    makeup: 0.9,
  },
  // JC: clean solid-state with a hard ceiling and a bright, wide-band voicing.
  jc: {
    curve: (x) => Math.max(-0.8, Math.min(0.8, 1.2 * x)),
    cab: [['highpass', 70, 0.7, 0], ['highshelf', 3500, 0.7, 5], ['lowpass', 9000, 0.7, 0]],
    makeup: 1.1,
  },
  // Twin: symmetric tube-like saturation, scooped mids, full bass.
  twin: {
    curve: (x) => Math.tanh(1.6 * x) + 0.12 * Math.tanh(4 * x) * x,
    cab: [['lowshelf', 180, 0.7, 4], ['peaking', 650, 0.9, -6], ['lowpass', 5200, 0.8, 0]],
    makeup: 0.85,
  },
}

type Branch = 'eq' | 'small' | 'jc' | 'twin' | 'lp24' | 'hp24'
const branchOf = (t: AmpType): Branch => (t === 'rotary' ? 'eq' : t)

export class AmpEqUnit extends FxUnit<AmpState> {
  private readonly branches: TypeBranches<Branch>
  private readonly drives: GainLike[] = []
  private readonly filters: BiquadLike[] = []
  readonly bass: BiquadLike
  readonly mid: BiquadLike
  readonly treble: BiquadLike

  constructor(ctx: AudioContextLike) {
    super(ctx)
    const b = this.bag
    const eqIn = b.gain(1)
    this.branches = new TypeBranches<Branch>(b, this.input, eqIn)
    const eqOnly = this.branches.add('eq')
    eqOnly.in.connect(eqOnly.out)

    for (const key of ['small', 'jc', 'twin'] as const) {
      const m = AMPS[key]
      const br = this.branches.add(key)
      const drive = b.gain(1)
      const shaper: WaveShaperLike = b.add(ctx.createWaveShaper())
      shaper.curve = makeCurve(m.curve, 2048)
      const post = b.gain(m.makeup)
      br.in.connect(drive)
      drive.connect(shaper)
      let prev: GainLike | WaveShaperLike | BiquadLike = shaper
      for (const [type, f, q, g] of m.cab) {
        const bq = b.add(ctx.createBiquadFilter())
        bq.type = type
        bq.frequency.value = f
        bq.Q.value = q
        bq.gain.value = g
        prev.connect(bq)
        prev = bq
      }
      prev.connect(post)
      post.connect(br.out)
      this.drives.push(drive)
    }

    for (const key of ['lp24', 'hp24'] as const) {
      const br = this.branches.add(key)
      let prev: GainLike | BiquadLike = br.in
      for (let i = 0; i < 2; i++) {
        const bq = b.add(ctx.createBiquadFilter())
        bq.type = key === 'lp24' ? 'lowpass' : 'highpass'
        bq.frequency.value = 1000
        bq.Q.value = 0.7
        prev.connect(bq)
        prev = bq
        this.filters.push(bq)
      }
      prev.connect(br.out)
    }

    const eq = (type: string, f: number, q = 0.7) => {
      const bq = b.add(ctx.createBiquadFilter())
      bq.type = type
      bq.frequency.value = f
      bq.Q.value = q
      bq.gain.value = 0
      return bq
    }
    this.bass = eq('lowshelf', EQ_BASS_HZ)
    this.mid = eq('peaking', 1000, 0.9)
    this.treble = eq('highshelf', EQ_TREBLE_HZ)
    eqIn.connect(this.bass)
    this.bass.connect(this.mid)
    this.mid.connect(this.treble)
    this.treble.connect(this.wet)
  }

  apply(s: AmpState, active: boolean, now: number): void {
    const filterMode = s.type === 'lp24' || s.type === 'hp24'
    const d = unit(s.drive)
    for (const g of this.drives) rampTo(g.gain, 0.6 + 9 * d * d, now)
    const cutoff = midFreq(s.freq)
    // Gain/Res → resonance per stage (two stages = 24 dB/oct).
    const q = 0.6 + 7 * unit(s.mid)
    for (const f of this.filters) {
      glideTo(f.frequency, cutoff, now)
      rampTo(f.Q, q, now)
    }
    rampTo(this.bass.gain, bipolarDb(s.bass, EQ_RANGE_DB), now)
    rampTo(this.treble.gain, bipolarDb(s.treble, EQ_RANGE_DB), now)
    glideTo(this.mid.frequency, cutoff, now)
    rampTo(this.mid.gain, filterMode ? 0 : bipolarDb(s.mid, EQ_RANGE_DB), now)
    this.branches.select(branchOf(s.type), 1, now)
    if (active) this.mix(0, 1, now)
    else this.mix(1, 0, now)
  }
}

/** Compressor: Amount lowers the threshold and raises the ratio; Fast shortens attack/release. */
export function compSettings(s: CompState): { threshold: number; ratio: number; attack: number; release: number; makeup: number } {
  const a = unit(s.amount)
  return {
    threshold: -6 - 44 * a,
    ratio: 1.5 + 14 * a,
    attack: s.fast ? 0.001 : 0.012,
    release: s.fast ? 0.05 : 0.3,
    makeup: 1,
  }
}

export class CompUnit extends FxUnit<CompState> {
  readonly comp: CompressorLike

  constructor(ctx: AudioContextLike) {
    super(ctx)
    this.comp = this.bag.add(ctx.createDynamicsCompressor())
    this.comp.knee.value = 6
    this.input.connect(this.comp)
    this.comp.connect(this.wet)
  }

  apply(s: CompState, active: boolean, now: number): void {
    const c = compSettings(s)
    rampTo(this.comp.threshold, c.threshold, now)
    rampTo(this.comp.ratio, c.ratio, now)
    this.comp.attack.setValueAtTime(c.attack, now)
    this.comp.release.setValueAtTime(c.release, now)
    if (active) this.mix(0, 1, now)
    else this.mix(1, 0, now)
  }
}
