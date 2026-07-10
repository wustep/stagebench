/** Program / performance system — Phase 3 */

import { defaultEffectsState, defaultPianoState, type EffectsSectionState, type PianoSectionState } from './piano-types'
import { defaultOrganState, type OrganSectionState } from './organ-types'
import { defaultSynthState, type SynthSectionState } from './synth-types'

export type SceneId = 'I' | 'II'
export type MorphSource = 'Wheel' | 'Control Pedal'
export type SplitPointId = 'Low' | 'Mid' | 'High'
export type CrossfadeWidth = 0 | 6 | 12

export const SPLIT_POSITIONS = ['C2', 'F2', 'C3', 'F3', 'C4', 'F4', 'C5', 'F5', 'C6', 'F6', 'C7'] as const
export type SplitNoteName = (typeof SPLIT_POSITIONS)[number]

export const SPLIT_NOTE_MIDI: Record<SplitNoteName, number> = {
  C2: 36,
  F2: 41,
  C3: 48,
  F3: 53,
  C4: 60,
  F4: 65,
  C5: 72,
  F5: 77,
  C6: 84,
  F6: 89,
  C7: 96,
}

export interface SplitPointState {
  enabled: boolean
  note: SplitNoteName
  crossfade: CrossfadeWidth
}

export interface SplitState {
  on: boolean
  points: Record<SplitPointId, SplitPointState>
}

export interface MorphAssignment {
  controlPath: string
  start: number
  end: number
}

export interface MorphState {
  wheel: MorphAssignment[]
  controlPedal: MorphAssignment[]
}

export interface LayerEnableScene {
  pianoA: boolean
  pianoB: boolean
  organA: boolean
  organB: boolean
  synthA: boolean
  synthB: boolean
  synthC: boolean
}

export interface ProgramSoundState {
  piano: PianoSectionState
  organ: OrganSectionState
  synth: SynthSectionState
  effects: EffectsSectionState
  split: SplitState
  scenes: { active: SceneId; I: LayerEnableScene; II: LayerEnableScene }
  morph: MorphState
  masterClockBpm: number
  masterClockKbSync: boolean
  transpose: number
}

export interface ProgramSlot {
  name: string
  state: ProgramSoundState
}

export interface ProgramSystemState {
  slots: ProgramSlot[]
  liveSlots: ProgramSlot[]
  currentSlot: number
  liveMode: boolean
  currentLive: number
  dirty: boolean
  listView: boolean
  page: number
  storeMode: 'off' | 'store' | 'storeAs' | 'naming'
  storeName: string
  storeDest: number
  morphAssignSource: MorphSource | null
  morphLatch: boolean
  controlPedal: number
  wheel: number
  shift: boolean
}

export function defaultSplit(): SplitState {
  return {
    on: false,
    points: {
      Low: { enabled: false, note: 'C3', crossfade: 0 },
      Mid: { enabled: true, note: 'C4', crossfade: 0 },
      High: { enabled: false, note: 'C5', crossfade: 0 },
    },
  }
}

export function defaultSceneEnables(allOn = true): LayerEnableScene {
  return {
    pianoA: allOn,
    pianoB: false,
    organA: false,
    organB: false,
    synthA: false,
    synthB: false,
    synthC: false,
  }
}

export function defaultMorph(): MorphState {
  return { wheel: [], controlPedal: [] }
}

export function defaultProgramSound(): ProgramSoundState {
  const piano = defaultPianoState()
  const organ = defaultOrganState()
  const synth = defaultSynthState()
  return {
    piano,
    organ,
    synth,
    effects: defaultEffectsState(),
    split: defaultSplit(),
    scenes: {
      active: 'I',
      I: {
        pianoA: true,
        pianoB: false,
        organA: false,
        organB: false,
        synthA: false,
        synthB: false,
        synthC: false,
      },
      II: {
        pianoA: false,
        pianoB: true,
        organA: true,
        organB: false,
        synthA: true,
        synthB: false,
        synthC: false,
      },
    },
    morph: defaultMorph(),
    masterClockBpm: 120,
    masterClockKbSync: false,
    transpose: 0,
  }
}

function cloneDeep<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export function cloneProgramSound(s: ProgramSoundState): ProgramSoundState {
  return cloneDeep(s)
}

