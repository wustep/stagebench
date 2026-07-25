import { CONTROLS, control, type ControlSpec } from '../model/controls'
import { pianoType, timbreOptionsFor } from '../audio/pianoTypes'
import { waveformCount } from '../audio/synthVoice'
import { OSC_CATEGORIES } from '../audio/synthVoice'
import { LAYER_KEYS, type LayerId, type LayerKey, type PianoTypeId, type SynthLayerId } from '../audio/settings'
import {
  CROSSFADE_WIDTHS,
  LIVE_SLOTS,
  NAME_LENGTH,
  PROGRAMS_PER_PAGE,
  PROGRAM_PAGES,
  PROGRAM_SLOTS,
  SPLIT_POSITIONS,
  characterAt,
  characterIndex,
  clampSlot,
  defaultSplitPoints,
  emptyZones,
  programControlIds,
  snapshotsEqual,
  type FxSection,
  type MenuPage,
  type MorphAssignment,
  type MorphSource,
  type ProgramSnapshot,
  type SceneId,
  type SplitPoint,
} from './program'
import { FACTORY_PATCHES } from './factory'

/**
 * Normalised state for the whole control deck.
 *
 * `values` is what the panel shows. Most section controls are *focus scoped*: the hardware has
 * one set of knobs per section that edits whichever layer has focus, so this store keeps one bank
 * of those values per layer (seven of them across Organ, Piano and Synth) and swaps them when
 * focus changes. Group mode writes to both piano layers at once, and a unit switched to Global
 * writes to every layer, exactly as the effects spec describes.
 *
 * Everything a program stores lives here and nowhere else, which is what makes `snapshotOf` a
 * complete, honest picture of the instrument.
 */
export type HardwareValues = Readonly<Record<string, number>>

export type GlobalUnitId = 'delay' | 'compressor' | 'reverb'

export const GLOBAL_UNIT_BY_CONTROL: Readonly<Record<string, GlobalUnitId>> = {
  'fx.delay.on': 'delay',
  'fx.comp.on': 'compressor',
  'fx.reverb.on': 'reverb',
}

/* ------------------------------------------------------------------ scoping */

export type ControlScope = 'fx' | 'piano' | 'organ' | 'synth' | null

const PIANO_SCOPED = new Set([
  'piano.type',
  'piano.model',
  'piano.timbre',
  'piano.acoustics',
  'piano.unison',
  'piano.kb-touch',
  'piano.dyn-comp',
  'piano.sustped',
])

const ORGAN_SCOPED = new Set(['organ.model', 'organ.vibchorus.on', 'organ.preset'])

const SYNTH_UNSCOPED = new Set(['synth.section-on', 'synth.octave-down', 'synth.octave-up'])

const FX_UNSCOPED = new Set([
  'fx.section-on',
  'fx.shift',
  'fx.focus.organ',
  'fx.focus.piano',
  'fx.focus.synth',
])

/** Which layer bank a control is stored in, or null when it is global to the instrument. */
export function scopeOf(id: string): ControlScope {
  if (id.startsWith('fx.')) return FX_UNSCOPED.has(id) ? null : 'fx'
  if (PIANO_SCOPED.has(id)) return 'piano'
  if (ORGAN_SCOPED.has(id) || id.startsWith('organ.drawbar.') || id.startsWith('organ.perc.')) return 'organ'
  if (id.startsWith('synth.')) {
    if (SYNTH_UNSCOPED.has(id)) return null
    if (/^synth\.[abc]\.(on|level)$/.test(id)) return null
    return 'synth'
  }
  return null
}

/** Every control that is stored per layer rather than per instrument. */
export const LAYER_SCOPED_IDS: readonly string[] = CONTROLS.filter((spec) => scopeOf(spec.id) !== null).map(
  (spec) => spec.id,
)

const LAYER_SCOPED = new Set(LAYER_SCOPED_IDS)

export function isLayerScoped(id: string): boolean {
  return LAYER_SCOPED.has(id)
}

/** Controls that belong to a globally-switchable unit, so a global write reaches every layer. */
export function globalUnitOf(id: string): GlobalUnitId | null {
  if (id.startsWith('fx.delay.')) return 'delay'
  if (id.startsWith('fx.comp.')) return 'compressor'
  if (id.startsWith('fx.reverb.')) return 'reverb'
  return null
}

export const PIANO_LAYERS: readonly LayerId[] = ['a', 'b']

/** Octave shift travel: ±12 semitones for every layered section. */
export const OCTAVE_LIMIT = 12

/* ------------------------------------------------------------------ synth menus */

/** The three dials under the Synth OLED, and what they edit on each page. */
export const MENU_DIAL_IDS: readonly string[] = ['synth.osc.type', 'synth.osc.category', 'synth.osc.waveform']

export const MENU_PAGES: readonly MenuPage[] = ['osc', 'oscEnv', 'filterEnv', 'ampEnv']

export const MENU_LABELS: Readonly<Record<MenuPage, readonly string[]>> = {
  osc: ['Filter Drive', 'Category', 'Waveform'],
  oscEnv: ['Osc Attack', 'Osc Decay', 'Osc Release'],
  filterEnv: ['Filter Attack', 'Filter Decay', 'Filter Release'],
  ampEnv: ['Amp Attack', 'Amp Decay', 'Amp Release'],
}

export type MenuBank = Record<MenuPage, number[]>

function initialMenu(): MenuBank {
  return {
    osc: [0, 0, 2],
    oscEnv: [0, 5, 2],
    filterEnv: [0, 4, 2],
    ampEnv: [0, 10, 2],
  }
}

/** Range of one menu dial, which depends on the page and on the selected category. */
export function menuDialRange(page: MenuPage, dial: number, category: number): { min: number; max: number } {
  if (page !== 'osc') return { min: 0, max: 10 }
  if (dial === 0) return { min: 0, max: 3 }
  if (dial === 1) return { min: 0, max: OSC_CATEGORIES.length - 1 }
  return { min: 0, max: waveformCount(OSC_CATEGORIES[clampIndex(category, OSC_CATEGORIES.length)]) - 1 }
}

/* ------------------------------------------------------------------ synth secondaries */

/**
 * The Synth parameters the panel reaches through SHIFT, one set per synth layer. Each is a real
 * printed shift legend, not an invented control.
 */
export interface SynthExtra {
  /** Filter keyboard tracking Off / 1-3 / 2-3 / 1. */
  tracking: number
  /** Note priority Off / Low / High. */
  priority: number
  /** Arpeggiator direction Up / Down / Up-Down / Random. */
  arpDirection: number
  arpSync: number
  lfoSync: number
  oscEnvVelocity: number
  filterEnvVelocity: number
  ampVelocity: number
  /** Vibrato menu preset index; see `VIBRATO_PRESETS`. */
  vibratoPreset: number
}

/** Vibrato menu: rate 2.0–8.0 Hz and amount 0–10, offered as four documented pairs. */
export const VIBRATO_PRESETS: readonly { rate: number; amount: number }[] = [
  { rate: 2, amount: 0.25 },
  { rate: 5.5, amount: 0.5 },
  { rate: 6.5, amount: 0.75 },
  { rate: 8, amount: 1 },
]

