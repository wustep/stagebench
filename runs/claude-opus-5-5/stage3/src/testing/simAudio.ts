// A small, sample-accurate, stereo Web Audio graph simulator used by tests. It implements exactly
// the node types and AudioParam automation the app uses, and renders real samples: recorded and
// generated buffers, oscillators, RBJ biquads (Web Audio spec formulas), delay lines with feedback
// cycles, wave shapers, equal-power stereo panners, a dynamics compressor, zero-latency
// partitioned convolution and audio-rate parameter modulation all execute, so tests can measure
// loudness, duration, stereo image, spectra and silence without audio hardware.
//
// Deliberate simplifications (documented so tests never rely on them): a DelayNode's minimum
// delay is one frame (Web Audio allows 0 outside cycles); cycles without a DelayNode render
// silence instead of throwing; the compressor has no look-ahead.
import type {
  AudioContextLike,
  BiquadLike,
  ConstantSourceLike,
  BufferLike,
  BufferSourceLike,
  CompressorLike,
  ConvolverLike,
  DelayLike,
  GainLike,
  NodeLike,
  OscillatorLike,
  ParamLike,
  PeriodicWaveLike,
  StereoPannerLike,
  WaveShaperLike,
} from '../audio/webAudioTypes'

type Event =
  | { kind: 'set'; t: number; v: number }
  | { kind: 'linear'; t: number; v: number }
  | { kind: 'target'; t: number; v: number; tau: number }

export class SimParam implements ParamLike {
  private events: Event[] = []
  private base: number
  /** Nodes connected to this parameter (audio-rate modulation, summed as mono). */
  readonly inputs = new Set<SimNode>()

  constructor(initial: number) {
    this.base = initial
  }

  get value(): number {
    return this.base
  }

  set value(v: number) {
    this.base = v
    this.events = []
  }

  get eventCount(): number {
    return this.events.length
  }

  private insert(e: Event) {
    this.events.push(e)
    this.events.sort((a, b) => a.t - b.t)
  }

  setValueAtTime(v: number, t: number) {
    this.insert({ kind: 'set', t, v })
    return this
  }

  linearRampToValueAtTime(v: number, t: number) {
    this.insert({ kind: 'linear', t, v })
    return this
  }

  setTargetAtTime(v: number, t: number, tau: number) {
    this.insert({ kind: 'target', t, v, tau })
    return this
  }

  cancelScheduledValues(t: number) {
    this.events = this.events.filter((e) => e.t < t)
    return this
  }

  cancelAndHoldAtTime(t: number) {
    const held = this.valueAt(t)
    // Everything before t is superseded by the held value (renders only move forward).
    this.events = []
    this.insert({ kind: 'set', t, v: held })
    return this
  }

  /** The value if the parameter is constant from `time` on (no modulation, automation finished). */
  constantAfter(time: number): number | null {
    if (this.inputs.size) return null
    if (this.events.length === 0) return this.base
    const last = this.events[this.events.length - 1]
    if (last.t > time || last.kind === 'target') return null
    return last.v
  }

  valueAt(time: number): number {
    if (this.events.length === 0) return this.base
    let v = this.base
    let t0 = 0
    let target: { v: number; tau: number } | null = null
    const at = (t: number) => (target ? target.v + (v - target.v) * Math.exp(-(t - t0) / target.tau) : v)
    let prevT = 0
    for (const e of this.events) {
      if (e.t > time) {
        if (e.kind === 'linear') {
          const sv = at(prevT)
          const span = e.t - prevT
          return span <= 0 ? e.v : sv + ((e.v - sv) * (time - prevT)) / span
        }
        break
      }
      if (e.kind === 'target') {
        v = at(e.t)
        t0 = e.t
        target = { v: e.v, tau: e.tau }
      } else {
        v = e.v
        t0 = e.t
        target = null
      }
      prevT = e.t
    }
    return at(time)
  }

  /** Intrinsic value plus the (mono) sum of connected modulators at `frame`. */
  computed(frame: number, sampleRate: number): number {
    let v = this.valueAt(frame / sampleRate)
    for (const input of this.inputs) {
      input.pull(frame)
      v += (input.l + input.r) / 2
    }
    return v
  }
}

