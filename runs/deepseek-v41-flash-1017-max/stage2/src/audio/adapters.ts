/**
 * Adapters from the platform's Web Audio and Web MIDI objects to the narrow interfaces
 * the engine and the MIDI bridge talk to.
 *
 * Adapting explicitly (instead of casting) keeps the boundary honest: everything the app
 * depends on is listed here, and the fake used in tests implements the same shape.
 *
 * Each wrapper keeps a private reference to the native node, because `connect` must be
 * handed the platform object — passing the wrapper itself throws Overload resolution
 * failed, which is a real failure this adapter exists to prevent.
 */
import type {
  AudioBufferLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterLike,
  BufferSourceLike,
  CompressorLike,
  ConvolverLike,
  DelayLike,
  GainNodeLike,
  OscillatorLike,
  StereoPannerLike,
  WaveShaperLike,
} from './types'
import type { MidiAccessLike, MidiInputLike } from '../input/midi'

/**
 * Native node behind each wrapper, so `connect` can pass the real object.
 *
 * Web Audio also allows connecting a node to an `AudioParam` — that is how every LFO,
 * envelope follower and rotary modulator is wired — so param wrappers are registered in
 * their own map. Resolving only nodes made every modulation connection throw.
 */
const nativeNodes = new WeakMap<object, AudioNode>()
const nativeParams = new WeakMap<object, AudioParam>()

export function nativeNodeOf(node: AudioNodeLike): AudioNode | undefined {
  return nativeNodes.get(node as object)
}

/** The real node *or* param behind a wrapper, for `connect()`. */
function nativeTargetOf(target: AudioNodeLike | AudioParamLike): AudioNode | AudioParam | undefined {
  return (
    nativeNodes.get(target as object) ?? nativeParams.get(target as object)
  )
}

function wrapParam(param: AudioParam): AudioParamLike {
  const wrapper: AudioParamLike = {
    get value() {
      return param.value
    },
    set value(next: number) {
      param.value = next
    },
    setValueAtTime: (value, time) => param.setValueAtTime(value, time),
    linearRampToValueAtTime: (value, time) => param.linearRampToValueAtTime(value, time),
    setValueCurveAtTime: (values, time, duration) => {
      // The platform expects a real Float32Array with at least two entries.
      const curve =
        values.length >= 2 ? values : Float32Array.from([values[0] ?? 0, values[0] ?? 0])
      param.setValueCurveAtTime(curve, time, duration)
      return undefined
    },
    cancelScheduledValues: (time) => param.cancelScheduledValues(time),
  }
  nativeParams.set(wrapper, param)
  return wrapper
}

function wrapNode(node: AudioNode): AudioNodeLike {
  const wrapper: AudioNodeLike = {
    connect: (target, output, input) => {
      const nativeTarget = nativeTargetOf(target)
      if (!nativeTarget) {
        throw new Error('connect() received a node that is not part of this audio graph')
      }
      if (output === undefined) node.connect(nativeTarget as AudioNode)
      else if (input === undefined) node.connect(nativeTarget as AudioNode, output)
      else node.connect(nativeTarget as AudioNode, output, input)
      return undefined
    },
    disconnect: () => node.disconnect(),
  }
  nativeNodes.set(wrapper, node)
  return wrapper
}

function wrapGain(node: GainNode): GainNodeLike {
  const wrapper: GainNodeLike = { ...wrapNode(node), gain: wrapParam(node.gain) }
  // `wrapNode` registered the spread copy, not this object, so register again.
  nativeNodes.set(wrapper, node)
  return wrapper
}

/** A generic filter node wrapper: type is a plain string, the rest are params. */
function wrapBiquad(node: BiquadFilterNode): BiquadFilterLike {
  const wrapper: BiquadFilterLike = {
    ...wrapNode(node),
    get type() {
      return node.type
    },
    set type(next: string) {
      node.type = next as BiquadFilterType
    },
    frequency: wrapParam(node.frequency),
    Q: wrapParam(node.Q),
    gain: wrapParam(node.gain),
    detune: wrapParam(node.detune),
  }
  nativeNodes.set(wrapper, node)
  return wrapper
}

function wrapDelay(node: DelayNode): DelayLike {
  const wrapper: DelayLike = { ...wrapNode(node), delayTime: wrapParam(node.delayTime) }
  nativeNodes.set(wrapper, node)
  return wrapper
}

