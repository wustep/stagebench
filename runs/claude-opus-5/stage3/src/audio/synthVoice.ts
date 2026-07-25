/**
 * Synth tone generation and parameter mapping, as pure functions.
 *
 * The five required source categories are five genuinely different generators (synth spec,
 * `oscillator.requiredWaveforms`), and Osc Ctrl does the category-correct thing in each:
 *
 * | Category | Generator                                   | Osc Ctrl              |
 * | -------- | ------------------------------------------- | --------------------- |
 * | Pure     | one oscillator (pulse via a shaper, noise via a looped buffer) | nothing (manual p. 29) |
 * | Sync     | a single-cycle wavetable holding a hard-synced slave           | slave pitch ratio 1–8 |
 * | Multi    | three detuned sawtooths                                        | detune 0–40 cents     |
 * | Super    | seven detuned sawtooths or squares                             | spread 0–70 cents     |
 * | FM-H     | a 2-operator sine pair, modulator into carrier frequency        | FM index 0–8          |
 *
 * Hard sync cannot be built from a plain `OscillatorNode` (there is no phase reset), so Sync uses
 * a naive, deliberately non-band-limited wavetable generated at note-on and looped. That is a
 * declared approximation, not a hidden one — it is written up in IMPLEMENTATION_DETAILS.json.
 */

import type { ArpDirection, LfoWaveform, OscCategory, SynthFilterType } from './settings'

export const OSC_CATEGORIES: readonly OscCategory[] = ['pure', 'sync', 'multi', 'super', 'fmh']

export const CATEGORY_LABELS: Readonly<Record<OscCategory, string>> = {
  pure: 'Pure',
  sync: 'Sync',
  multi: 'Multi',
  super: 'Super',
  fmh: 'FM-H',
}

/** Exactly the list the synth spec requires, in order. */
export const WAVEFORMS: Readonly<Record<OscCategory, readonly string[]>> = {
  pure: ['Sine', 'Triangle', 'Saw', 'Square', 'Pulse 33', 'Pulse 10', 'White Noise'],
  sync: ['Sync Saw', 'Sync Square'],
  multi: ['Multi Saw', 'Multi Saw 8ve'],
  super: ['Super Saw', 'Super Square'],
  fmh: ['FM 2-op (algorithm A)'],
}

export function waveformName(category: OscCategory, index: number): string {
  const list = WAVEFORMS[category]
  return list[Math.min(list.length - 1, Math.max(0, Math.round(index)))]
}

export function waveformCount(category: OscCategory): number {
  return WAVEFORMS[category].length
}

/** What Osc Ctrl means for the selected category (synth spec, `oscCtrlByCategory`). */
export function oscCtrlLabel(category: OscCategory): string {
  switch (category) {
    case 'pure':
      return 'no effect'
    case 'sync':
      return 'sync pitch'
    case 'multi':
      return 'detune'
    case 'super':
      return 'spread'
    case 'fmh':
      return 'FM amount'
  }
}

export function oscCtrlValue(category: OscCategory, position: number): number {
  const p = Math.min(1, Math.max(0, position))
  switch (category) {
    case 'pure':
      return 0
    case 'sync':
      return 1 + p * 7
    case 'multi':
      return p * 40
    case 'super':
      return p * 70
    case 'fmh':
      return p * 8
  }
}

/* ------------------------------------------------------------------ wavetables */

/** Pitch the single-cycle tables are generated at; playback rate scales them to the played note. */
export const TABLE_BASE_HZ = 130.8127

/**
 * One master cycle of a hard-synced oscillator. The slave runs at `ratio` times the master and is
 * reset at the master boundary, which is exactly what looping one master period reproduces.
 */
export function fillSyncTable(out: Float32Array, kind: 'saw' | 'square', ratio: number): Float32Array {
  const length = out.length
  for (let i = 0; i < length; i += 1) {
    const slavePhase = ((i / length) * ratio) % 1
    out[i] = kind === 'saw' ? 2 * slavePhase - 1 : slavePhase < 0.5 ? 1 : -1
  }
  return out
}