export abstract class SimNode implements NodeLike {
  readonly inputs = new Set<SimNode>()
  readonly outputs = new Set<SimNode>()
  readonly paramOutputs = new Set<SimParam>()
  /** Output of the last processed frame (left/right; mono signals have l === r). */
  l = 0
  r = 0
  stereo = false
  protected inL = 0
  protected inR = 0
  protected inStereo = false
  private cacheFrame = -1
  private busy = false

  constructor(readonly ctx: SimAudioContext) {
    ctx.registry.add(this)
  }

  connect(destination: NodeLike | ParamLike): NodeLike | ParamLike {
    if (destination instanceof SimParam) {
      this.paramOutputs.add(destination)
      destination.inputs.add(this)
      return destination
    }
    const dest = destination as SimNode
    this.outputs.add(dest)
    dest.inputs.add(this)
    return destination
  }

  disconnect(destination?: NodeLike | ParamLike): void {
    if (destination instanceof SimParam) {
      this.paramOutputs.delete(destination)
      destination.inputs.delete(this)
      return
    }
    if (destination) {
      const dest = destination as SimNode
      this.outputs.delete(dest)
      dest.inputs.delete(this)
      return
    }
    for (const out of this.outputs) out.inputs.delete(this)
    for (const p of this.paramOutputs) p.inputs.delete(this)
    this.outputs.clear()
    this.paramOutputs.clear()
  }

  protected sumInputs(frame: number): void {
    let l = 0
    let r = 0
    let stereo = false
    for (const input of this.inputs) {
      input.pull(frame)
      l += input.l
      r += input.r
      if (input.stereo) stereo = true
    }
    this.inL = l
    this.inR = r
    this.inStereo = stereo
  }

  pull(frame: number): void {
    if (frame === this.cacheFrame) return
    if (this.busy) {
      // A cycle without a DelayNode: Web Audio mutes it; so do we.
      this.l = 0
      this.r = 0
      return
    }
    this.busy = true
    this.process(frame)
    this.cacheFrame = frame
    this.busy = false
  }

  protected param(p: SimParam, frame: number): number {
    return p.computed(frame, this.ctx.sampleRate)
  }

  protected abstract process(frame: number): void
}

class SimDestination extends SimNode {
  protected process(frame: number): void {
    this.sumInputs(frame)
    this.l = this.inL
    this.r = this.inR
    this.stereo = this.inStereo
  }
}

class SimGain extends SimNode implements GainLike {
  readonly gain = new SimParam(1)
  protected process(frame: number): void {
    // A static zero gain outputs silence without pulling (sources advance on their own clock).
    if (this.gain.constantAfter(frame / this.ctx.sampleRate) === 0) {
      this.l = 0
      this.r = 0
      this.stereo = false
      return
    }
    this.sumInputs(frame)
    const g = this.param(this.gain, frame)
    this.l = this.inL * g
    this.r = this.inR * g
    this.stereo = this.inStereo
  }
}

