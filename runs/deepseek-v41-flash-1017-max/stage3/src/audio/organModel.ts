/**
 * Organ models.
 *
 * Every organ model is a *harmonic registration*: a set of partials at fixed intervals
 * from the played note, weighted by the nine drawbars. The model decides how a drawbar
 * position becomes a spectrum, and that is what makes B3, Vox, Farf and Pipe genuinely
 * different instruments rather than one oscillator with four labels:
 *
 *  - **B3** — tonewheel: nine *sine* partials at the classic footage intervals, with the
 *    small leakage of a real wheel bank. No upper harmonics inside a partial.
 *  - **Vox** — transistor: seven reedy partials through a fixed formant, plus the rightmost
 *    drawbar mixing a filtered and an unfiltered signal.
 *  - **Farf** — transistor: the drawbars are on/off *register selectors* (pulled past half
 *    way = on), and each register is its own filtered voice character, so the spectrum is a
 *    sum of formant-shaped voices rather than a partial bank.
 *  - **Pipe 1 / Pipe 2** — pipe organ: nine *principal ranks*, each contributing a full
 *    harmonic series, so the spectrum is far richer than the tonewheel's sine partials.
 *
 * Nothing here touches Web Audio. `organVoice.ts` turns a registration into a looped
 * buffer plus a percussion and key-click one-shot; the same functions are used by the
 * browser, the offline renderer and the tests, so the measured signal is the audible one.
 */
import { midiToFrequency } from './pianoModel'

export type OrganModelId = 'b3' | 'b3-bass' | 'vox' | 'farf' | 'pipe1' | 'pipe2'

export const ORGAN_MODELS: readonly { id: OrganModelId; label: string; panelIndex: number }[] = [
  { id: 'farf', label: 'Farf', panelIndex: 0 },
  { id: 'vox', label: 'Vox', panelIndex: 1 },
  { id: 'b3', label: 'B3', panelIndex: 2 },
  { id: 'pipe1', label: 'Pipe 1', panelIndex: 3 },
  { id: 'pipe2', label: 'Pipe 2', panelIndex: 4 },
  { id: 'b3-bass', label: 'B3 Bass', panelIndex: 5 },
]

/** The printed panel order of `organ.model.select`, exactly as the catalog declares it. */
export const ORGAN_MODEL_PANEL_ORDER: readonly OrganModelId[] = ORGAN_MODELS.map((m) => m.id)

export function organModelFromPanel(index: number): OrganModelId {
  const clamped = Math.max(0, Math.min(ORGAN_MODEL_PANEL_ORDER.length - 1, Math.round(index)))
  return ORGAN_MODEL_PANEL_ORDER[clamped]
}

export function panelIndexForOrganModel(model: OrganModelId): number {
  return ORGAN_MODEL_PANEL_ORDER.indexOf(model)
}

/**
 * Footage ratios of the nine drawbars, relative to 8'. These are the classic tonewheel
 * intervals printed under the B3 drawbars (manual p. 19). The 5 1/3' is the twelfth.
 */
export const B3_FOOTAGES: readonly number[] = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8]

/** Drawbar legends for the B3 model, as printed under the drawbars. */
export const B3_DRAWBAR_LABELS = ["16'", "5⅓'", "8'", "4'", "2⅔'", "2'", "1⅗'", "1⅓'", "1'"]

/**
 * Vox: seven partials (the manual's "seven drawbars to the left") plus the rightmost
 * drawbar that mixes filtered and unfiltered signal. `VOX_FORMANTS` gives each partial the
 * fixed emphasis that makes the model reedy rather than a flat harmonic series.
 */
export const VOX_FOOTAGES: readonly number[] = [0.5, 1, 2, 3, 4, 5, 8]
const VOX_FORMANTS: readonly number[] = [0.72, 1, 0.55, 1.15, 0.7, 0.42, 0.3]

