import type {
  AudioBufferLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  GainNodeLike,
  OscillatorNodeLike,
} from './types'

type AutomationMode = 'set' | 'linear' | 'expo'

interface AutomationEvent {
  time: number
  value: number
  mode: AutomationMode
}

class SoftParam implements AudioParamLike {
  value: number
  private events: AutomationEvent[]

  constructor(value: number) {
    this.value = value
    this.events = [{ time: 0, value, mode: 'set' }]
  }

  setValueAtTime(value: number, time: number): void {
    this.value = value
    this.push({ time, value, mode: 'set' })
  }

  linearRampToValueAtTime(value: number, time: number): void {
    this.value = value
    this.push({ time, value, mode: 'linear' })
  }

  exponentialRampToValueAtTime(value: number, time: number): void {
    const v = Math.max(1e-5, value)
    this.value = v
    this.push({ time, value: v, mode: 'expo' })
  }

  cancelScheduledValues(time: number): void {
    this.events = this.events.filter((event) => event.time < time)
    if (this.events.length === 0) this.events.push({ time: 0, value: this.value, mode: 'set' })
  }

  getValueAtTime(time: number): number {
    const events = this.events
    if (events.length === 0) return this.value
    if (time <= events[0].time) return events[0].value
    for (let i = 1; i < events.length; i++) {
      const next = events[i]
      const prev = events[i - 1]
      if (time < next.time) return interpolate(prev, next, time)
      if (time === next.time) return next.value
    }
    return events[events.length - 1].value
  }

  private push(event: AutomationEvent): void {
    this.events = this.events.filter((existing) => existing.time <= event.time)
    const last = this.events[this.events.length - 1]
    if (last && last.time === event.time) this.events[this.events.length - 1] = event
    else this.events.push(event)
    this.events.sort((a, b) => a.time - b.time)
  }
}

function interpolate(prev: AutomationEvent, next: AutomationEvent, time: number): number {
  const span = next.time - prev.time
  if (span <= 0) return next.value
  const t = (time - prev.time) / span
  if (next.mode === 'set') return prev.value
  if (next.mode === 'linear') return prev.value + (next.value - prev.value) * t
  const a = Math.max(1e-5, prev.value)
  const b = Math.max(1e-5, next.value)
  return a * Math.pow(b / a, t)
}

type NodeKind = 'osc' | 'gain' | 'filter' | 'dest'

class SoftNode implements AudioNodeLike {
  readonly kind: NodeKind
  readonly inputs: SoftNode[] = []
  readonly outputs: SoftNode[] = []
  frequency?: SoftParam
  gain?: SoftParam
  Q?: SoftParam
  type = 'sine'
  startTime = 0
  stopTime = Number.POSITIVE_INFINITY
  started = false

  constructor(kind: NodeKind) {
    this.kind = kind
    if (kind === 'osc') this.frequency = new SoftParam(440)
    if (kind === 'gain') this.gain = new SoftParam(1)
    if (kind === 'filter') {
      this.frequency = new SoftParam(12000)
      this.Q = new SoftParam(0.707)
      this.type = 'lowpass'
    }
  }

  connect(destination: AudioNodeLike): AudioNodeLike {
    const dest = destination as SoftNode
    if (!this.outputs.includes(dest)) this.outputs.push(dest)
    if (!dest.inputs.includes(this)) dest.inputs.push(this)
    return destination
  }

  disconnect(): void {
    for (const dest of this.outputs) {
      dest.inputs.splice(dest.inputs.indexOf(this), 1)
    }
    this.outputs.length = 0
  }

  start(time = 0): void {
    this.startTime = time
    this.started = true
  }

  stop(time = 0): void {
    this.stopTime = time
  }
}

class SoftOscillator extends SoftNode implements OscillatorNodeLike {
  declare frequency: SoftParam
  constructor() {
    super('osc')
  }
}

class SoftGain extends SoftNode implements GainNodeLike {
  declare gain: SoftParam
  constructor() {
    super('gain')
  }
}

class SoftFilter extends SoftNode implements BiquadFilterNodeLike {
  declare frequency: SoftParam
  declare Q: SoftParam
  constructor() {
    super('filter')
  }
}

export class SoftwareAudioContext implements AudioContextLike {
  readonly sampleRate: number
  readonly destination: SoftNode
  state: string = 'running'
  readonly mode: 'realtime' | 'offline'
  private readonly length: number
  private readonly startedAt: number
  private closed = false
  private readonly nodes: SoftNode[] = []

