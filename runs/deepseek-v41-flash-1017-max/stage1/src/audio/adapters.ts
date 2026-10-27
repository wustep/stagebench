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
  BufferSourceLike,
  GainNodeLike,
} from './types'
import type { MidiAccessLike, MidiInputLike } from '../input/midi'

/** Native node behind each wrapper, so `connect` can pass the real object. */
const nativeNodes = new WeakMap<object, AudioNode>()

export function nativeNodeOf(node: AudioNodeLike): AudioNode | undefined {
  return nativeNodes.get(node as object)
}

function wrapParam(param: AudioParam): AudioParamLike {
  return {
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
}

function wrapNode(node: AudioNode): AudioNodeLike {
  const wrapper: AudioNodeLike = {
    connect: (target) => {
      const nativeTarget = nativeNodes.get(target as object)
      if (!nativeTarget) {
        throw new Error('connect() received a node that is not part of this audio graph')
      }
      node.connect(nativeTarget)
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
    connect: (target) => {
      const nativeTarget = nativeNodes.get(target as object)
      if (!nativeTarget) {
        throw new Error('connect() received a node that is not part of this audio graph')
      }
      source.connect(nativeTarget)
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

export function adaptAudioContext(context: AudioContext): AudioContextLike {
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
    suspend: () => context.suspend(),
    close: () => context.close(),
    createGain: () => wrapGain(context.createGain()),
    createBuffer: (channels, length, sampleRate) => {
      const native = context.createBuffer(channels, length, sampleRate)
      const wrapped = wrapBuffer(native)
      nativeBuffers.set(wrapped as object, native)
      return wrapped
    },
    createBufferSource: () => wrapSource(context.createBufferSource()),
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
