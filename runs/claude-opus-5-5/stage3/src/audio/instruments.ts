// Piano library catalog and the performance-control curves (KB Touch, Dyn Comp, Timbre, Unison,
// Soft Release). Pure data + math so the engine and tests share one definition.

export const PIANO_TYPES = ['grand', 'upright', 'electric', 'clav', 'digital', 'misc'] as const
export type PianoType = (typeof PIANO_TYPES)[number]

export const TYPE_LABEL: Record<PianoType, string> = {
  grand: 'Grand',
  upright: 'Upright',
  electric: 'Electric',
  clav: 'Clav',
  digital: 'Digital',
  misc: 'Misc',
}

export type SamplePackId = 'grand' | 'upright' | 'electric' | 'electric-rhodes'
export type GeneratorId = 'digital-piano' | 'fm-epiano' | 'clavinet' | 'harpsichord' | 'marimba' | 'vibraphone'
export type TimbreFamily = 'acoustic' | 'electric'

export interface PianoModel {
  id: string
  type: PianoType
  name: string
  /** Recorded samples (bundled pack) or honest synthesis rendered in the browser. */
  source: { kind: 'recorded'; pack: SamplePackId } | { kind: 'generated'; generator: GeneratorId }
  timbre: TimbreFamily
  /** Soft Release is disabled for Clav-type sounds (manual p. 25). */
  softRelease: boolean
  /** Simulated sympathetic string resonance applies to acoustic string instruments only. */
  stringRes: boolean
  /** Normal key-up release time constant (s). */
  releaseTau: number
  /** Level trim so every model sits at a comparable loudness. */
  trim: number
}

export const PIANO_MODELS: readonly PianoModel[] = [
  { id: 'grand-salamander', type: 'grand', name: 'Salamander Grand', source: { kind: 'recorded', pack: 'grand' }, timbre: 'acoustic', softRelease: true, stringRes: true, releaseTau: 0.09, trim: 1 },
  { id: 'upright-recorded', type: 'upright', name: 'Upright KW', source: { kind: 'recorded', pack: 'upright' }, timbre: 'acoustic', softRelease: true, stringRes: true, releaseTau: 0.08, trim: 1 },
  { id: 'electric-recorded', type: 'electric', name: 'Wurlitzer EP200', source: { kind: 'recorded', pack: 'electric' }, timbre: 'electric', softRelease: true, stringRes: false, releaseTau: 0.07, trim: 1 },
  { id: 'electric-rhodes', type: 'electric', name: 'Rhodes (jRhodes3)', source: { kind: 'recorded', pack: 'electric-rhodes' }, timbre: 'electric', softRelease: true, stringRes: false, releaseTau: 0.08, trim: 1 },
  { id: 'clav-synth', type: 'clav', name: 'Clavinet (synth)', source: { kind: 'generated', generator: 'clavinet' }, timbre: 'acoustic', softRelease: false, stringRes: false, releaseTau: 0.035, trim: 0.9 },
  { id: 'harpsichord-synth', type: 'clav', name: 'Harpsichord (synth)', source: { kind: 'generated', generator: 'harpsichord' }, timbre: 'acoustic', softRelease: false, stringRes: false, releaseTau: 0.06, trim: 0.8 },
  { id: 'digital-piano', type: 'digital', name: 'Digital Piano (synth)', source: { kind: 'generated', generator: 'digital-piano' }, timbre: 'acoustic', softRelease: true, stringRes: false, releaseTau: 0.09, trim: 1 },
  { id: 'digital-fm', type: 'digital', name: 'FM E.Piano (synth)', source: { kind: 'generated', generator: 'fm-epiano' }, timbre: 'electric', softRelease: true, stringRes: false, releaseTau: 0.08, trim: 0.9 },
  { id: 'misc-marimba', type: 'misc', name: 'Marimba (synth)', source: { kind: 'generated', generator: 'marimba' }, timbre: 'acoustic', softRelease: true, stringRes: false, releaseTau: 0.12, trim: 0.9 },
  { id: 'misc-vibraphone', type: 'misc', name: 'Vibraphone (synth)', source: { kind: 'generated', generator: 'vibraphone' }, timbre: 'acoustic', softRelease: true, stringRes: false, releaseTau: 0.25, trim: 0.8 },
]

export function modelsOfType(type: PianoType): PianoModel[] {
  return PIANO_MODELS.filter((m) => m.type === type)
}

export function modelFor(type: PianoType, index: number): PianoModel {
  const list = modelsOfType(type)
  return list[Math.min(list.length - 1, Math.max(0, index))]
}

// ---- KB Touch: three velocity curves (manual p. 25) ----
export const KB_TOUCH = ['heavy', 'medium', 'light'] as const
export type KbTouch = (typeof KB_TOUCH)[number]
const TOUCH_EXPONENT: Record<KbTouch, number> = { heavy: 1.6, medium: 1, light: 0.6 }