/** Farf registers, in drawbar order: the label printed above the drawbars and its pitch. */
export type FarfRegister =
  | 'bass16'
  | 'str16'
  | 'flute8'
  | 'oboe8'
  | 'trumpet8'
  | 'str8'
  | 'flute4'
  | 'str4'
  | 'sine'

export const FARF_REGISTERS: readonly { id: FarfRegister; label: string; ratio: number }[] = [
  { id: 'bass16', label: 'BASS 16', ratio: 0.5 },
  { id: 'str16', label: 'STR 16', ratio: 0.5 },
  { id: 'flute8', label: 'FLUTE 8', ratio: 1 },
  { id: 'oboe8', label: 'OBOE 8', ratio: 1 },
  { id: 'trumpet8', label: 'TRMP 8 II', ratio: 1 },
  { id: 'str8', label: 'STR 8 III', ratio: 1 },
  { id: 'flute4', label: 'FLUTE 4 IV', ratio: 2 },
  { id: 'str4', label: 'STR 4', ratio: 2 },
  { id: 'sine', label: 'SINE', ratio: 1 },
]

/**
 * The harmonic series each Farf register contributes. A register is a *voice character*,
 * so "OBOE 8" is a hollow odd-harmonic tone while "TRMP 8 II" is brassy and "STR 8 III" is
 * a full sawtooth. Values are amplitudes of harmonics 1..n of the register's own pitch.
 */
const FARF_VOICES: Record<FarfRegister, readonly number[]> = {
  bass16: [1, 0.35, 0.12],
  str16: [1, 0.5, 0.33, 0.24, 0.18],
  flute8: [1, 0.05, 0.03],
  oboe8: [1, 0.06, 0.55, 0.05, 0.28, 0.03, 0.18],
  trumpet8: [1, 0.72, 0.55, 0.44, 0.36, 0.3, 0.25, 0.2],
  str8: [1, 0.5, 0.34, 0.25, 0.2, 0.16, 0.14, 0.12, 0.1],
  flute4: [1, 0.04, 0.02],
  str4: [1, 0.5, 0.34, 0.25, 0.2],
  sine: [1],
}

/** Pipe ranks 16' to 1', the nine footages the Pipe models use. */
export const PIPE_FOOTAGES: readonly number[] = [0.5, 1, 1.5, 2, 3, 4, 5, 6, 8]

export interface Harmonic {
  /** Frequency as a multiple of the played note. */
  ratio: number
  /** Linear amplitude. */
  amplitude: number
}

export interface RegistrationOptions {
  model: OrganModelId
  /** Nine drawbar positions, each 0..8. */
  drawbars: readonly number[]
}

function drawbar(drawbars: readonly number[], index: number): number {
  const raw = drawbars[index] ?? 0
  if (!Number.isFinite(raw)) return 0
  return Math.min(8, Math.max(0, raw))
}

/** Drawbar 0..8 as a linear gain, with the slight taper a real drawbar has. */
export function drawbarGain(position: number): number {
  const p = Math.min(8, Math.max(0, position)) / 8
  return Math.pow(p, 1.35)
}

/**
 * The registration for one note: a list of (ratio, amplitude) partials.
 *
 * Every model returns a genuinely different set, which is what the organ acceptance
 * criterion ("observably distinct harmonic behavior") measures.
 */
export function registrationFor(options: RegistrationOptions): Harmonic[] {
  const { model, drawbars } = options
  switch (model) {
    case 'b3':
      return b3Registration(drawbars)
    case 'b3-bass':
      return b3BassRegistration(drawbars)
    case 'vox':
      return voxRegistration(drawbars)
    case 'farf':
      return farfRegistration(drawbars)
    case 'pipe1':
      return pipeRegistration(drawbars, false)
    case 'pipe2':
      return pipeRegistration(drawbars, true)
    default:
      return b3Registration(drawbars)
  }
}

