import { Biquad } from './effects'
import { OrganModel, VibType, type OrganLayerSound } from './params'

/**
 * One Organ layer. Every model is a bank of divide-down oscillators, one per semitone ("slot"),
 * shared by all the keys that need that pitch — the way tonewheels and top-octave dividers
 * work. A drawbar adds the slots of its footage, for every key held, to one of the model's
 * buses; what differs between the models is real:
 *
 *   B3      one bus of near-sine tonewheels with foldback, nine harmonic drawbars on the 3 dB
 *           law, key click, single-triggered percussion, and the scanner vibrato/chorus.
 *   Vox     every footage feeds two buses — a bright reed wave and a dark flute wave — and the
 *           last two drawbars mix those buses; three of the drawbars are mixtures.
 *   Farf    nine on/off register tabs (a drawbar past half is on), each a buzzy divider wave
 *           through its own voicing filter.
 *   Pipe    slow-speaking flute and principal ranks with a breath of chiff.
 *
 * B3 Bass reuses the B3 engine with only its 16' and 8' drawbars; Pipe 2 reuses the Pipe engine
 * with nine principal ranks. Both are labelled as such in the UI.
 *
 * Organs are not velocity sensitive; `gain` on a note is only the keyboard-zone crossfade.
 */

const TABLE_SIZE = 2048
const SLOTS = 128
const BANDS = 11
const TWO_PI = Math.PI * 2
const LEVEL = 0.055
const QUIET = 1e-5

type WaveName = 'tonewheel' | 'sine' | 'voxReed' | 'voxFlute' | 'farf' | 'pipeFlute' | 'pipePrincipal' | 'pipeBright'

/** Relative level of harmonic `h` (1-based) for each wave. */
const SPECTRA: Record<WaveName, (h: number) => number> = {
  sine: (h) => (h === 1 ? 1 : 0),
  // A tonewheel is nearly, not exactly, a sine.
  tonewheel: (h) => (h === 1 ? 1 : h === 2 ? 0.014 : h === 3 ? 0.009 : 0),
  voxReed: (h) => (h <= 40 ? 0.5 / h : 0),
  voxFlute: (h) => (h === 1 ? 1 : h === 2 ? 0.22 : h === 3 ? 0.07 : 0),
  // Divider square with some even harmonics left in: hollow and buzzy.
  farf: (h) => (h <= 48 ? (h % 2 === 1 ? 0.7 : 0.26) / h : 0),
  pipeFlute: (h) => [1, 0.1, 0.22, 0.02, 0.07, 0, 0.02][h - 1] ?? 0,
  pipePrincipal: (h) => (h <= 14 ? 0.8 / Math.pow(h, 1.55) : 0),
  pipeBright: (h) => (h <= 22 ? 0.7 / Math.pow(h, 1.15) : 0),
}

const tableCache = new Map<string, Float32Array[]>()

/** Band-limited single-cycle tables, one per octave band, cached per sample rate. */
function tablesFor(wave: WaveName, sampleRate: number): Float32Array[] {
  const key = `${wave}:${sampleRate}`
  const cached = tableCache.get(key)
  if (cached) return cached
  const spectrum = SPECTRA[wave]
  const tables: Float32Array[] = []
  for (let band = 0; band < BANDS; band += 1) {
    // Highest fundamental in this band: the B of the band's octave.
    const top = 440 * Math.pow(2, (band * 12 + 11 - 69) / 12)
    const limit = Math.max(1, Math.floor((sampleRate * 0.45) / top))
    const table = new Float32Array(TABLE_SIZE + 1)
    for (let h = 1; h <= Math.min(limit, 48); h += 1) {
      const level = spectrum(h)
      if (level === 0) continue
      for (let i = 0; i < TABLE_SIZE; i += 1) table[i] += level * Math.sin((TWO_PI * h * i) / TABLE_SIZE)
    }
    table[TABLE_SIZE] = table[0]
    tables.push(table)
  }
  tableCache.set(key, tables)
  return tables
}

