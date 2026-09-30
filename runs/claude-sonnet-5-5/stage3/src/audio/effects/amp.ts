import type { AmpState } from '../../engine/state'
import { clamp, eqDb, midFreqHz } from '../params'
import type { AudioContextLike, GainNodeLike } from '../types'
import { driveCurve, ramp, Rig, type FxNode } from './rig'

type AmpModel = 'Small' | 'JC' | 'Twin'
const AMP_MODELS: readonly AmpModel[] = ['Small', 'JC', 'Twin']

/**
 * Amp Sim / EQ / Filter unit.
 *
 *   amp models (Small, JC, Twin):   drive stage (pre-EQ voicing → shaper → speaker roll-off) ─┐
 *   EQ only / To Rotary:            straight ─────────────────────────────────────────────────┼─► bass · mid · treble ─► out
 *   LP24 / HP24:                    resonant 24 dB filter (two cascaded biquads), EQ bypassed ─────────────────────────► out
 *
 * The three amp models are documented approximations: each has its own voicing filters and clipping curve.
 * "To Rotary" is an EQ-only tone stage whose `routesToRotary` flag is read by the layer to feed the shared rotary.
 */
export class AmpEqUnit implements FxNode {
  readonly input: GainNodeLike
  readonly output: GainNodeLike
  private readonly rig: Rig
  private readonly straight: GainNodeLike
  private readonly ampPaths: Record<AmpModel, { gain: GainNodeLike; pre: GainNodeLike; post: GainNodeLike }>
  private readonly filterLp: GainNodeLike
  private readonly filterHp: GainNodeLike
  private readonly lp: [ReturnType<Rig['biquad']>, ReturnType<Rig['biquad']>]
  private readonly hp: [ReturnType<Rig['biquad']>, ReturnType<Rig['biquad']>]
  private readonly eqIn: GainNodeLike
  private readonly bass: ReturnType<Rig['biquad']>
  private readonly mid: ReturnType<Rig['biquad']>
  private readonly treble: ReturnType<Rig['biquad']>
  private readonly bypass: GainNodeLike

  constructor(private readonly ctx: AudioContextLike) {
    const rig = (this.rig = new Rig(ctx))
    this.input = rig.gain(1)
    this.output = rig.gain(1)
    this.bypass = rig.gain(1)
    this.input.connect(this.bypass)
    this.bypass.connect(this.output)

    // --- tone stack: everything processed enters `eqIn`
    this.eqIn = rig.gain(1)
    this.bass = rig.biquad('lowshelf', 100, 0.7, 0)
    this.mid = rig.biquad('peaking', 1000, 0.9, 0)
    this.treble = rig.biquad('highshelf', 4000, 0.7, 0)
    rig.chain(this.eqIn, this.bass, this.mid, this.treble, this.output)

    // straight into the tone stack (EQ only / To Rotary)
    this.straight = rig.gain(0)
    this.input.connect(this.straight)
    this.straight.connect(this.eqIn)

    const makePath = (model: AmpModel) => {
      const gain = rig.gain(0)
      const pre = rig.gain(1)
      const post = rig.gain(1)
      const voicing =
        model === 'Small'
          ? [rig.biquad('highpass', 260, 0.8), rig.biquad('peaking', 1800, 1.0, 5)]
          : model === 'JC'
            ? [rig.biquad('highpass', 70, 0.7), rig.biquad('peaking', 700, 0.8, -3)]
            : [rig.biquad('lowshelf', 200, 0.7, -2), rig.biquad('peaking', 3400, 1.0, 4)]
      const shaper = rig.shaper(driveCurve(model === 'Small' ? 3 : model === 'JC' ? 2.2 : 1.6, model === 'Small' ? 0.35 : 0), '4x')
      const speaker = rig.biquad('lowpass', model === 'Small' ? 4500 : model === 'JC' ? 7500 : 9500, 0.7)
      rig.chain(gain, pre, ...voicing, shaper, speaker, post)
      post.connect(this.eqIn)
      this.input.connect(gain)
      return { gain, pre, post }
    }
    this.ampPaths = { Small: makePath('Small'), JC: makePath('JC'), Twin: makePath('Twin') }

    // --- resonant 24 dB filters
    this.filterLp = rig.gain(0)
    this.filterHp = rig.gain(0)
    this.lp = [rig.biquad('lowpass', 2000, 0.7), rig.biquad('lowpass', 2000, 0.7)]
    this.hp = [rig.biquad('highpass', 500, 0.7), rig.biquad('highpass', 500, 0.7)]
    rig.chain(this.filterLp, this.lp[0], this.lp[1], this.output)
    rig.chain(this.filterHp, this.hp[0], this.hp[1], this.output)
    this.input.connect(this.filterLp)
    this.input.connect(this.filterHp)
  }

  static routesToRotary(cfg: AmpState, active: boolean): boolean {
    return active && cfg.type === 'To Rotary'
  }

  apply(cfg: AmpState, active: boolean): void {
    const ctx = this.ctx
    if (!active) {
      ramp(ctx, this.bypass.gain, 1)
      ramp(ctx, this.straight.gain, 0)
      for (const m of AMP_MODELS) ramp(ctx, this.ampPaths[m].gain.gain, 0)
      ramp(ctx, this.filterLp.gain, 0)
      ramp(ctx, this.filterHp.gain, 0)
      return
    }
    ramp(ctx, this.bypass.gain, 0)
    const isAmp = (AMP_MODELS as readonly string[]).includes(cfg.type)
    const isLp = cfg.type === 'LP24 Filter'
    const isHp = cfg.type === 'HP24 Filter'
    const toneStack = !isLp && !isHp
    ramp(ctx, this.straight.gain, toneStack && !isAmp ? 1 : 0)
    for (const m of AMP_MODELS) ramp(ctx, this.ampPaths[m].gain.gain, cfg.type === m ? 1 : 0)
    ramp(ctx, this.filterLp.gain, isLp ? 1 : 0)
    ramp(ctx, this.filterHp.gain, isHp ? 1 : 0)

    if (isAmp) {
      const drive = clamp(cfg.drive, 0, 1)
      const p = this.ampPaths[cfg.type as AmpModel]
      ramp(ctx, p.pre.gain, 0.6 + drive * 7)
      ramp(ctx, p.post.gain, 1 / (0.85 + drive * 1.6))
    }
    const freq = midFreqHz(cfg.freq)
    if (toneStack) {
      ramp(ctx, this.bass.gain, eqDb(cfg.bass))
      ramp(ctx, this.mid.gain, eqDb(cfg.mid))
      ramp(ctx, this.mid.frequency, freq)
      ramp(ctx, this.treble.gain, eqDb(cfg.treble))
    } else {
      // filter modes: Freq is the cutoff, Gain/Res is the resonance (0.7 … ~14)
      const q = 0.7 + clamp(cfg.mid, 0, 1) * 13
      for (const f of isLp ? this.lp : this.hp) {
        ramp(ctx, f.frequency, freq)
        ramp(ctx, f.Q, isLp ? q : q * 0.8)
      }
    }
  }

  dispose(): void {
    this.rig.dispose()
  }
}
