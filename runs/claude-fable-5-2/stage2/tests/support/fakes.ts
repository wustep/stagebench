import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { KernelHost, type EngineMessage, type EngineReport } from '../../src/audio/dsp/host'
import type {
  AudioContextLike,
  AudioProcessEventLike,
  KeyEventLike,
  MidiAccessLike,
  MidiInputLike,
  MidiMessageEventLike,
  Platform,
  ScriptNodeLike,
  WorkletNodeLike,
} from '../../src/platform/types'

/**
 * Test doubles for every platform boundary. The audio doubles are not mocks of the
 * synthesis: the fake worklet node hosts the real KernelHost, so tests pull real samples.
 */

export const TEST_SAMPLE_RATE = 48000

export interface Connection {
  from: unknown
  to: unknown
}

export class FakeWorkletNode implements WorkletNodeLike {
  readonly host: KernelHost
  readonly received: EngineMessage[] = []
  connected = false
  port: WorkletNodeLike['port']
  private readonly connections: Connection[]

  constructor(sampleRate: number, connections: Connection[]) {
    this.connections = connections
    const port: WorkletNodeLike['port'] = {
      onmessage: null,
      postMessage: (message: unknown) => {
        this.received.push(message as EngineMessage)
        this.host.handle(message as EngineMessage)
      },
    }
    this.port = port
    this.host = new KernelHost({ sampleRate }, (report: EngineReport) => port.onmessage?.({ data: report }))
  }

  connect(destination: unknown): unknown {
    this.connected = true
    this.connections.push({ from: this, to: destination })
    return destination
  }

  disconnect(): void {
    this.connected = false
  }

  /** Pull audio exactly as the audio thread would: 128-frame render quanta. */
  render(seconds: number): { left: Float32Array; right: Float32Array } {
    return renderHost(this.host, seconds)
  }
}

export function renderHost(host: KernelHost, seconds: number): { left: Float32Array; right: Float32Array } {
  const frames = Math.round((seconds * host.kernel.sampleRate) / 128) * 128
  const left = new Float32Array(frames)
  const right = new Float32Array(frames)
  for (let offset = 0; offset < frames; offset += 128) {
    host.process(left.subarray(offset, offset + 128), right.subarray(offset, offset + 128))
  }
  return { left, right }
}

export class FakeScriptNode implements ScriptNodeLike {
  onaudioprocess: ((event: AudioProcessEventLike) => void) | null = null
  connected = false
  private readonly connections: Connection[]
  private readonly bufferSize: number

  constructor(bufferSize: number, connections: Connection[]) {
    this.bufferSize = bufferSize
    this.connections = connections
  }

  connect(destination: unknown): unknown {
    this.connected = true
    this.connections.push({ from: this, to: destination })
    return destination
  }

  disconnect(): void {
    this.connected = false
  }

  /** Fire `onaudioprocess` as the browser would and collect what the handler wrote. */
  render(blocks: number): { left: Float32Array; right: Float32Array } {
    const left = new Float32Array(blocks * this.bufferSize)
    const right = new Float32Array(blocks * this.bufferSize)
    for (let block = 0; block < blocks; block += 1) {
      const channels = [new Float32Array(this.bufferSize), new Float32Array(this.bufferSize)]
      this.onaudioprocess?.({
        outputBuffer: { numberOfChannels: 2, getChannelData: (channel: number) => channels[channel] },
      })
      left.set(channels[0], block * this.bufferSize)
      right.set(channels[1], block * this.bufferSize)
    }
    return { left, right }
  }
}

export type WorkletBehaviour = 'ok' | 'reject' | 'never' | 'missing'

/**
 * The real bundled sample files, read from public/ on disk (no network). Each file is read
 * once per test file and handed out as the same ArrayBuffer, so it is decoded once.
 */
const assetCache = new Map<string, ArrayBuffer>()
export function readBundledAsset(path: string): ArrayBuffer {
  let buffer = assetCache.get(path)
  if (!buffer) {
    const bytes = readFileSync(join(process.cwd(), 'public', path))
    buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    assetCache.set(path, buffer)
  }
  return buffer
}

export class FakeAudioContext implements AudioContextLike {
  readonly sampleRate = TEST_SAMPLE_RATE
  readonly destination = { kind: 'destination' }
  state: string
  onstatechange: (() => void) | null = null
  closed = false
  resumeCalls = 0
  addModuleCalls: string[] = []
  audioWorklet?: { addModule(url: string): Promise<void> }
  createScriptProcessor?: (bufferSize: number, inputs: number, outputs: number) => ScriptNodeLike
  readonly scriptNodes: FakeScriptNode[] = []
  private readonly audio: FakeAudio

