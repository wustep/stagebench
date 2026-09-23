// The shared Rotary speaker (manual p. 53): drive → crossover → horn (treble) and bass rotor,
// each with doppler (modulated delay), amplitude modulation and stereo sweep. Slow/Fast changes
// accelerate smoothly (horn quicker than the heavier rotor). One instance per engine; piano layers
// reach it via Amp Sim type To Rotary, after all their other units (Reverb precedes Rotary).
import type { AudioContextLike, GainLike, OscillatorLike, ParamLike, WaveShaperLike } from '../webAudioTypes'
import { holdParam, makeCurve, NodeBag, rampTo, unit } from './common'

export const ROTARY_SPEEDS = {
  horn: { slow: 0.8, fast: 6.8, accelTau: 0.35 },
  rotor: { slow: 0.67, fast: 5.8, accelTau: 1.1 },
}

/** What the Rotary unit plays: speed (Slow/Fast, Stop mode turns Slow into Stop) and drive. */
export interface RotaryDrive {
  fast: boolean
  drive: number
  stopMode?: boolean
}

export type RotarySpeed = 'slow' | 'fast' | 'stop'
export const rotarySpeed = (s: RotaryDrive): RotarySpeed => (s.fast ? 'fast' : s.stopMode ? 'stop' : 'slow')

interface Rotor {
  lfo: { osc: OscillatorLike; depth: GainLike }
  am: GainLike
  pan: GainLike
  key: 'horn' | 'rotor'
}

export class RotaryUnit {
  readonly bag: NodeBag
  readonly input: GainLike
  readonly output: GainLike
  readonly drive: GainLike
  private readonly shaper: WaveShaperLike
  private readonly rotors: Rotor[] = []
  private speed: RotarySpeed | null = null

  constructor(readonly ctx: AudioContextLike) {
    const b = (this.bag = new NodeBag(ctx))
    this.input = b.gain(1)
    this.output = b.gain(1)
    this.drive = b.gain(1)
    this.shaper = b.add(ctx.createWaveShaper())
    this.shaper.curve = makeCurve((x) => Math.tanh(x), 1024)
    const post = b.gain(1)
    this.input.connect(this.drive)
    this.drive.connect(this.shaper)
    this.shaper.connect(post)

    for (const key of ['horn', 'rotor'] as const) {
      const xover = b.add(ctx.createBiquadFilter())
      xover.type = key === 'horn' ? 'highpass' : 'lowpass'
      xover.frequency.value = 800
      xover.Q.value = 0.6
      post.connect(xover)
      const dl = b.add(ctx.createDelay(0.05))
      dl.delayTime.value = key === 'horn' ? 0.004 : 0.006
      const lfo = b.lfo('sine', ROTARY_SPEEDS[key].slow, key === 'horn' ? 0.0009 : 0.0005)
      lfo.depth.connect(dl.delayTime)
      const am = b.gain(key === 'horn' ? 0.7 : 0.8)
      const amDepth = b.gain(key === 'horn' ? 0.3 : 0.15)
      lfo.osc.connect(amDepth)
      amDepth.connect(am.gain)
      const panner = b.add(ctx.createStereoPanner())
      const pan = b.gain(key === 'horn' ? 0.85 : 0.4)
      lfo.osc.connect(pan)
      pan.connect(panner.pan)
      xover.connect(dl)
      dl.connect(am)
      am.connect(panner)
      panner.connect(this.output)
      this.rotors.push({ lfo, am, pan, key })
    }
  }

  /** The rotor speed parameters (Hz): horn, then bass rotor (diagnostics and tests). */
  get speedParams(): ParamLike[] {
    return this.rotors.map((r) => r.lfo.osc.frequency)
  }

  apply(s: RotaryDrive, now: number): void {
    rampTo(this.drive.gain, 0.5 + 5 * unit(s.drive) ** 2, now)
    const speed = rotarySpeed(s)
    if (this.speed !== speed) {
      for (const r of this.rotors) {
        const sp = ROTARY_SPEEDS[r.key]
        const target = speed === 'fast' ? sp.fast : speed === 'slow' ? sp.slow : 0
        if (this.speed === null) {
          r.lfo.osc.frequency.setValueAtTime(target, now)
        } else {
          // Smooth acceleration / deceleration.
          holdParam(r.lfo.osc.frequency, now)
          r.lfo.osc.frequency.setTargetAtTime(target, now, sp.accelTau)
        }
      }
      this.speed = speed
    }
  }

  dispose(): void {
    this.bag.dispose()
  }
}
