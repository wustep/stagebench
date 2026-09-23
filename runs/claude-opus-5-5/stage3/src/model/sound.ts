// Canonical instrument state (version 3): the whole serialisable program — Piano (two layers),
// Organ (two layers), Synth (three layers), the Layer Effects section (six chains: Piano A/B, one
// shared Organ chain, Synth A/B/C; focus/group/global targeting), the shared Rotary, splits and
// zones, Layer Scenes, morph assignments, Master Clock and Transpose — plus Master Level and the
// pitch stick, which are performance state and not stored in programs.
// Pure data and pure update functions — the panel bindings write it, the audio engine reads it.
import { modelsOfType, PIANO_TYPES, type KbTouch, type PianoType, type Timbre } from '../audio/instruments'
import type { Mod1Type, Mod2Type, ModState } from '../audio/fx/modulation'
import { FULL_ZONE, type CommonLayer } from './layerCommon'
import { defaultOrgan, ORGAN_LAYERS, type OrganLayerId, type OrganSection } from './organState'
import { defaultSynth, SYNTH_LAYERS, type SynthLayerId, type SynthSection } from './synthState'

/** Piano layers (Phase 2 ids, kept: piano slots and chains are still called 'A' and 'B'). */
export type LayerId = 'A' | 'B'
export const LAYERS: readonly LayerId[] = ['A', 'B']

export type SectionId = 'organ' | 'piano' | 'synth'
export const SECTIONS: readonly SectionId[] = ['organ', 'piano', 'synth']

/** Every sound-producing layer: Piano A/B, Organ A/B, Synth A/B/C. */
export type SlotId = LayerId | 'organA' | 'organB' | 'synthA' | 'synthB' | 'synthC'
export const SLOTS: readonly SlotId[] = ['organA', 'organB', 'A', 'B', 'synthA', 'synthB', 'synthC']

/** Effect chains: one per piano and synth layer, one shared by both organ layers (effects spec routing.chains). */
export type ChainId = LayerId | 'organ' | 'synthA' | 'synthB' | 'synthC'
export const CHAINS: readonly ChainId[] = ['organ', 'A', 'B', 'synthA', 'synthB', 'synthC']

export function slotSection(slot: SlotId): SectionId {
  return slot === 'A' || slot === 'B' ? 'piano' : slot.startsWith('organ') ? 'organ' : 'synth'
}

/** The layer letter of a slot within its section. */
export function slotLayer(slot: SlotId): string {
  return slot.length === 1 ? slot : slot.slice(-1)
}

export function slotOf(section: SectionId, layer: string): SlotId {
  return (section === 'piano' ? layer : `${section}${layer}`) as SlotId
}

export function chainOfSlot(slot: SlotId): ChainId {
  return slot === 'organA' || slot === 'organB' ? 'organ' : (slot as ChainId)
}

export function sectionLayers(section: SectionId): readonly string[] {
  return section === 'piano' ? LAYERS : section === 'organ' ? ORGAN_LAYERS : SYNTH_LAYERS
}

export interface PianoLayerState extends CommonLayer {
  type: PianoType
  /** Selected model index for every type (the model dial selects within the current type). */
  models: Record<PianoType, number>
  kbTouch: KbTouch
  dynComp: number
  timbre: Timbre
  unison: number
  softRelease: boolean
  stringRes: boolean
}

export type DelayFilter = 'off' | 'hp' | 'lp' | 'bp'
export interface DelayState {
  on: boolean
  tempo: number
  feedback: number
  dryWet: number
  filter: DelayFilter
  /** Master Clock sync: Tempo selects a clock subdivision. */
  sync: boolean
}

export const AMP_TYPES = ['eq', 'small', 'jc', 'twin', 'rotary', 'lp24', 'hp24'] as const
export type AmpType = (typeof AMP_TYPES)[number]
export interface AmpState {
  on: boolean
  type: AmpType
  drive: number
  bass: number
  /** Mid gain, or resonance for the LP/HP filter types. */
  mid: number
  /** Mid frequency, or cutoff for the LP/HP filter types. */
  freq: number
  treble: number
}

export interface CompState {
  on: boolean
  amount: number
  fast: boolean
}

