import type { AudioContextLike, PeriodicWaveLike } from './boundaries'
import type { SynthWaveformCategory } from '../state/instrument'

/**
 * Analog-mode oscillator source construction (spec: nord-stage-4.synth.json
 * oscillator). Pure waveforms use native/PeriodicWave oscillator types; Sync,
 * Multi, Super and FM-H are GENERATED approximations of the real hardware
 * behavior, declared honestly here and in IMPLEMENTATION_DETAILS.json:
 *
 * - Pulse 33 / Pulse 10: PeriodicWave built from an asymmetric-duty square's
 *   Fourier series (bn = 2/(n*pi) * sin(n*pi*duty)) — audibly distinct from
 *   Square (duty 50%) and from each other.
 * - Sync Saw / Sync Square: a DECLARED spectral approximation of hard sync —
 *   a PeriodicWave whose harmonic energy is the base spectrum multiplied by a
 *   gaussian bump centered on a "sync pitch" harmonic that Osc Ctrl sweeps.
 *   This is not a real hard-synced oscillator pair; it reproduces the
 *   audible signature (a moving resonant peak) without the underlying
 *   two-oscillator reset mechanism.
 * - Multi Saw / Multi Saw 8ve: 3 (or 4, +8ve) real sawtooth oscillators
 *   detuned by Osc Ctrl.
 * - Super Saw / Super Square: a 7-oscillator unison stack detuned by Osc
 *   Ctrl, alternately panned.
 * - FM 2-op: two real oscillators, a 1:1-ratio modulator's output gain
 *   feeding the carrier's frequency AudioParam (true FM synthesis).
 *
 * Optional-scope categories (spec.scope.optional), all declared:
 * - Saw Sub / Square Sub: a real sawtooth/square main oscillator plus a real
 *   square sub-oscillator one octave down; Osc Ctrl is that sub's gain
 *   (0..1, live-retargetable) — true synthesis, no spectral approximation.
 * - Shape Pulse: a PeriodicWave pulse whose duty cycle follows Osc Ctrl,
 *   rebuilt on quantized ctrl steps exactly like the Sync category's moving
 *   spectral peak (declared: a real duty-cycle Fourier series, stepped
 *   rather than continuously morphed).
 * - Shape Sine: a sine oscillator through a wavefolding WaveShaper curve;
 *   Osc Ctrl is a live pre-shaper drive gain (fold amount), so the curve
 *   itself is generated once per quantized ctrl step and the live sweep is
 *   a real audio-rate gain, matching the Sync/Shape-Pulse quantization
 *   convention — declared generated DSP.
 * - Wave Organ / Wave Formant: two fixed digital PeriodicWaves (an organ
 *   drawbar-partial recipe and a vowel-formant-like bump spectrum) built
 *   once; Osc Ctrl has no effect for this category (like Pure), declared
 *   spec-consistent with oscillator.oscCtrlByCategory's "No effect" rule.
 * - FM 2-op B: identical 2-op FM structure to FM-H's FM 2-op, but an
 *   inharmonic 1.414 modulator:carrier ratio instead of 1:1 — true FM
 *   synthesis, Osc Ctrl is still the modulation amount.
 */

const HARMONICS = 24

/** Per-context PeriodicWave cache (perf audit): every wave built here is a
 *  pure function of its quantized inputs, so a dense MIDI passage on a
 *  Sync/Pulse/Shape/Wave program was paying the Fourier-table + native wave
 *  construction cost on EVERY note-on for identical waves. PeriodicWaves are
 *  context-bound, hence the WeakMap keyed by context (test fakes create a
 *  fresh context per test, so caching stays correct there too). */
const waveCaches = new WeakMap<AudioContextLike, Map<string, PeriodicWaveLike>>()

function cachedWave(context: AudioContextLike, key: string, build: () => PeriodicWaveLike): PeriodicWaveLike {
  let cache = waveCaches.get(context)
  if (!cache) {
    cache = new Map()
    waveCaches.set(context, cache)
  }
  let wave = cache.get(key)
  if (!wave) {
    wave = build()
    cache.set(key, wave)
  }
  return wave
}

/** Fourier coefficients (bn) for a duty-cycle square wave, DC-free, used to
 *  build the Pulse 33/10 PeriodicWaves (duty 0..1, e.g. 0.33 or 0.10). */
