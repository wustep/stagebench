/**
 * Piano voices.
 *
 * Two kinds of voice exist, and the difference is declared, not hidden:
 *
 *  - `SampleVoice` plays a bundled recording from the manifest, picking the nearest root
 *    note (max ±1.5 semitones of playback-rate shift) and the nearest velocity layer.
 *  - `ModelledVoice` synthesises Clav, Digital and Misc from the Phase 1 partial-bank
 *    model, tuned per model. The piano spec allows honest synthesis for those three types.
 *
 * Both end up as an `AudioBufferSourceNode` into the layer's effect chain, so the layer,
 * effects and master path are identical whichever source produced the sound.
 */
import type {
  AudioBufferLike,
  AudioContextLike,
  BufferSourceLike,
  AudioNodeLike,
  GainNodeLike,
} from './types'
import { gain, setNow } from './nodes'
import type { PianoModelId } from './types'
import { renderPianoBody, releasePoints, releaseSecondsFor } from './pianoModel'
import { UNISON_DETUNE_CENTS } from './pianoLibrary'

/* ------------------------------------------------------------------ */
/* Manifest                                                          */
/* ------------------------------------------------------------------ */

export interface SampleEntry {
  model: 'grand' | 'upright' | 'cp80'
  midi: number
  layer: number
  velLow: number
  velHigh: number
  file: string
  kind: 'recorded' | 'derived'
  derivedFromMidi: number | null
  shiftSemitones: number
}

/** Which model directory each recorded piano model uses. */
export const SAMPLE_MODEL_FOR_PIANO_MODEL: Partial<Record<PianoModelId, SampleEntry['model']>> = {
  'grand.salamander': 'grand',
  'grand.studio': 'grand',
  'upright.ivy': 'upright',
  'electric.wurlitzer': 'cp80',
  'electric.cp80': 'cp80',
}

export interface SampleIndex {
  /** model -> layer -> sorted root notes */
  roots: Map<string, Map<number, number[]>>
  /** file path -> entry */
  byFile: Map<string, SampleEntry>
  /** `${model}:${midi}:${layer}` -> entry */
  byNote: Map<string, SampleEntry>
}

export function buildIndex(entries: SampleEntry[]): SampleIndex {
  const roots = new Map<string, Map<number, number[]>>()
  const byFile = new Map<string, SampleEntry>()
  const byNote = new Map<string, SampleEntry>()
  for (const entry of entries) {
    byFile.set(entry.file, entry)
    byNote.set(`${entry.model}:${entry.midi}:${entry.layer}`, entry)
    if (!roots.has(entry.model)) roots.set(entry.model, new Map())
    const layers = roots.get(entry.model)!
    if (!layers.has(entry.layer)) layers.set(entry.layer, [])
    const list = layers.get(entry.layer)!
    if (!list.includes(entry.midi)) list.push(entry.midi)
  }
  for (const layers of roots.values()) {
    for (const list of layers.values()) list.sort((a, b) => a - b)
  }
  return { roots, byFile, byNote }
}

/** Chooses the velocity layer whose declared MIDI range contains `velocity` (0..1). */
export function layerForVelocity(entries: SampleEntry[], velocity: number): number {
  const midiVelocity = Math.max(1, Math.min(127, Math.round(velocity * 127)))
  const match = entries.find((e) => midiVelocity >= e.velLow && midiVelocity <= e.velHigh)
  if (match) return match.layer
  // Fall back to the closest declared range rather than silently using the loudest layer.
  let best = entries[0]
  for (const entry of entries) {
    const distance = midiVelocity < entry.velLow ? entry.velLow - midiVelocity : midiVelocity - entry.velHigh
    const bestDistance = midiVelocity < best.velLow ? best.velLow - midiVelocity : midiVelocity - best.velHigh
    if (distance < bestDistance) best = entry
  }
  return best.layer
}

/** Nearest root note for a midi note within one model + velocity layer. */
export function nearestRoot(roots: number[], midi: number): number {
  let best = roots[0] ?? midi
  let bestDistance = Math.abs(best - midi)
  for (const root of roots) {
    const distance = Math.abs(root - midi)
    if (distance < bestDistance) {
      best = root
      bestDistance = distance
    }
  }
  return best
}