interface Coeffs {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

/** Biquad coefficients exactly as the Web Audio specification defines them. */
export function biquadCoefficients(type: string, f: number, Q: number, gainDb: number, sampleRate: number): Coeffs {
  const w0 = (2 * Math.PI * Math.min(Math.max(f, 1), sampleRate * 0.4999)) / sampleRate
  const cos = Math.cos(w0)
  const sin = Math.sin(w0)
  const A = Math.pow(10, gainDb / 40)
  const aQ = sin / (2 * Math.max(Q, 0.0001))
  const aQdB = sin / (2 * Math.pow(10, Q / 20))
  const aS = (sin / 2) * Math.SQRT2
  let b0 = 1
  let b1 = 0
  let b2 = 0
  let a0 = 1
  let a1 = 0
  let a2 = 0
  switch (type) {
    case 'lowpass':
      b0 = (1 - cos) / 2
      b1 = 1 - cos
      b2 = (1 - cos) / 2
      a0 = 1 + aQdB
      a1 = -2 * cos
      a2 = 1 - aQdB
      break
    case 'highpass':
      b0 = (1 + cos) / 2
      b1 = -(1 + cos)
      b2 = (1 + cos) / 2
      a0 = 1 + aQdB
      a1 = -2 * cos
      a2 = 1 - aQdB
      break
    case 'bandpass':
      b0 = aQ
      b1 = 0
      b2 = -aQ
      a0 = 1 + aQ
      a1 = -2 * cos
      a2 = 1 - aQ
      break
    case 'notch':
      b0 = 1
      b1 = -2 * cos
      b2 = 1
      a0 = 1 + aQ
      a1 = -2 * cos
      a2 = 1 - aQ
      break
    case 'allpass':
      b0 = 1 - aQ
      b1 = -2 * cos
      b2 = 1 + aQ
      a0 = 1 + aQ
      a1 = -2 * cos
      a2 = 1 - aQ
      break
    case 'peaking':
      b0 = 1 + aQ * A
      b1 = -2 * cos
      b2 = 1 - aQ * A
      a0 = 1 + aQ / A
      a1 = -2 * cos
      a2 = 1 - aQ / A
      break
    case 'lowshelf': {
      const s = 2 * aS * Math.sqrt(A)
      b0 = A * (A + 1 - (A - 1) * cos + s)
      b1 = 2 * A * (A - 1 - (A + 1) * cos)
      b2 = A * (A + 1 - (A - 1) * cos - s)
      a0 = A + 1 + (A - 1) * cos + s
      a1 = -2 * (A - 1 + (A + 1) * cos)
      a2 = A + 1 + (A - 1) * cos - s
      break
    }
    case 'highshelf': {
      const s = 2 * aS * Math.sqrt(A)
      b0 = A * (A + 1 + (A - 1) * cos + s)
      b1 = -2 * A * (A - 1 + (A + 1) * cos)
      b2 = A * (A + 1 + (A - 1) * cos - s)
      a0 = A + 1 - (A - 1) * cos + s
      a1 = 2 * (A - 1 - (A + 1) * cos)
      a2 = A + 1 - (A - 1) * cos - s
      break
    }
    default:
      throw new Error(`Unsupported biquad type ${type}`)
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

class SimBiquad extends SimNode implements BiquadLike {
  type = 'lowpass'
  readonly frequency = new SimParam(350)
  readonly detune = new SimParam(0)
  readonly Q = new SimParam(1)
  readonly gain = new SimParam(0)
  private s = new Float64Array(8) // x1,x2,y1,y2 for L then R
  private lastType = ''
  private lastF = NaN
  private lastQ = NaN
  private lastG = NaN
  private c: Coeffs = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }

  protected process(frame: number): void {
    const cents = this.param(this.detune, frame)
    const f0 = this.param(this.frequency, frame)
    const f = Math.min(this.ctx.sampleRate / 2, cents === 0 ? f0 : f0 * Math.pow(2, cents / 1200))
    const q = this.param(this.Q, frame)
    const g = this.param(this.gain, frame)
    if (f !== this.lastF || q !== this.lastQ || g !== this.lastG || this.type !== this.lastType) {
      this.lastF = f
      this.lastQ = q
      this.lastG = g
      this.lastType = this.type
      this.c = biquadCoefficients(this.type, f, q, g, this.ctx.sampleRate)
    }
    this.sumInputs(frame)
    const { b0, b1, b2, a1, a2 } = this.c
    const s = this.s
    const yl = b0 * this.inL + b1 * s[0] + b2 * s[1] - a1 * s[2] - a2 * s[3]
    s[1] = s[0]
    s[0] = this.inL
    s[3] = s[2]
    s[2] = yl
    const yr = b0 * this.inR + b1 * s[4] + b2 * s[5] - a1 * s[6] - a2 * s[7]
    s[5] = s[4]
    s[4] = this.inR
    s[7] = s[6]
    s[6] = yr
    this.l = yl
    this.r = yr
    this.stereo = this.inStereo
  }
}

/** Delay line; its input is written after each frame so feedback cycles work (min 1 frame). */
class SimDelay extends SimNode implements DelayLike {
  readonly delayTime = new SimParam(0)
  private readonly bufL: Float32Array
  private readonly bufR: Float32Array
  private readonly size: number
  private written = -1
  private writtenStereo = false

  constructor(ctx: SimAudioContext, readonly maxDelayTime: number) {
    super(ctx)
    this.size = Math.ceil(maxDelayTime * ctx.sampleRate) + 4
    this.bufL = new Float32Array(this.size)
    this.bufR = new Float32Array(this.size)
    ctx.delays.add(this)
  }

  protected process(frame: number): void {
    const sr = this.ctx.sampleRate
    const d = Math.min(Math.max(this.param(this.delayTime, frame) * sr, 1), this.size - 3)
    const pos = frame - d
    const i = Math.floor(pos)
    const frac = pos - i
    const read = (buf: Float32Array, n: number) => (n < 0 || n > this.written ? 0 : buf[n % this.size])
    this.l = read(this.bufL, i) * (1 - frac) + read(this.bufL, i + 1) * frac
    this.r = read(this.bufR, i) * (1 - frac) + read(this.bufR, i + 1) * frac
    this.stereo = this.writtenStereo
  }

  /** Called by the context after every frame: pull the input for that frame into the line. */
  tick(frame: number): void {
    this.sumInputs(frame)
    this.bufL[frame % this.size] = this.inL
    this.bufR[frame % this.size] = this.inR
    this.written = frame
    if (this.inStereo) this.writtenStereo = true
  }
}

class SimWaveShaper extends SimNode implements WaveShaperLike {
  curve: Float32Array | null = null
  private shape(x: number): number {
    const c = this.curve
    if (!c || c.length === 0) return x
    const n = c.length
    const v = ((x + 1) * (n - 1)) / 2
    if (v <= 0) return c[0]
    if (v >= n - 1) return c[n - 1]
    const i = Math.floor(v)
    const f = v - i
    return c[i] * (1 - f) + c[i + 1] * f
  }
  protected process(frame: number): void {
    this.sumInputs(frame)
    this.l = this.shape(this.inL)
    this.r = this.inStereo ? this.shape(this.inR) : this.l
    this.stereo = this.inStereo
  }
}

class SimStereoPanner extends SimNode implements StereoPannerLike {
  readonly pan = new SimParam(0)
  protected process(frame: number): void {
    this.sumInputs(frame)
    const p = Math.min(1, Math.max(-1, this.param(this.pan, frame)))
    if (!this.inStereo) {
      const x = ((p + 1) / 2) * (Math.PI / 2)
      this.l = this.inL * Math.cos(x)
      this.r = this.inL * Math.sin(x)
    } else if (p <= 0) {
      const x = (p + 1) * (Math.PI / 2)
      this.l = this.inL + this.inR * Math.cos(x)
      this.r = this.inR * Math.sin(x)
    } else {
      const x = p * (Math.PI / 2)
      this.l = this.inL * Math.cos(x)
      this.r = this.inR + this.inL * Math.sin(x)
    }
    this.stereo = true
  }
}

class SimCompressor extends SimNode implements CompressorLike {
  readonly threshold = new SimParam(-24)
  readonly knee = new SimParam(30)
  readonly ratio = new SimParam(12)
  readonly attack = new SimParam(0.003)
  readonly release = new SimParam(0.25)
  reduction = 0

  private curve(db: number, T: number, W: number, R: number): number {
    const over = db - T
    if (2 * over < -W) return db
    if (W > 0 && 2 * Math.abs(over) <= W) return db + ((1 / R - 1) * (over + W / 2) ** 2) / (2 * W)
    return T + over / R
  }

  protected process(frame: number): void {
    this.sumInputs(frame)
    const sr = this.ctx.sampleRate
    const T = this.param(this.threshold, frame)
    const W = Math.max(0, this.param(this.knee, frame))
    const R = Math.max(1, this.param(this.ratio, frame))
    const level = Math.max(Math.abs(this.inL), Math.abs(this.inR))
    const db = level > 1e-10 ? 20 * Math.log10(level) : -200
    const target = Math.min(0, this.curve(db, T, W, R) - db)
    const tau = target < this.reduction ? this.param(this.attack, frame) : this.param(this.release, frame)
    this.reduction += (target - this.reduction) * (1 - Math.exp(-1 / (Math.max(tau, 1e-4) * sr)))
    // Automatic make-up gain, as browsers apply: (full-scale gain)^-0.6.
    const makeupDb = -0.6 * Math.min(0, this.curve(0, T, W, R))
    const g = Math.pow(10, (this.reduction + makeupDb) / 20)
    this.l = this.inL * g
    this.r = this.inR * g
    this.stereo = this.inStereo
  }
}

// ---- zero-latency uniformly partitioned convolution (direct head + FFT tail) ----

const BLOCK = 128
const N = BLOCK * 2

function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k]
        const ai = im[i + k]
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k] = ar + br
        im[i + k] = ai + bi
        re[i + k + len / 2] = ar - br
        im[i + k + len / 2] = ai - bi
        const t = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = t
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) {
    re[i] /= n
    im[i] /= n
  }
}