interface Rank {
  bus: number
  /** Semitones above the key's 8' pitch. */
  semis: number
  gain: number
}

type DrawbarLaw = 'hammond' | 'linear' | 'switch'

interface ModelDef {
  /** Wave of each bus. */
  buses: readonly WaveName[]
  /** Ranks each of the nine drawbars adds. An empty list is a drawbar this model does not use. */
  drawbars: readonly (readonly Rank[])[]
  law: DrawbarLaw
  /** Seconds for a slot to speak and to stop. */
  attack: number
  release: number
  /** Lowest and highest oscillator pitch; anything outside folds back by octaves. */
  low: number
  high: number
  click: number
  chiff: number
  percussion: boolean
  /** How the vibrato/chorus selector acts: the B3 scanner, a plain vibrato, or pipe detuning. */
  vibrato: 'scanner' | 'vibrato' | 'detune'
}

const rank = (bus: number, semis: number, gain = 1): Rank => ({ bus, semis, gain })
const single = (bus: number, list: readonly number[]): Rank[][] => list.map((semis) => [rank(bus, semis)])

/** B3 drawbar footages as semitone offsets: 16', 5 1/3', 8', 4', 2 2/3', 2', 1 3/5', 1 1/3', 1'. */
export const B3_OFFSETS = [-12, 7, 0, 12, 19, 24, 28, 31, 36] as const

const both = (semis: number, gain = 1): Rank[] => [rank(0, semis, gain), rank(1, semis, gain)]

const MODELS: Record<number, ModelDef> = {
  [OrganModel.B3]: {
    buses: ['tonewheel', 'sine'],
    drawbars: single(0, B3_OFFSETS),
    law: 'hammond',
    attack: 0.0015,
    release: 0.004,
    low: 24,
    high: 114,
    click: 1,
    chiff: 0,
    percussion: true,
    vibrato: 'scanner',
  },
  [OrganModel.B3Bass]: {
    buses: ['tonewheel', 'sine'],
    // Bass drawbars: 16' and 8' only. The other seven have nothing to pull.
    drawbars: [[rank(0, -12, 1.3)], [rank(0, 0, 1.1)], [], [], [], [], [], [], []],
    law: 'hammond',
    attack: 0.004,
    release: 0.03,
    low: 24,
    high: 114,
    click: 0.6,
    chiff: 0,
    percussion: false,
    vibrato: 'scanner',
  },
  [OrganModel.Vox]: {
    buses: ['voxReed', 'voxFlute'],
    // 16', 8', 4', 2', then the mixtures II, III, IV. The last two drawbars are the mix of the
    // filtered (flute) and unfiltered (reed) signals and add no rank of their own.
    drawbars: [
      both(-12),
      both(0),
      both(12),
      both(24),
      [...both(7, 0.6), ...both(28, 0.6)],
      [...both(19, 0.5), ...both(24, 0.5), ...both(36, 0.5)],
      [...both(19, 0.42), ...both(24, 0.42), ...both(28, 0.42), ...both(36, 0.42)],
      [],
      [],
    ],
    law: 'linear',
    attack: 0.003,
    release: 0.006,
    low: 24,
    high: 120,
    click: 0,
    chiff: 0,
    percussion: false,
    vibrato: 'vibrato',
  },
  [OrganModel.Farf]: {
    buses: ['farf', 'farf', 'farf', 'farf', 'farf', 'farf', 'farf', 'farf', 'farf'],
    // Bass16, Str16, Flute8, Oboe8, Trmp8, Str8, Flute4, Str4, 2 2/3: one tab, one bus, one filter.
    drawbars: [-12, -12, 0, 0, 0, 0, 12, 12, 19].map((semis, bus) => [rank(bus, semis)]),
    law: 'switch',
    attack: 0.002,
    release: 0.005,
    low: 24,
    high: 120,
    click: 0,
    chiff: 0,
    percussion: false,
    vibrato: 'vibrato',
  },
  [OrganModel.Pipe1]: {
    buses: ['pipeFlute', 'pipePrincipal'],
    // Nine ranks, 16' to 1': flutes and principals alternate.
    drawbars: [
      [rank(0, -12)],
      [rank(0, 0)],
      [rank(1, 0, 0.8)],
      [rank(0, 12, 0.9)],
      [rank(1, 12, 0.7)],
      [rank(1, 19, 0.6)],
      [rank(1, 24, 0.6)],
      [rank(0, 31, 0.6)],
      [rank(1, 36, 0.5)],
    ],
    law: 'linear',
    attack: 0.04,
    release: 0.05,
    low: 12,
    high: 120,
    click: 0,
    chiff: 1,
    percussion: false,
    vibrato: 'detune',
  },
  [OrganModel.Pipe2]: {
    buses: ['pipeBright', 'pipePrincipal'],
    // Nine principal ranks, voiced brighter than Pipe 1.
    drawbars: [
      [rank(1, -12)],
      [rank(0, 0)],
      [rank(0, 12, 0.85)],
      [rank(0, 19, 0.7)],
      [rank(0, 24, 0.7)],
      [rank(1, 28, 0.6)],
      [rank(0, 31, 0.55)],
      [rank(0, 36, 0.5)],
      [rank(1, 40, 0.45)],
    ],
    law: 'linear',
    attack: 0.03,
    release: 0.045,
    low: 12,
    high: 120,
    click: 0,
    chiff: 0.7,
    percussion: false,
    vibrato: 'detune',
  },
}