function wrapConvolver(node: ConvolverNode): ConvolverLike {
  const wrapper: ConvolverLike = {
    ...wrapNode(node),
    get buffer() {
      return node.buffer ? wrapBuffer(node.buffer) : null
    },
    set buffer(next: AudioBufferLike | null) {
      node.buffer = next ? toNativeBuffer(next) : null
    },
    get normalize() {
      return node.normalize
    },
    set normalize(next: boolean) {
      node.normalize = next
    },
  }
  nativeNodes.set(wrapper, node)
  return wrapper
}

function wrapCompressor(node: DynamicsCompressorNode): CompressorLike {
  const wrapper: CompressorLike = {
    ...wrapNode(node),
    threshold: wrapParam(node.threshold),
    knee: wrapParam(node.knee),
    ratio: wrapParam(node.ratio),
    attack: wrapParam(node.attack),
    release: wrapParam(node.release),
  }
  nativeNodes.set(wrapper, node)
  return wrapper
}

function wrapPanner(node: StereoPannerNode): StereoPannerLike {
  const wrapper: StereoPannerLike = { ...wrapNode(node), pan: wrapParam(node.pan) }
  nativeNodes.set(wrapper, node)
  return wrapper
}

function wrapOscillator(node: OscillatorNode): OscillatorLike {
  const wrapper: OscillatorLike = {
    ...wrapNode(node),
    get type() {
      return node.type
    },
    set type(next: string) {
      node.type = next as OscillatorType
    },
    frequency: wrapParam(node.frequency),
    detune: wrapParam(node.detune),
    get onended() {
      return node.onended as ((event?: unknown) => void) | null
    },
    set onended(handler: ((event?: unknown) => void) | null) {
      node.onended = handler as ((this: AudioScheduledSourceNode, ev: Event) => unknown) | null
    },
    start: (when) => node.start(when),
    stop: (when) => node.stop(when),
  }
  nativeNodes.set(wrapper, node)
  return wrapper
}

function wrapShaper(node: WaveShaperNode): WaveShaperLike {
  const wrapper: WaveShaperLike = {
    ...wrapNode(node),
    get curve() {
      return node.curve
    },
    set curve(next: Float32Array | null) {
      // DOM types narrow `curve` to Float32Array<ArrayBuffer>; the app only ever builds
      // plain Float32Arrays, so the cast is exact rather than a widening.
      node.curve = next as Float32Array<ArrayBuffer> | null
    },
    get oversample() {
      return node.oversample
    },
    set oversample(next: string) {
      node.oversample = next as OverSampleType
    },
  }
  nativeNodes.set(wrapper, node)
  return wrapper
}

function wrapBuffer(buffer: AudioBuffer): AudioBufferLike {
  return {
    duration: buffer.duration,
    length: buffer.length,
    numberOfChannels: buffer.numberOfChannels,
    sampleRate: buffer.sampleRate,
    getChannelData: (channel) => buffer.getChannelData(channel),
  }
}

function wrapSource(source: AudioBufferSourceNode): BufferSourceLike {
  const wrapper: BufferSourceLike = {
    get buffer() {
      return source.buffer ? wrapBuffer(source.buffer) : null
    },
    set buffer(next: AudioBufferLike | null) {
      source.buffer = next ? toNativeBuffer(next) : null
    },
    get loop() {
      return source.loop
    },
    set loop(next: boolean) {
      source.loop = next
    },
    get onended() {
      return source.onended as ((event?: unknown) => void) | null
    },
    set onended(handler: ((event?: unknown) => void) | null) {
      source.onended = handler as ((this: AudioScheduledSourceNode, ev: Event) => unknown) | null
    },
    start: (when) => source.start(when),
    stop: (when) => source.stop(when),
    connect: (target, output, input) => {
      const nativeTarget = nativeTargetOf(target)
      if (!nativeTarget) {
        throw new Error('connect() received a node that is not part of this audio graph')
      }
      if (output === undefined) source.connect(nativeTarget as AudioNode)
      else if (input === undefined) source.connect(nativeTarget as AudioNode, output)
      else source.connect(nativeTarget as AudioNode, output, input)
    },
    disconnect: () => source.disconnect(),
  }
  nativeNodes.set(wrapper, source)
  return wrapper
}

/** Buffers created by this adapter keep their native object so they can be assigned back. */
const nativeBuffers = new WeakMap<object, AudioBuffer>()

function toNativeBuffer(buffer: AudioBufferLike): AudioBuffer | null {
  return nativeBuffers.get(buffer as object) ?? null
}

