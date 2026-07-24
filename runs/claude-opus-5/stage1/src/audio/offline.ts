import type {
  GraphBiquad,
  GraphBuffer,
  GraphBufferSource,
  GraphContext,
  GraphGain,
  GraphNode,
  GraphOscillator,
  GraphParam,
} from './graph'

/**
 * A small deterministic offline implementation of the Web Audio subset in `graph.ts`.
 *
 * Why it exists: the piano voice must be asserted on real signals, and the test environment
 * (jsdom) has no Web Audio implementation at all. Rather than assert against mocks, the tests
 * build the *same* engine graph against this renderer and read the sample data that actually
 * comes out of the destination node. Oscillators, gain automation, buffer playback and the
 * biquad filter are all really evaluated here, sample by sample.
 *
 * It is not a complete Web Audio implementation and does not try to be: it supports exactly the
 * nodes, parameter automation curves and filter types the engine uses.
 */

const BLOCK = 128

type ParamEventKind = 'set' | 'linear' | 'exponential'

interface ParamEvent {
  kind: ParamEventKind
  value: number
  time: number
}

export class OfflineParam implements GraphParam {
  private base: number
  readonly events: ParamEvent[] = []

  constructor(initial: number) {
    this.base = initial
  }

  get value(): number {
    return this.base
  }

  set value(next: number) {
    this.base = next
  }

  setValueAtTime(value: number, startTime: number): this {
    this.insert({ kind: 'set', value, time: startTime })
    return this
  }

  linearRampToValueAtTime(value: number, endTime: number): this {
    this.insert({ kind: 'linear', value, time: endTime })
    return this
  }

  exponentialRampToValueAtTime(value: number, endTime: number): this {
    this.insert({ kind: 'exponential', value, time: endTime })
    return this
  }

  cancelScheduledValues(startTime: number): this {
    for (let index = this.events.length - 1; index >= 0; index -= 1) {
      if (this.events[index].time >= startTime) this.events.splice(index, 1)
    }
    return this
  }

  private insert(event: ParamEvent): void {
    this.events.push(event)
    this.events.sort((a, b) => a.time - b.time)
  }

  valueAt(time: number): number {
    if (this.events.length === 0) return this.base

    let previous: ParamEvent | null = null
    let next: ParamEvent | null = null
    for (const event of this.events) {
      if (event.time <= time) previous = event
      else {
        next = event
        break
      }
    }

    if (!previous) {
      // Only future events: ramps interpolate from the current base value at t=0.
      if (next && next.kind !== 'set') return interpolate(this.base, 0, next, time)
      return this.base
    }

    if (next && next.kind !== 'set') return interpolate(previous.value, previous.time, next, time)
    return previous.value
  }
}

function interpolate(fromValue: number, fromTime: number, target: ParamEvent, time: number): number {
  const span = target.time - fromTime
  if (span <= 0) return target.value
  const ratio = Math.min(1, Math.max(0, (time - fromTime) / span))
  if (target.kind === 'exponential') {
    const start = fromValue === 0 ? 1e-6 : Math.abs(fromValue)
    const end = target.value === 0 ? 1e-6 : Math.abs(target.value)
    const sign = fromValue < 0 || target.value < 0 ? -1 : 1
    return sign * start * Math.pow(end / start, ratio)
  }
  return fromValue + (target.value - fromValue) * ratio
}

abstract class OfflineNode implements GraphNode {
  readonly context: OfflineAudioGraph
  readonly inputs = new Set<OfflineNode>()
  readonly outputs = new Set<OfflineNode>()
  private cachedBlock = -1
  private cached = new Float32Array(BLOCK)
  disposed = false

  constructor(context: OfflineAudioGraph) {
    this.context = context
    context.registerNode(this)
  }

  connect(destination: GraphNode): GraphNode {
    const target = destination as OfflineNode
    this.outputs.add(target)
    target.inputs.add(this)
    return destination
  }

  disconnect(): void {
    for (const target of this.outputs) target.inputs.delete(this)
    this.outputs.clear()
    this.context.unregisterNode(this)
    this.disposed = true
  }

