// One layer's effect chain in the documented order (effects spec signalContract):
// input → Mod 1 → Mod 2 → Delay → Amp Sim/EQ → Compressor → Reverb → output.
import type { ChainState, ReverbType } from '../../model/sound'
import type { AudioContextLike, BufferLike, GainLike } from '../webAudioTypes'
import { AmpEqUnit, CompUnit } from './ampEq'
import type { FxUnit } from './common'
import { DelayUnit } from './delay'
import { Mod1Unit, Mod2Unit } from './modulation'
import { ReverbUnit } from './reverb'

export const CHAIN_ORDER = ['mod1', 'mod2', 'delay', 'amp', 'comp', 'reverb'] as const
export type ChainUnitKey = (typeof CHAIN_ORDER)[number]

export class LayerChain {
  readonly units: { [K in ChainUnitKey]: FxUnit<ChainState[K]> }
  readonly input: GainLike
  readonly output: GainLike

  constructor(ctx: AudioContextLike, irCache: Map<ReverbType, BufferLike>, irScale = 1) {
    this.units = {
      mod1: new Mod1Unit(ctx),
      mod2: new Mod2Unit(ctx),
      delay: new DelayUnit(ctx),
      amp: new AmpEqUnit(ctx),
      comp: new CompUnit(ctx),
      reverb: new ReverbUnit(ctx, irCache, irScale),
    }
    const list = CHAIN_ORDER.map((k) => this.units[k] as FxUnit<unknown>)
    for (let i = 0; i < list.length - 1; i++) list[i].output.connect(list[i + 1].input)
    this.input = list[0].input
    this.output = list[list.length - 1].output
  }

  /** Apply the chain's effective settings; `allOn` is the Layer Effects ON (all-effects bypass). */
  apply(s: ChainState, allOn: boolean, now: number): void {
    ;(this.units.mod1 as Mod1Unit).apply(s.mod1, allOn && s.mod1.on, now)
    ;(this.units.mod2 as Mod2Unit).apply(s.mod2, allOn && s.mod2.on, now)
    ;(this.units.delay as DelayUnit).apply(s.delay, allOn && s.delay.on, now)
    ;(this.units.amp as AmpEqUnit).apply(s.amp, allOn && s.amp.on, now)
    ;(this.units.comp as CompUnit).apply(s.comp, allOn && s.comp.on, now)
    ;(this.units.reverb as ReverbUnit).apply(s.reverb, allOn && s.reverb.on, now)
  }

  dispose(): void {
    for (const k of CHAIN_ORDER) this.units[k].dispose()
  }
}
