// Mod 1 (A-Pan, Tremolo, Ring Mod, A-Wah, Wah, Pump) and Mod 2 (Chorus, Flanger, Phaser, Vibe,
// Ensemble, Spin), manual pp. 49-50. Every type is a real sub-graph; the type selector crossfades
// between gated branches so switching is click-free.
import type { AudioContextLike, BiquadLike, DelayLike, GainLike, OscillatorLike, StereoPannerLike } from '../webAudioTypes'
import { expRange, FxUnit, glideTo, makeCurve, rampTo, TypeBranches, unit } from './common'

export const MOD1_TYPES = ['ring', 'trem', 'pan', 'awah', 'wah', 'pump'] as const
export type Mod1Type = (typeof MOD1_TYPES)[number]
export const MOD2_TYPES = ['chorus', 'flanger', 'phaser', 'vibe', 'ensemble', 'spin'] as const
export type Mod2Type = (typeof MOD2_TYPES)[number]

export interface ModState<T> {
  on: boolean
  type: T
  rate: number
  amount: number
}

/** LFO rate for the Rate knob (Hz). */
export const lfoRate = (rate: number) => expRange(rate, 0.08, 12)

export class Mod1Unit extends FxUnit<ModState<Mod1Type>> {
  private readonly branches: TypeBranches<Mod1Type>
  private readonly ringOsc
  private readonly tremLfo
  private readonly tremGain: GainLike
  private readonly panLfo
  private readonly wahLfo
  private readonly wahFilter: BiquadLike
  private readonly awahFilter: BiquadLike
  private readonly awahSens: GainLike
  private readonly pumpLfo
  private readonly pumpGain: GainLike

  constructor(ctx: AudioContextLike) {
    super(ctx)
    const b = this.bag
    this.branches = new TypeBranches<Mod1Type>(b, this.input, this.wet)

    // Ring Mod: signal × sine carrier; Rate sets the carrier pitch.
    const ring = this.branches.add('ring')
    const ringVca = b.gain(0)
    this.ringOsc = b.lfo('sine', 200, 1)
    this.ringOsc.depth.connect(ringVca.gain)
    ring.in.connect(ringVca)
    ringVca.connect(ring.out)

    // Tremolo: LFO volume modulation around 1 - depth/2 (full level at zero amount).
    const trem = this.branches.add('trem')
    this.tremGain = b.gain(1)
    this.tremLfo = b.lfo('sine', 4, 0)
    this.tremLfo.depth.connect(this.tremGain.gain)
    trem.in.connect(this.tremGain)
    this.tremGain.connect(trem.out)

    // A-Pan: LFO drives an equal-power stereo panner.
    const pan = this.branches.add('pan')
    const panner: StereoPannerLike = b.add(ctx.createStereoPanner())
    this.panLfo = b.lfo('sine', 1, 0)
    this.panLfo.depth.connect(panner.pan)
    pan.in.connect(panner)
    panner.connect(pan.out)

    // A-Wah: envelope follower (rectifier + smoothing) sweeps a band-pass; Rate acts as Sens.
    const awah = this.branches.add('awah')
    this.awahFilter = b.add(ctx.createBiquadFilter())
    this.awahFilter.type = 'bandpass'
    this.awahFilter.frequency.value = 350
    this.awahFilter.Q.value = 3.5
    const rect = b.add(ctx.createWaveShaper())
    rect.curve = makeCurve((x) => Math.abs(x), 257)
    const smooth1 = b.add(ctx.createBiquadFilter())
    smooth1.type = 'lowpass'
    smooth1.frequency.value = 18
    smooth1.Q.value = -3
    const smooth2 = b.add(ctx.createBiquadFilter())
    smooth2.type = 'lowpass'
    smooth2.frequency.value = 18
    smooth2.Q.value = -3
    this.awahSens = b.gain(0)
    awah.in.connect(rect)
    rect.connect(smooth1)
    smooth1.connect(smooth2)
    smooth2.connect(this.awahSens)
    this.awahSens.connect(this.awahFilter.frequency)
    awah.in.connect(this.awahFilter)
    const awahMakeup = b.gain(2.2)
    this.awahFilter.connect(awahMakeup)
    awahMakeup.connect(awah.out)

    // Wah: LFO-driven resonant low-pass sweep.
    const wah = this.branches.add('wah')
    this.wahFilter = b.add(ctx.createBiquadFilter())
    this.wahFilter.type = 'lowpass'
    this.wahFilter.frequency.value = 1000
    this.wahFilter.Q.value = 12
    this.wahLfo = b.lfo('sine', 1, 750)
    this.wahLfo.depth.connect(this.wahFilter.frequency)
    wah.in.connect(this.wahFilter)
    this.wahFilter.connect(wah.out)

    // Pump: rising sawtooth shaped into a quick duck + slow recovery (side-chain style).
    const pump = this.branches.add('pump')
    this.pumpGain = b.gain(1)
    this.pumpLfo = b.lfo('sawtooth', 2, 0)
    const shaper = b.add(ctx.createWaveShaper())
    shaper.curve = makeCurve((x) => 1 - Math.exp(-3.2 * (x + 1)), 512)
    this.pumpLfo.osc.disconnect()
    this.pumpLfo.osc.connect(shaper)
    shaper.connect(this.pumpLfo.depth)
    this.pumpLfo.depth.connect(this.pumpGain.gain)
    pump.in.connect(this.pumpGain)
    this.pumpGain.connect(pump.out)
  }

