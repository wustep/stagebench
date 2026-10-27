/**
 * The Synth engine's oscillators.
 *
 * Phase 3 implements Analog mode only, with the exact waveform list from
 * `specs/nord-stage-4.synth.json`. Each category is a genuinely different synthesis
 * technique, not one oscillator with five names:
 *
 *  - **Pure** — a single oscillator with a selectable classic shape. Osc Ctrl has *no
 *    effect*, exactly as the spec says (manual p. 29).
 *  - **Sync** — a hard-synced oscillator: the slave runs at a multiple of the master and
 *    is reset every master cycle. Osc Ctrl sets the slave's relative pitch, so the
 *    spectrum gains upper harmonics rather than shifting pitch.
 *  - **Multi** — stacked detuned saws (the 8ve variant adds a second stack an octave
 *    below). Osc Ctrl sets the detune between them.
 *  - **Super** — a wide stack of seven saws (or squares) with spread panning. Osc Ctrl
 *    sets both detune and stereo width.
 *  - **FM-H** — a two-operator FM algorithm. Osc Ctrl is the modulation index.
 *
 * Every generator here works on plain `Float32Array` sample data, so the identical code
 * renders in the browser, in Node tests and in the evidence harness.
 */
import { midiToFrequency } from './pianoModel'

export type OscCategory = 'Pure' | 'Sync' | 'Multi' | 'Super' | 'FM-H'

export const OSC_CATEGORIES: readonly OscCategory[] = ['Pure', 'Sync', 'Multi', 'Super', 'FM-H']

/** The exact required waveform list, in the order the panel lists them. */
export const WAVEFORMS_BY_CATEGORY: Record<OscCategory, readonly string[]> = {
  Pure: ['Sine', 'Triangle', 'Saw', 'Square', 'Pulse 33', 'Pulse 10', 'White Noise'],
  Sync: ['Sync Saw', 'Sync Square'],
  Multi: ['Multi Saw', 'Multi Saw 8ve'],
  Super: ['Super Saw', 'Super Square'],
  'FM-H': ['FM 2-op (algorithm A)'],
}

/** Every selectable waveform, category first, in panel order. */
export const ALL_WAVEFORMS: readonly { category: OscCategory; name: string }[] = OSC_CATEGORIES.flatMap(
  (category) => WAVEFORMS_BY_CATEGORY[category].map((name) => ({ category, name })),
)

export function categoryForWaveform(name: string): OscCategory {
  for (const category of OSC_CATEGORIES) {
    if (WAVEFORMS_BY_CATEGORY[category].includes(name)) return category
  }
  return 'Pure'
}

/** What Osc Ctrl does for each category (spec `oscCtrlByCategory`). */
export const OSC_CTRL_BEHAVIOUR: Record<OscCategory, string> = {
  Pure: 'No effect',
  Sync: 'Relative pitch of the synced oscillator',
  Multi: 'Detune amount between the stacked saws',
  Super: 'Detune/width of the oscillator stack',
  'FM-H': 'FM modulation amount',
}

/* ------------------------------------------------------------------ */
/* Classic shapes: one cycle of a band-limited-approximation table     */
/* ------------------------------------------------------------------ */

/**
 * A single-cycle table for the Pure shapes. Built from a fixed harmonic sum so the shape is
 * band-limited to a known number of partials; the generator scales the harmonic count to
 * the note so nothing aliases badly.
 */
export function shapeTable(shape: string, harmonics = 40): Float32Array {
  const size = 2048
  const table = new Float32Array(size)
  const duty = shape === 'Pulse 33' ? 0.33 : shape === 'Pulse 10' ? 0.1 : 0.5
  for (let n = 0; n < size; n += 1) {
    const phase = n / size
    let value = 0
    switch (shape) {
      case 'Sine':
        value = Math.sin(2 * Math.PI * phase)
        break
      case 'Triangle':
        for (let h = 1; h <= harmonics; h += 2) {
          value += (Math.sin(2 * Math.PI * h * phase) * 8) / (Math.PI * Math.PI * h * h) * (h % 4 === 1 ? 1 : -1)
        }
        break
      case 'Saw':
        for (let h = 1; h <= harmonics; h += 1) value += Math.sin(2 * Math.PI * h * phase) / h
        value *= 2 / Math.PI
        break
      case 'Square':
        for (let h = 1; h <= harmonics; h += 2) value += Math.sin(2 * Math.PI * h * phase) / h
        value *= 4 / Math.PI
        break
      case 'Pulse 33':
      case 'Pulse 10':
        // A rectangular wave with the given duty cycle, as a Fourier series.
        for (let h = 1; h <= harmonics; h += 1) {
          value += (Math.sin(2 * Math.PI * h * phase) * Math.sin(Math.PI * h * duty) * 2) / (Math.PI * h)
        }
        break
      default:
        value = Math.sin(2 * Math.PI * phase)
        break
    }
    table[n] = value
  }
  return table
}

