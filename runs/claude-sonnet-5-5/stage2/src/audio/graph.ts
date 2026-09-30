import { LAYER_IDS, type EngineState, type LayerFx, type LayerId } from '../engine/state'
import { AmpEqUnit } from './effects/amp'
import { CompressorUnit } from './effects/dynamics'
import { DelayUnit } from './effects/delay'
import { ModUnit } from './effects/mod'
import { ReverbUnit } from './effects/reverb'
import { ramp, Rig, type FxNode } from './effects/rig'
import { RotaryUnit } from './effects/rotary'
import { layerGain, masterGain, timbreBands } from './params'
import type { AudioContextLike, AudioNodeLike, BiquadLike, CompressorLike, GainNodeLike, Scheduler, WaveShaperLike } from './types'

export const LIMITER = { threshold: -8, knee: 3, ratio: 20, attack: 0.001, release: 0.12 }

/** transparent below 0.6, then a smooth knee to ±1: a safety net in front of the limiter for extreme peaks */
export function softClipCurve(samples = 2048): Float32Array {
  const curve = new Float32Array(samples)
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1
    const a = Math.abs(x)
    curve[i] = Math.sign(x) * (a < 0.6 ? a : 0.6 + 0.4 * Math.tanh((a - 0.6) / 0.4))
  }
  return curve
}

/** the six effect units of one layer, wired in the documented order */
export const CHAIN_ORDER = ['mod1', 'mod2', 'delay', 'amp', 'comp', 'reverb'] as const

export class LayerChain implements FxNode {
  readonly input: GainNodeLike
  readonly output: GainNodeLike
  readonly mod1: ModUnit
  readonly mod2: ModUnit
  readonly delay: DelayUnit
  readonly amp: AmpEqUnit
  readonly comp: CompressorUnit
  readonly reverb: ReverbUnit
  private readonly rig: Rig

  constructor(ctx: AudioContextLike, scheduler: Scheduler) {
    const rig = (this.rig = new Rig(ctx))
    this.input = rig.gain(1)
    this.output = rig.gain(1)
    this.mod1 = new ModUnit(ctx, scheduler, 'mod1')
    this.mod2 = new ModUnit(ctx, scheduler, 'mod2')
    this.delay = new DelayUnit(ctx)
    this.amp = new AmpEqUnit(ctx)
    this.comp = new CompressorUnit(ctx)
    this.reverb = new ReverbUnit(ctx, scheduler)
    const units: FxNode[] = [this.mod1, this.mod2, this.delay, this.amp, this.comp, this.reverb]
    this.input.connect(units[0].input)
    for (let i = 0; i < units.length - 1; i++) units[i].output.connect(units[i + 1].input)
    units[units.length - 1].output.connect(this.output)
  }

  /** applies one layer's effect settings; returns whether this layer is routed into the shared rotary */
  apply(fx: LayerFx, effectsOn: boolean): boolean {
    this.mod1.apply(fx.mod1, effectsOn && fx.mod1.on)
    this.mod2.apply(fx.mod2, effectsOn && fx.mod2.on)
    this.delay.apply(fx.delay, effectsOn && fx.delay.on)
    this.amp.apply(fx.amp, effectsOn && fx.amp.on)
    this.comp.apply(fx.comp, effectsOn && fx.comp.on)
    this.reverb.apply(fx.reverb, effectsOn && fx.reverb.on)
    return AmpEqUnit.routesToRotary(fx.amp, effectsOn && fx.amp.on)
  }

  dispose(): void {
    for (const u of [this.mod1, this.mod2, this.delay, this.amp, this.comp, this.reverb]) u.dispose()
    this.rig.dispose()
  }
}

/**
 * One layer: voices → bus → timbre EQ → effect chain → layer level → { master | rotary send }.
 */
export class LayerGraph {
  readonly bus: GainNodeLike
  readonly level: GainNodeLike
  readonly chain: LayerChain
  readonly timbre: [BiquadLike, BiquadLike, BiquadLike]
  private readonly toMaster: GainNodeLike
  private readonly toRotary: GainNodeLike
  private readonly rig: Rig

