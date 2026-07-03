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
 */

const HARMONICS = 24

/** Fourier coefficients (bn) for a duty-cycle square wave, DC-free, used to
 *  build the Pulse 33/10 PeriodicWaves (duty 0..1, e.g. 0.33 or 0.10). */
function pulseWave(context: AudioContextLike, duty: number): PeriodicWaveLike {
  const real = new Float32Array(HARMONICS + 1)
  const imag = new Float32Array(HARMONICS + 1)
  for (let n = 1; n <= HARMONICS; n++) {
    imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty)
  }
  return context.createPeriodicWave(real, imag)
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
  const base = baseSyncSpectrum(square)
  const peak = syncPeakHarmonic(oscCtrl)
  const real = new Float32Array(HARMONICS + 1)
  const imag = new Float32Array(HARMONICS + 1)
  const width = 2.2
  for (let n = 1; n <= HARMONICS; n++) {
    const bump = Math.exp(-((n - peak) ** 2) / (2 * width * width))
    imag[n] = base[n]! * (0.35 + 2.2 * bump)
  }
  return context.createPeriodicWave(real, imag)
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
  return category !== 'Pure'
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
 *  carrier frequency so brightness sweeps audibly across the keyboard range. */
export function fmModulationIndex(oscCtrl: number, carrierFrequencyHz: number): number {
  return (oscCtrl / 127) * 8 * carrierFrequencyHz
}