function pulseWave(context: AudioContextLike, duty: number): PeriodicWaveLike {
  return cachedWave(context, `pulse:${duty}`, () => {
    const real = new Float32Array(HARMONICS + 1)
    const imag = new Float32Array(HARMONICS + 1)
    for (let n = 1; n <= HARMONICS; n++) {
      imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty)
    }
    return context.createPeriodicWave(real, imag)
  })
}

/** Base odd/all-harmonic spectra (before the sync gaussian bump) for the two
 *  Sync waveforms — Sync Saw uses a full 1/n saw spectrum, Sync Square uses
 *  the odd-harmonic-only square spectrum, so the two stay distinct at every
 *  Osc Ctrl position. */
function baseSyncSpectrum(square: boolean): Float32Array {
  const imag = new Float32Array(HARMONICS + 1)
  for (let n = 1; n <= HARMONICS; n++) {
    if (square && n % 2 === 0) continue
    imag[n] = 1 / n
  }
  return imag
}

/** The sync pitch harmonic Osc Ctrl (0..127) sweeps to (spec: "relative
 *  pitch of the synced oscillator"), rounded so the wave only rebuilds on a
 *  quantized change. */
export function syncPeakHarmonic(oscCtrl: number): number {
  return Math.round(1 + (oscCtrl / 127) * 8)
}

/** Builds the Sync Saw/Square PeriodicWave: the base spectrum shaped by a
 *  gaussian bump centered on the sync pitch harmonic — a resonant-peak
 *  approximation of hard-sync formant motion (declared approximation). */
export function syncWave(context: AudioContextLike, square: boolean, oscCtrl: number): PeriodicWaveLike {
  const peak = syncPeakHarmonic(oscCtrl)
  return cachedWave(context, `sync:${square}:${peak}`, () => {
    const base = baseSyncSpectrum(square)
    const real = new Float32Array(HARMONICS + 1)
    const imag = new Float32Array(HARMONICS + 1)
    const width = 2.2
    for (let n = 1; n <= HARMONICS; n++) {
      const bump = Math.exp(-((n - peak) ** 2) / (2 * width * width))
      imag[n] = base[n]! * (0.35 + 2.2 * bump)
    }
    return context.createPeriodicWave(real, imag)
  })
}

export function pulse33Wave(context: AudioContextLike): PeriodicWaveLike {
  return pulseWave(context, 0.33)
}

export function pulse10Wave(context: AudioContextLike): PeriodicWaveLike {
  return pulseWave(context, 0.1)
}

/** Whether Osc Ctrl has an audible effect for a waveform's category
 *  (spec oscillator.oscCtrlByCategory: "Pure: No effect"). */
export function oscCtrlActiveFor(category: SynthWaveformCategory): boolean {
  // Wave is spec-consistent with Pure's "No effect" rule (fixed digital
  // spectra); every other category (including the optional Sub/Shape/FM-I
  // scope) gives Osc Ctrl a real per-category meaning.
  return category !== 'Pure' && category !== 'Wave'
}

/** Multi Saw detune per stacked oscillator (±cents), Osc Ctrl = detune amount. */
export function multiDetuneCents(oscCtrl: number): number {
  return (oscCtrl / 127) * 35
}

/** Super Saw/Square unison spread per voice index (±cents), Osc Ctrl = width. */
export function superDetuneCents(oscCtrl: number, voiceIndex: number, voiceCount: number): number {
  const spread = 2 + (oscCtrl / 127) * 48
  const t = voiceCount > 1 ? voiceIndex / (voiceCount - 1) - 0.5 : 0
  return t * 2 * spread
}

/** FM 2-op modulation index (spec: "FM modulation amount"), scaled by the
 *  carrier frequency so brightness sweeps audibly across the keyboard range.
 *  Shared by FM-H's 1:1 algorithm and FM-I's 1.414 (inharmonic) algorithm —
 *  only the modulator:carrier ratio differs between the two (see
 *  FM_INHARMONIC_RATIO below). */
export function fmModulationIndex(oscCtrl: number, carrierFrequencyHz: number): number {
  return (oscCtrl / 127) * 8 * carrierFrequencyHz
}

/** FM 2-op B's inharmonic modulator:carrier ratio (spec: "FM Inharmonic
 *  algorithms" — vs FM-H's 1:1 harmonic ratio). */
export const FM_INHARMONIC_RATIO = 1.414

/** Sub Osc's sub-oscillator gain (0..1), Osc Ctrl = sub level (spec: "OSC
 *  CTRL = sub level"). Linear so 0 is silent and 127 is unity gain. */
