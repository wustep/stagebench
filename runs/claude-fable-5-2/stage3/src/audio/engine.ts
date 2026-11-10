import type { NoteSink } from '../input/noteLifecycle'
import type {
  AudioBoundary,
  AudioContextLike,
  AudioNodeLike,
  TimingBoundary,
} from '../platform/types'
import { SAMPLE_SET_LABEL } from '../piano/catalog'
import { KernelHost, PROCESSOR_NAME, type EngineMessage, type EngineReport } from './dsp/host'
import { CHAIN_COUNT, defaultSoundState, type SampleSetId, type SoundState } from './dsp/params'
import { SAMPLE_SET_IDS, SampleLibrary, type LibraryStatus } from './library/loader'

/**
 * idle     — nothing started yet (browsers require a user gesture first)
 * loading  — the audio host or a sample set a sounding layer needs is not there yet
 * ready    — AudioWorklet host is running and every sounding layer has its real source
 * fallback — something is standing in: the kernel is on the main thread because the worklet
 *            is unavailable, and/or a recorded sample set failed to load and its layer plays
 *            the labelled synthesized stand-in. `detail` says which.
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
  /** Load state of each bundled sample set. */
  library: Readonly<Record<SampleSetId, LibraryStatus>>
  /** Why a set failed, when one has. */
  libraryErrors: Readonly<Partial<Record<SampleSetId, string>>>
  /** Per effect chain: the compressor is currently reducing gain (drives the ACTIVE LED). */
  compressor: readonly boolean[]
}

export interface EngineOptions {
  /** How long to wait for the worklet module before falling back. */
  loadTimeoutMs?: number
  scriptBufferSize?: number
}

const NO_COMPRESSION: readonly boolean[] = Array.from({ length: CHAIN_COUNT }, () => false)

