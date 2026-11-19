import type { AudioContextLike, AudioNodeLike, GainNodeLike } from './boundaries'
import type { EffectChainState } from '../model/instrumentState'
import {
  AmpEqUnit,
  CompressorUnit,
  DelayUnit,
  Mod1Unit,
  Mod2Unit,
  ReverbUnit,
} from './effectUnits'

const RAMP_TC = 0.012

/**
 * Per-layer ordered effect chain strictly implementing the Nord Stage 4 signal order:
 * Layer source -> Mod 1 -> Mod 2 -> Delay -> Amp Sim/EQ -> Compressor -> Reverb
 *   -> [Direct -> Layer level -> Master] OR [To Rotary -> Shared Rotary (scaled by layer level) -> Master]
 * Plus click-free All-Effects Bypass around the entire chain and rotary send.
 */
export class LayerEffectChain {
  readonly input: GainNodeLike
  readonly directOutput: GainNodeLike
  readonly rotarySendOutput: GainNodeLike

  private readonly ctx: AudioContextLike
  private readonly mod1: Mod1Unit
  private readonly mod2: Mod2Unit
  private readonly delay: DelayUnit
  private readonly ampEq: AmpEqUnit
  private readonly comp: CompressorUnit
  private readonly reverb: ReverbUnit

  private readonly allBypassGain: GainNodeLike
  private readonly chainWetGain: GainNodeLike
  private readonly directRouteGain: GainNodeLike
  private readonly rotaryRouteGain: GainNodeLike
  private readonly layerLevelDirectGain: GainNodeLike
  private readonly layerLevelRotaryGain: GainNodeLike
  private readonly nodes: AudioNodeLike[] = []

  private isRoutedToRotary = false

  constructor(ctx: AudioContextLike) {
    this.ctx = ctx
    this.input = ctx.createGain()
    this.directOutput = ctx.createGain()
    this.rotarySendOutput = ctx.createGain()

    this.allBypassGain = ctx.createGain()
    this.chainWetGain = ctx.createGain()
    this.directRouteGain = ctx.createGain()
    this.rotaryRouteGain = ctx.createGain()
    this.layerLevelDirectGain = ctx.createGain()
    this.layerLevelRotaryGain = ctx.createGain()

    this.allBypassGain.gain.value = 0
    this.chainWetGain.gain.value = 1
    this.directRouteGain.gain.value = 1
    this.rotaryRouteGain.gain.value = 0
    this.layerLevelDirectGain.gain.value = 1
    this.layerLevelRotaryGain.gain.value = 1

    this.mod1 = new Mod1Unit(ctx)
    this.mod2 = new Mod2Unit(ctx)
    this.delay = new DelayUnit(ctx)
    this.ampEq = new AmpEqUnit(ctx)
    this.comp = new CompressorUnit(ctx)
    this.reverb = new ReverbUnit(ctx)

    // Documented signal order: Mod 1 -> Mod 2 -> Delay -> Amp Sim/EQ -> Compressor -> Reverb
    this.input.connect(this.mod1.input)
    this.mod1.output.connect(this.mod2.input)
    this.mod2.output.connect(this.delay.input)
    this.delay.output.connect(this.ampEq.input)
    this.ampEq.output.connect(this.comp.input)
    this.comp.output.connect(this.reverb.input)
    this.reverb.output.connect(this.chainWetGain)

    // Post-reverb split: direct path vs shared Rotary send (Reverb ALWAYS precedes Rotary)
    this.chainWetGain.connect(this.directRouteGain)
    this.chainWetGain.connect(this.rotaryRouteGain)

    // All-effects bypass path skips all 6 units and Rotary directly into Layer Level
    this.input.connect(this.allBypassGain)
    this.allBypassGain.connect(this.layerLevelDirectGain)

    this.directRouteGain.connect(this.layerLevelDirectGain)
    this.layerLevelDirectGain.connect(this.directOutput)

    this.rotaryRouteGain.connect(this.layerLevelRotaryGain)
    this.layerLevelRotaryGain.connect(this.rotarySendOutput)

    this.nodes.push(
      this.input,
      this.directOutput,
      this.rotarySendOutput,
      this.allBypassGain,
      this.chainWetGain,
      this.directRouteGain,
      this.rotaryRouteGain,
      this.layerLevelDirectGain,
      this.layerLevelRotaryGain,
    )
  }

  get routedToRotary(): boolean {
    return this.isRoutedToRotary
  }

  ensureLfosStarted(): void {
    this.mod1.ensureLfosStarted()
    this.mod2.ensureLfosStarted()
  }

  apply(
    chain: EffectChainState,
    allEffectsOn: boolean,
    layerLevel0To100: number,
    immediate = false,
  ): void {
    const now = this.ctx.currentTime
    const levelNorm = Math.max(0, Math.min(100, layerLevel0To100)) / 100
    const levelGain = levelNorm <= 0 ? 0 : Math.pow(levelNorm, 1.2)

    this.mod1.apply(chain.mod1, immediate)
    this.mod2.apply(chain.mod2, immediate)
    this.delay.apply(chain.delay, immediate)
    this.ampEq.apply(chain.ampEq, immediate)
    this.comp.apply(chain.comp, immediate)
    this.reverb.apply(chain.reverb, immediate)

    const sendToRotary = allEffectsOn && chain.ampEq.on && chain.ampEq.type === 'To Rotary'
    this.isRoutedToRotary = sendToRotary

    const set = (p: GainNodeLike['gain'], v: number) =>
      immediate ? p.setValueAtTime(v, now) : p.setTargetAtTime(v, now, RAMP_TC)

    set(this.allBypassGain.gain, allEffectsOn ? 0 : 1)
    set(this.chainWetGain.gain, allEffectsOn ? 1 : 0)
    set(this.directRouteGain.gain, sendToRotary ? 0 : 1)
    set(this.rotaryRouteGain.gain, sendToRotary ? 1 : 0)
    set(this.layerLevelDirectGain.gain, levelGain)
    set(this.layerLevelRotaryGain.gain, levelGain)
  }

  dispose(): void {
    this.mod1.dispose()
    this.mod2.dispose()
    this.delay.dispose()
    this.ampEq.dispose()
    this.comp.dispose()
    this.reverb.dispose()
    for (const node of this.nodes) {
      try {
        node.disconnect()
      } catch {
        // already disconnected
      }
    }
  }
}