  /** `syncedHz`: Master Clock-synced LFO rate for the LFO types (MST CLK). */
  apply(s: ModState<Mod1Type>, active: boolean, now: number, syncedHz?: number): void {
    const a = unit(s.amount)
    const rate = syncedHz ?? lfoRate(s.rate)
    glideTo(this.ringOsc.osc.frequency, expRange(s.rate, 30, 2400), now)
    glideTo(this.tremLfo.osc.frequency, rate, now)
    glideTo(this.panLfo.osc.frequency, rate, now)
    glideTo(this.wahLfo.osc.frequency, rate, now)
    glideTo(this.pumpLfo.osc.frequency, rate, now)
    rampTo(this.tremLfo.depth.gain, a / 2, now)
    rampTo(this.tremGain.gain, 1 - a / 2, now)
    rampTo(this.panLfo.depth.gain, a, now)
    rampTo(this.awahSens.gain, 400 + 9000 * unit(s.rate), now)
    rampTo(this.pumpLfo.depth.gain, a, now)
    rampTo(this.pumpGain.gain, 1 - a, now)
    // Mix: Ring Mod / Wahs use Amount as dry/wet; Trem / Pan / Pump are fully wet with Amount as depth.
    const mixType = s.type === 'ring' || s.type === 'awah' || s.type === 'wah'
    this.branches.select(s.type, 1, now)
    if (!active) this.mix(1, 0, now)
    else if (mixType) this.mix(1 - a, a, now)
    else this.mix(0, 1, now)
  }
}

export class Mod2Unit extends FxUnit<ModState<Mod2Type>> {
  private readonly branches: TypeBranches<Mod2Type>
  private readonly lfos: { osc: OscillatorLike; depth: GainLike; scale: number; rateMul: number; kind: Mod2Type }[] = []
  private readonly chorusSecond: GainLike
  private readonly flangerFb: GainLike
  private readonly phaserFb: GainLike
  private readonly spinAm: GainLike
  private readonly spinLfo

