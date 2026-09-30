import type { Mod1State, Mod2State } from '../../engine/state'
import { clamp, lfoHz } from '../params'
import type { AudioContextLike, AudioNodeLike, GainNodeLike, Scheduler } from '../types'
import { ABS_CURVE, ramp, RAMP_S, Rig, type FxNode } from './rig'

interface Branch {
  input: AudioNodeLike
  output: AudioNodeLike
  update(rate: number, amount: number): void
  dispose(): void
}
type BranchFactory = (ctx: AudioContextLike, rate: number, amount: number) => Branch

interface Mix {
  dry: number
  wet: number
}

const finish = (rig: Rig, input: AudioNodeLike, output: AudioNodeLike, update: Branch['update']): Branch => ({ input, output, update, dispose: () => rig.dispose() })

/** LFO → depth gain → target param */
function lfoTo(rig: Rig, type: string, hz: number, depth: number, target: Parameters<AudioNodeLike['connect']>[0]) {
  const osc = rig.osc(type, hz)
  const d = rig.gain(depth)
  osc.connect(d)
  d.connect(target)
  return { osc, depth: d }
}

// ---------------------------------------------------------------------------------------------------------------
// MOD 1: A-Pan, Tremolo, Ring Mod, A-Wah, Wah, Pump
// ---------------------------------------------------------------------------------------------------------------
const mod1Branches: Record<Mod1State['type'], BranchFactory> = {
  'A-Pan': (ctx, rate, amount) => {
    const rig = new Rig(ctx)
    const pan = rig.panner(0)
    const lfo = lfoTo(rig, 'sine', lfoHz(rate, 0.2, 10), amount * 0.95, pan.pan)
    return finish(rig, pan, pan, (r, a) => {
      ramp(ctx, lfo.osc.frequency, lfoHz(r, 0.2, 10))
      ramp(ctx, lfo.depth.gain, a * 0.95)
    })
  },
  Tremolo: (ctx, rate, amount) => {
    const rig = new Rig(ctx)
    const g = rig.gain(1 - amount / 2)
    const lfo = lfoTo(rig, 'sine', lfoHz(rate, 0.3, 14), amount / 2, g.gain)
    return finish(rig, g, g, (r, a) => {
      ramp(ctx, lfo.osc.frequency, lfoHz(r, 0.3, 14))
      ramp(ctx, g.gain, 1 - a / 2)
      ramp(ctx, lfo.depth.gain, a / 2)
    })
  },
  'Ring Mod': (ctx, rate) => {
    const rig = new Rig(ctx)
    const rm = rig.gain(0)
    const carrier = rig.osc('sine', 40 * Math.pow(50, rate))
    carrier.connect(rm.gain)
    return finish(rig, rm, rm, (r) => ramp(ctx, carrier.frequency, 40 * Math.pow(50, r)))
  },
  'A-Wah': (ctx, rate) => {
    const rig = new Rig(ctx)
    const input = rig.gain(1)
    const bp = rig.biquad('bandpass', 320, 4.5)
    input.connect(bp)
    // envelope follower: |x| → smoothing low-pass → scaled onto the band-pass centre frequency
    const rectify = rig.shaper(ABS_CURVE, 'none')
    const smooth = rig.biquad('lowpass', 22, 0.5)
    const sens = rig.gain(2000 + rate * 14000)
    input.connect(rectify)
    rectify.connect(smooth)
    smooth.connect(sens)
    sens.connect(bp.frequency)
    return finish(rig, input, bp, (r) => ramp(ctx, sens.gain, 2000 + r * 14000))
  },
  Wah: (ctx, rate) => {
    const rig = new Rig(ctx)
    const lp = rig.biquad('lowpass', 750, 8)
    const lfo = lfoTo(rig, 'sine', lfoHz(rate, 0.2, 6), 650, lp.frequency)
    return finish(rig, lp, lp, (r) => ramp(ctx, lfo.osc.frequency, lfoHz(r, 0.2, 6)))
  },
  Pump: (ctx, rate, amount) => {
    const rig = new Rig(ctx)
    const g = rig.gain(1 - amount / 2)
    const lfo = lfoTo(rig, 'sawtooth', lfoHz(rate, 0.4, 8), amount / 2, g.gain)
    return finish(rig, g, g, (r, a) => {
      ramp(ctx, lfo.osc.frequency, lfoHz(r, 0.4, 8))
      ramp(ctx, g.gain, 1 - a / 2)
      ramp(ctx, lfo.depth.gain, a / 2)
    })
  },
}