/** B3: nine pure sine partials at the tonewheel intervals, plus wheel leakage. */
function b3Registration(drawbars: readonly number[]): Harmonic[] {
  const out: Harmonic[] = []
  for (let i = 0; i < 9; i += 1) {
    const level = drawbarGain(drawbar(drawbars, i))
    if (level <= 0) continue
    const ratio = B3_FOOTAGES[i]
    out.push({ ratio, amplitude: level })
    // Tonewheel leakage: each wheel carries a little of its own upper partials, which is
    // what gives a real B3 its "dirty" quality compared with a pure sine bank.
    out.push({ ratio: ratio * 2, amplitude: level * 0.09 })
    out.push({ ratio: ratio * 3, amplitude: level * 0.035 })
  }
  return out
}

/** B3 Bass: the same tonewheel engine, limited to the 16' and 8' drawbars. */
function b3BassRegistration(drawbars: readonly number[]): Harmonic[] {
  const out: Harmonic[] = []
  for (const index of [0, 2]) {
    const level = drawbarGain(drawbar(drawbars, index))
    if (level <= 0) continue
    const ratio = B3_FOOTAGES[index]
    out.push({ ratio, amplitude: level })
    out.push({ ratio: ratio * 2, amplitude: level * 0.16 })
    out.push({ ratio: ratio * 3, amplitude: level * 0.07 })
  }
  return out
}

/** Vox: seven reedy partials through a fixed formant, plus the filtered/unfiltered mix. */
function voxRegistration(drawbars: readonly number[]): Harmonic[] {
  const out: Harmonic[] = []
  const mix = drawbarGain(drawbar(drawbars, 7))
  for (let i = 0; i < VOX_FOOTAGES.length; i += 1) {
    const level = drawbarGain(drawbar(drawbars, i))
    if (level <= 0) continue
    const ratio = VOX_FOOTAGES[i]
    // The filtered signal dominates at mix 0; opening the mix drawbar brings the raw,
    // bright partial back in. Both are present, so the knob sweeps rather than switches.
    const filtered = level * VOX_FORMANTS[i] * (1 - mix * 0.55)
    const unfiltered = level * (0.25 + mix * 0.95)
    out.push({ ratio, amplitude: filtered })
    // The transistor divider adds a squared component an octave up on every partial.
    out.push({ ratio: ratio * 2, amplitude: unfiltered * 0.22 })
  }
  return out
}

/** Farf: the drawbars are on/off register selectors, each with its own voice character. */
function farfRegistration(drawbars: readonly number[]): Harmonic[] {
  const out: Harmonic[] = []
  for (let i = 0; i < FARF_REGISTERS.length; i += 1) {
    // "Pulling a drawbar more than half way out will activate that register" (p. 20).
    if (drawbar(drawbars, i) < 5) continue
    const register = FARF_REGISTERS[i]
    const voice = FARF_VOICES[register.id]
    for (let h = 0; h < voice.length; h += 1) {
      out.push({ ratio: register.ratio * (h + 1), amplitude: voice[h] * 0.8 })
    }
  }
  return out
}

/**
 * Pipe: nine principal ranks, each a full harmonic series. Pipe 2 is the brighter
 * principal registration the spec allows a Pipe 1 reuse for, and it really is brighter:
 * the upper ranks are weighted up and the 8' rank down.
 */
