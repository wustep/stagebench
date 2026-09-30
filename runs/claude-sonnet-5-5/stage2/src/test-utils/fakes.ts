import type { InstrumentDeps } from '../audio/instrument'
import type {
  AudioBufferLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadLike,
  BufferSourceLike,
  CompressorLike,
  ConvolverLike,
  DelayLike,
  GainNodeLike,
  OscillatorLike,
  Scheduler,
  StereoPannerLike,
  WaveShaperLike,
} from '../audio/types'
import type { MidiAccessLike, MidiInputLike } from '../input/midi'

export class FakeParam implements AudioParamLike {
  events: Array<{ type: string; value: number; time: number }> = []
  constructor(public value = 1) {}
  setValueAtTime(value: number, time: number) {
    this.events.push({ type: 'set', value, time })
    this.value = value
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.events.push({ type: 'ramp', value, time })
  }
  cancelScheduledValues(time: number) {
    this.events = this.events.filter((e) => e.time < time)
  }
}

export class FakeNode implements AudioNodeLike {
  outputs = new Set<AudioNodeLike>()
  /** params this node modulates (LFO → depth → param) */
  paramOutputs = new Set<AudioParamLike>()
  constructor(
    public readonly kind: string,
    private readonly ctx: FakeAudioContext,
  ) {
    ctx.nodes.push(this)
  }
  connect(destination: AudioNodeLike | AudioParamLike) {
    if (destination instanceof FakeParam) this.paramOutputs.add(destination)
    else this.outputs.add(destination as AudioNodeLike)
  }
  disconnect() {
    this.outputs.clear()
    this.paramOutputs.clear()
  }
  /** true when this node has any live connection */
  get connected(): boolean {
    return this.outputs.size > 0 || this.paramOutputs.size > 0
  }
  reachesDestination(seen = new Set<AudioNodeLike>()): boolean {
    if (seen.has(this)) return false
    seen.add(this)
    for (const out of this.outputs) {
      if (out === this.ctx.destination) return true
      if (out instanceof FakeNode && out.reachesDestination(seen)) return true
    }
    return false
  }
}

export class FakeGain extends FakeNode implements GainNodeLike {
  gain = new FakeParam(1)
  constructor(ctx: FakeAudioContext) {
    super('gain', ctx)
  }
}

export class FakeSource extends FakeNode implements BufferSourceLike {
  buffer: AudioBufferLike | null = null
  onended: (() => void) | null = null
  playbackRate = new FakeParam(1)
  detune = new FakeParam(0)
  started: number | null = null
  stopped = false
  constructor(ctx: FakeAudioContext) {
    super('bufferSource', ctx)
  }
  start(when = 0) {
    this.started = when
  }
  stop() {
    this.stopped = true
  }
}

export class FakeOscillator extends FakeNode implements OscillatorLike {
  type = 'sine'
  frequency = new FakeParam(440)
  detune = new FakeParam(0)
  onended: (() => void) | null = null
  started = false
  stopped = false
  constructor(ctx: FakeAudioContext) {
    super('oscillator', ctx)
  }
  start() {
    this.started = true
  }
  stop() {
    this.stopped = true
  }
}

export class FakeCompressor extends FakeNode implements CompressorLike {
  threshold = new FakeParam()
  knee = new FakeParam()
  ratio = new FakeParam()
  attack = new FakeParam()
  release = new FakeParam()
  reduction = 0
  constructor(ctx: FakeAudioContext) {
    super('compressor', ctx)
  }
}

export class FakeBiquad extends FakeNode implements BiquadLike {
  type = 'lowpass'
  frequency = new FakeParam(350)
  Q = new FakeParam(1)
  gain = new FakeParam(0)
  constructor(ctx: FakeAudioContext) {
    super('biquad', ctx)
  }
}

export class FakeDelay extends FakeNode implements DelayLike {
  delayTime = new FakeParam(0)
  constructor(ctx: FakeAudioContext) {
    super('delay', ctx)
  }
}

export class FakePanner extends FakeNode implements StereoPannerLike {
  pan = new FakeParam(0)
  constructor(ctx: FakeAudioContext) {
    super('panner', ctx)
  }
}

export class FakeShaper extends FakeNode implements WaveShaperLike {
  curve: Float32Array | null = null
  oversample = 'none'
  constructor(ctx: FakeAudioContext) {
    super('shaper', ctx)
  }
}

export class FakeConvolver extends FakeNode implements ConvolverLike {
  buffer: AudioBufferLike | null = null
  normalize = true
  constructor(ctx: FakeAudioContext) {
    super('convolver', ctx)
  }
}

export interface FakeAudioOptions {
  state?: string
  /** createBuffer throws and decodeAudioData rejects (no buffers of any kind) */
  failBuffers?: boolean
  /** only decodeAudioData rejects: the recorded samples cannot be decoded, generated buffers still work */
  failDecode?: boolean
  resumeRejects?: boolean
}