  render(block: number): Float32Array {
    if (this.cachedBlock === block) return this.cached
    this.cachedBlock = block
    const out = new Float32Array(BLOCK)
    this.process(block, out)
    this.cached = out
    return out
  }

  protected sumInputs(block: number, out: Float32Array): void {
    for (const input of this.inputs) {
      const data = input.render(block)
      for (let i = 0; i < BLOCK; i += 1) out[i] += data[i]
    }
  }

  resetRenderState(): void {
    this.cachedBlock = -1
  }

  protected abstract process(block: number, out: Float32Array): void
}

class OfflineDestination extends OfflineNode {
  protected process(block: number, out: Float32Array): void {
    this.sumInputs(block, out)
  }
}

class OfflineGain extends OfflineNode implements GraphGain {
  readonly gain = new OfflineParam(1)

  protected process(block: number, out: Float32Array): void {
    this.sumInputs(block, out)
    const sr = this.context.sampleRate
    const start = (block * BLOCK) / sr
    for (let i = 0; i < BLOCK; i += 1) out[i] *= this.gain.valueAt(start + i / sr)
  }
}

class OfflineOscillator extends OfflineNode implements GraphOscillator {
  type = 'sine'
  readonly frequency = new OfflineParam(440)
  private startTime = Infinity
  private stopTime = Infinity
  private phase = 0

  start(when: number): void {
    this.startTime = when
  }

  stop(when: number): void {
    this.stopTime = when
  }

  resetRenderState(): void {
    super.resetRenderState()
    this.phase = 0
  }

  protected process(block: number, out: Float32Array): void {
    const sr = this.context.sampleRate
    const start = (block * BLOCK) / sr
    for (let i = 0; i < BLOCK; i += 1) {
      const t = start + i / sr
      if (t < this.startTime || t >= this.stopTime) {
        out[i] = 0
        continue
      }
      out[i] = waveform(this.type, this.phase)
      this.phase += this.frequency.valueAt(t) / sr
      if (this.phase >= 1) this.phase -= Math.floor(this.phase)
    }
  }
}

function waveform(type: string, phase: number): number {
  switch (type) {
    case 'square':
      return phase < 0.5 ? 1 : -1
    case 'sawtooth':
      return 2 * phase - 1
    case 'triangle':
      return phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase
    default:
      return Math.sin(2 * Math.PI * phase)
  }
}

export class OfflineBuffer implements GraphBuffer {
  readonly length: number
  readonly sampleRate: number
  readonly numberOfChannels: number
  private readonly channels: Float32Array[]

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels
    this.length = length
    this.sampleRate = sampleRate
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length))
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel]
  }
}

class OfflineBufferSource extends OfflineNode implements GraphBufferSource {
  buffer: GraphBuffer | null = null
  readonly playbackRate = new OfflineParam(1)
  private startTime = Infinity
  private stopTime = Infinity

  start(when: number): void {
    this.startTime = when
  }

  stop(when: number): void {
    this.stopTime = when
  }

  protected process(block: number, out: Float32Array): void {
    const buffer = this.buffer
    if (!buffer) return
    const sr = this.context.sampleRate
    const data = buffer.getChannelData(0)
    const start = (block * BLOCK) / sr
    for (let i = 0; i < BLOCK; i += 1) {
      const t = start + i / sr
      if (t < this.startTime || t >= this.stopTime) continue
      const position = (t - this.startTime) * buffer.sampleRate * this.playbackRate.valueAt(t)
      const index = Math.floor(position)
      if (index < 0 || index >= data.length - 1) continue
      const frac = position - index
      out[i] += data[index] * (1 - frac) + data[index + 1] * frac
    }
  }
}

class OfflineBiquad extends OfflineNode implements GraphBiquad {
  type = 'lowpass'
  readonly frequency = new OfflineParam(350)
  readonly Q = new OfflineParam(1)
  private z1 = 0
  private z2 = 0

  resetRenderState(): void {
    super.resetRenderState()
    this.z1 = 0
    this.z2 = 0
  }

