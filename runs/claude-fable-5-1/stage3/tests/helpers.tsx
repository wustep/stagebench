import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fireEvent, render, type RenderResult } from '@testing-library/react'
import { act } from 'react'
import { OggVorbisDecoder } from '@wasm-audio-decoders/ogg-vorbis'
import App from '../src/App'
import type { AssetBoundary, Boundaries, MidiAccessLike, MidiInputLike, ProcessorFactory, StorageLike } from '../src/audio/boundaries'
import type { PianoEngineOptions } from '../src/audio/engine'
import { HOLD_MS } from '../src/audio/instrumentController'
import { FakeAudioContext, FakeProcessorNode, FakeTimers, fakeProcessorFactory } from '../src/audio/fakeAudio'
import { midiToFrequency, velocityGain, type PianoRenderParams } from '../src/audio/pianoRenderer'
import type { SampleFile, SampleManifest } from '../src/audio/sampleLibrary'
import { memoryStorage } from '../src/state/bankStorage'
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
  /** Program bank persistence (Live slots): an in-memory StorageLike, shared between mounts to test reloads. */
  storage?: StorageLike | null
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
    storage: options.storage ?? null,
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
export async function waitUntil(predicate: () => boolean, timeoutMs = 60000): Promise<void> {
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

/* ---------- Phase 3 gesture helpers ---------- */

export { memoryStorage }

export interface Processors {
  A: FakeProcessorNode
  B: FakeProcessorNode
  organ: FakeProcessorNode
  organChain: FakeProcessorNode
  synth: Record<'A' | 'B' | 'C', FakeProcessorNode>
  synthChains: Record<'A' | 'B' | 'C', FakeProcessorNode>
  rotary: FakeProcessorNode
  master: FakeProcessorNode
}

/** Starts audio (creating the one context) and lets the async DSP host wiring settle. */
export async function startAudio(m: Mounted): Promise<Processors> {
  await act(async () => {
    fireEvent.click(el('start-audio'))
  })
  for (let i = 0; i < 4; i++) await flush()
  await act(async () => {
    m.world.timers.flush()
  })
  const layers = m.world.ctx.processors('layer')
  const synths = m.world.ctx.processors('synth')
  return {
    A: layers[0],
    B: layers[1],
    organ: m.world.ctx.processors('organ')[0],
    organChain: layers[2],
    synth: { A: synths[0], B: synths[1], C: synths[2] },
    synthChains: { A: layers[3], B: layers[4], C: layers[5] },
    rotary: m.world.ctx.processors('rotary')[0],
    master: m.world.ctx.processors('master')[0],
  }
}

/** A full pointer click on a panel button (press, release, click). */
export function click(id: string) {
  const node = el(id)
  fireEvent.pointerDown(node, { pointerId: 7, button: 0 })
  fireEvent.pointerUp(node, { pointerId: 7 })
  fireEvent.click(node)
}

/** Press and hold a button (the hold gesture opens its page), then release; the controller suppresses the click's toggle. */
export function hold(m: Mounted, id: string, ms = HOLD_MS + 10) {
  const node = el(id)
  fireEvent.pointerDown(node, { pointerId: 8, button: 0 })
  m.world.timers.advance(ms)
  fireEvent.pointerUp(node, { pointerId: 8 })
  fireEvent.click(node)
}

/** Arms the Shift latch (either Shift button). */
export function armShift(which: 'program.shift' | 'effects.shift' = 'program.shift') {
  fireEvent.pointerDown(el(which), { pointerId: 9, button: 0 })
  fireEvent.pointerUp(el(which), { pointerId: 9 })
}

/** Turns an endless dial by `steps` detents with the keyboard (ArrowUp / ArrowDown = one 15° detent). */
export function turnDial(id: string, steps: number) {
  const node = el(id)
  for (let i = 0; i < Math.abs(steps); i++) fireEvent.keyDown(node, { key: steps > 0 ? 'ArrowUp' : 'ArrowDown' })
}

/** Nudges a slider-like control by `steps` (ArrowUp / ArrowDown). */
export function nudge(id: string, steps: number) {
  turnDial(id, steps)
}

/** Sets a slider-like control (knob / fader / drawbar / wheel) to an exact value through its keyboard interface. */
export function setSlider(id: string, value: number) {
  const node = el(id)
  const min = Number(node.getAttribute('aria-valuemin'))
  const max = Number(node.getAttribute('aria-valuemax'))
  const kind = node.dataset.controlKind
  const stepSize = kind === 'fader' || kind === 'drawbar' ? 1 : kind === 'wheel' ? 0.01 : kind === 'stick' ? 0.05 : 0.1
  const target = Math.min(max, Math.max(min, value))
  const fromMin = target - min <= max - target
  fireEvent.keyDown(node, { key: fromMin ? 'Home' : 'End' })
  const from = fromMin ? min : max
  const count = Math.round(Math.abs(target - from) / stepSize)
  for (let i = 0; i < count; i++) fireEvent.keyDown(node, { key: target > from ? 'ArrowUp' : 'ArrowDown' })
}

/** Plays / releases a key through the note bus (the real route: NoteBus → Performer → engines). */
export function play(m: Mounted, midi: number, velocity = 100) {
  act(() => {
    m.services.bus.noteOn(midi, velocity, 'test')
  })
}
export function release(m: Mounted, midi: number) {
  act(() => {
    m.services.bus.noteOff(midi, 'test')
  })
}

/** Last event of a type posted to a fake source processor. */
export function lastEvent(node: FakeProcessorNode, type: string): Record<string, unknown> | undefined {
  return [...(node.events as Record<string, unknown>[])].reverse().find((e) => e.type === type)
}