function initialExtra(): SynthExtra {
  return {
    tracking: 1,
    priority: 0,
    arpDirection: 0,
    arpSync: 0,
    lfoSync: 0,
    oscEnvVelocity: 0,
    filterEnvVelocity: 0,
    ampVelocity: 2,
    vibratoPreset: 1,
  }
}

/* ------------------------------------------------------------------ deck state */

export type StoreStage = 'idle' | 'naming' | 'destination'

export interface DeckState {
  /** What the panel currently displays — the focused layers' view of the scoped controls. */
  readonly values: HardwareValues
  /** Stored per-layer values of the focus-scoped controls, one bank per playable layer. */
  readonly banks: Readonly<Record<LayerKey, HardwareValues>>
  /** Piano layer focus. Kept under its Phase 2 name because it is the piano section's focus. */
  readonly focus: LayerId
  readonly organFocus: 'a' | 'b'
  readonly synthFocus: SynthLayerId
  /** Which section the Layer Effects knobs are editing. */
  readonly fxSection: FxSection
  /** Piano group mode: both piano layers share one effect setting. */
  readonly group: boolean
  readonly globals: Readonly<Record<GlobalUnitId, boolean>>
  readonly octaves: Readonly<Record<LayerId, number>>
  readonly organOctaves: Readonly<Record<'a' | 'b', number>>
  readonly synthOctaves: Readonly<Record<SynthLayerId, number>>
  /** Timestamp of the last delay tap, for tap tempo. */
  readonly lastTapAt: number | null

  readonly menu: Readonly<Record<SynthLayerId, MenuBank>>
  readonly menuPage: MenuPage
  readonly synthExtra: Readonly<Record<SynthLayerId, SynthExtra>>

  readonly programs: readonly (ProgramSnapshot | null)[]
  readonly live: readonly (ProgramSnapshot | null)[]
  readonly slot: number
  readonly liveSlot: number
  readonly liveMode: boolean
  readonly storeStage: StoreStage
  readonly storeDestination: number
  /**
   * The program being stored, captured when STORE is armed. Browsing the destination auditions
   * that destination's sound, so the payload cannot be read back off the panel at confirm time.
   */
  readonly storePayload: ProgramSnapshot | null
  readonly nameDraft: string
  readonly nameCursor: number
  readonly listView: boolean

  readonly split: { readonly on: boolean; readonly points: readonly SplitPoint[] }
  /** 0 = not editing, 1–3 = editing the Low / Mid / High point. */
  readonly splitEdit: number
  readonly zones: Readonly<Record<LayerKey, { readonly from: number; readonly to: number }>>

  readonly scene: SceneId
  readonly scenes: Readonly<Record<SceneId, Readonly<Record<LayerKey, boolean>>>>

  readonly morphs: Readonly<Record<MorphSource, Readonly<Record<string, MorphAssignment>>>>
  /** The morph source currently latched for assignment, or null. */
  readonly morphArm: MorphSource | null
  readonly morphStart: HardwareValues | null
  /** Virtual Control Pedal position, 0–1; also driven by MIDI CC 11. */
  readonly pedal: number

  readonly clock: { readonly bpm: number; readonly keyboardSync: boolean }
  readonly clockTaps: readonly number[]
  readonly clockSet: boolean
  readonly transpose: number
  /** Increments on every Panic press, so the engine can react to a repeat press. */
  readonly panicCount: number
}

export function initialHardwareValues(): HardwareValues {
  const values: Record<string, number> = {}
  for (const spec of CONTROLS) values[spec.id] = spec.initial
  return values
}

function scopedSlice(values: HardwareValues, scope: ControlScope): HardwareValues {
  const slice: Record<string, number> = {}
  for (const id of LAYER_SCOPED_IDS) {
    if (scopeOf(id) === scope || scopeOf(id) === 'fx') slice[id] = values[id]
  }
  return slice
}

function initialBanks(values: HardwareValues): Record<LayerKey, HardwareValues> {
  const banks = {} as Record<LayerKey, HardwareValues>
  for (const key of LAYER_KEYS) {
    banks[key] = scopedSlice(values, key.split('.')[0] as ControlScope)
  }
  return banks
}

function initialScenes(): Record<SceneId, Record<LayerKey, boolean>> {
  const build = () => {
    const scene = {} as Record<LayerKey, boolean>
    for (const key of LAYER_KEYS) scene[key] = false
    return scene
  }
  return { I: build(), II: build() }
}

export function initialDeckState(): DeckState {
  const values = initialHardwareValues()
  const menu = { a: initialMenu(), b: initialMenu(), c: initialMenu() }
  const extra = { a: initialExtra(), b: initialExtra(), c: initialExtra() }
  const scenes = initialScenes()
  for (const key of LAYER_KEYS) {
    const on = values[`${key.split('.')[0]}.${key.split('.')[1]}.on`] >= 0.5
    scenes.I[key] = on
    scenes.II[key] = on
  }
  const base: DeckState = {
    values,
    banks: initialBanks(values),
    focus: 'a',
    organFocus: 'a',
    synthFocus: 'a',
    fxSection: 'piano',
    group: false,
    globals: { delay: false, compressor: false, reverb: false },
    octaves: { a: 0, b: 0 },
    organOctaves: { a: 0, b: 0 },
    synthOctaves: { a: 0, b: 0, c: 0 },
    lastTapAt: null,
    menu,
    menuPage: 'osc',
    synthExtra: extra,
    programs: Array.from<ProgramSnapshot | null>({ length: PROGRAM_SLOTS }).fill(null),
    live: Array.from<ProgramSnapshot | null>({ length: LIVE_SLOTS }).fill(null),
    slot: 0,
    liveSlot: 0,
    liveMode: false,
    storeStage: 'idle',
    storeDestination: 0,
    storePayload: null,
    nameDraft: '',
    nameCursor: 0,
    listView: false,
    split: { on: false, points: defaultSplitPoints() },
    splitEdit: 0,
    zones: emptyZones(),
    scene: 'I',
    scenes,
    morphs: { wheel: {}, pedal: {} },
    morphArm: null,
    morphStart: null,
    pedal: 0,
    clock: { bpm: 120, keyboardSync: false },
    clockTaps: [],
    clockSet: false,
    transpose: 0,
    panicCount: 0,
  }
  // Slot 1.1 is the factory program the instrument powers up on, and it is exactly the panel's
  // printed initial state, so what the silk screen says is what the engine starts from.
  const programs = Array.from<ProgramSnapshot | null>({ length: PROGRAM_SLOTS }).fill(null)
  FACTORY_PATCHES.forEach((patch, index) => {
    if (index >= PROGRAM_SLOTS) return
    let deck = base
    for (const [id, value] of Object.entries(patch.values ?? {})) {
      deck = withValue(deck, id, clampToSpec(control(id), value))
    }
    for (const [key, overrides] of Object.entries(patch.perLayer ?? {})) {
      const [section, layer] = key.split('.')
      deck = focusSection(deck, section as FxSection, layer)
      for (const [id, value] of Object.entries(overrides)) {
        deck = withValue(deck, id, clampToSpec(control(id), value))
      }
    }
    if (patch.menu) {
      const bank = { ...deck.menu[deck.synthFocus] }
      for (const [page, dials] of Object.entries(patch.menu)) {
        bank[page as MenuPage] = [...(dials as readonly number[])]
      }
      deck = syncMenuValues({ ...deck, menu: { ...deck.menu, [deck.synthFocus]: bank } })
    }
    if (patch.split) deck = { ...deck, split: { on: patch.split.on, points: [...patch.split.points] } }
    if (patch.zones) deck = { ...deck, zones: { ...deck.zones, ...patch.zones } }
    if (patch.transpose !== undefined) deck = { ...deck, transpose: patch.transpose }
    if (patch.bpm !== undefined) deck = { ...deck, clock: { ...deck.clock, bpm: patch.bpm } }
    deck = { ...deck, scenes: { I: captureScene(deck, 'I'), II: captureScene(deck, 'II') } }
    programs[index] = snapshotOf(deck, patch.name)
  })
  return { ...base, programs }
}