const IDLE: EngineSnapshot = {
  status: 'idle',
  detail: 'Audio starts on your first key press, click, or touch.',
  backend: 'none',
  voices: 0,
  library: { grand: 'idle', upright: 'idle', electric: 'idle' },
  libraryErrors: {},
  compressor: NO_COMPRESSION,
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
  private sound: SoundState = defaultSoundState()
  private readonly library: SampleLibrary
  /** Sets already handed to the current host. */
  private delivered = new Set<SampleSetId>()
  private compressor: readonly boolean[] = NO_COMPRESSION

  constructor(audio: AudioBoundary, timing: TimingBoundary, options: EngineOptions = {}) {
    this.audio = audio
    this.timing = timing
    this.library = new SampleLibrary(audio.loadAsset ? (path) => audio.loadAsset!(path) : null, timing)
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

  /**
   * Replace the sound state (piano layers, effects, master level). Safe before `start`: the
   * latest state is sent when the host comes up. Any sample set a sounding layer now needs is
   * fetched on demand; until it arrives that layer plays the labelled fallback voice.
   */
  setSound(sound: SoundState): void {
    this.sound = sound
    this.post?.({ type: 'state', state: sound })
    // Before the host is up, `bringUp` loads whatever the state needs when it gets there.
    if (!this.context || this.backend === 'none') return
    if (this.neededSets().some((id) => this.library.status(id) === 'idle')) {
      const generation = this.generation
      void this.loadNeeded().then(() => {
        if (generation === this.generation) this.refresh()
      })
    }
    this.refresh()
  }

  getSound(): SoundState {
    return this.sound
  }

  /**
   * Start fetching and decoding the sample sets the current layers need, without creating
   * an AudioContext (decoding is done by the app itself). Changes no status.
   */
  preload(): void {
    void this.loadNeeded()
  }

  /** Sample sets that a currently sounding layer plays. */
  neededSets(): SampleSetId[] {
    const needed: SampleSetId[] = []
    for (const layer of this.sound.layers) {
      if (layer.on && layer.source.kind === 'samples' && !needed.includes(layer.source.set)) needed.push(layer.source.set)
    }
    return needed
  }

  private loadNeeded(): Promise<void> {
    return Promise.all(
      this.neededSets().map((id) =>
        this.library.load(id).then(() => {
          this.deliver()
        }),
      ),
    ).then(() => undefined)
  }

  /** Hand every finished set to the host exactly once. */
  private deliver(): void {
    if (!this.post) return
    for (const id of SAMPLE_SET_IDS) {
      if (this.delivered.has(id)) continue
      const status = this.library.status(id)
      if (status !== 'ready' && status !== 'failed') continue
      this.delivered.add(id)
      this.post({ type: 'sampleSet', id, set: this.library.get(id) })
    }
  }

  /** Stop every voice and release every audio resource this engine created. */
  dispose(): void {
    this.generation += 1
    this.clearLoadTimer()
    this.library.dispose()
    this.held.clear()
    this.sustain = false
    this.post?.({ type: 'allNotesOff' })
    this.teardownNode?.()
    this.teardownNode = null
    this.node = null
    this.post = null
    this.live = false
    this.backend = 'none'
    this.delivered = new Set()
    this.compressor = NO_COMPRESSION
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
    this.setSnapshot({ ...this.base(), status: 'loading', detail: 'Loading the piano engine and samples…', backend: 'none', voices: 0 })
    context.onstatechange = () => this.refresh()
    this.resumeIfNeeded()
    // Samples load alongside the audio host; both must settle before the first note sounds.
    const samples = this.loadNeeded()

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
    this.post?.({ type: 'state', state: this.sound })
    await samples
    // The state may have moved on while the host was starting.
    await this.loadNeeded()
    if (generation !== this.generation) return
    this.deliver()
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
    const base = { ...this.base(), backend: this.backend, voices }
    const needed = this.neededSets()
    const failed = needed.filter((id) => this.library.status(id) === 'failed')
    const loading = needed.filter((id) => this.library.status(id) !== 'ready' && this.library.status(id) !== 'failed')
    const onMainThread =
      this.backend === 'script-processor'
        ? `the engine is running on the main thread (${this.backendNote || 'AudioWorklet unavailable'}), so timing is coarser`
        : ''
    if (!running) {
      this.setSnapshot({
        ...base,
        status: 'loading',
        detail: 'The piano engine is loaded, but the browser is holding audio until you click, tap, or press a key.',
      })
    } else if (failed.length > 0) {
      // Never "ready": a layer that should play recordings is playing the synthesized stand-in.
      const names = failed.map((id) => SAMPLE_SET_LABEL[id]).join(' and ')
      const why = this.library.error(failed[0]) ?? 'unknown error'
      this.setSnapshot({
        ...base,
        status: 'fallback',
        detail:
          `Fallback: the ${names} samples could not be loaded (${why}). ` +
          `That piano is replaced by a synthesized stand-in voice, which is not a recording` +
          (onMainThread ? `; also, ${onMainThread}.` : '.'),
      })
    } else if (loading.length > 0) {
      this.setSnapshot({
        ...base,
        status: 'loading',
        detail: `Loading the ${loading.map((id) => SAMPLE_SET_LABEL[id]).join(' and ')} samples…`,
      })
    } else if (this.backend === 'worklet') {
      this.setSnapshot({
        ...base,
        status: 'ready',
        detail: 'Running in an AudioWorklet.',
      })
    } else {
      this.setSnapshot({
        ...base,
        status: 'fallback',
        detail: `Fallback: ${onMainThread}. The sound engine itself is the same.`,
      })
    }
  }

  /** The parts of the snapshot that describe the sample library and meters. */
  private base(): Pick<EngineSnapshot, 'library' | 'libraryErrors' | 'compressor'> {
    const library = { grand: this.library.status('grand'), upright: this.library.status('upright'), electric: this.library.status('electric') }
    const libraryErrors: Partial<Record<SampleSetId, string>> = {}
    for (const id of SAMPLE_SET_IDS) {
      const error = this.library.error(id)
      if (error) libraryErrors[id] = error
    }
    return { library, libraryErrors, compressor: this.compressor }
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
    if (report?.type === 'voices') {
      if (report.count !== this.snapshot.voices) this.setSnapshot({ ...this.snapshot, voices: report.count })
    } else if (report?.type === 'compressor') {
      this.compressor = report.active.slice()
      this.setSnapshot({ ...this.snapshot, compressor: this.compressor })
    }
  }

  private fail(detail: string): void {
    const context = this.context
    this.context = null
    if (context) {
      context.onstatechange = null
      context.close().catch(() => undefined)
    }
    this.live = false
    this.setSnapshot({ ...this.base(), status: 'error', detail, backend: 'none', voices: 0 })
  }

  private clearLoadTimer(): void {
    if (this.loadTimer !== null) {
      this.timing.clearTimeout(this.loadTimer)
      this.loadTimer = null
    }
  }

  private setSnapshot(next: EngineSnapshot): void {
    if (sameSnapshot(this.snapshot, next)) return
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}

function sameSnapshot(a: EngineSnapshot, b: EngineSnapshot): boolean {
  return (
    a.status === b.status &&
    a.detail === b.detail &&
    a.backend === b.backend &&
    a.voices === b.voices &&
    SAMPLE_SET_IDS.every((id) => a.library[id] === b.library[id] && a.libraryErrors[id] === b.libraryErrors[id]) &&
    a.compressor.length === b.compressor.length &&
    a.compressor.every((active, index) => active === b.compressor[index])
  )
}

function describe(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return typeof error === 'string' && error ? error : 'unknown error'
}
