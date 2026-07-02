/**
 * Injectable browser boundaries. Production code passes the real Web Audio /
 * Web MIDI / timer implementations; tests pass deterministic fakes.
 */

export interface AudioParamLike {
  value: number
  setValueAtTime(value: number, time: number): unknown
  linearRampToValueAtTime(value: number, time: number): unknown
  exponentialRampToValueAtTime(value: number, time: number): unknown
  setTargetAtTime(value: number, time: number, timeConstant: number): unknown
  cancelScheduledValues(time: number): unknown
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown
  disconnect(): void
}

export interface GainNodeLike extends AudioNodeLike {
  gain: AudioParamLike
}

export interface OscillatorNodeLike extends AudioNodeLike {
  type: string
  frequency: AudioParamLike
  detune: AudioParamLike
  start(when?: number): void
  stop(when?: number): void
}

export interface BiquadFilterNodeLike extends AudioNodeLike {
  type: string
  frequency: AudioParamLike
  Q: AudioParamLike
}

export interface DynamicsCompressorNodeLike extends AudioNodeLike {
  threshold: AudioParamLike
  knee: AudioParamLike
  ratio: AudioParamLike
  attack: AudioParamLike
  release: AudioParamLike
}

export interface AudioContextLike {
  readonly currentTime: number
  readonly destination: AudioNodeLike
  readonly state: string
  resume(): Promise<void>
  close(): Promise<void>
  createGain(): GainNodeLike
  createOscillator(): OscillatorNodeLike
  createBiquadFilter(): BiquadFilterNodeLike
  createDynamicsCompressor?(): DynamicsCompressorNodeLike
}

export interface TimerBoundary {
  setTimeout(fn: () => void, ms: number): number
  clearTimeout(id: number): void
}

export interface AudioBoundary {
  /** Creates the audio context. Called lazily on the first note gesture. */
  createContext(): AudioContextLike
  timers: TimerBoundary
}

export function realAudioBoundary(): AudioBoundary {
  return {
    createContext() {
      const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) throw new Error('Web Audio is not supported in this browser')
      return new Ctor() as unknown as AudioContextLike
    },
    timers: {
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (id) => window.clearTimeout(id),
    },
  }
}

/* ---------------------------------------------------------------- MIDI -- */

export interface MidiMessageEventLike {
  data: Uint8Array | null
}

export interface MidiPortLike {
  id?: string
  name?: string | null
  state?: string
  onmidimessage: ((event: MidiMessageEventLike) => void) | null
}

export interface MidiAccessLike {
  inputs: { values(): IterableIterator<MidiPortLike> | MidiPortLike[] | Iterable<MidiPortLike> }
  onstatechange: ((event: { port?: MidiPortLike | null }) => void) | null
}

export interface MidiBoundary {
  /** Undefined when the platform has no Web MIDI support. */
  requestAccess?: () => Promise<MidiAccessLike>
}

export function realMidiBoundary(): MidiBoundary {
  const nav = navigator as Navigator & { requestMIDIAccess?: () => Promise<unknown> }
  const request = nav.requestMIDIAccess?.bind(nav)
  if (typeof request !== 'function') return {}
  // The DOM MIDIAccess type is structurally compatible with the narrow
  // MidiAccessLike surface this app reads; the adapter cast keeps the
  // boundary injectable for tests.
  return { requestAccess: () => request() as Promise<MidiAccessLike> }
}