/** Reads a table at a fractional phase, linearly. */
function readTable(table: Float32Array, phase: number): number {
  const size = table.length
  const position = phase * size
  const index = Math.floor(position)
  const frac = position - index
  const a = table[((index % size) + size) % size]
  const b = table[(((index + 1) % size) + size) % size]
  return a + (b - a) * frac
}

/* ------------------------------------------------------------------ */
/* Oscillator rendering                                               */
/* ------------------------------------------------------------------ */

export interface OscillatorOptions {
  waveform: string
  /** Sounding MIDI note (already transposed by layer octave, coarse and fine tune). */
  midi: number
  sampleRate: number
  /** Duration in seconds. */
  seconds: number
  /** Panel 0..10, meaning depends on the category. */
  oscCtrl: number
  /** Optional per-sample Osc Ctrl modulation from an envelope and/or LFO, added to oscCtrl. */
  oscCtrlMod?: Float32Array | null
  /** Pitch bend in semitones, applied to every source. */
  bendSemitones?: number
  /** Deterministic seed for the noise and S&H sources. */
  seed?: number
}

/**
 * Renders the oscillator stack as a stereo pair.
 *
 * Stereo matters because Super and Multi spread their stack across the image; the mono
 * fold-down is what a mono destination would hear.
 */
export function renderOscillator(options: OscillatorOptions): { left: Float32Array; right: Float32Array } {
  const { waveform, sampleRate, seconds } = options
  const category = categoryForWaveform(waveform)
  const frames = Math.max(1, Math.round(seconds * sampleRate))
  const left = new Float32Array(frames)
  const right = new Float32Array(frames)
  const baseFreq = midiToFrequency(options.midi + (options.bendSemitones ?? 0))
  const ctrl = Math.max(0, Math.min(10, options.oscCtrl))
  const ctrlAt = (i: number) =>
    Math.max(0, Math.min(10, ctrl + (options.oscCtrlMod ? options.oscCtrlMod[i] ?? 0 : 0)))

  switch (category) {
    case 'Pure':
      // Osc Ctrl has no effect here, by design (manual p. 29).
      renderPure(waveform, baseFreq, frames, sampleRate, left, right, options.seed ?? 1)
      break
    case 'Sync':
      renderSync(waveform, baseFreq, frames, sampleRate, left, right, options.oscCtrlMod ? ctrlAt : () => ctrl)
      break
    case 'Multi':
      renderMulti(waveform, baseFreq, frames, sampleRate, left, right, options.oscCtrlMod ? ctrlAt : () => ctrl)
      break
    case 'Super':
      renderSuper(waveform, baseFreq, frames, sampleRate, left, right, options.oscCtrlMod ? ctrlAt : () => ctrl)
      break
    case 'FM-H':
      renderFm(baseFreq, frames, sampleRate, left, right, options.oscCtrlMod ? ctrlAt : () => ctrl)
      break
  }
  return { left, right }
}

/** How many harmonics a shape may use before it would alias at `frequency`. */
function harmonicsFor(frequency: number, sampleRate: number, cap: number): number {
  return Math.max(1, Math.min(cap, Math.floor(sampleRate * 0.45 / Math.max(40, frequency))))
}

function renderPure(
  waveform: string,
  frequency: number,
  frames: number,
  sampleRate: number,
  left: Float32Array,
  right: Float32Array,
  seed: number,
): void {
  if (waveform === 'White Noise') {
    let state = seed >>> 0 || 1
    const rand = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state / 4294967296
    }
    for (let i = 0; i < frames; i += 1) {
      const value = (rand() * 2 - 1) * 0.5
      left[i] = value
      right[i] = value
    }
    return
  }
  const table = shapeTable(waveform, harmonicsFor(frequency, sampleRate, 48))
  const increment = frequency / sampleRate
  let phase = 0
  for (let i = 0; i < frames; i += 1) {
    const value = readTable(table, phase)
    left[i] = value
    right[i] = value
    phase += increment
    if (phase >= 1) phase -= 1
  }
}

