/**
 * Synth voices.
 *
 * A Synth note is rendered from `synthModel`'s generator functions into a buffer and played
 * as one source through a level stage into the layer's chain. Rendering up front (rather
 * than scheduling hundreds of Web Audio nodes) is what makes the engine's behaviour
 * *testable sample-for-sample*: the exact array the browser plays is the array the tests
 * measure.
 *
 * The buffer is bounded and the release is applied by the amp envelope inside it, so a voice
 * costs one source and two gains and is fully reclaimable.
 */
import type {
  AudioContextLike,
  BufferSourceLike,
  GainNodeLike,
} from './types'
import { gain, setNow, ramp, safeDisconnect } from './nodes'
import {
  applyFilter,
  renderEnvelope,
  renderLfo,
  renderOscillator,
  trackedCutoff,
  velocityGain,
  envelopeFromDials,
  cutoffHzFor,
  UNISON_CENTS,
  UNISON_VOICES,
  VIBRATO_AMOUNT_MAX_CENTS,
  VIBRATO_RATE_RANGE,
  glideCurve,
  type FilterType,
  type KeyTracking,
  type LfoWaveform,
  type VibratoMode,
} from './synthModel'
import type { SynthLayerState } from './synthState'

export interface SynthVoiceSettings {
  /** The complete layer configuration; the voice reads only what it needs. */
  layer: SynthLayerState
  /** Sounding MIDI note after octave, coarse and fine tuning. */
  midi: number
  velocity: number
  /** Layer level 0..1. */
  level: number
  /** Extra gain from split zoning. */
  zoneGain: number
  /** How long the key is held, in seconds. */
  holdSeconds: number
  /** Seconds of release tail to render after the key lifts. */
  releaseSeconds: number
  /** Glide start pitch in MIDI notes, or null for no glide. */
  glideFrom: number | null
  /** Mod wheel position 0..1, for the Wheel vibrato source. */
  modWheel: number
  /** LFO rate in Hz after clock sync has been resolved. */
  lfoRateHz: number
  /** Arp step times, when the voice is part of an arpeggiated figure. */
  arpGate?: { times: number[]; gateSeconds: number; hardness: number } | null
}

export interface SynthVoiceNodes {
  output: GainNodeLike
  start(now: number): void
  release(now: number): void
  stop(): void
  readonly sources: BufferSourceLike[]
  readonly nodes: number
  readonly finished: boolean
  /** The rendered buffer's mono samples, so tests measure what the browser plays. */
  readonly samples: Float32Array
  /** True when the filter stage was actually applied. */
  readonly filtered: boolean
}

/** Longest a single synth voice may render for, so a stuck key cannot allocate forever. */
export const MAX_SYNTH_SECONDS = 8

/**
 * Renders one synth note to a mono buffer. This is the shared path: the browser plays the
 * result, and the audio tests call it directly.
 */
