import type {
  AudioBufferLike,
  AudioContextLike,
  AudioNodeLike,
  BiquadFilterNodeLike,
  ConvolverNodeLike,
  DelayNodeLike,
  DynamicsCompressorNodeLike,
  GainNodeLike,
  OscillatorNodeLike,
  WaveShaperNodeLike,
} from './boundaries'
import {
  bpmToDelaySeconds,
  type AmpEqState,
  type CompressorState,
  type DelayState,
  type Mod1State,
  type Mod2State,
  type ReverbState,
  type ReverbType,
  type RotaryState,
} from '../model/instrumentState'
import {
  masterClockSubdivisionHz,
  masterClockSubdivisionSeconds,
  type MasterClockState,
} from '../model/organSynthTypes'

const RAMP_TC = 0.012 // 12 ms smooth anti-click time constant

function rampParam(
  param: {
    setValueAtTime(v: number, t: number): unknown
    setTargetAtTime(v: number, t: number, tc: number): unknown
  },
  target: number,
  now: number,
  tc = RAMP_TC,
  immediate = false,
): void {
  if (immediate) {
    param.setValueAtTime(target, now)
  } else {
    param.setTargetAtTime(target, now, tc)
  }
}

function safeFreq(ctx: AudioContextLike, hz: number): number {
  const nyquistSafe = Math.max(2000, (ctx.sampleRate || 44100) * 0.44)
  return Math.max(25, Math.min(nyquistSafe, hz))
}

export function makeTubeCurve(drive01: number, asymmetry: number): Float32Array {
  const n = 512
  const curve = new Float32Array(n)
  const k = 1 + drive01 * 18
  const offset = asymmetry * drive01 * 0.1
  const zeroOut = Math.tanh(offset * k) / Math.tanh(k)
  const maxNorm = Math.max(1e-6, 1 - Math.abs(zeroOut))
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    const raw = Math.tanh((x + offset) * k) / Math.tanh(k)
    curve[i] = Math.max(-1, Math.min(1, (raw - zeroOut) / maxNorm))
  }
  return curve
}

export function makeBrickwallCurve(): Float32Array {
  const n = 1024
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.tanh(x * 1.45) * 0.96
  }
  return curve
}

function makeAbsRectifierCurve(): Float32Array {
  const n = 256
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.abs(x)
  }
  return curve
}
// Deterministic PRNG for reproducible stereo Reverb IRs
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const irCache = new WeakMap<AudioContextLike, Map<ReverbType, AudioBufferLike>>()

export function getOrCreateReverbIR(
  ctx: AudioContextLike,
  type: ReverbType,
): AudioBufferLike | null {
  if (!ctx.createBuffer) return null
  let map = irCache.get(ctx)
  if (!map) {
    map = new Map()
    irCache.set(ctx, map)
  }
  const existing = map.get(type)
  if (existing) return existing

  const sr = ctx.sampleRate || 44100
  const params: Record<
    ReverbType,
    { durSec: number; decayPow: number; preDelayMs: number; hfDamp: number; seed: number; spring?: boolean }
  > = {
    Booth: { durSec: 0.28, decayPow: 3.4, preDelayMs: 3, hfDamp: 0.35, seed: 101 },
    Room: { durSec: 0.78, decayPow: 2.8, preDelayMs: 9, hfDamp: 0.42, seed: 202 },
    Spring: { durSec: 1.35, decayPow: 2.3, preDelayMs: 6, hfDamp: 0.25, seed: 303, spring: true },
    Stage: { durSec: 1.65, decayPow: 2.5, preDelayMs: 18, hfDamp: 0.48, seed: 404 },
    Hall: { durSec: 2.65, decayPow: 2.4, preDelayMs: 26, hfDamp: 0.56, seed: 505 },
    Cathedral: { durSec: 4.3, decayPow: 2.1, preDelayMs: 38, hfDamp: 0.62, seed: 606 },
  }
  const cfg = params[type]
  const length = Math.max(256, Math.floor(sr * cfg.durSec))
  const buffer = ctx.createBuffer(2, length, sr)
  const rand = mulberry32(cfg.seed)
  const preSamples = Math.floor((cfg.preDelayMs / 1000) * sr)

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData?.(ch)
    if (!data) continue
    let lpState = 0
    const alpha = 1 - cfg.hfDamp * 0.75
    for (let i = 0; i < length; i++) {
      if (i < preSamples) {
        data[i] = 0
        continue
      }
      const t = (i - preSamples) / Math.max(1, length - preSamples)
      const env = Math.pow(1 - t, cfg.decayPow)
      let sample = (rand() * 2 - 1) * env

      if (cfg.spring) {
        // Metallic dispersive spring flutter/chirp characteristic
        const chirp = Math.sin(2 * Math.PI * (340 + 480 * Math.exp(-t * 5)) * (i / sr) + ch * 0.9)
        const flutter = 0.65 + 0.35 * Math.sin(2 * Math.PI * 19 * (i / sr))
        sample = (sample * 0.58 + chirp * env * 0.42) * flutter
      }

      // Simple one-pole lowpass darkening over tail
      const dampCoeff = Math.max(0.08, alpha * (1 - t * 0.6))
      lpState = lpState + dampCoeff * (sample - lpState)
      data[i] = lpState * 0.65
    }

    // Add distinct early reflections for Room/Stage/Hall/Cathedral
    if (!cfg.spring) {
      const erTimesMs = [12, 23, 37, 53, 71]
      for (let e = 0; e < erTimesMs.length; e++) {
        const idx = Math.floor(((cfg.preDelayMs + erTimesMs[e] + ch * 3) / 1000) * sr)
        if (idx < length) {
          data[idx] += (e % 2 === 0 ? 1 : -1) * (0.28 / (e + 1))
        }
      }
    }
  }

  map.set(type, buffer)
  return buffer
}

export interface DspUnit {
  readonly input: GainNodeLike
  readonly output: GainNodeLike
  dispose(): void
}

function supportsFullDsp(ctx: AudioContextLike): boolean {
  return Boolean(
    ctx.createStereoPanner &&
      ctx.createDelay &&
      ctx.createWaveShaper &&
      ctx.createConvolver &&
      ctx.createChannelSplitter &&
      ctx.createChannelMerger,
  )
}

function shouldStartLfosImmediately(ctx: AudioContextLike): boolean {
  // OfflineAudioContext has no .close() and must start LFOs before startRendering().
  // Live browser AudioContext starts suspended prior to user gesture; starting LFOs early triggers autoplay warnings.
  return ctx.state === 'running' || typeof ctx.close !== 'function'
}

// =========================================================================
// 1. MOD 1 UNIT (A-Pan, Tremolo, Ring Mod, A-Wah, Wah, Pump)
// =========================================================================

export class Mod1Unit implements DspUnit {
  readonly input: GainNodeLike
  readonly output: GainNodeLike
  private readonly ctx: AudioContextLike
  private readonly nodes: AudioNodeLike[] = []
  private readonly oscillators: OscillatorNodeLike[] = []
  private lfosStarted = false

  private readonly bypassGain: GainNodeLike
  private readonly activeGain: GainNodeLike
  private readonly fullDsp: boolean

  // Branch gains for click-free type switching
  private readonly apanBranch?: GainNodeLike
  private readonly tremBranch?: GainNodeLike
  private readonly rmBranch?: GainNodeLike
  private readonly awahBranch?: GainNodeLike
  private readonly wahBranch?: GainNodeLike
  private readonly pumpBranch?: GainNodeLike

  // Modulation controls
  private readonly apanLfo?: OscillatorNodeLike
  private readonly apanDepth?: GainNodeLike
  private readonly tremLfo?: OscillatorNodeLike
  private readonly tremDepth?: GainNodeLike
  private readonly tremCarrier?: GainNodeLike
  private readonly rmOsc?: OscillatorNodeLike
  private readonly rmDry?: GainNodeLike
  private readonly rmWet?: GainNodeLike
  private readonly awahSens?: GainNodeLike
  private readonly awahFilter?: BiquadFilterNodeLike
  private readonly wahLfo?: OscillatorNodeLike
  private readonly wahDepth?: GainNodeLike
  private readonly wahFilter?: BiquadFilterNodeLike
  private readonly pumpLfo?: OscillatorNodeLike
  private readonly pumpDepth?: GainNodeLike
  private readonly pumpCarrier?: GainNodeLike

