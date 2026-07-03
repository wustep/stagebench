/**
 * Real rendered-audio harness for deterministic tests.
 *
 * Uses node-web-audio-api's OfflineAudioContext — a REAL Web Audio
 * implementation rendering in Node without devices, network or audio output —
 * so tests genuinely cross the audio boundary: the engine's full graph
 * (samples → layer buses → effects → master/limiter → destination) produces a
 * rendered buffer that is then measured.
 *
 * Samples are read from public/samples (the bundled recorded sets) via the
 * filesystem and decoded once per process; decoded buffers are truncated to a
 * few seconds to bound test memory (measurements stay inside that window).
 */
import { OfflineAudioContext } from 'node-web-audio-api'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AssetBoundary, AudioBufferLike, AudioBoundary, AudioContextLike } from '../audio/boundaries'
import { PianoEngine } from '../audio/engine'
import { InstrumentController } from '../input/controller'
import { InstrumentStore } from '../state/instrument'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SAMPLE_RATE = 44100
const KEEP_SECONDS = 3.5

// Decoded (and length-bounded) sample cache shared across tests in a file.
const decodeCache = new Map<string, AudioBufferLike>()
let decodeContext: OfflineAudioContext | null = null

async function decodeSample(path: string): Promise<AudioBufferLike> {
  const cached = decodeCache.get(path)
  if (cached) return cached
  decodeContext ??= new OfflineAudioContext(2, 8, SAMPLE_RATE)
  const bytes = readFileSync(join(ROOT, 'public', path))
  const decoded = await decodeContext.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  let kept: AudioBufferLike = decoded as unknown as AudioBufferLike
  if (decoded.duration > KEEP_SECONDS) {
    const length = Math.floor(KEEP_SECONDS * decoded.sampleRate)
    const fade = Math.floor(0.25 * decoded.sampleRate)
    const smaller = decodeContext.createBuffer(decoded.numberOfChannels, length, decoded.sampleRate)
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const source = decoded.getChannelData(channel)
      const target = smaller.getChannelData(channel)
      for (let i = 0; i < length; i++) {
        target[i] = source[i]! * (i > length - fade ? (length - i) / fade : 1)
      }
    }
    kept = smaller as unknown as AudioBufferLike
  }
  decodeCache.set(path, kept)
  return kept
}

export function offlineAssets(options: { fail?: boolean | ((path: string) => boolean) } = {}): AssetBoundary {
  return {
    load(path: string) {
      const shouldFail = typeof options.fail === 'function' ? options.fail(path) : options.fail === true
      if (shouldFail) throw new Error(`asset unavailable: ${path}`)
      return decodeSample(path)
    },
  }
}

export interface RenderStep {
  time: number
  run: (parts: { engine: PianoEngine; controller: InstrumentController; store: InstrumentStore }) => void
}

export interface RenderResult {
  left: Float32Array
  right: Float32Array
  sampleRate: number
  engineStatus: string
}

export interface RenderOptions {
  duration: number
  /** Configure canonical state BEFORE the engine starts (selects what loads). */
  configure?: (store: InstrumentStore) => void
  steps: RenderStep[]
  assets?: AssetBoundary
}

/**
 * Renders the full engine graph offline and returns the measured channels.
 *
 * node-web-audio-api's OfflineAudioContext.suspend can spuriously throw
 * InvalidStateError when many render contexts compete for CPU (parallel test
 * workers under machine load). The render itself is deterministic, so that
 * one scheduling error is retried with a fresh context; any other error and
 * every measurement still propagate normally.
 */
export async function renderEngine(options: RenderOptions): Promise<RenderResult> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await renderEngineOnce(options)
    } catch (error) {
      if ((error as { name?: string } | null)?.name !== 'InvalidStateError') throw error
      lastError = error
    }
  }
  throw lastError
}

async function renderEngineOnce(options: RenderOptions): Promise<RenderResult> {
  const context = new OfflineAudioContext(2, Math.ceil(options.duration * SAMPLE_RATE), SAMPLE_RATE)
  // node-web-audio-api's OfflineAudioContext has no close(): shim a no-op so
  // engine.dispose() (which always calls context.close()) can run below —
  // undisposed engines/contexts otherwise pile up native nodes/threads across
  // a long sequential test run, which is the source of a rare, load-order-
  // dependent render corruption seen only in the full suite (never in
  // isolation): leaving that pile-up unbounded, not the measurement code, was
  // the actual bug.
  const contextWithClose = context as unknown as AudioContextLike & { close?: () => Promise<void> }
  contextWithClose.close ??= () => Promise.resolve()
  const boundary: AudioBoundary = {
    createContext: () => contextWithClose,
    timers: {
      setTimeout: () => 0, // voice GC is irrelevant to offline rendering
      clearTimeout: () => undefined,
      now: () => 0,
    },
  }
  const store = new InstrumentStore()
  options.configure?.(store)
  const engine = new PianoEngine(boundary, { assets: options.assets ?? offlineAssets() })
  engine.attachStore(store)
  const controller = new InstrumentController(engine)
  engine.ensureStarted()
  await engine.whenReady()

  const suspensions: Array<Promise<void>> = []
  let stepsRun = 0
  for (const step of options.steps) {
    if (step.time <= 0) {
      step.run({ engine, controller, store })
      stepsRun++
      continue
    }
    suspensions.push(
      context.suspend(step.time).then(() => {
        step.run({ engine, controller, store })
        stepsRun++
        void context.resume()
      }),
    )
  }
  // Aggregate the render with the suspension callbacks so a failed suspend
  // rejects here (retryable) instead of surfacing as an unhandled rejection.
  const [rendered] = await Promise.all([context.startRendering(), ...suspensions])
  if (stepsRun < options.steps.length) {
    // A suspension was silently skipped (load-dependent library quirk): the
    // render is incomplete — retry it rather than measuring garbage.
    const error = new Error(`render ran ${stepsRun}/${options.steps.length} scheduled steps`)
    error.name = 'InvalidStateError'
    throw error
  }
  const engineStatus = engine.getStatus().status
  // Copy out of the rendered buffer before disposing: dispose() releases the
  // engine's own nodes (not the already-rendered buffer), but copying keeps
  // the returned arrays independent of anything the native context does
  // during teardown.
  const left = rendered.getChannelData(0).slice()
  const right = rendered.getChannelData(1).slice()
  engine.dispose()
  return { left, right, sampleRate: SAMPLE_RATE, engineStatus }
}

