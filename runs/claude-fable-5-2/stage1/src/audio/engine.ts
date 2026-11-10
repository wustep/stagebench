import type { NoteSink } from '../input/noteLifecycle'
import type {
  AudioBoundary,
  AudioContextLike,
  AudioNodeLike,
  TimingBoundary,
} from '../platform/types'
import { KernelHost, PROCESSOR_NAME, type EngineMessage, type EngineReport } from './dsp/host'

/**
 * idle     — nothing started yet (browsers require a user gesture first)
 * loading  — context created, synthesis host not yet running
 * ready    — AudioWorklet host is running
 * fallback — worklet unavailable; the same kernel is running on the main thread
 * error    — no audio at all; the keybed still moves but makes no sound
 */
export type AudioStatus = 'idle' | 'loading' | 'ready' | 'fallback' | 'error'
export type AudioBackend = 'none' | 'worklet' | 'script-processor'

export interface EngineSnapshot {
  status: AudioStatus
  /** One truthful sentence about the current state. */
  detail: string
  backend: AudioBackend
  /** Voices currently producing signal, as reported by the synthesis host. */
  voices: number
}

export interface EngineOptions {
  /** How long to wait for the worklet module before falling back. */
  loadTimeoutMs?: number
  scriptBufferSize?: number
}

const IDLE: EngineSnapshot = {
  status: 'idle',
  detail: 'Audio starts on your first key press, click, or touch.',
  backend: 'none',
  voices: 0,
}

/**
 * Main-thread face of the piano voice. It owns the AudioContext and exactly one output
 * node, connected once to the destination; the synthesis itself lives in the kernel.
 *
 * Until the host is actually running, note state is tracked but not sent; when the host
 * comes up, only notes that are still held are struck, so nothing stale ever sounds.
 */
export class PianoEngine implements NoteSink {
  private readonly audio: AudioBoundary
  private readonly timing: TimingBoundary
  private readonly loadTimeoutMs: number
  private readonly scriptBufferSize: number

  private snapshot: EngineSnapshot = IDLE
  private listeners = new Set<() => void>()
  private context: AudioContextLike | null = null
  private node: AudioNodeLike | null = null
  private post: ((message: EngineMessage) => void) | null = null
  private teardownNode: (() => void) | null = null
  private backend: AudioBackend = 'none'
  private backendNote = ''
  private live = false
  private starting: Promise<void> | null = null
  private generation = 0
  private loadTimer: unknown = null

  private held = new Map<number, number>()
  private sustain = false

  constructor(audio: AudioBoundary, timing: TimingBoundary, options: EngineOptions = {}) {
    this.audio = audio
    this.timing = timing
    this.loadTimeoutMs = options.loadTimeoutMs ?? 4000
    this.scriptBufferSize = options.scriptBufferSize ?? 1024
  }

  getSnapshot = (): EngineSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  get listenerCount(): number {
    return this.listeners.size
  }