export class FakeAudioContext implements AudioContextLike {
  currentTime = 0
  sampleRate = 48000
  state: string
  onstatechange: (() => void) | null = null
  nodes: FakeNode[] = []
  destination: FakeNode
  closed = false
  buffersCreated = 0
  constructor(private readonly opts: FakeAudioOptions = {}) {
    this.state = opts.state ?? 'running'
    this.destination = new FakeNode('destination', this)
  }
  async resume() {
    await Promise.resolve()
    if (this.opts.resumeRejects) throw new Error('blocked')
    this.state = 'running'
    this.onstatechange?.()
  }
  async close() {
    this.closed = true
    this.state = 'closed'
  }
  createGain() {
    return new FakeGain(this)
  }
  createBuffer(_channels: number, length: number, sampleRate: number): AudioBufferLike {
    if (this.opts.failBuffers) throw new Error('no buffers')
    this.buffersCreated++
    const data = new Float32Array(length)
    return { length, sampleRate, getChannelData: () => data }
  }
  createBufferSource() {
    return new FakeSource(this)
  }
  createOscillator() {
    return new FakeOscillator(this)
  }
  createDynamicsCompressor() {
    return new FakeCompressor(this)
  }
  createBiquadFilter() {
    return new FakeBiquad(this)
  }
  createDelay(_max?: number) {
    return new FakeDelay(this)
  }
  createStereoPanner() {
    return new FakePanner(this)
  }
  createWaveShaper() {
    return new FakeShaper(this)
  }
  createConvolver() {
    return new FakeConvolver(this)
  }
  createChannelMerger() {
    return new FakeNode('merger', this)
  }
  async decodeAudioData(_data: ArrayBuffer): Promise<AudioBufferLike> {
    await Promise.resolve()
    if (this.opts.failBuffers || this.opts.failDecode) throw new Error('cannot decode')
    this.decoded++
    const data = new Float32Array(4410)
    return { length: data.length, sampleRate: 44100, duration: 0.1, numberOfChannels: 1, getChannelData: () => data }
  }
  decoded = 0
  /** nodes that still have live connections (i.e. not disconnected) excluding the destination */
  liveNodes(): FakeNode[] {
    return this.nodes.filter((n) => n !== this.destination && n.connected)
  }
  voiceSources(): Array<FakeSource | FakeOscillator> {
    return this.nodes.filter((n): n is FakeSource | FakeOscillator => n instanceof FakeSource || n instanceof FakeOscillator)
  }
}

export class FakeScheduler implements Scheduler {
  now = 0
  private next = 1
  timers = new Map<number, { at: number; fn: () => void }>()
  setTimeout(fn: () => void, ms: number) {
    const id = this.next++
    this.timers.set(id, { at: this.now + ms, fn })
    return id
  }
  clearTimeout(id: number) {
    this.timers.delete(id)
  }
  advance(ms: number) {
    this.now += ms
    for (const [id, t] of Array.from(this.timers)) {
      if (t.at <= this.now && this.timers.has(id)) {
        this.timers.delete(id)
        t.fn()
      }
    }
  }
  get pending() {
    return this.timers.size
  }
}

type Listener = (event: never) => void
export class FakeEventTarget {
  listeners = new Map<string, Set<Listener>>()
  visibilityState = 'visible'
  addEventListener(type: string, listener: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(listener)
  }
  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener)
  }
  emit(type: string, event: object = {}) {
    for (const l of Array.from(this.listeners.get(type) ?? [])) (l as (e: object) => void)(event)
  }
  count() {
    let n = 0
    this.listeners.forEach((s) => (n += s.size))
    return n
  }
}

export class FakeMidiInput implements MidiInputLike {
  onmidimessage: MidiInputLike['onmidimessage'] = null
  state = 'connected'
  constructor(
    public id: string,
    public name: string,
  ) {}
  send(...bytes: number[]) {
    this.onmidimessage?.({ data: new Uint8Array(bytes) })
  }
}

export class FakeMidiAccess implements MidiAccessLike {
  onstatechange: MidiAccessLike['onstatechange'] = null
  constructor(public list: FakeMidiInput[]) {}
  inputs = { values: () => this.list.values() }
  plug(input: FakeMidiInput) {
    this.list.push(input)
    this.onstatechange?.({})
  }
  unplug(input: FakeMidiInput) {
    input.state = 'disconnected'
    this.onstatechange?.({})
  }
}

export interface Harness {
  deps: InstrumentDeps
  ctx: () => FakeAudioContext | null
  contexts: FakeAudioContext[]
  scheduler: FakeScheduler
  keys: FakeEventTarget
  win: FakeEventTarget
  doc: FakeEventTarget
  midiAccess: FakeMidiAccess
  midiInput: FakeMidiInput
  /** urls the sample loader was asked for */
  loaded: string[]
}

export function createHarness(opts: { audio?: FakeAudioOptions | 'none'; midi?: 'ok' | 'denied' | 'unsupported' | 'empty'; samples?: 'ok' | 'missing' } = {}): Harness {
  const contexts: FakeAudioContext[] = []
  const loaded: string[] = []
  const scheduler = new FakeScheduler()
  const keys = new FakeEventTarget()
  const win = new FakeEventTarget()
  const doc = new FakeEventTarget()
  const midiInput = new FakeMidiInput('in1', 'Fake Keys')
  const midiAccess = new FakeMidiAccess(opts.midi === 'empty' ? [] : [midiInput])
  const deps: InstrumentDeps = {
    createAudioContext: () => {
      if (opts.audio === 'none') return null
      const ctx = new FakeAudioContext(opts.audio ?? {})
      contexts.push(ctx)
      return ctx
    },
    scheduler,
    loadSample: async (url) => {
      await Promise.resolve()
      if (opts.samples === 'missing') throw new Error(`${url}: HTTP 404`)
      loaded.push(url)
      return new ArrayBuffer(16)
    },
    midi:
      opts.midi === 'unsupported'
        ? null
        : opts.midi === 'denied'
          ? () => Promise.reject(Object.assign(new Error('denied'), { name: 'SecurityError' }))
          : () => Promise.resolve(midiAccess),
    keyTarget: keys,
    pageWindow: win,
    pageDocument: doc,
  }
  return { deps, ctx: () => contexts[contexts.length - 1] ?? null, contexts, scheduler, keys, win, doc, midiAccess, midiInput, loaded }
}