export function subOscGain(oscCtrl: number): number {
  return oscCtrl / 127
}

/** Shape Pulse's duty cycle (spec: "duty range 0.05..0.5"), quantized the
 *  same way syncPeakHarmonic quantizes Sync's sweep so the PeriodicWave only
 *  rebuilds on a coarse step. */
export function shapePulseDuty(oscCtrl: number): number {
  const steps = 16
  const quantized = Math.round((oscCtrl / 127) * steps) / steps
  return 0.05 + quantized * 0.45
}

export function shapePulseWave(context: AudioContextLike, oscCtrl: number): PeriodicWaveLike {
  return pulseWave(context, shapePulseDuty(oscCtrl))
}

/** Shape Sine's quantized wavefold amount (0..1) — the curve is rebuilt only
 *  on this coarse step (Sync/Shape-Pulse quantization convention); the LIVE
 *  Osc Ctrl sweep is a separate pre-shaper drive gain (see synthFoldDriveGain). */
function shapeFoldStep(oscCtrl: number): number {
  const steps = 16
  return Math.round((oscCtrl / 127) * steps) / steps
}

/** Builds a wavefolding WaveShaper curve for a quantized fold step k (0..1):
 *  f(x) = sin(x * (1 + k*3) * PI/2), folding the sine back on itself as k
 *  rises (spec-described "Shape Sine" fold recipe). */
const foldCurveCache = new Map<number, Float32Array>()

export function shapeFoldCurve(oscCtrl: number): Float32Array {
  const k = shapeFoldStep(oscCtrl)
  // 17 quantized fold steps; the 2048-float curve is a pure function of the
  // step and WaveShaper.curve assignment copies, so sharing is safe — and a
  // Shape Sine passage stops allocating one big array per key press.
  const cached = foldCurveCache.get(k)
  if (cached) return cached
  const curve = new Float32Array(2048)
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1
    curve[i] = Math.sin(x * (1 + k * 3) * (Math.PI / 2))
  }
  foldCurveCache.set(k, curve)
  return curve
}

/** Shape Sine's live pre-shaper drive gain (Osc Ctrl = fold amount, applied
 *  as a real audio-rate gain ahead of the fixed-per-step fold curve, so the
 *  sweep between quantized curve rebuilds is still live and audible). */
export function shapeFoldDriveGain(oscCtrl: number): number {
  return 0.4 + (oscCtrl / 127) * 2.6
}

const ORGAN_DRAWBAR_HARMONICS = [1, 2, 3, 4, 6, 8]
const ORGAN_DRAWBAR_LEVELS = [1, 0.5, 0.7, 0.45, 0.3, 0.22]

/** Wave Organ: a fixed digital PeriodicWave approximating a drawbar-style
 *  additive spectrum (16'/8'/5-1/3'/4'/2-2/3'/1' harmonic ratios), built
 *  once — Osc Ctrl has no effect for the Wave category (declared, spec-
 *  consistent with Pure's "No effect" rule). */
export function waveOrganWave(context: AudioContextLike): PeriodicWaveLike {
  return cachedWave(context, 'waveOrgan', () => {
    const real = new Float32Array(HARMONICS + 1)
    const imag = new Float32Array(HARMONICS + 1)
    for (let i = 0; i < ORGAN_DRAWBAR_HARMONICS.length; i++) {
      const n = ORGAN_DRAWBAR_HARMONICS[i]!
      if (n <= HARMONICS) imag[n] = ORGAN_DRAWBAR_LEVELS[i]!
    }
    return context.createPeriodicWave(real, imag)
  })
}

/** Wave Formant: a fixed digital PeriodicWave with a vowel-formant-like
 *  spectral bump (a broad mid-harmonic emphasis rather than a flat 1/n
 *  falloff), built once — Osc Ctrl has no effect (Wave category, like Pure). */
export function waveFormantWave(context: AudioContextLike): PeriodicWaveLike {
  return cachedWave(context, 'waveFormant', () => {
    const real = new Float32Array(HARMONICS + 1)
    const imag = new Float32Array(HARMONICS + 1)
    const center = 7
    const width = 2.4
    for (let n = 1; n <= HARMONICS; n++) {
      const bump = Math.exp(-((n - center) ** 2) / (2 * width * width))
      imag[n] = (1 / n) * (0.25 + 1.6 * bump)
    }
    return context.createPeriodicWave(real, imag)
  })
}