export const REVERB_TYPES = ['room', 'booth', 'spring', 'stage', 'hall', 'cathedral'] as const
export type ReverbType = (typeof REVERB_TYPES)[number]
export type ReverbTone = 'normal' | 'bright' | 'dark'
export interface ReverbState {
  on: boolean
  type: ReverbType
  dryWet: number
  tone: ReverbTone
}

export type Mod1State = ModState<Mod1Type> & { /** Master Clock sync of the LFO rate. */ sync: boolean }

export interface ChainState {
  mod1: Mod1State
  mod2: ModState<Mod2Type>
  delay: DelayState
  amp: AmpState
  comp: CompState
  reverb: ReverbState
}

export type GlobalUnit = 'delay' | 'comp' | 'reverb'
export const GLOBAL_UNITS: readonly GlobalUnit[] = ['delay', 'comp', 'reverb']

export interface RotaryState {
  fast: boolean
  drive: number
  /** The Rotary ORGAN button: the organ chain feeds the shared Rotary (manual p. 53). */
  organ: boolean
  /** Stop mode: Slow stops the rotors instead (effects spec optional, organ spec speeds). */
  stopMode: boolean
}

/** Split point positions (programs spec split.possiblePositions), as MIDI notes. */
export const SPLIT_POSITIONS: readonly number[] = [36, 41, 48, 53, 60, 65, 72, 77, 84, 89, 96]
export const SPLIT_POSITION_NAMES: readonly string[] = ['C2', 'F2', 'C3', 'F3', 'C4', 'F4', 'C5', 'F5', 'C6', 'F6', 'C7']
export const XFADES: readonly number[] = [0, 6, 12]
export const SPLIT_POINT_NAMES = ['Low', 'Mid', 'High'] as const

export interface SplitPoint {
  /** Index into SPLIT_POSITIONS, or null = Off. */
  pos: number | null
  /** Crossfade width in semitones on each side: 0 (Off), 6 or 12. */
  xfade: number
}

export interface SplitState {
  on: boolean
  points: [SplitPoint, SplitPoint, SplitPoint]
}

export type SceneId = 'I' | 'II'
export type EnableMap = Record<SlotId, boolean>

export type MorphSource = 'wheel' | 'pedal'
/** Morph assignments per source: destination key → end offset at full source travel. */
export type MorphMap = Record<string, number>

export interface SoundState {
  version: 3
  piano: { on: boolean; focus: LayerId; layers: Record<LayerId, PianoLayerState> }
  organ: OrganSection
  synth: SynthSection
  fx: {
    /** Layer Effects ON: off bypasses every unit at once. */
    on: boolean
    focus: ChainId
    /** Piano group mode: both piano chains share one setting. */
    group: boolean
    /** Synth group mode: the three synth chains share one setting. */
    synthGroup: boolean
    chains: Record<ChainId, ChainState>
    global: Record<GlobalUnit, boolean>
    /** Settings used by a unit while it is in global mode (applies to every layer). */
    globalUnits: { delay: DelayState; comp: CompState; reverb: ReverbState }
  }
  rotary: RotaryState
  split: SplitState
  /** Layer Scenes: the active scene and each scene's layer enables (sound parameters are shared). */
  scenes: { active: SceneId; enabled: Record<SceneId, EnableMap> }
  morph: Record<MorphSource, MorphMap>
  /** Master Clock tempo (30–300 BPM) and keyboard sync of the arpeggiators. */
  clock: { bpm: number; kbSync: boolean }
  transpose: { on: boolean; semitones: number }
  /** Master Level knob 0…127 (not stored in programs). */
  master: number
  /** Pitch stick -100…100 (bends layers with PSTICK on; not stored in programs). */
  pitchStick: number
}

function defaultLayer(enabled: boolean, type: PianoType): PianoLayerState {
  const models = Object.fromEntries(PIANO_TYPES.map((t) => [t, 0])) as Record<PianoType, number>
  return {
    enabled,
    level: 110,
    octave: 0,
    type,
    models,
    kbTouch: 'medium',
    dynComp: 0,
    timbre: 'off',
    unison: 0,
    softRelease: false,
    stringRes: false,
    sustPed: true,
    pStick: true,
    zone: FULL_ZONE,
  }
}

