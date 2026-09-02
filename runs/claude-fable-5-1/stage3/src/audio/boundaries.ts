/**
 * Injectable boundaries. Production wires the browser implementations; tests inject fakes so no
 * real audio output, MIDI device, network or wall clock is required.
 *
 * Phase 2 adds: stereo panners (unison), DSP processor nodes (the effect chains, the shared rotary and the
 * master gain/limiter run inside an AudioWorklet or, as a fallback, a ScriptProcessor on the main thread),
 * asset fetching and Ogg Vorbis decoding for the bundled sample library.
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

export interface StereoPannerLike extends AudioNodeLike {
  pan: AudioParamLike
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

export type ProcessorKind = 'layer' | 'rotary' | 'master' | 'organ' | 'synth'
export type ProcessorMode = 'worklet' | 'main-thread' | 'fake'

/**
 * A DSP processor node hosting one src/dsp object (LayerChain, RotaryUnit, MasterUnit, OrganUnit or SynthLayerUnit).
 * Parameters are plain objects applied at the next audio block; note events are posted with `send`; meters flow
 * back for panel LEDs and the status strip.
 */
export interface ProcessorNodeLike extends AudioNodeLike {
  readonly kind: ProcessorKind
  readonly mode: ProcessorMode
  /** Merges the given parameters into the processor (partial objects allowed, unit by unit). */
  setParams(params: object): void
  /** Posts a discrete event (note on/off, sustain, all-off, clock reset) to a source processor (organ / synth). */
  send(event: object): void
  onMeter: ((meter: Record<string, number>) => void) | null
  /** Stops processing and releases the node. */
  dispose(): void
}

export interface AudioContextLike {
  readonly currentTime: number
  readonly sampleRate: number
  readonly state: 'suspended' | 'running' | 'closed'
  readonly destination: AudioNodeLike
  createGain(): GainNodeLike
  createStereoPanner(): StereoPannerLike
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike
  createBufferSource(): BufferSourceLike
  createOscillator(): OscillatorLike
  resume(): Promise<void>
  close(): Promise<void>
}

/** Creates a processor node for `kind` on `ctx`; rejects when no DSP host is available. */
export type ProcessorFactory = (ctx: AudioContextLike, kind: ProcessorKind) => Promise<ProcessorNodeLike>

export interface DecodedAudio {
  channelData: Float32Array[]
  sampleRate: number
}

export interface AssetBoundary {
  /** Loads a bundled asset (relative to the sample base). Rejects on 404 / network failure. */
  fetchBytes(path: string): Promise<Uint8Array>
  /** Decodes an Ogg Vorbis file. */
  decodeVorbis(bytes: Uint8Array): Promise<DecodedAudio>
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

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

export interface Boundaries {
  /** Program bank persistence (Live slots auto-store); null / undefined = memory only. */
  storage?: StorageLike | null
  /** Returns a context or throws when audio is unavailable. */
  createAudioContext: () => AudioContextLike
  /** DSP host; null means effects are unavailable and layer buses feed the master gain directly. */
  createProcessor: ProcessorFactory | null
  /** Bundled sample assets; null means no sample library (generated voice only). */
  assets: AssetBoundary | null
  timers: Timers
  midi: MidiBoundary
  /** Event target for computer keyboard and blur handling. */
  windowTarget: Pick<Window, 'addEventListener' | 'removeEventListener'> | null
}

/** Resolves the sample base URL relative to the served document (works under any `base`). */
export function browserSampleBase(): string {
  const base = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/'
  return new URL('samples/', base).toString()
}

export function browserAssets(): AssetBoundary {
  const base = browserSampleBase()
  let decoderPromise: Promise<{ decodeFile(bytes: Uint8Array): Promise<DecodedAudio> }> | null = null
  const decoder = () => {
    if (!decoderPromise) {
      decoderPromise = import('@wasm-audio-decoders/ogg-vorbis').then(async (mod) => {
        // Decode off the main thread when Web Workers exist, otherwise synchronously.
        const useWorker = typeof Worker !== 'undefined'
        const instance = useWorker ? new mod.OggVorbisDecoderWebWorker() : new mod.OggVorbisDecoder()
        await instance.ready
        return {
          async decodeFile(bytes: Uint8Array) {
            const out = await instance.decodeFile(bytes)
            await instance.reset()
            return { channelData: out.channelData, sampleRate: out.sampleRate }
          },
        }
      })
    }
    return decoderPromise
  }
  // One decoder instance holds one stream state, so decodes are serialised.
  let queue: Promise<unknown> = Promise.resolve()
  return {
    async fetchBytes(path) {
      const response = await fetch(new URL(path, base).toString())
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${path}`)
      return new Uint8Array(await response.arrayBuffer())
    },
    decodeVorbis(bytes) {
      const run = queue.then(async () => (await decoder()).decodeFile(bytes))
      queue = run.catch(() => undefined)
      return run
    },
  }
}

/** localStorage when it is usable (private mode / sandboxed frames can throw), else null. */
export function browserStorage(): StorageLike | null {
  try {
    const ls = (globalThis as unknown as { localStorage?: StorageLike }).localStorage
    if (!ls) return null
    const probe = '__stagebench_probe__'
    ls.setItem(probe, '1')
    ls.removeItem?.(probe)
    return ls
  } catch {
    return null
  }
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
    storage: browserStorage(),
    createAudioContext: () => {
      if (!Ctor) throw new Error('Web Audio is not available in this browser')
      return new Ctor()
    },
    // Loaded lazily so tests (which inject fakes) never touch the worklet bundle.
    createProcessor: (ctx, kind) => import('./browserProcessor').then((m) => m.createBrowserProcessor(ctx, kind)),
    assets: typeof fetch === 'function' ? browserAssets() : null,
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