  constructor(audio: FakeAudio) {
    this.audio = audio
    this.state = audio.initialState
    if (audio.worklet !== 'missing') {
      this.audioWorklet = {
        addModule: (url: string) => {
          this.addModuleCalls.push(url)
          if (audio.worklet === 'reject') return Promise.reject(new Error('module failed to load'))
          if (audio.worklet === 'never') return new Promise<void>(() => undefined)
          return Promise.resolve()
        },
      }
    }
    if (audio.scriptProcessor) {
      this.createScriptProcessor = (bufferSize: number) => {
        const node = new FakeScriptNode(bufferSize, audio.connections)
        this.scriptNodes.push(node)
        return node
      }
    }
  }

  resume(): Promise<void> {
    this.resumeCalls += 1
    if (this.audio.resumeUnlocks) this.setState('running')
    return Promise.resolve()
  }

  close(): Promise<void> {
    this.closed = true
    this.state = 'closed'
    return Promise.resolve()
  }

  setState(state: string): void {
    this.state = state
    this.onstatechange?.()
  }
}

export class FakeAudio {
  /** Set to false to simulate a browser with no Web Audio. */
  supported = true
  worklet: WorkletBehaviour = 'ok'
  scriptProcessor = true
  initialState = 'running'
  resumeUnlocks = true
  workletUrl: string | null = 'fake://piano.worklet.js'
  /**
   * How sample files behave: 'ok' serves the real bundled files; 'missing' rejects like a 404;
   * 'corrupt' serves bytes that are not FLAC; 'truncated' serves a cut-off file; 'pending' never answers.
   * `failingAssets` narrows the failure to paths containing that text (e.g. 'samples/upright/').
   */
  assets: 'ok' | 'missing' | 'corrupt' | 'truncated' | 'pending' = 'ok'
  failingAssets = ''
  readonly assetRequests: string[] = []
  readonly contexts: FakeAudioContext[] = []
  readonly workletNodes: FakeWorkletNode[] = []
  readonly connections: Connection[] = []

  createContext = (): AudioContextLike | null => {
    if (!this.supported) return null
    const context = new FakeAudioContext(this)
    this.contexts.push(context)
    return context
  }

  createWorkletNode = (context: AudioContextLike): WorkletNodeLike => {
    const node = new FakeWorkletNode(context.sampleRate, this.connections)
    this.workletNodes.push(node)
    return node
  }

  loadAsset = (path: string): Promise<ArrayBuffer> => {
    this.assetRequests.push(path)
    const failing = this.assets !== 'ok' && path.includes(this.failingAssets)
    if (!failing) {
      try {
        return Promise.resolve(readBundledAsset(path))
      } catch (error) {
        return Promise.reject(error)
      }
    }
    if (this.assets === 'missing') return Promise.reject(new Error(`${path}: HTTP 404`))
    if (this.assets === 'pending') return new Promise<ArrayBuffer>(() => undefined)
    if (this.assets === 'corrupt') return Promise.resolve(new TextEncoder().encode('<!doctype html><title>404</title>'.repeat(4)).buffer as ArrayBuffer)
    return Promise.resolve(readBundledAsset(path).slice(0, 600))
  }

  get context(): FakeAudioContext {
    return this.contexts[this.contexts.length - 1]
  }

  get node(): FakeWorkletNode {
    return this.workletNodes[this.workletNodes.length - 1]
  }
}

type Handler<T> = (payload: T) => void

export class FakeEvents {
  private keyDown = new Set<Handler<KeyEventLike>>()
  private keyUp = new Set<Handler<KeyEventLike>>()
  private blur = new Set<Handler<void>>()
  private hidden = new Set<Handler<void>>()
  private resize = new Set<Handler<void>>()
  size = { width: 1440, height: 900 }

  private add<T>(set: Set<Handler<T>>, handler: Handler<T>) {
    set.add(handler)
    return () => {
      set.delete(handler)
    }
  }

  onKeyDown = (handler: Handler<KeyEventLike>) => this.add(this.keyDown, handler)
  onKeyUp = (handler: Handler<KeyEventLike>) => this.add(this.keyUp, handler)
  onBlur = (handler: () => void) => this.add(this.blur, handler)
  onHidden = (handler: () => void) => this.add(this.hidden, handler)
  onResize = (handler: () => void) => this.add(this.resize, handler)
  viewport = () => ({ ...this.size })

