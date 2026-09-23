import type { PianoType, Timbre } from './labels'

export const SPLIT_POSITIONS = [
  { name: 'C2', midi: 36 },
  { name: 'F2', midi: 41 },
  { name: 'C3', midi: 48 },
  { name: 'F3', midi: 53 },
  { name: 'C4', midi: 60 },
  { name: 'F4', midi: 65 },
  { name: 'C5', midi: 72 },
  { name: 'F5', midi: 77 },
  { name: 'C6', midi: 84 },
  { name: 'F6', midi: 89 },
  { name: 'C7', midi: 96 },
] as const

export type SplitName = 'low' | 'mid' | 'high'
export const SPLIT_NAMES: readonly SplitName[] = ['low', 'mid', 'high']

export interface SplitPoint {
  enabled: boolean
  position: number
  crossfade: 0 | 6 | 12
}

export interface ZoneRange {
  lo: number
  hi: number
}

export interface MorphAssignment {
  id: string
  from: number
  to: number
}

export interface Enables {
  organA: boolean
  organB: boolean
  pianoA: boolean
  pianoB: boolean
  synthA: boolean
  synthB: boolean
  synthC: boolean
}

export interface FxDocument {
  mod1Type: number
  mod1Rate: number
  mod1Amount: number
  mod1On: boolean
  mod2Type: number
  mod2Rate: number
  mod2Amount: number
  mod2On: boolean
  delay: { tempo: number; feedback: number; mix: number; filter: number; on: boolean; global: boolean }
  ampType: number
  ampDrive: number
  ampFreq: number
  ampBass: number
  ampMid: number
  ampTreble: number
  ampOn: boolean
  comp: { amount: number; on: boolean; fast: boolean; global: boolean }
  reverb: { type: number; mix: number; bright: boolean; on: boolean; global: boolean }
}

export interface PianoLayerDocument {
  enabled: boolean
  octave: number
  level: number
  type: PianoType
  sustped: boolean
  pstick: boolean
  timbre: Timbre
  unison: 0 | 1 | 2 | 3
  softRelease: boolean
  stringRes: boolean
}

export interface OrganLayerDocument {
  level: number
  octave: number
  model: number
  drawbars: number[]
  sustped: boolean
  pstick: boolean
  zone: ZoneRange
}

export interface EnvDocument {
  attack: number
  decay: number
  release: number
  velocity: number
}

export interface SynthLayerDocument {
  level: number
  octave: number
  waveform: number
  oscCtrl: number
  coarse: number
  fine: number
  filterType: number
  filterOn: boolean
  filterFreq: number
  filterRes: number
  filterEnvAmt: number
  filterDrive: 0 | 1 | 2 | 3
  filterTrack: 0 | 1 | 2 | 3
  oscEnv: EnvDocument
  filterEnv: EnvDocument
  ampEnv: EnvDocument
  oscEnvAmt: number
  envToPitch: boolean
  lfoWave: number
  lfoDest: number
  lfoRate: number
  lfoAmount: number
  voiceMode: 0 | 1 | 2
  priority: 0 | 1 | 2
  glide: number
  unison: 0 | 1 | 2 | 3
  vibratoMode: 0 | 1 | 2
  vibratoRate: number
  vibratoAmount: number
  arpMode: 0 | 1 | 2
  arpDirection: 0 | 1 | 2 | 3
  arpRate: number
  arpRange: number
  arpHold: boolean
  arpRun: boolean
  samples: boolean
  sustped: boolean
  pstick: boolean
  zone: ZoneRange
  effectsOn: boolean
}

export interface ProgramDocument {
  name: string
  piano: {
    sectionOn: boolean
    focus: 'A' | 'B'
    kbTouch: number
    dynComp: number
    effectsOn: boolean
    pianoGroup: boolean
    layers: { A: PianoLayerDocument; B: PianoLayerDocument }
    fx: { A: FxDocument; B: FxDocument }
    zones: { A: ZoneRange; B: ZoneRange }
  }
  organ: {
    sectionOn: boolean
    focus: 'A' | 'B'
    vibIndex: number
    vibOn: { A: boolean; B: boolean }
    percOn: boolean
    percSoft: boolean
    percFast: boolean
    percThird: boolean
    rotarySource: boolean
    effectsOn: boolean
    layers: { A: OrganLayerDocument; B: OrganLayerDocument }
    fx: FxDocument
  }
  synth: {
    sectionOn: boolean
    focus: 'A' | 'B' | 'C'
    dialTarget: 'amp' | 'filter' | 'osc' | 'vibrato' | 'pitch'
    layers: { A: SynthLayerDocument; B: SynthLayerDocument; C: SynthLayerDocument }
    fx: { A: FxDocument; B: FxDocument; C: FxDocument }
  }
  split: { points: [SplitPoint, SplitPoint, SplitPoint] }
  scenes: { active: 'I' | 'II'; I: Enables; II: Enables }
  morph: { wheel: MorphAssignment[]; pedal: MorphAssignment[] }
  clockBpm: number
  clockSync: { arp: boolean; lfo: boolean; delay: boolean; mod1: boolean }
  transpose: number
  transposeOn: boolean
  manualFocus: 'organ' | 'piano' | 'synth'
}

