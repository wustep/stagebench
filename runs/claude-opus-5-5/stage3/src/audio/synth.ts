// Synth engine (synth spec): live synthesis in the shared AudioContext. Per layer: a free-running
// LFO (five waveforms, three destinations, master-clock syncable), a vibrato LFO, and an
// arpeggiator gate. Per voice: the oscillator block for the selected waveform category with Osc Ctrl
// acting per category, unison copies, drive, a two-stage filter (LP12/LP24/HP/BP with key
// tracking, resonance and envelope) and the amplifier envelope.
//
// Osc Ctrl per category (manual pp. 29–30):
//   Pure  — no effect.
//   Sync  — relative pitch of the synced oscillator: a resonant formant at 1–8 × f0 swept over the
//           master saw/square (a documented approximation of hard sync's moving spectral peak).
//   Multi — detune between three stacked saws (8ve adds a saw an octave up).
//   Super — detune/width of a seven-oscillator stack.
//   FM-H  — FM amount: modulation index of a 2-operator pair (modulator at 2 × f0, "algorithm A").
// Osc Ctrl modulation (oscillator envelope, LFO) is an audio-rate signal in Osc Ctrl units that each
// category scales onto its parameter, so modulation acts exactly like turning the knob.
import { holdParam, makeCurve, rampTo } from './fx/common'
import { midiToHz } from './instruments'
import type { AudioContextLike, BiquadLike, BufferLike, ConstantSourceLike, GainLike, NodeLike, OscillatorLike, ParamLike, PeriodicWaveLike, ScheduledSourceLike, WaveShaperLike } from './webAudioTypes'
import {
  DRIVE_GAIN,
  envAttack,
  envDecay,
  envRelease,
  filterEnvCents,
  filterHz,
  filterQ,
  KB_TRACK_AMOUNT,
  lfoHz,
  unit127,
  vibratoCents,
  vibratoHz,
  waveDef,
  type Envelope,
  type SynthLayerState,
} from '../model/synthState'

export const SYNTH_VOICE_GAIN = 0.2
/** Sync formant range: Osc Ctrl 0…1 sweeps the synced oscillator 0…3 octaves above f0. */
export const SYNC_OCTAVES = 3
export const MULTI_CENTS = 45
export const SUPER_CENTS = 70
export const FM_RATIO = 2
export const FM_MAX_INDEX = 9
/** LFO → pitch depth (cents at full amount) and → filter (cents). */
export const LFO_PITCH_CENTS = 1200
export const LFO_FILTER_CENTS = 3600
/** Oscillator envelope → pitch (Env To Pitch) depth at full amount (cents). */
export const ENV_PITCH_CENTS = 2400

const UNISON = [
  [{ cents: 0, pan: 0 }],
  [
    { cents: -7, pan: -0.5 },
    { cents: 7, pan: 0.5 },
  ],
  [
    { cents: -11, pan: -0.7 },
    { cents: 0, pan: 0 },
    { cents: 11, pan: 0.7 },
  ],
  [
    { cents: -16, pan: -0.9 },
    { cents: -6, pan: -0.3 },
    { cents: 6, pan: 0.3 },
    { cents: 16, pan: 0.9 },
  ],
]

/** Amp velocity levels Off/1/2/3: how strongly velocity scales amplitude. */
const AMP_VEL = [0, 0.35, 0.65, 1]

export interface SynthShared {
  pulse33: PeriodicWaveLike
  pulse10: PeriodicWaveLike
  noise: BufferLike
  sh: PeriodicWaveLike
  drive: Float32Array
}

