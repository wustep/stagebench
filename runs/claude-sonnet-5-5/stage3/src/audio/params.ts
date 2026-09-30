import type { KbTouch, Level3 } from '../engine/state'
import type { PianoType, Timbre } from './library/catalog'
import { clampVelocity, releaseSeconds } from './pianoDsp'

/** Pure control → signal mappings. Everything audible is derived here so tests can pin the relationships. */

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
export const dbToGain = (db: number): number => Math.pow(10, db / 20)

/** layer fader (0..1) → gain; the LED ladder shows the same position */
export const layerGain = (level: number): number => (level <= 0 ? 0 : Math.pow(clamp(level, 0, 1), 2))
/** Master Level knob (0..1) → gain, quadratic taper, 0 is silent */
export const masterGain = (level: number): number => (level <= 0 ? 0 : 1.15 * Math.pow(clamp(level, 0, 1), 2))

// --- keyboard touch and dynamic compression -------------------------------------------------------------
/** Heavy needs more force for the same loudness, Light needs less (manual p. 25). Returns a MIDI velocity 1..127. */
export function touchVelocity(kb: KbTouch, velocity: number): number {
  const x = clampVelocity(velocity) / 127
  const exponent = kb === 'Heavy' ? 1.45 : kb === 'Light' ? 0.68 : 1
  return clampVelocity(127 * Math.pow(x, exponent))
}

/** Dyn Comp raises soft strokes toward full level without touching the timbre layer choice. 1.0 at full velocity. */
export function dynCompGain(velocity: number, level: Level3): number {
  if (level === 0) return 1
  const x = clampVelocity(velocity) / 127
  return Math.min(2.4, Math.pow(x, -0.15 * level))
}

/**
 * Target loudness (RMS of the first half second) for a struck velocity. Every recorded sample is levelled to this curve,
 * so loudness follows one dynamic law for every model and layer boundaries are seamless; the recorded layer choice
 * supplies the timbre change.
 */
export function targetRms(velocity: number): number {
  const x = clampVelocity(velocity) / 127
  return 0.13 * (0.05 + 0.95 * Math.pow(x, 1.5))
}

/** gain that brings a recording with first-half-second RMS `sampleRms` to the target for `velocity` */
export function sampleGain(velocity: number, sampleRms: number): number {
  return clamp(targetRms(velocity) / Math.max(sampleRms, 1e-4), 0.02, 40)
}

// --- unison ---------------------------------------------------------------------------------------------
/** detune in cents applied up/down per side; 0 = unison off (single centred voice) */
export const UNISON_CENTS: readonly number[] = [0, 4, 10, 20]
export const UNISON_PAN: readonly number[] = [0, 0.35, 0.6, 0.9]
/** per-source gain so total power stays comparable when unison is on */
export const unisonGain = (level: Level3): number => (level === 0 ? 1 : 0.72)

// --- release ----------------------------------------------------------------------------------------------
const BASE_RELEASE: Record<PianoType, (note: number) => number> = {
  Grand: releaseSeconds,
  Upright: (n) => releaseSeconds(n) * 0.85,
  Electric: () => 0.3,
  Clav: () => 0.07,
  Digital: () => 0.32,
  Misc: () => 0.45,
}

/** damper release time of one note; Soft Release lengthens acoustic types and damps electric ones (manual p. 25) */
export function releaseTime(type: PianoType, note: number, softRelease: boolean): number {
  const base = BASE_RELEASE[type](note)
  if (!softRelease || type === 'Clav') return base
  return type === 'Electric' ? base * 0.45 : base * 2.4
}

// --- timbre -------------------------------------------------------------------------------------------------
export interface Band {
  type: 'lowshelf' | 'peaking' | 'highshelf'
  frequency: number
  gain: number
  q: number
}
export type TimbreBands = [Band, Band, Band]

export const FLAT_BANDS: TimbreBands = [
  { type: 'lowshelf', frequency: 180, gain: 0, q: 0.7 },
  { type: 'peaking', frequency: 1500, gain: 0, q: 0.8 },
  { type: 'highshelf', frequency: 4000, gain: 0, q: 0.7 },
]