/* ------------------------------------------------------------------ */
/* Buffer cache                                                      */
/* ------------------------------------------------------------------ */

export class SampleBank {
  private readonly ctx: AudioContextLike
  private readonly index: SampleIndex
  private readonly gains: Record<string, number>
  private readonly baseUrl: string
  private readonly fetchJson: (url: string) => Promise<unknown>
  private readonly fetchBytes: (url: string) => Promise<ArrayBuffer>
  private readonly buffers = new Map<string, AudioBufferLike>()
  private readonly pending = new Map<string, Promise<AudioBufferLike>>()
  readonly failed = new Set<string>()
  private readonly loaded = new Set<string>()

  constructor(options: {
    ctx: AudioContextLike
    index: SampleIndex
    gains: Record<string, number>
    /** Base URL for the bundled files, resolved by the caller. */
    baseUrl: string
    fetchBytes?: (url: string) => Promise<ArrayBuffer>
    fetchJson?: (url: string) => Promise<unknown>
  }) {
    this.ctx = options.ctx
    this.index = options.index
    this.gains = options.gains
    this.baseUrl = options.baseUrl
    this.fetchBytes = options.fetchBytes ?? defaultFetchBytes
    this.fetchJson = options.fetchJson ?? defaultFetchJson
  }

  gainFor(file: string): number {
    return this.gains[file] ?? 1
  }

  isLoaded(file: string): boolean {
    return this.loaded.has(file)
  }

  get loadedCount(): number {
    return this.loaded.size
  }

  entryFor(file: string): SampleEntry | undefined {
    return this.index.byFile.get(file)
  }

  /** Resolves the entry a note should play. */
  resolve(model: string, midi: number, velocity: number): { entry: SampleEntry; detuneSemitones: number } | null {
    const layers = this.index.roots.get(model)
    if (!layers) return null
    const sampleLayerEntries = Array.from(this.index.byNote.values()).filter((e) => e.model === model)
    if (sampleLayerEntries.length === 0) return null
    const layer = layerForVelocity(sampleLayerEntries, velocity)
    const roots = layers.get(layer)
    if (!roots || roots.length === 0) return null
    const root = nearestRoot(roots, midi)
    const entry = this.index.byNote.get(`${model}:${root}:${layer}`)
    if (!entry) return null
    return { entry, detuneSemitones: midi - root }
  }

  async load(entry: SampleEntry): Promise<AudioBufferLike> {
    const cached = this.buffers.get(entry.file)
    if (cached) return cached
    const inFlight = this.pending.get(entry.file)
    if (inFlight) return inFlight
    if (!this.ctx.decodeAudioData) throw new Error('this audio backend cannot decode samples')
    const task = (async () => {
      const bytes = await this.fetchBytes(sampleUrl(this.baseUrl, entry.file))
      const buffer = await this.ctx.decodeAudioData!(bytes)
      this.buffers.set(entry.file, buffer)
      this.loaded.add(entry.file)
      return buffer
    })()
    this.pending.set(entry.file, task)
    try {
      return await task
    } catch (error) {
      this.failed.add(entry.file)
      throw error
    } finally {
      this.pending.delete(entry.file)
    }
  }

  /**
   * Loads every file a model needs for one velocity layer, so playing a note never waits
   * on the network mid-gesture. Resolves with the list of failures rather than throwing:
   * a partial library is a labelled fallback, not a crash.
   */
  async preloadModel(model: string, layer?: number): Promise<string[]> {
    const failures: string[] = []
    const entries = Array.from(this.index.byNote.values()).filter(
      (e) => e.model === model && (layer === undefined || e.layer === layer),
    )
    await Promise.all(
      entries.map(async (entry) => {
        try {
          await this.load(entry)
        } catch {
          failures.push(entry.file)
        }
      }),
    )
    return failures
  }

  bufferFor(file: string): AudioBufferLike | undefined {
    return this.buffers.get(file)
  }

  /** Used by tests to inspect how much of the library is resident. */
  cachedFiles(): string[] {
    return Array.from(this.buffers.keys()).toSorted()
  }

  loadJson(url: string): Promise<unknown> {
    return this.fetchJson(url)
  }
}

/**
 * Builds the URL for a bundled sample.
 *
 * Sample file names contain sharps ("F#1-v1.mp3"), and a literal '#' in a URL starts the
 * fragment, so an unencoded name requests a different path and silently fails. Each path
 * segment is encoded on its own, which keeps the separators intact.
 */