  constructor(options?: { sampleRate?: number; offline?: boolean; durationSec?: number }) {
    this.sampleRate = options?.sampleRate ?? 44100
    this.mode = options?.offline ? 'offline' : 'realtime'
    this.length = options?.offline
      ? Math.max(1, Math.ceil((options.durationSec ?? 1) * this.sampleRate))
      : 0
    this.startedAt = performance.now()
    this.destination = new SoftNode('dest')
    this.nodes.push(this.destination)
  }

  get currentTime(): number {
    if (this.mode === 'offline') return 0
    return (performance.now() - this.startedAt) / 1000
  }

  createOscillator(): OscillatorNodeLike {
    const node = new SoftOscillator()
    this.nodes.push(node)
    return node
  }

  createGain(): GainNodeLike {
    const node = new SoftGain()
    this.nodes.push(node)
    return node
  }

  createBiquadFilter(): BiquadFilterNodeLike {
    const node = new SoftFilter()
    this.nodes.push(node)
    return node
  }

  async resume(): Promise<void> {
    if (this.closed) return
    this.state = 'running'
  }

  async close(): Promise<void> {
    this.closed = true
    this.state = 'closed'
  }

  async startRendering(): Promise<AudioBufferLike> {
    const length = this.length || Math.ceil(this.sampleRate)
    const data = new Float32Array(length)
    const oscPhase = new Map<SoftNode, number>()
    const filterState = new Map<SoftNode, { y: number }>()
    const order = topo(this.destination)

    for (let i = 0; i < length; i++) {
      const time = i / this.sampleRate
      const values = new Map<SoftNode, number>()
      for (const node of order) {
        values.set(node, sampleNode(node, time, this.sampleRate, values, oscPhase, filterState))
      }
      const mixed = values.get(this.destination) ?? 0
      data[i] = mixed > 1 ? 1 : mixed < -1 ? -1 : mixed
    }

    return {
      sampleRate: this.sampleRate,
      length,
      numberOfChannels: 1,
      getChannelData: (channel: number) => {
        if (channel !== 0) return new Float32Array(length)
        return data
      },
    }
  }
}

function sampleNode(
  node: SoftNode,
  time: number,
  sampleRate: number,
  values: Map<SoftNode, number>,
  oscPhase: Map<SoftNode, number>,
  filterState: Map<SoftNode, { y: number }>,
): number {
  if (node.kind === 'osc') {
    if (!node.started || time < node.startTime || time >= node.stopTime) return 0
    const freq = node.frequency?.getValueAtTime(time) ?? 440
    let phase = oscPhase.get(node) ?? 0
    const value = oscillatorSample(node.type, phase)
    oscPhase.set(node, phase + (2 * Math.PI * freq) / sampleRate)
    return value
  }

  let input = 0
  for (const source of node.inputs) input += values.get(source) ?? 0

  if (node.kind === 'gain') {
    return input * (node.gain?.getValueAtTime(time) ?? 1)
  }

  if (node.kind === 'filter') {
    const cutoff = Math.max(40, node.frequency?.getValueAtTime(time) ?? 12000)
    const dt = 1 / sampleRate
    const rc = 1 / (2 * Math.PI * cutoff)
    const a = dt / (rc + dt)
    const state = filterState.get(node) ?? { y: 0 }
    state.y += a * (input - state.y)
    filterState.set(node, state)
    return state.y
  }

  return input
}

function oscillatorSample(type: string, phase: number): number {
  const p = ((phase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  if (type === 'square') return p < Math.PI ? 1 : -1
  if (type === 'sawtooth') return p / Math.PI - 1
  if (type === 'triangle') return p < Math.PI ? -1 + (2 * p) / Math.PI : 3 - (2 * p) / Math.PI
  return Math.sin(p)
}

function topo(destination: SoftNode): SoftNode[] {
  const seen = new Set<SoftNode>()
  const order: SoftNode[] = []
  function visit(node: SoftNode): void {
    if (seen.has(node)) return
    seen.add(node)
    for (const input of node.inputs) visit(input)
    order.push(node)
  }
  visit(destination)
  return order
}

export function createAudioContext(options?: {
  offline?: boolean
  durationSec?: number
  sampleRate?: number
}): AudioContextLike {
  if (options?.offline) {
    return new SoftwareAudioContext({
      offline: true,
      durationSec: options.durationSec ?? 1,
      sampleRate: options.sampleRate ?? 44100,
    })
  }
  const Native = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext
  if (Native) return new Native() as unknown as AudioContextLike
  return new SoftwareAudioContext({ sampleRate: options?.sampleRate ?? 44100 })
}
