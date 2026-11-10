import {
  AmpType,
  ArpMode,
  CHAIN_COUNT,
  Chain,
  DelayFilter,
  ENV_STEPS,
  FilterType,
  KbTouch,
  LfoDest,
  LfoWave,
  Mod1Type,
  Mod2Type,
  NotePriority,
  OrganModel,
  ReverbTone,
  ReverbType,
  SynthWave,
  Timbre,
  VibType,
  VibratoMode,
  VoiceMode,
  arpBpm,
  arpOctaves,
  attackSeconds,
  clockDivision,
  decaySeconds,
  delayKnobToSeconds,
  divisionSeconds,
  lfoRate,
  mod1KnobForRate,
  DELAY_MAX_SECONDS,
  DELAY_MIN_SECONDS,
  type ChainSound,
  type LayerSound,
  type OrganLayerSound,
  type SoundState,
  type SynthLayerSound,
  type ZoneRange,
} from '../audio/dsp/params'
import { modelAt, modelsOf, PIANO_TYPES, type PianoModel } from '../piano/catalog'
import { applyMorphs, type MorphAssignment, type MorphSource } from './morph'

/**
 * Canonical state of the whole instrument.
 *
 * It has three parts:
 *   - the **program**: everything a Program stores (the keys in PROGRAM_KEYS) — sections, layers,
 *     sounds, effects, splits and zones, Layer Scenes, morphs, clock tempo, transpose;
 *   - **performance** state that is not stored: Master Level, the pitch stick, the wheel and
 *     pedal positions, and the last notice for the display;
 *   - **navigation and editing** state: which program slot is loaded, Live Mode, and whichever
 *     editing page (Store, naming, split, clock, …) the Program display is showing.
 *
 * Values are kept in panel units (knobs 0..10, EQ in dB, faders 0..100) so the panel can show
 * them directly. `deriveSound` reduces this to what the audio kernel needs.
 */

export const LAYER_NAMES = ['A', 'B', 'C'] as const
export const MOD1_TYPES = ['A-Pan', 'Tremolo', 'Ring Mod', 'A-Wah', 'Wah', 'Pump'] as const
export const MOD2_TYPES = ['Phaser', 'Flanger', 'Chorus', 'Vibe', 'Ensemble', 'Spin'] as const
export const AMP_TYPES = ['Twin', 'JC', 'Small', 'To Rotary', 'LP24 Filter', 'HP24 Filter', 'EQ only'] as const
export const DELAY_FILTERS = ['Off', 'LP', 'BP', 'HP'] as const
export const REVERB_TYPES = ['Spring', 'Booth', 'Room', 'Stage', 'Hall', 'Cathedral'] as const
export const REVERB_TONES = ['Off', 'Bright', 'Dark'] as const
export const KB_TOUCHES = ['Medium', 'Light', 'Heavy'] as const
export const TIMBRES = ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2'] as const
export const LEVELS = ['Off', '1', '2', '3'] as const
/** Effect chains, in kernel order. */
export const CHAIN_NAMES = ['Piano A', 'Piano B', 'Organ', 'Synth A', 'Synth B', 'Synth C'] as const
export const SECTION_IDS = ['organ', 'piano', 'synth'] as const
export type SoundSection = (typeof SECTION_IDS)[number]
export const SECTION_NAMES: Record<SoundSection, string> = { organ: 'Organ', piano: 'Piano', synth: 'Synth' }

/** The 11 keyboard positions a split point can sit on: every C and F from C2 to C7. */
export const SPLIT_POSITIONS = [36, 41, 48, 53, 60, 65, 72, 77, 84, 89, 96] as const
export const SPLIT_POINT_NAMES = ['Low', 'Mid', 'High'] as const
export const XFADE_WIDTHS = [0, 6, 12] as const
export const BPM_MIN = 30
export const BPM_MAX = 300
export const PROGRAM_PAGES = 4
export const PROGRAMS_PER_PAGE = 8
export const PROGRAM_COUNT = PROGRAM_PAGES * PROGRAMS_PER_PAGE
export const LIVE_COUNT = 8
export const NAME_LENGTH = 16
/** Characters the naming page offers, in dial order. */
export const NAME_CHARACTERS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-+&#.\''

