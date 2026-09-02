/**
 * Deterministic in-memory stand-in for the Web Audio subset used by the engine. Records node
 * creation, connections, scheduled automation, start/stop times and fires `onended` when the fake
 * clock is advanced past a source's stop time. Renders nothing.
 */
import type {
  AudioBufferLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BufferSourceLike,
  GainNodeLike,
  OscillatorLike,
  Timers,
} from './boundaries'

export interface ParamEvent {
  type: 'set' | 'linear' | 'exponential' | 'target' | 'cancel'
  value: number
  time: number
}

export class FakeParam implements AudioParamLike {
  events: ParamEvent[] = []
  constructor(public value: number) {}
  setValueAtTime(value: number, time: number) {
    this.value = value
    this.events.push({ type: 'set', value, time })
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.value = value
    this.events.push({ type: 'linear', value, time })
  }
  exponentialRampToValueAtTime(value: number, time: number) {
    this.value = value
    this.events.push({ type: 'exponential', value, time })
  }
  setTargetAtTime(value: number, time: number) {
    this.value = value
    this.events.push({ type: 'target', value, time })
  }
  cancelScheduledValues(time: number) {
    this.events.push({ type: 'cancel', value: this.value, time })
  }
}

export class FakeNode implements AudioNodeLike {
  connections: AudioNodeLike[] = []
  disconnected = false
  constructor(public readonly ctx: FakeAudioContext, public readonly kind: string) {
    ctx.nodes.push(this)
  }
  connect(destination: AudioNodeLike) {
    this.connections.push(destination)
    return destination
  }
  disconnect() {
    this.disconnected = true
    this.connections = []
  }
  /** True when this node reaches the destination through live connections. */
  reachesDestination(seen = new Set<AudioNodeLike>()): boolean {
    if (this.disconnected) return false
    for (const c of this.connections) {
      if (c === this.ctx.destination) return true
      if (c instanceof FakeNode && !seen.has(c)) {
        seen.add(c)
        if (c.reachesDestination(seen)) return true
      }
    }
    return false
  }
}

export class FakeGain extends FakeNode implements GainNodeLike {
  gain = new FakeParam(1)
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'gain')
  }
}

export class FakeBuffer implements AudioBufferLike {
  private channels: Float32Array[]
  constructor(public readonly numberOfChannels: number, public readonly length: number, public readonly sampleRate: number) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length))
  }
  get duration() {
    return this.length / this.sampleRate
  }
  copyToChannel(source: Float32Array, channel: number) {
    this.channels[channel].set(source.subarray(0, this.length))
  }
  getChannelData(channel: number) {
    return this.channels[channel]
  }
}

export class FakeSource extends FakeNode implements BufferSourceLike {
  buffer: AudioBufferLike | null = null
  playbackRate = new FakeParam(1)
  onended: (() => void) | null = null
  startedAt: number | null = null
  stoppedAt: number | null = null
  ended = false
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'source')
  }
  start(when = this.ctx.currentTime) {
    this.startedAt = when
  }
  stop(when = this.ctx.currentTime) {
    this.stoppedAt = when
  }
  /** Natural end time: explicit stop or buffer end. */
  endTime(): number | null {
    if (this.startedAt === null) return null
    const natural = this.buffer ? this.startedAt + this.buffer.duration : null
    if (this.stoppedAt !== null && natural !== null) return Math.min(this.stoppedAt, natural)
    return this.stoppedAt ?? natural
  }
}

export class FakeOscillator extends FakeNode implements OscillatorLike {
  type = 'sine'
  frequency = new FakeParam(440)
  onended: (() => void) | null = null
  startedAt: number | null = null
  stoppedAt: number | null = null
  ended = false
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'oscillator')
  }
  start(when = this.ctx.currentTime) {
    this.startedAt = when
  }
  stop(when = this.ctx.currentTime) {
    this.stoppedAt = when
  }
  endTime(): number | null {
    return this.stoppedAt
  }
}

export class FakeAudioContext implements AudioContextLike {
  currentTime = 0
  state: 'suspended' | 'running' | 'closed' = 'suspended'
  destination: FakeNode
  nodes: FakeNode[] = []
  resumeCalls = 0
  constructor(public readonly sampleRate = 48000) {
    this.destination = new FakeNode(this, 'destination')
    this.nodes = [] // destination is not counted as an engine-created node
  }
  createGain() {
    return new FakeGain(this)
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    return new FakeBuffer(channels, length, sampleRate)
  }
  createBufferSource() {
    return new FakeSource(this)
  }
  createOscillator() {
    return new FakeOscillator(this)
  }
  async resume() {
    this.resumeCalls++
    if (this.state !== 'closed') this.state = 'running'
  }
  async close() {
    this.state = 'closed'
  }
  /** Advances the clock and fires `onended` for sources whose end time has passed. */
  advance(seconds: number) {
    this.currentTime += seconds
    for (const node of this.nodes) {
      if ((node instanceof FakeSource || node instanceof FakeOscillator) && !node.ended) {
        const end = node.endTime()
        if (end !== null && end <= this.currentTime) {
          node.ended = true
          node.onended?.()
        }
      }
    }
  }
  sources(): FakeSource[] {
    return this.nodes.filter((n): n is FakeSource => n instanceof FakeSource)
  }
  oscillators(): FakeOscillator[] {
    return this.nodes.filter((n): n is FakeOscillator => n instanceof FakeOscillator)
  }
  gains(): FakeGain[] {
    return this.nodes.filter((n): n is FakeGain => n instanceof FakeGain)
  }
  liveNodes(): FakeNode[] {
    return this.nodes.filter((n) => !n.disconnected)
  }
}

/** Manual timers: `run()` executes due callbacks in order. */
export class FakeTimers implements Timers {
  private queue: { at: number; fn: () => void; id: number }[] = []
  private nextId = 1
  time = 0
  setTimeout(fn: () => void, ms: number) {
    const id = this.nextId++
    this.queue.push({ at: this.time + ms, fn, id })
    return id
  }
  clearTimeout(handle: unknown) {
    this.queue = this.queue.filter((q) => q.id !== handle)
  }
  now() {
    return this.time
  }
  pending() {
    return this.queue.length
  }
  /** Advance by ms and run everything that becomes due, including timers scheduled meanwhile. */
  advance(ms: number) {
    const target = this.time + ms
    for (;;) {
      const due = this.queue.filter((q) => q.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0]
      if (!due) break
      this.queue = this.queue.filter((q) => q !== due)
      this.time = Math.max(this.time, due.at)
      due.fn()
    }
    this.time = target
  }
  /** Runs only the earliest pending timer (for stepping through chunked work). */
  runNext(): boolean {
    const due = [...this.queue].sort((a, b) => a.at - b.at || a.id - b.id)[0]
    if (!due) return false
    this.queue = this.queue.filter((q) => q !== due)
    this.time = Math.max(this.time, due.at)
    due.fn()
    return true
  }
  /** Runs every pending timer regardless of its delay. */
  flush() {
    let guard = 0
    while (this.queue.length && guard++ < 10000) this.advance(Math.max(0, Math.min(...this.queue.map((q) => q.at)) - this.time))
  }
}