export function factoryPrograms(): ProgramSlot[] {
  const slots: ProgramSlot[] = []
  for (let i = 0; i < 32; i++) {
    slots.push({ name: `Program ${Math.floor(i / 8) + 1}.${(i % 8) + 1}`, state: defaultProgramSound() })
  }

  // 0: Grand piano
  slots[0] = {
    name: 'Concert Grand',
    state: (() => {
      const s = defaultProgramSound()
      s.piano.type = 'Grand'
      s.piano.layers.A.enabled = true
      return s
    })(),
  }
  // 1: Upright
  slots[1] = {
    name: 'Studio Upright',
    state: (() => {
      const s = defaultProgramSound()
      s.piano.type = 'Upright'
      return s
    })(),
  }
  // 2: Electric piano
  slots[2] = {
    name: 'Tine Stack',
    state: (() => {
      const s = defaultProgramSound()
      s.piano.type = 'Electric'
      s.piano.unison = 2
      return s
    })(),
  }
  // 3: B3 organ
  slots[3] = {
    name: 'B3 Full',
    state: (() => {
      const s = defaultProgramSound()
      s.piano.sectionOn = false
      s.piano.layers.A.enabled = false
      s.organ.sectionOn = true
      s.organ.layers.A.enabled = true
      s.organ.layers.A.model = 'B3'
      s.organ.percussion.on = true
      s.scenes.I.pianoA = false
      s.scenes.I.organA = true
      return s
    })(),
  }
  // 4: Vox
  slots[4] = {
    name: 'Vox Combo',
    state: (() => {
      const s = defaultProgramSound()
      s.piano.sectionOn = false
      s.piano.layers.A.enabled = false
      s.organ.sectionOn = true
      s.organ.layers.A.model = 'Vox'
      s.organ.layers.A.enabled = true
      s.scenes.I.pianoA = false
      s.scenes.I.organA = true
      return s
    })(),
  }
  // 5: Synth lead
  slots[5] = {
    name: 'Saw Lead',
    state: (() => {
      const s = defaultProgramSound()
      s.piano.sectionOn = false
      s.piano.layers.A.enabled = false
      s.synth.sectionOn = true
      s.synth.layers.A.enabled = true
      s.synth.layers.A.waveform = 'Saw'
      s.synth.layers.A.filterFreq = 0.55
      s.scenes.I.pianoA = false
      s.scenes.I.synthA = true
      return s
    })(),
  }
  // 6: Split piano/bass synth
  slots[6] = {
    name: 'Split Keys',
    state: (() => {
      const s = defaultProgramSound()
      s.split.on = true
      s.split.points.Mid = { enabled: true, note: 'C4', crossfade: 6 }
      s.synth.sectionOn = true
      s.synth.layers.A.enabled = true
      s.synth.layers.A.waveform = 'Square'
      s.synth.layers.A.zones = [true, false, false, false]
      s.piano.layers.A.zones = [false, true, true, true]
      s.scenes.I.synthA = true
      s.scenes.I.pianoA = true
      return s
    })(),
  }
  // 7: Layered piano+pad
  slots[7] = {
    name: 'Layer Pad',
    state: (() => {
      const s = defaultProgramSound()
      s.synth.sectionOn = true
      s.synth.layers.A.enabled = true
      s.synth.layers.A.waveform = 'Super Saw'
      s.synth.layers.A.level = 0.4
      s.synth.layers.A.filterFreq = 0.4
      s.piano.layers.A.level = 0.7
      s.scenes.I.synthA = true
      s.scenes.I.pianoA = true
      return s
    })(),
  }

  return slots
}

export function defaultLiveSlots(): ProgramSlot[] {
  return Array.from({ length: 8 }, (_, i) => ({
    name: `Live ${i + 1}`,
    state: defaultProgramSound(),
  }))
}

export function defaultProgramSystem(): ProgramSystemState {
  return {
    slots: factoryPrograms(),
    liveSlots: defaultLiveSlots(),
    currentSlot: 0,
    liveMode: false,
    currentLive: 0,
    dirty: false,
    listView: false,
    page: 0,
    storeMode: 'off',
    storeName: '',
    storeDest: 0,
    morphAssignSource: null,
    morphLatch: false,
    controlPedal: 0,
    wheel: 0,
    shift: false,
  }
}

