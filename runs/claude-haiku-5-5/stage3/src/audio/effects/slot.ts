// An effect slot is the bypass structure every unit shares:
//
//   input ──► dry gain ─────────────────────────────┐
//     └─────► wet input ──► (unit's processing) ──► wet gain ──► output
//
// Bypass is a crossfade between the dry and wet gains, so turning a unit on or off, or moving its
// mix, never clicks. A unit whose switch is off passes its input straight through. Type selection
// inside a unit uses the same idea: every type stays connected and only its gain moves.

import type { AudioContextLike, AudioNodeLike, GainNodeLike } from '../audioBoundary'
import { gainNode, NodeBag, ramp } from './nodes'

export interface EffectSlotOptions {
  /** Builds the processing chain between the wet input and the returned node. */
  build(context: AudioContextLike, bag: NodeBag, wetIn: GainNodeLike): AudioNodeLike
}

export class EffectSlot {
  readonly input: GainNodeLike
  readonly output: GainNodeLike
  private readonly context: AudioContextLike
  private readonly bag = new NodeBag()
  private readonly dry: GainNodeLike
  private readonly wet: GainNodeLike
  private on = false
  private mix = 1

  constructor(context: AudioContextLike, options: EffectSlotOptions) {
    this.context = context
    this.input = gainNode(context, this.bag, 1)
    this.output = gainNode(context, this.bag, 1)
    this.dry = gainNode(context, this.bag, 1)
    this.wet = gainNode(context, this.bag, 0)
    const wetIn = gainNode(context, this.bag, 1)
    this.input.connect(this.dry)
    this.dry.connect(this.output)
    this.input.connect(wetIn)
    const processed = options.build(context, this.bag, wetIn)
    processed.connect(this.wet)
    this.wet.connect(this.output)
  }

  get isOn(): boolean {
    return this.on
  }

  /** Switches the unit in or out of the signal path. Off is a clean pass-through. */
  setOn(on: boolean): void {
    if (on === this.on) return
    this.on = on
    this.apply()
  }

  /** Dry/wet balance, 0 (all dry) to 1 (all wet). Only audible while the unit is on. */
  setMix(mix: number): void {
    const clamped = Math.min(1, Math.max(0, mix))
    if (clamped === this.mix) return
    this.mix = clamped
    this.apply()
  }

  dispose(): void {
    this.bag.dispose()
  }

  private apply(): void {
    const wetLevel = this.on ? this.mix : 0
    const dryLevel = this.on ? 1 - this.mix : 1
    ramp(this.context, this.dry.gain, dryLevel)
    ramp(this.context, this.wet.gain, wetLevel)
  }
}

/**
 * Sums several branches, each behind its own gain. Exactly one branch is audible at a time once
 * `select` has been called; a switch crossfades over RAMP_SECONDS. Branches are never disconnected,
 * so a type change does not rebuild anything.
 */
export class BranchSelector {
  readonly output: GainNodeLike
  private readonly context: AudioContextLike
  private readonly gains: GainNodeLike[] = []
  private selected = -1

  constructor(context: AudioContextLike, bag: NodeBag, count: number) {
    this.context = context
    this.output = gainNode(context, bag, 1)
    this.output.gain.setValueAtTime(1, context.currentTime)
    for (let i = 0; i < count; i += 1) {
      const gain = gainNode(context, bag, 0)
      gain.connect(this.output)
      this.gains.push(gain)
    }
  }

  /** The gain that feeds the sum for one branch. Connect the branch's output into it. */
  inputFor(index: number): GainNodeLike {
    return this.gains[index]
  }

  select(index: number): void {
    if (index === this.selected) return
    this.selected = index
    this.gains.forEach((gain, i) => ramp(this.context, gain.gain, i === index ? 1 : 0))
  }

  get current(): number {
    return this.selected
  }
}