/** Level of a drawbar at position 0..8 under each law. */
export function drawbarGain(law: DrawbarLaw, value: number): number {
  // Fractional positions happen while a morph is moving a drawbar between two settings.
  const v = Math.min(8, Math.max(0, value))
  if (law === 'switch') return v > 4 ? 1 : 0
  if (v < 0.01) return 0
  // Hammond: each step is about 3 dB, fading in over the first step. Linear: the Vox and pipe drawbars.
  return law === 'hammond' ? Math.pow(10, (-3 * (8 - v)) / 20) * Math.min(1, v) : v / 8
}

/** Farfisa tabs: voicing filter of each register. */
function voiceFarf(filter: Biquad, tab: number, sr: number): void {
  switch (tab) {
    case 0: // Bass 16
      return filter.lowpass(sr, 320, 0.8)
    case 1: // Strings 16
      return filter.highpass(sr, 1100, 0.9)
    case 2: // Flute 8
      return filter.lowpass(sr, 700, 0.8)
    case 3: // Oboe 8
      return filter.bandpass(sr, 1500, 2.2)
    case 4: // Trumpet 8
      return filter.lowpass(sr, 3200, 1.6)
    case 5: // Strings 8
      return filter.highpass(sr, 1900, 0.9)
    case 6: // Flute 4
      return filter.lowpass(sr, 1400, 0.8)
    case 7: // Strings 4
      return filter.highpass(sr, 2600, 0.9)
    default: // 2 2/3
      return filter.lowpass(sr, 5000, 0.8)
  }
}
const FARF_TAB_LEVEL = [1.5, 1.5, 1.2, 2.6, 1, 1.9, 1.2, 2.1, 1] as const

/** Scanner depths in milliseconds for settings 1, 2, 3. */
const SCANNER_DEPTH = [0.11, 0.24, 0.42] as const
const DETUNE_DEPTH = [0.5, 1.0, 1.8] as const

interface HeldKey {
  note: number
  gain: number
  /** Released while the pedal was down. */
  sustained: boolean
}

export class OrganVoices {
  readonly sampleRate: number
  /** Semitones added to every key (program transpose). */
  transpose = 0