export type UnitId = 'mod1' | 'mod2' | 'delay' | 'amp' | 'comp' | 'reverb'
export const UNIT_NAMES: Record<UnitId, string> = {
  mod1: 'Mod 1',
  mod2: 'Mod 2',
  delay: 'Delay',
  amp: 'Amp Sim/EQ',
  comp: 'Compressor',
  reverb: 'Reverb',
}
/** Units that can be set to Global with Shift + On (manual p. 48). */
export const GLOBAL_UNITS = ['delay', 'comp', 'reverb'] as const
export type GlobalUnitId = (typeof GLOBAL_UNITS)[number]

// ── Sections ──────────────────────────────────────────────────────────────────

export interface PianoLayerState {
  on: boolean
  /** Fader, 0..100. */
  level: number
  /** Octave shift, -1..1. */
  octave: number
  /** Keyboard zones the layer plays in: first and last, 0..3. */
  zone: ZoneRange
  /** Index into PIANO_TYPES. */
  type: number
  /** Selected model per type, so each type remembers its model. */
  models: number[]
  /** Index into TIMBRES. */
  timbre: number
  /** Index into KB_TOUCHES. */
  kbTouch: number
  dynComp: number
  unison: number
  softRelease: boolean
  stringRes: boolean
}

export interface OrganLayerState {
  on: boolean
  level: number
  octave: number
  zone: ZoneRange
  /** Index into ORGAN_MODELS. */
  model: number
  /** Nine drawbars, 0..8. */
  drawbars: number[]
  vibOn: boolean
  perc: { on: boolean; soft: boolean; fast: boolean; third: boolean }
}

export interface EnvState {
  /** Dial steps, 0..ENV_STEPS. */
  attack: number
  /** The last step is "sustain": the envelope holds while the key is down. */
  decay: number
  release: number
}

export interface SynthLayerState {
  on: boolean
  level: number
  octave: number
  zone: ZoneRange
  /** Index into SYNTH_WAVEFORMS. */
  wave: number
  /** Osc Ctrl knob, 0..10. */
  ctrl: number
  /** Semitones, -24..24. */
  coarse: number
  /** Cents, -50..50. */
  fine: number
  oscEnv: EnvState & { /** Bipolar knob, -10..10. */ amount: number; velocity: boolean; toPitch: boolean }
  filter: {
    on: boolean
    /** Index into FILTER_TYPES. */
    type: number
    freq: number
    res: number
    envAmt: number
    /** Index into KB_TRACKS. */
    track: number
    /** 0..3. */
    drive: number
  }
  filterEnv: EnvState & { velocity: boolean }
  ampEnv: EnvState & { /** 0..3. */ velocity: number }
  lfo: {
    wave: number
    /** Index into LFO_DESTS; 0 is off. */
    dest: number
    rate: number
    amount: number
    /** Rate locked to the Master Clock: the knob picks a subdivision. */
    sync: boolean
  }
  voice: {
    mode: number
    priority: number
    glide: number
    unison: number
    /** Index into VIBRATO_MODES. */
    vibrato: number
    /** Hz, 2..8. */
    vibRate: number
    /** 0..10. */
    vibAmount: number
  }
  arp: {
    run: boolean
    /** Index into ARP_MODES. */
    mode: number
    rate: number
    /** The Range / Env knob, 0..10. */
    range: number
    direction: number
    sync: boolean
    kbSync: boolean
  }
}

export interface FxChainState {
  mod1: { on: boolean; type: number; rate: number; amount: number; /** Rate locked to the Master Clock. */ sync: boolean }
  mod2: { on: boolean; type: number; rate: number; amount: number }
  delay: {
    on: boolean
    /** Tempo knob, 0..10. */
    tempo: number
    /** The actual delay time; set by the knob or, more exactly, by tapping. */
    seconds: number
    feedback: number
    mix: number
    filter: number
    pingPong: boolean
    /** Tempo locked to the Master Clock: the knob picks a subdivision. */
    sync: boolean
  }
  amp: { on: boolean; type: number; drive: number; bass: number; mid: number; freq: number; treble: number }
  comp: { on: boolean; amount: number; fast: boolean }
  reverb: { on: boolean; type: number; tone: number; mix: number }
}

/** Which sections and layers are switched on: the only thing a Layer Scene holds. */
export interface SceneEnables {
  organ: { on: boolean; layers: boolean[] }
  piano: { on: boolean; layers: boolean[] }
  synth: { on: boolean; layers: boolean[] }
}

export interface SplitPointState {
  on: boolean
  /** First key of the upper side; one of SPLIT_POSITIONS. */
  note: number
  /** 0, 6, or 12 semitones on each side. */
  xfade: number
}