class ConvChannel {
  private readonly head: Float64Array
  private readonly parts: { re: Float64Array; im: Float64Array }[] = []
  private readonly fdl: { re: Float64Array; im: Float64Array }[] = []
  private readonly hist = new Float64Array(N) // last 2 blocks of input
  private tail = new Float64Array(BLOCK)
  private n = 0

  constructor(ir: Float32Array, scale: number) {
    this.head = new Float64Array(BLOCK)
    for (let i = 0; i < Math.min(BLOCK, ir.length); i++) this.head[i] = ir[i] * scale
    for (let p = 1; p * BLOCK < ir.length; p++) {
      const re = new Float64Array(N)
      const im = new Float64Array(N)
      for (let j = 0; j < BLOCK && p * BLOCK + j < ir.length; j++) re[j] = ir[p * BLOCK + j] * scale
      fft(re, im, false)
      this.parts.push({ re, im })
    }
  }

  process(x: number): number {
    const i = this.n % BLOCK
    if (i === 0 && this.n > 0 && this.parts.length) {
      // A block just completed: transform [previous block, this block] and compute the tail.
      const re = Float64Array.from(this.hist)
      const im = new Float64Array(N)
      fft(re, im, false)
      this.fdl.unshift({ re, im })
      if (this.fdl.length > this.parts.length) this.fdl.pop()
      const yr = new Float64Array(N)
      const yi = new Float64Array(N)
      for (let p = 0; p < this.fdl.length; p++) {
        const X = this.fdl[p]
        const H = this.parts[p]
        for (let k = 0; k < N; k++) {
          yr[k] += X.re[k] * H.re[k] - X.im[k] * H.im[k]
          yi[k] += X.re[k] * H.im[k] + X.im[k] * H.re[k]
        }
      }
      fft(yr, yi, true)
      this.tail = yr.slice(BLOCK)
    }
    if (i === 0) this.hist.copyWithin(0, BLOCK)
    this.hist[BLOCK + i] = x
    let y = this.parts.length && this.n >= BLOCK ? this.tail[i] : 0
    for (let k = 0; k < BLOCK; k++) {
      const idx = BLOCK + i - k
      if (idx < BLOCK && this.n - k < 0) break
      y += this.head[k] * this.hist[idx]
    }
    this.n++
    return y
  }
}

