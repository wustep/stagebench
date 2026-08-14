import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  DelayNodeLike,
  DynamicsCompressorNodeLike,
  GainNodeLike,
  OscillatorNodeLike,
  StereoPannerNodeLike,
  WaveShaperNodeLike,
} from './types'

type AutomationMode = 'set' | 'linear' | 'expo'

interface AutomationEvent {
  time: number
  value: number
  mode: AutomationMode
}

export class SoftParam implements AudioParamLike {
  value: number
  readonly modulators: SoftNode[] = []
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

type NodeKind = 'osc' | 'gain' | 'filter' | 'dest' | 'delay' | 'buffer' | 'shaper' | 'panner' | 'comp'

class SoftNode implements AudioNodeLike {
  readonly kind: NodeKind
  readonly inputs: SoftNode[] = []
  readonly outputs: SoftNode[] = []
  frequency?: SoftParam
  gain?: SoftParam
  Q?: SoftParam
  delayTime?: SoftParam
  playbackRate?: SoftParam
  pan?: SoftParam
  threshold?: SoftParam
  ratio?: SoftParam
  attack?: SoftParam
  release?: SoftParam
  knee?: SoftParam
  type = 'sine'
  startTime = 0
  stopTime = Number.POSITIVE_INFINITY
  started = false
  buffer: SoftBuffer | null = null
  loop = false
  loopStart = 0
  loopEnd = 0
  startOffset = 0
  curve: Float32Array | null = null
  oversample = 'none'
  maxDelay = 1
  delayBufL?: Float64Array
  delayBufR?: Float64Array
  delayWrite = 0

  constructor(kind: NodeKind) {
    this.kind = kind
    if (kind === 'osc') this.frequency = new SoftParam(440)
    if (kind === 'gain') this.gain = new SoftParam(1)
    if (kind === 'filter') {
      this.frequency = new SoftParam(12000)
      this.Q = new SoftParam(0.707)
      this.gain = new SoftParam(0)
      this.type = 'lowpass'
    }
    if (kind === 'delay') this.delayTime = new SoftParam(0)
    if (kind === 'buffer') this.playbackRate = new SoftParam(1)
    if (kind === 'panner') this.pan = new SoftParam(0)
    if (kind === 'comp') {
      this.threshold = new SoftParam(-24)
      this.ratio = new SoftParam(12)
      this.attack = new SoftParam(0.003)
      this.release = new SoftParam(0.25)
      this.knee = new SoftParam(30)
    }
  }

  connect(destination: AudioNodeLike | AudioParamLike): AudioNodeLike {
    if (destination instanceof SoftParam) {
      if (!destination.modulators.includes(this)) destination.modulators.push(this)
      return this
    }
    const dest = destination as SoftNode
    if (!this.outputs.includes(dest)) this.outputs.push(dest)
    if (!dest.inputs.includes(this)) dest.inputs.push(this)
    return dest
  }

  disconnect(): void {
    for (const dest of this.outputs) {
      dest.inputs.splice(dest.inputs.indexOf(this), 1)
    }
    this.outputs.length = 0
  }

  start(time = 0, offset = 0): void {
    this.startTime = time
    this.startOffset = offset
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
  declare gain: SoftParam
  constructor() {
    super('filter')
  }
}

class SoftDelay extends SoftNode implements DelayNodeLike {
  declare delayTime: SoftParam
  constructor(maxDelay: number) {
    super('delay')
    this.maxDelay = maxDelay
  }
}

class SoftShaper extends SoftNode implements WaveShaperNodeLike {
  constructor() {
    super('shaper')
  }
}

class SoftPanner extends SoftNode implements StereoPannerNodeLike {
  declare pan: SoftParam
  constructor() {
    super('panner')
  }
}

class SoftComp extends SoftNode implements DynamicsCompressorNodeLike {
  declare threshold: SoftParam
  declare ratio: SoftParam
  declare attack: SoftParam
  declare release: SoftParam
  declare knee: SoftParam
  constructor() {
    super('comp')
  }
}

class SoftBuffer implements AudioBufferLike {
  readonly sampleRate: number
  readonly length: number
  readonly numberOfChannels: number
  readonly channels: Float32Array[]

  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels
    this.length = length
    this.sampleRate = sampleRate
    this.channels = Array.from({ length: channels }, () => new Float32Array(length))
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel] ?? new Float32Array(this.length)
  }

  copyToChannel(source: Float32Array, channel: number): void {
    this.getChannelData(channel).set(source.subarray(0, this.length))
  }
}