// ── Editing pages of the Program display ──────────────────────────────────────

export type UiMode = 'play' | 'list' | 'store' | 'name' | 'split' | 'clock' | 'transpose'
export type SynthPage = 'osc' | 'pitch' | 'oscEnv' | 'filter' | 'filterEnv' | 'ampEnv' | 'lfo' | 'arp' | 'vibrato'

export interface SlotRef {
  /** True for one of the eight Live slots. */
  live: boolean
  /** 0..31 for a program, 0..7 for a Live slot. */
  slot: number
}

export interface UiState {
  mode: UiMode
  /** The section whose sound the Program display describes: the one touched last. */
  section: SoundSection
  synthPage: SynthPage
  /** List view: the highlighted program. */
  listCursor: number
  /** Store / Store As in progress. */
  store: { dest: SlotRef; name: string; cursor: number; naming: boolean }
  /** The stored program at the Store destination, which sounds while a destination is chosen. */
  audition: ProgramData | null
  split: { row: 'note' | 'xfade'; point: number }
  /** Morph Assign latched for a source: the next control moved sets that source's morph. */
  morphAssign: MorphSource | null
}

export interface StageState {
  // ── Program (stored) ────────────────────────────────────────────────────────
  name: string
  organ: {
    on: boolean
    sustPed: boolean
    pStick: boolean
    focus: number
    /** Index into VIB_TYPES; shared by both layers. */
    vibType: number
    layers: [OrganLayerState, OrganLayerState]
  }
  piano: {
    on: boolean
    /** SUSTPED: the sustain pedal reaches the Piano section. */
    sustPed: boolean
    /** PSTICK: the pitch stick bends the Piano section ±2 semitones. */
    pStick: boolean
    /** Layer the Piano panel controls edit. */
    focus: number
    layers: [PianoLayerState, PianoLayerState]
  }
  synth: {
    on: boolean
    sustPed: boolean
    pStick: boolean
    focus: number
    /** KB Hold. */
    hold: boolean
    layers: [SynthLayerState, SynthLayerState, SynthLayerState]
  }
  fx: {
    /** Layer Effects On. Off bypasses every effect at once. */
    on: boolean
    /** Chain the effect controls edit and show: an index into CHAIN_NAMES. */
    focus: number
    /** Piano Group / Synth Group: the section's layers share one effect setting. */
    pianoGroup: boolean
    synthGroup: boolean
    global: Record<GlobalUnitId, boolean>
    chains: FxChainState[]
  }
  rotary: {
    fast: boolean
    stopMode: boolean
    drive: number
    /** The Rotary Speaker's Organ button: the organ plays through the rotor. */
    organ: boolean
    /** Only ever set on a morphed copy of the state (see morph.ts): rotor speed 0..1. */
    speed?: number
  }
  split: { on: boolean; points: [SplitPointState, SplitPointState, SplitPointState] }
  scene: {
    /** 0 = Layer Scene I, 1 = Layer Scene II. */
    active: number
    /** Enables of the scene that is not active. The active scene's enables are the live `on` flags. */
    other: SceneEnables
  }
  morph: Record<MorphSource, MorphAssignment[]>
  clock: { bpm: number; kbSync: boolean }
  transpose: { on: boolean; semitones: number }

  // ── Performance (not stored) ────────────────────────────────────────────────
  /** Master Level knob, 0..10. */
  master: number
  /** Pitch stick position, -100..100. */
  pitchStick: number
  /** Modulation wheel and control pedal, 0..1. */
  wheel: number
  pedal: number
  /** What the last panel action did, for the Program display. */
  notice: string

  // ── Navigation and editing ──────────────────────────────────────────────────
  nav: SlotRef & {
    /** Program slot to return to when Live Mode is left. */
    program: number
    liveSlot: number
    /** The loaded program differs from what is stored in its slot. */
    dirty: boolean
  }
  ui: UiState
}

export const PROGRAM_KEYS = [
  'name',
  'organ',
  'piano',
  'synth',
  'fx',
  'rotary',
  'split',
  'scene',
  'morph',
  'clock',
  'transpose',
] as const
export type ProgramKey = (typeof PROGRAM_KEYS)[number]
/** Everything a Program stores. Plain JSON. */
export type ProgramData = Pick<StageState, ProgramKey>

// ── Initial state ─────────────────────────────────────────────────────────────