export function cloneDoc<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function signature(doc: ProgramDocument): string {
  return JSON.stringify(doc)
}

export function fullZone(): ZoneRange {
  return { lo: 0, hi: 3 }
}

export function defaultSplitPoint(enabled = false): SplitPoint {
  return { enabled, position: 4, crossfade: 0 }
}

export function defaultEnv(attack = 8, decay = 70, release = 40, velocity = 2): EnvDocument {
  return { attack, decay, release, velocity }
}

export function defaultDrawbars(): number[] {
  return [8, 8, 6, 0, 0, 0, 0, 0, 0]
}

export function defaultOrganLayer(): OrganLayerDocument {
  return {
    level: 100,
    octave: 0,
    model: 0,
    drawbars: defaultDrawbars(),
    sustped: true,
    pstick: true,
    zone: fullZone(),
  }
}

export function defaultSynthLayer(enabledEffects = false): SynthLayerDocument {
  return {
    level: 100,
    octave: 0,
    waveform: 2,
    oscCtrl: 64,
    coarse: 0,
    fine: 0,
    filterType: 0,
    filterOn: true,
    filterFreq: 96,
    filterRes: 16,
    filterEnvAmt: 40,
    filterDrive: 0,
    filterTrack: 0,
    oscEnv: defaultEnv(4, 60, 30, 0),
    filterEnv: defaultEnv(8, 50, 30, 0),
    ampEnv: defaultEnv(4, 90, 36, 2),
    oscEnvAmt: 0,
    envToPitch: false,
    lfoWave: 0,
    lfoDest: 0,
    lfoRate: 64,
    lfoAmount: 0,
    voiceMode: 0,
    priority: 0,
    glide: 0,
    unison: 0,
    vibratoMode: 0,
    vibratoRate: 64,
    vibratoAmount: 40,
    arpMode: 0,
    arpDirection: 0,
    arpRate: 64,
    arpRange: 0,
    arpHold: false,
    arpRun: false,
    samples: false,
    sustped: true,
    pstick: true,
    zone: fullZone(),
    effectsOn: enabledEffects,
  }
}

export function emptyEnables(): Enables {
  return {
    organA: false,
    organB: false,
    pianoA: true,
    pianoB: false,
    synthA: false,
    synthB: false,
    synthC: false,
  }
}

export function activeBoundaries(points: readonly SplitPoint[]): { midi: number; width: number }[] {
  const rows = points
    .filter((point) => point.enabled)
    .map((point) => ({
      midi: SPLIT_POSITIONS[Math.max(0, Math.min(SPLIT_POSITIONS.length - 1, point.position))]!.midi,
      width: point.crossfade,
    }))
    .sort((left, right) => left.midi - right.midi)
  return rows.filter((row, index) => index === 0 || row.midi !== rows[index - 1]!.midi)
}

/** Per-zone gains for a played key. Width 0 is a hard cut; the split note belongs to the upper zone. */
export function zoneGains(midi: number, points: readonly SplitPoint[]): number[] {
  const bounds = activeBoundaries(points)
  const count = bounds.length + 1
  const gains = Array.from({ length: count }, () => 0)
  if (bounds.length === 0) {
    gains[0] = 1
    return gains
  }
  let zone = 0
  while (zone < bounds.length && midi >= bounds[zone]!.midi) zone += 1
  gains[zone] = 1
  for (let index = 0; index < bounds.length; index++) {
    const width = bounds[index]!.width
    if (width <= 0) continue
    const split = bounds[index]!.midi
    const dist = midi - split
    if (dist < -width || dist > width) continue
    const upper = (dist + width) / (2 * width)
    for (let slot = 0; slot < gains.length; slot++) gains[slot] = 0
    gains[index] = 1 - upper
    gains[index + 1] = upper
  }
  return gains
}

