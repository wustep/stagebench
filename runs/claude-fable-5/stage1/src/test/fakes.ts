import type {
  AudioBoundary,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  DynamicsCompressorNodeLike,
  GainNodeLike,
  MidiAccessLike,
  MidiBoundary,
  MidiPortLike,
  OscillatorNodeLike,
  TimerBoundary,
} from '../audio/boundaries'

/* ------------------------------------------------------------ fake audio -- */

export class FakeParam implements AudioParamLike {
  value = 0
  events: Array<{ kind: string; value?: number; time?: number }> = []
  constructor(initial = 0) {
    this.value = initial
  }
  setValueAtTime(value: number, time: number) {
    this.value = value
    this.events.push({ kind: 'set', value, time })
    return this
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.value = value
    this.events.push({ kind: 'linear', value, time })
    return this
  }
  exponentialRampToValueAtTime(value: number, time: number) {
    this.value = value
    this.events.push({ kind: 'exp', value, time })
    return this
  }
  setTargetAtTime(value: number, time: number, timeConstant: number) {
    this.value = value
    this.events.push({ kind: 'target', value, time: time + timeConstant })
    return this
  }
  cancelScheduledValues(time: number) {
    this.events.push({ kind: 'cancel', time })
    return this
  }
  maxScheduled(): number {
    return this.events.reduce((max, e) => (typeof e.value === 'number' && e.value > max ? e.value : max), 0)
  }
}

export class FakeNode implements AudioNodeLike {
  readonly kind: string
  readonly context: FakeAudioContext
  connections: FakeNode[] = []
  disconnected = false
  constructor(context: FakeAudioContext, kind: string) {
    this.context = context
    this.kind = kind
    context.nodes.push(this)
  }
  connect(destination: AudioNodeLike) {
    this.connections.push(destination as FakeNode)
    return destination
  }
  disconnect() {
    this.disconnected = true
    this.connections = []
  }
  /** True if audio from this node can reach the context destination. */
  reachesDestination(): boolean {
    if (this.disconnected) return false
    if (this.kind === 'destination') return true
    return this.connections.some((n) => n.reachesDestination())
  }
}

export class FakeGain extends FakeNode implements GainNodeLike {
  gain = new FakeParam(1)
  constructor(context: FakeAudioContext) {
    super(context, 'gain')
  }
}

export class FakeOscillator extends FakeNode implements OscillatorNodeLike {
  type = 'sine'
  frequency = new FakeParam(440)
  detune = new FakeParam(0)
  started = false
  stopped = false
  stopTime: number | null = null
  constructor(context: FakeAudioContext) {
    super(context, 'oscillator')
  }
  start() {
    this.started = true
  }
  stop(when?: number) {
    this.stopped = true
    this.stopTime = when ?? this.context.currentTime
  }
}

export class FakeFilter extends FakeNode implements BiquadFilterNodeLike {
  type = 'lowpass'
  frequency = new FakeParam(350)
  Q = new FakeParam(1)
  constructor(context: FakeAudioContext) {
    super(context, 'filter')
  }
}

export class FakeCompressor extends FakeNode implements DynamicsCompressorNodeLike {
  threshold = new FakeParam(-24)
  knee = new FakeParam(30)
  ratio = new FakeParam(12)
  attack = new FakeParam(0.003)
  release = new FakeParam(0.25)
  constructor(context: FakeAudioContext) {
    super(context, 'compressor')
  }
}

export interface FakeAudioContextOptions {
  withCompressor?: boolean
  failCompressor?: boolean
  failFilters?: boolean
  failGains?: boolean
}

export class FakeAudioContext implements AudioContextLike {
  currentTime = 0
  state = 'running'
  nodes: FakeNode[] = []
  readonly destination: FakeNode
  closed = false
  resumed = false
  private readonly options: FakeAudioContextOptions
  private gainCount = 0