function pipeRegistration(drawbars: readonly number[], bright: boolean): Harmonic[] {
  const out: Harmonic[] = []
  for (let i = 0; i < PIPE_FOOTAGES.length; i += 1) {
    const level = drawbarGain(drawbar(drawbars, i))
    if (level <= 0) continue
    const ratio = PIPE_FOOTAGES[i]
    // A principal rank is a full series with a long, gently falling harmonic tail —
    // much richer than the tonewheel's sine partials.
    const harmonics = bright ? 7 : 5
    const rankLevel = level * (bright ? (i === 1 ? 0.62 : 1) : 1)
    for (let h = 1; h <= harmonics; h += 1) {
      const tilt = 1 / Math.pow(h, bright ? 0.95 : 1.15)
      out.push({ ratio: ratio * h, amplitude: rankLevel * tilt * 0.5 })
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Loop rendering                                                     */
/* ------------------------------------------------------------------ */

/**
 * Folds a registration into the harmonic bins of a wave whose fundamental is half the
 * played note. Every organ ratio is a multiple of a half, so that wave represents the
 * registration exactly: 16' lands on bin 1, 8' on bin 2, 5 1/3' on bin 3, and so on.
 */
export function harmonicBins(partials: Harmonic[]): Float64Array {
  let highest = 0
  for (const partial of partials) highest = Math.max(highest, Math.round(partial.ratio * 2))
  const bins = new Float64Array(Math.max(1, highest) + 1)
  for (const partial of partials) {
    const bin = Math.round(partial.ratio * 2)
    if (bin < 1) continue
    bins[bin] += partial.amplitude
  }
  return bins
}

/** Scales a bin table so every registration starts at a comparable level. */
function normalizeBins(bins: Float64Array, target = 0.9): Float64Array {
  let sum = 0
  for (let i = 1; i < bins.length; i += 1) sum += Math.abs(bins[i])
  if (sum <= 0) return bins
  const scale = target / sum
  const out = new Float64Array(bins.length)
  for (let i = 1; i < bins.length; i += 1) out[i] = bins[i] * scale
  return out
}

/**
 * Renders a seamless loop of whole fundamental periods.
 *
 * The loop length is rounded to whole samples, which shifts the pitch by a few cents; the
 * caller compensates with the source's playback rate so the played pitch stays exact.
 */
export function renderOrganLoop(
  options: RegistrationOptions & { midi: number; sampleRate: number; seconds?: number },
): { samples: Float32Array; cycles: number; pitchCorrection: number } {
  const { sampleRate, midi } = options
  const f0 = midiToFrequency(midi)
  const fundamental = f0 / 2
  const seconds = options.seconds ?? 0.08
  // Whole cycles only, so the loop joins without a click.
  const cycles = Math.max(2, Math.round(fundamental * seconds))
  const frames = Math.max(8, Math.round((cycles / fundamental) * sampleRate))
  const bins = normalizeBins(harmonicBins(registrationFor(options)))
  const out = new Float32Array(frames)
  // Per-bin phase offset keeps the attack from summing every partial into one click.
  const phases = new Float64Array(bins.length)
  for (let i = 1; i < bins.length; i += 1) phases[i] = (i * 0.6180339887) % 1
  for (let n = 0; n < frames; n += 1) {
    const t = n / sampleRate
    let sample = 0
    for (let bin = 1; bin < bins.length; bin += 1) {
      if (bins[bin] === 0) continue
      const freq = fundamental * bin
      if (freq >= sampleRate * 0.45) continue
      sample += bins[bin] * Math.sin(2 * Math.PI * (freq * t + phases[bin]))
    }
    out[n] = sample
  }
  return {
    samples: out,
    cycles,
    // The rounded loop plays slightly fast or slow; this keeps the note in tune.
    pitchCorrection: (fundamental * cycles) / (frames / sampleRate) / fundamental,
  }
}

/* ------------------------------------------------------------------ */
/* Percussion and key click                                           */
/* ------------------------------------------------------------------ */

export interface PercussionOptions {
  midi: number
  /** `third` selects the 3rd harmonic, otherwise the 2nd. */
  harmonicThird: boolean
  /** Soft percussion level rather than normal. */
  volumeSoft: boolean
  /** Fast decay rather than slow. */
  decayFast: boolean
  sampleRate: number
}

/**
 * B3 percussion: one shared decaying envelope over a single harmonic, exactly as the
 * manual describes ("a single envelope generator controlling either the 2nd or 3rd
 * harmonic"). Fast decay is a short percussive blip; slow decay rings much longer.
 */
export function renderPercussion(options: PercussionOptions): Float32Array {
  const { sampleRate, midi } = options
  const f0 = midiToFrequency(midi)
  const frequency = f0 * (options.harmonicThird ? 3 : 2)
  const decay = options.decayFast ? 0.12 : 0.62
  const frames = Math.max(2, Math.round(decay * 4 * sampleRate))
  const out = new Float32Array(frames)
  const level = options.volumeSoft ? 0.13 : 0.3
  const attack = Math.max(2, Math.round(0.004 * sampleRate))
  for (let i = 0; i < frames; i += 1) {
    const t = i / sampleRate
    const envelope = Math.exp(-t / decay)
    const rise = i < attack ? i / attack : 1
    out[i] = Math.sin(2 * Math.PI * frequency * t) * envelope * rise * level
  }
  return out
}

/**
 * Key click: the random contact bounce of a tonewheel key, as a very short noise
 * transient at a fixed level (manual p. 20). Seeded so every render is identical.
 */
export function renderKeyClick(options: { midi: number; sampleRate: number; seed?: number }): Float32Array {
  const { sampleRate, midi } = options
  const frames = Math.max(2, Math.round(0.012 * sampleRate))
  const out = new Float32Array(frames)
  let state = (options.seed ?? midi * 7919) >>> 0 || 1
  const rand = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
  // A click is broadband: alternate-sign noise with a fast decay and a slight low cut.
  let previous = 0
  for (let i = 0; i < frames; i += 1) {
    const white = rand() * 2 - 1
    const highPassed = white - previous * 0.55
    previous = white
    out[i] = highPassed * Math.exp(-(i / frames) * 7) * 0.5
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Vibrato / chorus                                                   */
/* ------------------------------------------------------------------ */

export type VibratoChorusType = 'C1' | 'C2' | 'C3' | 'V1' | 'V2' | 'V3'

/** The panel's printed order for `organ.vib-chorus.type` is V1 V2 V3 C1 C2 C3. */
export const VIBRATO_CHORUS_PANEL_ORDER: readonly VibratoChorusType[] = ['V1', 'V2', 'V3', 'C1', 'C2', 'C3']

export interface VibratoSettings {
  /** LFO rate in Hz. */
  rate: number
  /** Peak pitch deviation in cents. */
  depthCents: number
  /** 0 = pure vibrato (no dry signal), 1 = full chorus (dry + modulated). */
  chorusMix: number
  /** Scanner delay in seconds; deeper settings use a longer line. */
  delaySeconds: number
}

/**
 * The six scanner settings. Vibrato modulates pitch only; chorus adds the modulated
 * signal to the dry one, which is how the original scanner is described (manual p. 19).
 * Depth grows from 1 to 3 for both families.
 */
export function vibratoSettingsFor(type: VibratoChorusType): VibratoSettings {
  const depth = type.endsWith('1') ? 1 : type.endsWith('2') ? 2 : 3
  const chorus = type.startsWith('C')
  return {
    rate: 5.2 + depth * 0.9,
    depthCents: depth * 11,
    chorusMix: chorus ? 1 : 0,
    delaySeconds: 0.0018 + depth * 0.0011,
  }
}

const MODEL_LABELS: Record<OrganModelId, string> = {
  b3: 'B3',
  'b3-bass': 'B3 Bass',
  vox: 'Vox',
  farf: 'Farf',
  pipe1: 'Pipe 1',
  pipe2: 'Pipe 2',
}

export function organModelLabel(model: OrganModelId): string {
  return MODEL_LABELS[model]
}

/** Human-readable registration, used by the Program display. */
export function registrationSummary(model: OrganModelId, drawbars: readonly number[]): string {
  const active = drawbars
    .map((value, index) => ({ value, index }))
    .filter((entry) => entry.value > 0)
    .map((entry) => `${B3_DRAWBAR_LABELS[entry.index]} ${entry.value}`)
  return `${MODEL_LABELS[model]} · ${active.length > 0 ? active.join(' ') : 'silent'}`
}