export function sampleUrl(baseUrl: string, file: string): string {
  const encoded = file
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `${baseUrl}${encoded}`
}

async function defaultFetchBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`sample request failed: ${response.status}`)
  return response.arrayBuffer()
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`sample manifest request failed: ${response.status}`)
  return response.json()
}

/* ------------------------------------------------------------------ */
/* Voices                                                            */
/* ------------------------------------------------------------------ */

export interface VoiceParams {
  midi: number
  velocity: number
  /** Effective playback midi after the layer's octave shift. */
  playedMidi: number
  touchExponent: number
  dynComp: number
  timbre: number
  unison: number
  softRelease: boolean
  stringRes: boolean
  model: PianoModelId
}

export interface VoiceNodes {
  /** Where this voice enters the layer chain. */
  output: GainNodeLike
  start(now: number): void
  release(now: number): void
  stop(): void
  /** True once the source can no longer produce sound. */
  finished: boolean
  readonly sources: BufferSourceLike[]
  readonly nodes: number
}

/** KB Touch maps a normalized velocity through the selected curve (manual p. 25). */
export function touchVelocity(velocity: number, exponent: number): number {
  return Math.min(1, Math.max(0.001, Math.pow(velocity, exponent)))
}

/** Dyn Comp raises the level of softer strokes without touching timbre (manual p. 25). */
export function dynCompGain(velocity: number, amount: number): number {
  if (amount <= 0) return 1
  // A soft stroke gets progressively more lift; a hard stroke is left alone.
  return 1 + amount * 1.5 * Math.pow(1 - velocity, 1.6)
}

/** Soft Release lengthens and flattens the release ramp (manual p. 25). */
export function releaseSeconds(midi: number, softRelease: boolean): number {
  const base = releaseSecondsFor(midi)
  return softRelease ? base * 1.7 : base
}

/** Timbre voicing: (bass dB, mid dB, treble dB) applied as a three-band tilt. */
export function timbreTilt(timbre: number, isElectric: boolean): { bass: number; mid: number; treble: number } {
  const table = isElectric
    ? [
        { bass: 0, mid: 0, treble: 0 },
        { bass: 2.5, mid: -1, treble: -7 },
        { bass: -0.5, mid: 3.5, treble: 1 },
        { bass: -0.5, mid: 2.5, treble: 6 },
        { bass: 1, mid: 3, treble: 7 },
        { bass: 6.5, mid: -3.5, treble: 8 },
      ]
    : [
        // "Off" is the recording's own response; the other three are the printed voicings
        // (manual p. 26): SOFT dampens highs and emphasises the low end, MID de-emphasises
        // both extremes for a focused mid-range, BRIGHT emphasises the treble.
        { bass: 0, mid: 0, treble: 0 },
        { bass: 4, mid: -1, treble: -12 },
        { bass: -5, mid: 5, treble: -4 },
        { bass: -3, mid: 0, treble: 11 },
      ]
  return table[Math.max(0, Math.min(table.length - 1, Math.round(timbre)))]
}

/**
 * A sampled voice. Unison adds detuned, spread copies from the same recording, which is
 * exactly the "transposed voices ... stereo widening" the manual describes.
 */