  /** Total listeners currently registered across every event type. */
  get listenerCount(): number {
    return this.keyDown.size + this.keyUp.size + this.blur.size + this.hidden.size + this.resize.size
  }

  key(type: 'down' | 'up', code: string, init: Partial<KeyEventLike> = {}): KeyEventLike & { defaultPrevented: boolean } {
    const event = {
      code,
      key: init.key ?? code,
      repeat: init.repeat ?? false,
      ctrlKey: init.ctrlKey ?? false,
      metaKey: init.metaKey ?? false,
      altKey: init.altKey ?? false,
      target: init.target ?? null,
      defaultPrevented: false,
      preventDefault() {
        event.defaultPrevented = true
      },
    }
    for (const handler of Array.from((type === 'down' ? this.keyDown : this.keyUp))) handler(event)
    return event
  }

  emitBlur(): void {
    for (const handler of Array.from(this.blur)) handler()
  }

  emitHidden(): void {
    for (const handler of Array.from(this.hidden)) handler()
  }

  emitResize(width: number, height: number): void {
    this.size = { width, height }
    for (const handler of Array.from(this.resize)) handler()
  }
}

export class FakeTiming {
  private time = 0
  private nextId = 1
  private timers = new Map<number, { at: number; callback: () => void }>()

  now = () => this.time
  setTimeout = (callback: () => void, ms: number): unknown => {
    const id = this.nextId
    this.nextId += 1
    this.timers.set(id, { at: this.time + ms, callback })
    return id
  }
  clearTimeout = (handle: unknown): void => {
    this.timers.delete(handle as number)
  }

  get pendingTimers(): number {
    return this.timers.size
  }

  advance(ms: number): void {
    this.time += ms
    for (const [id, timer] of Array.from(this.timers)) {
      if (timer.at <= this.time) {
        this.timers.delete(id)
        timer.callback()
      }
    }
  }
}

export class FakeStorage {
  readonly data = new Map<string, string>()
  getItem = (key: string) => this.data.get(key) ?? null
  setItem = (key: string, value: string) => {
    this.data.set(key, value)
  }
}

export class FakeMidiPort implements MidiInputLike {
  id: string
  name: string
  state = 'connected'
  onmidimessage: ((event: MidiMessageEventLike) => void) | null = null

  constructor(id: string, name = `Fake ${id}`) {
    this.id = id
    this.name = name
  }

  send(...bytes: number[]): void {
    this.onmidimessage?.({ data: Uint8Array.from(bytes) })
  }
}

export class FakeMidi {
  /** 'missing' removes Web MIDI entirely; 'denied' rejects like a refused permission prompt. */
  mode: 'ok' | 'denied' | 'error' | 'missing' = 'ok'
  readonly ports = new Map<string, FakeMidiPort>()
  access: MidiAccessLike | null = null
  requests = 0

  get requestAccess(): (() => Promise<MidiAccessLike>) | null {
    if (this.mode === 'missing') return null
    return () => {
      this.requests += 1
      if (this.mode === 'denied') {
        const error = new Error('Permission denied')
        error.name = 'NotAllowedError'
        return Promise.reject(error)
      }
      if (this.mode === 'error') return Promise.reject(new Error('MIDI subsystem unavailable'))
      this.access = {
        inputs: { forEach: (callback) => this.ports.forEach((port) => callback(port)) },
        onstatechange: null,
      }
      return Promise.resolve(this.access)
    }
  }

  plug(port: FakeMidiPort): void {
    port.state = 'connected'
    this.ports.set(port.id, port)
    this.access?.onstatechange?.({ port })
  }

  unplug(id: string): void {
    const port = this.ports.get(id)
    if (!port) return
    port.state = 'disconnected'
    this.ports.delete(id)
    this.access?.onstatechange?.({ port })
  }
}

export interface FakePlatform {
  platform: Platform
  audio: FakeAudio
  midi: FakeMidi
  events: FakeEvents
  timing: FakeTiming
  storage: FakeStorage
}

export function createFakePlatform(): FakePlatform {
  const audio = new FakeAudio()
  const midi = new FakeMidi()
  const events = new FakeEvents()
  const timing = new FakeTiming()
  const storage = new FakeStorage()
  const platform: Platform = {
    audio,
    midi: {
      get requestAccess() {
        return midi.requestAccess
      },
    },
    events,
    timing,
    storage,
  }
  return { platform, audio, midi, events, timing, storage }
}

/** Let pending promise callbacks run. */
export async function flush(times = 24): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve()
}