export function clampToSpec(spec: ControlSpec, value: number): number {
  if (Number.isNaN(value)) return spec.initial
  const stepped = spec.step > 0 ? Math.round(value / spec.step) * spec.step : value
  const clamped = Math.min(spec.max, Math.max(spec.min, stepped))
  // Guard against float dust from the step quantisation (0.30000000000000004 and friends).
  return Math.round(clamped * 1e6) / 1e6
}

/**
 * The value a control takes when it is pressed / activated.
 * - option buttons advance through their printed indicator options and wrap;
 * - toggle buttons flip;
 * - momentary buttons return to 0 (they carry no latched state);
 * - continuous controls are unchanged by a press.
 */
export function activatedValue(spec: ControlSpec, currentValue: number, optionCount?: number): number {
  if (spec.options) {
    const count = Math.max(1, Math.min(optionCount ?? spec.options.length, spec.options.length))
    return (Math.round(currentValue) + 1) % count
  }
  if (spec.toggle) return currentValue >= 0.5 ? 0 : 1
  if (spec.momentary) return 0
  return currentValue
}

export function nudgeValue(spec: ControlSpec, currentValue: number, steps: number): number {
  if (spec.options) {
    const count = spec.options.length
    return (Math.round(currentValue) + ((steps % count) + count)) % count
  }
  if (spec.toggle || spec.momentary) return steps > 0 ? 1 : 0
  return clampToSpec(spec, currentValue + steps * spec.step)
}

export type HardwareAction =
  | { type: 'set'; id: string; value: number }
  | { type: 'activate'; id: string; at?: number }
  | { type: 'nudge'; id: string; steps: number }
  | { type: 'focus'; layer: LayerId }
  | { type: 'pedal'; value: number }
  | { type: 'live-restore'; slots: readonly (ProgramSnapshot | null)[] }
  | { type: 'reset' }

const TAP_MIN_MS = 120
const TAP_MAX_MS = 2000

/** Tap tempo: the interval between two taps becomes the delay time, as a 0–10 knob value. */
export function tapTempoValue(previousAt: number | null, at: number, min = 0.06, max = 1.1): number | null {
  if (previousAt === null) return null
  const intervalMs = at - previousAt
  if (intervalMs < TAP_MIN_MS || intervalMs > TAP_MAX_MS) return null
  const clamped = Math.min(max, Math.max(min, intervalMs / 1000))
  return ((clamped - min) / (max - min)) * 10
}

/** Master Clock tap: four or more taps set the tempo from their average interval (manual p. 40). */
export function bpmFromTaps(taps: readonly number[]): number | null {
  if (taps.length < 4) return null
  const intervals: number[] = []
  for (let index = 1; index < taps.length; index += 1) intervals.push(taps[index] - taps[index - 1])
  const mean = intervals.reduce((sum, value) => sum + value, 0) / intervals.length
  if (mean <= 0) return null
  const bpm = 60000 / mean
  if (bpm < 30 || bpm > 300) return null
  return Math.round(bpm)
}

/* ------------------------------------------------------------------ helpers */

export function layerKeyFor(section: FxSection, layer: string): LayerKey {
  return `${section}.${layer}` as LayerKey
}

export function focusedLayerOf(state: DeckState, section: FxSection): string {
  if (section === 'organ') return state.organFocus
  if (section === 'synth') return state.synthFocus
  return state.focus
}

function bankKeyForScope(state: DeckState, scope: ControlScope): LayerKey | null {
  if (scope === null) return null
  if (scope === 'fx') return layerKeyFor(state.fxSection, focusedLayerOf(state, state.fxSection))
  return layerKeyFor(scope, focusedLayerOf(state, scope))
}

function withValue(state: DeckState, id: string, value: number): DeckState {
  if (state.values[id] === value) return state
  const values = { ...state.values, [id]: value }
  const scope = scopeOf(id)
  if (scope === null) return { ...state, values }

  const unit = globalUnitOf(id)
  const globalOn = unit ? state.globals[unit] : false
  const banks = { ...state.banks }
  const key = bankKeyForScope(state, scope)
  if (key) banks[key] = { ...banks[key], [id]: value }
  if (globalOn) {
    // A globally switched unit is shared by every layer of the instrument.
    for (const layerKey of LAYER_KEYS) banks[layerKey] = { ...banks[layerKey], [id]: value }
  } else if (state.group && scope !== 'organ' && scope !== 'synth') {
    for (const layer of PIANO_LAYERS) {
      banks[`piano.${layer}`] = { ...banks[`piano.${layer}`], [id]: value }
    }
  }
  return { ...state, values, banks }
}

function focusSection(state: DeckState, section: FxSection, layer: string): DeckState {
  const current = focusedLayerOf(state, section)
  const fxMoved = state.fxSection !== section
  if (current === layer && !fxMoved) return { ...state, fxSection: section }
  // Save the outgoing layer's view, then swap in the incoming layer's bank.
  const banks = { ...state.banks }
  const outgoingFx = layerKeyFor(state.fxSection, focusedLayerOf(state, state.fxSection))
  banks[outgoingFx] = { ...banks[outgoingFx], ...pick(state.values, 'fx') }
  const outgoingSection = layerKeyFor(section, current)
  banks[outgoingSection] = { ...banks[outgoingSection], ...pick(state.values, section) }

  const next: DeckState = {
    ...state,
    banks,
    fxSection: section,
    focus: section === 'piano' ? (layer as LayerId) : state.focus,
    organFocus: section === 'organ' ? (layer as 'a' | 'b') : state.organFocus,
    synthFocus: section === 'synth' ? (layer as SynthLayerId) : state.synthFocus,
  }
  const incoming = layerKeyFor(section, layer)
  const values = {
    ...next.values,
    ...banks[incoming],
  }
  return syncMenuValues({ ...next, values })
}

function pick(values: HardwareValues, scope: ControlScope): HardwareValues {
  const slice: Record<string, number> = {}
  for (const id of LAYER_SCOPED_IDS) if (scopeOf(id) === scope) slice[id] = values[id]
  return slice
}