/**
 * The part of a context this adapter needs: the node factories and the destination. A live
 * `AudioContext` satisfies it, and so does an `OfflineAudioContext`, which lets the evidence
 * harness adapt exactly the way the app does instead of duplicating the node wrappers.
 */
export type AdaptableContext = Pick<
  AudioContext,
  | 'sampleRate'
  | 'currentTime'
  | 'state'
  | 'destination'
  | 'resume'
  | 'createGain'
  | 'createBuffer'
  | 'createBufferSource'
  | 'createBiquadFilter'
  | 'createDelay'
  | 'createConvolver'
  | 'createDynamicsCompressor'
  | 'createStereoPanner'
  | 'createOscillator'
  | 'createWaveShaper'
  | 'createChannelSplitter'
  | 'createChannelMerger'
  | 'decodeAudioData'
> & {
  /** Optional, because an offline context has no transport to close or suspend. */
  close?: () => Promise<void>
  /** Typed loosely because an offline context's suspend takes a mandatory time. */
  suspend?: (...args: never[]) => Promise<void>
}

export function adaptAudioContext(context: AdaptableContext): AudioContextLike {
  return {
    get sampleRate() {
      return context.sampleRate
    },
    get currentTime() {
      return context.currentTime
    },
    get state() {
      return context.state
    },
    get destination() {
      return wrapNode(context.destination)
    },
    resume: () => context.resume(),
    suspend: context.suspend ? () => context.suspend!() : undefined,
    close: context.close ? () => context.close!() : undefined,
    createGain: () => wrapGain(context.createGain()),
    createBuffer: (channels, length, sampleRate) => {
      const native = context.createBuffer(channels, length, sampleRate)
      const wrapped = wrapBuffer(native)
      nativeBuffers.set(wrapped as object, native)
      return wrapped
    },
    createBufferSource: () => wrapSource(context.createBufferSource()),
    // Phase 2 node factories. The effect graph is built from these, so leaving them out
    // would make every effect silently unavailable in a real browser.
    createBiquadFilter: () => wrapBiquad(context.createBiquadFilter()),
    createDelay: (maxDelaySeconds?: number) =>
      wrapDelay(
        typeof maxDelaySeconds === 'number'
          ? context.createDelay(maxDelaySeconds)
          : context.createDelay(),
      ),
    createConvolver: () => wrapConvolver(context.createConvolver()),
    createDynamicsCompressor: () => wrapCompressor(context.createDynamicsCompressor()),
    createStereoPanner: () => wrapPanner(context.createStereoPanner()),
    createOscillator: () => wrapOscillator(context.createOscillator()),
    createWaveShaper: () => wrapShaper(context.createWaveShaper()),
    decodeAudioData: (data: ArrayBuffer) =>
      context.decodeAudioData(data).then((buffer) => {
        const wrapped = wrapBuffer(buffer)
        nativeBuffers.set(wrapped as object, buffer)
        return wrapped
      }),
  }
}

function wrapPort(port: MIDIPort): MidiInputLike {
  return {
    id: port.id,
    name: port.name ?? undefined,
    manufacturer: port.manufacturer ?? undefined,
    state: port.state,
    onmidimessage: null,
  }
}

function wrapInput(input: MIDIInput): MidiInputLike {
  return {
    id: input.id,
    name: input.name ?? undefined,
    manufacturer: input.manufacturer ?? undefined,
    state: input.state,
    get onmidimessage() {
      return null
    },
    set onmidimessage(handler: ((event: { data: Uint8Array }) => void) | null) {
      input.onmidimessage = handler
        ? (event: MIDIMessageEvent) => {
            handler({ data: event.data ?? new Uint8Array() })
          }
        : null
    },
  }
}

export function adaptMidiAccess(access: MIDIAccess): MidiAccessLike {
  const inputs = new Map<string, MidiInputLike>()
  for (const input of Array.from(access.inputs.values())) {
    inputs.set(input.id, wrapInput(input))
  }
  const wrapped: MidiAccessLike = {
    inputs,
    onstatechange: null,
  }
  // Rebuild the wrapped map whenever the platform reports a hot-plug change.
  access.onstatechange = (event: MIDIConnectionEvent) => {
    wrapped.inputs.clear()
    for (const input of Array.from(access.inputs.values())) {
      wrapped.inputs.set(input.id, wrapInput(input))
    }
    wrapped.onstatechange?.({ port: event.port ? wrapPort(event.port) : undefined })
  }
  return wrapped
}