export function createSampleVoice(
  ctx: AudioContextLike,
  bank: SampleBank,
  entry: SampleEntry,
  params: VoiceParams,
  buffer: AudioBufferLike,
): VoiceNodes {
  const output = gain(ctx, 0)
  const sources: BufferSourceLike[] = []
  const nodes: GainNodeLike[] = []
  const velocity = touchVelocity(params.velocity, params.touchExponent)

  // Timbre, before the layer chain. Three bands approximate the printed voicings.
  const tilt = timbreTilt(params.timbre, params.model.startsWith('electric'))
  const bass = ctx.createBiquadFilter?.()
  const mid = ctx.createBiquadFilter?.()
  const treble = ctx.createBiquadFilter?.()
  // Signal order: each voice copy -> [bass -> mid -> treble] -> output.
  let head: AudioNodeLike = output
  let filterNodes = 0
  if (bass && mid && treble) {
    bass.type = 'lowshelf'
    setNow(bass.frequency, 220, ctx.currentTime)
    setNow(bass.gain, tilt.bass, ctx.currentTime)
    mid.type = 'peaking'
    setNow(mid.frequency, 1100, ctx.currentTime)
    setNow(mid.Q, 0.9, ctx.currentTime)
    setNow(mid.gain, tilt.mid, ctx.currentTime)
    treble.type = 'highshelf'
    setNow(treble.frequency, 3600, ctx.currentTime)
    setNow(treble.gain, tilt.treble, ctx.currentTime)
    bass.connect(mid)
    mid.connect(treble)
    treble.connect(output)
    head = bass
    filterNodes = 3
  }

  const unison = Math.max(0, Math.min(3, Math.round(params.unison)))
  // Unison is "transposed voices from neighbouring keys" creating stereo width
  // (manual p. 26): level 1 is a subtle doubling, level 3 is obviously detuned and wide.
  const copies = unison === 0 ? 1 : unison + 1
  const spreads = [0, -1, 1, -1, 1]
  const detuneSteps = [0, -1, 1, -1.6, 1.6]
  const detuneCents = UNISON_DETUNE_CENTS[unison]
  // Each copy is scaled so summing them keeps a comparable loudness to a single voice.
  const peak = 0.9 / Math.sqrt(copies)

  for (let i = 0; i < copies; i += 1) {
    const voiceGain = gain(ctx, 0)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.loop = false
    // Playback rate carries both the interval to the recorded root and the unison detune,
    // so the copies beat against each other instead of merely being panned apart.
    if (source.playbackRate) {
      const cents = i === 0 ? 0 : detuneSteps[i] * detuneCents
      const semis = params.midi - entry.midi + cents / 100
      setNow(source.playbackRate, Math.pow(2, semis / 12), ctx.currentTime)
    }
    source.connect(voiceGain)
    if (copies > 1 && ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner()
      setNow(panner.pan, spreads[i] * (0.55 + unison * 0.12), ctx.currentTime)
      voiceGain.connect(panner)
      panner.connect(head)
    } else {
      voiceGain.connect(head)
    }
    sources.push(source)
    nodes.push(voiceGain)
  }

  const level = velocity * dynCompGain(params.velocity, params.dynComp) * bank.gainFor(entry.file) * peak
  let stopped = false
  let released = false

  return {
    output,
    sources,
    nodes: nodes.length + filterNodes,
    get finished() {
      return stopped
    },
    start(now: number) {
      // `output` is the voice's unity summing point for sampled voices; the level lives on
      // each copy so unison detune stays balanced.
      setNow(output.gain, 1, now)
      for (const node of nodes) setNow(node.gain, level, now)
      for (const source of sources) source.start(now)
    },
    release(now: number) {
      if (released) return
      released = true
      const seconds = releaseSeconds(params.playedMidi, params.softRelease)
      const curve = releasePoints(seconds, ctx.sampleRate)
      for (const node of nodes) {
        node.gain.cancelScheduledValues(now)
        // Keep the level we are at, then run the damper curve from there.
        node.gain.setValueAtTime(node.gain.value, now)
        node.gain.setValueCurveAtTime(curve, now, seconds)
      }
      for (const source of sources) {
        try {
          source.stop(now + seconds + 0.02)
        } catch {
          /* already stopping */
        }
      }
    },
    stop() {
      stopped = true
      for (const source of sources) {
        source.onended = null
        try {
          source.stop()
        } catch {
          /* already stopped */
        }
        try {
          source.disconnect()
        } catch {
          /* already disconnected */
        }
      }
      for (const node of nodes) {
        try {
          node.disconnect()
        } catch {
          /* already disconnected */
        }
      }
      for (const filter of [bass, mid, treble]) {
        try {
          filter?.disconnect()
        } catch {
          /* already disconnected */
        }
      }
      try {
        output.disconnect()
      } catch {
        /* already disconnected */
      }
    },
  }
}

/**
 * A synthesised voice for Clav, Digital and Misc. It renders the Phase 1 additive model
 * with a per-model character, so those three types are honestly modelled rather than
 * pretending to be recordings.
 */