/** The three encoders always show the focused synth layer's current menu page. */
function syncMenuValues(state: DeckState): DeckState {
  const page = state.menu[state.synthFocus][state.menuPage]
  const values = { ...state.values }
  MENU_DIAL_IDS.forEach((id, index) => {
    values[id] = page[index]
  })
  return { ...state, values }
}

function clampIndex(value: number, count: number): number {
  return Math.min(count - 1, Math.max(0, Math.round(value)))
}

/**
 * Timbre only offers Dyno 1 / Dyno 2 on electric piano types, so the button wraps after four
 * options on an acoustic type — the panel and the engine agree about which options exist.
 */
function timbreOptionCount(values: HardwareValues): number {
  return timbreOptionsFor(layerTypeId(values)).length
}

/**
 * Keep the piano selection inside what the selected type actually offers: a timbre a type change
 * has made unavailable (Dyno on a grand) falls back to Off, and the MODEL dial stops at the last
 * model this type has instead of counting up through positions that select nothing.
 */
function reconcilePianoSelection(state: DeckState): DeckState {
  let next = state
  const count = timbreOptionCount(next.values)
  if (Math.round(next.values['piano.timbre'] ?? 0) >= count) next = withValue(next, 'piano.timbre', 0)
  const models = pianoType(layerTypeId(next.values)).models.length
  const model = Math.round(next.values['piano.model'] ?? 0)
  if (model > models - 1) next = withValue(next, 'piano.model', models - 1)
  return next
}

/* ------------------------------------------------------------------ programs */

export function snapshotOf(state: DeckState, name: string): ProgramSnapshot {
  const values: Record<string, number> = {}
  for (const id of programControlIds()) values[id] = state.values[id]
  const banks = {} as Record<LayerKey, Record<string, number>>
  for (const key of LAYER_KEYS) banks[key] = { ...state.banks[key] }
  const octaves = {} as Record<LayerKey, number>
  for (const key of LAYER_KEYS) octaves[key] = octaveOf(state, key)
  return {
    name,
    values,
    banks,
    octaves,
    focus: { organ: state.organFocus, piano: state.focus, synth: state.synthFocus },
    fxSection: state.fxSection,
    group: state.group,
    globals: { ...state.globals },
    menu: menuFor(state),
    menuPage: state.menuPage,
    synthExtra: {
      a: { ...state.synthExtra.a },
      b: { ...state.synthExtra.b },
      c: { ...state.synthExtra.c },
    },
    split: { on: state.split.on, points: state.split.points.map((point) => ({ ...point })) },
    zones: Object.fromEntries(
      LAYER_KEYS.map((key) => [key, { ...state.zones[key] }]),
    ) as ProgramSnapshot['zones'],
    scene: state.scene,
    scenes: {
      I: { ...state.scenes.I },
      II: { ...state.scenes.II },
    },
    morphs: {
      wheel: { ...state.morphs.wheel },
      pedal: { ...state.morphs.pedal },
    },
    clock: { ...state.clock },
    transpose: state.transpose,
  }
}

function menuFor(state: DeckState): Record<MenuPage, number[]> {
  // The menu banks are per synth layer; the snapshot keeps all three under one key per page so
  // recall restores every layer's envelopes, not only the focused one.
  const merged = {} as Record<MenuPage, number[]>
  for (const page of MENU_PAGES) {
    merged[page] = [
      ...state.menu.a[page],
      ...state.menu.b[page],
      ...state.menu.c[page],
    ]
  }
  return merged
}

function octaveOf(state: DeckState, key: LayerKey): number {
  const [section, layer] = key.split('.')
  if (section === 'piano') return state.octaves[layer as LayerId]
  if (section === 'organ') return state.organOctaves[layer as 'a' | 'b']
  return state.synthOctaves[layer as SynthLayerId]
}

export function applySnapshot(state: DeckState, snapshot: ProgramSnapshot): DeckState {
  const values: Record<string, number> = { ...state.values, ...snapshot.values }
  const banks = {} as Record<LayerKey, HardwareValues>
  for (const key of LAYER_KEYS) banks[key] = { ...snapshot.banks[key] }
  const menu = { a: initialMenu(), b: initialMenu(), c: initialMenu() }
  for (const page of MENU_PAGES) {
    const merged = snapshot.menu[page] ?? []
    menu.a[page] = merged.slice(0, 3) as number[]
    menu.b[page] = merged.slice(3, 6) as number[]
    menu.c[page] = merged.slice(6, 9) as number[]
  }
  const next: DeckState = {
    ...state,
    values,
    banks,
    focus: snapshot.focus.piano,
    organFocus: snapshot.focus.organ,
    synthFocus: snapshot.focus.synth,
    fxSection: snapshot.fxSection,
    group: snapshot.group,
    globals: { ...state.globals, ...(snapshot.globals as Record<GlobalUnitId, boolean>) },
    octaves: { a: snapshot.octaves['piano.a'], b: snapshot.octaves['piano.b'] },
    organOctaves: { a: snapshot.octaves['organ.a'], b: snapshot.octaves['organ.b'] },
    synthOctaves: {
      a: snapshot.octaves['synth.a'],
      b: snapshot.octaves['synth.b'],
      c: snapshot.octaves['synth.c'],
    },
    menu,
    menuPage: snapshot.menuPage,
    synthExtra: {
      a: { ...initialExtra(), ...(snapshot.synthExtra.a as Partial<SynthExtra>) },
      b: { ...initialExtra(), ...(snapshot.synthExtra.b as Partial<SynthExtra>) },
      c: { ...initialExtra(), ...(snapshot.synthExtra.c as Partial<SynthExtra>) },
    },
    split: { on: snapshot.split.on, points: snapshot.split.points.map((point) => ({ ...point })) },
    zones: Object.fromEntries(LAYER_KEYS.map((key) => [key, { ...snapshot.zones[key] }])) as DeckState['zones'],
    scene: snapshot.scene,
    scenes: { I: { ...snapshot.scenes.I }, II: { ...snapshot.scenes.II } },
    morphs: { wheel: { ...snapshot.morphs.wheel }, pedal: { ...snapshot.morphs.pedal } },
    clock: { ...snapshot.clock },
    transpose: snapshot.transpose,
    morphArm: null,
    morphStart: null,
    splitEdit: 0,
    storeStage: 'idle',
  }
  return syncMenuValues(next)
}

/** Transpose is active exactly when its printed ON/SET indicator is lit. */
export function transposeActive(state: DeckState): boolean {
  return (state.values['program.transpose'] ?? 0) >= 0.5
}

export function currentSnapshot(state: DeckState): ProgramSnapshot {
  return snapshotOf(state, storedProgram(state)?.name ?? 'Init')
}

export function storedProgram(state: DeckState): ProgramSnapshot | null {
  return state.liveMode ? state.live[state.liveSlot] : state.programs[state.slot]
}

/** The truthful dirty indicator: the panel differs from what the selected slot holds. */
export function isDirty(state: DeckState): boolean {
  const stored = storedProgram(state)
  if (!stored) return false
  return !snapshotsEqual(snapshotOf(state, stored.name), stored)
}

