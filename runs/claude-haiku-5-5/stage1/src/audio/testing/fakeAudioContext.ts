// A recording audio graph for tests. It implements the injectable boundary without any real audio:
// every node is tracked, so tests can assert connections, scheduled stops, and cleanup back to baseline.

import type {
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  GainNodeLike,
  OscillatorNodeLike,
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
  disconnected = false
  readonly context: FakeAudioContext

  constructor(context: FakeAudioContext) {
    this.context = context
    context.register(this)
  }

  connect(destination: AudioNodeLike): AudioNodeLike {
    this.outputs.push(destination as FakeNode)
    return destination
  }

  disconnect(): void {
    this.outputs.length = 0
    this.disconnected = true
    this.context.unregister(this)
  }
}

export class FakeGain extends FakeNode implements GainNodeLike {
  readonly gain = new FakeParam()
}

export class FakeBiquad extends FakeNode implements BiquadFilterNodeLike {
  type: 'lowpass' | 'highpass' | 'peaking' = 'lowpass'
  readonly frequency = new FakeParam()
  readonly Q = new FakeParam()
}

export class FakeOscillator extends FakeNode implements OscillatorNodeLike {
  type: 'sine' | 'square' | 'sawtooth' | 'triangle' = 'sine'
  readonly frequency = new FakeParam()
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

export class FakeAudioContext implements AudioContextLike {
  state: 'suspended' | 'running' | 'closed' = 'running'
  currentTime = 0
  readonly destination: FakeNode
  readonly oscillators: FakeOscillator[] = []
  readonly gains: FakeGain[] = []
  readonly filters: FakeBiquad[] = []
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
