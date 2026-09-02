/**
 * Shared DSP contract. Every unit is a pure-TypeScript stereo block processor that runs identically inside the
 * AudioWorklet (src/dsp/worklet.ts), on the main thread (ScriptProcessor fallback) and in tests (src/dsp/offline.ts).
 * No DOM, no Web Audio objects: only Float32Arrays and numbers.
 *
 * Parameter values are the *panel* values (knob 0..10, bipolar −15..15, selector index in panel option order) so the
 * UI → state → DSP path carries no hidden conversions; each unit maps them to physical units with the helpers below.
 */

export interface StereoProcessor {
  /** Processes `n` frames of `l` / `r` in place. */
  process(l: Float32Array, r: Float32Array, n: number): void
  /** Clears delay lines / filter memories without changing parameters. */
  reset(): void
}

/** Mod 1 types in panel option order (src/hardware/controls.ts `effects.mod1.type`). */
export const MOD1_TYPES = ['Ring Mod', 'Tremolo', 'A-Pan', 'A-Wah', 'Wah', 'Pump'] as const
/** Mod 2 types in panel option order. */
export const MOD2_TYPES = ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin'] as const
/** Delay feedback filter in panel option order. */
export const DELAY_FILTERS = ['Off', 'HP', 'BP', 'LP'] as const
/** Amp Sim / EQ model in panel option order (index 0 = no model: neutral EQ + tube drive). */
export const AMP_MODELS = ['EQ only', 'Small', 'JC', 'Twin', 'To Rotary', 'LP24 Filter', 'HP24 Filter'] as const
/** Reverb types in panel option order. */
export const REVERB_TYPES = ['Room', 'Booth', 'Spring', 'Stage', 'Hall', 'Cathedral'] as const
/** Reverb tone in panel option order. */
export const REVERB_TONES = ['Off', 'Bright', 'Dark'] as const
/** Piano timbre settings in panel option order; acoustic family uses the first four only. */
export const TIMBRE_SETTINGS = ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2'] as const

export interface TimbreParams {
  family: 'acoustic' | 'electric'
  /** Index into TIMBRE_SETTINGS (0 = Off). Acoustic ignores 4/5 (treated as Off). */
  setting: number
}

export interface StringResParams {
  on: boolean
  /** MIDI notes whose strings are currently undamped (held keys, or sounding notes while the pedal is down). */
  strings: number[]
  /** Sustain pedal down: all strings undamped → broader, longer resonance. */
  pedal: boolean
}

export interface Mod1Params {
  /** Index into MOD1_TYPES. */
  type: number
  /** Panel knob 0..10 (LFO rate; sine pitch for Ring Mod; sensitivity for A-Wah). */
  rate: number
  /** Panel knob 0..10. */
  amount: number
  /** Master Clock sync: when set, the LFO types run at this rate in Hz instead of the knob mapping (Phase 3). */
  rateHz?: number | null
}

export interface Mod2Params {
  /** Index into MOD2_TYPES. */
  type: number
  rate: number
  amount: number
}

export interface DelayParams {
  /** Delay time in seconds (already mapped from the Tempo knob or tap tempo). */
  seconds: number
  /** Panel knob 0..10. */
  feedback: number
  /** Panel knob 0..10; 0 = dry only, 10 = repeats only. */
  dryWet: number
  /** Index into DELAY_FILTERS; the filter sits inside the feedback loop so every repeat is filtered again. */
  filter: number
  /** Optional ping-pong: repeats alternate left / right. */
  pingPong: boolean
}

export interface AmpEqParams {
  /** Index into AMP_MODELS. */
  model: number
  /** Panel knob 0..10 (tube-style overdrive; amp drive when a model is selected). */
  drive: number
  /** −15..15 dB, 100 Hz low shelf. */
  bass: number
  /** −15..15: mid gain in dB for EQ / amp models, resonance for the LP24 / HP24 filters. */
  mid: number
  /** Panel knob 0..10 → 200 Hz..8 kHz (mid frequency, or filter cutoff for LP24 / HP24). */
  midFreq: number
  /** −15..15 dB, 4 kHz high shelf. */
  treble: number
}

export interface CompressorParams {
  /** Panel knob 0..10: higher = lower threshold, higher ratio, more make-up. 0 = no compression. */
  amount: number
  /** Fast attack / release; pumps at high amounts. */
  fast: boolean
}

export interface ReverbParams {
  /** Index into REVERB_TYPES. */
  type: number
  /** Panel knob 0..10; 10 = fully wet. */
  dryWet: number
  /** Index into REVERB_TONES. */
  tone: number
}