export function renderSynthNote(settings: SynthVoiceSettings, sampleRate: number): {
  samples: Float32Array
  filtered: boolean
} {
  const layer = settings.layer
  const hold = Math.min(MAX_SYNTH_SECONDS, Math.max(0.02, settings.holdSeconds))
  const release = Math.min(4, Math.max(0.02, settings.releaseSeconds))
  const total = hold + release
  const frames = Math.max(1, Math.round(total * sampleRate))
  const ampEnv = envelopeFromDials(layer.ampEnv.attack, layer.ampEnv.decay, layer.ampEnv.release)
  // The requested release is the length of the tail the voice must render, so it overrides
  // the envelope's own release time. Without this the buffer would be padded to `total` with
  // whatever the dial happened to be, and a short release and a long one would sound the same.
  const voiceEnv = { ...ampEnv, release }
  const filterEnv = envelopeFromDials(
    layer.filterEnv.attack,
    layer.filterEnv.decay,
    layer.filterEnv.release,
  )
  const oscEnv = envelopeFromDials(layer.oscEnv.attack, layer.oscEnv.decay, layer.oscEnv.release)

  // ---- LFO -----------------------------------------------------------
  const lfo = renderLfo(layer.lfo.waveform as LfoWaveform, settings.lfoRateHz, frames, sampleRate)
  const lfoAmount = Math.min(1, Math.max(0, layer.lfo.amount / 10))
  const lfoPitchCents = layer.lfo.destinations.pitch ? lfoAmount * 60 : 0
  const lfoOscCtrl = layer.lfo.destinations.oscCtrl ? lfoAmount * 10 : 0
  // ---- oscillator envelope, as Osc Ctrl and/or pitch modulation ------
  const oscEnvelope = renderEnvelope(oscEnv, hold, total, sampleRate)
  const oscAmount = Math.max(-10, Math.min(10, layer.oscEnvAmount)) / 10
  // Env To Pitch retargets the oscillator envelope onto pitch, which is the manual's
  // switch; otherwise it modulates Osc Ctrl and the LFO's Osc Ctrl destination adds in.
  const ctrlMod = new Float32Array(frames)
  for (let i = 0; i < frames; i += 1) {
    ctrlMod[i] = lfo[i] * lfoOscCtrl + (layer.oscEnvToPitch ? 0 : oscEnvelope[i] * oscAmount * 10)
  }

  // ---- unison --------------------------------------------------------
  const unison = Math.max(0, Math.min(3, Math.round(layer.unison)))
  const voiceCount: number = UNISON_VOICES[unison] ?? 1
  const detuneCents: number = UNISON_CENTS[unison] ?? 0
  const left = new Float32Array(frames)
  const right = new Float32Array(frames)

  for (let v = 0; v < voiceCount; v += 1) {
    const spread = voiceCount === 1 ? 0 : (v / (voiceCount - 1)) * 2 - 1
    const pitchOffset = spread * detuneCents
    // The oscillator generator is mono per stack; Super and Multi spread themselves.
    const stack = renderOscillator({
      waveform: layer.waveform,
      midi: settings.midi + pitchOffset / 100,
      sampleRate,
      seconds: total,
      oscCtrl: layer.oscCtrl,
      oscCtrlMod: ctrlMod,
      seed: 1 + v * 17,
    })
    for (let i = 0; i < frames; i += 1) {
      left[i] += stack.left[i] / Math.sqrt(voiceCount)
      right[i] += stack.right[i] / Math.sqrt(voiceCount)
    }
  }

  // ---- pitch modulation: LFO, vibrato, glide --------------------------
  const vibratoCents = vibratoDepthCents(layer, settings.modWheel)
  const pitchCents = new Float32Array(frames)
  const glideCurveData =
    settings.glideFrom !== null && layer.glide > 0
      ? glideCurve(
          settings.glideFrom,
          settings.midi,
          frames,
          (Math.min(10, Math.max(0, layer.glide)) / 10) * 0.35 * Math.max(0.25, Math.abs(settings.midi - settings.glideFrom) / 12),
          sampleRate,
        )
      : null
  for (let i = 0; i < frames; i += 1) {
    const glideOffset = glideCurveData ? glideCurveData[i] - settings.midi : 0
    pitchCents[i] = lfo[i] * lfoPitchCents + vibratoCents * lfo[i] + glideOffset * 100
  }
  applyPitchModulation(left, right, pitchCents, sampleRate)
  // The oscillator envelope onto pitch, when Env To Pitch is engaged.
  if (layer.oscEnvToPitch) {
    const cents = new Float32Array(frames)
    for (let i = 0; i < frames; i += 1) cents[i] = oscEnvelope[i] * oscAmount * 1200
    applyPitchModulation(left, right, cents, sampleRate)
  }

  // ---- filter --------------------------------------------------------
  const filtered = layer.filterOn
  if (filtered) {
    const base = cutoffHzFor(layer.filterFreq)
    const tracked = trackedCutoff(base, settings.midi, layer.keyTracking as KeyTracking)
    // The filter envelope sweeps the cutoff upward by its amount, which is what Env Amt
    // says on the panel.
    const envDepth = Math.max(0, Math.min(1, layer.filterEnvAmount / 10))
    const cutoffMod = new Float32Array(frames)
    const filterEnvelope = renderEnvelope(filterEnv, hold, total, sampleRate)
    const lfoFilter = layer.lfo.destinations.filter ? lfoAmount * 0.9 : 0
    for (let i = 0; i < frames; i += 1) {
      const envSemitones = filterEnvelope[i] * envDepth * 60
      const lfoSemitones = lfo[i] * lfoFilter * 24
      cutoffMod[i] = tracked * Math.pow(2, (envSemitones + lfoSemitones) / 12)
    }
    const resonance = Math.min(1, Math.max(0, layer.filterRes / 10))
    // Left and right are filtered identically; Super's stereo spread survives because the
    // filter is linear and the two channels carry different signals.
    applyFilter(left, {
      type: layer.filterType as FilterType,
      cutoffHz: tracked,
      resonance,
      drive: layer.filterDrive,
      sampleRate,
      cutoffModulation: cutoffMod,
    })
    applyFilter(right, {
      type: layer.filterType as FilterType,
      cutoffHz: tracked,
      resonance,
      drive: layer.filterDrive,
      sampleRate,
      cutoffModulation: cutoffMod,
    })
  }

  // ---- amplifier envelope --------------------------------------------
  // The panel's printed AMP VELOCITY switch is Off/1/2/3; the amp envelope's own
  // `velocity` field is the raw 0..1 depth, so either can carry the sensitivity.
  const velocityDepth = Math.max(
    Math.min(1, Math.max(0, layer.ampEnv.velocity)),
    Math.min(1, Math.max(0, Math.round(layer.ampVelocity)) / 3),
  )
  const ampVelocity = velocityGain(settings.velocity, velocityDepth)
  const level = settings.level * settings.zoneGain * ampVelocity
  const ampShape = renderEnvelope(voiceEnv, hold, total, sampleRate)
  const samples = new Float32Array(frames)
  for (let i = 0; i < frames; i += 1) {
    const mono = (left[i] + right[i]) / 2
    samples[i] = mono * ampShape[i] * level
  }
  // An arpeggiated or gated voice is chopped into steps by its gate envelope.
  if (settings.arpGate && settings.arpGate.times.length > 0) {
    applyArpGate(samples, settings.arpGate.times, settings.arpGate.gateSeconds, sampleRate)
  }
  return { samples, filtered }
}