const mod1Mix = (type: Mod1State['type'], amount: number): Mix => {
  switch (type) {
    case 'A-Pan':
    case 'Tremolo':
    case 'Pump':
      return { dry: 0, wet: 1 }
    case 'Ring Mod':
      return { dry: 1 - amount, wet: amount * 1.5 }
    default:
      return { dry: 1 - amount * 0.8, wet: amount * 1.4 } // A-Wah, Wah
  }
}

// ---------------------------------------------------------------------------------------------------------------
// MOD 2: Chorus, Flanger, Phaser, Vibe, Ensemble, Spin
// ---------------------------------------------------------------------------------------------------------------
const allpassChain = (rig: Rig, freqs: number[], q: number) => freqs.map((f) => rig.biquad('allpass', f, q))

const mod2Branches: Record<Mod2State['type'], BranchFactory> = {
  Chorus: (ctx, rate, amount) => {
    const rig = new Rig(ctx)
    const input = rig.gain(1)
    const out = rig.gain(1)
    const d1 = rig.delay(0.06, 0.02)
    const d2 = rig.delay(0.06, 0.028)
    const g2 = rig.gain(clamp((amount - 0.3) / 0.4, 0, 1))
    input.connect(d1)
    input.connect(d2)
    d1.connect(out)
    d2.connect(g2)
    g2.connect(out)
    const depth = (a: number) => 0.0015 + 0.0045 * a
    const l1 = lfoTo(rig, 'sine', lfoHz(rate, 0.1, 5), depth(amount), d1.delayTime)
    const l2 = lfoTo(rig, 'sine', lfoHz(rate, 0.1, 5) * 1.13, -depth(amount), d2.delayTime)
    return finish(rig, input, out, (r, a) => {
      ramp(ctx, l1.osc.frequency, lfoHz(r, 0.1, 5))
      ramp(ctx, l2.osc.frequency, lfoHz(r, 0.1, 5) * 1.13)
      ramp(ctx, l1.depth.gain, depth(a))
      ramp(ctx, l2.depth.gain, -depth(a))
      ramp(ctx, g2.gain, clamp((a - 0.3) / 0.4, 0, 1))
    })
  },
  Flanger: (ctx, rate, amount) => {
    const rig = new Rig(ctx)
    const d = rig.delay(0.02, 0.0055)
    const fb = rig.gain(0.35 + amount * 0.45)
    d.connect(fb)
    fb.connect(d)
    const lfo = lfoTo(rig, 'sine', lfoHz(rate, 0.08, 4), 0.0022 + 0.0006 * amount, d.delayTime)
    return finish(rig, d, d, (r, a) => {
      ramp(ctx, lfo.osc.frequency, lfoHz(r, 0.08, 4))
      ramp(ctx, fb.gain, 0.35 + a * 0.45)
    })
  },
  Phaser: (ctx, rate, amount) => {
    const rig = new Rig(ctx)
    const stages = allpassChain(rig, [700, 900, 1200, 1600], 0.7 + amount * 3)
    rig.chain(...stages)
    const lfos = stages.map((s, i) => lfoTo(rig, 'sine', lfoHz(rate, 0.1, 5), 350 + i * 180, s.frequency))
    return finish(rig, stages[0], stages[stages.length - 1], (r, a) => {
      for (const l of lfos) ramp(ctx, l.osc.frequency, lfoHz(r, 0.1, 5))
      for (const s of stages) ramp(ctx, s.Q, 0.7 + a * 3)
    })
  },
  Vibe: (ctx, rate, amount) => {
    const rig = new Rig(ctx)
    const d = rig.delay(0.03, 0.006)
    const stages = allpassChain(rig, [280, 620, 1300, 2600], 1.1)
    rig.chain(d, ...stages)
    const vib = lfoTo(rig, 'sine', lfoHz(rate, 0.3, 7), 0.004 * amount, d.delayTime)
    const sweep = stages.map((s, i) => lfoTo(rig, 'sine', lfoHz(rate, 0.3, 7), 120 * (i + 1) * (0.4 + amount), s.frequency))
    return finish(rig, d, stages[stages.length - 1], (r, a) => {
      ramp(ctx, vib.osc.frequency, lfoHz(r, 0.3, 7))
      ramp(ctx, vib.depth.gain, 0.004 * a)
      sweep.forEach((s, i) => {
        ramp(ctx, s.osc.frequency, lfoHz(r, 0.3, 7))
        ramp(ctx, s.depth.gain, 120 * (i + 1) * (0.4 + a))
      })
    })
  },
  Ensemble: (ctx, rate, amount) => {
    const rig = new Rig(ctx)
    const input = rig.gain(1)
    const out = rig.gain(0.55)
    const bases = [0.012, 0.016, 0.02]
    const delays = bases.map((b) => rig.delay(0.06, b))
    const factors = [1, 1.21, 1.47]
    const depth = (a: number) => 0.0012 + 0.0032 * a
    const lfos = delays.map((d, i) => lfoTo(rig, 'sine', lfoHz(rate, 0.15, 3) * factors[i], depth(amount), d.delayTime))
    delays.forEach((d, i) => {
      input.connect(d)
      d.connect(out)
      if (i > 0) {
        // cross-connection: the previous line is also heard through the next one
        const cross = rig.gain(0.25)
        delays[i - 1].connect(cross)
        cross.connect(d)
      }
    })
    return finish(rig, input, out, (r, a) => {
      lfos.forEach((l, i) => {
        ramp(ctx, l.osc.frequency, lfoHz(r, 0.15, 3) * factors[i])
        ramp(ctx, l.depth.gain, depth(a))
      })
    })
  },
  Spin: (ctx, rate, amount) => {
    const rig = new Rig(ctx)
    const d = rig.delay(0.02, 0.003)
    const pan = rig.panner(0)
    const am = rig.gain(1 - amount * 0.3)
    rig.chain(d, pan, am)
    const hz = lfoHz(rate, 0.3, 7)
    const l1 = lfoTo(rig, 'sine', hz, 0.0012 * (0.4 + amount), d.delayTime)
    const l2 = lfoTo(rig, 'sine', hz, 0.55 * amount, pan.pan)
    const l3 = lfoTo(rig, 'sine', hz, 0.3 * amount, am.gain)
    // rate changes ramp gradually, like a rotor spinning up or down
    return finish(rig, d, am, (r, a) => {
      for (const l of [l1, l2, l3]) ramp(ctx, l.osc.frequency, lfoHz(r, 0.3, 7), 1.2)
      ramp(ctx, l1.depth.gain, 0.0012 * (0.4 + a))
      ramp(ctx, l2.depth.gain, 0.55 * a)
      ramp(ctx, l3.depth.gain, 0.3 * a)
      ramp(ctx, am.gain, 1 - a * 0.3)
    })
  },
}