export function defaultChain(): ChainState {
  return {
    mod1: { on: false, type: 'trem', rate: 50, amount: 64, sync: false },
    mod2: { on: false, type: 'chorus', rate: 40, amount: 70 },
    delay: { on: false, tempo: 60, feedback: 50, dryWet: 40, filter: 'off', sync: false },
    amp: { on: false, type: 'eq', drive: 30, bass: 64, mid: 64, freq: 64, treble: 64 },
    comp: { on: false, amount: 50, fast: false },
    reverb: { on: false, type: 'hall', dryWet: 45, tone: 'normal' },
  }
}

export function enableMap(s: Pick<SoundState, 'piano' | 'organ' | 'synth'>): EnableMap {
  return {
    organA: s.organ.layers.A.enabled,
    organB: s.organ.layers.B.enabled,
    A: s.piano.layers.A.enabled,
    B: s.piano.layers.B.enabled,
    synthA: s.synth.layers.A.enabled,
    synthB: s.synth.layers.B.enabled,
    synthC: s.synth.layers.C.enabled,
  }
}

export function defaultSplit(): SplitState {
  return { on: false, points: [{ pos: null, xfade: 0 }, { pos: 4, xfade: 0 }, { pos: null, xfade: 0 }] }
}

export function defaultSound(): SoundState {
  const chain = defaultChain()
  const base = {
    piano: { on: true, focus: 'A' as LayerId, layers: { A: defaultLayer(true, 'grand'), B: defaultLayer(false, 'electric') } },
    organ: defaultOrgan(),
    synth: defaultSynth(),
  }
  const enabled = enableMap(base)
  return {
    version: 3,
    ...base,
    fx: {
      on: true,
      focus: 'A',
      group: false,
      synthGroup: false,
      chains: { organ: defaultChain(), A: defaultChain(), B: defaultChain(), synthA: defaultChain(), synthB: defaultChain(), synthC: defaultChain() },
      global: { delay: false, comp: false, reverb: false },
      globalUnits: { delay: { ...chain.delay }, comp: { ...chain.comp }, reverb: { ...chain.reverb } },
    },
    rotary: { fast: false, drive: 40, organ: true, stopMode: false },
    split: defaultSplit(),
    scenes: { active: 'I', enabled: { I: enabled, II: { ...enabled } } },
    morph: { wheel: {}, pedal: {} },
    clock: { bpm: 120, kbSync: false },
    transpose: { on: false, semitones: 0 },
    master: 96,
    pitchStick: 0,
  }
}

// ---- layer updates (all sections) ----

export function updateLayer(s: SoundState, layer: LayerId, patch: Partial<PianoLayerState>): SoundState {
  return { ...s, piano: { ...s.piano, layers: { ...s.piano.layers, [layer]: { ...s.piano.layers[layer], ...patch } } } }
}

export function updateOrganLayer(s: SoundState, layer: OrganLayerId, patch: Partial<OrganSection['layers']['A']>): SoundState {
  return { ...s, organ: { ...s.organ, layers: { ...s.organ.layers, [layer]: { ...s.organ.layers[layer], ...patch } } } }
}

export function updateSynthLayer(s: SoundState, layer: SynthLayerId, patch: Partial<SynthSection['layers']['A']>): SoundState {
  return { ...s, synth: { ...s.synth, layers: { ...s.synth.layers, [layer]: { ...s.synth.layers[layer], ...patch } } } }
}

/** The common fields of any layer. */
export function slotLayerState(s: SoundState, slot: SlotId): CommonLayer {
  const section = slotSection(slot)
  const layer = slotLayer(slot)
  if (section === 'piano') return s.piano.layers[layer as LayerId]
  if (section === 'organ') return s.organ.layers[layer as OrganLayerId]
  return s.synth.layers[layer as SynthLayerId]
}

export function updateSlot(s: SoundState, slot: SlotId, patch: Partial<CommonLayer>): SoundState {
  const section = slotSection(slot)
  const layer = slotLayer(slot)
  if (section === 'piano') return updateLayer(s, layer as LayerId, patch)
  if (section === 'organ') return updateOrganLayer(s, layer as OrganLayerId, patch)
  return updateSynthLayer(s, layer as SynthLayerId, patch)
}

export function sectionOn(s: SoundState, section: SectionId): boolean {
  return s[section].on
}

/** True when a slot sounds: its section is on and the layer is enabled. */
export function slotActive(s: SoundState, slot: SlotId): boolean {
  return sectionOn(s, slotSection(slot)) && slotLayerState(s, slot).enabled
}

