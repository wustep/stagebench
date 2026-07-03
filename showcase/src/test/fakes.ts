import type {
  AssetBoundary,
  AudioBoundary,
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  ConvolverNodeLike,
  DelayNodeLike,
  DynamicsCompressorNodeLike,
  GainNodeLike,
  MidiAccessLike,
  MidiBoundary,
  MidiPortLike,
  OscillatorNodeLike,
  PeriodicWaveLike,
  StereoPannerNodeLike,
  StorageBoundary,
  TimerBoundary,
  WaveShaperNodeLike,
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

export class FakeAudioBuffer implements AudioBufferLike {
  readonly length: number
  readonly numberOfChannels: number
  readonly sampleRate: number
  private channels: Float32Array[]
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
    return this.channels[channel]!
  }
}

export class FakeNode implements AudioNodeLike {
  readonly kind: string
  readonly context: FakeAudioContext
  connections: FakeNode[] = []
  paramConnections: FakeParam[] = []
  disconnected = false
  constructor(context: FakeAudioContext, kind: string) {
    this.context = context
    this.kind = kind
    context.nodes.push(this)
  }
  connect(destination: AudioNodeLike | AudioParamLike) {
    if (destination instanceof FakeParam) {
      this.paramConnections.push(destination)
      return destination
    }
    this.connections.push(destination as FakeNode)
    return destination
  }
  disconnect() {
    this.disconnected = true
    this.connections = []
    this.paramConnections = []
  }
  /** True if audio from this node can reach the context destination. */
  reachesDestination(seen = new Set<FakeNode>()): boolean {
    if (this.disconnected) return false
    if (this.kind === 'destination') return true
    if (seen.has(this)) return false
    seen.add(this)
    return this.connections.some((n) => n.reachesDestination(seen))
  }
}

export class FakeGain extends FakeNode implements GainNodeLike {
  gain = new FakeParam(1)
  constructor(context: FakeAudioContext) {
    super(context, 'gain')
  }
}

export class FakePeriodicWave implements PeriodicWaveLike {
  constructor(
    readonly real: Float32Array,
    readonly imag: Float32Array,
  ) {}
}

export class FakeOscillator extends FakeNode implements OscillatorNodeLike {
  type = 'sine'
  frequency = new FakeParam(440)
  detune = new FakeParam(0)
  started = false
  stopped = false
  stopTime: number | null = null
  /** Set by setPeriodicWave (Sync/Multi/Super waveforms use a custom wave, not a built-in `type`). */
  periodicWave: FakePeriodicWave | null = null
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
  setPeriodicWave(wave: PeriodicWaveLike) {
    this.type = 'custom'
    this.periodicWave = wave as FakePeriodicWave
  }
}