class SimConvolver extends SimNode implements ConvolverLike {
  normalize = true
  private buf: BufferLike | null = null
  private chans: ConvChannel[] = []

  get buffer(): BufferLike | null {
    return this.buf
  }

  set buffer(b: BufferLike | null) {
    this.buf = b
    this.chans = []
    if (!b) return
    let scale = 1
    if (this.normalize) {
      let power = 0
      for (let c = 0; c < b.numberOfChannels; c++) for (const v of b.getChannelData(c)) power += v * v
      power = Math.sqrt(power / (b.numberOfChannels * b.length))
      scale = 0.00125 / Math.max(power, 0.000125)
    }
    const c0 = b.getChannelData(0)
    const c1 = b.numberOfChannels > 1 ? b.getChannelData(1) : c0
    this.chans = [new ConvChannel(c0, scale), new ConvChannel(c1, scale)]
  }

  protected process(frame: number): void {
    this.sumInputs(frame)
    if (!this.buf || this.chans.length === 0) {
      this.l = 0
      this.r = 0
      this.stereo = false
      return
    }
    this.l = this.chans[0].process(this.inL)
    this.r = this.chans[1].process(this.inR)
    this.stereo = this.inStereo || this.buf.numberOfChannels > 1
  }
}

abstract class SimScheduled extends SimNode {
  onended: (() => void) | null = null
  startTime = Infinity
  stopTime = Infinity
  ended = false
  started = false