export function sectionFocus(s: SoundState, section: SectionId): string {
  return s[section].focus
}

/** Focus a piano layer; the effects focus follows the layer focus (manual p. 48). */
export function focusLayer(s: SoundState, layer: LayerId): SoundState {
  return { ...s, piano: { ...s.piano, focus: layer }, fx: { ...s.fx, focus: layer } }
}

/** Focus a layer of any section; the effects focus follows (organ layers share the organ chain). */
export function focusSlot(s: SoundState, slot: SlotId): SoundState {
  const section = slotSection(slot)
  const layer = slotLayer(slot)
  const fx = { ...s.fx, focus: chainOfSlot(slot) }
  if (section === 'piano') return { ...s, piano: { ...s.piano, focus: layer as LayerId }, fx }
  if (section === 'organ') return { ...s, organ: { ...s.organ, focus: layer as OrganLayerId }, fx }
  return { ...s, synth: { ...s.synth, focus: layer as SynthLayerId }, fx }
}

/**
 * A layer ON/OFF button (any section): an off layer turns on and takes focus; an on layer that is
 * not focused takes focus; the focused on layer turns off (focus moves to another playing layer).
 */
export function pressSlotButton(s: SoundState, slot: SlotId): SoundState {
  const section = slotSection(slot)
  const l = slotLayerState(s, slot)
  if (!l.enabled) return focusSlot(updateSlot(s, slot, { enabled: true }), slot)
  if (slotOf(section, sectionFocus(s, section)) !== slot) return focusSlot(s, slot)
  const off = updateSlot(s, slot, { enabled: false })
  const other = sectionLayers(section)
    .map((x) => slotOf(section, x))
    .find((x) => x !== slot && slotLayerState(off, x).enabled)
  return other ? focusSlot(off, other) : off
}

/** The piano layer ON/OFF button (Phase 2 name). */
export function pressLayerButton(s: SoundState, layer: LayerId): SoundState {
  return pressSlotButton(s, layer)
}

export function currentModel(l: PianoLayerState) {
  const list = modelsOfType(l.type)
  return list[Math.min(list.length - 1, Math.max(0, l.models[l.type]))]
}

export function stepModel(s: SoundState, layer: LayerId, delta: number): SoundState {
  const l = s.piano.layers[layer]
  const count = modelsOfType(l.type).length
  const index = (((l.models[l.type] + delta) % count) + count) % count
  return updateLayer(s, layer, { models: { ...l.models, [l.type]: index } })
}

// ---- effects updates ----

type UnitKey = keyof ChainState

const isGlobalUnit = (unit: UnitKey): unit is GlobalUnit => unit === 'delay' || unit === 'comp' || unit === 'reverb'

export const PIANO_CHAINS: readonly ChainId[] = ['A', 'B']
export const SYNTH_CHAINS: readonly ChainId[] = ['synthA', 'synthB', 'synthC']

/** The effective settings of one unit for one chain (global and group resolved). */
export function effectiveUnit<K extends UnitKey>(s: SoundState, chain: ChainId, unit: K): ChainState[K] {
  if (isGlobalUnit(unit) && s.fx.global[unit]) return s.fx.globalUnits[unit] as ChainState[K]
  return s.fx.chains[chain][unit]
}

export function effectiveChain(s: SoundState, chain: ChainId): ChainState {
  return {
    mod1: effectiveUnit(s, chain, 'mod1'),
    mod2: effectiveUnit(s, chain, 'mod2'),
    delay: effectiveUnit(s, chain, 'delay'),
    amp: effectiveUnit(s, chain, 'amp'),
    comp: effectiveUnit(s, chain, 'comp'),
    reverb: effectiveUnit(s, chain, 'reverb'),
  }
}

/** Settings shown on the panel for a unit: the focused chain's (or the global instance). */
export function focusedUnit<K extends UnitKey>(s: SoundState, unit: K): ChainState[K] {
  return effectiveUnit(s, s.fx.focus, unit)
}

/** The chains an edit of the focused chain reaches (group modes link piano or synth chains). */
export function editTargets(s: SoundState): readonly ChainId[] {
  const f = s.fx.focus
  if (s.fx.group && PIANO_CHAINS.includes(f)) return PIANO_CHAINS
  if (s.fx.synthGroup && SYNTH_CHAINS.includes(f)) return SYNTH_CHAINS
  return [f]
}

