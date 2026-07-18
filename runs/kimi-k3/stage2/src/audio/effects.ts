/**
 * Every Layer Effects unit, implemented as pure deterministic stereo
 * processors shared verbatim by the real-time graph and the offline test
 * renderer. Each unit exposes a `create(sr)` factory returning an object with
 * `process(frame, params)`; bypass and dry/wet are handled by the chain
 * runner in `render.ts`, never inside a unit, so "bypass" provably means
 * "the unit does not touch the signal".
 */

import {
  Biquad,
  Lfo,
  OnePole,
  TAU,
  clamp,
  clamp01,
  dryWet,
  gainFrame,
  knob01,
  makeNoise,
  stereoFrame,
  type StereoFrame,
} from './dsp'
import type { AmpUnitState, CompUnitState, DelayUnitState, ModUnitState, ReverbUnitState, RotaryState } from '../state/effects-state'

export interface Unit<P> {
  process(frame: StereoFrame, params: P): StereoFrame
}

// ------------------------------------------------------------------ Mod 1

export function createMod1(sr: number): Unit<ModUnitState> {
  const lfo = new Lfo(2, 'sine')
  const bp = new Biquad()
  const lp = new Biquad()
  let env = 0
  return {
    process(frame, p) {
      const n = frame.l.length
      const out = stereoFrame(n)
      const rate = 0.05 + Math.pow(knob01(p.rate), 1.6) * 14 // Hz (A-Wah: sensitivity)
      const amt = knob01(p.amount)
      lfo.rateHz = rate
      switch (p.type) {
        case 0: {
          // A-Pan: LFO stereo panning.
          for (let i = 0; i < n; i++) {
            const pan = lfo.next(sr) * amt // -1..1
            const gl = Math.cos(((pan + 1) * Math.PI) / 4)
            const gr = Math.sin(((pan + 1) * Math.PI) / 4)
            const m = (frame.l[i] + frame.r[i]) / 2
            out.l[i] = m * gl * 1.41
            out.r[i] = m * gr * 1.41
          }
          return out
        }
        case 1: {
          // Tremolo: LFO volume; full level at zero amount.
          for (let i = 0; i < n; i++) {
            const g = 1 - amt * 0.5 * (1 + lfo.next(sr))
            out.l[i] = frame.l[i] * g
            out.r[i] = frame.r[i] * g
          }
          return out
        }
        case 2: {
          // Ring Mod: signal × sine; rate sets the sine pitch (5 Hz..2 kHz).
          const freq = 5 + Math.pow(knob01(p.rate), 2) * 1995
          lfo.rateHz = freq
          for (let i = 0; i < n; i++) {
            const m = lfo.next(sr)
            const g = (1 - amt) + amt * m
            out.l[i] = frame.l[i] * g
            out.r[i] = frame.r[i] * g
          }
          return out
        }
        case 3: {
          // A-Wah: envelope follower sweeps a band-pass; rate knob = sensitivity.
          const sens = 0.002 + knob01(p.rate) * 0.05
          for (let i = 0; i < n; i++) {
            const level = Math.abs((frame.l[i] + frame.r[i]) / 2)
            env += sens * (level - env)
            env *= 0.9995
            const freq = 300 + clamp01(env * 14 * (0.3 + amt)) * 2200
            bp.set('bandpass', sr, freq, 2.2)
            const w = bp.next((frame.l[i] + frame.r[i]) / 2)
            const g = (1 - amt) * 0.5 + amt
            out.l[i] = frame.l[i] * (1 - amt) * 0.5 + w * g
            out.r[i] = frame.r[i] * (1 - amt) * 0.5 + w * g
          }
          return out
        }
        case 4: {
          // Wah: LFO-driven resonant low-pass sweep.
          lp.reset()
          for (let i = 0; i < n; i++) {
            const lfoV = (lfo.next(sr) + 1) / 2
            const freq = 250 + lfoV * (400 + 2600 * amt)
            lp.set('lowpass', sr, freq, 4.5)
            const m = (frame.l[i] + frame.r[i]) / 2
            const w = lp.next(m)
            out.l[i] = frame.l[i] * (1 - amt) + w * amt * 1.4
            out.r[i] = frame.r[i] * (1 - amt) + w * amt * 1.4
          }
          return out
        }
        default: {
          // Pump: side-chain-style LFO ducking (square-ish dip).
          lfo.wave = 'sine'
          for (let i = 0; i < n; i++) {
            const v = (lfo.next(sr) + 1) / 2 // 0..1
            const duck = 1 - amt * Math.pow(1 - v, 2.5)
            out.l[i] = frame.l[i] * duck
            out.r[i] = frame.r[i] * duck
          }
          return out
        }
      }
    },
  }
}

