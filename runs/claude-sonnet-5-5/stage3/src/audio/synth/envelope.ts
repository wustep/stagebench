import { decayIsSustain, envSeconds, type EnvKnobs } from '../../engine/synth'
import type { AudioParamLike } from '../types'

export interface EnvShape {
  attack: number
  decay: number
  sustain: boolean
  release: number
}

/** knob positions → seconds; a decay knob at its maximum acts as sustain (manual p. 33) */
export const shapeFromKnobs = (k: EnvKnobs): EnvShape => ({ attack: envSeconds(k.attack), decay: envSeconds(k.decay), sustain: decayIsSustain(k.decay), release: envSeconds(k.release) })

/**
 * A linear attack → decay → release envelope written onto one AudioParam. The level is also computed analytically
 * (`level(t)`), so a retrigger or release scheduled ahead of time starts exactly where the scheduled curve is.
 */
export class Envelope {
  private t0 = 0
  private from = 0
  private shape: EnvShape = { attack: 0.002, decay: 1, sustain: true, release: 0.1 }
  private relT: number | null = null
  private relFrom = 0
  private relLen = 0
  private started = false
  constructor(private readonly param: AudioParamLike) {}

  level(t: number): number {
    if (!this.started) return 0
    if (this.relT !== null && t >= this.relT) return this.relLen <= 0 ? 0 : Math.max(0, this.relFrom * (1 - (t - this.relT) / this.relLen))
    const tt = t - this.t0
    if (tt <= 0) return this.from
    const { attack, decay, sustain } = this.shape
    if (tt < attack) return this.from + (1 - this.from) * (tt / attack)
    if (sustain) return 1
    return Math.max(0, 1 - (tt - attack) / decay)
  }

  /** (re)start the attack at `t` from the current level */
  trigger(t: number, shape: EnvShape): void {
    const from = this.started ? this.level(t) : 0
    this.anchor(t, from)
    this.t0 = t
    this.from = from
    this.shape = shape
    this.relT = null
    this.started = true
    this.param.setValueAtTime(from, t)
    this.param.linearRampToValueAtTime(1, t + shape.attack)
    if (!shape.sustain) this.param.linearRampToValueAtTime(0, t + shape.attack + shape.decay)
  }

  release(t: number, seconds: number, force = false): void {
    if (!this.started || (this.relT !== null && !force)) return
    const from = this.level(t)
    this.anchor(t, from)
    this.relT = t
    this.relFrom = from
    this.relLen = seconds
    this.param.setValueAtTime(from, t)
    this.param.linearRampToValueAtTime(0, t + seconds)
  }

  /** end time of the release, or null while the key is down */
  get releaseEnd(): number | null {
    return this.relT === null ? null : this.relT + this.relLen
  }

  /** keep the already-scheduled curve up to `t` when later events are cancelled, so events scheduled ahead of time stay correct */
  private anchor(t: number, value: number): void {
    this.param.cancelScheduledValues(t)
    if (this.started) this.param.linearRampToValueAtTime(value, t)
  }
}
