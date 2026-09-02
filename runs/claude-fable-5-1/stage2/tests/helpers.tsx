import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { render, type RenderResult } from '@testing-library/react'
import { act } from 'react'
import { OggVorbisDecoder } from '@wasm-audio-decoders/ogg-vorbis'
import App from '../src/App'
import type { AssetBoundary, Boundaries, MidiAccessLike, MidiInputLike, ProcessorFactory } from '../src/audio/boundaries'
import type { PianoEngineOptions } from '../src/audio/engine'
import { FakeAudioContext, FakeTimers, fakeProcessorFactory } from '../src/audio/fakeAudio'
import { midiToFrequency, velocityGain, type PianoRenderParams } from '../src/audio/pianoRenderer'
import type { SampleFile, SampleManifest } from '../src/audio/sampleLibrary'
import type { ServiceOptions, Services } from '../src/ui/createServices'

/**
 * Cheap deterministic renderer for lifecycle tests: a 2 s decaying sine at the requested sample rate,
 * loudness following the same velocity curve (the real DSP is covered by the audio-signal tests).
 */
export function quickRenderer(params: PianoRenderParams): Float32Array {
  const seconds = Math.min(params.maxSeconds ?? 2, 2)
  const length = Math.round(seconds * params.sampleRate)
  const out = new Float32Array(length)
  const w = (2 * Math.PI * midiToFrequency(params.midi)) / params.sampleRate
  const level = 0.5 * velocityGain(params.velocity)
  for (let i = 0; i < length; i++) out[i] = level * Math.sin(w * i) * Math.exp(-i / (params.sampleRate * 0.8))
  return out
}

export class FakeMidiInput implements MidiInputLike {
  onmidimessage: ((event: { data: Uint8Array | null }) => void) | null = null
  state: 'connected' | 'disconnected' = 'connected'
  type = 'input' as const
  constructor(public id: string, public name: string) {}
  send(bytes: number[]) {
    this.onmidimessage?.({ data: new Uint8Array(bytes) })
  }
}

export class FakeMidiAccess implements MidiAccessLike {
  inputs = new Map<string, MidiInputLike>()
  onstatechange: ((event: { port: MidiInputLike | null }) => void) | null = null
  addInput(input: FakeMidiInput) {
    this.inputs.set(input.id, input)
    this.onstatechange?.({ port: input })
  }
  disconnect(input: FakeMidiInput) {
    input.state = 'disconnected'
    this.onstatechange?.({ port: input })
  }
}

/** The bundled library on disk (what `pnpm build` copies into dist/samples). */
export const SAMPLES_DIR = path.resolve(__dirname, '../public/samples')

let decoderPromise: Promise<OggVorbisDecoder> | null = null
async function nodeDecoder(): Promise<OggVorbisDecoder> {
  if (!decoderPromise) {
    decoderPromise = (async () => {
      const d = new OggVorbisDecoder()
      await d.ready
      return d
    })()
  }
  return decoderPromise
}
// The wasm decoder holds one stream state: decodes must never interleave.
let decodeQueue: Promise<unknown> = Promise.resolve()
function decodeSerially(bytes: Uint8Array) {
  const run = decodeQueue.then(async () => {
    const d = await nodeDecoder()
    const out = await d.decodeFile(bytes)
    await d.reset()
    return { channelData: out.channelData, sampleRate: out.sampleRate }
  })
  decodeQueue = run.catch(() => undefined)
  return run
}

/** Real bundled files read from disk and decoded with the same Vorbis decoder the browser build uses. */
export function diskAssets(options: { failFile?: RegExp; failManifest?: boolean; log?: string[] } = {}): AssetBoundary {
  return {
    async fetchBytes(p) {
      options.log?.push(p)
      if (options.failManifest && p.endsWith('manifest.json')) throw new Error(`HTTP 404 for ${p}`)
      if (options.failFile && options.failFile.test(p)) throw new Error(`HTTP 404 for ${p}`)
      return new Uint8Array(await readFile(path.join(SAMPLES_DIR, p)))
    },
    decodeVorbis(bytes) {
      return decodeSerially(bytes)
    },
  }
}