function autoStoreLive(state: DeckState): DeckState {
  if (!state.liveMode) return state
  const live = [...state.live]
  live[state.liveSlot] = snapshotOf(state, live[state.liveSlot]?.name ?? `Live ${state.liveSlot + 1}`)
  return { ...state, live }
}

function selectProgram(state: DeckState, slot: number): DeckState {
  const clamped = clampSlot(slot)
  const snapshot = state.programs[clamped]
  const base = { ...state, slot: clamped }
  // Selecting another program discards unstored edits (manual p. 13).
  return snapshot ? { ...applySnapshot(base, snapshot), slot: clamped } : base
}

function selectLive(state: DeckState, slot: number): DeckState {
  const clamped = Math.min(LIVE_SLOTS - 1, Math.max(0, Math.round(slot)))
  const snapshot = state.live[clamped]
  const base = { ...state, liveSlot: clamped }
  return snapshot ? { ...applySnapshot(base, snapshot), liveSlot: clamped } : base
}

/* ------------------------------------------------------------------ splits and zones */

export function activeSplitPoints(state: DeckState): readonly SplitPoint[] {
  if (!state.split.on) return []
  return state.split.points.filter((point) => point.crossfade >= 0 && point.note > 0 && point.enabled)
}

export function zoneCount(state: DeckState): number {
  return activeSplitPoints(state).length + 1
}

function cycleZone(state: DeckState, key: LayerKey): DeckState {
  const count = zoneCount(state)
  const current = state.zones[key]
  const from = Math.min(count - 1, Math.max(0, current.from))
  const to = Math.min(count - 1, Math.max(from, current.to))
  const full = { from: 0, to: count - 1 }
  let next: { from: number; to: number }
  if (from === 0 && to === count - 1) next = { from: 0, to: 0 }
  else if (from === to && from < count - 1) next = { from: from + 1, to: from + 1 }
  else next = full
  return { ...state, zones: { ...state.zones, [key]: next } }
}

/* ------------------------------------------------------------------ scenes */

function layerOnId(key: LayerKey): string {
  const [section, layer] = key.split('.')
  return `${section}.${layer}.on`
}

function captureScene(state: DeckState, scene: SceneId): Record<LayerKey, boolean> {
  const captured = {} as Record<LayerKey, boolean>
  for (const key of LAYER_KEYS) captured[key] = (state.values[layerOnId(key)] ?? 0) >= 0.5
  void scene
  return captured
}

function switchScene(state: DeckState, scene: SceneId): DeckState {
  if (scene === state.scene) return state
  // Save the leaving scene's enable state, then apply the arriving scene's.
  const scenes = { ...state.scenes, [state.scene]: captureScene(state, state.scene) }
  const target = scenes[scene]
  let next: DeckState = { ...state, scenes, scene }
  for (const key of LAYER_KEYS) {
    next = withValue(next, layerOnId(key), target[key] ? 1 : 0)
  }
  return next
}

/* ------------------------------------------------------------------ morph */

export function morphSourceOf(id: string): MorphSource | null {
  if (id === 'program.morph.wheel') return 'wheel'
  if (id === 'program.morph.ctrl-pedal') return 'pedal'
  return null
}

/** Controls a morph may be assigned to (programs spec, `morph.destinations`). */
export function isMorphDestination(id: string): boolean {
  if (id.startsWith('organ.drawbar.')) return true
  return [
    'organ.a.level',
    'organ.b.level',
    'piano.a.level',
    'piano.b.level',
    'synth.a.level',
    'synth.b.level',
    'synth.c.level',
    'perf.rotary.speed',
    'synth.lfo.rate',
    'synth.lfo.mod-amt',
    'synth.osc.ctrl',
    'synth.filter.freq',
    'synth.filter.res',
    'synth.arp.rate',
    'fx.mod1.rate',
    'fx.mod1.amount',
    'fx.mod2.amount',
    'fx.delay.tempo',
    'fx.delay.feedback',
    'fx.delay.dry-wet',
    'fx.amp.mid',
    'fx.amp.drive',
    'fx.reverb.dry-wet',
  ].includes(id)
}

function recordMorph(state: DeckState, id: string, value: number): DeckState {
  const source = state.morphArm
  if (!source || !isMorphDestination(id) || !state.morphStart) return state
  const from = state.morphStart[id] ?? value
  const assignments = { ...state.morphs[source] }
  if (Math.abs(from - value) < 1e-9) {
    // Re-holding the source and zeroing a control removes that single assignment (manual p. 39).
    delete assignments[id]
  } else {
    assignments[id] = { from, to: value }
  }
  return { ...state, morphs: { ...state.morphs, [source]: assignments } }
}

/**
 * The panel values a morph source produces at its current position: every assignment is
 * interpolated from its start to its end value.
 */
export function morphedValues(state: DeckState): HardwareValues {
  const wheel = Math.min(1, Math.max(0, state.values['perf.mod-wheel'] ?? 0))
  const pedal = Math.min(1, Math.max(0, state.pedal))
  const sources: [MorphSource, number][] = [
    ['wheel', wheel],
    ['pedal', pedal],
  ]
  let changed = false
  const values: Record<string, number> = { ...state.values }
  for (const [source, position] of sources) {
    if (position <= 0) continue
    for (const [id, assignment] of Object.entries(state.morphs[source])) {
      values[id] = assignment.from + (assignment.to - assignment.from) * position
      changed = true
    }
  }
  return changed ? values : state.values
}

/* ------------------------------------------------------------------ reducer */

export function deckReducer(state: DeckState, action: HardwareAction): DeckState {
  return syncDial(reduce(state, action))
}

/**
 * The Program dial's reported value is whatever it is currently editing, so `aria-valuenow` and
 * the OLED always agree with what turning it would change.
 */
function syncDial(state: DeckState): DeckState {
  const value = clampToSpec(control('program.dial'), dialDisplayValue(state))
  if (state.values['program.dial'] === value) return state
  return { ...state, values: { ...state.values, 'program.dial': value } }
}

function dialDisplayValue(state: DeckState): number {
  if (state.storeStage === 'naming') return characterIndex(state.nameDraft[state.nameCursor] ?? ' ')
  if (state.storeStage === 'destination') return state.storeDestination
  if (transposeActive(state)) return state.transpose + 6
  if (state.clockSet) return state.clock.bpm
  if (state.splitEdit > 0) {
    const note = state.split.points[state.splitEdit - 1].note
    const index = SPLIT_POSITIONS.indexOf(note)
    return index < 0 ? 4 : index
  }
  return state.liveMode ? state.liveSlot : state.slot
}

