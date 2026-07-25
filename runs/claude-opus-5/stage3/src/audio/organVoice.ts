/**
 * Organ tone generation, as pure functions.
 *
 * Everything here is arithmetic on the nine drawbar positions and the selected model: which
 * partials exist, at which ratio of the played frequency, with which oscillator shape and gain,
 * and how the note is enveloped. `organLayer.ts` turns the result into real audio nodes and
 * `organ*.test.ts` asserts both the arithmetic and the rendered signal.
 *
 * The four required engines are genuinely different generators, not one oscillator renamed:
 *
 * - **B3** — nine sine partials on the tonewheel footages, with per-wheel detune, tonewheel
 *   leakage, a percussion partial from one shared single-triggered envelope, and a key click.
 * - **Vox** — transistor divider tone: triangle flutes on the low ratios and sawtooth strings on
 *   the mixtures, plus a filtered/unfiltered mix drawbar pair. No click, no percussion.
 * - **Farf** — the printed register switches (a drawbar past half is "on"), voiced as square
 *   reeds and sawtooth strings at fixed levels. Deliberately buzzy and fixed-level.
 * - **Pipe 1** — pipe ranks with a slow attack, a noise "chiff" on the attack, and rank detune.
 *
 * The two documented reuse models are exactly that: `B3 Bass` is the B3 engine limited to the 16'
 * and 8' drawbars, and `Pipe 2` is Pipe 1 with a brighter principal registration (organ spec,
 * `models[].engine`).
 */

export type OrganModelId = 'b3' | 'vox' | 'farf' | 'pipe1' | 'pipe2' | 'b3bass'

export type VibChorusId = 'v1' | 'c1' | 'v2' | 'v3' | 'c2' | 'c3'

export const ORGAN_MODEL_IDS: readonly OrganModelId[] = ['b3', 'vox', 'farf', 'pipe1', 'pipe2', 'b3bass']

/** Printed order of the Vib/Chorus selector on the panel. */
export const VIB_CHORUS_IDS: readonly VibChorusId[] = ['v1', 'c1', 'v2', 'v3', 'c2', 'c3']

export interface OrganPartial {
  /** Frequency ratio against the played note. */
  readonly ratio: number
  readonly type: 'sine' | 'triangle' | 'sawtooth' | 'square'
  readonly gain: number
  /** Detune in cents, fixed per partial — tonewheel gearing / rank tuning, never random. */
  readonly detuneCents: number
}

export interface OrganVoiceShape {
  readonly partials: readonly OrganPartial[]
  /** Attack ramp in seconds. */
  readonly attack: number
  readonly release: number
  /** Key-click transient level, 0 when the model has none. */
  readonly click: number
  /** Pipe "chiff" noise level on the attack, 0 when the model has none. */
  readonly chiff: number
  /** Broadband tonewheel leakage level, 0 when the model has none. */
  readonly leakage: number
}

/** B3 footage ratios, in printed drawbar order (organ spec, `b3.drawbarFootages`). */
export const B3_RATIOS: readonly number[] = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8]

/** Fixed per-wheel detune, in cents. A tonewheel generator is geared, so this never changes. */
const B3_DETUNE: readonly number[] = [-1.4, 2.1, 0, 1.1, -2.4, 1.8, -3.2, 2.6, -1.9]

/** Vox Continental: flutes on the low ratios, strings on the mixtures, then the mix pair. */
const VOX_RATIOS: readonly number[] = [0.5, 1, 2, 3, 4, 6, 8, 4, 8]
const VOX_TYPES: readonly OrganPartial['type'][] = [
  'triangle',
  'triangle',
  'triangle',
  'sawtooth',
  'sawtooth',
  'sawtooth',
  'sawtooth',
  'sawtooth',
  'sawtooth',
]

/** Farfisa registers, in the order the upper legends are printed on the panel. */
const FARF_RATIOS: readonly number[] = [0.5, 0.5, 1, 1, 1, 1, 2, 2, 3]
const FARF_TYPES: readonly OrganPartial['type'][] = [
  'square',
  'sawtooth',
  'triangle',
  'square',
  'square',
  'sawtooth',
  'triangle',
  'sawtooth',
  'square',
]
/** Farfisa registers have fixed levels: the switch is on or off, it is not a level control. */
const FARF_LEVELS: readonly number[] = [0.5, 0.34, 0.62, 0.4, 0.34, 0.3, 0.4, 0.24, 0.2]

/** Pipe ranks, 16' down to 1'. */
const PIPE_RATIOS: readonly number[] = [0.5, 1, 1.5, 2, 3, 4, 5, 6, 8]
const PIPE_DETUNE: readonly number[] = [0, 3.4, -2.8, 4.1, -3.6, 5.2, -4.4, 6.1, -5.3]

/** Highest partial frequency the generator will produce before folding it back an octave. */
const FOLDBACK_HZ = 6200

/**
 * Drawbar taper. Position 0 is silent, 8 is full, and each step is roughly 3 dB — the same shape
 * the LED graph draws, so what you see is what you hear.
 */
export function drawbarGain(position: number): number {
  const clamped = Math.min(8, Math.max(0, position))
  if (clamped <= 0) return 0
  return Math.pow(clamped / 8, 1.55)
}

/** A Farfisa register is on once the drawbar is pulled past half (organ spec, `models[].drawbars`). */
export function farfRegisterOn(position: number): boolean {
  return position > 4
}

/** Drawbars the model actually reads. B3 Bass is the B3 engine limited to 16' and 8'. */
export function activeDrawbarIndexes(model: OrganModelId): readonly number[] {
  switch (model) {
    case 'b3bass':
      return [0, 2]
    case 'vox':
    case 'farf':
    case 'b3':
    case 'pipe1':
    case 'pipe2':
      return [0, 1, 2, 3, 4, 5, 6, 7, 8]
  }
}