  private layer: OrganLayerSound | null = null
  private model: ModelDef = MODELS[OrganModel.B3]
  private modelId: number = OrganModel.B3
  private vibType: number = VibType.C3
  private tables: Float32Array[][] = []
  private readonly amp = new Float32Array(10 * SLOTS)
  private readonly target = new Float32Array(10 * SLOTS)
  private readonly phase = new Float64Array(SLOTS)
  private readonly increment = new Float64Array(SLOTS)
  private readonly busBuffers: Float32Array[]
  private readonly out = new Float32Array(128)
  private readonly keys = new Map<number, HeldKey>()
  private pedal = false
  private sustainEnabled = false
  private bendRatio = 1
  private readonly filters: Biquad[]
  private percLevel = 0
  private percArmed = true
  private clickLevel = 0
  private clickLp = 0
  private chiffLevel = 0
  private chiffBand = new Biquad()
  private rng = 0x2f6e2b1
  private readonly scanner = new Float32Array(1024)
  private scanIndex = 0
  private scanPhase = 0
  private vibMix = 0
  private tail = 0

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate
    this.busBuffers = Array.from({ length: 10 }, () => new Float32Array(128))
    this.filters = Array.from({ length: 9 }, () => new Biquad())
    this.filters.forEach((filter, tab) => voiceFarf(filter, tab, sampleRate))
    this.chiffBand.bandpass(sampleRate, 2400, 1.2)
    for (let slot = 0; slot < SLOTS; slot += 1) {
      this.increment[slot] = (440 * Math.pow(2, (slot - 69) / 12)) / sampleRate
      // Fixed, spread-out starting phases: deterministic, and never all in step.
      this.phase[slot] = (slot * 0.6180339887) % 1
    }
    this.useModel(OrganModel.B3)
  }

  // ── State ───────────────────────────────────────────────────────────────────

  configure(layer: OrganLayerSound, vibType: number): void {
    const previous = this.layer
    this.layer = layer
    this.vibType = vibType
    if (layer.model !== this.modelId) this.useModel(layer.model)
    if (previous && previous.on && !layer.on) this.releaseAll()
    // A changed octave moves keys that are already down, as lifting and replaying them would.
    if (previous && previous.octave !== layer.octave) {
      for (const [key, held] of this.keys) held.note = this.noteFor(key)
    }
    this.retarget()
  }

  private useModel(id: number): void {
    this.modelId = id
    this.model = MODELS[id] ?? MODELS[OrganModel.B3]
    this.tables = this.model.buses.map((wave) => tablesFor(wave, this.sampleRate))
    this.target.fill(0)
    // Buses the new model does not have stop at once; the ones it shares fade to their new targets.
    this.amp.fill(0, this.model.buses.length * SLOTS)
    for (const filter of this.filters) filter.reset()
  }

  get modelName(): number {
    return this.modelId
  }

  private noteFor(key: number): number {
    return key + this.transpose + 12 * (this.layer?.octave ?? 0)
  }

  private fold(pitch: number): number {
    const { low, high } = this.model
    let p = pitch
    while (p > high) p -= 12
    while (p < low) p += 12
    return p
  }

  /** The percussion bus index: one past the model's own buses. */
  private get percBus(): number {
    return this.model.buses.length - 1
  }

  /** Recompute what every slot should be sounding from the keys held and the drawbars. */
  private retarget(): void {
    const { model, layer } = this
    const buses = model.buses.length
    const percBus = model.percussion ? this.percBus : -1
    // Percussion targets persist until the keys are all lifted; everything else is rebuilt.
    for (let bus = 0; bus < buses; bus += 1) {
      if (bus === percBus) continue
      this.target.fill(0, bus * SLOTS, (bus + 1) * SLOTS)
    }
    if (!layer) return
    for (const held of this.keys.values()) {
      for (let bar = 0; bar < 9; bar += 1) {
        const gain = drawbarGain(model.law, layer.drawbars[bar] ?? 0)
        if (gain === 0) continue
        for (const item of model.drawbars[bar]) {
          if (item.bus === percBus) continue
          this.target[item.bus * SLOTS + this.fold(held.note + item.semis)] += held.gain * gain * item.gain
        }
      }
    }
  }

  // ── Input ───────────────────────────────────────────────────────────────────

  noteOn(key: number, gain = 1): void {
    if (!this.layer?.on || !(gain > 0)) return
    const first = this.keys.size === 0
    const note = this.noteFor(key)
    this.keys.set(key, { note, gain, sustained: false })
    const { model, layer } = this
    if (model.click > 0) this.clickLevel = Math.min(1.6, this.clickLevel + model.click * gain)
    if (model.chiff > 0) this.chiffLevel = Math.min(1.5, this.chiffLevel + model.chiff * gain)
    if (model.percussion && layer.perc.on) {
      // Single-triggered: the envelope starts only on the first key after all keys were up, and
      // keys added while it is still dying away join it at whatever level it has reached.
      if (first && this.percArmed) {
        this.percLevel = 1
        this.percArmed = false
        this.target.fill(0, this.percBus * SLOTS, (this.percBus + 1) * SLOTS)
      }
      if (this.percLevel > 0.02) {
        const slot = this.fold(note + (layer.perc.third ? 19 : 12))
        this.target[this.percBus * SLOTS + slot] = Math.max(this.target[this.percBus * SLOTS + slot], gain)
      }
    }
    this.retarget()
  }

  noteOff(key: number): void {
    const held = this.keys.get(key)
    if (!held) return
    if (this.pedalActive) {
      held.sustained = true
      return
    }
    this.drop(key)
  }

  private drop(key: number): void {
    if (!this.keys.delete(key)) return
    if (this.model.click > 0) this.clickLevel = Math.min(1.6, this.clickLevel + this.model.click * 0.35)
    if (this.keys.size === 0) this.rearm()
    this.retarget()
  }

  private rearm(): void {
    this.percArmed = true
    if (this.model.percussion) this.target.fill(0, this.percBus * SLOTS, (this.percBus + 1) * SLOTS)
  }

  setPedal(down: boolean): void {
    if (this.pedal === down) return
    this.pedal = down
    this.pedalChanged()
  }

  setSustainEnabled(enabled: boolean): void {
    if (this.sustainEnabled === enabled) return
    this.sustainEnabled = enabled
    this.pedalChanged()
  }

  private pedalChanged(): void {
    if (this.pedalActive) return
    for (const [key, held] of Array.from(this.keys)) if (held.sustained) this.drop(key)
  }

  get pedalActive(): boolean {
    return this.pedal && this.sustainEnabled
  }

  setBend(semitones: number): void {
    this.bendRatio = Math.pow(2, semitones / 12)
  }

  /** Let every key go (layer or section switched off). */
  releaseAll(): void {
    if (this.keys.size === 0) return
    this.keys.clear()
    this.rearm()
    this.retarget()
  }

  /** Panic: keys, pedal, percussion, and click all stop at once. */
  allNotesOff(): void {
    this.pedal = false
    this.keys.clear()
    this.rearm()
    this.percLevel = 0
    this.clickLevel = 0
    this.chiffLevel = 0
    this.retarget()
  }

  // ── Inspection ──────────────────────────────────────────────────────────────

  /** Keys currently sounding, including ones the pedal is holding. */
  get keyCount(): number {
    return this.keys.size
  }

  heldKeys(): number[] {
    return [...this.keys.keys()].sort((a, b) => a - b)
  }

  /** True while the layer can still produce signal. */
  get busy(): boolean {
    return this.keys.size > 0 || this.tail > 0
  }

  /** Slots (oscillators) currently above silence, across all buses. */
  get activeSlots(): number {
    let count = 0
    const total = this.model.buses.length * SLOTS
    for (let i = 0; i < total; i += 1) if (this.amp[i] > QUIET) count += 1
    return count
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  /** Add this layer into `left`/`right` (at most 128 frames), scaled by `gain0`→`gain1` across the block. */
  render(left: Float32Array, right: Float32Array, frames: number, gain0: number, gain1: number): void {
    const { model, layer, sampleRate } = this
    if (!layer) return
    const buses = model.buses.length
    const attack = 1 - Math.exp(-frames / (model.attack * sampleRate))
    const release = 1 - Math.exp(-frames / (model.release * sampleRate))
    for (let bus = 0; bus < buses; bus += 1) this.busBuffers[bus].fill(0, 0, frames)
    let sounding = false

    for (let slot = 0; slot < SLOTS; slot += 1) {
      let any = false
      const inc = this.increment[slot] * this.bendRatio
      const band = Math.min(BANDS - 1, Math.max(0, Math.floor(slot / 12)))
      for (let bus = 0; bus < buses; bus += 1) {
        const at = bus * SLOTS + slot
        const a0 = this.amp[at]
        const goal = this.target[at]
        if (a0 < QUIET && goal < QUIET) {
          this.amp[at] = 0
          continue
        }
        let a1 = a0 + (goal - a0) * (goal > a0 ? attack : release)
        if (Math.abs(a1 - goal) < QUIET) a1 = goal
        const table = this.tables[bus][band]
        const buffer = this.busBuffers[bus]
        const step = (a1 - a0) / frames
        let phase = this.phase[slot]
        let level = a0
        for (let i = 0; i < frames; i += 1) {
          const position = phase * TABLE_SIZE
          const index = position | 0
          const value = table[index] + (table[index + 1] - table[index]) * (position - index)
          level += step
          buffer[i] += value * level
          phase += inc
          if (phase >= 1) phase -= 1
        }
        this.amp[at] = a1
        any = true
      }
      if (any) {
        sounding = true
        this.phase[slot] = (this.phase[slot] + inc * frames) % 1
      }
    }

    const out = this.out
    this.mix(out, frames)
    this.addTransients(out, frames)
    this.vibrato(out, frames)

    // Busy for as long as anything comes out: oscillators, a click, or the last of the scanner's delay.
    let loud = sounding
    for (let i = 0; i < frames && !loud; i += 1) if (out[i] > 1e-7 || out[i] < -1e-7) loud = true
    if (loud) this.tail = 6
    else if (this.tail > 0) this.tail -= 1

    const step = (gain1 - gain0) / frames
    let gain = gain0
    for (let i = 0; i < frames; i += 1) {
      gain += step
      const sample = out[i] * gain * LEVEL
      left[i] += sample
      right[i] += sample
    }
  }

  /** Combine the model's buses into one signal. */
  private mix(out: Float32Array, frames: number): void {
    const { model, layer, busBuffers } = this
    if (!layer) return
    out.fill(0, 0, frames)
    switch (this.modelId) {
      case OrganModel.Vox: {
        // Drawbar 8 is the filtered (flute) signal, drawbar 9 the unfiltered (reed) one.
        const flute = drawbarGain('linear', layer.drawbars[7] ?? 0)
        const reed = drawbarGain('linear', layer.drawbars[8] ?? 0)
        const a = busBuffers[0]
        const b = busBuffers[1]
        for (let i = 0; i < frames; i += 1) out[i] = a[i] * reed + b[i] * flute * 1.2
        break
      }
      case OrganModel.Farf: {
        for (let tab = 0; tab < 9; tab += 1) {
          const buffer = busBuffers[tab]
          const filter = this.filters[tab]
          const level = FARF_TAB_LEVEL[tab]
          let quiet = true
          for (let i = 0; i < frames; i += 1) {
            const value = filter.left(buffer[i])
            if (value > 1e-7 || value < -1e-7) quiet = false
            out[i] += value * level
          }
          if (quiet) filter.reset()
        }
        break
      }
      case OrganModel.B3:
      case OrganModel.B3Bass: {
        const tone = busBuffers[0]
        if (!model.percussion) {
          for (let i = 0; i < frames; i += 1) out[i] = tone[i]
          break
        }
        // The percussion bus decays with one shared envelope. Normal volume steals a little
        // level from the drawbars, as it does on the instrument.
        const perc = busBuffers[this.percBus]
        const on = layer.perc.on
        const decay = Math.exp(-1 / ((layer.perc.fast ? 0.085 : 0.3) * this.sampleRate))
        const percGain = !on ? 0 : layer.perc.soft ? 1.1 : 2.4
        const toneGain = on && !layer.perc.soft ? 0.75 : 1
        let level = this.percLevel
        for (let i = 0; i < frames; i += 1) {
          out[i] = tone[i] * toneGain + perc[i] * level * percGain
          level *= decay
        }
        this.percLevel = level < 1e-4 ? 0 : level
        break
      }
      default: {
        const a = busBuffers[0]
        const b = busBuffers[1]
        for (let i = 0; i < frames; i += 1) out[i] = a[i] + b[i]
      }
    }
  }

  private noise(): number {
    let state = this.rng
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    this.rng = state
    return (state | 0) / 2147483648
  }

  /** Key click (B3) and chiff (pipes): short noise transients on the attack. */
  private addTransients(out: Float32Array, frames: number): void {
    if (this.clickLevel > 1e-4) {
      // A few milliseconds of high-passed noise at a fixed level.
      const decay = Math.exp(-1 / (0.0025 * this.sampleRate))
      let level = this.clickLevel
      let lp = this.clickLp
      for (let i = 0; i < frames; i += 1) {
        const white = this.noise()
        lp += (white - lp) * 0.25
        out[i] += (white - lp) * level * 0.5
        level *= decay
      }
      this.clickLevel = level
      this.clickLp = lp
    } else {
      this.clickLevel = 0
    }
    if (this.chiffLevel > 1e-4) {
      const decay = Math.exp(-1 / (0.03 * this.sampleRate))
      let level = this.chiffLevel
      for (let i = 0; i < frames; i += 1) {
        out[i] += this.chiffBand.left(this.noise()) * level * 0.22
        level *= decay
      }
      this.chiffLevel = level
    } else if (this.chiffLevel !== 0) {
      this.chiffLevel = 0
      this.chiffBand.reset()
    }
  }

  /**
   * The vibrato/chorus selector. On the B3 it is the scanner: a short delay swept by a 6.9 Hz
   * triangle — vibrato is the swept signal alone, chorus is the swept signal mixed with the
   * straight one. Vox and Farf use the same line as a plain vibrato; the pipes use it slowly
   * and deeply as a detuned second rank (chorus) or a tremulant (vibrato).
   */
  private vibrato(out: Float32Array, frames: number): void {
    const { layer, sampleRate, scanner } = this
    const on = !!layer?.vibOn
    const goal = on ? 1 : 0
    if (!on && this.vibMix === 0) return
    const depthIndex = Math.floor(this.vibType / 2)
    const chorus = this.vibType % 2 === 1
    const kind = this.model.vibrato
    const detune = kind === 'detune'
    const rate = detune ? (chorus ? 0.9 : 5.2) : kind === 'vibrato' ? 6.2 : 6.9
    const depth = (detune && chorus ? DETUNE_DEPTH[depthIndex] : SCANNER_DEPTH[depthIndex]) * 0.001 * sampleRate
    const centre = depth + 2
    const mixStep = (goal > this.vibMix ? 1 : -1) / (0.012 * sampleRate)
    const tremolo = detune && !chorus ? 0.12 * (depthIndex + 1) : 0
    const mask = scanner.length - 1
    let index = this.scanIndex
    let phase = this.scanPhase
    let mixAmount = this.vibMix
    const phaseStep = rate / sampleRate
    for (let i = 0; i < frames; i += 1) {
      const dry = out[i]
      scanner[index] = dry
      const triangle = phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase
      const position = index - (centre + depth * triangle)
      const whole = Math.floor(position)
      const fraction = position - whole
      const a = scanner[whole & mask]
      const b = scanner[(whole + 1) & mask]
      let wet = a + (b - a) * fraction
      if (chorus) wet = 0.7 * (wet + dry)
      if (tremolo > 0) wet *= 1 - tremolo * (0.5 + 0.5 * triangle)
      if (mixAmount !== goal) mixAmount = Math.min(1, Math.max(0, mixAmount + mixStep))
      out[i] = dry + mixAmount * (wet - dry)
      index = (index + 1) & mask
      phase += phaseStep
      if (phase >= 1) phase -= 1
    }
    this.scanIndex = index
    this.scanPhase = phase
    this.vibMix = mixAmount
    if (!on && mixAmount === 0) scanner.fill(0)
  }
}
