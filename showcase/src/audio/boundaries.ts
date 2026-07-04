/**
 * Injectable browser boundaries. Production code passes the real Web Audio /
 * Web MIDI / timer / asset-fetch implementations; tests pass deterministic
 * fakes, and the offline rendered-audio suite passes a real
 * OfflineAudioContext (node-web-audio-api) plus filesystem asset reads.
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
  connect(destination: AudioNodeLike | AudioParamLike): unknown
  /** Argless: sever every outgoing edge. With a destination: sever only the
   *  edge to that node (used to release channel->voice feeds on cleanup). */
  disconnect(destination?: AudioNodeLike | AudioParamLike): void
}

export interface GainNodeLike extends AudioNodeLike {
  gain: AudioParamLike
}

/** Opaque handle for a custom periodic waveform built from Fourier coefficients.
 *  Never inspected — only round-tripped from createPeriodicWave to setPeriodicWave. */
export type PeriodicWaveLike = object

export interface OscillatorNodeLike extends AudioNodeLike {
  type: string
  frequency: AudioParamLike
  detune: AudioParamLike
  start(when?: number): void
  stop(when?: number): void
  setPeriodicWave(wave: PeriodicWaveLike): void
}

export interface BiquadFilterNodeLike extends AudioNodeLike {
  type: string
  frequency: AudioParamLike
  Q: AudioParamLike
  gain: AudioParamLike
}

export interface DynamicsCompressorNodeLike extends AudioNodeLike {
  threshold: AudioParamLike
  knee: AudioParamLike
  ratio: AudioParamLike
  attack: AudioParamLike
  release: AudioParamLike
}

export interface AudioBufferLike {
  readonly duration: number
  readonly length: number
  readonly numberOfChannels: number
  readonly sampleRate: number
  getChannelData(channel: number): Float32Array
}

export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null
  playbackRate: AudioParamLike
  detune: AudioParamLike
  loop: boolean
  start(when?: number, offset?: number): void
  stop(when?: number): void
}

export interface DelayNodeLike extends AudioNodeLike {
  delayTime: AudioParamLike
}

export interface WaveShaperNodeLike extends AudioNodeLike {
  curve: Float32Array | null
  oversample: string
}

export interface ConvolverNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null
}

export interface StereoPannerNodeLike extends AudioNodeLike {
  pan: AudioParamLike
}

export interface AudioContextLike {
  readonly currentTime: number
  readonly destination: AudioNodeLike
  readonly state: string
  readonly sampleRate: number
  resume(): Promise<void>
  close(): Promise<void>
  createGain(): GainNodeLike
  createOscillator(): OscillatorNodeLike
  createBiquadFilter(): BiquadFilterNodeLike
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike
  createBufferSource(): AudioBufferSourceNodeLike
  createDelay(maxDelay?: number): DelayNodeLike
  createWaveShaper(): WaveShaperNodeLike
  createConvolver(): ConvolverNodeLike
  createStereoPanner(): StereoPannerNodeLike
  createDynamicsCompressor?(): DynamicsCompressorNodeLike
  createPeriodicWave(real: Float32Array, imag: Float32Array): PeriodicWaveLike
  decodeAudioData(bytes: ArrayBuffer): Promise<AudioBufferLike>
}

export interface TimerBoundary {
  setTimeout(fn: () => void, ms: number): number
  clearTimeout(id: number): void
  /** Monotonic wall-clock in ms (used by delay tap tempo). */
  now(): number
}

/**
 * Sample-asset access. `load` may resolve synchronously (deterministic unit
 * tests) or asynchronously (fetch in the browser, fs reads in the offline
 * render suite). The value is either raw encoded bytes (decoded through the
 * context) or an already-decoded buffer (fakes).
 */
export type SampleData = ArrayBuffer | AudioBufferLike

export interface AssetBoundary {
  load(path: string): SampleData | Promise<SampleData>
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
      now: () => performance.now(),
    },
  }
}

export function realAssetBoundary(): AssetBoundary {
  const base = import.meta.env.BASE_URL ?? './'
  return {
    async load(path: string) {
      const response = await fetch(`${base}${path}`)
      if (!response.ok) throw new Error(`Sample fetch failed (${response.status}): ${path}`)
      return response.arrayBuffer()
    },
  }
}

/* -------------------------------------------------------------- storage -- */

/** Injectable persistence for programs (Live slots must survive reload). */
export interface StorageBoundary {
  load(key: string): string | null
  save(key: string, value: string): void
}

export function realStorageBoundary(): StorageBoundary {
  return {
    load(key) {
      try {
        return window.localStorage.getItem(key)
      } catch {
        return null // storage denied (private mode / sandbox): programs stay in-memory
      }
    },
    save(key, value) {
      try {
        window.localStorage.setItem(key, value)
      } catch {
        /* storage denied: programs stay in-memory */
      }
    },
  }
}

/* ---------------------------------------------------------------- MIDI -- */

export interface MidiMessageEventLike {
  data: Uint8Array | null
  /** DOMHighResTimeStamp of the message (Web MIDI provides it; used for
   *  external-clock tempo estimation). */
  timeStamp?: number
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