  constructor(ctx: AudioContextLike) {
    this.ctx = ctx
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.bypassGain = ctx.createGain()
    this.activeGain = ctx.createGain()
    this.bypassGain.gain.value = 1
    this.activeGain.gain.value = 0
    this.nodes.push(this.input, this.output, this.bypassGain, this.activeGain)

    this.input.connect(this.bypassGain)
    this.bypassGain.connect(this.output)
    this.activeGain.connect(this.output)

    this.fullDsp = supportsFullDsp(ctx)
    if (!this.fullDsp) {
      this.input.connect(this.activeGain)
      return
    }

    const now = ctx.currentTime

    // 1. A-Pan: LFO -> StereoPanner
    const apanPanner = ctx.createStereoPanner!()
    const apanBranch = ctx.createGain()
    const apanLfo = ctx.createOscillator()
    const apanDepth = ctx.createGain()
    apanLfo.type = 'sine'
    apanLfo.frequency.setValueAtTime(2.0, now)
    apanDepth.gain.setValueAtTime(0.7, now)
    apanLfo.connect(apanDepth)
    apanDepth.connect(apanPanner.pan)
    this.input.connect(apanPanner)
    apanPanner.connect(apanBranch)
    apanBranch.connect(this.activeGain)
    apanBranch.gain.value = 0
    this.apanBranch = apanBranch
    this.apanLfo = apanLfo
    this.apanDepth = apanDepth
    this.nodes.push(apanPanner, apanBranch, apanLfo, apanDepth)
    this.oscillators.push(apanLfo)

    // 2. Tremolo: LFO -> Gain
    const tremCarrier = ctx.createGain()
    const tremBranch = ctx.createGain()
    const tremLfo = ctx.createOscillator()
    const tremDepth = ctx.createGain()
    tremCarrier.gain.setValueAtTime(1.0, now)
    tremLfo.type = 'sine'
    tremLfo.frequency.setValueAtTime(4.5, now)
    tremDepth.gain.setValueAtTime(0.0, now)
    tremLfo.connect(tremDepth)
    tremDepth.connect(tremCarrier.gain)
    this.input.connect(tremCarrier)
    tremCarrier.connect(tremBranch)
    tremBranch.connect(this.activeGain)
    tremBranch.gain.value = 0
    this.tremBranch = tremBranch
    this.tremCarrier = tremCarrier
    this.tremLfo = tremLfo
    this.tremDepth = tremDepth
    this.nodes.push(tremCarrier, tremBranch, tremLfo, tremDepth)
    this.oscillators.push(tremLfo)

    // 3. Ring Mod: audio-rate sine carrier * signal + dry blend
    const rmMult = ctx.createGain()
    rmMult.gain.setValueAtTime(0, now)
    const rmOsc = ctx.createOscillator()
    rmOsc.type = 'sine'
    rmOsc.frequency.setValueAtTime(220, now)
    rmOsc.connect(rmMult.gain)
    const rmWet = ctx.createGain()
    const rmDry = ctx.createGain()
    const rmBranch = ctx.createGain()
    this.input.connect(rmMult)
    rmMult.connect(rmWet)
    this.input.connect(rmDry)
    rmWet.connect(rmBranch)
    rmDry.connect(rmBranch)
    rmBranch.connect(this.activeGain)
    rmBranch.gain.value = 0
    this.rmBranch = rmBranch
    this.rmOsc = rmOsc
    this.rmDry = rmDry
    this.rmWet = rmWet
    this.nodes.push(rmMult, rmOsc, rmWet, rmDry, rmBranch)
    this.oscillators.push(rmOsc)

    // 4. A-Wah: envelope-follower bandpass filter
    const awahRect = ctx.createWaveShaper!()
    awahRect.curve = makeAbsRectifierCurve()
    const awahSmooth = ctx.createBiquadFilter()
    awahSmooth.type = 'lowpass'
    awahSmooth.frequency.setValueAtTime(16, now)
    // Overdamped Q <= 0.45 guarantees non-negative impulse response (zero negative frequency undershoot)
    awahSmooth.Q.setValueAtTime(0.45, now)
    const awahSens = ctx.createGain()
    awahSens.gain.setValueAtTime(0, now)
    const awahFilter = ctx.createBiquadFilter()
    awahFilter.type = 'bandpass'
    awahFilter.frequency.setValueAtTime(420, now)
    awahFilter.Q.setValueAtTime(3.6, now)
    const awahBoost = ctx.createGain()
    awahBoost.gain.setValueAtTime(2.0, now)
    const awahBranch = ctx.createGain()
    this.input.connect(awahRect)
    awahRect.connect(awahSmooth)
    awahSmooth.connect(awahSens)
    awahSens.connect(awahFilter.frequency)
    this.input.connect(awahFilter)
    awahFilter.connect(awahBoost)
    awahBoost.connect(awahBranch)
    awahBranch.connect(this.activeGain)
    awahBranch.gain.value = 0
    this.awahBranch = awahBranch
    this.awahSens = awahSens
    this.awahFilter = awahFilter
    this.nodes.push(awahRect, awahSmooth, awahSens, awahFilter, awahBoost, awahBranch)

    // 5. Wah: LFO-swept resonant lowpass filter
    const wahFilter = ctx.createBiquadFilter()
    wahFilter.type = 'lowpass'
    wahFilter.frequency.setValueAtTime(1100, now)
    wahFilter.Q.setValueAtTime(6.0, now)
    const wahLfo = ctx.createOscillator()
    wahLfo.type = 'sine'
    wahLfo.frequency.setValueAtTime(1.8, now)
    const wahDepth = ctx.createGain()
    wahDepth.gain.setValueAtTime(850, now)
    const wahBranch = ctx.createGain()
    wahLfo.connect(wahDepth)
    wahDepth.connect(wahFilter.frequency)
    this.input.connect(wahFilter)
    wahFilter.connect(wahBranch)
    wahBranch.connect(this.activeGain)
    wahBranch.gain.value = 0
    this.wahBranch = wahBranch
    this.wahLfo = wahLfo
    this.wahDepth = wahDepth
    this.wahFilter = wahFilter
    this.nodes.push(wahFilter, wahLfo, wahDepth, wahBranch)
    this.oscillators.push(wahLfo)

    // 6. Pump: Side-chain sawtooth ducking
    const pumpCarrier = ctx.createGain()
    pumpCarrier.gain.setValueAtTime(0.65, now)
    const pumpLfo = ctx.createOscillator()
    pumpLfo.type = 'sawtooth'
    pumpLfo.frequency.setValueAtTime(2.0, now)
    const pumpDepth = ctx.createGain()
    pumpDepth.gain.setValueAtTime(0.35, now)
    const pumpBranch = ctx.createGain()
    pumpLfo.connect(pumpDepth)
    pumpDepth.connect(pumpCarrier.gain)
    this.input.connect(pumpCarrier)
    pumpCarrier.connect(pumpBranch)
    pumpBranch.connect(this.activeGain)
    pumpBranch.gain.value = 0
    this.pumpBranch = pumpBranch
    this.pumpLfo = pumpLfo
    this.pumpDepth = pumpDepth
    this.pumpCarrier = pumpCarrier
    this.nodes.push(pumpCarrier, pumpLfo, pumpDepth, pumpBranch)
    this.oscillators.push(pumpLfo)
    if (shouldStartLfosImmediately(ctx)) {
      this.ensureLfosStarted()
    }
  }

  apply(state: Mod1State, immediate = false, masterClock?: MasterClockState): void {
    const now = this.ctx.currentTime
    const on = state.on
    const set = (p: Parameters<typeof rampParam>[0], v: number, tc = RAMP_TC) =>
      rampParam(p, v, now, tc, immediate)
    set(this.bypassGain.gain, on ? 0 : 1)
    set(this.activeGain.gain, on ? 1 : 0)

    if (!this.fullDsp) return

    const r = Math.max(0, Math.min(100, state.rate)) / 100
    const a = Math.max(0, Math.min(100, state.amount)) / 100
    const syncedHz =
      state.clockSync && masterClock
        ? masterClockSubdivisionHz(masterClock.bpm, state.rate)
        : null

    set(this.apanBranch!.gain, state.type === 'A-Pan' ? 1 : 0)
    set(this.tremBranch!.gain, state.type === 'Tremolo' ? 1 : 0)
    set(this.rmBranch!.gain, state.type === 'Ring Mod' ? 1 : 0)
    set(this.awahBranch!.gain, state.type === 'A-Wah' ? 1 : 0)
    set(this.wahBranch!.gain, state.type === 'Wah' ? 1 : 0)
    set(this.pumpBranch!.gain, state.type === 'Pump' ? 1 : 0)

    // A-Pan
    set(this.apanLfo!.frequency, syncedHz ?? 0.3 + r * 7.5)
    set(this.apanDepth!.gain, a * 0.95)

    // Tremolo: full level (1.0) at amount = 0
    set(this.tremLfo!.frequency, syncedHz ?? 0.8 + r * 10.5)
    const tremHalf = a * 0.46
    set(this.tremCarrier!.gain, 1 - tremHalf)
    set(this.tremDepth!.gain, tremHalf)

    // Ring Mod: audio-rate sine frequency from Rate knob (45 Hz .. 1100 Hz)
    const rmFreq = 45 * Math.pow(24, r)
    set(this.rmOsc!.frequency, rmFreq)
    set(this.rmDry!.gain, 1 - a)
    set(this.rmWet!.gain, a * 1.15)

    // A-Wah: sensitivity from Rate, resonance/depth from Amount (muted when inactive)
    const awahActive = on && state.type === 'A-Wah'
    set(this.awahSens!.gain, awahActive ? (450 + r * 3600) * (0.25 + a * 0.85) : 0)
    set(this.awahFilter!.Q, 2.0 + a * 4.5)

    // Wah: LFO-driven resonant lowpass sweep (always strictly > 250 Hz, muted when inactive)
    const wahActive = on && state.type === 'Wah'
    set(this.wahLfo!.frequency, syncedHz ?? 0.4 + r * 5.6)
    set(this.wahFilter!.frequency, safeFreq(this.ctx, 1150 + a * 450))
    set(this.wahDepth!.gain, wahActive ? a * 820 : 0)
    set(this.wahFilter!.Q, 1.5 + a * 6.5)
    set(this.pumpLfo!.frequency, syncedHz ?? 0.8 + r * 3.8)
    const pumpHalf = a * 0.45
    set(this.pumpCarrier!.gain, 1 - pumpHalf)
    set(this.pumpDepth!.gain, pumpHalf)
  }