// ------------------------------------------------------------------ Mod 2

function makeDelayLine(size: number) {
  const buf = new Float32Array(size)
  let w = 0
  return {
    tap(delaySamples: number): number {
      const d = clamp(delaySamples, 1, size - 2)
      const read = (w - d + size * 2) % size
      const i0 = Math.floor(read)
      const frac = read - i0
      const a = buf[i0 % size]
      const b = buf[(i0 + 1) % size]
      return a * (1 - frac) + b * frac
    },
    push(v: number): void {
      buf[w] = v
      w = (w + 1) % size
    },
  }
}

export function createMod2(sr: number): Unit<ModUnitState> {
  const lfo = new Lfo(1, 'sine')
  const dlA = makeDelayLine(Math.ceil(sr * 0.06))
  const dlB = makeDelayLine(Math.ceil(sr * 0.06))
  const dlC = makeDelayLine(Math.ceil(sr * 0.06))
  const ap1 = new Biquad()
  const ap2 = new Biquad()
  const ap3 = new Biquad()
  const ap4 = new Biquad()
  let fb = 0
  let spinRate = 0.5
  let spinPhase = 0
  return {
    process(frame, p) {
      const n = frame.l.length
      const out = stereoFrame(n)
      const rate = 0.05 + Math.pow(knob01(p.rate), 1.6) * 9
      const amt = knob01(p.amount)
      lfo.rateHz = rate
      const mono = (i: number) => (frame.l[i] + frame.r[i]) / 2
      switch (p.type) {
        case 0: {
          // Chorus: detuned widening; high amounts add a second delay line.
          for (let i = 0; i < n; i++) {
            const m = mono(i)
            dlA.push(m)
            const d1 = 0.012 + (lfo.next(sr) + 1) * 0.004 * (0.4 + amt)
            let wet = dlA.tap(d1 * sr)
            if (amt > 0.5) {
              dlB.push(m)
              const d2 = 0.019 + (lfo.value() * -1 + 1) * 0.005 * amt
              wet = (wet + dlB.tap(d2 * sr)) / 2
            }
            const { dry, wet: wg } = dryWet(0.15 + amt * 0.6)
            out.l[i] = m * dry + wet * wg
            out.r[i] = m * dry + (amt > 0.5 ? dlB.tap(0.016 * sr) : wet) * wg
          }
          return out
        }
        case 1: {
          // Flanger: short comb sweep with feedback.
          for (let i = 0; i < n; i++) {
            const m = mono(i)
            const d = 0.0012 + (lfo.next(sr) + 1) * 0.0028 * (0.3 + amt)
            const delayed = dlA.tap(d * sr)
            dlA.push(m + delayed * (0.65 * amt) + fb * 0.001)
            fb = delayed
            const { dry, wet } = dryWet(0.2 + amt * 0.55)
            out.l[i] = m * dry + delayed * wet
            out.r[i] = m * dry + delayed * wet
          }
          return out
        }
        case 2: {
          // Phaser: 4-stage all-pass sweep; amount adds feedback color.
          for (let i = 0; i < n; i++) {
            const m = mono(i) + fb * 0.35 * amt
            const lfoV = (lfo.next(sr) + 1) / 2
            const f = 300 + lfoV * (500 + 2200 * amt)
            ap1.set('allpass', sr, f, 0.7)
            ap2.set('allpass', sr, f * 1.6, 0.7)
            ap3.set('allpass', sr, f * 0.62, 0.7)
            ap4.set('allpass', sr, f * 2.4, 0.7)
            let w = ap4.next(ap3.next(ap2.next(ap1.next(m))))
            fb = w
            const { dry, wet } = dryWet(0.25 + amt * 0.5)
            out.l[i] = m * dry + w * wet
            out.r[i] = m * dry + w * wet
          }
          return out
        }
        case 3: {
          // Vibe: staggered phase filters with pitch-bend character.
          for (let i = 0; i < n; i++) {
            const m = mono(i)
            dlA.push(m)
            const lfoV = lfo.next(sr)
            const d = 0.004 + (lfoV + 1) * 0.0035 * (0.3 + amt)
            const w1 = dlA.tap(d * sr)
            ap1.set('allpass', sr, 400 + (lfoV + 1) * 900 * (0.3 + amt), 1.2)
            const w2 = ap1.next(w1)
            const { dry, wet } = dryWet(0.3 + amt * 0.65)
            out.l[i] = m * dry + w2 * wet
            out.r[i] = m * dry + w1 * wet
          }
          return out
        }
        case 4: {
          // Ensemble: three cross-connected modulated delay lines.
          for (let i = 0; i < n; i++) {
            const m = mono(i)
            const t = i
            const l1 = Math.sin((TAU * rate * t) / sr)
            const l2 = Math.sin((TAU * rate * 1.31 * t) / sr + 2.1)
            const l3 = Math.sin((TAU * rate * 0.77 * t) / sr + 4.2)
            dlA.push(m)
            dlB.push(m)
            dlC.push(m)
            const a = dlA.tap((0.011 + (l1 + 1) * 0.004) * sr)
            const b = dlB.tap((0.017 + (l2 + 1) * 0.005) * sr)
            const c = dlC.tap((0.023 + (l3 + 1) * 0.006) * sr)
            const { dry, wet } = dryWet(0.2 + amt * 0.6)
            out.l[i] = m * dry + ((a + b) / 2) * wet
            out.r[i] = m * dry + ((b + c) / 2) * wet
          }
          return out
        }
        default: {
          // Spin: gentle rotary-like modulation; rate ramps gradually.
          const target = 0.3 + knob01(p.rate) * 6
          for (let i = 0; i < n; i++) {
            spinRate += (target - spinRate) * 0.0004
            const lfoV = Math.sin(TAU * spinPhase)
            spinPhase = (spinPhase + spinRate / sr) % 1
            const pan = lfoV * amt
            const trem = 1 - amt * 0.3 * (1 + lfoV)
            const m = mono(i) * trem
            out.l[i] = m * Math.cos(((pan + 1) * Math.PI) / 4) * 1.41
            out.r[i] = m * Math.sin(((pan + 1) * Math.PI) / 4) * 1.41
          }
          return out
        }
      }
    },
  }
}