const mod2Mix = (type: Mod2State['type'], amount: number): Mix => {
  switch (type) {
    case 'Chorus':
      return { dry: 1, wet: 0.35 + 0.55 * amount }
    case 'Flanger':
      return { dry: 1, wet: 0.5 + 0.4 * amount }
    case 'Phaser':
      return { dry: 1, wet: 0.7 + 0.25 * amount }
    case 'Ensemble':
      return { dry: 0.6, wet: 0.9 }
    default:
      return { dry: 0, wet: 1 } // Vibe, Spin
  }
}

// ---------------------------------------------------------------------------------------------------------------
type ModConfig = { on: boolean; type: string; rate: number; amount: number }

/**
 * One modulation unit: dry path + a wet branch built for the selected type. Bypass and type switches crossfade, so
 * neither clicks. The branch for a type is only built when the unit is first active.
 */
export class ModUnit implements FxNode {
  readonly input: GainNodeLike
  readonly output: GainNodeLike
  private readonly rig: Rig
  private readonly dry: GainNodeLike
  private readonly wet: GainNodeLike
  private current: { type: string; branch: Branch; fade: GainNodeLike } | null = null
  private timers = new Set<number>()
  /** branches that are fading out and will be disposed when their timer fires */
  private retiring = new Set<NonNullable<ModUnit['current']>>()