  ensureLfosStarted(): void {
    if (this.lfosStarted) return
    this.lfosStarted = true
    const now = this.ctx.currentTime
    for (const osc of this.oscillators) {
      try {
        osc.start(now)
      } catch {
        // already started
      }
    }
  }

  dispose(): void {
    if (this.lfosStarted) {
      for (const osc of this.oscillators) {
        try {
          osc.stop()
        } catch {
          // already stopped
        }
      }
    }
    for (const node of this.nodes) {
      try {
        node.disconnect()
      } catch {
        // already disconnected
      }
    }
  }
}

// =========================================================================
// 2. MOD 2 UNIT (Chorus, Flanger, Phaser, Vibe, Ensemble, Spin)
// =========================================================================

export class Mod2Unit implements DspUnit {
  readonly input: GainNodeLike
  readonly output: GainNodeLike
  private readonly ctx: AudioContextLike
  private readonly nodes: AudioNodeLike[] = []
  private readonly oscillators: OscillatorNodeLike[] = []
  private lfosStarted = false
  private readonly bypassGain: GainNodeLike
  private readonly activeGain: GainNodeLike
  private readonly fullDsp: boolean

  private readonly chorBranch?: GainNodeLike
  private readonly flangBranch?: GainNodeLike
  private readonly phasBranch?: GainNodeLike
  private readonly vibeBranch?: GainNodeLike
  private readonly ensBranch?: GainNodeLike
  private readonly spinBranch?: GainNodeLike

  // Chorus
  private readonly chorLfo?: OscillatorNodeLike
  private readonly chorDepth1?: GainNodeLike
  private readonly chorDepth2?: GainNodeLike
  private readonly chorWet1?: GainNodeLike
  private readonly chorWet2?: GainNodeLike

  // Flanger
  private readonly flangLfo?: OscillatorNodeLike
  private readonly flangDepth?: GainNodeLike
  private readonly flangFb?: GainNodeLike
  private readonly flangWet?: GainNodeLike

  // Phaser
  private readonly phasLfo?: OscillatorNodeLike
  private readonly phasDepth?: GainNodeLike
  private readonly phasFb?: GainNodeLike
  private readonly phasWet?: GainNodeLike

  // Vibe
  private readonly vibeLfo?: OscillatorNodeLike
  private readonly vibeFilterDepth?: GainNodeLike
  private readonly vibeDelayDepth?: GainNodeLike
  private readonly vibeWet?: GainNodeLike

  // Ensemble
  private readonly ensSlowLfo?: OscillatorNodeLike
  private readonly ensFastLfo?: OscillatorNodeLike
  private readonly ensDepth?: GainNodeLike
  private readonly ensWet?: GainNodeLike

  // Spin (gentle rotary-like modulation with gradual rate ramp)
  private readonly spinLfo?: OscillatorNodeLike
  private readonly spinPanDepth?: GainNodeLike
  private readonly spinAmpDepth?: GainNodeLike
  private readonly spinAmpCarrier?: GainNodeLike