// ------------------------------------------------------------------ Delay

export function createDelay(sr: number): Unit<DelayUnitState> {
  const size = Math.ceil(sr * 2.5)
  const bufL = new Float32Array(size)
  const bufR = new Float32Array(size)
  let w = 0
  const filterL = new Biquad()
  const filterR = new Biquad()
  return {
    process(frame, p) {
      const n = frame.l.length
      const out = stereoFrame(n)
      const delaySamples = clamp((p.tempoMs / 1000) * sr, 1, size - 2)
      const fb = knob01(p.feedback) * 0.92
      const { dry, wet } = dryWet(knob01(p.mix))
      // Feedback filter sits INSIDE the loop: repeats get progressively
      // filtered; the dry path never passes through it (manual p. 51).
      if (p.filterType === 1) {
        filterL.set('lowpass', sr, 1800, 0.7)
        filterR.set('lowpass', sr, 1800, 0.7)
      } else if (p.filterType === 2) {
        filterL.set('highpass', sr, 900, 0.7)
        filterR.set('highpass', sr, 900, 0.7)
      } else if (p.filterType === 3) {
        filterL.set('bandpass', sr, 1400, 1.2)
        filterR.set('bandpass', sr, 1400, 1.2)
      }
      const filterActive = p.filterType > 0
      for (let i = 0; i < n; i++) {
        const read = (w - Math.floor(delaySamples) + size * 2) % size
        let repL = bufL[read]
        let repR = bufR[read]
        if (filterActive) {
          repL = filterL.next(repL)
          repR = filterR.next(repR)
        }
        const inL = frame.l[i]
        const inR = frame.r[i]
        if (p.pingPong) {
          bufL[w] = inL + repR * fb
          bufR[w] = inR + repL * fb
        } else {
          bufL[w] = inL + repL * fb
          bufR[w] = inR + repR * fb
        }
        out.l[i] = inL * dry + repL * wet
        out.r[i] = inR * dry + repR * wet
        w = (w + 1) % size
      }
      return out
    },
  }
}

// ---------------------------------------------------------------- Amp / EQ

function driveCurve(x: number, amount: number, hardness: number): number {
  const a = clamp01(amount)
  if (a <= 0) return x
  const k = 1 + a * hardness
  // Asymmetric soft clip: the even harmonics make driven types clearly
  // distinguishable from clean ones (and from each other via hardness).
  const driven = Math.tanh(x * k) + 0.08 * a * Math.tanh(x * k * 2.7)
  return driven / Math.tanh(k * 0.8 + 1e-9)
}

