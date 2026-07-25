import type {
  GraphBiquad,
  GraphBuffer,
  GraphBufferSource,
  GraphContext,
  GraphDelay,
  GraphGain,
  GraphNode,
  GraphOscillator,
  GraphParam,
  GraphStereoPanner,
  GraphWaveShaper,
} from './graph'

/**
 * A small deterministic offline implementation of the Web Audio subset in `graph.ts`.
 *
 * Why it exists: audio behaviour must be asserted on real signals, and the test environment
 * (jsdom) has no Web Audio implementation at all. Rather than assert against mocks, the tests
 * build the *same* graph the browser builds against this renderer and read the sample data that
 * actually comes out of the destination node. Oscillators, buffer playback, parameter automation,
 * audio-rate modulation, biquads, delay lines, wave shapers and stereo panning are all really
 * evaluated here, sample by sample, in stereo.
 *
 * It is not a complete Web Audio implementation and does not try to be: it supports exactly the
 * nodes, parameter automation curves and filter types the instrument uses. Two documented
 * simplifications: biquad coefficients are recomputed once per 128-sample block rather than per
 * sample, and a node inside a feedback loop reads the previous block (which is what real Web
 * Audio does too — a cycle must contain a delay and gets a one-render-quantum latency).
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
  /** Nodes connected to this parameter: their output is summed onto the automation value. */
  readonly modulators = new Set<OfflineNode>()

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

  /** Automation value plus every connected modulator, one value per sample of the block. */
  fill(out: Float32Array, block: number, sampleRate: number): Float32Array {
    const start = (block * BLOCK) / sampleRate
    for (let i = 0; i < BLOCK; i += 1) out[i] = this.valueAt(start + i / sampleRate)
    for (const modulator of this.modulators) {
      const [left, right] = modulator.render(block)
      for (let i = 0; i < BLOCK; i += 1) out[i] += (left[i] + right[i]) * 0.5
    }
    return out
  }

  /** Single representative value for the block, used where coefficients are per-block. */
  blockValue(block: number, sampleRate: number): number {
    const midpoint = ((block + 0.5) * BLOCK) / sampleRate
    let value = this.valueAt(midpoint)
    for (const modulator of this.modulators) {
      const [left, right] = modulator.render(block)
      let sum = 0
      for (let i = 0; i < BLOCK; i += 1) sum += (left[i] + right[i]) * 0.5
      value += sum / BLOCK
    }
    return value
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

type StereoBlock = readonly [Float32Array, Float32Array]

function silentBlock(): StereoBlock {
  return [new Float32Array(BLOCK), new Float32Array(BLOCK)]
}

abstract class OfflineNode implements GraphNode {
  readonly context: OfflineAudioGraph
  readonly inputs = new Set<OfflineNode>()
  readonly outputs = new Set<OfflineNode>()
  readonly paramOutputs = new Set<OfflineParam>()
  private cachedBlock = -1
  private current: StereoBlock = silentBlock()
  private previous: StereoBlock = silentBlock()
  private rendering = false
  disposed = false

  constructor(context: OfflineAudioGraph) {
    this.context = context
    context.registerNode(this)
  }

  connect(destination: GraphNode | GraphParam): GraphNode | GraphParam {
    if (destination instanceof OfflineParam) {
      destination.modulators.add(this)
      this.paramOutputs.add(destination)
      return destination
    }
    const target = destination as OfflineNode
    this.outputs.add(target)
    target.inputs.add(this)
    return destination
  }

  disconnect(): void {
    for (const target of this.outputs) target.inputs.delete(this)
    this.outputs.clear()
    for (const param of this.paramOutputs) param.modulators.delete(this)
    this.paramOutputs.clear()
    this.context.unregisterNode(this)
    this.disposed = true
  }

  render(block: number): StereoBlock {
    if (this.cachedBlock === block) return this.current
    // Re-entrant render: this node is inside a feedback loop, so it hands back the previous
    // block, exactly like a real Web Audio cycle's one-quantum latency.
    if (this.rendering) return this.previous
    this.rendering = true
    this.previous = this.current
    const left = new Float32Array(BLOCK)
    const right = new Float32Array(BLOCK)
    this.process(block, left, right)
    this.current = [left, right]
    this.cachedBlock = block
    this.rendering = false
    return this.current
  }

  protected sumInputs(block: number, left: Float32Array, right: Float32Array): void {
    for (const input of this.inputs) {
      const [inLeft, inRight] = input.render(block)
      for (let i = 0; i < BLOCK; i += 1) {
        left[i] += inLeft[i]
        right[i] += inRight[i]
      }
    }
  }

  resetRenderState(): void {
    this.cachedBlock = -1
    this.current = silentBlock()
    this.previous = silentBlock()
    this.rendering = false
  }

  protected abstract process(block: number, left: Float32Array, right: Float32Array): void
}

class OfflineDestination extends OfflineNode {
  protected process(block: number, left: Float32Array, right: Float32Array): void {
    this.sumInputs(block, left, right)
  }
}

class OfflineGain extends OfflineNode implements GraphGain {
  readonly gain = new OfflineParam(1)
  private readonly scratch = new Float32Array(BLOCK)

  protected process(block: number, left: Float32Array, right: Float32Array): void {
    this.sumInputs(block, left, right)
    const values = this.gain.fill(this.scratch, block, this.context.sampleRate)
    for (let i = 0; i < BLOCK; i += 1) {
      left[i] *= values[i]
      right[i] *= values[i]
    }
  }
}

class OfflineOscillator extends OfflineNode implements GraphOscillator {
  type = 'sine'
  readonly frequency = new OfflineParam(440)
  private startTime = Infinity
  private stopTime = Infinity
  private phase = 0
  private readonly scratch = new Float32Array(BLOCK)

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

  protected process(block: number, left: Float32Array, right: Float32Array): void {
    const sampleRate = this.context.sampleRate
    const start = (block * BLOCK) / sampleRate
    const frequencies = this.frequency.fill(this.scratch, block, sampleRate)
    for (let i = 0; i < BLOCK; i += 1) {
      const time = start + i / sampleRate
      if (time < this.startTime || time >= this.stopTime) continue
      const sample = waveform(this.type, this.phase)
      left[i] = sample
      right[i] = sample
      this.phase += frequencies[i] / sampleRate
      if (this.phase >= 1) this.phase -= Math.floor(this.phase)
      if (this.phase < 0) this.phase += Math.ceil(-this.phase)
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
    return this.channels[Math.min(channel, this.numberOfChannels - 1)]
  }
}

class OfflineBufferSource extends OfflineNode implements GraphBufferSource {
  buffer: GraphBuffer | null = null
  readonly playbackRate = new OfflineParam(1)
  private startTime = Infinity
  private stopTime = Infinity
  private position = 0
  private readonly scratch = new Float32Array(BLOCK)

  start(when: number): void {
    this.startTime = when
  }

  stop(when: number): void {
    this.stopTime = when
  }

  resetRenderState(): void {
    super.resetRenderState()
    this.position = 0
  }

  protected process(block: number, left: Float32Array, right: Float32Array): void {
    const buffer = this.buffer
    if (!buffer) return
    const sampleRate = this.context.sampleRate
    const start = (block * BLOCK) / sampleRate
    const dataLeft = buffer.getChannelData(0)
    const dataRight = buffer.getChannelData(buffer.numberOfChannels > 1 ? 1 : 0)
    const rates = this.playbackRate.fill(this.scratch, block, sampleRate)
    const step = buffer.sampleRate / sampleRate
    for (let i = 0; i < BLOCK; i += 1) {
      const time = start + i / sampleRate
      if (time < this.startTime || time >= this.stopTime) continue
      const index = Math.floor(this.position)
      if (index >= 0 && index < dataLeft.length - 1) {
        const fraction = this.position - index
        left[i] += dataLeft[index] * (1 - fraction) + dataLeft[index + 1] * fraction
        right[i] += dataRight[index] * (1 - fraction) + dataRight[index + 1] * fraction
      }
      this.position += step * rates[i]
    }
  }
}

class OfflineBiquad extends OfflineNode implements GraphBiquad {
  type = 'lowpass'
  readonly frequency = new OfflineParam(350)
  readonly Q = new OfflineParam(1)
  readonly gain = new OfflineParam(0)
  private state = [
    { z1: 0, z2: 0 },
    { z1: 0, z2: 0 },
  ]

  resetRenderState(): void {
    super.resetRenderState()
    this.state = [
      { z1: 0, z2: 0 },
      { z1: 0, z2: 0 },
    ]
  }

  protected process(block: number, left: Float32Array, right: Float32Array): void {
    this.sumInputs(block, left, right)
    const sampleRate = this.context.sampleRate
    const cutoff = Math.min(Math.max(this.frequency.blockValue(block, sampleRate), 10), sampleRate * 0.45)
    const q = Math.max(this.Q.blockValue(block, sampleRate), 0.0001)
    const gainDb = this.gain.blockValue(block, sampleRate)
    const coefficients = biquadCoefficients(this.type, cutoff, q, gainDb, sampleRate)
    this.runChannel(left, coefficients, 0)
    this.runChannel(right, coefficients, 1)
  }

  private runChannel(data: Float32Array, c: Coefficients, channel: number): void {
    const state = this.state[channel]
    let { z1, z2 } = state
    for (let i = 0; i < BLOCK; i += 1) {
      const x = data[i]
      const y = c.b0 * x + z1
      z1 = c.b1 * x - c.a1 * y + z2
      z2 = c.b2 * x - c.a2 * y
      data[i] = y
    }
    state.z1 = z1
    state.z2 = z2
  }
}

interface Coefficients {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

/** RBJ audio EQ cookbook coefficients — the same formulas Web Audio's BiquadFilterNode uses. */
function biquadCoefficients(
  type: string,
  cutoff: number,
  q: number,
  gainDb: number,
  sampleRate: number,
): Coefficients {
  const w0 = (2 * Math.PI * cutoff) / sampleRate
  const cos = Math.cos(w0)
  const sin = Math.sin(w0)
  const alpha = sin / (2 * q)
  const amplitude = Math.pow(10, gainDb / 40)

  let b0 = 1
  let b1 = 0
  let b2 = 0
  let a0 = 1
  let a1 = 0
  let a2 = 0

  switch (type) {
    case 'highpass':
      b0 = (1 + cos) / 2
      b1 = -(1 + cos)
      b2 = (1 + cos) / 2
      a0 = 1 + alpha
      a1 = -2 * cos
      a2 = 1 - alpha
      break
    case 'bandpass':
      b0 = alpha
      b1 = 0
      b2 = -alpha
      a0 = 1 + alpha
      a1 = -2 * cos
      a2 = 1 - alpha
      break
    case 'notch':
      b0 = 1
      b1 = -2 * cos
      b2 = 1
      a0 = 1 + alpha
      a1 = -2 * cos
      a2 = 1 - alpha
      break
    case 'allpass':
      b0 = 1 - alpha
      b1 = -2 * cos
      b2 = 1 + alpha
      a0 = 1 + alpha
      a1 = -2 * cos
      a2 = 1 - alpha
      break
    case 'peaking':
      b0 = 1 + alpha * amplitude
      b1 = -2 * cos
      b2 = 1 - alpha * amplitude
      a0 = 1 + alpha / amplitude
      a1 = -2 * cos
      a2 = 1 - alpha / amplitude
      break
    case 'lowshelf': {
      const shelf = 2 * Math.sqrt(amplitude) * alpha
      b0 = amplitude * (amplitude + 1 - (amplitude - 1) * cos + shelf)
      b1 = 2 * amplitude * (amplitude - 1 - (amplitude + 1) * cos)
      b2 = amplitude * (amplitude + 1 - (amplitude - 1) * cos - shelf)
      a0 = amplitude + 1 + (amplitude - 1) * cos + shelf
      a1 = -2 * (amplitude - 1 + (amplitude + 1) * cos)
      a2 = amplitude + 1 + (amplitude - 1) * cos - shelf
      break
    }
    case 'highshelf': {
      const shelf = 2 * Math.sqrt(amplitude) * alpha
      b0 = amplitude * (amplitude + 1 + (amplitude - 1) * cos + shelf)
      b1 = -2 * amplitude * (amplitude - 1 + (amplitude + 1) * cos)
      b2 = amplitude * (amplitude + 1 + (amplitude - 1) * cos - shelf)
      a0 = amplitude + 1 - (amplitude - 1) * cos + shelf
      a1 = 2 * (amplitude - 1 - (amplitude + 1) * cos)
      a2 = amplitude + 1 - (amplitude - 1) * cos - shelf
      break
    }
    default:
      b0 = (1 - cos) / 2
      b1 = 1 - cos
      b2 = (1 - cos) / 2
      a0 = 1 + alpha
      a1 = -2 * cos
      a2 = 1 - alpha
      break
  }

  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

class OfflineDelay extends OfflineNode implements GraphDelay {
  readonly delayTime = new OfflineParam(0)
  private readonly maxDelay: number
  private lines: Float32Array[]
  private writeIndex = 0
  private readonly scratch = new Float32Array(BLOCK)
  private readonly inLeft = new Float32Array(BLOCK)
  private readonly inRight = new Float32Array(BLOCK)

  constructor(context: OfflineAudioGraph, maxDelayTime: number) {
    super(context)
    this.maxDelay = Math.max(0.001, maxDelayTime)
    const frames = Math.ceil(this.maxDelay * context.sampleRate) + 2
    this.lines = [new Float32Array(frames), new Float32Array(frames)]
  }

  resetRenderState(): void {
    super.resetRenderState()
    this.lines = this.lines.map((line) => new Float32Array(line.length))
    this.writeIndex = 0
  }

  protected process(block: number, left: Float32Array, right: Float32Array): void {
    this.inLeft.fill(0)
    this.inRight.fill(0)
    this.sumInputs(block, this.inLeft, this.inRight)
    const sampleRate = this.context.sampleRate
    const times = this.delayTime.fill(this.scratch, block, sampleRate)
    const size = this.lines[0].length
    for (let i = 0; i < BLOCK; i += 1) {
      this.lines[0][this.writeIndex] = this.inLeft[i]
      this.lines[1][this.writeIndex] = this.inRight[i]
      const delaySamples = Math.min(Math.max(times[i], 0), this.maxDelay) * sampleRate
      const readPosition = this.writeIndex - delaySamples + size
      const base = Math.floor(readPosition)
      const fraction = readPosition - base
      const indexA = base % size
      const indexB = (base + 1) % size
      left[i] = this.lines[0][indexA] * (1 - fraction) + this.lines[0][indexB] * fraction
      right[i] = this.lines[1][indexA] * (1 - fraction) + this.lines[1][indexB] * fraction
      this.writeIndex = (this.writeIndex + 1) % size
    }
  }
}

class OfflineWaveShaper extends OfflineNode implements GraphWaveShaper {
  curve: Float32Array | null = null
  oversample = 'none'

  protected process(block: number, left: Float32Array, right: Float32Array): void {
    this.sumInputs(block, left, right)
    const curve = this.curve
    if (!curve || curve.length < 2) return
    shapeChannel(left, curve)
    shapeChannel(right, curve)
  }
}

function shapeChannel(data: Float32Array, curve: Float32Array): void {
  const last = curve.length - 1
  for (let i = 0; i < BLOCK; i += 1) {
    const x = Math.min(1, Math.max(-1, data[i]))
    const position = (x + 1) * 0.5 * last
    const index = Math.min(last - 1, Math.floor(position))
    const fraction = position - index
    data[i] = curve[index] * (1 - fraction) + curve[index + 1] * fraction
  }
}

class OfflineStereoPanner extends OfflineNode implements GraphStereoPanner {
  readonly pan = new OfflineParam(0)
  private readonly scratch = new Float32Array(BLOCK)

  protected process(block: number, left: Float32Array, right: Float32Array): void {
    this.sumInputs(block, left, right)
    const values = this.pan.fill(this.scratch, block, this.context.sampleRate)
    // The stereo-input panning algorithm from the Web Audio specification.
    for (let i = 0; i < BLOCK; i += 1) {
      const pan = Math.min(1, Math.max(-1, values[i]))
      const inLeft = left[i]
      const inRight = right[i]
      if (pan <= 0) {
        const angle = ((pan + 1) * Math.PI) / 2
        left[i] = inLeft + inRight * Math.cos(angle)
        right[i] = inRight * Math.sin(angle)
      } else {
        const angle = (pan * Math.PI) / 2
        left[i] = inLeft * Math.cos(angle)
        right[i] = inRight + inLeft * Math.sin(angle)
      }
    }
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

  createDelay(maxDelayTime = 1): GraphDelay {
    return new OfflineDelay(this, maxDelayTime)
  }

  createWaveShaper(): GraphWaveShaper {
    return new OfflineWaveShaper(this)
  }

  createStereoPanner(): GraphStereoPanner {
    return new OfflineStereoPanner(this)
  }

  async resume(): Promise<void> {
    this.state = 'running'
  }

  async close(): Promise<void> {
    this.state = 'closed'
  }

  /**
   * Renders the destination output from time 0 to `seconds` in stereo. Node state (filters,
   * oscillator phase, delay lines) is reset first so a render pass is reproducible.
   */
  renderStereo(seconds: number): { left: Float32Array; right: Float32Array } {
    for (const node of this.nodes) node.resetRenderState()
    this.destination.resetRenderState()
    const frames = Math.ceil(seconds * this.sampleRate)
    const left = new Float32Array(frames)
    const right = new Float32Array(frames)
    const blocks = Math.ceil(frames / BLOCK)
    for (let block = 0; block < blocks; block += 1) {
      const [blockLeft, blockRight] = this.destination.render(block)
      const offset = block * BLOCK
      const count = Math.min(BLOCK, frames - offset)
      left.set(blockLeft.subarray(0, count), offset)
      right.set(blockRight.subarray(0, count), offset)
    }
    return { left, right }
  }

  /** Mono downmix of the destination output — the default view used by most assertions. */
  render(seconds: number): Float32Array {
    const { left, right } = this.renderStereo(seconds)
    const mono = new Float32Array(left.length)
    for (let i = 0; i < left.length; i += 1) mono[i] = (left[i] + right[i]) * 0.5
    return mono
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

/** Mean absolute difference between two rendered signals, used for "did this change?" checks. */
export function difference(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length)
  if (length === 0) return 0
  let sum = 0
  for (let i = 0; i < length; i += 1) sum += Math.abs(a[i] - b[i])
  return sum / length
}

/** Relative difference of two signals, normalised by their level (0 = identical). */
export function relativeDifference(a: Float32Array, b: Float32Array): number {
  const scale = Math.max(rms(a), rms(b), 1e-9)
  return difference(a, b) / scale
}

/**
 * Energy in a frequency band, measured with a Goertzel-style sum over the band's bins.
 * Used to prove tone controls and filters really move the spectrum.
 */
export function bandEnergy(
  samples: Float32Array,
  sampleRate: number,
  lowHz: number,
  highHz: number,
): number {
  const length = Math.min(samples.length, 1 << 14)
  if (length < 64) return 0
  const bins = 48
  let total = 0
  for (let bin = 0; bin < bins; bin += 1) {
    const frequency = lowHz * Math.pow(highHz / lowHz, bin / (bins - 1))
    const omega = (2 * Math.PI * frequency) / sampleRate
    let real = 0
    let imaginary = 0
    for (let i = 0; i < length; i += 1) {
      real += samples[i] * Math.cos(omega * i)
      imaginary += samples[i] * Math.sin(omega * i)
    }
    total += (real * real + imaginary * imaginary) / (length * length)
  }
  return Math.sqrt(total / bins)
}

/** Peak-to-RMS ratio, the dynamic-range measure the compressor tests use. */
export function crestFactor(samples: Float32Array): number {
  const level = rms(samples)
  return level === 0 ? 0 : peak(samples) / level
}
