// The whole audio graph, built once on the single AudioContext:
//
//   voices ─► layer A input ─► timbre ─► Mod 1 ─► Mod 2 ─► Delay ─► Amp/EQ ─► Compressor ─► Reverb ─► level ─┬─► master ─┐
//   voices ─► layer B input ─► …same chain…                                                  level ─► rotary ┘        │
//                                                                                                    rotary ─► master ─┤
//                                                                                                         limiter ◄────┘
//                                                                                                         │
//                                                                                                    destination
//
// Layer effects follow the documented order (Reverb precedes Rotary for routed layers). Routing and
// level changes are gains that ramp, so nothing clicks. The graph is built once and then only has
// its parameters moved, so tearing it down at unmount is one call.

import type { AudioContextLike, AudioNodeLike, DynamicsCompressorNodeLike, GainNodeLike } from './audioBoundary'
import { createMod1, createMod2, type ModulationUnit } from './effects/modulation'
import { AmpEqUnit } from './effects/ampEq'
import { DelayUnit } from './effects/delay'
import { CompressorUnit } from './effects/dynamics'
import { ReverbUnit } from './effects/reverb'
import { RotaryUnit, type RotarySettings } from './effects/rotary'
import { gainNode, NodeBag, ramp } from './effects/nodes'
import { DEFAULT_LAYER_EFFECTS, type LayerEffectSettings } from './effects/types'
import { TIMBRE_VALUES, TimbreFilter, type TimbreStepName } from './timbre'

export type LayerId = 'A' | 'B'
export const LAYER_IDS: readonly LayerId[] = ['A', 'B']

/** Master level at the panel's default knob position (0.7) is the Phase 1 master gain of 0.3. */
export const MASTER_GAIN_AT_DEFAULT = 0.3
export const MASTER_DEFAULT_KNOB = 0.7

export interface LayerGraphSettings {
  on: boolean
  /** Fader position 0..1. Applied as level squared, so the fader tapers. */
  level: number
  /** Routes the layer's output into the shared Rotary instead of straight to master. */
  toRotary: boolean
  effects: LayerEffectSettings
}

export interface GraphSettings {
  /** Master Level knob, 0..1. */
  master: number
  /** Layer Effects ON. Off bypasses every effect unit at once. */
  effectsOn: boolean
  /** Piano section ON. Off silences both layers. */
  sectionOn: boolean
  timbre: TimbreStepName
  rotary: RotarySettings
  layers: Record<LayerId, LayerGraphSettings>
}

export const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  master: 0.7,
  effectsOn: true,
  sectionOn: true,
  timbre: 'Off',
  rotary: { fast: false, brake: false, level: 0.5 },
  layers: {
    A: { on: true, level: 0.75, toRotary: false, effects: DEFAULT_LAYER_EFFECTS },
    B: { on: false, level: 0.5, toRotary: false, effects: DEFAULT_LAYER_EFFECTS },
  },
}

/** Per-layer chain: input, timbre, the six units, level, and routing gains. */
export class LayerChain {
  readonly input: GainNodeLike
  readonly mod1: ModulationUnit
  readonly mod2: ModulationUnit
  readonly delay: DelayUnit
  readonly amp: AmpEqUnit
  readonly comp: CompressorUnit
  readonly reverb: ReverbUnit
  readonly gate: GainNodeLike
  private readonly level: GainNodeLike
  /** Routing gains: exactly one is open unless the layer is off. Exposed so tests can check the route. */
  readonly toMaster: GainNodeLike
  readonly toRotary: GainNodeLike
  private readonly context: AudioContextLike
  private readonly bag = new NodeBag()
  private readonly timbre: TimbreFilter

  constructor(context: AudioContextLike, master: AudioNodeLike, rotary: AudioNodeLike) {
    this.context = context
    const bag = this.bag
    this.input = gainNode(context, bag, 1)
    this.timbre = new TimbreFilter(context, bag, this.input)
    this.mod1 = createMod1(context)
    this.mod2 = createMod2(context)
    this.delay = new DelayUnit(context)
    this.amp = new AmpEqUnit(context)
    this.comp = new CompressorUnit(context)
    this.reverb = new ReverbUnit(context)

    this.timbre.output.connect(this.mod1.slot.input)
    this.mod1.slot.output.connect(this.mod2.slot.input)
    this.mod2.slot.output.connect(this.delay.slot.input)
    this.delay.slot.output.connect(this.amp.slot.input)
    this.amp.slot.output.connect(this.comp.slot.input)
    this.comp.slot.output.connect(this.reverb.slot.input)

    this.level = gainNode(context, bag, 0)
    this.gate = gainNode(context, bag, 0)
    this.toMaster = gainNode(context, bag, 1)
    this.toRotary = gainNode(context, bag, 0)
    this.reverb.slot.output.connect(this.level)
    this.level.connect(this.gate)
    this.gate.connect(this.toMaster)
    this.gate.connect(this.toRotary)
    this.toMaster.connect(master)
    this.toRotary.connect(rotary)
  }