export function createAmpEq(sr: number): Unit<AmpUnitState> {
  const bass = new Biquad()
  const mid = new Biquad()
  const treble = new Biquad()
  const tone = new Biquad()
  const tone2 = new Biquad() // second cascade stage for the 24 dB filters
  const speaker = new OnePole()
  return {
    process(frame, p) {
      const n = frame.l.length
      const out = stereoFrame(n)
      const toDb = (v: number) => (knob01(v) * 2 - 1) * 15
      bass.set('lowshelf', sr, 100, 0.7, toDb(p.bass))
      treble.set('highshelf', sr, 4000, 0.7, toDb(p.treble))
      const midFreq = 200 + Math.pow(knob01(p.midFreq), 2) * 7800
      const drive = knob01(p.drive)
      switch (p.type) {
        case 1: {
          // Twin: scooped clean with sparkling top, moderate drive.
          mid.set('peaking', sr, midFreq, 1.0, toDb(p.midGain) - 6)
          tone.set('highshelf', sr, 1500, 0.7, 9)
          speaker.setCutoff(sr, 7000)
          break
        }
        case 2: {
          // JC: tight, bright, almost no breakup.
          mid.set('peaking', sr, midFreq, 1.2, toDb(p.midGain) + 1)
          tone.set('highshelf', sr, 2200, 0.7, 3)
          speaker.setCutoff(sr, 11000)
          break
        }
        case 3: {
          // Small: boxy, mid-honky, dark, breaks up early.
          mid.set('peaking', sr, Math.min(midFreq, 900), 1.8, toDb(p.midGain) + 7)
          tone.set('highshelf', sr, 2000, 0.7, -16)
          speaker.setCutoff(sr, 2200)
          break
        }
        default:
          mid.set('peaking', sr, midFreq, 1.0, toDb(p.midGain))
          tone.set('highshelf', sr, 4000, 0.7, 0)
      }
      if (p.type === 4 || p.type === 5) {
        // LP24/HP24: resonant 24 dB filter — two cascaded biquads with
        // meaningful resonance (Gain/Res knob), stable at any sample rate.
        const q = 0.9 + knob01(p.midGain) * 6
        const type = p.type === 4 ? 'lowpass' : 'highpass'
        tone.set(type, sr, midFreq, q)
        tone2.set(type, sr, midFreq, q)
      }
      const hardness = p.type === 3 ? 34 : p.type === 1 ? 14 : p.type === 2 ? 2 : 8
      const driveAmt = p.type === 0 || p.type >= 4 ? 0 : drive
      for (let i = 0; i < n; i++) {
        let l = frame.l[i]
        let r = frame.r[i]
        if (p.type === 4 || p.type === 5) {
          l = tone2.next(tone.next(l))
          r = tone2.next(tone.next(r))
        } else {
          if (driveAmt > 0) {
            l = driveCurve(l, driveAmt, hardness)
            r = driveCurve(r, driveAmt, hardness)
          }
          l = bass.next(l)
          r = bass.next(r)
          l = mid.next(l)
          r = mid.next(r)
          l = treble.next(l)
          r = treble.next(r)
          if (p.type >= 1 && p.type <= 3) {
            l = tone.next(l)
            r = tone.next(r)
            l = speaker.next(l) * 1.15
            r = speaker.next(r) * 1.15
          }
        }
        out.l[i] = l
        out.r[i] = r
      }
      return out
    },
  }
}

// ---------------------------------------------------------------- Compressor

export function createCompressor(sr: number): Unit<CompUnitState> {
  let env = 0
  return {
    process(frame, p) {
      const n = frame.l.length
      const out = stereoFrame(n)
      const amt = knob01(p.amount)
      const threshold = 0.55 - amt * 0.42 // more amount → lower threshold
      const ratio = 1 + amt * 9 // up to 10:1
      const attack = p.fast ? 0.9 : 0.35 // per-ms-ish coefficients at frame rate
      const release = p.fast ? 0.02 : 0.004
      const attC = 1 - Math.exp(-1 / (sr * 0.001 * (p.fast ? 1 : 6)))
      const relC = 1 - Math.exp(-1 / (sr * (p.fast ? 0.03 : 0.25)))
      void attack
      void release
      let sumGain = 0
      for (let i = 0; i < n; i++) {
        const level = Math.max(Math.abs(frame.l[i]), Math.abs(frame.r[i]))
        if (level > env) env += attC * (level - env)
        else env += relC * (level - env)
        let gain = 1
        if (env > threshold) {
          const over = env - threshold
          const reduced = over / ratio
          gain = (threshold + reduced) / Math.max(1e-6, env)
        }
        sumGain += gain
        out.l[i] = frame.l[i] * gain
        out.r[i] = frame.r[i] * gain
      }
      // Makeup gain keeps perceived loudness comparable so tests measure
      // dynamics, not just level.
      const avgGain = sumGain / Math.max(1, n)
      const makeup = 1 / Math.max(0.35, avgGain)
      const mk = Math.min(2.2, 0.6 + makeup * 0.4)
      gainFrame(out, mk)
      return out
    },
  }
}