function reduce(state: DeckState, action: HardwareAction): DeckState {
  switch (action.type) {
    case 'reset':
      return initialDeckState()
    case 'pedal':
      return { ...state, pedal: Math.min(1, Math.max(0, action.value)) }
    case 'live-restore': {
      const live = [...state.live]
      action.slots.forEach((slot, index) => {
        if (index < LIVE_SLOTS) live[index] = slot
      })
      return { ...state, live }
    }
    case 'focus':
      return focusSection(state, 'piano', action.layer)
    case 'set': {
      const spec = control(action.id)
      if (MENU_DIAL_IDS.includes(action.id)) return setMenuDial(state, action.id, action.value)
      if (action.id === 'program.dial') {
        return dialBy(state, Math.round(action.value) - Math.round(state.values['program.dial'] ?? 0))
      }
      const value = clampToSpec(spec, action.value)
      const moved = recordMorph(state, action.id, value)
      return autoStoreLive(reconcilePianoSelection(withValue(moved, action.id, value)))
    }
    case 'nudge': {
      const spec = control(action.id)
      if (MENU_DIAL_IDS.includes(action.id)) {
        const index = MENU_DIAL_IDS.indexOf(action.id)
        const current = state.menu[state.synthFocus][state.menuPage][index]
        return setMenuDial(state, action.id, current + action.steps)
      }
      if (action.id === 'program.dial') return dialBy(state, action.steps)
      const value = nudgeValue(spec, state.values[action.id] ?? spec.initial, action.steps)
      const moved = recordMorph(state, action.id, value)
      return autoStoreLive(reconcilePianoSelection(withValue(moved, action.id, value)))
    }
    case 'activate':
      return autoStoreLive(activateControl(state, action.id, action.at ?? 0))
  }
}

function setMenuDial(state: DeckState, id: string, raw: number): DeckState {
  const index = MENU_DIAL_IDS.indexOf(id)
  const bank = state.menu[state.synthFocus]
  const category = bank.osc[1]
  const range = menuDialRange(state.menuPage, index, category)
  const value = Math.min(range.max, Math.max(range.min, Math.round(raw)))
  const page = [...bank[state.menuPage]]
  page[index] = value
  let menu = {
    ...state.menu,
    [state.synthFocus]: { ...bank, [state.menuPage]: page },
  }
  // Changing category re-clamps the waveform to the list that category actually has.
  if (state.menuPage === 'osc' && index === 1) {
    const waveforms = menuDialRange('osc', 2, value)
    const clamped = Math.min(waveforms.max, page[2])
    menu = { ...menu, [state.synthFocus]: { ...menu[state.synthFocus], osc: [page[0], value, clamped] } }
  }
  return autoStoreLive(syncMenuValues({ ...state, menu }))
}

/** The Program dial edits whatever mode the panel is currently in. */
function dialBy(state: DeckState, steps: number): DeckState {
  if (state.storeStage === 'naming') {
    const draft = state.nameDraft.padEnd(state.nameCursor + 1, ' ').split('')
    draft[state.nameCursor] = characterAt(characterIndex(draft[state.nameCursor] ?? ' ') + steps)
    return { ...state, nameDraft: draft.join('').slice(0, NAME_LENGTH) }
  }
  if (state.storeStage === 'destination') {
    const limit = state.liveMode ? LIVE_SLOTS : PROGRAM_SLOTS
    const destination = Math.min(limit - 1, Math.max(0, state.storeDestination + steps))
    // The destination becomes audible while browsing, for auditioning (manual p. 13).
    const preview = state.liveMode ? state.live[destination] : state.programs[destination]
    const audition = preview ? applySnapshot(state, preview) : state
    return { ...audition, storeStage: 'destination', storeDestination: destination }
  }
  if (transposeActive(state)) {
    // TRANSPOSE ON/SET: while transpose is on, the Program dial sets the amount (manual p. 40).
    return { ...state, transpose: Math.min(6, Math.max(-6, state.transpose + steps)) }
  }
  if (state.clockSet) {
    return { ...state, clock: { ...state.clock, bpm: Math.min(300, Math.max(30, state.clock.bpm + steps)) } }
  }
  if (state.splitEdit > 0) {
    const index = state.splitEdit - 1
    const point = state.split.points[index]
    const position = SPLIT_POSITIONS.indexOf(point.note)
    const nextIndex = Math.min(SPLIT_POSITIONS.length - 1, Math.max(0, (position < 0 ? 4 : position) + steps))
    // Setting a point's key is what puts it in play, so a split can be built one point at a time.
    const points = state.split.points.map((entry, i) =>
      i === index ? { ...entry, note: SPLIT_POSITIONS[nextIndex], enabled: true } : entry,
    )
    return { ...state, split: { ...state.split, points } }
  }
  if (state.liveMode) return selectLive(state, state.liveSlot + steps)
  return selectProgram(state, state.slot + steps)
}

