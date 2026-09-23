// Shared building blocks for the Layer Effects units: click-free parameter ramps, LFOs, and the
// dry/wet crossfade shell every unit uses for bypass.
import type { AudioContextLike, GainLike, NodeLike, OscillatorLike, ParamLike } from '../webAudioTypes'

/** Short ramp used for every audible parameter change (click-free, spec: parameterRampsRequired). */
export const RAMP = 0.02

export function holdParam(param: ParamLike, now: number): void {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(now)
  } else {
    const current = param.value
    param.cancelScheduledValues(now)
    param.setValueAtTime(current, now)
  }
}

/** Linear ramp from the current value (lands exactly on `value`, so 0 is true silence). */
export function rampTo(param: ParamLike, value: number, now: number, time = RAMP): void {
  holdParam(param, now)
  param.linearRampToValueAtTime(value, now + time)
}

/** Exponential approach, for frequencies and rates that should glide. */
export function glideTo(param: ParamLike, value: number, now: number, tau = RAMP / 3): void {
  holdParam(param, now)
  param.setTargetAtTime(value, now, tau)
}

export class NodeBag {
  readonly nodes: NodeLike[] = []
  readonly sources: OscillatorLike[] = []
  constructor(readonly ctx: AudioContextLike) {}

  add<T extends NodeLike>(node: T): T {
    this.nodes.push(node)
    return node
  }

  gain(value = 1): GainLike {
    const g = this.add(this.ctx.createGain())
    g.gain.value = value
    return g
  }

  /** A free-running LFO (started now, stopped on dispose) scaled by a depth gain. */
  lfo(type: string, frequency: number, depth: number): { osc: OscillatorLike; depth: GainLike } {
    const osc = this.add(this.ctx.createOscillator())
    osc.type = type
    osc.frequency.value = frequency
    const d = this.gain(depth)
    osc.connect(d)
    osc.start(this.ctx.currentTime)
    this.sources.push(osc)
    return { osc, depth: d }
  }

  dispose(): void {
    for (const s of this.sources) {
      try {
        s.stop()
      } catch {
        // already stopped
      }
    }
    for (const n of this.nodes) n.disconnect()
    this.nodes.length = 0
    this.sources.length = 0
  }
}

/**
 * The shell every effect unit shares: input → dry → output and input → [processing] → wet →
 * output. Bypass crossfades to dry=1, wet=0 with a short linear ramp (click-free).
 */
export abstract class FxUnit<S> {
  readonly bag: NodeBag
  readonly input: GainLike
  readonly output: GainLike
  protected readonly dry: GainLike
  protected readonly wet: GainLike

  constructor(readonly ctx: AudioContextLike) {
    this.bag = new NodeBag(ctx)
    this.input = this.bag.gain(1)
    this.output = this.bag.gain(1)
    this.dry = this.bag.gain(1)
    this.wet = this.bag.gain(0)
    this.input.connect(this.dry)
    this.dry.connect(this.output)
    this.wet.connect(this.output)
  }

  /** Apply canonical settings. `active` = unit On and Layer Effects On. */
  abstract apply(state: S, active: boolean, now: number): void

  protected mix(dry: number, wet: number, now: number): void {
    rampTo(this.dry.gain, dry, now)
    rampTo(this.wet.gain, wet, now)
  }

  dispose(): void {
    this.bag.dispose()
  }
}

/** Knob 0…127 → 0…1. */
export const unit = (v: number) => Math.min(1, Math.max(0, v / 127))

/** Knob 0…127 → exponential range lo…hi. */
export const expRange = (v: number, lo: number, hi: number) => lo * Math.pow(hi / lo, unit(v))

/** Knob 0…127 centred at 64 → ±range (dB). */
export const bipolarDb = (v: number, range: number) => Math.max(-range, Math.min(range, ((v - 64) / 63) * range))

export function makeCurve(fn: (x: number) => number, size = 1024): Float32Array {
  const c = new Float32Array(size)
  for (let i = 0; i < size; i++) c[i] = fn((i / (size - 1)) * 2 - 1)
  return c
}

/** Type-selector helper: each type owns an input gate and an output gain; switching crossfades. */
export class TypeBranches<K extends string> {
  private readonly gates = new Map<K, GainLike>()
  private readonly outs = new Map<K, GainLike>()
  private selected: K | null = null

  constructor(
    private readonly bag: NodeBag,
    private readonly input: NodeLike,
    private readonly output: NodeLike,
  ) {}

  /** Register a branch: returns its gated input; connect the branch's result to `out`. */
  add(key: K): { in: GainLike; out: GainLike } {
    const gate = this.bag.gain(0)
    const out = this.bag.gain(0)
    this.input.connect(gate)
    out.connect(this.output)
    this.gates.set(key, gate)
    this.outs.set(key, out)
    return { in: gate, out }
  }

  select(key: K, level: number, now: number): void {
    for (const [k, gate] of this.gates) {
      const on = k === key
      if (on || k === this.selected || this.selected === null) {
        rampTo(gate.gain, on ? 1 : 0, now)
        rampTo(this.outs.get(k)!.gain, on ? level : 0, now)
      }
    }
    this.selected = key
  }
}