  constructor(ctx: AudioContextLike) {
    this.ctx = ctx
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.bypassGain = ctx.createGain()
    this.activeGain = ctx.createGain()
    this.bypassGain.gain.value = 1
    this.activeGain.gain.value = 0
    this.nodes.push(this.input, this.output, this.bypassGain, this.activeGain)

    this.input.connect(this.bypassGain)
    this.bypassGain.connect(this.output)
    this.activeGain.connect(this.output)

    this.fullDsp = supportsFullDsp(ctx)
    if (!this.fullDsp) {
      this.input.connect(this.activeGain)
      return
    }

    const now = ctx.currentTime

    // 1. Chorus (dual delay lines; 2nd line fades in at higher amounts)
    const chorBranch = ctx.createGain()
    const chorDry = ctx.createGain()
    chorDry.gain.setValueAtTime(0.85, now)
    const chorDelay1 = ctx.createDelay!(0.08)
    chorDelay1.delayTime.setValueAtTime(0.014, now)
    const chorDelay2 = ctx.createDelay!(0.08)
    chorDelay2.delayTime.setValueAtTime(0.023, now)
    const chorPan1 = ctx.createStereoPanner!()
    chorPan1.pan.setValueAtTime(-0.65, now)
    const chorPan2 = ctx.createStereoPanner!()
    chorPan2.pan.setValueAtTime(0.65, now)
    const chorWet1 = ctx.createGain()
    const chorWet2 = ctx.createGain()
    const chorLfo = ctx.createOscillator()
    chorLfo.type = 'sine'
    chorLfo.frequency.setValueAtTime(1.1, now)
    const chorDepth1 = ctx.createGain()
    const chorDepth2 = ctx.createGain()
    chorDepth1.gain.setValueAtTime(0.0025, now)
    chorDepth2.gain.setValueAtTime(-0.0032, now)
    chorLfo.connect(chorDepth1)
    chorDepth1.connect(chorDelay1.delayTime)
    chorLfo.connect(chorDepth2)
    chorDepth2.connect(chorDelay2.delayTime)
    this.input.connect(chorDry)
    chorDry.connect(chorBranch)
    this.input.connect(chorDelay1)
    chorDelay1.connect(chorPan1)
    chorPan1.connect(chorWet1)
    chorWet1.connect(chorBranch)
    this.input.connect(chorDelay2)
    chorDelay2.connect(chorPan2)
    chorPan2.connect(chorWet2)
    chorWet2.connect(chorBranch)
    chorBranch.connect(this.activeGain)
    chorBranch.gain.value = 0
    this.chorBranch = chorBranch
    this.chorLfo = chorLfo
    this.chorDepth1 = chorDepth1
    this.chorDepth2 = chorDepth2
    this.chorWet1 = chorWet1
    this.chorWet2 = chorWet2
    this.nodes.push(
      chorBranch,
      chorDry,
      chorDelay1,
      chorDelay2,
      chorPan1,
      chorPan2,
      chorWet1,
      chorWet2,
      chorLfo,
      chorDepth1,
      chorDepth2,
    )
    this.oscillators.push(chorLfo)

    // 2. Flanger (short modulated comb delay + quantum-safe feedback delay)
    const quantumSafeDelay = Math.max(0.007, 132 / (ctx.sampleRate || 44100))
    const flangBranch = ctx.createGain()
    const flangDry = ctx.createGain()
    flangDry.gain.setValueAtTime(0.8, now)
    const flangIn = ctx.createGain()
    const flangDelay = ctx.createDelay!(0.05)
    flangDelay.delayTime.setValueAtTime(0.0032, now)
    const flangFbDelay = ctx.createDelay!(0.05)
    flangFbDelay.delayTime.setValueAtTime(quantumSafeDelay, now)
    const flangFb = ctx.createGain()
    flangFb.gain.setValueAtTime(0.45, now)
    const flangWet = ctx.createGain()
    const flangLfo = ctx.createOscillator()
    flangLfo.type = 'triangle'
    flangLfo.frequency.setValueAtTime(0.45, now)
    const flangDepth = ctx.createGain()
    flangDepth.gain.setValueAtTime(0.0016, now)
    flangLfo.connect(flangDepth)
    flangDepth.connect(flangDelay.delayTime)
    this.input.connect(flangDry)
    flangDry.connect(flangBranch)
    this.input.connect(flangIn)
    flangIn.connect(flangDelay)
    flangDelay.connect(flangFbDelay)
    flangFbDelay.connect(flangFb)
    flangFb.connect(flangIn)
    flangDelay.connect(flangWet)
    flangWet.connect(flangBranch)
    flangBranch.connect(this.activeGain)
    flangBranch.gain.value = 0
    this.flangBranch = flangBranch
    this.flangLfo = flangLfo
    this.flangDepth = flangDepth
    this.flangFb = flangFb
    this.flangWet = flangWet
    this.nodes.push(
      flangBranch,
      flangDry,
      flangIn,
      flangDelay,
      flangFbDelay,
      flangFb,
      flangWet,
      flangLfo,
      flangDepth,
    )
    this.oscillators.push(flangLfo)

    // 3. Phaser (4 cascaded allpass stages + W3C-compliant quantum-safe feedback delay)
    const phasBranch = ctx.createGain()
    const phasDry = ctx.createGain()
    phasDry.gain.setValueAtTime(0.75, now)
    const phasIn = ctx.createGain()
    const ap1 = ctx.createBiquadFilter()
    const ap2 = ctx.createBiquadFilter()
    const ap3 = ctx.createBiquadFilter()
    const ap4 = ctx.createBiquadFilter()
    for (const ap of [ap1, ap2, ap3, ap4]) {
      ap.type = 'allpass'
      ap.frequency.setValueAtTime(950, now)
      ap.Q.setValueAtTime(1.8, now)
    }
    const phasFbDelay = ctx.createDelay!(0.05)
    phasFbDelay.delayTime.setValueAtTime(quantumSafeDelay, now)
    const phasFb = ctx.createGain()
    phasFb.gain.setValueAtTime(0.4, now)
    const phasWet = ctx.createGain()
    const phasLfo = ctx.createOscillator()
    phasLfo.type = 'sine'
    phasLfo.frequency.setValueAtTime(0.65, now)
    const phasDepth = ctx.createGain()
    phasDepth.gain.setValueAtTime(450, now)
    phasLfo.connect(phasDepth)
    phasDepth.connect(ap1.frequency)
    phasDepth.connect(ap2.frequency)
    phasDepth.connect(ap3.frequency)
    phasDepth.connect(ap4.frequency)
    this.input.connect(phasDry)
    phasDry.connect(phasBranch)
    this.input.connect(phasIn)
    phasIn.connect(ap1)
    ap1.connect(ap2)
    ap2.connect(ap3)
    ap3.connect(ap4)
    ap4.connect(phasFbDelay)
    phasFbDelay.connect(phasFb)
    phasFb.connect(phasIn)
    ap4.connect(phasWet)
    phasWet.connect(phasBranch)
    phasBranch.connect(this.activeGain)
    phasBranch.gain.value = 0
    this.phasBranch = phasBranch
    this.phasLfo = phasLfo
    this.phasDepth = phasDepth
    this.phasFb = phasFb
    this.phasWet = phasWet
    this.nodes.push(
      phasBranch,
      phasDry,
      phasIn,
      ap1,
      ap2,
      ap3,
      ap4,
      phasFbDelay,
      phasFb,
      phasWet,
      phasLfo,
      phasDepth,
    )
    this.oscillators.push(phasLfo)

    // 4. Vibe (staggered phase stages + pitch-bend vibrato delay)
    const vibeBranch = ctx.createGain()
    const vibeDry = ctx.createGain()
    vibeDry.gain.setValueAtTime(0.55, now)
    const vap1 = ctx.createBiquadFilter()
    const vap2 = ctx.createBiquadFilter()
    const vap3 = ctx.createBiquadFilter()
    vap1.type = 'allpass'
    vap2.type = 'allpass'
    vap3.type = 'allpass'
    vap1.frequency.setValueAtTime(520, now)
    vap2.frequency.setValueAtTime(1120, now)
    vap3.frequency.setValueAtTime(2400, now)
    vap1.Q.setValueAtTime(2.4, now)
    vap2.Q.setValueAtTime(2.0, now)
    vap3.Q.setValueAtTime(1.6, now)
    const vibeDelay = ctx.createDelay!(0.05)
    vibeDelay.delayTime.setValueAtTime(0.007, now)
    const vibeWet = ctx.createGain()
    const vibeLfo = ctx.createOscillator()
    vibeLfo.type = 'triangle'
    vibeLfo.frequency.setValueAtTime(2.4, now)
    const vibeFilterDepth = ctx.createGain()
    vibeFilterDepth.gain.setValueAtTime(180, now)
    const vibeDelayDepth = ctx.createGain()
    vibeDelayDepth.gain.setValueAtTime(0.0022, now)
    vibeLfo.connect(vibeFilterDepth)
    vibeFilterDepth.connect(vap1.frequency)
    vibeFilterDepth.connect(vap2.frequency)
    vibeLfo.connect(vibeDelayDepth)
    vibeDelayDepth.connect(vibeDelay.delayTime)
    this.input.connect(vibeDry)
    vibeDry.connect(vibeBranch)
    this.input.connect(vap1)
    vap1.connect(vap2)
    vap2.connect(vap3)
    vap3.connect(vibeDelay)
    vibeDelay.connect(vibeWet)
    vibeWet.connect(vibeBranch)
    vibeBranch.connect(this.activeGain)
    vibeBranch.gain.value = 0
    this.vibeBranch = vibeBranch
    this.vibeLfo = vibeLfo
    this.vibeFilterDepth = vibeFilterDepth
    this.vibeDelayDepth = vibeDelayDepth
    this.vibeWet = vibeWet
    this.nodes.push(
      vibeBranch,
      vibeDry,
      vap1,
      vap2,
      vap3,
      vibeDelay,
      vibeWet,
      vibeLfo,
      vibeFilterDepth,
      vibeDelayDepth,
    )
    this.oscillators.push(vibeLfo)

    // 5. Ensemble (3 modulated stereo delay lines driven by dual slow+fast LFOs)
    const ensBranch = ctx.createGain()
    const ensDry = ctx.createGain()
    ensDry.gain.setValueAtTime(0.65, now)
    const ensD1 = ctx.createDelay!(0.08)
    const ensD2 = ctx.createDelay!(0.08)
    const ensD3 = ctx.createDelay!(0.08)
    ensD1.delayTime.setValueAtTime(0.011, now)
    ensD2.delayTime.setValueAtTime(0.018, now)
    ensD3.delayTime.setValueAtTime(0.026, now)
    const ensP1 = ctx.createStereoPanner!()
    const ensP2 = ctx.createStereoPanner!()
    const ensP3 = ctx.createStereoPanner!()
    ensP1.pan.setValueAtTime(-0.8, now)
    ensP2.pan.setValueAtTime(0, now)
    ensP3.pan.setValueAtTime(0.8, now)
    const ensSlowLfo = ctx.createOscillator()
    const ensFastLfo = ctx.createOscillator()
    ensSlowLfo.type = 'sine'
    ensFastLfo.type = 'sine'
    ensSlowLfo.frequency.setValueAtTime(0.6, now)
    ensFastLfo.frequency.setValueAtTime(5.4, now)
    const ensDepth = ctx.createGain()
    ensDepth.gain.setValueAtTime(0.0028, now)
    const ensInvDepth = ctx.createGain()
    ensInvDepth.gain.setValueAtTime(-0.8, now)
    const ensWet = ctx.createGain()
    ensSlowLfo.connect(ensDepth)
    ensFastLfo.connect(ensDepth)
    ensDepth.connect(ensD1.delayTime)
    ensDepth.connect(ensD2.delayTime)
    ensDepth.connect(ensInvDepth)
    ensInvDepth.connect(ensD3.delayTime)
    this.input.connect(ensDry)
    ensDry.connect(ensBranch)
    this.input.connect(ensD1)
    this.input.connect(ensD2)
    this.input.connect(ensD3)
    ensD1.connect(ensP1)
    ensD2.connect(ensP2)
    ensD3.connect(ensP3)
    ensP1.connect(ensWet)
    ensP2.connect(ensWet)
    ensP3.connect(ensWet)
    ensWet.connect(ensBranch)
    ensBranch.connect(this.activeGain)
    ensBranch.gain.value = 0
    this.ensBranch = ensBranch
    this.ensSlowLfo = ensSlowLfo
    this.ensFastLfo = ensFastLfo
    this.ensDepth = ensDepth
    this.ensWet = ensWet
    this.nodes.push(
      ensBranch,
      ensDry,
      ensD1,
      ensD2,
      ensD3,
      ensP1,
      ensP2,
      ensP3,
      ensSlowLfo,
      ensFastLfo,
      ensDepth,
      ensInvDepth,
      ensWet,
    )
    this.oscillators.push(ensSlowLfo, ensFastLfo)

    // 6. Spin (gentle rotary-like stereo pan + amplitude modulation with gradual rate ramp)
    const spinBranch = ctx.createGain()
    const spinPan = ctx.createStereoPanner!()
    const spinAmpCarrier = ctx.createGain()
    spinAmpCarrier.gain.setValueAtTime(0.85, now)
    const spinLfo = ctx.createOscillator()
    spinLfo.type = 'sine'
    spinLfo.frequency.setValueAtTime(1.5, now)
    const spinPanDepth = ctx.createGain()
    spinPanDepth.gain.setValueAtTime(0.55, now)
    const spinAmpDepth = ctx.createGain()
    spinAmpDepth.gain.setValueAtTime(0.18, now)
    spinLfo.connect(spinPanDepth)
    spinPanDepth.connect(spinPan.pan)
    spinLfo.connect(spinAmpDepth)
    spinAmpDepth.connect(spinAmpCarrier.gain)
    this.input.connect(spinAmpCarrier)
    spinAmpCarrier.connect(spinPan)
    spinPan.connect(spinBranch)
    spinBranch.connect(this.activeGain)
    spinBranch.gain.value = 0
    this.spinBranch = spinBranch
    this.spinLfo = spinLfo
    this.spinPanDepth = spinPanDepth
    this.spinAmpDepth = spinAmpDepth
    this.spinAmpCarrier = spinAmpCarrier
    this.nodes.push(spinBranch, spinPan, spinAmpCarrier, spinLfo, spinPanDepth, spinAmpDepth)
    this.oscillators.push(spinLfo)
    if (shouldStartLfosImmediately(ctx)) {
      this.ensureLfosStarted()
    }
  }