  protected process(block: number, out: Float32Array): void {
    this.sumInputs(block, out)
    const sr = this.context.sampleRate
    const start = (block * BLOCK) / sr
    const cutoff = Math.min(Math.max(this.frequency.valueAt(start), 10), sr * 0.45)
    const q = Math.max(this.Q.valueAt(start), 0.0001)
    const { b0, b1, b2, a1, a2 } = biquadCoefficients(this.type, cutoff, q, sr)
    for (let i = 0; i < BLOCK; i += 1) {
      const x = out[i]
      const y = b0 * x + this.z1
      this.z1 = b1 * x - a1 * y + this.z2
      this.z2 = b2 * x - a2 * y
      out[i] = y
    }
  }
}

function biquadCoefficients(type: string, cutoff: number, q: number, sampleRate: number) {
  const w0 = (2 * Math.PI * cutoff) / sampleRate
  const cos = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * q)
  const a0 = 1 + alpha
  if (type === 'highpass') {
    return {
      b0: ((1 + cos) / 2) / a0,
      b1: (-(1 + cos)) / a0,
      b2: ((1 + cos) / 2) / a0,
      a1: (-2 * cos) / a0,
      a2: (1 - alpha) / a0,
    }
  }
  return {
    b0: ((1 - cos) / 2) / a0,
    b1: (1 - cos) / a0,
    b2: ((1 - cos) / 2) / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  }
}

export class OfflineAudioGraph implements GraphContext {
  readonly sampleRate: number
  readonly destination: OfflineDestination
  state = 'running'
  private clock = 0
  private readonly nodes = new Set<OfflineNode>()

  constructor(sampleRate = 16000) {
    this.sampleRate = sampleRate
    this.destination = new OfflineDestination(this)
  }

  get currentTime(): number {
    return this.clock
  }

  /** Moves the scheduling clock, mirroring the passage of wall time in a live context. */
  advanceClock(seconds: number): void {
    this.clock += seconds
  }

  registerNode(node: OfflineNode): void {
    this.nodes.add(node)
  }

  unregisterNode(node: OfflineNode): void {
    this.nodes.delete(node)
  }

  /** Number of nodes currently in the graph, excluding the destination. */
  get liveNodeCount(): number {
    return this.nodes.size - 1
  }

  createGain(): GraphGain {
    return new OfflineGain(this)
  }

  createBiquadFilter(): GraphBiquad {
    return new OfflineBiquad(this)
  }

  createOscillator(): GraphOscillator {
    return new OfflineOscillator(this)
  }

  createBufferSource(): GraphBufferSource {
    return new OfflineBufferSource(this)
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): GraphBuffer {
    return new OfflineBuffer(numberOfChannels, length, sampleRate)
  }

  async resume(): Promise<void> {
    this.state = 'running'
  }

  async close(): Promise<void> {
    this.state = 'closed'
  }

  /**
   * Renders the destination output from time 0 to `seconds` and returns the samples.
   * Filter and oscillator state is reset first so a render pass is reproducible.
   */
  render(seconds: number): Float32Array {
    for (const node of this.nodes) node.resetRenderState()
    this.destination.resetRenderState()
    const frames = Math.ceil(seconds * this.sampleRate)
    const output = new Float32Array(frames)
    const blocks = Math.ceil(frames / BLOCK)
    for (let block = 0; block < blocks; block += 1) {
      const data = this.destination.render(block)
      const offset = block * BLOCK
      const count = Math.min(BLOCK, frames - offset)
      output.set(data.subarray(0, count), offset)
    }
    return output
  }
}

/* ------------------------------------------------------------------ signal helpers */

export function peak(samples: Float32Array, from = 0, to = samples.length): number {
  let max = 0
  for (let i = from; i < Math.min(to, samples.length); i += 1) max = Math.max(max, Math.abs(samples[i]))
  return max
}

export function rms(samples: Float32Array, from = 0, to = samples.length): number {
  const end = Math.min(to, samples.length)
  if (end <= from) return 0
  let sum = 0
  for (let i = from; i < end; i += 1) sum += samples[i] * samples[i]
  return Math.sqrt(sum / (end - from))
}

/** Time in seconds at which the signal last exceeds `threshold`. */
export function sustainDuration(samples: Float32Array, sampleRate: number, threshold = 1e-3): number {
  for (let i = samples.length - 1; i >= 0; i -= 1) {
    if (Math.abs(samples[i]) > threshold) return (i + 1) / sampleRate
  }
  return 0
}
