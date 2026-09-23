// A small, sample-accurate Web Audio graph simulator used by tests. It implements exactly the
// node types and AudioParam automation the app uses, and renders real samples: the generated
// piano buffers, oscillator waveforms, RBJ low-pass filtering and gain automation all execute,
// so tests can measure loudness, duration and silence without audio hardware.
import type {
  AudioContextLike,
  BiquadLike,
  BufferLike,
  BufferSourceLike,
  GainLike,
  NodeLike,
  OscillatorLike,
  ParamLike,
} from '../audio/webAudioTypes'

type Event =
  | { kind: 'set'; t: number; v: number }
  | { kind: 'linear'; t: number; v: number }
  | { kind: 'target'; t: number; v: number; tau: number }

export class SimParam implements ParamLike {
  private events: Event[] = []
  private base: number

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
    this.events = this.events.filter((e) => e.t < t)
    this.insert({ kind: 'set', t, v: held })
    return this
  }

  valueAt(time: number): number {
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
}

abstract class SimNode implements NodeLike {
  readonly inputs = new Set<SimNode>()
  readonly outputs = new Set<SimNode>()
  private cacheFrame = -1
  private cacheValue = 0

  constructor(readonly ctx: SimAudioContext) {
    ctx.registry.add(this)
  }

  connect(destination: NodeLike): NodeLike {
    const dest = destination as SimNode
    this.outputs.add(dest)
    dest.inputs.add(this)
    return destination
  }

  disconnect(): void {
    for (const out of this.outputs) out.inputs.delete(this)
    this.outputs.clear()
  }

  protected sumInputs(frame: number): number {
    let s = 0
    for (const input of this.inputs) s += input.pull(frame)
    return s
  }

  pull(frame: number): number {
    if (frame !== this.cacheFrame) {
      this.cacheFrame = frame
      this.cacheValue = this.process(frame)
    }
    return this.cacheValue
  }

  protected abstract process(frame: number): number
}

class SimDestination extends SimNode {
  protected process(frame: number): number {
    return this.sumInputs(frame)
  }
}

class SimGain extends SimNode implements GainLike {
  readonly gain = new SimParam(1)
  protected process(frame: number): number {
    return this.sumInputs(frame) * this.gain.valueAt(frame / this.ctx.sampleRate)
  }
}

class SimBiquad extends SimNode implements BiquadLike {
  type = 'lowpass'
  readonly frequency = new SimParam(350)
  readonly Q = new SimParam(1)
  private x1 = 0
  private x2 = 0
  private y1 = 0
  private y2 = 0
  private coeffKey = ''
  private c = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }

  protected process(frame: number): number {
    const t = frame / this.ctx.sampleRate
    const f = Math.min(this.frequency.valueAt(t), this.ctx.sampleRate * 0.49)
    const q = Math.max(0.0001, this.Q.valueAt(t))
    const key = `${f}:${q}`
    if (key !== this.coeffKey) {
      this.coeffKey = key
      const w0 = (2 * Math.PI * f) / this.ctx.sampleRate
      const alpha = Math.sin(w0) / (2 * q)
      const cos = Math.cos(w0)
      const a0 = 1 + alpha
      this.c = { b0: (1 - cos) / 2 / a0, b1: (1 - cos) / a0, b2: (1 - cos) / 2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 }
    }
    const x = this.sumInputs(frame)
    const { b0, b1, b2, a1, a2 } = this.c
    const y = b0 * x + b1 * this.x1 + b2 * this.x2 - a1 * this.y1 - a2 * this.y2
    this.x2 = this.x1
    this.x1 = x
    this.y2 = this.y1
    this.y1 = y
    return y
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
  readonly playbackRate = new SimParam(1)
  private position = 0

  protected process(frame: number): number {
    const t = frame / this.ctx.sampleRate
    if (!this.active(t) || !this.buffer) return 0
    const data = this.buffer.getChannelData(0)
    const i = Math.floor(this.position)
    if (i >= data.length - 1) {
      this.position = data.length
      return 0
    }
    const frac = this.position - i
    const out = data[i] * (1 - frac) + data[i + 1] * frac
    this.position += (this.playbackRate.valueAt(t) * this.buffer.sampleRate) / this.ctx.sampleRate
    return out
  }

  protected naturallyFinished(): boolean {
    return !!this.buffer && this.position >= this.buffer.length - 1
  }
}

class SimOscillator extends SimScheduled implements OscillatorLike {
  type = 'sine'
  readonly frequency = new SimParam(440)
  private phase = 0

  protected process(frame: number): number {
    const t = frame / this.ctx.sampleRate
    if (!this.active(t)) return 0
    const p = this.phase
    this.phase = (this.phase + this.frequency.valueAt(t) / this.ctx.sampleRate) % 1
    switch (this.type) {
      case 'triangle':
        return 1 - 4 * Math.abs(p - 0.5)
      case 'square':
        return p < 0.5 ? 1 : -1
      case 'sawtooth':
        return 2 * p - 1
      default:
        return Math.sin(2 * Math.PI * p)
    }
  }
}

class SimBuffer implements BufferLike {
  private readonly channels: Float32Array[]
  constructor(
    numberOfChannels: number,
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

export class SimAudioContext implements AudioContextLike {
  readonly registry = new Set<SimNode>()
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

  /** Render `seconds` of output (mono), firing `onended` at 128-frame block boundaries like real Web Audio. */
  render(seconds: number): Float32Array {
    const n = Math.round(seconds * this.sampleRate)
    const out = new Float32Array(n)
    const scheduled = () => [...this.registry].filter((node): node is SimScheduled => node instanceof SimScheduled)
    for (let i = 0; i < n; i++) {
      const frame = this.frame
      out[i] = this.state === 'running' ? this.destination.pull(frame) : 0
      if (this.state === 'running') this.frame++
      const t = this.currentTime
      if (i % 128 === 127 || i === n - 1) {
        for (const node of scheduled()) node.checkEnded(t)
        this.flushEnded()
      }
    }
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
    for (const node of this.registry) if (node !== this.destination && node.outputs.size > 0) n++
    return n
  }

  /** Scheduled sources that were started and have not ended. */
  liveSourceCount(): number {
    let n = 0
    for (const node of this.registry) if (node instanceof SimScheduled && node.started && !node.ended) n++
    return n
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