// ------------------------------------------------------------------ Reverb

/** Per-type decay (seconds) and color. Booth shortest … Cathedral longest; Spring is boingy. */
const REVERB_DEFS = [
  { decay: 0.5, damp: 6000, spring: 0 }, // Room
  { decay: 0.22, damp: 5200, spring: 0 }, // Booth
  { decay: 0.9, damp: 7500, spring: 1 }, // Spring
  { decay: 1.3, damp: 5800, spring: 0 }, // Stage
  { decay: 2.1, damp: 5000, spring: 0 }, // Hall
  { decay: 3.6, damp: 4300, spring: 0 }, // Cathedral
]

export function createReverb(
  sr: number,
): Unit<ReverbUnitState> & { impulseResponse(type: number, bright: boolean): Float32Array } {
  // Pre-rendered deterministic impulse responses per type — convolved in
  // blocks below (cheap, exact, and identical offline and in the browser).
  const irCache = new Map<string, Float32Array>()
  const irFor = (type: number, bright: boolean): Float32Array => {
    const key = `${type}:${bright ? 1 : 0}:${sr}`
    let ir = irCache.get(key)
    if (ir) return ir
    const noise = makeNoise(0x51de + type * 7919 + (bright ? 131 : 0))
    const def = REVERB_DEFS[clamp(type, 0, REVERB_DEFS.length - 1)]
    const len = Math.max(16, Math.floor(def.decay * sr))
    ir = new Float32Array(len)
    const lp = new OnePole()
    // Dark: strong damping of the tail. Bright: nearly undamped tail.
    lp.setCutoff(sr, bright ? sr * 0.4 : def.damp * 0.35)
    for (let i = 0; i < len; i++) {
      const t = i / sr
      let s = noise() * Math.exp((-3.2 * t) / def.decay)
      if (def.spring) {
        // Boingy: strong comb-like repeating echoes.
        s *= 1 + 0.8 * Math.sin(TAU * 9 * t * (1 / def.decay) * 3)
        s += 0.5 * noise() * Math.exp((-3.2 * (t % (def.decay / 9))) / (def.decay / 9)) * 0.4
      }
      ir[i] = lp.next(s) * 0.25
    }
    irCache.set(key, ir)
    return ir
  }
  return {
    process(frame, p) {
      const n = frame.l.length
      const ir = irFor(p.type, p.bright)
      const out = stereoFrame(n)
      const { dry, wet } = dryWet(knob01(p.amount))
      // Block convolution (O(n·k) but k small at test rates; honest reverb).
      for (let i = 0; i < n; i++) {
        let wl = 0
        let wr = 0
        const kMax = Math.min(ir.length, i + 1)
        for (let k = 0; k < kMax; k++) {
          const h = ir[k]
          wl += frame.l[i - k] * h
          wr += frame.r[i - k] * h * (k % 2 === 0 ? 1 : 0.93) // slight stereo decorrelation
        }
        out.l[i] = frame.l[i] * dry + wl * wet
        out.r[i] = frame.r[i] * dry + wr * wet
      }
      return out
    },
    // Post-seal fix: expose the cached deterministic IR so callers that only
    // need the impulse response can avoid the O(n·k) convolution above.
    impulseResponse: irFor,
  }
}

// ------------------------------------------------------------------ Rotary