  constructor(
    private readonly ctx: AudioContextLike,
    scheduler: Scheduler,
    master: AudioNodeLike,
    rotaryInput: AudioNodeLike,
  ) {
    const rig = (this.rig = new Rig(ctx))
    this.bus = rig.gain(1)
    this.timbre = [rig.biquad('lowshelf', 180, 0.7), rig.biquad('peaking', 1500, 0.8), rig.biquad('highshelf', 4000, 0.7)]
    this.chain = new LayerChain(ctx, scheduler)
    this.level = rig.gain(1)
    this.toMaster = rig.gain(1)
    this.toRotary = rig.gain(0)
    rig.chain(this.bus, ...this.timbre, this.chain.input)
    this.chain.output.connect(this.level)
    this.level.connect(this.toMaster)
    this.level.connect(this.toRotary)
    this.toMaster.connect(master)
    this.toRotary.connect(rotaryInput)
  }

  /** returns whether this layer is routed into the rotary */
  apply(state: EngineState, id: LayerId): boolean {
    const ctx = this.ctx
    const layer = state.layers[id]
    ramp(ctx, this.level.gain, layerGain(layer.level))
    const bands = timbreBands(layer.timbre)
    this.timbre.forEach((node, i) => {
      node.type = bands[i].type
      ramp(ctx, node.frequency, bands[i].frequency)
      ramp(ctx, node.gain, bands[i].gain)
      node.Q.value = bands[i].q
    })
    const rotary = this.chain.apply(state.fx[id], state.effectsOn)
    ramp(ctx, this.toRotary.gain, rotary ? 1 : 0)
    ramp(ctx, this.toMaster.gain, rotary ? 0 : 1)
    return rotary
  }

  dispose(): void {
    this.chain.dispose()
    this.rig.dispose()
  }
}

/**
 * The whole signal graph, on ONE AudioContext:
 *
 *   layer A bus ─► timbre ─► Mod1 ─► Mod2 ─► Delay ─► Amp/EQ ─► Comp ─► Reverb ─► layer level ─┬─► master gain ─► limiter ─► destination
 *   layer B bus ─► (same chain) ─────────────────────────────────────────────────► layer level ─┤            ▲
 *                                                                          "To Rotary" layers ─► shared Rotary ┘
 *
 * Reverb always precedes the Rotary; nothing reaches the destination except through master gain and the limiter.
 */
export class MasterGraph {
  readonly master: GainNodeLike
  readonly limiter: CompressorLike
  readonly softClip: WaveShaperLike
  /** where layers routed "To Rotary" send their signal */
  readonly rotaryBus: GainNodeLike
  /** the one shared rotary; built the first time a layer is routed to it */
  rotary: RotaryUnit | null = null
  readonly layers: Record<LayerId, LayerGraph>
  private readonly rig: Rig

  constructor(
    private readonly ctx: AudioContextLike,
    scheduler: Scheduler,
  ) {
    const rig = (this.rig = new Rig(ctx))
    this.master = rig.gain(masterGain(0.72))
    this.limiter = rig.add(ctx.createDynamicsCompressor())
    this.limiter.threshold.value = LIMITER.threshold
    this.limiter.knee.value = LIMITER.knee
    this.limiter.ratio.value = LIMITER.ratio
    this.limiter.attack.value = LIMITER.attack
    this.limiter.release.value = LIMITER.release
    this.softClip = rig.shaper(softClipCurve(), 'none')
    this.master.connect(this.softClip)
    this.softClip.connect(this.limiter)
    this.limiter.connect(ctx.destination)
    this.rotaryBus = rig.gain(1)
    this.layers = {
      A: new LayerGraph(ctx, scheduler, this.master, this.rotaryBus),
      B: new LayerGraph(ctx, scheduler, this.master, this.rotaryBus),
    }
  }

  apply(state: EngineState): void {
    ramp(this.ctx, this.master.gain, masterGain(state.master))
    let routed = false
    for (const id of LAYER_IDS) routed = this.layers[id].apply(state, id) || routed
    if (routed && !this.rotary) {
      this.rotary = new RotaryUnit(this.ctx)
      this.rotaryBus.connect(this.rotary.input)
      this.rotary.output.connect(this.master)
    }
    this.rotary?.apply(state.rotary)
  }

  dispose(): void {
    for (const id of LAYER_IDS) this.layers[id].dispose()
    this.rotary?.dispose()
    this.rig.dispose()
  }
}