export class FakeBufferSource extends FakeNode implements AudioBufferSourceNodeLike {
  buffer: AudioBufferLike | null = null
  playbackRate = new FakeParam(1)
  detune = new FakeParam(0)
  loop = false
  started = false
  stopped = false
  stopTime: number | null = null
  constructor(context: FakeAudioContext) {
    super(context, 'buffer-source')
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
  gain = new FakeParam(0)
  constructor(context: FakeAudioContext) {
    super(context, 'filter')
  }
}

export class FakeDelayNode extends FakeNode implements DelayNodeLike {
  delayTime = new FakeParam(0)
  constructor(context: FakeAudioContext) {
    super(context, 'delay')
  }
}

export class FakeWaveShaper extends FakeNode implements WaveShaperNodeLike {
  curve: Float32Array | null = null
  oversample = 'none'
  constructor(context: FakeAudioContext) {
    super(context, 'waveshaper')
  }
}

export class FakeConvolver extends FakeNode implements ConvolverNodeLike {
  buffer: AudioBufferLike | null = null
  constructor(context: FakeAudioContext) {
    super(context, 'convolver')
  }
}

export class FakeStereoPanner extends FakeNode implements StereoPannerNodeLike {
  pan = new FakeParam(0)
  constructor(context: FakeAudioContext) {
    super(context, 'panner')
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
  sampleRate = 44100
  nodes: FakeNode[] = []
  readonly destination: FakeNode
  closed = false
  resumed = false
  private readonly options: FakeAudioContextOptions

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
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike {
    return new FakeAudioBuffer(channels, length, sampleRate)
  }
  createBufferSource(): AudioBufferSourceNodeLike {
    return new FakeBufferSource(this)
  }
  createDelay(): DelayNodeLike {
    return new FakeDelayNode(this)
  }
  createWaveShaper(): WaveShaperNodeLike {
    return new FakeWaveShaper(this)
  }
  createConvolver(): ConvolverNodeLike {
    return new FakeConvolver(this)
  }
  createStereoPanner(): StereoPannerNodeLike {
    return new FakeStereoPanner(this)
  }
  createPeriodicWave(real: Float32Array, imag: Float32Array): PeriodicWaveLike {
    return new FakePeriodicWave(real, imag)
  }
  createDynamicsCompressor?: () => DynamicsCompressorNodeLike
  decodeAudioData(_bytes: ArrayBuffer): Promise<AudioBufferLike> {
    return Promise.resolve(new FakeAudioBuffer(2, 4410, this.sampleRate))
  }

  oscillators(): FakeOscillator[] {
    return this.nodes.filter((n): n is FakeOscillator => n.kind === 'oscillator')
  }
  bufferSources(): FakeBufferSource[] {
    return this.nodes.filter((n): n is FakeBufferSource => n.kind === 'buffer-source')
  }
  /** Voice-owned sources: buffer sources plus oscillators created after the standing graph. */
  voiceSources(): Array<FakeBufferSource | FakeOscillator> {
    return this.nodes.filter(
      (n): n is FakeBufferSource | FakeOscillator => n.kind === 'buffer-source' || (n.kind === 'oscillator' && !this.standingNodes.has(n)),
    )
  }
  liveNodes(): FakeNode[] {
    return this.nodes.filter((n) => !n.disconnected && n.kind !== 'destination')
  }
  /** Nodes existing right after engine start (master graph, chains, effect LFOs). */
  standingNodes = new Set<FakeNode>()
  markStandingGraph(): void {
    this.standingNodes = new Set(this.nodes)
  }
  standingLiveCount(): number {
    return this.liveNodes().filter((n) => this.standingNodes.has(n)).length
  }
  /** Live nodes that are NOT part of the standing graph (i.e. voice leftovers). */
  transientLiveNodes(): FakeNode[] {
    return this.liveNodes().filter((n) => !this.standingNodes.has(n))
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

export class ManualTimers {
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

// TimerBoundary requires now() as a method; ManualTimers exposes `now` as a
// mutable field, so wrap it when constructing boundaries.
function timerBoundaryFor(timers: ManualTimers): TimerBoundary {
  return {
    setTimeout: (fn, ms) => timers.setTimeout(fn, ms),
    clearTimeout: (id) => timers.clearTimeout(id),
    now: () => timers.now,
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
      timers: timerBoundaryFor(timers),
    },
  }
}

/* ------------------------------------------------------------ fake assets -- */

/**
 * Synchronously "loads" every requested sample as a tiny decoded buffer whose
 * content is deterministic per path — enough for state/lifecycle tests. Real
 * decoding/rendering is covered by the offline node-web-audio-api suite.
 */
/* ------------------------------------------------------------ fake storage -- */

export function fakeStorageBoundary(initial: Record<string, string> = {}): StorageBoundary & {
  data: Map<string, string>
} {
  const data = new Map(Object.entries(initial))
  return {
    data,
    load: (key) => data.get(key) ?? null,
    save: (key, value) => void data.set(key, value),
  }
}

export function fakeAssetBoundary(options: { fail?: boolean | ((path: string) => boolean) } = {}): AssetBoundary & {
  loaded: string[]
} {
  const loaded: string[] = []
  return {
    loaded,
    load(path: string) {
      const shouldFail = typeof options.fail === 'function' ? options.fail(path) : options.fail === true
      if (shouldFail) throw new Error(`asset unavailable: ${path}`)
      loaded.push(path)
      const buffer = new FakeAudioBuffer(2, 4410, 44100)
      // Deterministic non-silent content.
      const data = buffer.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = Math.sin((i / data.length) * 20 * Math.PI) * 0.5
      return buffer
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