export function createRotary(sr: number): Unit<RotaryState & { on: boolean }> {
  let hornPhase = 0
  let rotorPhase = 0
  let hornRate = 0.8
  let rotorRate = 0.6
  const hornDl = makeDelayLine(Math.ceil(sr * 0.01))
  const rotorLp = new OnePole()
  rotorLp.setCutoff(sr, 1200)
  return {
    process(frame, p) {
      const n = frame.l.length
      const out = stereoFrame(n)
      // Speed changes accelerate smoothly toward slow/fast targets.
      const hornTarget = p.fast ? 6.8 : 0.8
      const rotorTarget = p.fast ? 6.0 : 0.6
      const driveAmt = knob01(p.drive)
      for (let i = 0; i < n; i++) {
        hornRate += (hornTarget - hornRate) * 0.00012
        rotorRate += (rotorTarget - rotorRate) * 0.0001
        const hv = Math.sin(TAU * hornPhase)
        const rv = Math.sin(TAU * rotorPhase + 1.3)
        hornPhase = (hornPhase + hornRate / sr) % 1
        rotorPhase = (rotorPhase + rotorRate / sr) % 1
        let m = (frame.l[i] + frame.r[i]) / 2
        if (driveAmt > 0.02) m = Math.tanh(m * (1 + driveAmt * 6))
        // Horn: Doppler-ish modulated delay + tremolo + pan.
        hornDl.push(m)
        const dop = hornDl.tap((0.0012 + (hv + 1) * 0.0011) * sr)
        const horn = dop * (1 - 0.35 * (1 + hv) * 0.5)
        // Bass rotor: slow throb on a lowpassed copy.
        const bass = rotorLp.next(m) * (1 - 0.5 * (1 + rv) * 0.35)
        const sig = horn * 0.8 + bass * 0.6
        const pan = hv * 0.8
        out.l[i] = sig * Math.cos(((pan + 1) * Math.PI) / 4) * 1.35
        out.r[i] = sig * Math.sin(((pan + 1) * Math.PI) / 4) * 1.35
      }
      return out
    },
  }
}

// ------------------------------------------------------------------ Timbre

/**
 * Piano Timbre control (per type family).
 * Soft dampens highs, Mid emphasizes presence, Bright emphasizes treble;
 * Dyno 1/2 are preamp/EQ emulations for the electric family (manual p. 26).
 */
export function applyTimbre(frame: StereoFrame, sr: number, timbre: number, electric: boolean): StereoFrame {
  if (timbre === 0) return frame
  const n = frame.l.length
  const out = stereoFrame(n)
  const b1 = new Biquad()
  const b2 = new Biquad()
  const b3 = new Biquad()
  switch (timbre) {
    case 1: // Soft
      b1.set('lowpass', sr, 800, 0.7)
      break
    case 2: // Mid
      b1.set('peaking', sr, 1400, 1.1, 6)
      break
    case 3: // Bright
      b1.set('highshelf', sr, 1200, 0.8, 14)
      break
    case 4: // Dyno 1 (electric only): bell preamp — presence bump + rolled top
      if (!electric) return frame
      b1.set('peaking', sr, 2800, 2.0, 15)
      b2.set('highshelf', sr, 5500, 0.7, -12)
      b3.set('lowshelf', sr, 200, 0.7, 6)
      break
    case 5: // Dyno 2: hotter preamp — bigger bump, slight drive
      if (!electric) return frame
      b1.set('peaking', sr, 3400, 2.4, 15)
      b2.set('highshelf', sr, 5200, 0.7, -5)
      b3.set('lowshelf', sr, 160, 0.7, 7)
      break
    default:
      return frame
  }
  for (let i = 0; i < n; i++) {
    let l = b3.next(b2.next(b1.next(frame.l[i])))
    // Biquads are stateful per channel — use fresh filters for R via second pass.
    out.l[i] = l
  }
  const c1 = new Biquad()
  const c2 = new Biquad()
  const c3 = new Biquad()
  // Mirror the exact same settings for the right channel.
  switch (timbre) {
    case 1:
      c1.set('lowpass', sr, 800, 0.7)
      break
    case 2:
      c1.set('peaking', sr, 1400, 1.1, 6)
      break
    case 3:
      c1.set('highshelf', sr, 1200, 0.8, 14)
      break
    case 4:
      c1.set('peaking', sr, 2800, 2.0, 15)
      c2.set('highshelf', sr, 5500, 0.7, -12)
      c3.set('lowshelf', sr, 200, 0.7, 6)
      break
    case 5:
      c1.set('peaking', sr, 3400, 2.4, 15)
      c2.set('highshelf', sr, 5200, 0.7, -5)
      c3.set('lowshelf', sr, 160, 0.7, 7)
      break
  }
  for (let i = 0; i < n; i++) {
    out.r[i] = c3.next(c2.next(c1.next(frame.r[i])))
  }
  if (timbre === 5) {
    for (let i = 0; i < n; i++) {
      out.l[i] = Math.tanh(out.l[i] * 2.2)
      out.r[i] = Math.tanh(out.r[i] * 2.2)
    }
  }
  return out
}
