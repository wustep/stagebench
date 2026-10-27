import type {
  AudioBufferLike,
  AudioContextLike,
  AudioEngine,
  AudioNodeLike,
  AudioParamLike,
  AudioStatusReport,
  BufferSourceLike,
  GainNodeLike,
  VoiceHandle,
} from './types'

/**
 * Recording fakes for the audio boundary.
 *
 * These exist so the note lifecycle, the master path and node cleanup can be asserted
 * without an AudioContext. They deliberately do **not** stand in for audible proof: the
 * audio tests measure the real model through the shared master stage in
 * `pianoModel.test.ts`.
 */

export interface RecordedSchedule {
  voiceId: string
  midi: number
  velocity: number
  startTime: number
  stopTime: number | null
  releaseCurve: Float32Array | null
}

/** Fake AudioParam that records the calls the engine makes. */
export function createFakeParam(initial = 0): AudioParamLike & { calls: string[] } {
  const calls: string[] = []
  let value = initial
  return {
    calls,
    get value() {
      return value
    },
    set value(next: number) {
      value = next
    },
    setValueAtTime(v: number) {
      calls.push(`setValueAtTime(${v})`)
      value = v
      return undefined
    },
    linearRampToValueAtTime(v: number) {
      calls.push(`linearRamp(${v})`)
      value = v
      return undefined
    },
    setValueCurveAtTime(values: Float32Array) {
      calls.push(`curve(${values.length})`)
      return undefined
    },
    cancelScheduledValues() {
      calls.push('cancel')
      return undefined
    },
  }
}

export interface FakeContext extends AudioContextLike {
  readonly createdGains: number
  readonly createdSources: number
  readonly renderedBuffers: AudioBufferLike[]
  readonly connectedToMaster: number
  readonly destinations: number
  /** Advance the transport so scheduled stops can be observed. */
  advance(seconds: number): void
  /** Fire the `onended` handler of every source still alive. */
  fireAllEnded(): void
}

export interface FakeContextOptions {
  sampleRate?: number
  /** When set, `resume()` rejects with this message (AudioContext blocked). */
  failResume?: string
  /** When set, the factory throws before a context exists at all. */
  failCreate?: string
}

export function createFakeContext(options: FakeContextOptions = {}): FakeContext {
  if (options.failCreate) throw new Error(options.failCreate)
  const sampleRate = options.sampleRate ?? 48000
  let currentTime = 0
  let createdGains = 0
  let createdSources = 0
  let connectedToMaster = 0
  let destinations = 0
  let state: 'suspended' | 'running' | 'closed' = 'suspended'
  const renderedBuffers: AudioBufferLike[] = []
  const liveSources = new Set<BufferSourceLike>()

  const masterSink: AudioNodeLike = {
    connect() {
      throw new Error('destination cannot connect onwards')
    },
    disconnect() {},
  }

  function makeGain(): GainNodeLike {
    createdGains += 1
    const target: AudioNodeLike = {
      connect(node: AudioNodeLike) {
        if (node === masterSink) destinations += 1
        connectedToMaster += 1
        return undefined
      },
      disconnect() {},
    }
    return { ...target, gain: createFakeParam(1) }
  }

  function makeBuffer(channels: number, length: number, rate: number): AudioBufferLike {
    const data: Float32Array[] = Array.from({ length: channels }, () => new Float32Array(length))
    const buffer: AudioBufferLike = {
      duration: length / rate,
      length,
      numberOfChannels: channels,
      sampleRate: rate,
      getChannelData: (channel) => data[channel],
    }
    renderedBuffers.push(buffer)
    return buffer
  }

  const context: FakeContext = {
    sampleRate,
    get currentTime() {
      return currentTime
    },
    get state() {
      return state
    },
    destination: masterSink,
    async resume() {
      if (options.failResume) throw new Error(options.failResume)
      state = 'running'
    },
    async suspend() {
      state = 'suspended'
    },
    async close() {
      state = 'closed'
    },
    createGain: makeGain,
    createBuffer: makeBuffer,
    createBufferSource() {
      createdSources += 1
      const source: BufferSourceLike & { stopTime: number | null } = {
        buffer: null,
        loop: false,
        onended: null,
        stopTime: null,
        start() {},
        stop(when?: number) {
          source.stopTime = when ?? currentTime
        },
        connect() {
          return undefined
        },
        disconnect() {},
      }
      liveSources.add(source)
      return source
    },
    get createdGains() {
      return createdGains
    },
    get createdSources() {
      return createdSources
    },
    get renderedBuffers() {
      return renderedBuffers
    },
    get connectedToMaster() {
      return connectedToMaster
    },
    get destinations() {
      return destinations
    },
    advance(seconds: number) {
      currentTime += seconds
    },
    fireAllEnded() {
      for (const source of Array.from(liveSources)) {
        const handler = source.onended
        if (!handler) continue
        liveSources.delete(source)
        handler()
      }
    },
  } as FakeContext

  return context
}

/** An engine that records the calls the session makes, with no audio graph. */
export interface RecordingEngine extends AudioEngine {
  readonly started: number
  readonly startedVoices: VoiceHandle[]
  readonly endedVoices: string[]
  readonly stopAllCalls: number
}

export function createRecordingEngine(): RecordingEngine {
  let voices = 0
  let liveNodes = 0
  let started = 0
  let stopAllCalls = 0
  const startedVoices: VoiceHandle[] = []
  const endedVoices: string[] = []
  let report: AudioStatusReport = { status: 'ready', detail: 'Recording engine ready' }
  const listeners = new Set<(report: AudioStatusReport) => void>()

  return {
    kind: 'webaudio',
    status: () => report,
    async start() {
      started += 1
      return report
    },
    noteOn(voice) {
      startedVoices.push(voice)
      voices += 1
      liveNodes += 2
    },
    noteOff(voiceId) {
      if (!endedVoices.includes(voiceId)) {
        endedVoices.push(voiceId)
        voices = Math.max(0, voices - 1)
        liveNodes = Math.max(0, liveNodes - 2)
      }
    },
    stopAll() {
      stopAllCalls += 1
      voices = 0
      liveNodes = 0
    },
    activeVoiceCount: () => voices,
    liveNodeCount: () => liveNodes,
    subscribe(listener) {
      listeners.add(listener)
      listener(report)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      listeners.clear()
      report = { status: 'idle', detail: 'disposed' }
    },
    get started() {
      return started
    },
    get startedVoices() {
      return startedVoices
    },
    get endedVoices() {
      return endedVoices
    },
    get stopAllCalls() {
      return stopAllCalls
    },
  }
}
