// Mod 1 and Mod 2: the two modulation units. Each unit holds one branch per listed type, all wired
// from the same input behind a BranchSelector; a type change only moves branch gains, so switching
// types is click-free. Every branch is built from the Web Audio nodes its name implies and has a
// measurable effect on the signal (the render tests check each one).

import type {
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  DelayNodeLike,
  GainNodeLike,
  OscillatorNodeLike,
  StereoPannerNodeLike,
  WaveShaperNodeLike,
} from '../audioBoundary'
import { BranchSelector, EffectSlot } from './slot'
import { clamp01, expRange, gainNode, lfo, NodeBag, ramp, rectifierCurve } from './nodes'
import type { ModSettings } from './types'

/** One selectable type inside a modulation unit. */
interface ModBranch {
  build(context: AudioContextLike, bag: NodeBag, input: AudioNodeLike): BuiltBranch
}

interface BuiltBranch {
  output: AudioNodeLike
  /** Moves the branch to a rate (0..1 control) and an amount (0..1 control). */
  update(rate: number, amount: number): void
}

/** Wires an LFO through a depth gain into an AudioParam. The depth gain is returned so it can be moved. */
function modulate(context: AudioContextLike, bag: NodeBag, source: OscillatorNodeLike, target: AudioParamLike): GainNodeLike {
  const depth = gainNode(context, bag, 0)
  source.connect(depth)
  depth.connect(target)
  return depth
}

const aPan: ModBranch = {
  build(context, bag, input) {
    const panner: StereoPannerNodeLike = bag.add(context.createStereoPanner())
    input.connect(panner)
    const osc = lfo(context, bag, 1)
    const depth = modulate(context, bag, osc, panner.pan)
    return {
      output: panner,
      update(rate, amount) {
        ramp(context, osc.frequency, expRange(rate, 0.1, 4))
        ramp(context, depth.gain, clamp01(amount))
      },
    }
  },
}

const tremolo: ModBranch = {
  build(context, bag, input) {
    const level = gainNode(context, bag, 1)
    input.connect(level)
    const osc = lfo(context, bag, 4)
    const depth = modulate(context, bag, osc, level.gain)
    return {
      output: level,
      update(rate, amount) {
        ramp(context, osc.frequency, expRange(rate, 0.5, 10))
        ramp(context, level.gain, 1 - clamp01(amount) / 2)
        ramp(context, depth.gain, clamp01(amount) / 2)
      },
    }
  },
}

const ringMod: ModBranch = {
  build(context, bag, input) {
    const ring = gainNode(context, bag, 0)
    input.connect(ring)
    const carrier = lfo(context, bag, 200)
    const depth = modulate(context, bag, carrier, ring.gain)
    const dry = gainNode(context, bag, 1)
    input.connect(dry)
    const sum = gainNode(context, bag, 1)
    ring.connect(sum)
    dry.connect(sum)
    return {
      output: sum,
      update(rate, amount) {
        ramp(context, carrier.frequency, expRange(rate, 30, 600))
        ramp(context, depth.gain, clamp01(amount))
        ramp(context, dry.gain, 1 - clamp01(amount))
      },
    }
  },
}

const aWah: ModBranch = {
  build(context, bag, input) {
    // Envelope follower: rectify, smooth to a slow control signal, and let it sweep a band-pass.
    const rectifier: WaveShaperNodeLike = bag.add(context.createWaveShaper())
    rectifier.curve = rectifierCurve()
    input.connect(rectifier)
    const smoother: BiquadFilterNodeLike = bag.add(context.createBiquadFilter())
    smoother.type = 'lowpass'
    smoother.frequency.setValueAtTime(8, context.currentTime)
    smoother.Q.setValueAtTime(0.7, context.currentTime)
    rectifier.connect(smoother)
    const sweep = gainNode(context, bag, 1000)
    smoother.connect(sweep)
    const band: BiquadFilterNodeLike = bag.add(context.createBiquadFilter())
    band.type = 'bandpass'
    band.frequency.setValueAtTime(450, context.currentTime)
    band.Q.setValueAtTime(3.5, context.currentTime)
    input.connect(band)
    sweep.connect(band.frequency)
    return {
      output: band,
      update(rate, amount) {
        // The rate knob is the envelope's sensitivity; amount scales how far the band moves.
        ramp(context, sweep.gain, (800 + 4000 * clamp01(rate)) * (0.4 + 0.6 * clamp01(amount)))
      },
    }
  },
}

