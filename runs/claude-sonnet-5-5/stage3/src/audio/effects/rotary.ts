import type { RotaryState } from '../../engine/state'
import { clamp } from '../params'
import type { AudioContextLike, AudioNodeLike, GainNodeLike } from '../types'
import { driveCurve, ramp, Rig, type FxNode } from './rig'

/** rotor speeds in Hz (slow "chorale" / fast "tremolo") and how long each takes to change */
export const ROTARY = {
  horn: { slow: 0.8, fast: 6.6, up: 1.1, down: 2.2 },
  drum: { slow: 0.66, fast: 5.7, up: 3.2, down: 5.0 },
  crossover: 800,
}

/**
 * Shared rotary speaker: drive → crossover → drum (bass) and horn (treble) rotors. Each rotor is amplitude modulation +
 * Doppler (delay modulation) + panning driven by one LFO whose speed accelerates and decelerates smoothly.
 * There is exactly one instance for the instrument; layers reach it through "To Rotary".
 */
export class RotaryUnit implements FxNode {
  readonly input: GainNodeLike
  readonly output: GainNodeLike
  private readonly rig: Rig
  private readonly pre: GainNodeLike
  private readonly post: GainNodeLike
  private readonly hornLfo: ReturnType<Rig['osc']>
  private readonly drumLfo: ReturnType<Rig['osc']>
  private speed: number | null = null
  private stopMode = false

  constructor(private readonly ctx: AudioContextLike) {
    const rig = (this.rig = new Rig(ctx))
    this.input = rig.gain(1)
    this.output = rig.gain(1)
    this.pre = rig.gain(1)
    this.post = rig.gain(1)
    const shaper = rig.shaper(driveCurve(1.4), '2x')
    rig.chain(this.input, this.pre, shaper, this.post)

    const lows = [rig.biquad('lowpass', ROTARY.crossover, 0.7), rig.biquad('lowpass', ROTARY.crossover, 0.7)]
    const highs = [rig.biquad('highpass', ROTARY.crossover, 0.7), rig.biquad('highpass', ROTARY.crossover, 0.7)]
    rig.chain(this.post, ...lows)
    rig.chain(this.post, ...highs)

    this.hornLfo = rig.osc('sine', ROTARY.horn.slow)
    this.drumLfo = rig.osc('sine', ROTARY.drum.slow)

    const rotor = (band: AudioNodeLike, lfo: ReturnType<Rig['osc']>, amDepth: number, dopplerS: number, panDepth: number) => {
      const am = rig.gain(1 - amDepth)
      const dop = rig.delay(0.02, 0.006)
      const pan = rig.panner(0)
      band.connect(am)
      am.connect(dop)
      dop.connect(pan)
      pan.connect(this.output)
      for (const [target, depth] of [
        [am.gain, amDepth],
        [dop.delayTime, dopplerS],
        [pan.pan, panDepth],
      ] as const) {
        const d = rig.gain(depth)
        lfo.connect(d)
        d.connect(target)
      }
    }
    rotor(lows[1], this.drumLfo, 0.22, 0.0014, 0.35)
    rotor(highs[1], this.hornLfo, 0.4, 0.0022, 0.85)
  }

  apply(cfg: RotaryState): void {
    const ctx = this.ctx
    ramp(ctx, this.pre.gain, 1 + clamp(cfg.drive, 0, 1) * 6, 0.05)
    ramp(ctx, this.post.gain, 1 / (1 + clamp(cfg.drive, 0, 1) * 2.2), 0.05)
    // speed 0..1 between slow and fast (a morph moves it continuously); in stop mode the slow end is a stopped rotor
    const speed = clamp(cfg.speed ?? (cfg.fast ? 1 : 0), 0, 1)
    if (this.speed !== null && Math.abs(this.speed - speed) < 1e-4 && this.stopMode === cfg.stopMode) return
    const speedingUp = this.speed === null ? false : speed > this.speed || (this.stopMode && !cfg.stopMode)
    this.speed = speed
    this.stopMode = cfg.stopMode
    const target = (r: { slow: number; fast: number }) => (cfg.stopMode ? speed * r.fast : r.slow + (r.fast - r.slow) * speed)
    // speed changes accelerate smoothly (the horn is light, the drum heavy)
    ramp(ctx, this.hornLfo.frequency, target(ROTARY.horn), speedingUp ? ROTARY.horn.up : ROTARY.horn.down)
    ramp(ctx, this.drumLfo.frequency, target(ROTARY.drum), speedingUp ? ROTARY.drum.up : ROTARY.drum.down)
  }

  /** current horn rotor speed in Hz (for panel feedback / tests) */
  get hornHz(): number {
    return this.hornLfo.frequency.value
  }

  dispose(): void {
    this.rig.dispose()
  }
}