/**
 * Hard sync: the slave oscillator runs at `baseFreq * ratio` and is reset to phase 0 on
 * every master cycle. Osc Ctrl raises the ratio, adding upper harmonics at constant pitch.
 */
function renderSync(
  waveform: string,
  frequency: number,
  frames: number,
  sampleRate: number,
  left: Float32Array,
  right: Float32Array,
  ctrlAt: (index: number) => number,
): void {
  const square = waveform === 'Sync Square'
  let masterPhase = 0
  let slavePhase = 0
  const masterInc = frequency / sampleRate
  for (let i = 0; i < frames; i += 1) {
    // Osc Ctrl maps to a slave ratio from 1x to about 8x, which is the audible sweep.
    const ratio = 1 + (ctrlAt(i) / 10) * 7
    const slaveInc = (frequency * ratio) / sampleRate
    const value = square ? (slavePhase < 0.5 ? 1 : -1) : 2 * slavePhase - 1
    left[i] = value * 0.6
    right[i] = value * 0.6
    slavePhase += slaveInc
    masterPhase += masterInc
    if (masterPhase >= 1) {
      masterPhase -= 1
      // The master cycle restarts the slave, which is what hard sync means.
      slavePhase = 0
    } else if (slavePhase >= 1) {
      slavePhase -= 1
    }
  }
}

/** How many saws the Multi model stacks. */
const MULTI_SAWS = 3
/** How many voices the Super model stacks per channel. */
const SUPER_VOICES = 7

/**
 * Multi: three (or, with the 8ve variant, six) detuned saws. Osc Ctrl is the detune.
 * The second stack sits an octave below, which is the difference between the two names.
 */
function renderMulti(
  waveform: string,
  frequency: number,
  frames: number,
  sampleRate: number,
  left: Float32Array,
  right: Float32Array,
  ctrlAt: (index: number) => number,
): void {
  const octaveStack = waveform === 'Multi Saw 8ve'
  const stackCount = octaveStack ? 2 : 1
  // One detune amount for the whole render keeps the stack coherent, but it is read at the
  // first sample from the modulation so an envelope sweep is still audible over time.
  const table = shapeTable('Saw', harmonicsFor(frequency, sampleRate, 24))
  const phases = new Float64Array(MULTI_SAWS * stackCount)
  const pans: number[] = []
  for (let i = 0; i < phases.length; i += 1) {
    phases[i] = (i * 0.317) % 1
    pans.push(phases.length === 1 ? 0 : (i / (phases.length - 1)) * 2 - 1)
  }
  for (let i = 0; i < frames; i += 1) {
    const detune = (ctrlAt(i) / 10) * 18 // up to 18 cents between the outer saws
    let l = 0
    let r = 0
    for (let v = 0; v < pans.length; v += 1) {
      const stack = Math.floor(v / MULTI_SAWS)
      const index = v % MULTI_SAWS
      const cents = (index - (MULTI_SAWS - 1) / 2) * detune
      const freq = frequency * Math.pow(2, cents / 1200) * (stack === 1 ? 0.5 : 1)
      const value = readTable(table, phases[v])
      const pan = pans[v] * 0.5
      l += value * (0.5 - pan * 0.5)
      r += value * (0.5 + pan * 0.5)
      phases[v] += freq / sampleRate
      if (phases[v] >= 1) phases[v] -= 1
    }
    const norm = 0.75 / Math.sqrt(pans.length)
    left[i] = l * norm
    right[i] = r * norm
  }
}

/**
 * Super: a wide seven-voice stack with spread panning. Osc Ctrl raises both the detune and
 * the stereo width, which is exactly what a supersaw's single control does.
 */