  constructor(
    private readonly ctx: AudioContextLike,
    private readonly scheduler: Scheduler,
    private readonly kind: 'mod1' | 'mod2',
  ) {
    const rig = (this.rig = new Rig(ctx))
    this.input = rig.gain(1)
    this.output = rig.gain(1)
    this.dry = rig.gain(1)
    this.wet = rig.gain(0)
    this.input.connect(this.dry)
    this.dry.connect(this.output)
    this.wet.connect(this.output)
  }

  get activeType(): string | null {
    return this.current?.type ?? null
  }

  apply(cfg: ModConfig, active: boolean): void {
    const ctx = this.ctx
    if (!active) {
      ramp(ctx, this.dry.gain, 1)
      ramp(ctx, this.wet.gain, 0)
      return
    }
    if (!this.current || this.current.type !== cfg.type) this.switchType(cfg)
    else this.current.branch.update(cfg.rate, cfg.amount)
    const mix = this.kind === 'mod1' ? mod1Mix(cfg.type as Mod1State['type'], cfg.amount) : mod2Mix(cfg.type as Mod2State['type'], cfg.amount)
    ramp(ctx, this.dry.gain, mix.dry)
    ramp(ctx, this.wet.gain, mix.wet)
  }

  private switchType(cfg: ModConfig) {
    const factories = (this.kind === 'mod1' ? mod1Branches : mod2Branches) as Record<string, BranchFactory>
    const branch = factories[cfg.type](this.ctx, cfg.rate, cfg.amount)
    const fade = this.rig.gain(0)
    this.input.connect(branch.input)
    branch.output.connect(fade)
    fade.connect(this.wet)
    ramp(this.ctx, fade.gain, 1)
    const old = this.current
    this.current = { type: cfg.type, branch, fade }
    if (old) {
      this.retiring.add(old)
      ramp(this.ctx, old.fade.gain, 0)
      const timer = this.scheduler.setTimeout(() => {
        this.timers.delete(timer)
        this.retire(old)
      }, Math.ceil(RAMP_S * 1000) + 40)
      this.timers.add(timer)
    }
  }

  private retire(old: NonNullable<ModUnit['current']>) {
    this.retiring.delete(old)
    try {
      this.input.disconnect()
      this.input.connect(this.dry)
      if (this.current) this.input.connect(this.current.branch.input)
    } catch {
      // graph already torn down
    }
    old.branch.dispose()
    try {
      old.fade.disconnect()
    } catch {
      // already disconnected
    }
  }

  dispose(): void {
    for (const t of this.timers) this.scheduler.clearTimeout(t)
    this.timers.clear()
    for (const old of this.retiring) old.branch.dispose()
    this.retiring.clear()
    this.current?.branch.dispose()
    this.current = null
    this.rig.dispose()
  }
}