/**
 * Edit a unit from the panel: a global unit edits the global instance; otherwise the focused
 * chain — and, in Piano/Synth group mode, every chain of that section.
 */
export function editUnit<K extends UnitKey>(s: SoundState, unit: K, patch: Partial<ChainState[K]>): SoundState {
  if (isGlobalUnit(unit) && s.fx.global[unit]) {
    const g = s.fx.globalUnits
    return { ...s, fx: { ...s.fx, globalUnits: { ...g, [unit]: { ...g[unit], ...(patch as object) } } } }
  }
  const chains = { ...s.fx.chains }
  for (const t of editTargets(s)) chains[t] = { ...chains[t], [unit]: { ...chains[t][unit], ...patch } }
  return { ...s, fx: { ...s.fx, chains } }
}

/** Piano group mode on: both piano chains take the focused piano chain's settings and stay linked (focus moves there). */
export function setGroup(s: SoundState, group: boolean): SoundState {
  if (!group) return { ...s, fx: { ...s.fx, group } }
  const from: ChainId = PIANO_CHAINS.includes(s.fx.focus) ? s.fx.focus : s.piano.focus
  const src = s.fx.chains[from]
  return { ...s, fx: { ...s.fx, group, focus: from, chains: { ...s.fx.chains, A: cloneChain(src), B: cloneChain(src) } } }
}

/** Synth group mode on: the three synth chains take the focused synth chain's settings (focus moves there). */
export function setSynthGroup(s: SoundState, synthGroup: boolean): SoundState {
  if (!synthGroup) return { ...s, fx: { ...s.fx, synthGroup } }
  const from: ChainId = SYNTH_CHAINS.includes(s.fx.focus) ? s.fx.focus : (`synth${s.synth.focus}` as ChainId)
  const src = s.fx.chains[from]
  return { ...s, fx: { ...s.fx, synthGroup, focus: from, chains: { ...s.fx.chains, synthA: cloneChain(src), synthB: cloneChain(src), synthC: cloneChain(src) } } }
}

export function cloneChain(c: ChainState): ChainState {
  return { mod1: { ...c.mod1 }, mod2: { ...c.mod2 }, delay: { ...c.delay }, amp: { ...c.amp }, comp: { ...c.comp }, reverb: { ...c.reverb } }
}

/** Global mode on for a unit: the global instance starts from the focused chain's settings. */
export function setGlobal(s: SoundState, unit: GlobalUnit, on: boolean): SoundState {
  const global = { ...s.fx.global, [unit]: on }
  if (!on) return { ...s, fx: { ...s.fx, global } }
  const globalUnits = { ...s.fx.globalUnits, [unit]: { ...s.fx.chains[s.fx.focus][unit] } }
  return { ...s, fx: { ...s.fx, global, globalUnits } }
}

/**
 * True when a chain feeds the shared Rotary: the organ chain via the Rotary ORGAN button, piano and
 * synth chains via Amp Sim type To Rotary (unit and effects on).
 */
export function routesToRotary(s: SoundState, chain: ChainId): boolean {
  if (chain === 'organ') return s.rotary.organ
  const amp = effectiveUnit(s, chain, 'amp')
  return s.fx.on && amp.on && amp.type === 'rotary'
}

// ---- Layer Scenes ----

/** Record the current layer enables into the active scene (keeps the scene map truthful). */
export function syncScene(s: SoundState): SoundState {
  const now = enableMap(s)
  const cur = s.scenes.enabled[s.scenes.active]
  if (SLOTS.every((k) => cur[k] === now[k])) return s
  return { ...s, scenes: { ...s.scenes, enabled: { ...s.scenes.enabled, [s.scenes.active]: now } } }
}

/** Switch Layer Scene: only layer enables change; every sound parameter is shared (manual p. 43). */
export function switchScene(s: SoundState, scene: SceneId): SoundState {
  const synced = syncScene(s)
  if (synced.scenes.active === scene) return synced
  const target = synced.scenes.enabled[scene]
  let next: SoundState = { ...synced, scenes: { ...synced.scenes, active: scene } }
  for (const slot of SLOTS) next = updateSlot(next, slot, { enabled: target[slot] })
  return next
}