  constructor(ctx: AudioContextLike) {
    super(ctx)
    const b = this.bag
    this.branches = new TypeBranches<Mod2Type>(b, this.input, this.wet)
    const delay = (base: number): DelayLike => {
      const d = b.add(ctx.createDelay(0.1))
      d.delayTime.value = base
      return d
    }
    const panner = (p: number): StereoPannerLike => {
      const n = b.add(ctx.createStereoPanner())
      n.pan.value = p
      return n
    }
    const modLfo = (kind: Mod2Type, rateMul: number, scale: number, type = 'sine') => {
      const l = b.lfo(type, 1, 0)
      this.lfos.push({ osc: l.osc, depth: l.depth, scale, rateMul, kind })
      return l
    }

    // Chorus: two modulated delay lines panned apart; amounts above 50 % fade in the second line.
    const chorus = this.branches.add('chorus')
    const cd1 = delay(0.012)
    const cd2 = delay(0.019)
    const cl = modLfo('chorus', 1, 0.004)
    cl.depth.connect(cd1.delayTime)
    const inv = b.gain(-1)
    cl.depth.connect(inv)
    inv.connect(cd2.delayTime)
    const cp1 = panner(-0.8)
    const cp2 = panner(0.8)
    this.chorusSecond = b.gain(0)
    chorus.in.connect(cd1)
    cd1.connect(cp1)
    cp1.connect(chorus.out)
    chorus.in.connect(this.chorusSecond)
    this.chorusSecond.connect(cd2)
    cd2.connect(cp2)
    cp2.connect(chorus.out)
    const chorusDry = b.gain(0.8)
    chorus.in.connect(chorusDry)
    chorusDry.connect(chorus.out)

    // Flanger: short swept delay with feedback, mixed with the dry signal (comb-filter sweep).
    const flanger = this.branches.add('flanger')
    const fd = delay(0.0055)
    const fl = modLfo('flanger', 1, 0.0025)
    fl.depth.connect(fd.delayTime)
    this.flangerFb = b.gain(0.65)
    flanger.in.connect(fd)
    fd.connect(this.flangerFb)
    this.flangerFb.connect(fd)
    const fDry = b.gain(0.7)
    const fWet = b.gain(0.7)
    flanger.in.connect(fDry)
    fDry.connect(flanger.out)
    fd.connect(fWet)
    fWet.connect(flanger.out)

    // Phaser: four swept all-pass stages summed with dry (notches); Amount adds feedback colour.
    const phaser = this.branches.add('phaser')
    const pl = modLfo('phaser', 1, 650)
    let prev: GainLike | BiquadLike = phaser.in
    const phSum = b.gain(1)
    phaser.in.connect(phSum)
    prev = phSum
    for (let i = 0; i < 4; i++) {
      const ap = b.add(ctx.createBiquadFilter())
      ap.type = 'allpass'
      ap.frequency.value = 800
      ap.Q.value = 0.6
      pl.depth.connect(ap.frequency)
      prev.connect(ap)
      prev = ap
    }
    this.phaserFb = b.gain(0)
    const phDelay = delay(0.003)
    prev.connect(phDelay)
    phDelay.connect(this.phaserFb)
    this.phaserFb.connect(phSum)
    const phWet = b.gain(0.6)
    const phDry = b.gain(0.6)
    prev.connect(phWet)
    phWet.connect(phaser.out)
    phaser.in.connect(phDry)
    phDry.connect(phaser.out)

    // Vibe: staggered all-pass filters (not aligned like the phaser) plus a little pitch wobble.
    const vibe = this.branches.add('vibe')
    const vl = modLfo('vibe', 1, 1)
    let vprev: GainLike | BiquadLike | DelayLike = vibe.in
    for (const f of [160, 480, 1400, 3900]) {
      const ap = b.add(ctx.createBiquadFilter())
      ap.type = 'allpass'
      ap.frequency.value = f
      ap.Q.value = 0.5
      const g = b.gain(f * 0.55)
      vl.depth.connect(g)
      g.connect(ap.frequency)
      vprev.connect(ap)
      vprev = ap
    }
    const vd = delay(0.002)
    const vg = b.gain(0.0009)
    vl.depth.connect(vg)
    vg.connect(vd.delayTime)
    vprev.connect(vd)
    const vWet = b.gain(0.75)
    const vDry = b.gain(0.55)
    vd.connect(vWet)
    vWet.connect(vibe.out)
    vibe.in.connect(vDry)
    vDry.connect(vibe.out)

    // Ensemble: three cross-connected modulated delay lines at different rates, spread L/C/R.
    const ens = this.branches.add('ensemble')
    const lines = [0.008, 0.0115, 0.0145].map((base, i) => {
      const d = delay(base)
      const l = modLfo('ensemble', [1, 1.31, 0.77][i], 0.003)
      l.depth.connect(d.delayTime)
      ens.in.connect(d)
      const p = panner([-0.85, 0, 0.85][i])
      d.connect(p)
      p.connect(ens.out)
      return d
    })
    lines.forEach((d, i) => {
      const cross = b.gain(0.22)
      d.connect(cross)
      cross.connect(lines[(i + 1) % 3])
    })
    const ensDry = b.gain(0.6)
    ens.in.connect(ensDry)
    ensDry.connect(ens.out)

    // Spin: gentle rotary-like doppler + amplitude + pan movement; rate changes ramp slowly.
    const spin = this.branches.add('spin')
    const sd = delay(0.004)
    this.spinLfo = b.lfo('sine', 1, 0.0012)
    this.spinLfo.depth.connect(sd.delayTime)
    this.spinAm = b.gain(0)
    const spinVca = b.gain(0.8)
    this.spinLfo.osc.connect(this.spinAm)
    this.spinAm.connect(spinVca.gain)
    const spinPan = b.add(ctx.createStereoPanner())
    const spinPanDepth = b.gain(0.6)
    this.spinLfo.osc.connect(spinPanDepth)
    spinPanDepth.connect(spinPan.pan)
    spin.in.connect(sd)
    sd.connect(spinVca)
    spinVca.connect(spinPan)
    spinPan.connect(spin.out)
  }

  apply(s: ModState<Mod2Type>, active: boolean, now: number): void {
    const a = unit(s.amount)
    const rate = expRange(s.rate, 0.1, 8)
    for (const l of this.lfos) {
      glideTo(l.osc.frequency, rate * l.rateMul, now)
      const depth = l.kind === 'vibe' ? 0.25 + 0.7 * a : l.scale * (0.15 + 0.85 * a)
      rampTo(l.depth.gain, depth, now)
    }
    // Spin changes speed gradually (manual p. 50).
    glideTo(this.spinLfo.osc.frequency, rate, now, 0.6)
    rampTo(this.spinAm.gain, 0.2 * a, now)
    rampTo(this.chorusSecond.gain, a > 0.5 ? (a - 0.5) * 2 : 0, now)
    rampTo(this.flangerFb.gain, 0.45 + 0.4 * a, now)
    rampTo(this.phaserFb.gain, 0.75 * a, now)
    this.branches.select(s.type, 1, now)
    if (!active) this.mix(1, 0, now)
    else this.mix(0, 1, now)
  }
}