export function initialChain(): FxChainState {
  return {
    mod1: { on: false, type: Mod1Type.Pump, rate: 3.2, amount: 6.5, sync: false },
    mod2: { on: false, type: Mod2Type.Chorus, rate: 6.3, amount: 3 },
    delay: {
      on: false,
      tempo: 3,
      seconds: delayKnobToSeconds(0.3),
      feedback: 6.5,
      mix: 2,
      filter: DelayFilter.LP,
      pingPong: false,
      sync: false,
    },
    amp: { on: false, type: AmpType.Twin, drive: 3.2, bass: 6, mid: 8, freq: 5.2, treble: 1 },
    comp: { on: false, amount: 2.2, fast: false },
    reverb: { on: false, type: ReverbType.Cathedral, tone: ReverbTone.Off, mix: 6.5 },
  }
}

export function initialPianoLayer(on: boolean, level: number): PianoLayerState {
  return {
    on,
    level,
    octave: 0,
    zone: [0, 3],
    type: 0,
    models: PIANO_TYPES.map(() => 0),
    timbre: Timbre.Off,
    kbTouch: KbTouch.Medium,
    dynComp: 0,
    unison: 0,
    softRelease: false,
    stringRes: true,
  }
}

export function initialOrganLayer(on: boolean, level: number): OrganLayerState {
  return {
    on,
    level,
    octave: 0,
    zone: [0, 3],
    model: OrganModel.B3,
    drawbars: [8, 6, 8, 4, 3, 3, 6, 3, 5],
    vibOn: true,
    perc: { on: false, soft: false, fast: true, third: true },
  }
}

export function initialSynthLayer(on: boolean, level: number): SynthLayerState {
  return {
    on,
    level,
    octave: 0,
    zone: [0, 3],
    wave: SynthWave.Saw,
    ctrl: 3.5,
    coarse: 0,
    fine: 0,
    oscEnv: { attack: 0, decay: 20, release: 12, amount: 3, velocity: false, toPitch: false },
    filter: { on: true, type: FilterType.LP24, freq: 3.5, res: 5.2, envAmt: 5.5, track: 3, drive: 0 },
    filterEnv: { attack: 0, decay: 24, release: 18, velocity: false },
    ampEnv: { attack: 4, decay: ENV_STEPS, release: 16, velocity: 2 },
    lfo: { wave: LfoWave.Triangle, dest: LfoDest.Off, rate: 3.5, amount: 6.5, sync: false },
    voice: { mode: VoiceMode.Poly, priority: NotePriority.Last, glide: 7, unison: 2, vibrato: VibratoMode.Off, vibRate: 5.5, vibAmount: 5 },
    arp: { run: false, mode: ArpMode.Arp, rate: 6.5, range: 5, direction: 0, sync: false, kbSync: false },
  }
}

/** The enables a state has right now, as a scene. */
export function sceneEnables(state: Pick<StageState, 'organ' | 'piano' | 'synth'>): SceneEnables {
  return {
    organ: { on: state.organ.on, layers: state.organ.layers.map((layer) => layer.on) },
    piano: { on: state.piano.on, layers: state.piano.layers.map((layer) => layer.on) },
    synth: { on: state.synth.on, layers: state.synth.layers.map((layer) => layer.on) },
  }
}

export function initialUi(): UiState {
  return {
    mode: 'play',
    section: 'piano',
    synthPage: 'osc',
    listCursor: 0,
    store: { dest: { live: false, slot: 0 }, name: '', cursor: 0, naming: false },
    audition: null,
    split: { row: 'note', point: 1 },
    morphAssign: null,
  }
}

/**
 * Start-up state, which is also factory program 1.1. Knob, fader, drawbar, and selector
 * positions are the ones on the reference photo. What deliberately differs from the photo, so
 * the instrument starts as a plain, clean piano: the Organ and Synth sections and Piano Layer B
 * start off, every effect unit starts off, and there is no split.
 */