  apply(state: Mod2State, immediate = false): void {
    const now = this.ctx.currentTime
    const on = state.on
    const set = (p: Parameters<typeof rampParam>[0], v: number, tc = RAMP_TC) =>
      rampParam(p, v, now, tc, immediate)
    set(this.bypassGain.gain, on ? 0 : 1)
    set(this.activeGain.gain, on ? 1 : 0)

    if (!this.fullDsp) return

    const r = Math.max(0, Math.min(100, state.rate)) / 100
    const a = Math.max(0, Math.min(100, state.amount)) / 100

    set(this.chorBranch!.gain, state.type === 'Chorus' ? 1 : 0)
    set(this.flangBranch!.gain, state.type === 'Flanger' ? 1 : 0)
    set(this.phasBranch!.gain, state.type === 'Phaser' ? 1 : 0)
    set(this.vibeBranch!.gain, state.type === 'Vibe' ? 1 : 0)
    set(this.ensBranch!.gain, state.type === 'Ensemble' ? 1 : 0)
    set(this.spinBranch!.gain, state.type === 'Spin' ? 1 : 0)

    // Chorus (2nd delay line kicks in cleanly above 40% amount)
    set(this.chorLfo!.frequency, 0.25 + r * 3.4)
    set(this.chorDepth1!.gain, 0.001 + a * 0.0045)
    set(this.chorDepth2!.gain, -(0.0012 + a * 0.0052))
    set(this.chorWet1!.gain, a * 0.72)
    const secondLineMix = Math.max(0, (a - 0.35) / 0.65)
    set(this.chorWet2!.gain, secondLineMix * 0.65)

    // Flanger (delayTime strictly > 0.5 ms, feedback muted when inactive)
    const flangActive = on && state.type === 'Flanger'
    set(this.flangLfo!.frequency, 0.12 + r * 2.6)
    set(this.flangDepth!.gain, flangActive ? 0.0005 + a * 0.0014 : 0)
    set(this.flangFb!.gain, flangActive ? 0.15 + a * 0.55 : 0)
    set(this.flangWet!.gain, flangActive ? a * 0.85 : 0)

    // Phaser (allpass frequency strictly > 250 Hz, feedback muted when inactive)
    const phasActive = on && state.type === 'Phaser'
    set(this.phasLfo!.frequency, 0.15 + r * 4.2)
    set(this.phasDepth!.gain, phasActive ? 180 + a * 480 : 0)
    set(this.phasFb!.gain, phasActive ? a * 0.52 : 0)
    set(this.phasWet!.gain, phasActive ? a * 0.85 : 0)

    // Vibe (vap1 base 520 Hz, max depth 320 Hz -> always strictly >= 200 Hz)
    const vibeActive = on && state.type === 'Vibe'
    set(this.vibeLfo!.frequency, 0.5 + r * 5.8)
    set(this.vibeFilterDepth!.gain, vibeActive ? 100 + a * 220 : 0)
    set(this.vibeDelayDepth!.gain, vibeActive ? 0.0008 + a * 0.0025 : 0)
    set(this.vibeWet!.gain, vibeActive ? 0.35 + a * 0.65 : 0)
    set(this.ensSlowLfo!.frequency, 0.35 + r * 1.4)
    set(this.ensFastLfo!.frequency, 3.6 + r * 3.4)
    set(this.ensDepth!.gain, 0.001 + a * 0.0038)
    set(this.ensWet!.gain, a * 0.45)

    // Spin: gradual rate ramp (0.35 s time constant)
    set(this.spinLfo!.frequency, 0.6 + r * 6.0, 0.35)
    set(this.spinPanDepth!.gain, a * 0.75)
    const spinAmp = a * 0.25
    set(this.spinAmpCarrier!.gain, 1 - spinAmp)
    set(this.spinAmpDepth!.gain, spinAmp)
  }

  ensureLfosStarted(): void {
    if (this.lfosStarted) return
    this.lfosStarted = true
    const now = this.ctx.currentTime
    for (const osc of this.oscillators) {
      try {
        osc.start(now)
      } catch {
        // already started
      }
    }
  }

  dispose(): void {
    if (this.lfosStarted) {
      for (const osc of this.oscillators) {
        try {
          osc.stop()
        } catch {
          // already stopped
        }
      }
    }
    for (const node of this.nodes) {
      try {
        node.disconnect()
      } catch {
        // already disconnected
      }
    }
  }
}

// =========================================================================
// 3. DELAY UNIT (Tempo/Tap, Feedback, Feedback Filter Off/LP/HP/BP, Ping-Pong, Dry/Wet)
// =========================================================================

export class DelayUnit implements DspUnit {
  readonly input: GainNodeLike
  readonly output: GainNodeLike
  private readonly ctx: AudioContextLike
  private readonly nodes: AudioNodeLike[] = []
  private readonly fullDsp: boolean

  private readonly dryGain: GainNodeLike
  private readonly wetGain: GainNodeLike
  private readonly delayL?: DelayNodeLike
  private readonly delayR?: DelayNodeLike
  private readonly filterL?: BiquadFilterNodeLike
  private readonly filterR?: BiquadFilterNodeLike
  private readonly fbSelfL?: GainNodeLike
  private readonly fbSelfR?: GainNodeLike
  private readonly fbCrossLtoR?: GainNodeLike
  private readonly fbCrossRtoL?: GainNodeLike
  private readonly inRNormal?: GainNodeLike

  constructor(ctx: AudioContextLike) {
    this.ctx = ctx
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.dryGain = ctx.createGain()
    this.wetGain = ctx.createGain()
    this.dryGain.gain.value = 1
    this.wetGain.gain.value = 0
    this.nodes.push(this.input, this.output, this.dryGain, this.wetGain)

    this.input.connect(this.dryGain)
    this.dryGain.connect(this.output)

    this.fullDsp = supportsFullDsp(ctx)
    if (!this.fullDsp) {
      this.wetGain.connect(this.output)
      return
    }

    const now = ctx.currentTime
    const splitter = ctx.createChannelSplitter!(2)
    const merger = ctx.createChannelMerger!(2)

    const delayL = ctx.createDelay!(2.0)
    const delayR = ctx.createDelay!(2.0)
    delayL.delayTime.setValueAtTime(0.35, now)
    delayR.delayTime.setValueAtTime(0.35, now)

    const filterL = ctx.createBiquadFilter()
    const filterR = ctx.createBiquadFilter()
    filterL.type = 'allpass'
    filterR.type = 'allpass'

    const inL = ctx.createGain()
    const inRNormal = ctx.createGain()
    inL.gain.setValueAtTime(1, now)
    inRNormal.gain.setValueAtTime(1, now)

    const fbSelfL = ctx.createGain()
    const fbSelfR = ctx.createGain()
    const fbCrossLtoR = ctx.createGain()
    const fbCrossRtoL = ctx.createGain()
    fbSelfL.gain.setValueAtTime(0.4, now)
    fbSelfR.gain.setValueAtTime(0.4, now)
    fbCrossLtoR.gain.setValueAtTime(0, now)
    fbCrossRtoL.gain.setValueAtTime(0, now)

    // Dry path stays completely untouched; delay feedback filter sits inside the delay/feedback path
    // so repeat 1 passes through once, repeat 2 twice, repeat 3 three times.
    this.input.connect(splitter)
    splitter.connect(inL, 0)
    splitter.connect(inRNormal, 1)

    inL.connect(delayL)
    inRNormal.connect(delayR)

    delayL.connect(filterL)
    delayR.connect(filterR)

    // Parallel self-feedback (stereo) + cross-feedback (ping-pong)
    filterL.connect(fbSelfL)
    fbSelfL.connect(delayL)
    filterR.connect(fbSelfR)
    fbSelfR.connect(delayR)

    filterL.connect(fbCrossLtoR)
    fbCrossLtoR.connect(delayR)
    filterR.connect(fbCrossRtoL)
    fbCrossRtoL.connect(delayL)

    // Merge wet stereo outputs
    filterL.connect(merger, 0, 0)
    filterR.connect(merger, 0, 1)
    merger.connect(this.wetGain)
    this.wetGain.connect(this.output)

    this.delayL = delayL
    this.delayR = delayR
    this.filterL = filterL
    this.filterR = filterR
    this.fbSelfL = fbSelfL
    this.fbSelfR = fbSelfR
    this.fbCrossLtoR = fbCrossLtoR
    this.fbCrossRtoL = fbCrossRtoL
    this.inRNormal = inRNormal

    this.nodes.push(
      splitter,
      merger,
      delayL,
      delayR,
      filterL,
      filterR,
      inL,
      inRNormal,
      fbSelfL,
      fbSelfR,
      fbCrossLtoR,
      fbCrossRtoL,
    )
  }