function renderSuper(
  waveform: string,
  frequency: number,
  frames: number,
  sampleRate: number,
  left: Float32Array,
  right: Float32Array,
  ctrlAt: (index: number) => number,
): void {
  const square = waveform === 'Super Square'
  const table = square ? shapeTable('Square', harmonicsFor(frequency, sampleRate, 18)) : shapeTable('Saw', harmonicsFor(frequency, sampleRate, 18))
  const phases = new Float64Array(SUPER_VOICES)
  const offsets: number[] = []
  for (let v = 0; v < SUPER_VOICES; v += 1) {
    phases[v] = (v * 0.2137) % 1
    offsets.push((v / (SUPER_VOICES - 1)) * 2 - 1)
  }
  for (let i = 0; i < frames; i += 1) {
    const control = ctrlAt(i) / 10
    const detune = control * 26 // up to 26 cents across the stack
    const width = 0.35 + control * 0.65
    let l = 0
    let r = 0
    for (let v = 0; v < SUPER_VOICES; v += 1) {
      const cents = offsets[v] * detune
      const freq = frequency * Math.pow(2, cents / 1200)
      const value = readTable(table, phases[v])
      const pan = offsets[v] * width
      l += value * (0.5 - pan * 0.5)
      r += value * (0.5 + pan * 0.5)
      phases[v] += freq / sampleRate
      if (phases[v] >= 1) phases[v] -= 1
    }
    const norm = 0.9 / Math.sqrt(SUPER_VOICES)
    left[i] = l * norm
    right[i] = r * norm
  }
}

/**
 * FM-H: the one required FM Harmonic algorithm, a 2-operator stack in algorithm A (a
 * modulator into a carrier). Osc Ctrl is the modulation index, so it adds sidebands and
 * brightness at constant pitch rather than transposing the note.
 */
function renderFm(
  frequency: number,
  frames: number,
  sampleRate: number,
  left: Float32Array,
  right: Float32Array,
  ctrlAt: (index: number) => number,
): void {
  let carrierPhase = 0
  let modulatorPhase = 0
  const carrierInc = frequency / sampleRate
  // A 1:1 ratio stack gives the classic FM timbre that sweeps from a sine to a metallic
  // spectrum as the index rises.
  const modulatorInc = (frequency * 2) / sampleRate
  for (let i = 0; i < frames; i += 1) {
    const index = (ctrlAt(i) / 10) * 6
    const modulation = Math.sin(2 * Math.PI * modulatorPhase) * index
    const value = Math.sin(2 * Math.PI * carrierPhase + modulation)
    left[i] = value * 0.7
    right[i] = value * 0.7
    carrierPhase += carrierInc
    if (carrierPhase >= 1) carrierPhase -= 1
    modulatorPhase += modulatorInc
    if (modulatorPhase >= 1) modulatorPhase -= 1
  }
}

/* ------------------------------------------------------------------ */
/* LFO                                                                */
/* ------------------------------------------------------------------ */

export type LfoWaveform = 'Triangle' | 'Saw down' | 'Saw up' | 'Square' | 'Sample & Hold'
export const LFO_WAVEFORMS: readonly LfoWaveform[] = ['Triangle', 'Saw down', 'Saw up', 'Square', 'Sample & Hold']
/** The panel's printed order for `synth.lfo.waveform`. */
export const LFO_PANEL_ORDER: readonly LfoWaveform[] = ['Triangle', 'Saw down', 'Saw up', 'Square', 'Sample & Hold']

export type LfoDestination = 'Osc Pitch' | 'Osc Ctrl' | 'Filter Freq'
export const LFO_DESTINATIONS: readonly LfoDestination[] = ['Osc Pitch', 'Osc Ctrl', 'Filter Freq']

/**
 * Evaluates an LFO over `frames`. Returns values in -1..1, so a caller scales by the
 * destination's depth. Sample & Hold steps once per LFO cycle, deterministically seeded.
 */