function activateControl(state: DeckState, id: string, at: number): DeckState {
  const spec = control(id)
  const shifted = (state.values['fx.shift'] ?? 0) >= 0.5 || (state.values['program.shift'] ?? 0) >= 0.5

  const clearShift = (next: DeckState): DeckState => {
    let cleared = next
    if ((state.values['fx.shift'] ?? 0) >= 0.5) cleared = withValue(cleared, 'fx.shift', 0)
    if ((state.values['program.shift'] ?? 0) >= 0.5) cleared = withValue(cleared, 'program.shift', 0)
    return cleared
  }

  /* ---------------- shift functions printed on the panel */

  if (shifted && id === 'fx.focus.piano') {
    return clearShift({ ...state, group: !state.group })
  }
  if (shifted && GLOBAL_UNIT_BY_CONTROL[id]) {
    const unit = GLOBAL_UNIT_BY_CONTROL[id]
    const next = clearShift({ ...state, globals: { ...state.globals, [unit]: !state.globals[unit] } })
    if (state.globals[unit]) return next
    // Switching a unit to global immediately shares the focused layer's setting.
    const banks = { ...next.banks }
    for (const layerKey of LAYER_KEYS) {
      const shared: Record<string, number> = { ...banks[layerKey] }
      for (const scoped of LAYER_SCOPED_IDS) if (globalUnitOf(scoped) === unit) shared[scoped] = next.values[scoped]
      banks[layerKey] = shared
    }
    return { ...next, banks }
  }

  if (shifted && id === 'program.transpose') {
    // SHIFT + TRANSPOSE is Panic: an internal All Notes Off (manual p. 40).
    return clearShift({ ...state, panicCount: state.panicCount + 1 })
  }
  if (shifted && id === 'program.split') {
    // SHIFT + SPLIT steps the editor through Low, Mid, High and off. Selecting a point does not
    // enable it: setting its key or its crossfade does.
    return clearShift({ ...state, splitEdit: (state.splitEdit + 1) % 4 })
  }
  if (shifted && id === 'program.mst-clk') {
    return clearShift({ ...state, clockSet: !state.clockSet })
  }
  if (shifted && state.storeStage !== 'idle') {
    // SHIFT / EXIT cancels a Store in progress and puts the audited program back (manual p. 13).
    const restored = state.storePayload ? applySnapshot(state, state.storePayload) : state
    return clearShift({ ...restored, storeStage: 'idle', storePayload: null, nameDraft: '' })
  }
  if (shifted && id === 'program.store') {
    // SHIFT + STORE is STORE AS: naming first, then the destination (manual p. 41).
    return clearShift({
      ...state,
      storeStage: 'naming',
      storePayload: snapshotOf(state, storedProgram(state)?.name ?? 'Program'),
      nameDraft: (storedProgram(state)?.name ?? 'Program').slice(0, NAME_LENGTH),
      nameCursor: 0,
      storeDestination: state.liveMode ? state.liveSlot : state.slot,
    })
  }
  const morphSource = morphSourceOf(id)
  if (shifted && morphSource) {
    return clearShift({ ...state, morphs: { ...state.morphs, [morphSource]: {} } })
  }
  if (shifted && id === 'program.dial') {
    return clearShift({ ...state, listView: !state.listView })
  }
  if (shifted && /^(organ|piano|synth)\.[abc]\.on$/.test(id)) {
    return clearShift(cycleZone(state, id.replace('.on', '') as LayerKey))
  }
  if (shifted && id === 'synth.filter.type') {
    return clearShift(withExtra(state, 'tracking', (value) => (value + 1) % 4))
  }
  if (shifted && id === 'synth.voice.mode') {
    return clearShift(withExtra(state, 'priority', (value) => (value + 1) % 3))
  }
  if (shifted && id === 'synth.arp.menu') {
    return clearShift(withExtra(state, 'arpSync', (value) => (value === 0 ? 1 : 0)))
  }
  if (shifted && id === 'synth.lfo.destination') {
    return clearShift(withExtra(state, 'lfoSync', (value) => (value === 0 ? 1 : 0)))
  }
  if (shifted && id === 'synth.osc.envelope') {
    return clearShift(withExtra(state, 'oscEnvVelocity', (value) => (value === 0 ? 1 : 0)))
  }
  if (shifted && id === 'synth.filter.envelope') {
    return clearShift(withExtra(state, 'filterEnvVelocity', (value) => (value === 0 ? 1 : 0)))
  }
  if (shifted && id === 'synth.amp.envelope') {
    return clearShift(withExtra(state, 'ampVelocity', (value) => (value + 1) % 4))
  }

  /* ---------------- octave shift */

  const octaveMatch = /^(organ|piano|synth)\.octave-(down|up)$/.exec(id)
  if (octaveMatch) {
    const section = octaveMatch[1] as FxSection
    const direction = octaveMatch[2] === 'up' ? 1 : -1
    return shiftOctave(state, section, direction)
  }

  /* ---------------- delay tap tempo */

  if (id === 'fx.delay.tap') {
    const tempo = tapTempoValue(state.lastTapAt, at)
    const tapped =
      tempo === null ? state : withValue(state, 'fx.delay.tempo', clampToSpec(control('fx.delay.tempo'), tempo))
    return { ...tapped, lastTapAt: at }
  }

  /* ---------------- FX focus and layer enables */

  if (id === 'fx.focus.piano') {
    const next = focusSection(state, 'piano', state.fxSection === 'piano' && state.focus === 'a' ? 'b' : 'a')
    return withValue(next, 'fx.focus.piano', next.focus === 'a' ? 0 : 1)
  }
  if (id === 'fx.focus.organ') {
    const layer = state.fxSection === 'organ' && state.organFocus === 'a' ? 'b' : 'a'
    const next = focusSection(state, 'organ', layer)
    return withValue(next, 'fx.focus.organ', layer === 'a' ? 0 : 1)
  }
  if (id === 'fx.focus.synth') {
    const order: SynthLayerId[] = ['a', 'b', 'c']
    const index = state.fxSection === 'synth' ? (order.indexOf(state.synthFocus) + 1) % 3 : 0
    const next = focusSection(state, 'synth', order[index])
    return withValue(next, 'fx.focus.synth', index)
  }

  const layerOn = /^(organ|piano|synth)\.([abc])\.on$/.exec(id)
  if (layerOn) {
    const section = layerOn[1] as FxSection
    const layer = layerOn[2]
    const value = activatedValue(spec, state.values[id] ?? spec.initial)
    const focused = value >= 0.5 ? focusSection(state, section, layer) : state
    let next = withValue(focused, id, value)
    if (value >= 0.5) {
      const focusId = `fx.focus.${section}`
      const order = section === 'synth' ? ['a', 'b', 'c'] : ['a', 'b']
      next = withValue(next, focusId, order.indexOf(layer))
    }
    // Layer Scenes hold the enable state, so a change belongs to the active scene.
    return { ...next, scenes: { ...next.scenes, [next.scene]: captureScene(next, next.scene) } }
  }

  /* ---------------- synth menu page selection */

  if (id === 'synth.osc.envelope' || id === 'synth.filter.envelope' || id === 'synth.amp.envelope') {
    const page: MenuPage =
      id === 'synth.osc.envelope' ? 'oscEnv' : id === 'synth.filter.envelope' ? 'filterEnv' : 'ampEnv'
    const opening = state.menuPage !== page
    let next: DeckState = { ...state, menuPage: opening ? page : 'osc' }
    for (const other of ['synth.osc.envelope', 'synth.filter.envelope', 'synth.amp.envelope']) {
      next = withValue(next, other, opening && other === id ? 1 : 0)
    }
    return syncMenuValues(next)
  }

  if (id === 'synth.arp.menu') {
    // The Arp menu button steps the direction: Up, Down, Up/Down, Random.
    return withExtra(state, 'arpDirection', (value) => (value + 1) % 4)
  }
  if (id === 'synth.vibrato.menu') {
    // The Vibrato menu button steps the printed rate / amount pairs (see VIBRATO_PRESETS).
    return withExtra(state, 'vibratoPreset', (value) => (value + 1) % VIBRATO_PRESETS.length)
  }
  if (id === 'synth.sound-init') {
    return initSynthLayer(state)
  }

  /* ---------------- program section */

  if (id === 'program.store') return pressStore(state)
  if (id === 'program.live-mode') {
    const liveMode = !state.liveMode
    const next = withValue({ ...state, liveMode }, id, liveMode ? 1 : 0)
    return liveMode ? selectLive(next, next.liveSlot) : selectProgram(next, next.slot)
  }
  if (id === 'program.prog-view') {
    const listView = !state.listView
    return withValue({ ...state, listView }, id, listView ? 1 : 0)
  }
  if (id === 'program.split') {
    const on = !state.split.on
    // SPLIT ON/SET turns on a single Mid split at C4 (programs spec, `split.behavior`).
    const points = state.split.points.map((point, index) =>
      index === 1 ? { ...point, enabled: true } : { ...point, enabled: on ? point.enabled : false },
    )
    return withValue({ ...state, split: { on, points }, splitEdit: 0 }, id, on ? 1 : 0)
  }

  if (id === 'program.mst-clk') {
    const taps = [...state.clockTaps, at].filter((tap) => at - tap < 4000).slice(-8)
    const bpm = bpmFromTaps(taps)
    return { ...state, clockTaps: taps, clock: bpm === null ? state.clock : { ...state.clock, bpm } }
  }
  if (id === 'program.layer-scene') {
    const scene: SceneId = state.scene === 'I' ? 'II' : 'I'
    return withValue(switchScene(state, scene), id, scene === 'I' ? 0 : 1)
  }
  if (id === 'program.page-left' || id === 'program.page-right') {
    return pressPage(state, id === 'program.page-right' ? 1 : -1)
  }
  const slotMatch = /^program\.slot\.([1-8])$/.exec(id)
  if (slotMatch) return pressSlot(state, Number(slotMatch[1]) - 1)

  if (morphSource) {
    const armed = state.morphArm === morphSource ? null : morphSource
    let next = withValue({ ...state, morphArm: armed, morphStart: armed ? state.values : null }, id, armed ? 1 : 0)
    if (!armed) {
      // Releasing the source returns every destination to its start value; the morph itself is
      // what sweeps them to the end (manual p. 38-39).
      for (const [destination, assignment] of Object.entries(state.morphs[morphSource])) {
        next = withValue(next, destination, assignment.from)
      }
    }
    for (const other of ['program.morph.wheel', 'program.morph.ctrl-pedal']) {
      if (other !== id) next = withValue(next, other, 0)
    }
    return next
  }

  /* ---------------- everything else */

  const optionCount = id === 'piano.timbre' ? timbreOptionCount(state.values) : undefined
  const value = activatedValue(spec, state.values[id] ?? spec.initial, optionCount)
  const moved = recordMorph(state, id, value)
  return reconcilePianoSelection(withValue(moved, id, value))
}