const wah: ModBranch = {
  build(context, bag, input) {
    const filter: BiquadFilterNodeLike = bag.add(context.createBiquadFilter())
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(600, context.currentTime)
    filter.Q.setValueAtTime(6, context.currentTime)
    input.connect(filter)
    const osc = lfo(context, bag, 1)
    const depth = modulate(context, bag, osc, filter.frequency)
    return {
      output: filter,
      update(rate, amount) {
        ramp(context, osc.frequency, expRange(rate, 0.3, 4))
        ramp(context, depth.gain, 1100 * clamp01(amount))
      },
    }
  },
}

const pump: ModBranch = {
  build(context, bag, input) {
    // Side-chain style ducking: a triangle LFO pulls the level down and back up at the rate.
    const level = gainNode(context, bag, 1)
    input.connect(level)
    const osc = lfo(context, bag, 2, 'triangle')
    const depth = modulate(context, bag, osc, level.gain)
    return {
      output: level,
      update(rate, amount) {
        ramp(context, osc.frequency, expRange(rate, 1, 6))
        ramp(context, level.gain, 1 - clamp01(amount) / 2)
        ramp(context, depth.gain, clamp01(amount) / 2)
      },
    }
  },
}

const MOD1_BRANCHES: readonly ModBranch[] = [aPan, tremolo, ringMod, aWah, wah, pump]

/**
 * A modulated delay mixed with the dry signal. `rateTau` is how quickly the LFO follows a rate
 * change: short for most chorus types, long for Spin, whose speed is meant to glide.
 */
function chorus(rateLow: number, rateHigh: number, baseDelay: number, depthSeconds: number, rateTau?: number): ModBranch {
  return {
    build(context, bag, input) {
      const delay: DelayNodeLike = bag.add(context.createDelay(0.1))
      delay.delayTime.setValueAtTime(baseDelay, context.currentTime)
      input.connect(delay)
      const dry = gainNode(context, bag, 1)
      input.connect(dry)
      const wet = gainNode(context, bag, 0.5)
      delay.connect(wet)
      const sum = gainNode(context, bag, 1)
      dry.connect(sum)
      wet.connect(sum)
      const osc = lfo(context, bag, 1)
      const depth = modulate(context, bag, osc, delay.delayTime)
      return {
        output: sum,
        update(rate, amount) {
          ramp(context, osc.frequency, expRange(rate, rateLow, rateHigh), rateTau)
          ramp(context, depth.gain, depthSeconds * clamp01(amount))
          ramp(context, wet.gain, 0.5 * clamp01(amount))
          ramp(context, dry.gain, 1 - 0.5 * clamp01(amount))
        },
      }
    },
  }
}

const flanger: ModBranch = {
  build(context, bag, input) {
    // A very short delay with feedback: the comb filter sweeps as the delay time moves.
    const delay: DelayNodeLike = bag.add(context.createDelay(0.05))
    delay.delayTime.setValueAtTime(0.003, context.currentTime)
    const feedback = gainNode(context, bag, 0.4)
    input.connect(delay)
    delay.connect(feedback)
    feedback.connect(delay)
    const sum = gainNode(context, bag, 0.6)
    input.connect(sum)
    delay.connect(sum)
    const osc = lfo(context, bag, 0.4)
    const depth = modulate(context, bag, osc, delay.delayTime)
    return {
      output: sum,
      update(rate, amount) {
        ramp(context, osc.frequency, expRange(rate, 0.1, 2))
        ramp(context, depth.gain, 0.0025 * clamp01(amount))
        ramp(context, feedback.gain, 0.2 + 0.6 * clamp01(amount))
      },
    }
  },
}

function allpassStage(context: AudioContextLike, bag: NodeBag, frequency: number): BiquadFilterNodeLike {
  const stage: BiquadFilterNodeLike = bag.add(context.createBiquadFilter())
  stage.type = 'allpass'
  stage.frequency.setValueAtTime(frequency, context.currentTime)
  stage.Q.setValueAtTime(0.7, context.currentTime)
  return stage
}

