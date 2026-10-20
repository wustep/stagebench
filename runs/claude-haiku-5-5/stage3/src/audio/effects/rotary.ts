// The shared Rotary speaker: one instance for the whole instrument. Every layer routed "To Rotary"
// sums into its input. It models the horn (a short delay that wobbles in pitch, plus a faster
// amplitude swirl) and the bass rotor (a slower amplitude swirl). Slow and Fast set the rotor speed;
// the change accelerates or decelerates smoothly, never by a step. Brake stops the rotor.

import type { AudioContextLike, GainNodeLike, OscillatorNodeLike } from '../audioBoundary'
import { gainNode, lfo, NodeBag, ramp, softClipCurve } from './nodes'

const SLOW_HZ = 0.8
const FAST_HZ = 6.5
const BRAKE_HZ = 0.001
const SPEED_TAU = 0.6

export interface RotarySettings {
  /** Fast when true. Used when no continuous speed is given. */
  fast: boolean
  brake: boolean
  /** Output level, 0..1. */
  level: number
  /** Continuous rotor speed, 0 (slow) to 1 (fast). Morphable, so the speed can move between the two. */
  speed?: number
}

/** The rotor speed in Hz for the settings: the continuous speed when given, else Slow or Fast. */
function rotorTarget(settings: RotarySettings): number {
  if (settings.speed === undefined) return settings.fast ? FAST_HZ : SLOW_HZ
  const v = Math.min(1, Math.max(0, settings.speed))
  return SLOW_HZ + (FAST_HZ - SLOW_HZ) * v
}

export class RotaryUnit {
  /** Layers feed this node. */
  readonly input: GainNodeLike
  /** Rotary output, already at the speaker level. Connect to the master path. */
  readonly output: GainNodeLike
  private readonly context: AudioContextLike
  private readonly hornLfo: OscillatorNodeLike
  private readonly rotorLfo: OscillatorNodeLike
  private readonly bag = new NodeBag()

  constructor(context: AudioContextLike) {
    this.context = context
    const bag = this.bag
    this.input = gainNode(context, bag, 1)
    this.output = gainNode(context, bag, 0.8)

    // Horn: a short delay whose length swings with the horn LFO (the pitch wobble of a moving source).
    const horn = bag.add(context.createDelay(0.05))
    horn.delayTime.setValueAtTime(0.005, context.currentTime)
    this.input.connect(horn)
    this.hornLfo = lfo(context, bag, SLOW_HZ)
    const hornDepth = gainNode(context, bag, 0.003)
    this.hornLfo.connect(hornDepth)
    hornDepth.connect(horn.delayTime)

    // Amplitude swirl for both rotors: the same LFO drives a gain, so the level pulses at the rotor speed.
    const swirl = gainNode(context, bag, 0.8)
    horn.connect(swirl)
    this.rotorLfo = lfo(context, bag, SLOW_HZ)
    const swirlDepth = gainNode(context, bag, 0.3)
    this.rotorLfo.connect(swirlDepth)
    swirlDepth.connect(swirl.gain)

    // Drive: the speaker's mild break-up.
    const drive = bag.add(context.createWaveShaper())
    drive.curve = softClipCurve(0.3)
    swirl.connect(drive)
    drive.connect(this.output)
  }

  apply(settings: RotarySettings): void {
    const target = settings.brake ? BRAKE_HZ : rotorTarget(settings)
    ramp(this.context, this.hornLfo.frequency, target, SPEED_TAU)
    ramp(this.context, this.rotorLfo.frequency, target, SPEED_TAU)
    ramp(this.context, this.output.gain, 0.8 * Math.min(1, Math.max(0, settings.level)))
  }

  dispose(): void {
    this.bag.dispose()
  }
}