/** Vibrato depth in cents for the layer's mode (manual p. 35). */
function vibratoDepthCents(layer: SynthLayerState, modWheel: number): number {
  const mode = layer.vibrato as VibratoMode
  const amount = Math.min(1, Math.max(0, layer.vibratoAmount / 10))
  const max = amount * VIBRATO_AMOUNT_MAX_CENTS
  switch (mode) {
    case 'On':
      return max
    case 'Wheel':
      return max * Math.min(1, Math.max(0, modWheel))
    case 'Aftertouch':
      // The spec excludes aftertouch (browser keyboards have none), so this source is
      // unsupported and contributes nothing rather than pretending to sense pressure.
      return 0
    case 'Delayed':
    case 'Pedal':
      // Not required by the spec; treated as the free-running source so the panel's
      // selector still has a defined, audible meaning when it is reached.
      return max * 0.6
    default:
      return 0
  }
}

/** Applies a per-sample pitch offset, in cents, by resampling with linear interpolation. */
function applyPitchModulation(
  left: Float32Array,
  right: Float32Array,
  cents: Float32Array,
  sampleRate: number,
): void {
  void sampleRate
  const positions = new Float64Array(left.length)
  let position = 0
  for (let i = 0; i < cents.length; i += 1) {
    positions[i] = position
    position += Math.pow(2, cents[i] / 1200)
    if (position > left.length - 2) break
  }
  const read = (data: Float32Array, at: number): number => {
    const index = Math.floor(at)
    const frac = at - index
    const a = data[Math.min(index, data.length - 1)]
    const b = data[Math.min(index + 1, data.length - 1)]
    return a + (b - a) * frac
  }
  const leftCopy = left.slice()
  const rightCopy = right.slice()
  for (let i = 0; i < cents.length; i += 1) {
    const at = positions[i]
    if (at >= left.length - 2) {
      left[i] = 0
      right[i] = 0
      continue
    }
    left[i] = read(leftCopy, at)
    right[i] = read(rightCopy, at)
  }
}

/** Chops a rendered voice into arpeggiator steps. */
function applyArpGate(
  samples: Float32Array,
  times: number[],
  gateSeconds: number,
  sampleRate: number,
): void {
  const stepFrames = times.length > 1 ? Math.round((times[1] - times[0]) * sampleRate) : samples.length
  void gateSeconds
  for (let step = 0; step < times.length; step += 1) {
    const start = Math.round(times[step] * sampleRate)
    if (start >= samples.length) break
    const end = Math.min(samples.length, start + stepFrames)
    // A short raised-cosine taper keeps each step click-free.
    const taper = Math.max(1, Math.min(Math.round(stepFrames * 0.12), Math.round(0.006 * sampleRate)))
    for (let i = start; i < end; i += 1) {
      const inStep = i - start
      const fromEnd = end - i
      let gainValue = 1
      if (inStep < taper) gainValue = Math.sin((inStep / taper) * (Math.PI / 2))
      else if (fromEnd < taper) gainValue = Math.sin((fromEnd / taper) * (Math.PI / 2))
      samples[i] *= gainValue
    }
    // Everything between this step and the next is silent.
    for (let i = end; i < Math.min(samples.length, end + stepFrames); i += 1) samples[i] = 0
  }
}

/* ------------------------------------------------------------------ */
/* The voice node                                                     */
/* ------------------------------------------------------------------ */

export function createSynthVoice(
  ctx: AudioContextLike,
  settings: SynthVoiceSettings,
): SynthVoiceNodes {
  const output = gain(ctx, 1)
  const level = gain(ctx, 0)
  level.connect(output)
  const { samples, filtered } = renderSynthNote(settings, ctx.sampleRate)
  const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate)
  buffer.getChannelData(0).set(samples)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.loop = false
  source.connect(level)
  let stopped = false
  return {
    output,
    sources: [source],
    nodes: 2,
    samples,
    filtered,
    get finished() {
      return stopped
    },
    start(now: number) {
      setNow(level.gain, 1, now)
      source.start(now)
    },
    release(now: number) {
      // The release is already inside the rendered buffer, so a key-up only needs to let
      // the tail play; there is nothing to ramp. Stopping early would cut the tail off.
      void now
    },
    stop() {
      stopped = true
      source.onended = null
      try {
        source.stop()
      } catch {
        /* already stopped */
      }
      safeDisconnect(source)
      safeDisconnect(level)
      safeDisconnect(output)
    },
  }
}

/** Kept so a caller with only a chain owner gets the chain that owns it. */
export function chainOwnerForLayer(layer: string): string {
  return layer.startsWith('organ') ? 'organ' : layer
}
