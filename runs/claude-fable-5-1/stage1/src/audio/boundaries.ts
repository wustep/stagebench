/**
 * Injectable boundaries. Production wires the browser implementations; tests inject fakes so no
 * real audio output, MIDI device, network or wall clock is required.
 */
export interface AudioParamLike {
  value: number
  setValueAtTime(value: number, time: number): unknown
  linearRampToValueAtTime(value: number, time: number): unknown
  exponentialRampToValueAtTime(value: number, time: number): unknown
  setTargetAtTime(value: number, time: number, constant: number): unknown
  cancelScheduledValues(time: number): unknown
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown
  disconnect(): void
}

export interface GainNodeLike extends AudioNodeLike {
  gain: AudioParamLike
}

export interface AudioBufferLike {
  readonly sampleRate: number
  readonly length: number
  readonly duration: number
  readonly numberOfChannels: number
  copyToChannel(source: Float32Array, channel: number): void
  getChannelData(channel: number): Float32Array
}

export interface BufferSourceLike extends AudioNodeLike {
  buffer: AudioBufferLike | null
  playbackRate: AudioParamLike
  onended: (() => void) | null
  start(when?: number): void
  stop(when?: number): void
}

export interface OscillatorLike extends AudioNodeLike {
  type: string
  frequency: AudioParamLike
  onended: (() => void) | null
  start(when?: number): void
  stop(when?: number): void
}

export interface AudioContextLike {
  readonly currentTime: number
  readonly sampleRate: number
  readonly state: 'suspended' | 'running' | 'closed'
  readonly destination: AudioNodeLike
  createGain(): GainNodeLike
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike
  createBufferSource(): BufferSourceLike
  createOscillator(): OscillatorLike
  resume(): Promise<void>
  close(): Promise<void>
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
  now(): number
}

export interface MidiMessageEventLike {
  data: Uint8Array | null
}

export interface MidiPortLike {
  id: string
  name?: string | null
  type?: 'input' | 'output'
  state: 'connected' | 'disconnected'
}

export interface MidiInputLike extends MidiPortLike {
  onmidimessage: ((event: MidiMessageEventLike) => void) | null
}

export interface MidiAccessLike {
  inputs: Map<string, MidiInputLike> | { forEach(cb: (input: MidiInputLike) => void): void; size: number }
  onstatechange: ((event: { port: MidiPortLike | null }) => void) | null
}

export interface MidiBoundary {
  /** Undefined when Web MIDI is not supported by the host. */
  requestAccess?: () => Promise<MidiAccessLike>
}

export interface Boundaries {
  /** Returns a context or throws when audio is unavailable. */
  createAudioContext: () => AudioContextLike
  timers: Timers
  midi: MidiBoundary
  /** Event target for computer keyboard and blur handling. */
  windowTarget: Pick<Window, 'addEventListener' | 'removeEventListener'> | null
}

export function browserBoundaries(): Boundaries {
  const w = globalThis as unknown as {
    AudioContext?: new () => AudioContextLike
    webkitAudioContext?: new () => AudioContextLike
    navigator?: { requestMIDIAccess?: (options?: { sysex?: boolean }) => Promise<MidiAccessLike> }
  }
  const Ctor = w.AudioContext ?? w.webkitAudioContext
  const requestMIDIAccess = w.navigator?.requestMIDIAccess
  return {
    createAudioContext: () => {
      if (!Ctor) throw new Error('Web Audio is not available in this browser')
      return new Ctor()
    },
    timers: {
      setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
      clearTimeout: (h) => globalThis.clearTimeout(h as number),
      now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    },
    midi: requestMIDIAccess
      ? { requestAccess: () => requestMIDIAccess.call(w.navigator, { sysex: false }) }
      : {},
    windowTarget: typeof window !== 'undefined' ? window : null,
  }
}