export function createInitialState(): StageState {
  const sections = {
    organ: {
      on: false,
      sustPed: false,
      pStick: false,
      focus: 0,
      vibType: VibType.C3,
      layers: [initialOrganLayer(true, 100), initialOrganLayer(false, 50)] as [OrganLayerState, OrganLayerState],
    },
    piano: {
      on: true,
      sustPed: true,
      pStick: false,
      focus: 0,
      layers: [initialPianoLayer(true, 100), initialPianoLayer(false, 42)] as [PianoLayerState, PianoLayerState],
    },
    synth: {
      on: false,
      sustPed: true,
      pStick: true,
      focus: 0,
      hold: false,
      layers: [initialSynthLayer(true, 100), initialSynthLayer(false, 25), initialSynthLayer(false, 67)] as [
        SynthLayerState,
        SynthLayerState,
        SynthLayerState,
      ],
    },
  }
  return {
    name: 'Grand Piano',
    ...sections,
    fx: {
      on: true,
      focus: Chain.PianoA,
      pianoGroup: false,
      synthGroup: false,
      global: { delay: false, comp: false, reverb: false },
      chains: Array.from({ length: CHAIN_COUNT }, initialChain),
    },
    rotary: { fast: false, stopMode: false, drive: 1.5, organ: false },
    split: {
      on: false,
      points: [
        { on: false, note: 48, xfade: 0 },
        { on: true, note: 60, xfade: 0 },
        { on: false, note: 72, xfade: 0 },
      ],
    },
    scene: { active: 0, other: sceneEnables(sections) },
    morph: { wheel: [], pedal: [] },
    clock: { bpm: 120, kbSync: false },
    transpose: { on: false, semitones: 0 },
    master: 7,
    pitchStick: 0,
    wheel: 0,
    pedal: 0,
    notice: '',
    nav: { live: false, slot: 0, program: 0, liveSlot: 0, dirty: false },
    ui: initialUi(),
  }
}

// ── Programs ──────────────────────────────────────────────────────────────────

/** A deep copy of the stored part of a state. */
export function extractProgram(state: ProgramData): ProgramData {
  const program = {} as Record<string, unknown>
  for (const key of PROGRAM_KEYS) program[key] = structuredClone(state[key])
  // A morphed copy may carry a rotor speed; it is never part of a program.
  delete (program.rotary as { speed?: number }).speed
  return program as unknown as ProgramData
}

/** Stable text form of a program, used to tell whether the loaded program has been edited. */
export function programSignature(program: ProgramData): string {
  return JSON.stringify(PROGRAM_KEYS.map((key) => program[key]))
}

/**
 * Make anything read from storage safe to load: every field takes the stored value only when
 * it has the right type and shape, and the factory default otherwise. Unknown fields are dropped.
 */
export function conformProgram(raw: unknown, template: ProgramData = extractProgram(createInitialState())): ProgramData {
  const result = conform(template, raw) as ProgramData
  const source = raw as { morph?: Partial<Record<MorphSource, unknown>> } | null
  for (const key of ['wheel', 'pedal'] as const) {
    const list = source && typeof source === 'object' && source.morph ? source.morph[key] : null
    result.morph[key] = Array.isArray(list)
      ? list
          .filter((item): item is MorphAssignment => !!item && typeof item.path === 'string' && typeof item.to === 'number' && Number.isFinite(item.to))
          .map((item) => ({ path: item.path, to: item.to }))
      : []
  }
  result.name = String(result.name).slice(0, NAME_LENGTH)
  return result
}

function conform(template: unknown, value: unknown): unknown {
  if (Array.isArray(template)) {
    if (!Array.isArray(value)) return structuredClone(template)
    return template.map((item, index) => conform(item, value[index]))
  }
  if (template !== null && typeof template === 'object') {
    const source = value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(template)) out[key] = conform(item, source[key])
    return out
  }
  if (typeof template === 'number') return typeof value === 'number' && Number.isFinite(value) ? value : template
  return typeof value === typeof template ? value : template
}

/** "1.1" .. "4.8" for a program slot, "LIVE 1" .. "LIVE 8" for a Live slot. */
export function slotLabel(ref: SlotRef): string {
  if (ref.live) return `LIVE ${ref.slot + 1}`
  return `${Math.floor(ref.slot / PROGRAMS_PER_PAGE) + 1}.${(ref.slot % PROGRAMS_PER_PAGE) + 1}`
}

// ── Reading the state ─────────────────────────────────────────────────────────

export function layerModel(layer: PianoLayerState): PianoModel {
  return modelAt(layer.type, layer.models[layer.type] ?? 0)
}

/** How many Timbre positions the layer's model has: 4 for acoustic, 6 with the two Dyno settings. */
export function timbreCount(layer: PianoLayerState): number {
  return layerModel(layer).family === 'electric' ? 6 : 4
}

export function effectiveSoftRelease(layer: PianoLayerState): boolean {
  return layer.softRelease && layerModel(layer).softRelease
}