/* ------------------------------------------------------------ measures -- */

export function rms(data: Float32Array, fromSeconds: number, toSeconds: number, sampleRate = SAMPLE_RATE): number {
  const from = Math.max(0, Math.floor(fromSeconds * sampleRate))
  const to = Math.min(data.length, Math.floor(toSeconds * sampleRate))
  if (to <= from) return 0
  let sum = 0
  for (let i = from; i < to; i++) sum += data[i]! * data[i]!
  return Math.sqrt(sum / (to - from))
}

export function peak(data: Float32Array, fromSeconds = 0, toSeconds = Number.POSITIVE_INFINITY, sampleRate = SAMPLE_RATE): number {
  const from = Math.max(0, Math.floor(fromSeconds * sampleRate))
  const to = Math.min(data.length, Math.floor(toSeconds * sampleRate))
  let max = 0
  for (let i = from; i < to; i++) max = Math.max(max, Math.abs(data[i]!))
  return max
}

/** Goertzel band energy around a frequency (normalized magnitude). */
export function bandEnergy(
  data: Float32Array,
  frequencyHz: number,
  fromSeconds: number,
  toSeconds: number,
  sampleRate = SAMPLE_RATE,
): number {
  const from = Math.max(0, Math.floor(fromSeconds * sampleRate))
  const to = Math.min(data.length, Math.floor(toSeconds * sampleRate))
  const n = to - from
  if (n <= 0) return 0
  const k = Math.round((frequencyHz / sampleRate) * n)
  const w = (2 * Math.PI * k) / n
  const coeff = 2 * Math.cos(w)
  let s0 = 0
  let s1 = 0
  let s2 = 0
  for (let i = from; i < to; i++) {
    // Hann window keeps strong low partials from leaking into distant bins.
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i - from)) / n)
    s0 = data[i]! * window + coeff * s1 - s2
    s2 = s1
    s1 = s0
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2
  return Math.sqrt(Math.max(0, power)) / n
}

/** Rough spectral brightness: zero crossings per second in a window. */
export function zeroCrossingRate(data: Float32Array, fromSeconds: number, toSeconds: number, sampleRate = SAMPLE_RATE): number {
  const from = Math.max(0, Math.floor(fromSeconds * sampleRate))
  const to = Math.min(data.length, Math.floor(toSeconds * sampleRate))
  let crossings = 0
  for (let i = from + 1; i < to; i++) {
    if (data[i]! >= 0 !== data[i - 1]! >= 0) crossings++
  }
  return crossings / Math.max(1e-9, (to - from) / sampleRate)
}

/** Normalized cross-correlation at zero lag between two renders. */
export function similarity(a: Float32Array, b: Float32Array, fromSeconds: number, toSeconds: number, sampleRate = SAMPLE_RATE): number {
  const from = Math.max(0, Math.floor(fromSeconds * sampleRate))
  const to = Math.min(a.length, b.length, Math.floor(toSeconds * sampleRate))
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = from; i < to; i++) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }
  if (normA === 0 || normB === 0) return 0
  return dot / Math.sqrt(normA * normB)
}

/**
 * Broadband brightness: RMS of a JS-implemented 2nd-order highpass at
 * `cutoffHz` over the window, relative to the unfiltered RMS. Robust against
 * stretch tuning / inharmonicity, unlike narrow single bins.
 */
export function highBandRatio(
  data: Float32Array,
  cutoffHz: number,
  fromSeconds: number,
  toSeconds: number,
  sampleRate = SAMPLE_RATE,
): number {
  const from = Math.max(0, Math.floor(fromSeconds * sampleRate))
  const to = Math.min(data.length, Math.floor(toSeconds * sampleRate))
  if (to <= from) return 0
  // RBJ biquad highpass, Q = 0.707.
  const w0 = (2 * Math.PI * cutoffHz) / sampleRate
  const alpha = Math.sin(w0) / (2 * 0.7071)
  const cosw = Math.cos(w0)
  const b0 = (1 + cosw) / 2
  const b1 = -(1 + cosw)
  const b2 = (1 + cosw) / 2
  const a0 = 1 + alpha
  const a1 = -2 * cosw
  const a2 = 1 - alpha
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  let high = 0
  let total = 0
  for (let i = from; i < to; i++) {
    const x = data[i]!
    const y = (b0 / a0) * x + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2
    x2 = x1
    x1 = x
    y2 = y1
    y1 = y
    high += y * y
    total += x * x
  }
  return Math.sqrt(high / Math.max(1e-18, total))
}