/**
 * Deterministic white noise. Seeded so two renders of the same patch are identical; this is a
 * generated buffer, not a recording.
 */
export function fillNoise(out: Float32Array, seed = 0x9e3779b9): Float32Array {
  let state = seed >>> 0
  for (let i = 0; i < out.length; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0
    out[i] = (state / 0xffffffff) * 2 - 1
  }
  return out
}

/**
 * Transfer curve turning a sawtooth into a pulse of the given duty cycle, with the DC component
 * removed so the pulse widths differ in timbre rather than in offset.
 */
export function pulseCurve(duty: number, size = 1024): Float32Array {
  const curve = new Float32Array(size)
  const threshold = 2 * duty - 1
  const dc = 2 * duty - 1
  for (let i = 0; i < size; i += 1) {
    const x = (i / (size - 1)) * 2 - 1
    curve[i] = (x <= threshold ? 1 : -1) - dc
  }
  return curve
}

/* ------------------------------------------------------------------ envelopes */

/** Attack time in seconds, 0.5 ms to 3 s (manual p. 33). */
export function attackSeconds(position: number): number {
  return 0.0005 * Math.pow(6000, clamp01(position))
}

/** Decay time in seconds. At maximum the envelope holds instead of decaying (sustain mode). */
export function decaySeconds(position: number): number {
  return 0.008 * Math.pow(1500, clamp01(position))
}

export function releaseSeconds(position: number): number {
  return 0.004 * Math.pow(1500, clamp01(position))
}

/** Decay at maximum acts as sustain mode (synth spec, `envelopes.shared`). */
export function isSustainDecay(position: number): boolean {
  return position >= 0.995
}

/* ------------------------------------------------------------------ filter */

export function filterHz(position: number): number {
  return 22 * Math.pow(900, clamp01(position))
}

export function resonanceQ(position: number): number {
  return 0.7 + clamp01(position) * 13.3
}

/** Keyboard tracking positions Off, 1/3, 2/3, 1 (synth spec, `filter.keyboardTracking`). */
export const TRACKING_FACTORS: readonly number[] = [0, 1 / 3, 2 / 3, 1]

export function trackedCutoff(baseHz: number, midi: number, tracking: number): number {
  const factor = TRACKING_FACTORS[Math.min(3, Math.max(0, Math.round(tracking)))]
  return baseHz * Math.pow(2, ((midi - 60) / 12) * factor)
}

/** Biquad types behind the printed filter names. LP24 is two cascaded 12 dB sections. */
export function filterStages(type: SynthFilterType): readonly { type: string; role: 'main' | 'extra' }[] {
  switch (type) {
    case 'lp12':
      return [{ type: 'lowpass', role: 'main' }]
    case 'lp24':
      return [
        { type: 'lowpass', role: 'main' },
        { type: 'lowpass', role: 'extra' },
      ]
    // LP M is the ladder-style four-pole: both sections resonate, so it is not an LP24 clone.
    case 'lpm':
      return [
        { type: 'lowpass', role: 'main' },
        { type: 'lowpass', role: 'main' },
      ]
    case 'hp':
      return [{ type: 'highpass', role: 'main' }]
    case 'bp':
      return [{ type: 'bandpass', role: 'main' }]
    case 'lphp':
      return [
        { type: 'lowpass', role: 'main' },
        { type: 'highpass', role: 'extra' },
      ]
  }
}

/** Filter drive Off/1/2/3 (synth spec, `filter.driveLevels`). */
export function driveAmount(level: number): number {
  return [0, 2.5, 6, 13][Math.min(3, Math.max(0, Math.round(level)))]
}

/* ------------------------------------------------------------------ LFO */

export function lfoHz(position: number): number {
  return 0.05 * Math.pow(600, clamp01(position))
}

/** Master-clock subdivisions the LFO and the arpeggiator lock to, in beats. */
export const CLOCK_SUBDIVISIONS: readonly number[] = [4, 2, 1, 2 / 3, 0.5, 1 / 3, 0.25, 1 / 6]