  constructor(options: FakeAudioContextOptions = {}) {
    this.options = { withCompressor: true, ...options }
    this.destination = new FakeNode(this, 'destination')
  }
  resume() {
    this.resumed = true
    this.state = 'running'
    return Promise.resolve()
  }
  close() {
    this.closed = true
    this.state = 'closed'
    return Promise.resolve()
  }
  createGain(): GainNodeLike {
    this.gainCount += 1
    if (this.options.failGains) throw new Error('gain unavailable')
    return new FakeGain(this)
  }
  createOscillator(): OscillatorNodeLike {
    return new FakeOscillator(this)
  }
  createBiquadFilter(): BiquadFilterNodeLike {
    if (this.options.failFilters) throw new Error('filter unavailable')
    return new FakeFilter(this)
  }
  createDynamicsCompressor?: () => DynamicsCompressorNodeLike

  oscillators(): FakeOscillator[] {
    return this.nodes.filter((n): n is FakeOscillator => n.kind === 'oscillator')
  }
  liveNodes(): FakeNode[] {
    return this.nodes.filter((n) => !n.disconnected && n.kind !== 'destination')
  }
}

export function makeFakeContext(options: FakeAudioContextOptions = {}): FakeAudioContext {
  const context = new FakeAudioContext(options)
  if (options.withCompressor !== false) {
    context.createDynamicsCompressor = () => {
      if (options.failCompressor) throw new Error('compressor unavailable')
      return new FakeCompressor(context)
    }
  }
  return context
}

/* ------------------------------------------------------------ fake timers -- */

export class ManualTimers implements TimerBoundary {
  private nextId = 1
  private tasks = new Map<number, { fn: () => void; at: number }>()
  now = 0
  setTimeout(fn: () => void, ms: number): number {
    const id = this.nextId++
    this.tasks.set(id, { fn, at: this.now + ms })
    return id
  }
  clearTimeout(id: number): void {
    this.tasks.delete(id)
  }
  advance(ms: number): void {
    this.now += ms
    const due = [...this.tasks.entries()].filter(([, t]) => t.at <= this.now).sort((a, b) => a[1].at - b[1].at)
    for (const [id, task] of due) {
      this.tasks.delete(id)
      task.fn()
    }
  }
  pendingCount(): number {
    return this.tasks.size
  }
}

export interface FakeAudioSetup {
  boundary: AudioBoundary
  timers: ManualTimers
  getContext: () => FakeAudioContext | null
}

export function fakeAudioBoundary(options: FakeAudioContextOptions & { failContext?: boolean } = {}): FakeAudioSetup {
  const timers = new ManualTimers()
  let context: FakeAudioContext | null = null
  return {
    timers,
    getContext: () => context,
    boundary: {
      createContext() {
        if (options.failContext) throw new Error('AudioContext blocked')
        context = makeFakeContext(options)
        return context
      },
      timers,
    },
  }
}

/* -------------------------------------------------------------- fake MIDI -- */

export class FakePort implements MidiPortLike {
  id: string
  name: string
  state = 'connected'
  onmidimessage: ((event: { data: Uint8Array | null }) => void) | null = null
  constructor(id: string, name: string) {
    this.id = id
    this.name = name
  }
  emit(bytes: number[]) {
    this.onmidimessage?.({ data: new Uint8Array(bytes) })
  }
}

export class FakeMidiAccess implements MidiAccessLike {
  ports = new Map<string, FakePort>()
  onstatechange: ((event: { port?: MidiPortLike | null }) => void) | null = null
  inputs = {
    values: () => this.ports.values(),
  }
  addPort(port: FakePort) {
    this.ports.set(port.id, port)
    this.onstatechange?.({ port })
  }
  removePort(port: FakePort) {
    port.state = 'disconnected'
    this.ports.delete(port.id)
    this.onstatechange?.({ port })
  }
}

export function fakeMidiBoundary(access: FakeMidiAccess): MidiBoundary {
  return { requestAccess: () => Promise.resolve(access) }
}

export function deniedMidiBoundary(): MidiBoundary {
  return { requestAccess: () => Promise.reject(new Error('Permission denied')) }
}