  apply(state: DelayState, immediate = false, masterClock?: MasterClockState): void {
    const now = this.ctx.currentTime
    const on = state.on
    const wetNorm = Math.max(0, Math.min(100, state.dryWet)) / 100
    const set = (p: Parameters<typeof rampParam>[0], v: number, tc = RAMP_TC) =>
      rampParam(p, v, now, tc, immediate)

    if (!on) {
      set(this.dryGain.gain, 1)
      set(this.wetGain.gain, 0)
    } else {
      const dryVal = Math.cos(wetNorm * Math.PI * 0.5)
      const wetVal = Math.sin(wetNorm * Math.PI * 0.5)
      set(this.dryGain.gain, dryVal)
      set(this.wetGain.gain, wetVal)
    }

    if (!this.fullDsp) return

    const rawDelaySec =
      state.clockSync && masterClock
        ? masterClockSubdivisionSeconds(masterClock.bpm, state.tempo)
        : bpmToDelaySeconds(state.bpm)
    const delaySec = Math.max(0.04, Math.min(1.5, rawDelaySec))
    set(this.delayL!.delayTime, delaySec, 0.025)
    set(this.delayR!.delayTime, delaySec, 0.025)
    // Cap feedback at 0.86 to remain musical and never self-oscillate into clipping
    const fb = (Math.max(0, Math.min(100, state.feedback)) / 100) * 0.86
    if (state.pingPong) {
      set(this.inRNormal!.gain, 0)
      set(this.fbSelfL!.gain, 0)
      set(this.fbSelfR!.gain, 0)
      set(this.fbCrossLtoR!.gain, Math.max(0.35, fb))
      set(this.fbCrossRtoL!.gain, fb)
    } else {
      set(this.inRNormal!.gain, 1)
      set(this.fbSelfL!.gain, fb)
      set(this.fbSelfR!.gain, fb)
      set(this.fbCrossLtoR!.gain, 0)
      set(this.fbCrossRtoL!.gain, 0)
    }

    // Feedback filter: Off / LP / HP / BP
    for (const f of [this.filterL!, this.filterR!]) {
      if (state.filter === 'Off') {
        f.type = 'allpass'
        set(f.frequency, safeFreq(this.ctx, 1000))
        set(f.Q, 0.7)
      } else if (state.filter === 'LP') {
        f.type = 'lowpass'
        set(f.frequency, safeFreq(this.ctx, 820))
        set(f.Q, 0.707)
      } else if (state.filter === 'HP') {
        f.type = 'highpass'
        set(f.frequency, safeFreq(this.ctx, 780))
        set(f.Q, 0.707)
      } else {
        f.type = 'bandpass'
        set(f.frequency, safeFreq(this.ctx, 1100))
        set(f.Q, 1.6)
      }
    }
  }

  dispose(): void {
    for (const node of this.nodes) {
      try {
        node.disconnect()
      } catch {
        // already disconnected
      }
    }
  }
}

// =========================================================================
// 4. AMP SIM / EQ UNIT (EQ only, Twin, JC, Small, LP24, HP24, To Rotary)
// =========================================================================

export class AmpEqUnit implements DspUnit {
  readonly input: GainNodeLike
  readonly output: GainNodeLike
  private readonly ctx: AudioContextLike
  private readonly nodes: AudioNodeLike[] = []
  private readonly bypassGain: GainNodeLike
  private readonly activeGain: GainNodeLike
  private readonly fullDsp: boolean

  // 3-band EQ
  private readonly eqBass: BiquadFilterNodeLike
  private readonly eqMid: BiquadFilterNodeLike
  private readonly eqTreble: BiquadFilterNodeLike

  // Mode branches
  private readonly eqOnlyBranch?: GainNodeLike
  private readonly ampBranch?: GainNodeLike
  private readonly lp24Branch?: GainNodeLike
  private readonly hp24Branch?: GainNodeLike

  // Amp sim nodes
  private readonly ampPreGain?: GainNodeLike
  private readonly ampShaper?: WaveShaperNodeLike
  private readonly ampTone1?: BiquadFilterNodeLike
  private readonly ampTone2?: BiquadFilterNodeLike
  private readonly ampCabLp?: BiquadFilterNodeLike
  private readonly ampPostGain?: GainNodeLike

  // 24 dB Filters
  private readonly lp1?: BiquadFilterNodeLike
  private readonly lp2?: BiquadFilterNodeLike
  private readonly hp1?: BiquadFilterNodeLike
  private readonly hp2?: BiquadFilterNodeLike


  constructor(ctx: AudioContextLike) {
    this.ctx = ctx
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.bypassGain = ctx.createGain()
    this.activeGain = ctx.createGain()
    this.bypassGain.gain.value = 1
    this.activeGain.gain.value = 0

    const now = ctx.currentTime
    this.eqBass = ctx.createBiquadFilter()
    this.eqBass.type = 'lowshelf'
    this.eqBass.frequency.setValueAtTime(100, now)

    this.eqMid = ctx.createBiquadFilter()
    this.eqMid.type = 'peaking'
    this.eqMid.frequency.setValueAtTime(1000, now)
    this.eqMid.Q.setValueAtTime(1.1, now)

    this.eqTreble = ctx.createBiquadFilter()
    this.eqTreble.type = 'highshelf'
    this.eqTreble.frequency.setValueAtTime(4000, now)

    this.input.connect(this.bypassGain)
    this.bypassGain.connect(this.output)
    this.activeGain.connect(this.output)
    this.nodes.push(this.input, this.output, this.bypassGain, this.activeGain, this.eqBass, this.eqMid, this.eqTreble)

    this.fullDsp = supportsFullDsp(ctx)
    if (!this.fullDsp) {
      this.input.connect(this.eqBass)
      this.eqBass.connect(this.eqMid)
      this.eqMid.connect(this.eqTreble)
      this.eqTreble.connect(this.activeGain)
      return
    }

    // 3-band EQ chain
    this.input.connect(this.eqBass)
    this.eqBass.connect(this.eqMid)
    this.eqMid.connect(this.eqTreble)

    // Branch A: EQ only & To Rotary (clean EQ pass)
    const eqOnlyBranch = ctx.createGain()
    this.eqTreble.connect(eqOnlyBranch)
    eqOnlyBranch.connect(this.activeGain)
    eqOnlyBranch.gain.value = 1

    // Branch B: Amp Sim (Twin / JC / Small)
    const ampPreGain = ctx.createGain()
    const ampShaper = ctx.createWaveShaper!()
    ampShaper.oversample = '2x'
    ampShaper.curve = makeTubeCurve(0.55, 0.28)
    const ampTone1 = ctx.createBiquadFilter()
    const ampTone2 = ctx.createBiquadFilter()
    const ampCabLp = ctx.createBiquadFilter()
    ampCabLp.type = 'lowpass'
    const ampPostGain = ctx.createGain()
    const ampBranch = ctx.createGain()
    ampBranch.gain.value = 0

    this.eqTreble.connect(ampPreGain)
    ampPreGain.connect(ampShaper)
    ampShaper.connect(ampTone1)
    ampTone1.connect(ampTone2)
    ampTone2.connect(ampCabLp)
    ampCabLp.connect(ampPostGain)
    ampPostGain.connect(ampBranch)
    ampBranch.connect(this.activeGain)

    // Branch C: LP24 Filter (two cascaded 12 dB lowpass = 24 dB/oct)
    const lp1 = ctx.createBiquadFilter()
    const lp2 = ctx.createBiquadFilter()
    lp1.type = 'lowpass'
    lp2.type = 'lowpass'
    const lp24Branch = ctx.createGain()
    lp24Branch.gain.value = 0
    this.input.connect(lp1)
    lp1.connect(lp2)
    lp2.connect(lp24Branch)
    lp24Branch.connect(this.activeGain)

    // Branch D: HP24 Filter (two cascaded 12 dB highpass = 24 dB/oct)
    const hp1 = ctx.createBiquadFilter()
    const hp2 = ctx.createBiquadFilter()
    hp1.type = 'highpass'
    hp2.type = 'highpass'
    const hp24Branch = ctx.createGain()
    hp24Branch.gain.value = 0
    this.input.connect(hp1)
    hp1.connect(hp2)
    hp2.connect(hp24Branch)
    hp24Branch.connect(this.activeGain)

    this.eqOnlyBranch = eqOnlyBranch
    this.ampBranch = ampBranch
    this.lp24Branch = lp24Branch
    this.hp24Branch = hp24Branch
    this.ampPreGain = ampPreGain
    this.ampShaper = ampShaper
    this.ampTone1 = ampTone1
    this.ampTone2 = ampTone2
    this.ampCabLp = ampCabLp
    this.ampPostGain = ampPostGain
    this.lp1 = lp1
    this.lp2 = lp2
    this.hp1 = hp1
    this.hp2 = hp2

    this.nodes.push(
      eqOnlyBranch,
      ampPreGain,
      ampShaper,
      ampTone1,
      ampTone2,
      ampCabLp,
      ampPostGain,
      ampBranch,
      lp1,
      lp2,
      lp24Branch,
      hp1,
      hp2,
      hp24Branch,
    )
  }