/** Map a played velocity through the KB Touch curve. Heavy needs more force to play loudly. */
export function touchVelocity(velocity: number, touch: KbTouch): number {
  const v = Math.min(127, Math.max(1, velocity)) / 127
  return Math.min(127, Math.max(1, 127 * Math.pow(v, TOUCH_EXPONENT[touch])))
}

/** Amplitude for an (already touch-mapped) velocity, 0…1. */
export function velocityAmplitude(velocity: number): number {
  return Math.pow(Math.min(127, Math.max(1, velocity)) / 127, 1.7)
}

/**
 * Dyn Comp (Off/1/2/3): raises the level of softer strokes, narrowing dynamic range. It only scales
 * amplitude — sample layer and brightness still follow the touch velocity (manual p. 25).
 */
export function dynCompAmplitude(amplitude: number, level: number): number {
  if (level <= 0) return amplitude
  return Math.pow(amplitude, 1 - 0.22 * Math.min(3, level))
}

/** Voice low-pass cutoff: softer strokes are darker (used on top of the velocity layers). */
export function velocityBrightness(velocity: number, note: number): number {
  const v = Math.min(127, Math.max(1, velocity)) / 127
  return Math.min(16000, (1400 + 14000 * v * v) * Math.pow(2, (note - 60) / 36))
}

// ---- Timbre (manual p. 26) ----
export const TIMBRES = ['off', 'soft', 'mid', 'bright', 'dyno1', 'dyno2'] as const
export type Timbre = (typeof TIMBRES)[number]

export function timbresFor(family: TimbreFamily): Timbre[] {
  return family === 'electric' ? [...TIMBRES] : ['off', 'soft', 'mid', 'bright']
}

export interface TimbreEq {
  low: { freq: number; gain: number }
  mid: { freq: number; gain: number; q: number }
  high: { freq: number; gain: number }
}

const FLAT: TimbreEq = { low: { freq: 200, gain: 0 }, mid: { freq: 1000, gain: 0, q: 0.7 }, high: { freq: 3000, gain: 0 } }

/** Soft dampens highs and lifts lows; Mid scoops both ends for presence; Bright lifts treble; Dyno 1/2 are tine-preamp EQs. */
export const TIMBRE_EQ: Record<Timbre, TimbreEq> = {
  off: FLAT,
  soft: { low: { freq: 220, gain: 3 }, mid: { freq: 1200, gain: -2, q: 0.7 }, high: { freq: 2200, gain: -12 } },
  mid: { low: { freq: 250, gain: -6 }, mid: { freq: 1400, gain: 7, q: 0.8 }, high: { freq: 5000, gain: -6 } },
  bright: { low: { freq: 200, gain: -1 }, mid: { freq: 2500, gain: 2, q: 0.7 }, high: { freq: 3200, gain: 9 } },
  dyno1: { low: { freq: 120, gain: 4 }, mid: { freq: 600, gain: -5, q: 0.9 }, high: { freq: 3500, gain: 8 } },
  dyno2: { low: { freq: 150, gain: -3 }, mid: { freq: 3000, gain: 10, q: 1.2 }, high: { freq: 6000, gain: 6 } },
}

/** A timbre valid for the family; Dyno settings fall back to Off on acoustic families. */
export function effectiveTimbre(timbre: Timbre, family: TimbreFamily): Timbre {
  return timbresFor(family).includes(timbre) ? timbre : 'off'
}

// ---- Unison (manual p. 26): detuned stereo copies ----
export interface UnisonVoice {
  cents: number
  pan: number
  gain: number
}

export function unisonVoices(level: number): UnisonVoice[] {
  switch (level) {
    case 1:
      return [
        { cents: -5, pan: -0.35, gain: 0.72 },
        { cents: 5, pan: 0.35, gain: 0.72 },
      ]
    case 2:
      return [
        { cents: -11, pan: -0.7, gain: 0.72 },
        { cents: 11, pan: 0.7, gain: 0.72 },
      ]
    case 3:
      return [
        { cents: 0, pan: 0, gain: 0.55 },
        { cents: -22, pan: -1, gain: 0.55 },
        { cents: 22, pan: 1, gain: 0.55 },
      ]
    default:
      return [{ cents: 0, pan: 0, gain: 1 }]
  }
}

// ---- Soft Release (manual p. 25) ----
/** Key-up release: Soft Release makes it slightly longer and less pronounced (not for Clav). */
export function releaseShape(model: PianoModel, note: number, softRelease: boolean): { tau: number; level: number } {
  const base = note >= 89 && model.timbre === 'acoustic' && model.stringRes ? 0.3 : model.releaseTau
  if (softRelease && model.softRelease) return { tau: base * 3.2 + 0.12, level: 0.55 }
  return { tau: base, level: 1 }
}

export function midiToHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12)
}