export function effectiveStringRes(layer: PianoLayerState): boolean {
  return layer.stringRes && layerModel(layer).stringRes
}

/** Which section a chain belongs to, and which of its layers (0 for the shared Organ chain). */
export function chainOwner(chain: number): { section: SoundSection; layer: number } {
  if (chain <= Chain.PianoB) return { section: 'piano', layer: chain }
  if (chain === Chain.Organ) return { section: 'organ', layer: 0 }
  return { section: 'synth', layer: chain - Chain.SynthA }
}

/** The chain of a section's layer. Both Organ layers share one. */
export function chainOf(section: SoundSection, layer: number): number {
  if (section === 'piano') return Chain.PianoA + layer
  if (section === 'organ') return Chain.Organ
  return Chain.SynthA + layer
}

/**
 * Chains an edit of `unit` applies to: every chain when the unit is Global; all the layers of
 * the focused section when that section is Grouped; otherwise the focused chain alone.
 */
export function fxTargets(state: Pick<StageState, 'fx'>, unit: UnitId): number[] {
  const { fx } = state
  if ((GLOBAL_UNITS as readonly string[]).includes(unit) && fx.global[unit as GlobalUnitId]) {
    return Array.from({ length: CHAIN_COUNT }, (_, index) => index)
  }
  const { section } = chainOwner(fx.focus)
  if (section === 'piano' && fx.pianoGroup) return [Chain.PianoA, Chain.PianoB]
  if (section === 'synth' && fx.synthGroup) return [Chain.SynthA, Chain.SynthB, Chain.SynthC]
  return [fx.focus]
}

/** A chain is routed into the Rotary when its Amp Sim/EQ unit is on, set To Rotary, and effects are on. */
export function routedToRotary(state: Pick<StageState, 'fx'>, chain: number): boolean {
  const amp = state.fx.chains[chain].amp
  return state.fx.on && amp.on && amp.type === AmpType.ToRotary
}

/** True while anything that sounds is actually playing through the Rotary Speaker. */
export function rotaryInUse(state: StageState): boolean {
  if (state.organ.on && state.rotary.organ && state.organ.layers.some((layer) => layer.on)) return true
  if (state.organ.on && routedToRotary(state, Chain.Organ) && state.organ.layers.some((layer) => layer.on)) return true
  if (state.piano.on && state.piano.layers.some((layer, index) => layer.on && routedToRotary(state, Chain.PianoA + index))) return true
  return state.synth.on && state.synth.layers.some((layer, index) => layer.on && routedToRotary(state, Chain.SynthA + index))
}

// ── Splits and zones ──────────────────────────────────────────────────────────

/** Split points that are actually dividing the keyboard. */
export function activePoints(state: Pick<StageState, 'split'>): boolean[] {
  return state.split.points.map((point) => state.split.on && point.on)
}

/**
 * The zone ranges a layer can be given right now, in the order the KB Zone buttons step
 * through them. Zones either side of a split point that is off count as one, so with a single
 * Mid split the choices are: everywhere, lower, upper.
 */
export function zoneChoices(state: Pick<StageState, 'split'>): ZoneRange[] {
  const active = activePoints(state)
  // Groups of zones that are not separated by an active point.
  const groups: ZoneRange[] = []
  let start = 0
  for (let zone = 0; zone < 4; zone += 1) {
    if (zone === 3 || active[zone]) {
      groups.push([start, zone])
      start = zone + 1
    }
  }
  const choices: ZoneRange[] = [[0, 3]]
  for (let first = 0; first < groups.length; first += 1) {
    for (let last = first; last < groups.length; last += 1) {
      const range: ZoneRange = [groups[first][0], groups[last][1]]
      if (range[0] === 0 && range[1] === 3) continue
      choices.push(range)
    }
  }
  return choices
}

/** The choice a stored zone range currently amounts to (ranges snap outwards to whole groups). */
export function zoneChoiceIndex(state: Pick<StageState, 'split'>, zone: ZoneRange): number {
  const choices = zoneChoices(state)
  const active = activePoints(state)
  let lo = zone[0]
  let hi = zone[1]
  while (lo > 0 && !active[lo - 1]) lo -= 1
  while (hi < 3 && !active[hi]) hi += 1
  const index = choices.findIndex((choice) => choice[0] === lo && choice[1] === hi)
  return index < 0 ? 0 : index
}