  apply(state: AmpEqState, immediate = false): void {
    const now = this.ctx.currentTime
    const on = state.on
    const set = (p: Parameters<typeof rampParam>[0], v: number, tc = RAMP_TC) =>
      rampParam(p, v, now, tc, immediate)
    set(this.bypassGain.gain, on ? 0 : 1)
    set(this.activeGain.gain, on ? 1 : 0)

    // 3-band EQ parameters: Bass 100 Hz, Mid 200..8000 Hz, Treble 4000 Hz, ±15 dB
    const bassDb = ((state.bass - 50) / 50) * 15
    const midDb = ((state.mid - 50) / 50) * 15
    const trebleDb = ((state.treble - 50) / 50) * 15
    const midHz = safeFreq(
      this.ctx,
      200 * Math.pow(40, Math.max(0, Math.min(100, state.midFreq)) / 100),
    )

    if (this.eqBass.gain) set(this.eqBass.gain, bassDb)
    if (this.eqMid.gain) set(this.eqMid.gain, midDb)
    set(this.eqMid.frequency, midHz)
    if (this.eqTreble.gain) set(this.eqTreble.gain, trebleDb)

    if (!this.fullDsp) return

    const isEqOnly = state.type === 'EQ only' || state.type === 'To Rotary'
    const isAmp = state.type === 'Twin' || state.type === 'JC' || state.type === 'Small'
    const isLp24 = state.type === 'LP24 Filter'
    const isHp24 = state.type === 'HP24 Filter'

    set(this.eqOnlyBranch!.gain, isEqOnly ? 1 : 0)
    set(this.ampBranch!.gain, isAmp ? 1 : 0)
    set(this.lp24Branch!.gain, isLp24 ? 1 : 0)
    set(this.hp24Branch!.gain, isHp24 ? 1 : 0)

    if (isAmp) {
      const drive01 = Math.max(0, Math.min(100, state.drive)) / 100
      // Drive is controlled purely via pre-gain into the permanent tube WaveShaper (never reassigning .curve)
      if (state.type === 'Twin') {
        set(this.ampPreGain!.gain, 0.9 + drive01 * 2.8)
        this.ampTone1!.type = 'peaking'
        set(this.ampTone1!.frequency, safeFreq(this.ctx, 420))
        set(this.ampTone1!.Q, 1.0)
        if (this.ampTone1!.gain) set(this.ampTone1!.gain, -6.0)
        this.ampTone2!.type = 'peaking'
        set(this.ampTone2!.frequency, safeFreq(this.ctx, 3100))
        set(this.ampTone2!.Q, 1.2)
        if (this.ampTone2!.gain) set(this.ampTone2!.gain, 5.5)
        set(this.ampCabLp!.frequency, safeFreq(this.ctx, 4800))
        set(this.ampPostGain!.gain, 0.95 / (1 + drive01 * 0.55))
      } else if (state.type === 'JC') {
        set(this.ampPreGain!.gain, 0.42 + drive01 * 0.65)
        this.ampTone1!.type = 'highshelf'
        set(this.ampTone1!.frequency, safeFreq(this.ctx, 3400))
        if (this.ampTone1!.gain) set(this.ampTone1!.gain, 7.5)
        this.ampTone2!.type = 'lowshelf'
        set(this.ampTone2!.frequency, safeFreq(this.ctx, 150))
        if (this.ampTone2!.gain) set(this.ampTone2!.gain, 2.5)
        set(this.ampCabLp!.frequency, safeFreq(this.ctx, 8200))
        set(this.ampPostGain!.gain, 1.45 / (1 + drive01 * 0.35))
      } else {
        // Small boxy combo
        set(this.ampPreGain!.gain, 1.6 + drive01 * 4.5)
        this.ampTone1!.type = 'highpass'
        set(this.ampTone1!.frequency, safeFreq(this.ctx, 240))
        set(this.ampTone1!.Q, 0.9)
        this.ampTone2!.type = 'peaking'
        set(this.ampTone2!.frequency, safeFreq(this.ctx, 950))
        set(this.ampTone2!.Q, 1.5)
        if (this.ampTone2!.gain) set(this.ampTone2!.gain, 9.0)
        set(this.ampCabLp!.frequency, safeFreq(this.ctx, 2300))
        set(this.ampPostGain!.gain, 0.85 / (1 + drive01 * 0.65))
      }
    }

    // LP24 / HP24: Mid Freq = cutoff, Mid Gain = resonance
    const freqNorm = Math.max(0, Math.min(100, state.midFreq)) / 100
    const resNorm = Math.max(0, Math.min(100, state.mid)) / 100
    const qVal = 0.7 + resNorm * 8.0

    const lpCutoff = safeFreq(this.ctx, 110 * Math.pow(90, freqNorm))
    set(this.lp1!.frequency, lpCutoff)
    set(this.lp2!.frequency, lpCutoff)
    set(this.lp1!.Q, qVal)
    set(this.lp2!.Q, Math.min(4.0, qVal * 0.55))

    const hpCutoff = safeFreq(this.ctx, 65 * Math.pow(80, freqNorm))
    set(this.hp1!.frequency, hpCutoff)
    set(this.hp2!.frequency, hpCutoff)
    set(this.hp1!.Q, qVal)
    set(this.hp2!.Q, Math.min(4.0, qVal * 0.55))
  }

  dispose(): void {
    for (const node of this.nodes) {
      try {
        node.disconnect()
      } catch {
        // already disconnected
      }
    }
  }
}

// =========================================================================
// 5. COMPRESSOR UNIT (Amount, Fast Mode, On/Bypass)
// =========================================================================

export class CompressorUnit implements DspUnit {
  readonly input: GainNodeLike
  readonly output: GainNodeLike
  private readonly ctx: AudioContextLike
  private readonly nodes: AudioNodeLike[] = []
  private readonly bypassGain: GainNodeLike
  private readonly activeGain: GainNodeLike
  private readonly comp: DynamicsCompressorNodeLike
  private readonly makeupGain: GainNodeLike

  constructor(ctx: AudioContextLike) {
    this.ctx = ctx
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.bypassGain = ctx.createGain()
    this.activeGain = ctx.createGain()
    this.comp = ctx.createDynamicsCompressor()
    this.makeupGain = ctx.createGain()

    this.bypassGain.gain.value = 1
    this.activeGain.gain.value = 0
    this.makeupGain.gain.value = 1

    this.input.connect(this.bypassGain)
    this.bypassGain.connect(this.output)

    this.input.connect(this.comp)
    this.comp.connect(this.makeupGain)
    this.makeupGain.connect(this.activeGain)
    this.activeGain.connect(this.output)

    this.nodes.push(this.input, this.output, this.bypassGain, this.activeGain, this.comp, this.makeupGain)
  }

  apply(state: CompressorState, immediate = false): void {
    const now = this.ctx.currentTime
    const on = state.on
    const set = (p: Parameters<typeof rampParam>[0], v: number, tc = RAMP_TC) =>
      rampParam(p, v, now, tc, immediate)
    set(this.bypassGain.gain, on ? 0 : 1)
    set(this.activeGain.gain, on ? 1 : 0)

    const a = Math.max(0, Math.min(100, state.amount)) / 100
    set(this.comp.threshold, -6 - a * 34)
    set(this.comp.ratio, 1.8 + a * 10.2)
    set(this.comp.knee, 14 - a * 10)
    set(this.comp.attack, state.fast ? 0.002 : 0.025)
    set(this.comp.release, state.fast ? 0.05 : 0.28)
    set(this.makeupGain.gain, 1.0 + a * 1.45)
  }

  dispose(): void {
    for (const node of this.nodes) {
      try {
        node.disconnect()
      } catch {
        // already disconnected
      }
    }
  }
}

// =========================================================================
// 6. REVERB UNIT (Room, Booth, Spring, Stage, Hall, Cathedral; Bright/Dark; Dry/Wet)
// =========================================================================

export class ReverbUnit implements DspUnit {
  readonly input: GainNodeLike
  readonly output: GainNodeLike
  private readonly ctx: AudioContextLike
  private readonly nodes: AudioNodeLike[] = []
  private readonly dryGain: GainNodeLike
  private readonly wetGain: GainNodeLike
  private readonly fullDsp: boolean

  private readonly convolver?: ConvolverNodeLike
  private readonly toneFilter?: BiquadFilterNodeLike
  private currentType: ReverbType | null = null

  constructor(ctx: AudioContextLike) {
    this.ctx = ctx
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.dryGain = ctx.createGain()
    this.wetGain = ctx.createGain()
    this.dryGain.gain.value = 1
    this.wetGain.gain.value = 0
    this.nodes.push(this.input, this.output, this.dryGain, this.wetGain)

    this.input.connect(this.dryGain)
    this.dryGain.connect(this.output)

    this.fullDsp = supportsFullDsp(ctx)
    if (!this.fullDsp) {
      this.wetGain.connect(this.output)
      return
    }

    const convolver = ctx.createConvolver!()
    convolver.normalize = true
    const toneFilter = ctx.createBiquadFilter()
    toneFilter.type = 'allpass'

    this.input.connect(convolver)
    convolver.connect(toneFilter)
    toneFilter.connect(this.wetGain)
    this.wetGain.connect(this.output)

    this.convolver = convolver
    this.toneFilter = toneFilter
    this.nodes.push(convolver, toneFilter)
  }

