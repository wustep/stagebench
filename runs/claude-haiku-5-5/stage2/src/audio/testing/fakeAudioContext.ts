// A recording audio graph for tests that check structure, not sound. It implements the injectable
// boundary without any real audio: every node is tracked, so tests can assert connections, scheduled
// stops, parameter writes, and cleanup back to baseline. Sound is checked with rendered audio instead
// (see the *.render.test.ts files, which run the same code on an OfflineAudioContext).

import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  BiquadFilterType,
  ConvolverNodeLike,
  DelayNodeLike,
  DynamicsCompressorNodeLike,
  GainNodeLike,
  OscillatorNodeLike,
  OscillatorType,
  StereoPannerNodeLike,
  WaveShaperNodeLike,
} from '../audioBoundary'

export interface ParamEvent {
  kind: 'set' | 'linear' | 'exponential' | 'target' | 'cancel'
  value?: number
  time: number
  timeConstant?: number
}

export class FakeParam implements AudioParamLike {
  value = 0
  readonly events: ParamEvent[] = []
  /** Nodes whose output drives this parameter (LFOs and envelopes wired into it). */
  readonly inputs: FakeNode[] = []

  setValueAtTime(value: number, time: number): void {
    this.value = value
    this.events.push({ kind: 'set', value, time })
  }

  linearRampToValueAtTime(value: number, time: number): void {
    this.value = value
    this.events.push({ kind: 'linear', value, time })
  }

  exponentialRampToValueAtTime(value: number, time: number): void {
    this.value = value
    this.events.push({ kind: 'exponential', value, time })
  }

  setTargetAtTime(target: number, startTime: number, timeConstant: number): void {
    this.events.push({ kind: 'target', value: target, time: startTime, timeConstant })
  }

  cancelScheduledValues(time: number): void {
    this.events.push({ kind: 'cancel', time })
  }

  /** The largest value this parameter was ever set or ramped to. */
  peak(): number {
    return this.events.reduce((max, event) => Math.max(max, event.value ?? 0), 0)
  }
}

export class FakeNode implements AudioNodeLike {
  readonly outputs: FakeNode[] = []
  readonly paramOutputs: FakeParam[] = []
  disconnected = false
  readonly context: FakeAudioContext

  constructor(context: FakeAudioContext) {
    this.context = context
    context.register(this)
  }

  connect(destination: AudioNodeLike | AudioParamLike): unknown {
    if (destination instanceof FakeParam) {
      this.paramOutputs.push(destination)
      destination.inputs.push(this)
    } else {
      this.outputs.push(destination as FakeNode)
    }
    return destination
  }

  disconnect(): void {
    this.outputs.length = 0
    this.paramOutputs.length = 0
    this.disconnected = true
    this.context.unregister(this)
  }
}

export class FakeGain extends FakeNode implements GainNodeLike {
  readonly gain = new FakeParam()
}

export class FakeBiquad extends FakeNode implements BiquadFilterNodeLike {
  type: BiquadFilterType = 'lowpass'
  readonly frequency = new FakeParam()
  readonly Q = new FakeParam()
  readonly gain = new FakeParam()
}

export class FakeOscillator extends FakeNode implements OscillatorNodeLike {
  type: OscillatorType = 'sine'
  readonly frequency = new FakeParam()
  readonly detune = new FakeParam()
  startedAt: number | undefined
  stoppedAt: number | undefined
  onended: (() => void) | null = null

  start(when = 0): void {
    this.startedAt = when
  }

  stop(when = 0): void {
    this.stoppedAt = when
  }

  /** Simulates the browser firing `ended` once the scheduled stop has passed. */
  finish(): void {
    this.onended?.()
  }
}

export class FakeDelay extends FakeNode implements DelayNodeLike {
  readonly delayTime = new FakeParam()
}

export class FakeCompressor extends FakeNode implements DynamicsCompressorNodeLike {
  readonly threshold = new FakeParam()
  readonly knee = new FakeParam()
  readonly ratio = new FakeParam()
  readonly attack = new FakeParam()
  readonly release = new FakeParam()
}

export class FakePanner extends FakeNode implements StereoPannerNodeLike {
  readonly pan = new FakeParam()
}