function pulseWave(ctx: AudioContextLike, duty: number, harmonics = 64): PeriodicWaveLike {
  const real = new Float32Array(harmonics + 1)
  const imag = new Float32Array(harmonics + 1)
  for (let k = 1; k <= harmonics; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(Math.PI * k * duty)
  return ctx.createPeriodicWave(real, imag)
}

/** Deterministic sample-and-hold staircase (32 steps per cycle) as a periodic wave. */
function shWave(ctx: AudioContextLike, steps = 32, harmonics = 160): PeriodicWaveLike {
  const values: number[] = []
  let seed = 0x1234567
  for (let i = 0; i < steps; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
    values.push((seed / 0xffffffff) * 2 - 1)
  }
  const real = new Float32Array(harmonics + 1)
  const imag = new Float32Array(harmonics + 1)
  // Fourier series of a piecewise-constant function over [0, 1).
  for (let k = 1; k <= harmonics; k++) {
    let a = 0
    let b = 0
    for (let i = 0; i < steps; i++) {
      const x0 = (2 * Math.PI * k * i) / steps
      const x1 = (2 * Math.PI * k * (i + 1)) / steps
      a += (values[i] * (Math.sin(x1) - Math.sin(x0))) / (Math.PI * k)
      b += (values[i] * (Math.cos(x0) - Math.cos(x1))) / (Math.PI * k)
    }
    real[k] = a
    imag[k] = b
  }
  return ctx.createPeriodicWave(real, imag)
}

export function synthShared(ctx: AudioContextLike): SynthShared {
  const n = Math.round(ctx.sampleRate * 1.5)
  const noise = ctx.createBuffer(1, n, ctx.sampleRate)
  const data = new Float32Array(n)
  let seed = 0x6d2b79f5
  for (let i = 0; i < n; i++) {
    seed = (Math.imul(seed ^ (seed >>> 15), 1 | seed) + 0x6d2b79f5) >>> 0
    data[i] = (seed / 0xffffffff) * 2 - 1
  }
  noise.copyToChannel(data, 0)
  return { pulse33: pulseWave(ctx, 0.33), pulse10: pulseWave(ctx, 0.1), noise, sh: shWave(ctx), drive: makeCurve((x) => Math.tanh(x), 1024) }
}

/** The sounding pitch of a layer for a key (coarse ± 24 st, fine ± 50 cents). */
export function synthPitch(layer: SynthLayerState, note: number): number {
  return note + layer.pitch.coarse + layer.pitch.fine / 100
}

/** LFO frequency: unsynced Rate knob, or one cycle per master-clock subdivision. */
export function lfoFrequency(layer: SynthLayerState, bpmSeconds: ((rate: number) => number) | null): number {
  return layer.lfo.sync && bpmSeconds ? 1 / bpmSeconds(layer.lfo.rate) : lfoHz(layer.lfo.rate)
}

/**
 * One synth layer's shared graph: voices → gate (arpeggiator Gate mode) → output (the layer's
 * effect chain). The LFO and vibrato LFO feed per-voice taps through destination buses.
 */
export class SynthLayerGraph {
  readonly input: GainLike
  readonly gate: GainLike
  readonly output: GainLike
  readonly pitchBus: GainLike
  readonly ctrlBus: GainLike
  readonly filterBus: GainLike
  readonly vibBus: GainLike
  readonly lfo: OscillatorLike
  private readonly lfoSign: GainLike
  private readonly vib: OscillatorLike
  private lfoWave = ''
  private readonly nodes: NodeLike[]

  constructor(
    readonly ctx: AudioContextLike,
    private readonly shared: SynthShared,
  ) {
    const g = (v: number) => {
      const n = ctx.createGain()
      n.gain.value = v
      return n
    }
    this.input = g(1)
    this.gate = g(1)
    this.input.connect(this.gate)
    this.output = this.gate
    this.lfo = ctx.createOscillator()
    this.lfoSign = g(1)
    this.lfo.connect(this.lfoSign)
    this.pitchBus = g(0)
    this.ctrlBus = g(0)
    this.filterBus = g(0)
    this.lfoSign.connect(this.pitchBus)
    this.lfoSign.connect(this.ctrlBus)
    this.lfoSign.connect(this.filterBus)
    this.vib = ctx.createOscillator()
    this.vib.type = 'sine'
    this.vibBus = g(0)
    this.vib.connect(this.vibBus)
    this.lfo.start(ctx.currentTime)
    this.vib.start(ctx.currentTime)
    this.nodes = [this.input, this.gate, this.lfo, this.lfoSign, this.pitchBus, this.ctrlBus, this.filterBus, this.vib, this.vibBus]
  }

  apply(layer: SynthLayerState, lfoHzValue: number, wheel: number, now: number, initial: boolean): void {
    const set = (p: ParamLike, v: number) => (initial ? p.setValueAtTime(v, now) : rampTo(p, v, now))
    const w = layer.lfo.wave
    if (w !== this.lfoWave) {
      if (w === 'sh') this.lfo.setPeriodicWave(this.shared.sh)
      else this.lfo.type = w === 'triangle' ? 'triangle' : w === 'square' ? 'square' : 'sawtooth'
      this.lfoSign.gain.value = w === 'sawDown' ? -1 : 1
      this.lfoWave = w
    }
    // S&H: one cycle of the staircase holds 32 steps, so the step rate equals the Rate setting.
    const cycle = w === 'sh' ? lfoHzValue / 32 : lfoHzValue
    if (initial) this.lfo.frequency.setValueAtTime(cycle, now)
    else rampTo(this.lfo.frequency, cycle, now, 0.05)
    const amt = unit127(layer.lfo.amount)
    // No destination = LFO off, settings kept (manual p. 34).
    set(this.pitchBus.gain, layer.lfo.dest === 'pitch' ? amt * LFO_PITCH_CENTS : 0)
    set(this.ctrlBus.gain, layer.lfo.dest === 'ctrl' ? amt : 0)
    set(this.filterBus.gain, layer.lfo.dest === 'filter' ? amt * LFO_FILTER_CENTS : 0)
    const v = layer.vibrato
    this.vib.frequency.value = vibratoHz(v.rate)
    const depth = v.mode === 'off' ? 0 : vibratoCents(v.amount) * (v.mode === 'wheel' ? wheel / 127 : 1)
    set(this.vibBus.gain, depth)
  }

  /** Arpeggiator Gate mode: open the gate for `open` seconds from `when` with `edge` ramps. */
  gateStep(when: number, open: number, edge: number): void {
    const p = this.gate.gain
    p.setValueAtTime(0, when)
    p.linearRampToValueAtTime(1, when + edge)
    p.setValueAtTime(1, when + Math.max(edge, open - edge))
    p.linearRampToValueAtTime(0, when + Math.max(2 * edge, open))
  }

  gateOpen(now: number): void {
    holdParam(this.gate.gain, now)
    this.gate.gain.linearRampToValueAtTime(1, now + 0.01)
  }

  dispose(): void {
    for (const o of [this.lfo, this.vib]) {
      try {
        o.stop()
      } catch {
        // already stopped
      }
    }
    for (const n of this.nodes) n.disconnect()
  }
}

/** ADR envelope automation on a parameter from 0 (decay at max = sustain at 1). */
function envAttackDecay(p: ParamLike, env: Envelope, peak: number, t: number): void {
  const a = envAttack(env.attack)
  p.setValueAtTime(0, t)
  p.linearRampToValueAtTime(peak, t + a)
  const d = envDecay(env.decay)
  if (Number.isFinite(d)) p.setTargetAtTime(0, t + a, d / 4)
}

function envRelease_(p: ParamLike, env: Envelope, now: number, fast: boolean): number {
  holdParam(p, now)
  const r = fast ? 0.012 : envRelease(env.release)
  p.setTargetAtTime(0, now, r / 5)
  return r
}

export interface SynthVoice {
  sources: ScheduledSourceLike[]
  nodes: NodeLike[]
  /** The voice output gain (amp envelope). */
  gain: GainLike
  /** Drop the layer-bus → voice modulation links (call once at cleanup). */
  detach(): void
  /** Set every oscillator to a new key pitch, gliding linearly over `seconds`. */
  setPitch(note: number, seconds: number, bend: number): void
  /** Restart the envelopes (mono mode retrigger). */
  retrigger(velocity: number): void
  /** Live parameter changes reach sounding voices (Osc Ctrl, filter, envelope amounts). */
  update(layer: SynthLayerState): void
  release(fast: boolean): number
}

export interface SynthVoiceOptions {
  layer: SynthLayerState
  graph: SynthLayerGraph
  note: number
  velocity: number
  gain: number
  bend: number
}

interface FreqParam {
  param: ParamLike
  ratio: () => number
}

/** Build one synth voice into `graph.input`. The caller owns lifecycle (onended, cleanup). */
export function startSynthVoice(ctx: AudioContextLike, shared: SynthShared, o: SynthVoiceOptions): SynthVoice {
  const t = ctx.currentTime
  const L = o.layer
  let layer = L
  const def = waveDef(L.wave)
  const nodes: NodeLike[] = []
  const sources: ScheduledSourceLike[] = []
  const add = <T extends NodeLike>(n: T): T => {
    nodes.push(n)
    return n
  }
  const gainNode = (v: number) => {
    const n = add(ctx.createGain())
    n.gain.value = v
    return n
  }
  const vel = o.velocity / 127
  let key = synthPitch(L, o.note)
  let f0 = midiToHz(key) * o.bend
  const freqs: FreqParam[] = []
  const ctrlBase: (() => void)[] = []

  // Modulation inputs: pitch (cents) and Osc Ctrl (0…1 units).
  const pitchIn = gainNode(1)
  const ctrlIn = gainNode(1)
  const vibTap = gainNode(1)
  o.graph.vibBus.connect(vibTap)
  vibTap.connect(pitchIn)
  if (L.vibrato.mode === 'delay') {
    vibTap.gain.setValueAtTime(0, t)
    vibTap.gain.linearRampToValueAtTime(1, t + 0.7)
  }
  const lfoPitchTap = gainNode(1)
  o.graph.pitchBus.connect(lfoPitchTap)
  lfoPitchTap.connect(pitchIn)
  const lfoCtrlTap = gainNode(1)
  o.graph.ctrlBus.connect(lfoCtrlTap)
  lfoCtrlTap.connect(ctrlIn)

  const srcSum = gainNode(1)
  const osc = (type: string | PeriodicWaveLike, ratio: number, cents: number): OscillatorLike => {
    const n = add(ctx.createOscillator())
    if (typeof type === 'string') n.type = type
    else n.setPeriodicWave(type)
    n.frequency.value = f0 * ratio
    n.detune.value = cents
    freqs.push({ param: n.frequency, ratio: () => ratio })
    pitchIn.connect(n.detune)
    sources.push(n)
    return n
  }
  const c = () => unit127(layer.oscCtrl)
  const unison = UNISON[Math.max(0, Math.min(3, L.unison))]
  for (const u of unison) {
    const pan = add(ctx.createStereoPanner())
    pan.pan.value = u.pan
    const ug = gainNode(1 / Math.sqrt(unison.length))
    pan.connect(ug)
    ug.connect(srcSum)
    switch (def.category) {
      case 'Pure': {
        if (def.id === 'noise') {
          const n = add(ctx.createBufferSource())
          n.buffer = shared.noise
          n.loop = true
          const ng = gainNode(0.6)
          n.connect(ng)
          ng.connect(pan)
          sources.push(n)
        } else {
          const type = def.id === 'saw' ? 'sawtooth' : def.id === 'pulse33' ? shared.pulse33 : def.id === 'pulse10' ? shared.pulse10 : def.id
          osc(type, 1, u.cents).connect(pan)
        }
        break
      }
      case 'Sync': {
        const master = osc(def.id === 'syncSaw' ? 'sawtooth' : 'square', 1, u.cents)
        const bp = add(ctx.createBiquadFilter())
        bp.type = 'bandpass'
        bp.Q.value = 7
        const formant = () => {
          bp.frequency.value = Math.min(ctx.sampleRate * 0.45, f0 * Math.pow(2, SYNC_OCTAVES * c()))
        }
        formant()
        ctrlBase.push(formant)
        freqs.push({ param: bp.frequency, ratio: () => Math.pow(2, SYNC_OCTAVES * c()) })
        pitchIn.connect(bp.detune)
        const cm = gainNode(SYNC_OCTAVES * 1200)
        ctrlIn.connect(cm)
        cm.connect(bp.detune)
        const direct = gainNode(0.28)
        const peak = gainNode(2.4)
        master.connect(direct)
        master.connect(bp)
        bp.connect(peak)
        direct.connect(pan)
        peak.connect(pan)
        break
      }
      case 'Multi':
      case 'Super': {
        const multi = def.category === 'Multi'
        const spread = multi ? [-1, 0, 1] : [-1, -2 / 3, -1 / 3, 0, 1 / 3, 2 / 3, 1]
        const range = multi ? MULTI_CENTS : SUPER_CENTS
        const type = def.id === 'superSquare' ? 'square' : 'sawtooth'
        const list: { o: OscillatorLike; k: number; ratio: number }[] = spread.map((k) => ({ o: osc(type, 1, u.cents), k, ratio: 1 }))
        if (def.id === 'multiSaw8') list.push({ o: osc('sawtooth', 2, u.cents), k: 0.5, ratio: 2 })
        const each = gainNode(1 / Math.sqrt(list.length))
        each.connect(pan)
        for (const item of list) {
          const set = () => (item.o.detune.value = u.cents + item.k * range * c())
          set()
          ctrlBase.push(set)
          const km = gainNode(item.k * range)
          ctrlIn.connect(km)
          km.connect(item.o.detune)
          if (!multi) {
            // Super: the stack also widens in stereo with Osc Ctrl.
            const p = add(ctx.createStereoPanner())
            p.pan.value = Math.max(-1, Math.min(1, u.pan + item.k * 0.8 * c()))
            item.o.connect(p)
            p.connect(each)
          } else item.o.connect(each)
        }
        break
      }
      case 'FM-H': {
        const carrier = osc('sine', 1, u.cents)
        const mod = osc('sine', FM_RATIO, u.cents)
        const depth = gainNode(0)
        const index = () => (depth.gain.value = FM_MAX_INDEX * c() * f0 * FM_RATIO)
        index()
        ctrlBase.push(index)
        const dm = gainNode(FM_MAX_INDEX * f0 * FM_RATIO)
        ctrlBase.push(() => (dm.gain.value = FM_MAX_INDEX * f0 * FM_RATIO))
        ctrlIn.connect(dm)
        dm.connect(depth.gain)
        mod.connect(depth)
        depth.connect(carrier.frequency)
        carrier.connect(pan)
        break
      }
    }
  }

  // Oscillator envelope → Osc Ctrl (or pitch with Env To Pitch), bipolar amount, optional velocity.
  const oscEnv = add(ctx.createConstantSource()) as ConstantSourceLike
  const oscEnvAmt = gainNode(0)
  oscEnv.connect(oscEnvAmt)
  const oscAmt = () => ((L.oscEnvAmt - 64) / 63) * (L.oscEnv.velocity ? 0.3 + 0.7 * vel : 1)
  if (L.envToPitch) oscEnvAmt.connect(pitchIn)
  else oscEnvAmt.connect(ctrlIn)
  oscEnvAmt.gain.value = oscAmt() * (L.envToPitch ? ENV_PITCH_CENTS : 1)
  envAttackDecay(oscEnv.offset, L.oscEnv, 1, t)
  sources.push(oscEnv)

  // Drive → two-stage filter.
  const driveIn = gainNode(DRIVE_GAIN[L.filter.drive] ?? 1)
  const shaper = add(ctx.createWaveShaper()) as WaveShaperLike
  shaper.curve = L.filter.drive > 0 ? shared.drive : null
  const driveOut = gainNode(L.filter.drive > 0 ? 1 / Math.sqrt(DRIVE_GAIN[L.filter.drive]) : 1)
  srcSum.connect(driveIn)
  driveIn.connect(shaper)
  shaper.connect(driveOut)
  const f1 = add(ctx.createBiquadFilter()) as BiquadLike
  const f2 = add(ctx.createBiquadFilter()) as BiquadLike
  driveOut.connect(f1)
  f1.connect(f2)
  const filterEnv = add(ctx.createConstantSource()) as ConstantSourceLike
  const filterEnvAmt = gainNode(0)
  filterEnv.connect(filterEnvAmt)
  filterEnvAmt.connect(f1.detune)
  filterEnvAmt.connect(f2.detune)
  const lfoFilterTap = gainNode(1)
  o.graph.filterBus.connect(lfoFilterTap)
  lfoFilterTap.connect(f1.detune)
  lfoFilterTap.connect(f2.detune)
  envAttackDecay(filterEnv.offset, L.filterEnv, 1, t)
  sources.push(filterEnv)

  const applyFilter = (layer: SynthLayerState, now: number | null) => {
    const F = layer.filter
    const types: [string, string] = !F.on
      ? ['allpass', 'allpass']
      : F.type === 'LP12'
        ? ['lowpass', 'allpass']
        : F.type === 'LP24'
          ? ['lowpass', 'lowpass']
          : F.type === 'HP'
            ? ['highpass', 'allpass']
            : ['bandpass', 'allpass']
    f1.type = types[0]
    f2.type = types[1]
    const cutoff = Math.min(ctx.sampleRate * 0.45, filterHz(F.freq) * Math.pow(2, (KB_TRACK_AMOUNT[F.track] * (key - 60)) / 12))
    const q = filterQ(F.res)
    const set = (p: ParamLike, v: number) => (now === null ? (p.value = v) : rampTo(p, v, now))
    set(f1.frequency, F.on ? cutoff : 1000)
    set(f2.frequency, F.on ? cutoff : 1000)
    // LP24: resonance on the second stage; the others resonate on their single stage.
    f1.Q.value = F.type === 'LP24' ? 0.707 : q
    f2.Q.value = F.type === 'LP24' ? q : 0.707
    const envCents = F.on ? filterEnvCents(F.envAmt) * (layer.filterEnv.velocity ? 0.3 + 0.7 * vel : 1) : 0
    set(filterEnvAmt.gain, envCents)
  }
  applyFilter(L, null)

  // Amplifier: ADR envelope × velocity × zone gain.
  const amp = gainNode(0)
  const k = AMP_VEL[L.ampEnv.velocity] ?? 0
  let peak = SYNTH_VOICE_GAIN * o.gain * (1 - k + k * vel)
  f2.connect(amp)
  amp.connect(o.graph.input)
  envAttackDecay(amp.gain, L.ampEnv, peak, t)

  for (const s of sources) s.start(t)

  const taps: [GainLike, GainLike][] = [
    [o.graph.vibBus, vibTap],
    [o.graph.pitchBus, lfoPitchTap],
    [o.graph.ctrlBus, lfoCtrlTap],
    [o.graph.filterBus, lfoFilterTap],
  ]
  return {
    sources,
    nodes,
    gain: amp,
    detach: () => taps.forEach(([bus, tap]) => bus.disconnect(tap)),
    setPitch(note, seconds, bend) {
      const now = ctx.currentTime
      key = synthPitch(layer, note)
      f0 = midiToHz(key) * bend
      for (const fp of freqs) {
        holdParam(fp.param, now)
        const target = Math.min(ctx.sampleRate * 0.45, f0 * fp.ratio())
        if (seconds > 0) fp.param.linearRampToValueAtTime(target, now + seconds)
        else fp.param.setValueAtTime(target, now)
      }
      applyFilter(layer, now)
    },
    retrigger(velocity) {
      const now = ctx.currentTime
      const v = velocity / 127
      peak = SYNTH_VOICE_GAIN * o.gain * (1 - k + k * v)
      for (const [p, env, pk] of [
        [amp.gain, layer.ampEnv, peak],
        [filterEnv.offset, layer.filterEnv, 1],
        [oscEnv.offset, layer.oscEnv, 1],
      ] as [ParamLike, Envelope, number][]) {
        holdParam(p, now)
        p.linearRampToValueAtTime(pk, now + envAttack(env.attack))
        const d = envDecay(env.decay)
        if (Number.isFinite(d)) p.setTargetAtTime(0, now + envAttack(env.attack), d / 4)
      }
    },
    update(next) {
      const now = ctx.currentTime
      layer = next
      for (const f of ctrlBase) f()
      applyFilter(next, now)
      rampTo(oscEnvAmt.gain, ((next.oscEnvAmt - 64) / 63) * (next.oscEnv.velocity ? 0.3 + 0.7 * vel : 1) * (L.envToPitch ? ENV_PITCH_CENTS : 1), now)
      shaper.curve = next.filter.drive > 0 ? shared.drive : null
      rampTo(driveIn.gain, DRIVE_GAIN[next.filter.drive] ?? 1, now)
      rampTo(driveOut.gain, next.filter.drive > 0 ? 1 / Math.sqrt(DRIVE_GAIN[next.filter.drive]) : 1, now)
    },
    release(fast) {
      const now = ctx.currentTime
      const r = envRelease_(amp.gain, layer.ampEnv, now, fast)
      envRelease_(filterEnv.offset, layer.filterEnv, now, fast)
      envRelease_(oscEnv.offset, layer.oscEnv, now, fast)
      return now + r + 0.02
    },
  }
}