  start(when = 0): void {
    if (this.started) throw new Error('InvalidStateError: start() called twice')
    this.started = true
    this.startTime = Math.max(when, this.ctx.currentTime)
  }

  stop(when = 0): void {
    if (!this.started) throw new Error('InvalidStateError: stop() before start()')
    this.stopTime = Math.max(when, this.ctx.currentTime)
    // stop() at or before currentTime silences the source at once, like real Web Audio.
    if (when <= this.ctx.currentTime) this.end()
  }

  /** Mark the source ended and queue its onended for the next block boundary. */
  end(): void {
    if (!this.started || this.ended) return
    this.ended = true
    this.ctx.pendingEnded.push(this)
  }

  protected active(t: number): boolean {
    return this.started && !this.ended && t >= this.startTime && t < this.stopTime
  }

  /** Called once per rendered frame after processing; marks natural or scheduled end. */
  checkEnded(t: number): void {
    if (!this.started || this.ended) return
    if (t >= this.stopTime || this.naturallyFinished()) this.end()
  }

  protected naturallyFinished(): boolean {
    return false
  }
}

class SimBufferSource extends SimScheduled implements BufferSourceLike {
  buffer: BufferLike | null = null
  loop = false
  readonly playbackRate = new SimParam(1)
  readonly detune = new SimParam(0)
  private position = 0

  protected process(frame: number): void {
    this.stereo = false
    const t = frame / this.ctx.sampleRate
    if (!this.active(t) || !this.buffer) {
      this.l = this.r = 0
      return
    }
    const data = this.buffer.getChannelData(0)
    if (this.loop) {
      const n = data.length
      this.position = ((this.position % n) + n) % n
      const i = Math.floor(this.position)
      const frac = this.position - i
      this.l = this.r = data[i] * (1 - frac) + data[(i + 1) % n] * frac
      this.position += this.rate(frame)
      return
    }
    const i = Math.floor(this.position)
    if (i >= data.length - 1) {
      this.position = data.length
      this.l = this.r = 0
      return
    }
    const frac = this.position - i
    const out = data[i] * (1 - frac) + data[i + 1] * frac
    this.position += this.rate(frame)
    this.l = this.r = out
  }

  private rate(frame: number): number {
    const cents = this.param(this.detune, frame)
    const r = this.param(this.playbackRate, frame) * (cents === 0 ? 1 : Math.pow(2, cents / 1200))
    return (r * this.buffer!.sampleRate) / this.ctx.sampleRate
  }

  protected naturallyFinished(): boolean {
    return !this.loop && !!this.buffer && this.position >= this.buffer.length - 1
  }
}

/** A periodic wave as one normalised cycle (inverse DFT of the given coefficients, peak 1). */
export class SimPeriodicWave {
  static readonly SIZE = 2048
  readonly table: Float32Array
  constructor(real: Float32Array, imag: Float32Array) {
    const n = SimPeriodicWave.SIZE
    const t = new Float32Array(n)
    const harmonics = Math.min(real.length, imag.length)
    for (let k = 1; k < harmonics; k++) {
      const a = real[k]
      const b = imag[k]
      if (a === 0 && b === 0) continue
      for (let i = 0; i < n; i++) {
        const x = (2 * Math.PI * k * i) / n
        t[i] += a * Math.cos(x) + b * Math.sin(x)
      }
    }
    let p = 0
    for (const v of t) p = Math.max(p, Math.abs(v))
    if (p > 0) for (let i = 0; i < n; i++) t[i] /= p
    this.table = t
  }
}