function withExtra(state: DeckState, key: keyof SynthExtra, next: (value: number) => number): DeckState {
  const layer = state.synthFocus
  const extra = { ...state.synthExtra[layer], [key]: next(state.synthExtra[layer][key]) }
  return { ...state, synthExtra: { ...state.synthExtra, [layer]: extra } }
}

function shiftOctave(state: DeckState, section: FxSection, direction: number): DeckState {
  const step = direction * 12
  const clamp = (value: number) => Math.max(-OCTAVE_LIMIT, Math.min(OCTAVE_LIMIT, value + step))
  if (section === 'piano') {
    return { ...state, octaves: { ...state.octaves, [state.focus]: clamp(state.octaves[state.focus]) } }
  }
  if (section === 'organ') {
    return {
      ...state,
      organOctaves: { ...state.organOctaves, [state.organFocus]: clamp(state.organOctaves[state.organFocus]) },
    }
  }
  return {
    ...state,
    synthOctaves: { ...state.synthOctaves, [state.synthFocus]: clamp(state.synthOctaves[state.synthFocus]) },
  }
}

/** Sound Init: reset the focused synth layer to the panel's printed initial values. */
function initSynthLayer(state: DeckState): DeckState {
  const defaults = initialHardwareValues()
  let next = state
  for (const id of LAYER_SCOPED_IDS) {
    if (scopeOf(id) !== 'synth') continue
    next = withValue(next, id, defaults[id])
  }
  const menu = { ...next.menu, [next.synthFocus]: initialMenu() }
  const extra = { ...next.synthExtra, [next.synthFocus]: initialExtra() }
  return syncMenuValues({ ...next, menu, synthExtra: extra, menuPage: 'osc' })
}

/**
 * STORE: the first press arms and shows the destination, the second confirms. SHIFT/EXIT cancels
 * (manual p. 13). STORE AS adds the naming step in front (manual p. 41).
 */
function pressStore(state: DeckState): DeckState {
  if (state.storeStage === 'naming') {
    return { ...state, storeStage: 'destination' }
  }
  if (state.storeStage === 'idle') {
    return {
      ...state,
      storeStage: 'destination',
      storeDestination: state.liveMode ? state.liveSlot : state.slot,
      storePayload: snapshotOf(state, storedProgram(state)?.name ?? 'Program'),
      nameDraft: state.nameDraft || (storedProgram(state)?.name ?? 'Program'),
    }
  }
  const name = (state.nameDraft || state.storePayload?.name || 'Program').trim() || 'Program'
  // The program that gets written is the one captured when STORE was armed, not whatever the
  // destination audition left on the panel.
  const snapshot = { ...(state.storePayload ?? snapshotOf(state, name)), name }
  const applied = applySnapshot(state, snapshot)
  if (state.liveMode) {
    const live = [...state.live]
    live[state.storeDestination] = snapshot
    return {
      ...applied,
      live,
      liveSlot: state.storeDestination,
      storeStage: 'idle',
      storePayload: null,
      nameDraft: '',
    }
  }
  const programs = [...state.programs]
  programs[state.storeDestination] = snapshot
  return {
    ...applied,
    programs,
    slot: state.storeDestination,
    storeStage: 'idle',
    storePayload: null,
    nameDraft: '',
  }
}

function pressPage(state: DeckState, direction: number): DeckState {
  if (state.storeStage === 'naming') {
    const cursor = Math.min(NAME_LENGTH - 1, Math.max(0, state.nameCursor + direction))
    return { ...state, nameCursor: cursor }
  }
  if (state.splitEdit > 0) {
    const index = state.splitEdit - 1
    const point = state.split.points[index]
    const position = (CROSSFADE_WIDTHS.indexOf(point.crossfade) + direction + 3) % 3
    const points = state.split.points.map((entry, i) =>
      i === index ? { ...entry, crossfade: CROSSFADE_WIDTHS[position], enabled: true } : entry,
    )
    return { ...state, split: { ...state.split, points } }
  }
  if (state.storeStage === 'destination') {
    const limit = state.liveMode ? LIVE_SLOTS : PROGRAM_SLOTS
    const step = state.liveMode ? 1 : PROGRAMS_PER_PAGE
    const destination = Math.min(limit - 1, Math.max(0, state.storeDestination + direction * step))
    return { ...state, storeDestination: destination }
  }
  if (state.liveMode) return selectLive(state, state.liveSlot + direction)
  const page = Math.min(PROGRAM_PAGES - 1, Math.max(0, Math.floor(state.slot / PROGRAMS_PER_PAGE) + direction))
  return selectProgram(state, page * PROGRAMS_PER_PAGE + (state.slot % PROGRAMS_PER_PAGE))
}

function pressSlot(state: DeckState, button: number): DeckState {
  if (state.storeStage === 'destination') {
    const page = state.liveMode ? 0 : Math.floor(state.storeDestination / PROGRAMS_PER_PAGE)
    const destination = state.liveMode ? button : page * PROGRAMS_PER_PAGE + button
    const preview = state.liveMode ? state.live[destination] : state.programs[destination]
    const audition = preview ? applySnapshot(state, preview) : state
    return { ...audition, storeStage: 'destination', storeDestination: destination }
  }
  if (state.liveMode) return selectLive(state, button)
  const page = Math.floor(state.slot / PROGRAMS_PER_PAGE)
  return selectProgram(state, page * PROGRAMS_PER_PAGE + button)
}

/** Fraction of travel, 0..1, used to draw knob angles, fader caps and drawbar heights. */
export function normalisedPosition(spec: ControlSpec, value: number): number {
  if (spec.max === spec.min) return 0
  return (value - spec.min) / (spec.max - spec.min)
}

/** The piano type a set of values selects, used by the display, the reducer and the engine. */
export function layerTypeId(values: HardwareValues): PianoTypeId {
  const spec = control('piano.type')
  const index = Math.round(values['piano.type'] ?? 0)
  const label = spec.options?.[index] ?? 'Grand'
  // `pianoType` throws on an unknown id, which keeps a typo from silently selecting a grand.
  return pianoType(label.toLowerCase() as PianoTypeId).id
}