  apply(settings: LayerGraphSettings, effectsOn: boolean, sectionOn: boolean, timbre: TimbreStepName): void {
    const e = settings.effects
    this.timbre.setValues(TIMBRE_VALUES[timbre])
    this.mod1.apply({ ...e.mod1, on: e.mod1.on && effectsOn })
    this.mod2.apply({ ...e.mod2, on: e.mod2.on && effectsOn })
    this.delay.apply({ ...e.delay, on: e.delay.on && effectsOn })
    this.amp.apply({ ...e.amp, on: e.amp.on && effectsOn })
    this.comp.apply({ ...e.comp, on: e.comp.on && effectsOn })
    this.reverb.apply({ ...e.reverb, on: e.reverb.on && effectsOn })
    ramp(this.context, this.level.gain, settings.level * settings.level)
    ramp(this.context, this.gate.gain, settings.on && sectionOn ? 1 : 0, 0.02)
    ramp(this.context, this.toRotary.gain, settings.toRotary ? 1 : 0, 0.02)
    ramp(this.context, this.toMaster.gain, settings.toRotary ? 0 : 1, 0.02)
  }

  dispose(): void {
    this.mod1.dispose()
    this.mod2.dispose()
    this.delay.dispose()
    this.amp.dispose()
    this.comp.dispose()
    this.reverb.dispose()
    this.bag.dispose()
  }
}

/** The graph for one AudioContext: two layer chains, the shared Rotary, master gain, and a limiter. */
export class SignalGraph {
  readonly layers: Record<LayerId, LayerChain>
  readonly rotary: RotaryUnit
  /** The limiter, the last node before the destination. */
  readonly output: DynamicsCompressorNodeLike
  private readonly context: AudioContextLike
  private readonly bag = new NodeBag()
  private readonly master: GainNodeLike
  private primed = false

  constructor(context: AudioContextLike) {
    this.context = context
    const limiter = this.bag.add(context.createDynamicsCompressor())
    limiter.threshold.setValueAtTime(-2, context.currentTime)
    limiter.knee.setValueAtTime(0, context.currentTime)
    limiter.ratio.setValueAtTime(20, context.currentTime)
    limiter.attack.setValueAtTime(0.001, context.currentTime)
    limiter.release.setValueAtTime(0.1, context.currentTime)
    limiter.connect(context.destination)
    this.output = limiter

    this.master = gainNode(context, this.bag, MASTER_GAIN_AT_DEFAULT)
    this.master.connect(limiter)

    this.rotary = new RotaryUnit(context)
    this.rotary.output.connect(this.master)

    this.layers = {
      A: new LayerChain(context, this.master, this.rotary.input),
      B: new LayerChain(context, this.master, this.rotary.input),
    }
  }

  apply(settings: GraphSettings): void {
    const masterGain = MASTER_GAIN_AT_DEFAULT * (settings.master / MASTER_DEFAULT_KNOB)
    if (this.primed) {
      ramp(this.context, this.master.gain, masterGain)
    } else {
      // The first settings are not a change: snap to them so a silent start never fades in from the default.
      this.master.gain.setValueAtTime(masterGain, this.context.currentTime)
      this.primed = true
    }
    this.rotary.apply(settings.rotary)
    for (const id of LAYER_IDS) {
      this.layers[id].apply(settings.layers[id], settings.effectsOn, settings.sectionOn, settings.timbre)
    }
  }

  /** The input a layer's voices connect to. */
  input(id: LayerId): GainNodeLike {
    return this.layers[id].input
  }

  dispose(): void {
    for (const id of LAYER_IDS) this.layers[id].dispose()
    this.rotary.dispose()
    this.bag.dispose()
  }
}