  apply(state: ReverbState, immediate = false): void {
    const now = this.ctx.currentTime
    const on = state.on
    const wetNorm = Math.max(0, Math.min(100, state.dryWet)) / 100
    const set = (p: Parameters<typeof rampParam>[0], v: number, tc = RAMP_TC) =>
      rampParam(p, v, now, tc, immediate)

    if (!on) {
      set(this.dryGain.gain, 1)
      set(this.wetGain.gain, 0)
    } else {
      const dryVal = Math.cos(wetNorm * Math.PI * 0.5)
      const wetVal = Math.sin(wetNorm * Math.PI * 0.5) * 1.15
      set(this.dryGain.gain, dryVal)
      set(this.wetGain.gain, wetVal)
    }

    if (!this.fullDsp || !this.convolver || !this.toneFilter) return

    if (this.currentType !== state.type) {
      this.currentType = state.type
      const ir = getOrCreateReverbIR(this.ctx, state.type)
      if (ir) {
        this.convolver.buffer = ir
      }
    }

    if (state.tone === 'Normal') {
      this.toneFilter.type = 'allpass'
      set(this.toneFilter.frequency, safeFreq(this.ctx, 1500))
    } else if (state.tone === 'Bright') {
      this.toneFilter.type = 'highshelf'
      set(this.toneFilter.frequency, safeFreq(this.ctx, 2200))
      if (this.toneFilter.gain) set(this.toneFilter.gain, 9.0)
    } else {
      this.toneFilter.type = 'lowpass'
      set(this.toneFilter.frequency, safeFreq(this.ctx, 1200))
      set(this.toneFilter.Q, 0.7)
    }
  }

  dispose(): void {
    for (const node of this.nodes) {
      try {
        node.disconnect()
      } catch {
        // already disconnected
      }
    }
  }
}

// =========================================================================
// 7. SHARED ROTARY SPEAKER UNIT (Horn + Bass Rotors, Drive, Slow/Fast/Stop)
// =========================================================================

export class RotarySpeakerUnit implements DspUnit {
  readonly input: GainNodeLike
  readonly output: GainNodeLike
  private readonly ctx: AudioContextLike
  private readonly nodes: AudioNodeLike[] = []
  private readonly oscillators: OscillatorNodeLike[] = []
  private lfosStarted = false
  private readonly fullDsp: boolean

  private readonly drivePre?: GainNodeLike
  private readonly driveShaper?: WaveShaperNodeLike
  private readonly drivePost?: GainNodeLike
  private readonly hornLfo?: OscillatorNodeLike
  private readonly bassLfo?: OscillatorNodeLike
  private readonly hornPanDepth?: GainNodeLike
  private readonly bassPanDepth?: GainNodeLike
  private readonly hornDopplerDepth?: GainNodeLike

  constructor(ctx: AudioContextLike) {
    this.ctx = ctx
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.nodes.push(this.input, this.output)

    this.fullDsp = supportsFullDsp(ctx)
    if (!this.fullDsp) {
      this.input.connect(this.output)
      return
    }

    const now = ctx.currentTime

    // Tube Leslie Pre-Drive
    const drivePre = ctx.createGain()
    const driveShaper = ctx.createWaveShaper!()
    driveShaper.oversample = '2x'
    driveShaper.curve = makeTubeCurve(0.5, 0.22)
    const drivePost = ctx.createGain()
    this.input.connect(drivePre)
    drivePre.connect(driveShaper)
    driveShaper.connect(drivePost)

    // 800 Hz crossover into Bass Rotor and Horn Rotor
    const bassFilter = ctx.createBiquadFilter()
    bassFilter.type = 'lowpass'
    bassFilter.frequency.setValueAtTime(800, now)
    const hornFilter = ctx.createBiquadFilter()
    hornFilter.type = 'highpass'
    hornFilter.frequency.setValueAtTime(800, now)

    drivePost.connect(bassFilter)
    drivePost.connect(hornFilter)

    // Bass Rotor (slower inertia, stereo pan + warm tremolo)
    const bassAmp = ctx.createGain()
    bassAmp.gain.setValueAtTime(0.84, now)
    const bassPan = ctx.createStereoPanner!()
    const bassLfo = ctx.createOscillator()
    bassLfo.type = 'sine'
    bassLfo.frequency.setValueAtTime(0.65, now)
    const bassAmpDepth = ctx.createGain()
    bassAmpDepth.gain.setValueAtTime(0.16, now)
    const bassPanDepth = ctx.createGain()
    bassPanDepth.gain.setValueAtTime(0.55, now)
    bassLfo.connect(bassAmpDepth)
    bassAmpDepth.connect(bassAmp.gain)
    bassLfo.connect(bassPanDepth)
    bassPanDepth.connect(bassPan.pan)
    bassFilter.connect(bassAmp)
    bassAmp.connect(bassPan)
    bassPan.connect(this.output)

    // Horn Rotor (faster acceleration, stereo pan + amplitude + Doppler pitch delay)
    const hornDelay = ctx.createDelay!(0.03)
    hornDelay.delayTime.setValueAtTime(0.004, now)
    const hornAmp = ctx.createGain()
    hornAmp.gain.setValueAtTime(0.75, now)
    const hornPan = ctx.createStereoPanner!()
    const hornLfo = ctx.createOscillator()
    hornLfo.type = 'sine'
    hornLfo.frequency.setValueAtTime(0.82, now)
    const hornAmpDepth = ctx.createGain()
    hornAmpDepth.gain.setValueAtTime(0.28, now)
    const hornPanDepth = ctx.createGain()
    hornPanDepth.gain.setValueAtTime(0.82, now)
    const hornDopplerDepth = ctx.createGain()
    hornDopplerDepth.gain.setValueAtTime(0.00065, now)
    hornLfo.connect(hornAmpDepth)
    hornAmpDepth.connect(hornAmp.gain)
    hornLfo.connect(hornPanDepth)
    hornPanDepth.connect(hornPan.pan)
    hornLfo.connect(hornDopplerDepth)
    hornDopplerDepth.connect(hornDelay.delayTime)
    hornFilter.connect(hornDelay)
    hornDelay.connect(hornAmp)
    hornAmp.connect(hornPan)
    hornPan.connect(this.output)

    this.drivePre = drivePre
    this.driveShaper = driveShaper
    this.drivePost = drivePost
    this.hornLfo = hornLfo
    this.bassLfo = bassLfo
    this.hornPanDepth = hornPanDepth
    this.bassPanDepth = bassPanDepth
    this.hornDopplerDepth = hornDopplerDepth

    this.nodes.push(
      drivePre,
      driveShaper,
      drivePost,
      bassFilter,
      hornFilter,
      bassAmp,
      bassPan,
      bassLfo,
      bassAmpDepth,
      bassPanDepth,
      hornDelay,
      hornAmp,
      hornPan,
      hornLfo,
      hornAmpDepth,
      hornPanDepth,
      hornDopplerDepth,
    )
    this.oscillators.push(bassLfo, hornLfo)
    if (shouldStartLfosImmediately(ctx)) {
      this.ensureLfosStarted()
    }
  }

  apply(state: RotaryState, immediate = false): void {
    if (!this.fullDsp) return
    const now = this.ctx.currentTime
    const set = (p: Parameters<typeof rampParam>[0], v: number, tc = RAMP_TC) =>
      rampParam(p, v, now, tc, immediate)
    const drive01 = state.driveOn ? Math.max(0.18, state.drive / 100) : (state.drive / 100) * 0.35
    set(this.drivePre!.gain, 0.55 + drive01 * 2.8)
    set(this.drivePost!.gain, 1.35 / (1 + drive01 * 0.6))

    // Smooth rotor acceleration / deceleration (horn faster than bass drum), supporting morphable speed 0..1
    if (state.stopMode) {
      set(this.hornLfo!.frequency, 0.001, 0.35)
      set(this.bassLfo!.frequency, 0.001, 0.65)
      set(this.hornDopplerDepth!.gain, 0, 0.15)
    } else {
      const speedT =
        state.morphedSpeed !== undefined
          ? Math.max(0, Math.min(1, state.morphedSpeed))
          : state.speed === 'Fast'
            ? 1
            : 0
      const hornHz = 0.82 + speedT * (6.6 - 0.82)
      const bassHz = 0.65 + speedT * (5.4 - 0.65)
      set(this.hornLfo!.frequency, hornHz, 0.42)
      set(this.bassLfo!.frequency, bassHz, 0.85)
      set(this.hornPanDepth!.gain, 0.72 + speedT * 0.16)
      set(this.bassPanDepth!.gain, 0.48 + speedT * 0.14)
      set(this.hornDopplerDepth!.gain, 0.00045 + speedT * 0.0004)
    }
  }

  ensureLfosStarted(): void {
    if (this.lfosStarted) return
    this.lfosStarted = true
    const now = this.ctx.currentTime
    for (const osc of this.oscillators) {
      try {
        osc.start(now)
      } catch {
        // already started
      }
    }
  }

  dispose(): void {
    if (this.lfosStarted) {
      for (const osc of this.oscillators) {
        try {
          osc.stop()
        } catch {
          // already stopped
        }
      }
    }
    for (const node of this.nodes) {
      try {
        node.disconnect()
      } catch {
        // already disconnected
      }
    }
  }
}
