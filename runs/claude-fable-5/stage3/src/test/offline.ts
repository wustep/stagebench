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
  engineMessage: string
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
 * node-web-audio-api's native render thread very occasionally emits NaN
 * samples from a graph with no NaN inputs (an infrastructure bug in the
 * Rust DSP, not a property of the graph — real browsers never do this).
 * A corrupted render is detected and re-rendered from scratch rather than
 * letting the infrastructure fault masquerade as an audio regression.
 */
export async function renderEngine(options: RenderOptions): Promise<RenderResult> {
  let result = await renderEngineOnce(options)
  for (let attempt = 0; attempt < 2 && (firstNaNIndex(result.rendered) >= 0 || result.suspendError !== null); attempt++) {
    const index = firstNaNIndex(result.rendered)
    const reason =
      result.suspendError === null
        ? `produced NaN samples from sample ${index} (t=${(index / SAMPLE_RATE).toFixed(4)}s, status=${result.rendered.engineStatus})`
        : `lost a suspend(): ${String(result.suspendError)}`
    console.warn(`offline render ${reason} — re-rendering (attempt ${attempt + 1})`)
    result = await renderEngineOnce(options)
  }
  if (result.suspendError !== null) {
    throw new Error(`offline render could not honor its scheduled suspend() steps after retries: ${String(result.suspendError)}`)
  }
  return result.rendered
}

interface RenderAttempt {
  rendered: RenderResult
  /** Non-null when a scheduled suspend() rejected (its step never ran). */
  suspendError: unknown | null
}

function firstNaNIndex(result: RenderResult): number {
  for (const channel of [result.left, result.right]) {
    for (let i = 0; i < channel.length; i++) if (Number.isNaN(channel[i])) return i
  }
  return -1
}

// Finished OfflineAudioContexts are retained for the process lifetime:
// letting the native contexts be garbage-collected while later renders run
// can corrupt node-web-audio-api's shared render state (NaN output).
const retainedContexts: OfflineAudioContext[] = []

async function renderEngineOnce(options: RenderOptions): Promise<RenderAttempt> {
  const context = new OfflineAudioContext(2, Math.ceil(options.duration * SAMPLE_RATE), SAMPLE_RATE)
  retainedContexts.push(context)
  const boundary: AudioBoundary = {
    createContext: () => context as unknown as AudioContextLike,
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

  // Every suspend()/resume() promise gets its rejection handler attached
  // SYNCHRONOUSLY at creation. node-web-audio-api's suspend can lose a race
  // with render completion and reject; if the handler were only attached
  // after startRendering() resolves (e.g. a trailing Promise.all), the
  // interim unhandled rejection fails the vitest run even when every test
  // passes. A lost suspend means the step never ran, so the attempt is
  // recorded as corrupted and renderEngine re-renders it from scratch.
  let suspendError: unknown | null = null
  const suspensions: Array<Promise<void>> = []
  for (const step of options.steps) {
    if (step.time <= 0) {
      step.run({ engine, controller, store })
      continue
    }
    suspensions.push(
      context.suspend(step.time).then(
        () => {
          step.run({ engine, controller, store })
          context.resume().catch((error: unknown) => {
            // resume() after the render already finished is harmless.
            void error
          })
        },
        (error: unknown) => {
          suspendError ??= error
        },
      ),
    )
  }
  const rendered = await context.startRendering()
  await Promise.all(suspensions)
  return {
    rendered: {
      // COPY the channel data into JS-owned arrays: node-web-audio-api's
      // getChannelData returns views whose native backing store can be
      // invalidated (garbage values / NaN) once later renders run or the
      // context is collected. A copy taken now stays valid for the test.
      left: new Float32Array(rendered.getChannelData(0)),
      right: new Float32Array(rendered.getChannelData(1)),
      sampleRate: SAMPLE_RATE,
      engineStatus: engine.getStatus().status,
      engineMessage: engine.getStatus().message,
    },
    suspendError,
  }
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
