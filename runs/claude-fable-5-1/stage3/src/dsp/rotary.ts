/**
 * ROTARY SPEAKER (manual p. 53): pre-amp overdrive (Drive knob, 0–24 dB into the tube saturator), a Linkwitz-Riley
 * crossover at 800 Hz into a treble horn and a bass rotor, each with amplitude modulation, position-dependent stereo
 * panning and Doppler shift through a short modulated delay. Slow: horn 0.8 Hz / rotor 0.7 Hz; Fast: 6.8 Hz / 5.7 Hz;
 * speed changes accelerate and brake smoothly (horn time constant 1 s, rotor 3 s). `speed` 0..1 (rotary speed morph)
 * blends between the two rates; STOP MODE brakes the slow end to a standstill. Shared by every routed layer.
 */
import { clamp, rotaryDriveKnobToGain, type RotaryParams, type StereoProcessor } from './types'
import { Biquad, DelayLine, OnePole, Smoother, TWO_PI, msToSamples, tubeSaturate } from './util'

const HORN_SLOW = 0.8
const HORN_FAST = 6.8
const ROTOR_SLOW = 0.7
const ROTOR_FAST = 5.7

export class RotaryUnit implements StereoProcessor {
  private readonly drive: Smoother
  private fast = false
  /** Continuous speed 0 (slow) .. 1 (fast); the rotary speed morph sets fractions (manual p. 53). */
  private speed = 0
  private stop = false
  private hornHz = HORN_SLOW
  private rotorHz = ROTOR_SLOW
  private readonly kHorn: number
  private readonly kRotor: number
  private hornAngle = 0
  private rotorAngle = 0
  private readonly hp1L = new Biquad()
  private readonly hp2L = new Biquad()
  private readonly lp1L = new Biquad()
  private readonly lp2L = new Biquad()
  private readonly hp1R = new Biquad()
  private readonly hp2R = new Biquad()
  private readonly lp1R = new Biquad()
  private readonly lp2R = new Biquad()
  private readonly hornDL: DelayLine
  private readonly hornDR: DelayLine
  private readonly rotorDL: DelayLine
  private readonly rotorDR: DelayLine
  private readonly dcL = new OnePole()
  private readonly dcR = new OnePole()
  private started = false
  private lastDrive = -1
  private pre = 1
  private post = 1

  constructor(private readonly sr: number) {
    this.drive = new Smoother(sr, 10, 2)
    this.kHorn = 1 - Math.exp(-1 / (1.0 * sr))
    this.kRotor = 1 - Math.exp(-1 / (3.0 * sr))
    for (const b of [this.hp1L, this.hp2L, this.hp1R, this.hp2R]) b.highpass(sr, 800)
    for (const b of [this.lp1L, this.lp2L, this.lp1R, this.lp2R]) b.lowpass(sr, 800)
    const max = msToSamples(3, sr)
    this.hornDL = new DelayLine(max)
    this.hornDR = new DelayLine(max)
    this.rotorDL = new DelayLine(max)
    this.rotorDR = new DelayLine(max)
    this.dcL.setCutoff(sr, 10)
    this.dcR.setCutoff(sr, 10)
  }

  /** Current horn rotation rate in Hz (follows the speed selector with a 1 s time constant). */
  get hornRate() {
    return this.hornHz
  }

  /** Current bass rotor rate in Hz (3 s time constant). */
  get rotorRate() {
    return this.rotorHz
  }

  get isFast() {
    return this.fast
  }

  get isStopped() {
    return this.stop && this.speed < 0.5
  }

  /** Target horn / rotor rates: slow ↔ fast blended by `speed`; in Stop mode the slow end brakes to a halt. */
  private targets(): [number, number] {
    if (this.stop) return [HORN_FAST * this.speed, ROTOR_FAST * this.speed]
    return [HORN_SLOW + (HORN_FAST - HORN_SLOW) * this.speed, ROTOR_SLOW + (ROTOR_FAST - ROTOR_SLOW) * this.speed]
  }

  setParams(p: RotaryParams) {
    this.fast = !!p.fast
    this.speed = clamp(p.speed ?? (p.fast ? 1 : 0), 0, 1)
    this.stop = !!p.stop
    this.drive.set(clamp(p.drive, 0, 10))
    if (!this.started) {
      this.drive.snap(this.drive.target)
      const [th, tr] = this.targets()
      this.hornHz = th
      this.rotorHz = tr
    }
  }

  process(l: Float32Array, r: Float32Array, n: number) {
    this.started = true
    const sr = this.sr
    const [th, tr] = this.targets()
    for (let i = 0; i < n; i++) {
      this.hornHz += (th - this.hornHz) * this.kHorn
      this.rotorHz += (tr - this.rotorHz) * this.kRotor
      this.hornAngle += (TWO_PI * this.hornHz) / sr
      if (this.hornAngle >= TWO_PI) this.hornAngle -= TWO_PI
      this.rotorAngle += (TWO_PI * this.rotorHz) / sr
      if (this.rotorAngle >= TWO_PI) this.rotorAngle -= TWO_PI
      const drive = this.drive.next()
      if (drive !== this.lastDrive) {
        this.lastDrive = drive
        this.pre = rotaryDriveKnobToGain(drive)
        this.post = 0.25 / Math.tanh(0.25 * this.pre)
      }
      const xl = this.dcL.hp(tubeSaturate(l[i] * this.pre) * this.post)
      const xr = this.dcR.hp(tubeSaturate(r[i] * this.pre) * this.post)
      const hornL = this.hp2L.process(this.hp1L.process(xl))
      const hornR = this.hp2R.process(this.hp1R.process(xr))
      const rotorL = this.lp2L.process(this.lp1L.process(xl))
      const rotorR = this.lp2R.process(this.lp1R.process(xr))
      const ch = Math.cos(this.hornAngle)
      const sh = Math.sin(this.hornAngle)
      const amH = 0.75 + 0.25 * ch
      const gLh = Math.sqrt((1 + sh) * 0.5)
      const gRh = Math.sqrt((1 - sh) * 0.5)
      const dH = msToSamples(1 + 0.5 * ch, sr)
      const hL = this.hornDL.read(dH)
      const hR = this.hornDR.read(dH)
      this.hornDL.write(hornL)
      this.hornDR.write(hornR)
      const cr = Math.cos(this.rotorAngle)
      const srot = Math.sin(this.rotorAngle)
      const amR = 0.825 + 0.175 * cr
      const gLr = Math.sqrt((1 + 0.5 * srot) * 0.5)
      const gRr = Math.sqrt((1 - 0.5 * srot) * 0.5)
      const dR = msToSamples(0.6 + 0.2 * cr, sr)
      const rL = this.rotorDL.read(dR)
      const rR = this.rotorDR.read(dR)
      this.rotorDL.write(rotorL)
      this.rotorDR.write(rotorR)
      l[i] = (hL * amH * gLh + rL * amR * gLr) * 1.2
      r[i] = (hR * amH * gRh + rR * amR * gRr) * 1.2
    }
  }

  reset() {
    for (const b of [this.hp1L, this.hp2L, this.lp1L, this.lp2L, this.hp1R, this.hp2R, this.lp1R, this.lp2R]) b.reset()
    this.hornDL.reset()
    this.hornDR.reset()
    this.rotorDL.reset()
    this.rotorDR.reset()
    this.dcL.reset()
    this.dcR.reset()
    this.hornAngle = 0
    this.rotorAngle = 0
    this.drive.snap(this.drive.target)
    this.lastDrive = -1
  }
}