/** Keeps tests fast: only the roots nearest a few test notes, all velocity layers. */
export const TEST_ROOTS = [48, 60, 64, 72]
export function nearRoots(roots: number[] = TEST_ROOTS, tolerance = 2) {
  return (file: SampleFile, _manifest: SampleManifest) => roots.some((r) => Math.abs(file.root - r) <= tolerance)
}

export interface WorldOptions {
  midi?: 'granted' | 'denied' | 'unsupported' | 'error' | 'no-inputs'
  audio?: 'ok' | 'unavailable'
  /** true = real bundled samples from disk; 'missing' = manifest 404; 'broken' = one file 404. */
  samples?: boolean | 'missing' | 'broken'
  /** Fake DSP processors (default true); 'fail' rejects the factory; false = no factory. */
  processors?: boolean | 'fail'
}

export interface FakeWorld {
  boundaries: Boundaries
  ctx: FakeAudioContext
  timers: FakeTimers
  access: FakeMidiAccess
  input: FakeMidiInput
  contexts: FakeAudioContext[]
  fetched: string[]
}

export function makeWorld(options: WorldOptions = {}): FakeWorld {
  const timers = new FakeTimers()
  const access = new FakeMidiAccess()
  const input = new FakeMidiInput('in-1', 'Fake Keys')
  if (options.midi !== 'no-inputs') access.inputs.set(input.id, input)
  const contexts: FakeAudioContext[] = []
  const ctx = new FakeAudioContext(48000)
  const midiMode = options.midi ?? 'granted'
  const fetched: string[] = []
  const processors: ProcessorFactory | null = options.processors === false ? null : fakeProcessorFactory({ fail: options.processors === 'fail' })
  const assets: AssetBoundary | null = options.samples
    ? diskAssets({ log: fetched, failManifest: options.samples === 'missing', failFile: options.samples === 'broken' ? /060-l1\.ogg$/ : undefined })
    : null
  const boundaries: Boundaries = {
    createAudioContext: () => {
      if (options.audio === 'unavailable') throw new Error('Web Audio is not available')
      const c = contexts.length === 0 ? ctx : new FakeAudioContext(48000)
      contexts.push(c)
      return c
    },
    createProcessor: processors,
    assets,
    timers,
    midi:
      midiMode === 'unsupported'
        ? {}
        : {
            requestAccess: () => {
              if (midiMode === 'denied') return Promise.reject(Object.assign(new Error('Permission denied'), { name: 'SecurityError' }))
              if (midiMode === 'error') return Promise.reject(new Error('MIDI subsystem failure'))
              return Promise.resolve(access)
            },
          },
    windowTarget: window,
  }
  return { boundaries, ctx, timers, access, input, contexts, fetched }
}

export const engineOptions: Partial<PianoEngineOptions> = { renderer: quickRenderer, warmNotes: [60, 64] }
export const sampleServiceOptions: ServiceOptions = { sampleFilter: nearRoots(), libraryConcurrency: 2 }

export interface Mounted extends RenderResult {
  services: Services
  world: FakeWorld
}

export async function mountApp(options: WorldOptions & { midiConnect?: boolean; engine?: Partial<PianoEngineOptions>; services?: ServiceOptions } = {}): Promise<Mounted> {
  const world = makeWorld(options)
  let services: Services | null = null
  const engineOpts = options.engine ?? engineOptions
  const serviceOpts = options.services ?? (options.samples ? sampleServiceOptions : undefined)
  const result = render(<App boundaries={world.boundaries} engineOptions={engineOpts} serviceOptions={serviceOpts} midi={options.midiConnect ?? true} onServices={(s) => (services = s)} />)
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  if (!services) throw new Error('services were not provided')
  return { ...result, services, world }
}

export async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

/** Waits (real time, bounded) until `predicate` holds, flushing React between checks. */
export async function waitUntil(predicate: () => boolean, timeoutMs = 15000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil timed out')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
  }
}

export function keyEl(midi: number): HTMLElement {
  const el = document.getElementById(`key-${midi}`)
  if (!el) throw new Error(`key-${midi} missing`)
  return el
}

export function el(id: string): HTMLElement {
  const node = document.getElementById(id)
  if (!node) throw new Error(`${id} is not rendered`)
  return node
}