class SimConstantSource extends SimScheduled implements ConstantSourceLike {
  readonly offset = new SimParam(1)
  protected process(frame: number): void {
    this.stereo = false
    const t = frame / this.ctx.sampleRate
    this.l = this.r = this.active(t) ? this.param(this.offset, frame) : 0
  }
}

class SimOscillator extends SimScheduled implements OscillatorLike {
  type = 'sine'
  readonly frequency = new SimParam(440)
  readonly detune = new SimParam(0)
  private phase = 0
  private wave: SimPeriodicWave | null = null

  setPeriodicWave(wave: PeriodicWaveLike): void {
    this.wave = wave as SimPeriodicWave
    this.type = 'custom'
  }

  protected process(frame: number): void {
    this.stereo = false
    const t = frame / this.ctx.sampleRate
    if (!this.active(t)) {
      this.l = this.r = 0
      return
    }
    const p = this.phase
    const cents = this.param(this.detune, frame)
    const f = this.param(this.frequency, frame) * (cents === 0 ? 1 : Math.pow(2, cents / 1200))
    this.phase = (this.phase + f / this.ctx.sampleRate) % 1
    if (this.phase < 0) this.phase += 1
    let v: number
    switch (this.type) {
      case 'custom': {
        const table = this.wave!.table
        const x = p * table.length
        const i = Math.floor(x)
        const fr = x - i
        v = table[i % table.length] * (1 - fr) + table[(i + 1) % table.length] * fr
        break
      }
      case 'triangle':
        v = 1 - 4 * Math.abs(p - 0.5)
        break
      case 'square':
        v = p < 0.5 ? 1 : -1
        break
      case 'sawtooth':
        v = p < 0.5 ? 2 * p : 2 * p - 2
        break
      default:
        v = Math.sin(2 * Math.PI * p)
    }
    this.l = this.r = v
  }
}

class SimBuffer implements BufferLike {
  private readonly channels: Float32Array[]
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length))
  }
  get duration(): number {
    return this.length / this.sampleRate
  }
  getChannelData(channel: number): Float32Array {
    return this.channels[channel]
  }
  copyToChannel(source: Float32Array, channel: number): void {
    this.channels[channel].set(source.subarray(0, this.length))
  }
}

export interface StereoRender {
  left: Float32Array
  right: Float32Array
}

export class SimAudioContext implements AudioContextLike {
  readonly registry = new Set<SimNode>()
  readonly delays = new Set<SimDelay>()
  readonly pendingEnded: SimScheduled[] = []
  readonly destination: SimDestination
  state: string
  frame = 0
  closed = false

  constructor(
    readonly sampleRate = 16000,
    initialState: 'running' | 'suspended' = 'running',
  ) {
    this.state = initialState
    this.destination = new SimDestination(this)
  }

  get currentTime(): number {
    return this.frame / this.sampleRate
  }

  createGain(): GainLike {
    return new SimGain(this)
  }
  createBiquadFilter(): BiquadLike {
    return new SimBiquad(this)
  }
  createBufferSource(): BufferSourceLike {
    return new SimBufferSource(this)
  }
  createOscillator(): OscillatorLike {
    return new SimOscillator(this)
  }
  createDelay(maxDelayTime = 1): DelayLike {
    return new SimDelay(this, maxDelayTime)
  }
  createWaveShaper(): WaveShaperLike {
    return new SimWaveShaper(this)
  }
  createStereoPanner(): StereoPannerLike {
    return new SimStereoPanner(this)
  }
  createDynamicsCompressor(): CompressorLike {
    return new SimCompressor(this)
  }
  createConvolver(): ConvolverLike {
    return new SimConvolver(this)
  }
  createConstantSource(): ConstantSourceLike {
    return new SimConstantSource(this)
  }
  createPeriodicWave(real: Float32Array, imag: Float32Array): PeriodicWaveLike {
    return new SimPeriodicWave(real, imag)
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    return new SimBuffer(channels, length, sampleRate)
  }
  resume(): Promise<void> {
    if (!this.closed) this.state = 'running'
    return Promise.resolve()
  }
  close(): Promise<void> {
    this.closed = true
    this.state = 'closed'
    // A closed context releases every source it owns.
    for (const node of this.registry) if (node instanceof SimScheduled) node.end()
    return Promise.resolve()
  }