const phaser: ModBranch = {
  build(context, bag, input) {
    // Four all-pass stages in series, swept together; the dry sum produces the notches.
    const stages = [400, 600, 900, 1350].map((f) => allpassStage(context, bag, f))
    input.connect(stages[0])
    for (let i = 0; i < stages.length - 1; i += 1) {
      stages[i].connect(stages[i + 1])
    }
    const sum = gainNode(context, bag, 0.5)
    input.connect(sum)
    stages[stages.length - 1].connect(sum)
    const osc = lfo(context, bag, 0.5)
    const depths = stages.map((stage) => modulate(context, bag, osc, stage.frequency))
    return {
      output: sum,
      update(rate, amount) {
        ramp(context, osc.frequency, expRange(rate, 0.1, 3))
        for (const depth of depths) ramp(context, depth.gain, 500 * clamp01(amount))
      },
    }
  },
}

const vibe: ModBranch = {
  build(context, bag, input) {
    // Staggered all-pass stages plus a short delay wobbling in pitch: a phase-and-pitch vibrato.
    const stages = [500, 1100, 2100].map((f) => allpassStage(context, bag, f))
    input.connect(stages[0])
    for (let i = 0; i < stages.length - 1; i += 1) {
      stages[i].connect(stages[i + 1])
    }
    const delay: DelayNodeLike = bag.add(context.createDelay(0.05))
    delay.delayTime.setValueAtTime(0.004, context.currentTime)
    input.connect(delay)
    const sum = gainNode(context, bag, 0.5)
    stages[stages.length - 1].connect(sum)
    delay.connect(sum)
    const osc = lfo(context, bag, 1)
    const pitch = modulate(context, bag, osc, delay.delayTime)
    const sweeps = stages.map((stage) => modulate(context, bag, osc, stage.frequency))
    return {
      output: sum,
      update(rate, amount) {
        ramp(context, osc.frequency, expRange(rate, 0.2, 3))
        ramp(context, pitch.gain, 0.0035 * clamp01(amount))
        for (const sweep of sweeps) ramp(context, sweep.gain, 350 * clamp01(amount))
      },
    }
  },
}

const ensemble: ModBranch = {
  build(context, bag, input) {
    // Three modulated delay lines at slightly different rates, so they drift against each other.
    const sum = gainNode(context, bag, 0.2)
    const dry = gainNode(context, bag, 0.5)
    input.connect(dry)
    dry.connect(sum)
    const lines = [
      { base: 0.01, rate: 0.7 },
      { base: 0.0135, rate: 0.9 },
      { base: 0.017, rate: 1.1 },
    ].map(({ base, rate }) => {
      const delay: DelayNodeLike = bag.add(context.createDelay(0.05))
      delay.delayTime.setValueAtTime(base, context.currentTime)
      input.connect(delay)
      delay.connect(sum)
      const osc = lfo(context, bag, rate)
      return { osc, rate, depth: modulate(context, bag, osc, delay.delayTime) }
    })
    return {
      output: sum,
      update(rate, amount) {
        for (const line of lines) {
          ramp(context, line.osc.frequency, line.rate * expRange(rate, 0.5, 2))
          ramp(context, line.depth.gain, 0.003 * clamp01(amount))
        }
      },
    }
  },
}

const MOD2_BRANCHES: readonly ModBranch[] = [
  chorus(0.2, 3, 0.02, 0.004),
  flanger,
  phaser,
  vibe,
  ensemble,
  chorus(0.3, 1.2, 0.015, 0.004, 0.6),
]

/** A modulation unit: one slot, with a branch per listed type. */
export class ModulationUnit {
  readonly slot: EffectSlot
  private selector: BranchSelector | undefined
  private readonly updaters: ((rate: number, amount: number) => void)[] = []

  constructor(context: AudioContextLike, branches: readonly ModBranch[]) {
    this.slot = new EffectSlot(context, {
      build: (ctx, bag, wetIn) => {
        const selector = new BranchSelector(ctx, bag, branches.length)
        this.selector = selector
        branches.forEach((branch, index) => {
          const built = branch.build(ctx, bag, wetIn)
          built.output.connect(selector.inputFor(index))
          this.updaters.push(built.update)
        })
        return selector.output
      },
    })
  }

  apply(settings: ModSettings): void {
    this.slot.setOn(settings.on)
    this.slot.setMix(1)
    this.selector?.select(settings.type)
    for (const update of this.updaters) update(settings.rate, settings.amount)
  }

  dispose(): void {
    this.slot.dispose()
  }
}

export function createMod1(context: AudioContextLike): ModulationUnit {
  return new ModulationUnit(context, MOD1_BRANCHES)
}

export function createMod2(context: AudioContextLike): ModulationUnit {
  return new ModulationUnit(context, MOD2_BRANCHES)
}