export function timbreBands(timbre: Timbre): TimbreBands {
  switch (timbre) {
    case 'Soft':
      return [
        { type: 'lowshelf', frequency: 200, gain: 2.5, q: 0.7 },
        { type: 'peaking', frequency: 1500, gain: -1, q: 0.8 },
        { type: 'highshelf', frequency: 3000, gain: -9, q: 0.7 },
      ]
    case 'Mid':
      return [
        { type: 'lowshelf', frequency: 250, gain: -5, q: 0.7 },
        { type: 'peaking', frequency: 1400, gain: 4.5, q: 0.8 },
        { type: 'highshelf', frequency: 4000, gain: -6, q: 0.7 },
      ]
    case 'Bright':
      return [
        { type: 'lowshelf', frequency: 180, gain: -1, q: 0.7 },
        { type: 'peaking', frequency: 3000, gain: 2, q: 0.8 },
        { type: 'highshelf', frequency: 4500, gain: 8, q: 0.7 },
      ]
    case 'Dyno 1':
      return [
        { type: 'lowshelf', frequency: 150, gain: -2, q: 0.7 },
        { type: 'peaking', frequency: 3500, gain: 5.5, q: 1.2 },
        { type: 'highshelf', frequency: 6000, gain: 5, q: 0.7 },
      ]
    case 'Dyno 2':
      return [
        { type: 'lowshelf', frequency: 120, gain: 6, q: 0.7 },
        { type: 'peaking', frequency: 3500, gain: 5.5, q: 1.2 },
        { type: 'highshelf', frequency: 6000, gain: 5, q: 0.7 },
      ]
    default:
      return FLAT_BANDS
  }
}

// --- string resonance --------------------------------------------------------------------------------------
export interface ResonancePartner {
  note: number
  gain: number
}

/** intervals (semitones from the played key) at which another string shares a partial with it */
const SYMPATHETIC: ReadonlyArray<readonly [number, number]> = [
  [12, 0.07],
  [-12, 0.05],
  [19, 0.045],
  [24, 0.035],
  [-19, 0.03],
  [28, 0.02],
]

/**
 * Simulated sympathetic resonance. With the damper pedal down every string is free to ring, so the harmonic partners
 * of the played key all respond; otherwise only partners that are currently held or sustained do.
 */
export function resonancePartners(note: number, sounding: readonly number[], pedalDown: boolean, lo = 21, hi = 108): ResonancePartner[] {
  const out: ResonancePartner[] = []
  for (const [interval, gain] of SYMPATHETIC) {
    const partner = note + interval
    if (partner < lo || partner > hi) continue
    if (pedalDown) out.push({ note: partner, gain: gain * 1.25 })
    else if (sounding.includes(partner)) out.push({ note: partner, gain })
    if (out.length >= 4) break
  }
  return out
}

// --- delay mapping -------------------------------------------------------------------------------------------
export const DELAY_MIN_S = 0.06
export const DELAY_MAX_S = 1.2
export const delaySeconds = (tempo: number): number => DELAY_MIN_S * Math.pow(DELAY_MAX_S / DELAY_MIN_S, clamp(tempo, 0, 1))
export const tempoFromSeconds = (seconds: number): number => clamp(Math.log(clamp(seconds, DELAY_MIN_S, DELAY_MAX_S) / DELAY_MIN_S) / Math.log(DELAY_MAX_S / DELAY_MIN_S), 0, 1)

/** rate knobs → LFO frequency (Hz), exponential */
export const lfoHz = (rate: number, lo = 0.15, hi = 9): number => lo * Math.pow(hi / lo, clamp(rate, 0, 1))
/** EQ knob 0..1 → dB (−15..+15) */
export const eqDb = (v: number): number => -15 + 30 * clamp(v, 0, 1)
/** mid frequency knob → Hz (200..8000, exponential) */
export const midFreqHz = (v: number): number => 200 * Math.pow(40, clamp(v, 0, 1))