export interface RotaryParams {
  /** Fast rotor speed (Slow/Fast selector). Speed changes accelerate smoothly. */
  fast: boolean
  /** Panel knob 0..10 pre-amp overdrive. */
  drive: number
  /** Continuous speed 0 (slow) .. 1 (fast) for the rotary speed morph; when present it overrides `fast` (manual p. 53). */
  speed?: number
  /** STOP MODE: the Slow position brakes the rotors to a halt (manual p. 53). */
  stop?: boolean
}

export interface MasterParams {
  /** Master Level knob 0..10. */
  level: number
}

/** One layer's complete chain parameters (canonical state → DSP). */
export interface ChainParams {
  timbre: TimbreParams
  stringRes: StringResParams
  mod1: Mod1Params & { on: boolean }
  mod2: Mod2Params & { on: boolean }
  delay: DelayParams & { on: boolean }
  ampEq: AmpEqParams & { on: boolean }
  compressor: CompressorParams & { on: boolean }
  reverb: ReverbParams & { on: boolean }
  /** Layer Effects ON: false bypasses Mod 1 … Reverb at once (Timbre / String Res are piano-section features). */
  effectsOn: boolean
}

export function defaultChainParams(): ChainParams {
  return {
    timbre: { family: 'acoustic', setting: 0 },
    stringRes: { on: false, strings: [], pedal: false },
    mod1: { on: false, type: 5, rate: 4, amount: 5 },
    mod2: { on: false, type: 0, rate: 3, amount: 6 },
    delay: { on: false, seconds: tempoKnobToSeconds(5), feedback: 6, dryWet: 4, filter: 3, pingPong: false },
    ampEq: { on: false, model: 3, drive: 3, bass: 0, mid: 0, midFreq: 5, treble: 0 },
    compressor: { on: false, amount: 5, fast: false },
    reverb: { on: true, type: 5, dryWet: 6, tone: 0 },
    effectsOn: true,
  }
}

/* ---------- panel → physical mappings (single source of truth, also used by aria-valuetext) ---------- */

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Knob 0..10 → logarithmic range. */
export function knobLog(v: number, min: number, max: number): number {
  const t = clamp(v, 0, 10) / 10
  return min * Math.pow(max / min, t)
}

/** Knob 0..10 → linear 0..1. */
export const knob01 = (v: number) => clamp(v, 0, 10) / 10

/** LFO rate knob → Hz (0.1 Hz .. 10 Hz). */
export const lfoKnobToHz = (v: number) => knobLog(v, 0.1, 10)

/** Ring modulator rate knob → carrier Hz (20 Hz .. 2 kHz). */
export const ringModKnobToHz = (v: number) => knobLog(v, 20, 2000)

/** Delay tempo knob → seconds (1.5 s at 0, 20 ms at 10: clockwise = faster). */
export const tempoKnobToSeconds = (v: number) => knobLog(10 - clamp(v, 0, 10), 0.02, 1.5)

/** Inverse of tempoKnobToSeconds (tap tempo → knob position). */
export function secondsToTempoKnob(seconds: number): number {
  const s = clamp(seconds, 0.02, 1.5)
  const t = Math.log(s / 0.02) / Math.log(1.5 / 0.02)
  return clamp(10 - t * 10, 0, 10)
}

/** Delay feedback knob → loop gain (0 .. 0.9). */
export const feedbackKnobToGain = (v: number) => 0.9 * knob01(v)

/** Mid frequency knob → Hz (200 .. 8000, matches the printed scale). */
export const midFreqKnobToHz = (v: number) => knobLog(v, 200, 8000)

/** Drive knob → linear pre-gain (0 dB .. +30 dB). */
export const driveKnobToGain = (v: number) => Math.pow(10, (30 * knob01(v)) / 20)

/** dB → linear. */
export const dbToGain = (db: number) => Math.pow(10, db / 20)

/** Master Level knob 0..10 → linear gain (audio taper: 10 → 0 dB, 7 → −4.6 dB, 0 → silence). */
export const masterKnobToGain = (v: number) => Math.pow(knob01(v), 1.5)

/** Layer level fader 0..100 → linear gain (same taper). */
export const faderToGain = (v: number) => Math.pow(clamp(v, 0, 100) / 100, 1.5)

/** Rotary drive knob → linear pre-gain (0 .. +24 dB). */
export const rotaryDriveKnobToGain = (v: number) => Math.pow(10, (24 * knob01(v)) / 20)