export function createModelledVoice(
  ctx: AudioContextLike,
  params: VoiceParams,
): VoiceNodes {
  const output = gain(ctx, 0)
  const velocity = touchVelocity(params.velocity, params.touchExponent)
  const seconds = 3
  const frames = Math.max(1, Math.round(seconds * ctx.sampleRate))
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
  const data = buffer.getChannelData(0)

  const model = params.model
  const body = renderPianoBody({
    midi: params.midi,
    velocity,
    sampleRate: ctx.sampleRate,
    seconds,
    seed: hash(`${model}:${params.midi}:${Math.round(params.velocity * 127)}`),
  })
  data.set(body)

  // Per-model character, applied honestly as audible timbre differences.
  if (model === 'clav.modelled') {
    // A clavinet is a bright, fast-decaying plucked string: shorten the tail and add bite.
    for (let i = 0; i < frames; i += 1) {
      const t = i / ctx.sampleRate
      data[i] *= Math.exp(-t * 3.4)
    }
    addHarmonicBite(data, ctx.sampleRate, params.midi, 0.38)
  } else if (model === 'digital.modelled') {
    // A clean digital piano: gentle high roll-off, longer sustain, no hammer noise.
    for (let i = 0; i < frames; i += 1) data[i] *= 0.92
    smoothTail(data, 0.55)
  } else if (model === 'misc.modelled') {
    // A mallet: strong odd/even partials and a fast, hard decay.
    for (let i = 0; i < frames; i += 1) {
      const t = i / ctx.sampleRate
      data[i] *= Math.exp(-t * 2.6)
    }
    addPartial(data, ctx.sampleRate, params.midi * 4, 0.20)
    addPartial(data, ctx.sampleRate, params.midi * 7, 0.10)
  }

  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.loop = false
  const tilt = timbreTilt(params.timbre, false)
  const filter = ctx.createBiquadFilter?.()
  if (filter) {
    filter.type = 'highshelf'
    setNow(filter.frequency, 3200, ctx.currentTime)
    setNow(filter.gain, tilt.treble, ctx.currentTime)
    source.connect(filter)
    filter.connect(output)
  } else {
    source.connect(output)
  }

  const level = velocity * dynCompGain(params.velocity, params.dynComp) * 0.82
  let stopped = false
  let released = false
  return {
    output,
    sources: [source],
    nodes: filter ? 2 : 1,
    get finished() {
      return stopped
    },
    start(now: number) {
      setNow(output.gain, level, now)
      source.start(now)
    },
    release(now: number) {
      if (released) return
      released = true
      const secs = releaseSeconds(params.playedMidi, params.softRelease)
      const curve = releasePoints(secs, ctx.sampleRate)
      output.gain.cancelScheduledValues(now)
      output.gain.setValueAtTime(output.gain.value, now)
      output.gain.setValueCurveAtTime(curve, now, secs)
      try {
        source.stop(now + secs + 0.02)
      } catch {
        /* already stopped */
      }
    },
    stop() {
      stopped = true
      source.onended = null
      try {
        source.stop()
      } catch {
        /* already stopped */
      }
      try {
        source.disconnect()
      } catch {
        /* already disconnected */
      }
      try {
        filter?.disconnect()
      } catch {
        /* already disconnected */
      }
      try {
        output.disconnect()
      } catch {
        /* already disconnected */
      }
    },
  }
}

function addHarmonicBite(data: Float32Array, sampleRate: number, midi: number, amount: number): void {
  const f = 440 * Math.pow(2, (midi - 69) / 12)
  const step = (2 * Math.PI * f * 3) / sampleRate
  for (let i = 0; i < data.length; i += 1) {
    const t = i / sampleRate
    data[i] += Math.sin(step * i) * amount * Math.exp(-t * 6) * 0.5
  }
}

function addPartial(data: Float32Array, sampleRate: number, midi: number, amount: number): void {
  const f = 440 * Math.pow(2, (midi - 69) / 12)
  const step = (2 * Math.PI * f) / sampleRate
  for (let i = 0; i < data.length; i += 1) {
    const t = i / sampleRate
    data[i] += Math.sin(step * i) * amount * Math.exp(-t * 4)
  }
}

function smoothTail(data: Float32Array, mixAmount: number): void {
  let prev = 0
  for (let i = 0; i < data.length; i += 1) {
    prev = prev + 0.28 * (data[i] - prev)
    data[i] = data[i] * (1 - mixAmount) + prev * mixAmount
  }
}

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