export function renderLfo(
  waveform: LfoWaveform,
  rateHz: number,
  frames: number,
  sampleRate: number,
  seed = 1,
): Float32Array {
  const out = new Float32Array(frames)
  const increment = Math.max(0, rateHz) / sampleRate
  let phase = 0
  let state = seed >>> 0 || 1
  const rand = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
  let held = rand() * 2 - 1
  for (let i = 0; i < frames; i += 1) {
    let value = 0
    switch (waveform) {
      case 'Triangle':
        value = 4 * Math.abs(phase - 0.5) - 1
        break
      case 'Saw down':
        value = 1 - 2 * phase
        break
      case 'Saw up':
        value = 2 * phase - 1
        break
      case 'Square':
        value = phase < 0.5 ? 1 : -1
        break
      case 'Sample & Hold':
        value = held
        break
    }
    out[i] = value
    phase += increment
    if (phase >= 1) {
      phase -= 1
      // Sample & Hold picks a new value once each cycle.
      held = rand() * 2 - 1
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Envelopes                                                          */
/* ------------------------------------------------------------------ */

export type EnvelopeTarget = 'osc' | 'filter' | 'amp'

export interface EnvelopeSettings {
  /** Seconds. */
  attack: number
  /** Seconds; at maximum this acts as sustain mode (manual p. 33). */
  decay: number
  /** Seconds. */
  release: number
  /** Velocity sensitivity 0..1; 0 = not velocity sensitive. */
  velocity: number
  /** Filter/oscillator envelope amount, bipolar -1..1 for the oscillator envelope. */
  amount: number
  /** True when decay is at maximum, which the manual calls sustain mode. */
  sustainMode: boolean
}

/** Maps a 0..10 panel time knob to seconds, exponentially (manual p. 33). */
export function envelopeTime(knob: number, fast = 0.004, slow = 6): number {
  const t = Math.min(10, Math.max(0, knob)) / 10
  return fast * Math.pow(slow / fast, t)
}

/** Attack/decay/release from the three shared panel dials. */
export function envelopeFromDials(attack: number, decay: number, release: number): EnvelopeSettings {
  return {
    attack: envelopeTime(attack, 0.002, 3),
    // Decay at maximum is sustain: the manual's "sustain mode".
    decay: decay >= 9.95 ? Number.POSITIVE_INFINITY : envelopeTime(decay, 0.03, 4),
    release: envelopeTime(release, 0.03, 5),
    velocity: 0,
    amount: 0,
    sustainMode: decay >= 9.95,
  }
}

export interface EnvelopeShape {
  /** Gain per sample, 1 = full level. */
  gain: Float32Array
  /** The release begins at this sample index. */
  releaseAt: number
}

/**
 * A one-shot AD/AR envelope for a held note. `holdSeconds` is how long the key is down;
 * the release curve fills the rest of the buffer. `sustainMode` holds at full level after
 * the attack instead of decaying.
 */
export function renderEnvelope(
  settings: EnvelopeSettings,
  holdSeconds: number,
  totalSeconds: number,
  sampleRate: number,
): Float32Array {
  const frames = Math.max(1, Math.round(totalSeconds * sampleRate))
  const out = new Float32Array(frames)
  const attackFrames = Math.max(1, Math.round(settings.attack * sampleRate))
  const decayFrames = settings.sustainMode
    ? Number.POSITIVE_INFINITY
    : Math.max(1, Math.round(settings.decay * sampleRate))
  const releaseAt = Math.min(frames, Math.round(holdSeconds * sampleRate))
  const releaseFrames = Math.max(1, Math.round(settings.release * sampleRate))
  // Decay falls from 1 towards the sustain floor, which for a one-shot AD envelope is the
  // small residual that keeps a held note audible until the key is released.
  const floor = settings.sustainMode ? 1 : 0.35
  for (let i = 0; i < frames; i += 1) {
    if (i < releaseAt) {
      if (i < attackFrames) {
        out[i] = i / attackFrames
      } else {
        const sinceAttack = i - attackFrames
        if (settings.sustainMode) {
          out[i] = 1
        } else {
          const progress = Math.min(1, sinceAttack / decayFrames)
          out[i] = 1 - (1 - floor) * progress
        }
      }
    } else {
      // The release runs from whatever level the envelope had reached.
      const held = out[Math.max(0, releaseAt - 1)]
      const progress = Math.min(1, (i - releaseAt) / releaseFrames)
      out[i] = held * Math.pow(1 - progress, 1.8)
    }
  }
  return out
}

/** Velocity scaling for a stage: 0 = ignore velocity, 1 = fully velocity sensitive. */
export function velocityGain(velocity: number, amount: number): number {
  if (amount <= 0) return 1
  return 1 - amount + amount * Math.min(1, Math.max(0, velocity))
}

/* ------------------------------------------------------------------ */
/* Filter                                                            */
/* ------------------------------------------------------------------ */

export type FilterType = 'LP12' | 'LP24' | 'HP' | 'BP'
export const FILTER_TYPES: readonly FilterType[] = ['LP12', 'LP24', 'HP', 'BP']
/** The panel's printed order for `synth.filter.type` is LP 12, LP 24, HP, BP. */
export const FILTER_PANEL_ORDER: readonly FilterType[] = ['LP12', 'LP24', 'HP', 'BP']

export type KeyTracking = 'Off' | '1/3' | '2/3' | '1'
export const KEY_TRACKING: readonly KeyTracking[] = ['Off', '1/3', '2/3', '1']

export interface FilterOptions {
  type: FilterType
  /** Cutoff in Hz after every modulation has been applied. */
  cutoffHz: number
  /** Resonance 0..1, mapped to Q inside. */
  resonance: number
  /** Drive 0..3, where 0 is the spec's "Off". */
  drive: number
  /** Pre-gain into a saturator, i.e. the drive amount. */
  sampleRate: number
}

/** Maps the Freq knob (0..10) to Hz exponentially, 40 Hz .. 14 kHz. */
export function cutoffHzFor(knob: number): number {
  const t = Math.min(10, Math.max(0, knob)) / 10
  return 40 * Math.pow(14000 / 40, t)
}

/** Keyboard tracking: how much the cutoff follows the note. */
export function trackedCutoff(baseHz: number, midi: number, tracking: KeyTracking): number {
  const ratio = tracking === 'Off' ? 0 : tracking === '1/3' ? 1 / 3 : tracking === '2/3' ? 2 / 3 : 1
  if (ratio === 0) return baseHz
  // C4 (60) is the reference: an octave up moves the cutoff by `ratio` octaves.
  const octaves = (midi - 60) / 12
  return baseHz * Math.pow(2, octaves * ratio)
}

export interface BiquadCoefficients {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

/** RBJ cookbook coefficients for the four required filter types. */
export function biquadFor(type: FilterType, cutoffHz: number, q: number, sampleRate: number): BiquadCoefficients {
  const nyquist = sampleRate / 2
  const freq = Math.min(nyquist * 0.98, Math.max(10, cutoffHz))
  const w0 = (2 * Math.PI * freq) / sampleRate
  const cos = Math.cos(w0)
  const sin = Math.sin(w0)
  const alpha = sin / (2 * Math.max(0.05, q))
  let b0 = 0
  let b1 = 0
  let b2 = 0
  const a0 = 1 + alpha
  switch (type) {
    case 'LP12':
      b0 = (1 - cos) / 2
      b1 = 1 - cos
      b2 = (1 - cos) / 2
      break
    case 'LP24':
      // Two cascaded 12 dB sections. Two identical resonant stages would double the peak,
      // so each stage takes its own Butterworth Q, scaled together by the Res knob: the
      // cascade is genuinely 24 dB/octave steeper than LP12.
      b0 = (1 - cos) / 2
      b1 = 1 - cos
      b2 = (1 - cos) / 2
      break
    case 'HP':
      b0 = (1 + cos) / 2
      b1 = -(1 + cos)
      b2 = (1 + cos) / 2
      break
    case 'BP':
      b0 = alpha
      b1 = 0
      b2 = -alpha
      break
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 }
}

/**
 * Applies a filter in place. LP24 is two cascaded 12 dB sections at a higher Q, which is
 * how a 4-pole low-pass is built from biquads and why it is audibly steeper than LP12.
 */
export function applyFilter(
  data: Float32Array,
  options: FilterOptions & { cutoffModulation?: Float32Array | null },
): void {
  const stages = options.type === 'LP24' ? 2 : 1
  const resonance = Math.min(1, Math.max(0, options.resonance))
  // A 4-pole low-pass is two cascaded 2-poles. Giving each stage the same high Q would
  // stack the resonant peak, so the stages use Butterworth Q (0.707) plus a share of the
  // resonance: the resulting slope is 24 dB/octave while the peak stays comparable to LP12.
  const stageQ =
    stages === 2 ? Math.sqrt(0.5 + resonance * 6) : 0.7 + resonance * 12
  for (let stage = 0; stage < stages; stage += 1) {
    // A per-sample cutoff array lets the filter envelope and LFO sweep the cutoff.
    if (options.cutoffModulation) {
      let x1 = 0
      let x2 = 0
      let y1 = 0
      let y2 = 0
      for (let i = 0; i < data.length; i += 1) {
        const coef = biquadFor(options.type, options.cutoffModulation[i] ?? options.cutoffHz, stageQ, options.sampleRate)
        const x = data[i]
        const y = coef.b0 * x + coef.b1 * x1 + coef.b2 * x2 - coef.a1 * y1 - coef.a2 * y2
        x2 = x1
        x1 = x
        y2 = y1
        y1 = y
        data[i] = y
      }
    } else {
      const coef = biquadFor(options.type, options.cutoffHz, stageQ, options.sampleRate)
      let x1 = 0
      let x2 = 0
      let y1 = 0
      let y2 = 0
      for (let i = 0; i < data.length; i += 1) {
        const x = data[i]
        const y = coef.b0 * x + coef.b1 * x1 + coef.b2 * x2 - coef.a1 * y1 - coef.a2 * y2
        x2 = x1
        x1 = x
        y2 = y1
        y1 = y
        data[i] = y
      }
    }
  }
  if (options.drive > 0) applyDrive(data, options.drive)
}

/**
 * Filter drive: the spec's levels Off/1/2/3. Each step pushes the signal harder into a
 * tanh non-linearity, which adds harmonics before the filter's own saturation.
 */
export function applyDrive(data: Float32Array, level: number): void {
  const amount = Math.min(3, Math.max(0, Math.round(level)))
  if (amount === 0) return
  const gain = 1 + amount * 2.2
  const norm = Math.tanh(gain)
  for (let i = 0; i < data.length; i += 1) {
    data[i] = Math.tanh(data[i] * gain) / norm
  }
}

/* ------------------------------------------------------------------ */
/* Voice modes                                                        */
/* ------------------------------------------------------------------ */

export type VoiceMode = 'Poly' | 'Mono' | 'Legato'
export const VOICE_MODES: readonly VoiceMode[] = ['Poly', 'Mono', 'Legato']
export type NotePriority = 'Off' | 'Low' | 'High'
export const NOTE_PRIORITIES: readonly NotePriority[] = ['Off', 'Low', 'High']

/**
 * Which note a mono/legato engine sounds when several are held. `Off` keeps the most
 * recent note; `Low` and `High` pick by pitch, and a released priority note hands back to
 * the next still-held one, which is the note-priority behaviour the manual describes.
 */
export function priorityNote(held: readonly { midi: number; order: number }[], priority: NotePriority): number | null {
  if (held.length === 0) return null
  if (priority === 'Low') return held.reduce((a, b) => (b.midi < a.midi ? b : a)).midi
  if (priority === 'High') return held.reduce((a, b) => (b.midi > a.midi ? b : a)).midi
  return held.reduce((a, b) => (b.order > a.order ? b : a)).midi
}

/** Constant-rate portamento: the time per semitone, not a fixed total time. */
export function glideTimeFor(knob: number): number {
  // 0 = off; 10 = about 0.35 s per octave of travel.
  return (Math.min(10, Math.max(0, knob)) / 10) * 0.35
}

/** The pitch path for a glide from `fromMidi` to `toMidi` over `frames`. */
export function glideCurve(fromMidi: number, toMidi: number, frames: number, seconds: number, sampleRate: number): Float32Array {
  const out = new Float32Array(frames)
  if (seconds <= 0 || frames === 0) {
    out.fill(toMidi)
    return out
  }
  const total = Math.max(1, Math.round(seconds * sampleRate))
  for (let i = 0; i < frames; i += 1) {
    const progress = Math.min(1, i / total)
    out[i] = fromMidi + (toMidi - fromMidi) * progress
  }
  return out
}

/** Unison levels Off/1/2/3 → number of stacked voices and their detune in cents. */
export const UNISON_VOICES: readonly number[] = [1, 2, 3, 4]
export const UNISON_CENTS: readonly number[] = [0, 6, 11, 19]

/** Vibrato modes; `Wheel` follows the mod wheel, `On` runs free. */
export type VibratoMode = 'On' | 'Wheel' | 'Delayed' | 'Aftertouch' | 'Pedal'
export const VIBRATO_MODES: readonly VibratoMode[] = ['On', 'Wheel', 'Delayed', 'Aftertouch', 'Pedal']
/** The panel prints WHL / DLY / ON / A.T.; Aftertouch is excluded, so it is unsupported. */
export const VIBRATO_PANEL_ORDER: readonly VibratoMode[] = ['Wheel', 'Delayed', 'On', 'Aftertouch']

export const VIBRATO_RATE_RANGE = [2, 8] as const
export const VIBRATO_AMOUNT_MAX_CENTS = 55

/* ------------------------------------------------------------------ */
/* Arpeggiator / Gate                                                 */
/* ------------------------------------------------------------------ */

export type ArpMode = 'Arp' | 'Poly' | 'Gate'
export const ARP_MODES: readonly ArpMode[] = ['Poly', 'Arp', 'Gate']
export type ArpDirection = 'Up' | 'Down' | 'Up/Down' | 'Random'
export const ARP_DIRECTIONS: readonly ArpDirection[] = ['Up', 'Down', 'Up/Down', 'Random']

/** Clock subdivisions when the arpeggiator is synced to the master clock (manual p. 36). */
export const ARP_SUBDIVISIONS: readonly { label: string; beats: number }[] = [
  { label: '1/2', beats: 2 },
  { label: '1/4', beats: 1 },
  { label: '1/4T', beats: 2 / 3 },
  { label: '1/8', beats: 0.5 },
  { label: '1/8T', beats: 1 / 3 },
  { label: '1/16', beats: 0.25 },
  { label: '1/16T', beats: 1 / 6 },
]

/** Maps the Rate knob (0..10) to a subdivision index, fastest at the top. */
export function subdivisionForRate(knob: number): number {
  const t = Math.min(10, Math.max(0, knob)) / 10
  return Math.min(ARP_SUBDIVISIONS.length - 1, Math.round((1 - t) * (ARP_SUBDIVISIONS.length - 1)))
}

/** Seconds per step for a rate knob and tempo. Unsynced rates are BPM-independent. */
export function stepSecondsFor(knob: number, tempo: number, synced: boolean): number {
  if (synced) {
    const subdivision = ARP_SUBDIVISIONS[subdivisionForRate(knob)]
    const beat = 60 / Math.max(1, tempo)
    return beat * subdivision.beats
  }
  // Unsynced: 30 ms .. 900 ms per step, exponential like the printed knob.
  const t = Math.min(10, Math.max(0, knob)) / 10
  return 0.9 * Math.pow(30 / 900, t)
}

export interface ArpStepPlan {
  /** Step start times in seconds from the note-on. */
  times: number[]
  /** The note each step sounds. */
  notes: number[]
}

/**
 * Builds the deterministic step sequence for a held note set. With a fixed clock and note
 * set the order and timing are fully determined, which is what the spec's `determinism`
 * requirement asks for and what the tests assert.
 */
export function planArp(options: {
  notes: readonly number[]
  direction: ArpDirection
  octaves: number
  stepSeconds: number
  totalSteps: number
  seed?: number
  gateFraction?: number
}): ArpStepPlan {
  const { notes, direction, octaves, stepSeconds, totalSteps } = options
  const times: number[] = []
  const played: number[] = []
  if (notes.length === 0 || totalSteps <= 0) return { times, notes: played }
  // The note pool is every held note, repeated up each octave.
  const sorted = Array.from(new Set(notes)).sort((a, b) => a - b)
  const pool: number[] = []
  for (let octave = 0; octave < Math.max(1, octaves); octave += 1) {
    for (const note of sorted) pool.push(note + octave * 12)
  }
  if (direction === 'Down') pool.reverse()
  // Up/Down walks up and back down without repeating the turning points.
  const sequence: number[] = []
  if (direction === 'Up/Down' && pool.length > 1) {
    sequence.push(...pool, ...pool.slice(1, -1).reverse())
  } else {
    sequence.push(...pool)
  }
  let state = (options.seed ?? 1) >>> 0 || 1
  const rand = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
  for (let step = 0; step < totalSteps; step += 1) {
    times.push(step * stepSeconds)
    if (direction === 'Random') {
      played.push(pool[Math.floor(rand() * pool.length)])
    } else {
      played.push(sequence[step % sequence.length])
    }
  }
  return { times, notes: played }
}

/**
 * The gate envelope: each step sounds for `gateFraction` of the step and is silent for the
 * rest. In Gate mode the Range knob becomes the hardness of this envelope, so a high value
 * is a square gate and a low value a soft, rounded one.
 */
export function gateEnvelope(stepSeconds: number, gateFraction: number, hardness: number, sampleRate: number): Float32Array {
  const frames = Math.max(2, Math.round(stepSeconds * sampleRate))
  const out = new Float32Array(frames)
  const open = Math.max(1, Math.round(frames * Math.min(1, Math.max(0.05, gateFraction))))
  const shape = Math.max(0.05, Math.min(1, hardness))
  for (let i = 0; i < frames; i += 1) {
    if (i >= open) {
      out[i] = 0
      continue
    }
    // `shape` near 1 is a hard gate; near 0 is a soft swell and fall.
    const rise = Math.min(1, i / Math.max(1, frames * (1 - shape) * 0.25))
    const fall = Math.min(1, (open - i) / Math.max(1, frames * (1 - shape) * 0.25))
    out[i] = Math.min(1, Math.min(rise, fall))
  }
  return out
}