  /** Render `seconds` of stereo output, firing `onended` at 128-frame block boundaries like real Web Audio. */
  renderStereo(seconds: number): StereoRender {
    const n = Math.round(seconds * this.sampleRate)
    const left = new Float32Array(n)
    const right = new Float32Array(n)
    const scheduled = () => [...this.registry].filter((node): node is SimScheduled => node instanceof SimScheduled)
    let live = scheduled().filter((s) => s.started && !s.ended)
    for (let i = 0; i < n; i++) {
      const frame = this.frame
      if (this.state === 'running') {
        this.destination.pull(frame)
        left[i] = this.destination.l
        right[i] = this.destination.r
        // Sources run on their own clock even when nothing currently pulls them.
        for (const s of live) s.pull(frame)
        for (const d of this.delays) if (d.outputs.size || d.paramOutputs.size) d.tick(frame)
        this.frame++
      }
      const t = this.currentTime
      if (i % 128 === 127 || i === n - 1) {
        const all = scheduled()
        for (const node of all) node.checkEnded(t)
        this.flushEnded()
        live = all.filter((s) => s.started && !s.ended)
      }
    }
    return { left, right }
  }

  /** Render `seconds` of output as mono ((L + R) / 2; identical to the signal for mono graphs). */
  render(seconds: number): Float32Array {
    const { left, right } = this.renderStereo(seconds)
    const out = new Float32Array(left.length)
    for (let i = 0; i < out.length; i++) out[i] = (left[i] + right[i]) / 2
    return out
  }

  private flushEnded() {
    while (this.pendingEnded.length) {
      const node = this.pendingEnded.shift()!
      node.onended?.()
    }
  }

  /** Nodes with at least one connection (the master → destination link counts as one). */
  connectedNodeCount(): number {
    let n = 0
    for (const node of this.registry) if (node !== this.destination && (node.outputs.size > 0 || node.paramOutputs.size > 0)) n++
    return n
  }

  /**
   * Scheduled sources that were started and have not ended — voices. Free-running modulators
   * (oscillators started with no stop time, i.e. LFOs) are counted by liveModulatorCount().
   */
  liveSourceCount(): number {
    let n = 0
    for (const node of this.registry) if (node instanceof SimScheduled && node.started && !node.ended && !this.isModulator(node)) n++
    return n
  }

  liveModulatorCount(): number {
    let n = 0
    for (const node of this.registry) if (node instanceof SimScheduled && node.started && !node.ended && this.isModulator(node)) n++
    return n
  }

  /** Free-running modulators: oscillators and constant sources started without a stop time. */
  private isModulator(node: SimScheduled): boolean {
    return (node instanceof SimOscillator || node instanceof SimConstantSource) && node.stopTime === Infinity
  }
}

export function rms(samples: Float32Array, from = 0, to = samples.length): number {
  let s = 0
  const a = Math.max(0, from)
  const b = Math.min(samples.length, to)
  for (let i = a; i < b; i++) s += samples[i] * samples[i]
  return b > a ? Math.sqrt(s / (b - a)) : 0
}

export function peak(samples: Float32Array): number {
  let p = 0
  for (const x of samples) p = Math.max(p, Math.abs(x))
  return p
}

/** Mean absolute sample-to-sample difference relative to RMS: a crude brightness measure. */
export function brightness(samples: Float32Array, from = 0, to = samples.length): number {
  let d = 0
  let s = 0
  for (let i = Math.max(1, from); i < Math.min(to, samples.length); i++) {
    d += (samples[i] - samples[i - 1]) ** 2
    s += samples[i] ** 2
  }
  return s > 0 ? Math.sqrt(d / s) : 0
}

/** Normalised difference between two signals (0 = identical). */
export function difference(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let d = 0
  let s = 0
  for (let i = 0; i < n; i++) {
    d += (a[i] - b[i]) ** 2
    s += a[i] ** 2 + b[i] ** 2
  }
  return s > 0 ? Math.sqrt(d / s) : 0
}