export function layerZoneGain(midi: number, zone: ZoneRange, points: readonly SplitPoint[]): number {
  const gains = zoneGains(midi, points)
  let sum = 0
  const lo = Math.max(0, Math.min(zone.lo, zone.hi))
  const hi = Math.max(zone.lo, zone.hi)
  for (let index = lo; index <= hi && index < gains.length; index++) sum += gains[index] ?? 0
  return Math.min(1, sum)
}

export function morphMix(source: number, assignment: MorphAssignment | undefined, base: number): number {
  if (!assignment) return base
  const span = Math.max(0, Math.min(127, source)) / 127
  return assignment.from + (assignment.to - assignment.from) * span
}

export function bpmFromTaps(taps: readonly number[]): number | null {
  if (taps.length < 4) return null
  const recent = taps.slice(-4)
  let sum = 0
  for (let index = 1; index < recent.length; index++) sum += recent[index]! - recent[index - 1]!
  const avg = sum / (recent.length - 1)
  if (avg <= 0.05) return null
  return Math.max(30, Math.min(300, Math.round(60 / avg)))
}

export function clockHz(bpm: number, knob: number, ratios: readonly number[]): number {
  const index = Math.round((Math.max(0, Math.min(127, knob)) / 127) * (ratios.length - 1))
  return (bpm / 60) * ratios[index]!
}

export const LFO_RATIOS = [0.5, 1, 1.5, 2, 3, 4, 6, 8] as const
export const ARP_BEATS = [2, 1, 0.75, 0.5, 1 / 3, 0.25, 1 / 6, 0.125] as const