export function syncedHz(bpm: number, position: number): number {
  const beats = CLOCK_SUBDIVISIONS[Math.min(
    CLOCK_SUBDIVISIONS.length - 1,
    Math.max(0, Math.round(clamp01(position) * (CLOCK_SUBDIVISIONS.length - 1))),
  )]
  return bpm / 60 / beats
}

/** Oscillator shape used for each LFO waveform; S&H is built from a stepped buffer instead. */
export function lfoOscillatorType(waveform: LfoWaveform): string {
  switch (waveform) {
    case 'triangle':
      return 'triangle'
    case 'sawdown':
    case 'sawup':
      return 'sawtooth'
    case 'square':
      return 'square'
    case 'sh':
      return 'sine'
  }
}

/** Saw down is the same ramp inverted, which is a negative depth rather than a second waveform. */
export function lfoPolarity(waveform: LfoWaveform): number {
  return waveform === 'sawdown' ? -1 : 1
}

/** One second of stepped random, for the Sample & Hold LFO. Seeded, so renders are reproducible. */
export function fillSampleHold(out: Float32Array, stepsPerSecond: number, sampleRate: number, seed = 0x5f3a): Float32Array {
  let state = seed >>> 0
  const stride = Math.max(1, Math.round(sampleRate / Math.max(0.001, stepsPerSecond)))
  let value = 0
  for (let i = 0; i < out.length; i += 1) {
    if (i % stride === 0) {
      state = (state * 1664525 + 1013904223) >>> 0
      value = (state / 0xffffffff) * 2 - 1
    }
    out[i] = value
  }
  return out
}

/* ------------------------------------------------------------------ voice + arpeggiator */

/** Glide time in seconds for a one-octave jump: constant rate portamento (manual p. 35). */
export function glideSecondsPerOctave(position: number): number {
  return clamp01(position) * 1.2
}

export function unisonVoices(level: number): number {
  return [1, 2, 3, 4][Math.min(3, Math.max(0, Math.round(level)))]
}

export function unisonSpreadCents(level: number): number {
  return [0, 6, 13, 22][Math.min(3, Math.max(0, Math.round(level)))]
}

/** Arpeggiator rate in steps per second, 30–300 BPM across the knob (manual p. 36). */
export function arpStepsPerSecond(position: number): number {
  return (30 + clamp01(position) * 270) / 60
}

/**
 * The step order for one arpeggiator cycle. Deterministic for a given note set, range and
 * direction — including Random, which is seeded from the note set rather than `Math.random`, so a
 * test can assert the exact sequence (synth spec, `arpeggiatorGate.determinism`).
 */
export function arpSteps(notes: readonly number[], range: number, direction: ArpDirection): number[] {
  const base = [...new Set(notes)].sort((a, b) => a - b)
  if (base.length === 0) return []
  const octaves = Math.min(4, Math.max(1, Math.round(range)))
  const expanded: number[] = []
  for (let octave = 0; octave < octaves; octave += 1) {
    for (const note of base) expanded.push(note + octave * 12)
  }
  switch (direction) {
    case 'up':
      return expanded
    case 'down':
      return [...expanded].reverse()
    case 'updown': {
      const down = [...expanded].reverse().slice(1, Math.max(1, expanded.length - 1))
      return [...expanded, ...down]
    }
    case 'random': {
      // Seeded Fisher-Yates: the same held notes always produce the same order.
      let state = (expanded.reduce((sum, note) => sum * 31 + note, 7) >>> 0) || 1
      const shuffled = [...expanded]
      for (let i = shuffled.length - 1; i > 0; i -= 1) {
        state = (state * 1664525 + 1013904223) >>> 0
        const j = state % (i + 1)
        ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
      }
      return shuffled
    }
  }
}

/** Gate mode repurposes the Range knob as gate-envelope hardness (manual p. 36). */
export function gateShape(range: number): { attack: number; hold: number } {
  const hardness = Math.min(4, Math.max(0, range)) / 4
  return { attack: 0.05 * (1 - hardness) + 0.002, hold: 0.35 + hardness * 0.3 }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