/** The four KB Zone LEDs for a layer. */
export function zoneLeds(state: Pick<StageState, 'split'>, zone: ZoneRange): boolean[] {
  const range = zoneChoices(state)[zoneChoiceIndex(state, zone)]
  return [0, 1, 2, 3].map((index) => index >= range[0] && index <= range[1])
}

// ── Deriving the sound ────────────────────────────────────────────────────────

function chainSound(chain: FxChainState, bpm: number): ChainSound {
  const mod1Rate = chain.mod1.sync
    ? mod1KnobForRate(1 / divisionSeconds(clockDivision(chain.mod1.rate).beats, bpm))
    : chain.mod1.rate / 10
  const delayTime = chain.delay.sync
    ? Math.min(DELAY_MAX_SECONDS, Math.max(DELAY_MIN_SECONDS, divisionSeconds(clockDivision(chain.delay.tempo).beats, bpm)))
    : chain.delay.seconds
  return {
    mod1: { on: chain.mod1.on, type: chain.mod1.type, rate: mod1Rate, amount: chain.mod1.amount / 10 },
    mod2: { on: chain.mod2.on, type: chain.mod2.type, rate: chain.mod2.rate / 10, amount: chain.mod2.amount / 10 },
    delay: {
      on: chain.delay.on,
      time: delayTime,
      feedback: chain.delay.feedback / 10,
      mix: chain.delay.mix / 10,
      filter: chain.delay.filter,
      pingPong: chain.delay.pingPong,
    },
    amp: {
      on: chain.amp.on,
      type: chain.amp.type,
      drive: chain.amp.drive / 10,
      bass: chain.amp.bass,
      mid: chain.amp.mid,
      freq: chain.amp.freq / 10,
      treble: chain.amp.treble,
    },
    comp: { on: chain.comp.on, amount: chain.comp.amount / 10, fast: chain.comp.fast },
    reverb: { on: chain.reverb.on, type: chain.reverb.type, tone: chain.reverb.tone, mix: chain.reverb.mix / 10 },
  }
}

/** Steps per second of a Synth layer's arpeggiator: eighth notes at the knob's tempo, or a clock subdivision. */
export function arpStepRate(layer: SynthLayerState, bpm: number): number {
  if (layer.arp.sync) return 1 / divisionSeconds(clockDivision(layer.arp.rate).beats, bpm)
  return (arpBpm(layer.arp.rate) / 60) * 2
}

export function lfoCycleRate(layer: SynthLayerState, bpm: number): number {
  if (layer.lfo.sync) return 1 / divisionSeconds(clockDivision(layer.lfo.rate).beats, bpm)
  return lfoRate(layer.lfo.rate)
}

function synthLayerSound(state: StageState, index: number): SynthLayerSound {
  const layer = state.synth.layers[index]
  const { bpm } = state.clock
  return {
    on: state.synth.on && layer.on,
    level: layer.level / 100,
    octave: layer.octave,
    zone: [layer.zone[0], layer.zone[1]],
    osc: { wave: layer.wave, ctrl: layer.ctrl / 10, coarse: layer.coarse, fine: layer.fine },
    oscEnv: {
      attack: attackSeconds(layer.oscEnv.attack),
      decay: decaySeconds(layer.oscEnv.decay),
      release: decaySeconds(layer.oscEnv.release),
      sustain: layer.oscEnv.decay >= ENV_STEPS,
      amount: layer.oscEnv.amount / 10,
      velocity: layer.oscEnv.velocity,
      toPitch: layer.oscEnv.toPitch,
    },
    filter: {
      on: layer.filter.on,
      type: layer.filter.type,
      freq: layer.filter.freq / 10,
      res: layer.filter.res / 10,
      envAmt: layer.filter.envAmt / 10,
      track: layer.filter.track / 3,
      drive: layer.filter.drive,
    },
    filterEnv: {
      attack: attackSeconds(layer.filterEnv.attack),
      decay: decaySeconds(layer.filterEnv.decay),
      release: decaySeconds(layer.filterEnv.release),
      sustain: layer.filterEnv.decay >= ENV_STEPS,
      velocity: layer.filterEnv.velocity,
    },
    ampEnv: {
      attack: attackSeconds(layer.ampEnv.attack),
      decay: decaySeconds(layer.ampEnv.decay),
      release: decaySeconds(layer.ampEnv.release),
      sustain: layer.ampEnv.decay >= ENV_STEPS,
      velocity: layer.ampEnv.velocity,
    },
    lfo: { wave: layer.lfo.wave, dest: layer.lfo.dest, rate: lfoCycleRate(layer, bpm), amount: layer.lfo.amount / 10 },
    voice: {
      mode: layer.voice.mode,
      priority: layer.voice.priority,
      glide: layer.voice.glide / 10,
      unison: layer.voice.unison,
      vibrato: layer.voice.vibrato,
      vibRate: layer.voice.vibRate,
      vibAmount: layer.voice.vibAmount / 10,
    },
    arp: {
      run: layer.arp.run,
      mode: layer.arp.mode,
      rate: arpStepRate(layer, bpm),
      range: arpOctaves(layer.arp.range),
      hardness: layer.arp.range / 10,
      direction: layer.arp.direction,
      // The Master Clock's own Keyboard Sync resets everything that is locked to it.
      kbSync: layer.arp.kbSync || (state.clock.kbSync && (layer.arp.sync || layer.lfo.sync)),
    },
    fx: chainSound(state.fx.chains[Chain.SynthA + index], bpm),
  }
}