  /** Create the context and bring up the synthesis host. Safe to call on every user gesture. */
  start(): Promise<void> {
    if (this.context) {
      this.resumeIfNeeded()
      return this.starting ?? Promise.resolve()
    }
    if (this.snapshot.status === 'error') return Promise.resolve()
    this.starting = this.bringUp().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  noteOn(note: number, velocity: number): void {
    this.held.set(note, velocity)
    if (this.live) this.post?.({ type: 'noteOn', note, velocity })
  }

  noteOff(note: number): void {
    this.held.delete(note)
    if (this.live) this.post?.({ type: 'noteOff', note })
  }

  setSustain(down: boolean): void {
    this.sustain = down
    if (this.live) this.post?.({ type: 'sustain', down })
  }

  allNotesOff(): void {
    this.held.clear()
    this.sustain = false
    // Sent even when not live: a host that exists must never be left ringing.
    this.post?.({ type: 'allNotesOff' })
  }

  /** Stop every voice and release every audio resource this engine created. */
  dispose(): void {
    this.generation += 1
    this.clearLoadTimer()
    this.held.clear()
    this.sustain = false
    this.post?.({ type: 'allNotesOff' })
    this.teardownNode?.()
    this.teardownNode = null
    this.node = null
    this.post = null
    this.live = false
    this.backend = 'none'
    const context = this.context
    this.context = null
    if (context) {
      context.onstatechange = null
      context.close().catch(() => undefined)
    }
    this.setSnapshot(IDLE)
  }

  private async bringUp(): Promise<void> {
    const generation = this.generation
    let context: AudioContextLike | null = null
    try {
      context = this.audio.createContext()
    } catch (error) {
      this.fail(`Audio could not start: ${describe(error)}.`)
      return
    }
    if (!context) {
      this.fail('This browser has no Web Audio support, so the keybed is silent.')
      return
    }
    this.context = context
    this.setSnapshot({ status: 'loading', detail: 'Loading the piano voice…', backend: 'none', voices: 0 })
    context.onstatechange = () => this.refresh()
    this.resumeIfNeeded()

    let workletProblem = ''
    try {
      const node = await this.loadWorklet(context)
      if (generation !== this.generation) {
        node.disconnect()
        return
      }
      node.port.onmessage = (event) => this.onReport(event.data as EngineReport)
      node.connect(context.destination)
      this.node = node
      this.post = (message) => node.port.postMessage(message)
      this.teardownNode = () => {
        node.port.onmessage = null
        node.disconnect()
      }
      this.backend = 'worklet'
    } catch (error) {
      if (generation !== this.generation) return
      workletProblem = describe(error)
    }

    if (this.backend === 'none') {
      try {
        this.startScriptProcessor(context)
        this.backendNote = workletProblem
      } catch (error) {
        this.fail(
          `No audio host could start (worklet: ${workletProblem}; fallback: ${describe(error)}). The keybed is silent.`,
        )
        return
      }
    }
    this.refresh()
  }

  private loadWorklet(context: AudioContextLike) {
    const { audio, timing } = this
    return new Promise<ReturnType<AudioBoundary['createWorkletNode']>>((resolve, reject) => {
      const url = audio.workletUrl
      if (!context.audioWorklet || !url) {
        reject(new Error('AudioWorklet is not available'))
        return
      }
      let settled = false
      const settle = (action: () => void) => {
        if (settled) return
        settled = true
        this.clearLoadTimer()
        action()
      }
      this.loadTimer = timing.setTimeout(
        () => settle(() => reject(new Error(`the worklet module did not load within ${this.loadTimeoutMs} ms`))),
        this.loadTimeoutMs,
      )
      context.audioWorklet.addModule(url).then(
        () =>
          settle(() => {
            try {
              resolve(audio.createWorkletNode(context, PROCESSOR_NAME))
            } catch (error) {
              reject(error)
            }
          }),
        (error: unknown) => settle(() => reject(error)),
      )
    })
  }

  private startScriptProcessor(context: AudioContextLike): void {
    if (!context.createScriptProcessor) throw new Error('ScriptProcessorNode is not available')
    const node = context.createScriptProcessor(this.scriptBufferSize, 0, 2)
    const host = new KernelHost({ sampleRate: context.sampleRate }, (report) => this.onReport(report))
    let spare = new Float32Array(this.scriptBufferSize)
    node.onaudioprocess = (event) => {
      const buffer = event.outputBuffer
      const left = buffer.getChannelData(0)
      if (buffer.numberOfChannels > 1) {
        host.process(left, buffer.getChannelData(1))
      } else {
        if (spare.length !== left.length) spare = new Float32Array(left.length)
        host.process(left, spare)
      }
    }
    node.connect(context.destination)
    this.node = node
    this.post = (message) => host.handle(message)
    this.teardownNode = () => {
      node.onaudioprocess = null
      node.disconnect()
    }
    this.backend = 'script-processor'
  }

  /** Recompute status from the backend and the context state, and go live or quiet to match. */
  private refresh(): void {
    const context = this.context
    if (!context || this.backend === 'none') return
    const running = context.state === 'running'
    if (running && !this.live) {
      this.live = true
      // Clear anything left from before, then strike only what is held right now.
      this.post?.({ type: 'allNotesOff' })
      this.post?.({ type: 'sustain', down: this.sustain })
      for (const [note, velocity] of this.held) this.post?.({ type: 'noteOn', note, velocity })
    } else if (!running && this.live) {
      this.live = false
      this.post?.({ type: 'allNotesOff' })
    }

    const voices = running ? this.snapshot.voices : 0
    if (!running) {
      this.setSnapshot({
        status: 'loading',
        detail: 'The piano voice is loaded, but the browser is holding audio until you click, tap, or press a key.',
        backend: this.backend,
        voices,
      })
    } else if (this.backend === 'worklet') {
      this.setSnapshot({
        status: 'ready',
        detail: 'Synthesized piano voice running in an AudioWorklet.',
        backend: 'worklet',
        voices,
      })
    } else {
      this.setSnapshot({
        status: 'fallback',
        detail: `Fallback: the same synthesized piano voice is running on the main thread (${this.backendNote || 'AudioWorklet unavailable'}). Timing is coarser.`,
        backend: 'script-processor',
        voices,
      })
    }
  }

  private resumeIfNeeded(): void {
    const context = this.context
    if (context && context.state !== 'running' && context.state !== 'closed') {
      context.resume().then(
        () => this.refresh(),
        () => undefined,
      )
    }
  }

  private onReport(report: EngineReport): void {
    if (report?.type !== 'voices' || report.count === this.snapshot.voices) return
    this.setSnapshot({ ...this.snapshot, voices: report.count })
  }

  private fail(detail: string): void {
    const context = this.context
    this.context = null
    if (context) {
      context.onstatechange = null
      context.close().catch(() => undefined)
    }
    this.live = false
    this.setSnapshot({ status: 'error', detail, backend: 'none', voices: 0 })
  }

  private clearLoadTimer(): void {
    if (this.loadTimer !== null) {
      this.timing.clearTimeout(this.loadTimer)
      this.loadTimer = null
    }
  }

  private setSnapshot(next: EngineSnapshot): void {
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}

function describe(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return typeof error === 'string' && error ? error : 'unknown error'
}