export function buildFactories(base: ProgramDocument): ProgramDocument[] {
  const make = (name: string, edit: (doc: ProgramDocument) => void) => {
    const doc = cloneDoc(base)
    doc.name = name
    edit(doc)
    return doc
  }
  const silencePiano = (doc: ProgramDocument) => {
    doc.piano.sectionOn = false
    doc.piano.layers.A.enabled = false
    doc.piano.layers.B.enabled = false
    doc.scenes.I.pianoA = false
    doc.scenes.I.pianoB = false
    doc.scenes.II.pianoA = false
    doc.scenes.II.pianoB = false
  }
  const organOn = (doc: ProgramDocument, model: number, drawbars?: number[]) => {
    silencePiano(doc)
    doc.organ.sectionOn = true
    doc.organ.focus = 'A'
    doc.organ.layers.A.model = model
    if (drawbars) doc.organ.layers.A.drawbars = drawbars
    doc.scenes.I.organA = true
    doc.scenes.II.organA = true
    doc.manualFocus = 'organ'
  }
  return [
    make('Grand Piano', () => undefined),
    make('Upright', (doc) => {
      doc.piano.layers.A.type = 'Upright'
    }),
    make('Rhodes', (doc) => {
      doc.piano.layers.A.type = 'Electric'
    }),
    make('B3 Jazz', (doc) => organOn(doc, 0, [8, 8, 8, 0, 0, 0, 0, 0, 0])),
    make('Vox Combo', (doc) => organOn(doc, 1, [8, 6, 4, 0, 0, 0, 0, 4, 2])),
    make('Farf Split', (doc) => {
      doc.organ.sectionOn = true
      doc.organ.layers.A.model = 2
      doc.organ.layers.A.drawbars = [8, 8, 8, 0, 0, 0, 0, 0, 0]
      doc.organ.layers.A.zone = { lo: 0, hi: 0 }
      doc.piano.zones.A = { lo: 1, hi: 1 }
      doc.scenes.I.organA = true
      doc.scenes.II.organA = true
      doc.split.points[1] = { enabled: true, position: 4, crossfade: 0 }
    }),
    make('Saw Lead', (doc) => {
      silencePiano(doc)
      doc.synth.sectionOn = true
      doc.synth.focus = 'A'
      doc.synth.layers.A.waveform = 2
      doc.synth.layers.A.effectsOn = false
      doc.scenes.I.synthA = true
      doc.scenes.II.synthA = true
      doc.manualFocus = 'synth'
    }),
    make('Stack', (doc) => {
      doc.synth.sectionOn = true
      doc.synth.layers.A.waveform = 11
      doc.synth.layers.A.filterFreq = 70
      doc.scenes.I.synthA = true
      doc.scenes.II.pianoA = true
      doc.scenes.II.synthA = true
    }),
    make('Pipe Hymn', (doc) => organOn(doc, 3, [6, 8, 4, 2, 0, 0, 0, 0, 0])),
    make('Night Split', (doc) => {
      doc.piano.layers.A.type = 'Electric'
      doc.piano.zones.A = { lo: 1, hi: 1 }
      doc.organ.sectionOn = true
      doc.organ.layers.A.model = 0
      doc.organ.layers.A.drawbars = [8, 0, 8, 0, 0, 0, 0, 0, 0]
      doc.organ.layers.A.zone = { lo: 0, hi: 0 }
      doc.scenes.I.organA = true
      doc.split.points[1] = { enabled: true, position: 4, crossfade: 6 }
    }),
  ]
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const PROGRAM_STORAGE_KEY = 'stagebench-nord-programs-v1'

export class ProgramBank {
  programs: ProgramDocument[]
  live: ProgramDocument[]
  space: 'program' | 'live' = 'program'
  index = 0
  clean = ''
  undo: ProgramDocument | null = null
  mode: 'play' | 'name' | 'dest' = 'play'
  captured: ProgramDocument | null = null
  nameDraft = ''
  nameCursor = 0
  listOpen = false
  splitEdit: 0 | 1 | 2 = 1

  constructor(initial: ProgramDocument, private readonly storage: StorageLike | null) {
    const saved = this.read()
    this.programs = saved?.programs ?? buildFactories(initial)
    if (this.programs.length < 32) {
      const pad = cloneDoc(initial)
      while (this.programs.length < 32) {
        const doc = cloneDoc(pad)
        doc.name = `Program ${this.programs.length + 1}`
        this.programs.push(doc)
      }
    }
    this.programs = this.programs.slice(0, 32)
    this.live =
      saved?.live ??
      Array.from({ length: 8 }, (_, slot) => {
        const doc = cloneDoc(initial)
        doc.name = `Live ${slot + 1}`
        return doc
      })
    while (this.live.length < 8) {
      const doc = cloneDoc(initial)
      doc.name = `Live ${this.live.length + 1}`
      this.live.push(doc)
    }
    this.live = this.live.slice(0, 8)
    this.clean = signature(this.current())
  }

  current(): ProgramDocument {
    return this.space === 'live' ? this.live[this.index]! : this.programs[this.index]!
  }

  label(): string {
    const page = Math.floor(this.index / 8) + 1
    const button = (this.index % 8) + 1
    const prefix = this.space === 'live' ? `L${button}` : `${page}.${button}`
    return `${prefix} ${this.current().name}`
  }

  private read(): { programs: ProgramDocument[]; live: ProgramDocument[] } | null {
    if (!this.storage) return null
    try {
      const raw = this.storage.getItem(PROGRAM_STORAGE_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as { programs?: ProgramDocument[]; live?: ProgramDocument[] }
      if (!Array.isArray(parsed.programs) || !Array.isArray(parsed.live)) return null
      return { programs: parsed.programs, live: parsed.live }
    } catch {
      return null
    }
  }

  persist() {
    if (!this.storage) return
    this.storage.setItem(PROGRAM_STORAGE_KEY, JSON.stringify({ programs: this.programs, live: this.live }))
  }
}

export const MORPH_DESTINATIONS = new Set([
  'organ-level-a',
  'organ-level-b',
  'organ-drawbar-1',
  'organ-drawbar-2',
  'organ-drawbar-3',
  'organ-drawbar-4',
  'organ-drawbar-5',
  'organ-drawbar-6',
  'organ-drawbar-7',
  'organ-drawbar-8',
  'organ-drawbar-9',
  'rotary-speed',
  'piano-level-a',
  'piano-level-b',
  'synth-level-a',
  'synth-level-b',
  'synth-level-c',
  'lfo-rate',
  'osc-ctrl',
  'lfo-mod-amt',
  'filter-freq',
  'filter-res',
  'arp-rate',
  'mod1-rate',
  'mod1-amount',
  'mod2-amount',
  'delay-tempo',
  'delay-feedback',
  'delay-mix',
  'amp-freq',
  'amp-drive',
  'reverb-mix',
])

export function clampMidi(note: number): number {
  return Math.max(0, Math.min(127, Math.round(note)))
}