function foldBack(ratio: number, frequency: number): number {
  let folded = ratio
  while (frequency * folded > FOLDBACK_HZ && folded > 1) folded /= 2
  return folded
}

/**
 * The partials a model produces for one note, given the nine drawbar positions.
 *
 * `frequency` is only used for foldback (a real tonewheel generator runs out of wheels at the top
 * and reuses lower ones), so the shape is otherwise pitch independent.
 *
 * Every drawbar the model reads produces a partial, including the ones that are fully in: their
 * gain is simply 0. That is what lets a sounding voice follow a drawbar being pulled, because the
 * oscillator already exists and only its gain has to move (organ spec, `drawbars.interaction`).
 */
export function organVoiceShape(
  model: OrganModelId,
  drawbars: readonly number[],
  frequency: number,
): OrganVoiceShape {
  const active = new Set(activeDrawbarIndexes(model))
  const partials: OrganPartial[] = []

  if (model === 'b3' || model === 'b3bass') {
    B3_RATIOS.forEach((ratio, index) => {
      if (!active.has(index)) return
      const gain = drawbarGain(drawbars[index] ?? 0)
      partials.push({
        ratio: foldBack(ratio, frequency),
        type: 'sine',
        gain: gain * 0.42,
        detuneCents: B3_DETUNE[index],
      })
    })
    return { partials, attack: 0.006, release: 0.05, click: 0.5, chiff: 0, leakage: 0.014 }
  }

  if (model === 'vox') {
    VOX_RATIOS.forEach((ratio, index) => {
      const gain = drawbarGain(drawbars[index] ?? 0)
      // Drawbars 8 and 9 are the filtered / unfiltered mix pair, so they are quieter colour
      // drawbars rather than another full-level rank (organ spec, Vox `drawbars`).
      const weight = index >= 7 ? 0.16 : 0.3
      partials.push({
        ratio: foldBack(ratio, frequency),
        type: VOX_TYPES[index],
        gain: gain * weight,
        detuneCents: index >= 7 ? 5.5 : 0,
      })
    })
    return { partials, attack: 0.012, release: 0.06, click: 0, chiff: 0, leakage: 0 }
  }

  if (model === 'farf') {
    FARF_RATIOS.forEach((ratio, index) => {
      partials.push({
        ratio: foldBack(ratio, frequency),
        type: FARF_TYPES[index],
        gain: farfRegisterOn(drawbars[index] ?? 0) ? FARF_LEVELS[index] * 0.42 : 0,
        detuneCents: 0,
      })
    })
    return { partials, attack: 0.004, release: 0.035, click: 0, chiff: 0, leakage: 0 }
  }

  // Pipe 1 and Pipe 2. Pipe 2 is the same engine with a brighter principal registration.
  const principal = model === 'pipe2'
  PIPE_RATIOS.forEach((ratio, index) => {
    const gain = drawbarGain(drawbars[index] ?? 0)
    const brightness = principal ? 0.24 + index * 0.05 : 0.36 - index * 0.022
    partials.push({
      ratio: foldBack(ratio, frequency),
      type: principal && index >= 4 ? 'triangle' : 'sine',
      gain: gain * Math.max(0.06, brightness),
      detuneCents: PIPE_DETUNE[index] * (principal ? 0.4 : 1),
    })
  })
  return { partials, attack: 0.055, release: 0.13, click: 0, chiff: principal ? 0.1 : 0.16, leakage: 0 }
}

/** Percussion is a B3-only feature (organ spec, `models[].extras`). */
export function modelHasPercussion(model: OrganModelId): boolean {
  return model === 'b3'
}

export interface PercussionSettings {
  readonly on: boolean
  /** Volume Soft: the quieter of the two printed percussion levels. */
  readonly soft: boolean
  /** Decay Fast: the shorter of the two printed decay times. */
  readonly fast: boolean
  /** Harmonic Third: the third harmonic (2 2/3') instead of the second (4'). */
  readonly third: boolean
}

export interface PercussionShape {
  readonly ratio: number
  readonly gain: number
  readonly decay: number
}

/** Percussion partial: one decaying sine at the second or third harmonic (manual p. 20). */
export function percussionShape(settings: PercussionSettings): PercussionShape | null {
  if (!settings.on) return null
  return {
    ratio: settings.third ? 3 : 2,
    gain: settings.soft ? 0.16 : 0.34,
    decay: settings.fast ? 0.22 : 0.72,
  }
}

export interface VibChorusShape {
  /** Modulation depth in seconds of delay. */
  readonly depth: number
  readonly rate: number
  /** 0 for vibrato (modulated signal only), 0.5 for chorus (mixed with the original). */
  readonly dryMix: number
}

/**
 * Vibrato modulates pitch; chorus mixes the modulated signal back with the original, which is
 * what makes C1 and V1 audibly different rather than two names for one effect. Depth grows
 * across 1-2-3 (organ spec, `vibratoChorus.behavior`).
 */
export function vibChorusShape(id: VibChorusId): VibChorusShape {
  const stage = Number(id[1])
  const depth = [0, 0.0016, 0.0029, 0.0046][stage] ?? 0.0016
  const rate = [0, 6.1, 6.6, 7.2][stage] ?? 6.1
  return { depth, rate, dryMix: id[0] === 'c' ? 0.5 : 0 }
}

/** Vibrato and chorus are available on every model; only B3 has the per-layer on/off. */
export function vibChorusIsPerLayer(model: OrganModelId): boolean {
  return model === 'b3' || model === 'b3bass'
}