class SoftBufferSource extends SoftNode implements AudioBufferSourceNodeLike {
  declare playbackRate: SoftParam
  constructor() {
    super('buffer')
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

  createDelay(maxDelayTime = 1): DelayNodeLike {
    const node = new SoftDelay(Math.max(0.05, maxDelayTime))
    this.nodes.push(node)
    return node
  }

  createWaveShaper(): WaveShaperNodeLike {
    const node = new SoftShaper()
    this.nodes.push(node)
    return node
  }

  createStereoPanner(): StereoPannerNodeLike {
    const node = new SoftPanner()
    this.nodes.push(node)
    return node
  }

  createDynamicsCompressor(): DynamicsCompressorNodeLike {
    const node = new SoftComp()
    this.nodes.push(node)
    return node
  }

  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike {
    return new SoftBuffer(Math.max(1, channels), Math.max(1, length), sampleRate)
  }

  createBufferSource(): AudioBufferSourceNodeLike {
    const node = new SoftBufferSource()
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
    const left = new Float32Array(length)
    const right = new Float32Array(length)
    const oscPhase = new Map<SoftNode, number>()
    const filterState = new Map<SoftNode, { x1: number; x2: number; y1: number; y2: number; x1r: number; x2r: number; y1r: number; y2r: number }>()
    const compState = new Map<SoftNode, { env: number }>()
    const bufIndex = new Map<SoftNode, number>()
    const order = topo(this.destination)
    const delays = this.nodes.filter((node) => node.kind === 'delay')
    for (const delay of delays) {
      const n = Math.max(8, Math.ceil(delay.maxDelay * this.sampleRate) + 8)
      delay.delayBufL = new Float64Array(n)
      delay.delayBufR = new Float64Array(n)
      delay.delayWrite = 0
    }

    for (let i = 0; i < length; i++) {
      const time = i / this.sampleRate
      const values = new Map<SoftNode, { l: number; r: number }>()
      for (const node of order) {
        values.set(
          node,
          sampleNode(node, time, this.sampleRate, values, oscPhase, filterState, compState, bufIndex),
        )
      }
      for (const delay of delays) {
        const input = mixInputs(delay, values)
        const bufL = delay.delayBufL!
        const bufR = delay.delayBufR!
        bufL[delay.delayWrite] = input.l
        bufR[delay.delayWrite] = input.r
        delay.delayWrite = (delay.delayWrite + 1) % bufL.length
      }
      const mixed = values.get(this.destination) ?? { l: 0, r: 0 }
      left[i] = clamp1(mixed.l)
      right[i] = clamp1(mixed.r)
    }

    const out = new SoftBuffer(2, length, this.sampleRate)
    out.channels[0] = left
    out.channels[1] = right
    return out
  }
}

function mixInputs(node: SoftNode, values: Map<SoftNode, { l: number; r: number }>): { l: number; r: number } {
  let l = 0
  let r = 0
  for (const source of node.inputs) {
    const v = values.get(source)
    if (!v) continue
    l += v.l
    r += v.r
  }
  return { l, r }
}

function modulated(param: SoftParam | undefined, time: number, values: Map<SoftNode, { l: number; r: number }>, fallback: number): number {
  if (!param) return fallback
  let v = param.getValueAtTime(time)
  for (const mod of param.modulators) {
    const s = values.get(mod)
    if (s) v += (s.l + s.r) * 0.5
  }
  return v
}

function sampleNode(
  node: SoftNode,
  time: number,
  sampleRate: number,
  values: Map<SoftNode, { l: number; r: number }>,
  oscPhase: Map<SoftNode, number>,
  filterState: Map<
    SoftNode,
    { x1: number; x2: number; y1: number; y2: number; x1r: number; x2r: number; y1r: number; y2r: number }
  >,
  compState: Map<SoftNode, { env: number }>,
  bufIndex: Map<SoftNode, number>,
): { l: number; r: number } {
  if (node.kind === 'osc') {
    if (!node.started || time < node.startTime || time >= node.stopTime) return { l: 0, r: 0 }
    const freq = Math.max(0, modulated(node.frequency, time, values, 440))
    let phase = oscPhase.get(node) ?? 0
    const value = oscillatorSample(node.type, phase)
    oscPhase.set(node, phase + (2 * Math.PI * freq) / sampleRate)
    return { l: value, r: value }
  }

  if (node.kind === 'buffer') {
    if (!node.started || time < node.startTime || time >= node.stopTime || !node.buffer) return { l: 0, r: 0 }
    const rate = Math.max(0.01, modulated(node.playbackRate, time, values, 1))
    const elapsed = time - node.startTime
    const buf = node.buffer
    let pos = (node.startOffset + elapsed) * buf.sampleRate * rate
    const loopStart = node.loopStart * buf.sampleRate
    const rawEnd = node.loopEnd > node.loopStart ? node.loopEnd * buf.sampleRate : buf.length
    const loopEnd = Math.min(buf.length, rawEnd)
    if (node.loop && loopEnd > loopStart + 4) {
      const span = loopEnd - loopStart
      if (pos >= loopEnd) pos = loopStart + ((pos - loopStart) % span)
    }
    if (pos < 0 || pos >= buf.length - 1) return { l: 0, r: 0 }
    const i0 = Math.floor(pos)
    const frac = pos - i0
    const ch0 = buf.getChannelData(0)
    const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0
    const l = ch0[i0] * (1 - frac) + ch0[i0 + 1] * frac
    const r = ch1[i0] * (1 - frac) + ch1[i0 + 1] * frac
    bufIndex.set(node, pos)
    return { l, r }
  }

  if (node.kind === 'delay') {
    const bufL = node.delayBufL
    const bufR = node.delayBufR
    if (!bufL || !bufR) return { l: 0, r: 0 }
    const dt = Math.min(node.maxDelay, Math.max(0, modulated(node.delayTime, time, values, 0)))
    const delaySamples = dt * sampleRate
    const n = bufL.length
    const read = node.delayWrite - delaySamples
    const i0 = ((Math.floor(read) % n) + n) % n
    const i1 = (i0 + 1) % n
    const frac = read - Math.floor(read)
    const l = bufL[i0] * (1 - frac) + bufL[i1] * frac
    const r = bufR[i0] * (1 - frac) + bufR[i1] * frac
    return { l, r }
  }

  const input = mixInputs(node, values)

  if (node.kind === 'gain') {
    const g = modulated(node.gain, time, values, 1)
    return { l: input.l * g, r: input.r * g }
  }

  if (node.kind === 'panner') {
    const pan = Math.min(1, Math.max(-1, modulated(node.pan, time, values, 0)))
    const angle = ((pan + 1) * Math.PI) / 4
    const mono = (input.l + input.r) * 0.5
    return { l: mono * Math.cos(angle), r: mono * Math.sin(angle) }
  }

  if (node.kind === 'shaper') {
    return { l: shape(input.l, node.curve), r: shape(input.r, node.curve) }
  }

  if (node.kind === 'comp') {
    const abs = Math.max(Math.abs(input.l), Math.abs(input.r))
    const state = compState.get(node) ?? { env: 0 }
    const att = Math.exp(-1 / (sampleRate * Math.max(0.0005, node.attack?.getValueAtTime(time) ?? 0.003)))
    const rel = Math.exp(-1 / (sampleRate * Math.max(0.005, node.release?.getValueAtTime(time) ?? 0.25)))
    state.env = abs > state.env ? att * state.env + (1 - att) * abs : rel * state.env + (1 - rel) * abs
    compState.set(node, state)
    const threshDb = node.threshold?.getValueAtTime(time) ?? -24
    const thresh = Math.pow(10, threshDb / 20)
    const ratio = Math.max(1, node.ratio?.getValueAtTime(time) ?? 12)
    let gain = 1
    if (state.env > thresh) {
      const over = state.env / thresh
      const compressed = Math.pow(over, 1 - 1 / ratio)
      gain = compressed / over
    }
    return { l: input.l * gain, r: input.r * gain }
  }

  if (node.kind === 'filter') {
    const cutoff = Math.min(sampleRate * 0.45, Math.max(40, modulated(node.frequency, time, values, 12000)))
    const q = Math.max(0.05, modulated(node.Q, time, values, 0.707))
    const peak = modulated(node.gain, time, values, 0)
    const c = biquad(node.type, cutoff, q, peak, sampleRate)
    const st = filterState.get(node) ?? { x1: 0, x2: 0, y1: 0, y2: 0, x1r: 0, x2r: 0, y1r: 0, y2r: 0 }
    const l = c.b0 * input.l + c.b1 * st.x1 + c.b2 * st.x2 - c.a1 * st.y1 - c.a2 * st.y2
    const r = c.b0 * input.r + c.b1 * st.x1r + c.b2 * st.x2r - c.a1 * st.y1r - c.a2 * st.y2r
    st.x2 = st.x1
    st.x1 = input.l
    st.y2 = st.y1
    st.y1 = l
    st.x2r = st.x1r
    st.x1r = input.r
    st.y2r = st.y1r
    st.y1r = r
    filterState.set(node, st)
    return { l, r }
  }

  return input
}

function shape(x: number, curve: Float32Array | null): number {
  if (!curve || curve.length < 2) return Math.tanh(x)
  const t = (Math.min(1, Math.max(-1, x)) + 1) * 0.5
  const pos = t * (curve.length - 1)
  const i0 = Math.floor(pos)
  const i1 = Math.min(curve.length - 1, i0 + 1)
  const frac = pos - i0
  return curve[i0] * (1 - frac) + curve[i1] * frac
}

function biquad(type: string, freq: number, q: number, gainDb: number, sampleRate: number) {
  const w0 = (2 * Math.PI * freq) / sampleRate
  const cos = Math.cos(w0)
  const sin = Math.sin(w0)
  const alpha = sin / (2 * Math.max(0.05, q))
  const A = Math.pow(10, gainDb / 40)
  let b0 = 1
  let b1 = 0
  let b2 = 0
  let a0 = 1
  let a1 = 0
  let a2 = 0
  if (type === 'highpass') {
    b0 = (1 + cos) / 2
    b1 = -(1 + cos)
    b2 = (1 + cos) / 2
    a0 = 1 + alpha
    a1 = -2 * cos
    a2 = 1 - alpha
  } else if (type === 'bandpass') {
    b0 = alpha
    b1 = 0
    b2 = -alpha
    a0 = 1 + alpha
    a1 = -2 * cos
    a2 = 1 - alpha
  } else if (type === 'notch') {
    b0 = 1
    b1 = -2 * cos
    b2 = 1
    a0 = 1 + alpha
    a1 = -2 * cos
    a2 = 1 - alpha
  } else if (type === 'allpass') {
    b0 = 1 - alpha
    b1 = -2 * cos
    b2 = 1 + alpha
    a0 = 1 + alpha
    a1 = -2 * cos
    a2 = 1 - alpha
  } else if (type === 'peaking') {
    b0 = 1 + alpha * A
    b1 = -2 * cos
    b2 = 1 - alpha * A
    a0 = 1 + alpha / A
    a1 = -2 * cos
    a2 = 1 - alpha / A
  } else if (type === 'lowshelf') {
    const f = 2 * Math.sqrt(A) * alpha
    b0 = A * (A + 1 - (A - 1) * cos + f)
    b1 = 2 * A * (A - 1 - (A + 1) * cos)
    b2 = A * (A + 1 - (A - 1) * cos - f)
    a0 = A + 1 + (A - 1) * cos + f
    a1 = -2 * (A - 1 + (A + 1) * cos)
    a2 = A + 1 + (A - 1) * cos - f
  } else if (type === 'highshelf') {
    const f = 2 * Math.sqrt(A) * alpha
    b0 = A * (A + 1 + (A - 1) * cos + f)
    b1 = -2 * A * (A - 1 + (A + 1) * cos)
    b2 = A * (A + 1 + (A - 1) * cos - f)
    a0 = A + 1 - (A - 1) * cos + f
    a1 = 2 * (A - 1 - (A + 1) * cos)
    a2 = A + 1 - (A - 1) * cos - f
  } else {
    b0 = (1 - cos) / 2
    b1 = 1 - cos
    b2 = (1 - cos) / 2
    a0 = 1 + alpha
    a1 = -2 * cos
    a2 = 1 - alpha
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
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
  const visiting = new Set<SoftNode>()
  const order: SoftNode[] = []

  function emitDelay(node: SoftNode): void {
    if (seen.has(node)) return
    seen.add(node)
    for (const mod of paramMods(node)) visit(mod)
    order.push(node)
  }

  function visit(node: SoftNode): void {
    if (seen.has(node) || visiting.has(node)) return
    visiting.add(node)
    if (node.kind === 'delay') {
      emitDelay(node)
      for (const input of node.inputs) visit(input)
      visiting.delete(node)
      return
    }
    for (const input of node.inputs) {
      if (input.kind === 'delay') emitDelay(input)
      else visit(input)
    }
    for (const mod of paramMods(node)) visit(mod)
    visiting.delete(node)
    if (!seen.has(node)) {
      seen.add(node)
      order.push(node)
    }
  }

  visit(destination)
  return order
}

function paramMods(node: SoftNode): SoftNode[] {
  const params = [
    node.frequency,
    node.gain,
    node.Q,
    node.delayTime,
    node.playbackRate,
    node.pan,
    node.threshold,
    node.ratio,
    node.attack,
    node.release,
  ]
  const mods: SoftNode[] = []
  for (const param of params) {
    if (!param) continue
    for (const mod of param.modulators) mods.push(mod)
  }
  return mods
}

function clamp1(v: number): number {
  return v > 1 ? 1 : v < -1 ? -1 : v
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

export function makeDriveCurve(amount: number, n = 256): Float32Array {
  const curve = new Float32Array(n)
  const k = 1 + amount * 12
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.tanh(x * k)
  }
  return curve
}