export class FakeShaper extends FakeNode implements WaveShaperNodeLike {
  curve: Float32Array | null = null
  oversample: 'none' | '2x' | '4x' = 'none'
}

export class FakeConvolver extends FakeNode implements ConvolverNodeLike {
  buffer: AudioBufferLike | null = null
}

export class FakeSource extends FakeNode implements AudioBufferSourceNodeLike {
  buffer: AudioBufferLike | null = null
  loop = false
  loopStart = 0
  loopEnd = 0
  readonly playbackRate = new FakeParam()
  readonly detune = new FakeParam()
  startedAt: number | undefined
  stoppedAt: number | undefined
  onended: (() => void) | null = null

  start(when = 0): void {
    this.startedAt = when
  }

  stop(when = 0): void {
    this.stoppedAt = when
  }
}

export class FakeBuffer implements AudioBufferLike {
  readonly length: number
  readonly sampleRate: number
  readonly numberOfChannels: number
  private readonly channels: Float32Array[]

  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels
    this.length = length
    this.sampleRate = sampleRate
    this.channels = Array.from({ length: channels }, () => new Float32Array(length))
  }

  get duration(): number {
    return this.length / this.sampleRate
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel]
  }
}

export class FakeAudioContext implements AudioContextLike {
  state: 'suspended' | 'running' | 'closed' = 'running'
  currentTime = 0
  readonly sampleRate = 44100
  readonly destination: FakeNode
  readonly oscillators: FakeOscillator[] = []
  readonly gains: FakeGain[] = []
  readonly filters: FakeBiquad[] = []
  readonly sources: FakeSource[] = []
  readonly convolvers: FakeConvolver[] = []
  readonly delays: FakeDelay[] = []
  closed = false
  private readonly live = new Set<FakeNode>()

  constructor() {
    this.destination = new FakeNode(this)
  }

  /** Number of nodes created and not yet disconnected, including the destination. */
  get liveNodeCount(): number {
    return this.live.size
  }

  register(node: FakeNode): void {
    this.live.add(node)
  }

  unregister(node: FakeNode): void {
    this.live.delete(node)
  }

  resume(): Promise<void> {
    this.state = 'running'
    return Promise.resolve()
  }

  close(): Promise<void> {
    this.closed = true
    this.state = 'closed'
    return Promise.resolve()
  }

  createGain(): GainNodeLike {
    const gain = new FakeGain(this)
    this.gains.push(gain)
    return gain
  }

  createOscillator(): OscillatorNodeLike {
    const oscillator = new FakeOscillator(this)
    this.oscillators.push(oscillator)
    return oscillator
  }

  createBiquadFilter(): BiquadFilterNodeLike {
    const filter = new FakeBiquad(this)
    this.filters.push(filter)
    return filter
  }

  createDelay(): DelayNodeLike {
    const delay = new FakeDelay(this)
    this.delays.push(delay)
    return delay
  }

  createDynamicsCompressor(): DynamicsCompressorNodeLike {
    return new FakeCompressor(this)
  }

  createStereoPanner(): StereoPannerNodeLike {
    return new FakePanner(this)
  }

  createWaveShaper(): WaveShaperNodeLike {
    return new FakeShaper(this)
  }

  createConvolver(): ConvolverNodeLike {
    const convolver = new FakeConvolver(this)
    this.convolvers.push(convolver)
    return convolver
  }

  createBufferSource(): AudioBufferSourceNodeLike {
    const source = new FakeSource(this)
    this.sources.push(source)
    return source
  }

  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike {
    return new FakeBuffer(channels, length, sampleRate)
  }

  decodeAudioData(): Promise<AudioBufferLike> {
    return Promise.reject(new Error('the recording fake does not decode audio'))
  }
}

/** Walks outputs from `node` and reports whether `target` is reachable. Used to prove the master path. */
export function reaches(node: FakeNode, target: FakeNode): boolean {
  const seen = new Set<FakeNode>()
  const stack: FakeNode[] = [node]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === target) return true
    if (seen.has(current)) continue
    seen.add(current)
    stack.push(...current.outputs)
  }
  return false
}
