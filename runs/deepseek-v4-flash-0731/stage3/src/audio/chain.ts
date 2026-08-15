/**
 * Layer effects chain — the ordered per-layer signal path for Phase 2.
 *
 * Documented order (effects spec `signalContract.requiredOrder`):
 *   Layer source → Mod 1 → Mod 2 → Delay → Amp Sim/EQ → Compressor → Reverb
 *   → [Rotary when routed] → Layer level → Master gain/limiter → Destination.
 *
 * This file owns the per-layer chain (Mod 1 … Reverb) and the shared Rotary
 * placement. The chain exposes per-unit on/bypass, an all-effects bypass, and
 * per-unit parameter routing so the panel/state bridge can drive it. Rotary is
 * a single shared instance that sits after the layer's reverb for layers that
 * route to it (To Rotary); the master/limiter lives in stage.ts.
 */

import {
  AmpEq,
  Compressor,
  Delay,
  Mod1,
  Mod2,
  Reverb,
  Rotary,
  type EffectParams,
  type EffectUnit,
} from './effects'

export type ChainUnitId = 'mod1' | 'mod2' | 'delay' | 'ampEq' | 'compressor' | 'reverb'

export const CHAIN_ORDER: readonly ChainUnitId[] = ['mod1', 'mod2', 'delay', 'ampEq', 'compressor', 'reverb']

export interface LayerChainState {
  /** per-unit on/off. */
  on: Record<ChainUnitId, boolean>
  /** per-unit parameter snapshots. */
  params: Record<ChainUnitId, EffectParams>
  /** all-effects bypass: when true every unit is skipped. */
  allBypass: boolean
  /** whether this layer routes into the shared Rotary. */
  toRotary: boolean
}

/**
 * One layer's ordered effect chain. `process` runs the units in the documented
 * order; the shared Rotary is applied by the stage after the layer's reverb
 * when `toRotary` is set.
 */
export class LayerEffectsChain {
  readonly mod1: Mod1
  readonly mod2: Mod2
  readonly delay: Delay
  readonly ampEq: AmpEq
  readonly compressor: Compressor
  readonly reverb: Reverb
  /** shared rotary instance (owned by the stage; passed in for routing). */
  readonly rotary: Rotary

  private allBypass = false
  private toRotary = false

  constructor(sampleRate: number, rotary: Rotary) {
    this.mod1 = new Mod1(sampleRate)
    this.mod2 = new Mod2(sampleRate)
    this.delay = new Delay(sampleRate)
    this.ampEq = new AmpEq(sampleRate)
    this.compressor = new Compressor(sampleRate)
    this.reverb = new Reverb(sampleRate)
    this.rotary = rotary
  }

  /** apply a full chain state (on flags + params + bypass + routing). */
  apply(state: LayerChainState): void {
    this.allBypass = state.allBypass
    this.toRotary = state.toRotary
    const units: Record<ChainUnitId, EffectUnit> = {
      mod1: this.mod1,
      mod2: this.mod2,
      delay: this.delay,
      ampEq: this.ampEq,
      compressor: this.compressor,
      reverb: this.reverb,
    }
    for (const id of CHAIN_ORDER) {
      const unit = units[id]
      unit.on = state.on[id] ?? false
      unit.params = state.params[id] ?? {}
    }
  }

  get isAllBypass(): boolean {
    return this.allBypass
  }

  get routesToRotary(): boolean {
    return this.toRotary
  }

  /**
   * Process a stereo block through the ordered chain (Mod1 → … → Reverb).
   * When allBypass is set, the block passes through untouched.
   */
  process(l: Float32Array, r: Float32Array): void {
    if (this.allBypass) return
    if (this.mod1.on) this.mod1.process(l, r)
    if (this.mod2.on) this.mod2.process(l, r)
    if (this.delay.on) this.delay.process(l, r)
    if (this.ampEq.on) this.ampEq.process(l, r)
    if (this.compressor.on) this.compressor.process(l, r)
    if (this.reverb.on) this.reverb.process(l, r)
  }

  /** reset every unit's internal state. */
  reset(): void {
    this.mod1.reset()
    this.mod2.reset()
    this.delay.reset()
    this.ampEq.reset()
    this.compressor.reset()
    this.reverb.reset()
  }
}