/**
 * Reduce the canonical state to the sound state the kernel consumes. While a Store destination
 * is being chosen, the program stored there is what sounds; morphs are applied at the wheel's
 * and pedal's current positions.
 */
export function deriveSound(canonical: StageState): SoundState {
  const auditioned = canonical.ui.mode === 'store' && canonical.ui.audition ? { ...canonical, ...canonical.ui.audition } : canonical
  const state = applyMorphs(auditioned)
  const { bpm } = state.clock
  const stick = (state.pitchStick / 100) * 2

  const piano = (index: number): LayerSound => {
    const layer = state.piano.layers[index]
    const model = layerModel(layer)
    return {
      on: state.piano.on && layer.on,
      level: layer.level / 100,
      octave: layer.octave,
      source: model.source,
      family: model.family,
      timbre: layer.timbre < timbreCount(layer) ? layer.timbre : Timbre.Off,
      kbTouch: layer.kbTouch,
      dynComp: layer.dynComp,
      unison: layer.unison,
      softRelease: effectiveSoftRelease(layer),
      stringRes: effectiveStringRes(layer),
      sustain: state.piano.sustPed,
      bend: state.piano.pStick ? stick : 0,
      zone: [layer.zone[0], layer.zone[1]],
      fx: chainSound(state.fx.chains[Chain.PianoA + index], bpm),
    }
  }
  const organ = (index: number): OrganLayerSound => {
    const layer = state.organ.layers[index]
    return {
      on: state.organ.on && layer.on,
      level: layer.level / 100,
      octave: layer.octave,
      zone: [layer.zone[0], layer.zone[1]],
      model: layer.model,
      drawbars: layer.drawbars.slice(0, 9),
      vibOn: layer.vibOn,
      perc: { ...layer.perc },
    }
  }
  const active = activePoints(state)
  const point = (index: number) => ({ on: active[index], note: state.split.points[index].note, xfade: state.split.points[index].xfade })
  const synthBend = state.synth.pStick ? stick : 0
  return {
    master: state.master / 10,
    fxOn: state.fx.on,
    layers: [piano(0), piano(1)],
    rotary: {
      fast: state.rotary.fast,
      stop: state.rotary.stopMode,
      drive: state.rotary.drive / 10,
      ...(state.rotary.speed === undefined ? {} : { speed: state.rotary.speed }),
    },
    organ: {
      layers: [organ(0), organ(1)],
      vibType: state.organ.vibType,
      sustain: state.organ.sustPed,
      bend: state.organ.pStick ? stick : 0,
      toRotary: state.rotary.organ,
      fx: chainSound(state.fx.chains[Chain.Organ], bpm),
    },
    synth: {
      layers: [synthLayerSound(state, 0), synthLayerSound(state, 1), synthLayerSound(state, 2)],
      sustain: state.synth.sustPed,
      bend: synthBend,
      hold: state.synth.hold,
      wheel: state.wheel,
      pedal: state.pedal,
    },
    keyboard: {
      transpose: state.transpose.on ? state.transpose.semitones : 0,
      points: [point(0), point(1), point(2)],
    },
  }
}

export function typeName(layer: PianoLayerState): string {
  return PIANO_TYPES[layer.type] ?? 'Grand'
}

export function modelCount(layer: PianoLayerState): number {
  return modelsOf(layer.type).length
}