/** Resolve up to 4 zone boundaries from split points */
export function resolveZoneBounds(split: SplitState): { lo: number; hi: number }[] {
  if (!split.on) {
    return [{ lo: 0, hi: 127 }]
  }
  const cuts: number[] = []
  for (const id of ['Low', 'Mid', 'High'] as SplitPointId[]) {
    const p = split.points[id]
    if (p.enabled) cuts.push(SPLIT_NOTE_MIDI[p.note])
  }
  cuts.sort((a, b) => a - b)
  const unique = [...new Set(cuts)]
  if (unique.length === 0) return [{ lo: 0, hi: 127 }]
  const zones: { lo: number; hi: number }[] = []
  let start = 0
  for (const c of unique) {
    zones.push({ lo: start, hi: c - 1 })
    start = c
  }
  zones.push({ lo: start, hi: 127 })
  return zones.slice(0, 4)
}

export function zoneIndexForNote(midi: number, split: SplitState): number {
  const zones = resolveZoneBounds(split)
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i]!
    if (midi >= z.lo && midi <= z.hi) return i
  }
  return Math.max(0, zones.length - 1)
}

/** Crossfade gain for a note near a split boundary */
export function crossfadeGain(
  midi: number,
  split: SplitState,
  zoneIdx: number,
  side: 'left' | 'right',
): number {
  if (!split.on) return 1
  for (const id of ['Low', 'Mid', 'High'] as SplitPointId[]) {
    const p = split.points[id]
    if (!p.enabled || p.crossfade === 0) continue
    const edge = SPLIT_NOTE_MIDI[p.note]
    const w = p.crossfade
    if (side === 'left' && midi >= edge - w && midi < edge) {
      return (edge - midi) / w
    }
    if (side === 'right' && midi >= edge && midi < edge + w) {
      return (midi - edge + w) / w - 1 // 0 at edge rising to 1
    }
    if (side === 'right' && midi >= edge && midi < edge + w) {
      return (midi - edge) / w
    }
    if (midi >= edge - w && midi <= edge + w) {
      if (midi < edge) {
        // left zone fades out
        return side === 'left' ? 1 - (edge - midi) / w + (edge - midi) / w : (edge - midi) / w
      }
    }
  }
  return 1
}

/** Simpler: gain for layer in a zone given midi and crossfade */
export function layerZoneGain(midi: number, split: SplitState, zones: [boolean, boolean, boolean, boolean]): number {
  if (!split.on) return zones.some(Boolean) || zones[0] ? 1 : 0
  const bounds = resolveZoneBounds(split)
  let gain = 0
  for (let i = 0; i < bounds.length; i++) {
    if (!zones[i]) continue
    const z = bounds[i]!
    if (midi >= z.lo && midi <= z.hi) {
      gain = Math.max(gain, 1)
    } else {
      // check crossfade into adjacent
      for (const id of ['Low', 'Mid', 'High'] as SplitPointId[]) {
        const p = split.points[id]
        if (!p.enabled || p.crossfade === 0) continue
        const edge = SPLIT_NOTE_MIDI[p.note]
        const w = p.crossfade
        if (midi >= edge - w && midi < edge && z.hi < edge) {
          // left of split fading
          const g = (edge - midi) / w
          if (zones[i]) gain = Math.max(gain, g)
        }
        if (midi >= edge && midi < edge + w && z.lo >= edge) {
          // right zone starts at edge
          gain = Math.max(gain, (midi - edge) / w)
        }
        if (midi >= edge && midi <= edge + w) {
          // right side of split
          const rightIdx = bounds.findIndex((b) => b.lo === edge)
          if (rightIdx === i) {
            gain = Math.max(gain, Math.min(1, (midi - edge) / w))
          }
        }
        if (midi >= edge - w && midi < edge) {
          const leftIdx = bounds.findIndex((b) => b.hi === edge - 1 || (b.lo < edge && b.hi >= edge - 1))
          if (leftIdx === i) {
            gain = Math.max(gain, Math.min(1, (edge - midi) / w))
          }
        }
      }
    }
  }
  // fallback strict membership
  if (gain === 0) {
    const zi = zoneIndexForNote(midi, split)
    if (zones[zi]) return 1
  }
  return Math.min(1, gain)
}

export function interpolateMorph(assignments: MorphAssignment[], amount: number): Record<string, number> {
  const out: Record<string, number> = {}
  const t = Math.max(0, Math.min(1, amount))
  for (const a of assignments) {
    out[a.controlPath] = a.start + (a.end - a.start) * t
  }
  return out
}
