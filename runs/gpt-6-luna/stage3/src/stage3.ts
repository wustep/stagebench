import type { AudioConfiguration } from './audio'

export type OrganModel = 'B3' | 'Vox' | 'Farf' | 'Pipe 1'
export type OrganLayerId = 'A' | 'B'
export type SynthLayerId = 'A' | 'B' | 'C'
export type OscillatorCategory = 'Pure' | 'Sync' | 'Multi' | 'Super' | 'FM-H'
export type SynthWaveform =
  | 'Sine' | 'Triangle' | 'Saw' | 'Square' | 'Pulse 33' | 'Pulse 10' | 'White Noise'
  | 'Sync Saw' | 'Sync Square' | 'Multi Saw' | 'Multi Saw 8ve' | 'Super Saw' | 'Super Square'
  | 'FM 2-op (algorithm A)'
export type SplitNote = 'C2' | 'F2' | 'C3' | 'F3' | 'C4' | 'F4' | 'C5' | 'F5' | 'C6' | 'F6' | 'C7'
export type CrossfadeWidth = 0 | 6 | 12
export type MorphSource = 'Wheel' | 'Control Pedal'

export const SYNTH_WAVEFORMS: Record<OscillatorCategory, SynthWaveform[]> = {
  Pure: ['Sine', 'Triangle', 'Saw', 'Square', 'Pulse 33', 'Pulse 10', 'White Noise'],
  Sync: ['Sync Saw', 'Sync Square'],
  Multi: ['Multi Saw', 'Multi Saw 8ve'],
  Super: ['Super Saw', 'Super Square'],
  'FM-H': ['FM 2-op (algorithm A)'],
}
export const SPLIT_POSITIONS: SplitNote[] = ['C2', 'F2', 'C3', 'F3', 'C4', 'F4', 'C5', 'F5', 'C6', 'F6', 'C7']
export const SPLIT_MIDI: Record<SplitNote, number> = { C2: 36, F2: 41, C3: 48, F3: 53, C4: 60, F4: 65, C5: 72, F5: 77, C6: 84, F6: 89, C7: 96 }
const LAYER_IDS: SynthLayerId[] = ['A', 'B', 'C']
const ORGAN_IDS: OrganLayerId[] = ['A', 'B']
export const STAGE3_STORAGE_KEY = 'stagebench-stage4-state-v1'

export interface OrganLayerState {
  enabled: boolean
  level: number
  octave: -1 | 0 | 1
  model: OrganModel
  drawbars: number[]
  percussionOn: boolean
  percussionSoft: boolean
  percussionFast: boolean
  percussionThird: boolean
  keyClick: boolean
  vibratoOn: boolean
  vibratoMode: 'C1' | 'C2' | 'C3' | 'V1' | 'V2' | 'V3'
  sustainPedal: boolean
  zoneStart: number
  zoneEnd: number
}

export interface OrganState {
  sectionOn: boolean
  focus: OrganLayerId
  rotaryRoute: boolean
  layers: Record<OrganLayerId, OrganLayerState>
}

export interface EnvelopeState { attack: number; decay: number; sustain: number; release: number; velocity: boolean; toPitch: boolean; amount: number }
export interface SynthLayerState {
  enabled: boolean
  level: number
  octave: -1 | 0 | 1
  effects: AudioConfiguration['effects']['units']['A']
  category: OscillatorCategory
  waveform: SynthWaveform
  oscCtrl: number
  pitch: number
  fine: number
  subLevel: number
  noiseLevel: number
  filterType: 'LP12' | 'LP24' | 'HP' | 'BP'
  cutoff: number
  resonance: number
  drive: 0 | 1 | 2 | 3
  tracking: 0 | 1 | 2 | 3
  oscillatorEnvelope: EnvelopeState
  filterEnvelope: EnvelopeState
  amplifierEnvelope: EnvelopeState
  lfoWaveform: 'Triangle' | 'Saw down' | 'Saw up' | 'Square' | 'Sample & Hold'
  lfoDestination: 'Off' | 'Osc Pitch' | 'Osc Ctrl' | 'Filter Freq'
  lfoRate: number
  lfoAmount: number
  lfoSync: boolean
  voiceMode: 'Poly' | 'Mono' | 'Legato'
  priority: 'Off' | 'Low' | 'High'
  glide: number
  unison: 0 | 1 | 2 | 3
  vibratoMode: 'On' | 'Wheel'
  vibratoRate: number
  vibratoAmount: number
  arpMode: 'Off' | 'Arp' | 'Poly' | 'Gate'
  arpRate: number
  arpRange: 1 | 2 | 3 | 4
  arpDirection: 'Up' | 'Down' | 'Up/Down' | 'Random'
  arpHold: boolean
  arpRun: boolean
  sustainPedal: boolean
  zoneStart: number
  zoneEnd: number
}

export interface SplitState {
  enabled: boolean
  points: Array<{ note: SplitNote; crossfade: CrossfadeWidth; enabled: boolean }>
  zoneCount: 1 | 2 | 3 | 4
}

export interface MorphAssignment {
  path: string
  start: number
  end: number
  value: number
}

export interface InstrumentPatch {
  piano: Omit<AudioConfiguration, 'masterLevel'>
  pianoZones: Record<'A' | 'B', { start: number; end: number }>
  organ: OrganState
  synth: { focus: SynthLayerId; layers: Record<SynthLayerId, SynthLayerState> }
  splits: SplitState
  scenes: {
    active: 'I' | 'II'
    enabled: Record<'I' | 'II', Record<string, boolean>>
  }
  morph: {
    positions: Record<MorphSource, number>
    assignments: Record<MorphSource, MorphAssignment[]>
    assigningSource: MorphSource | null
  }
  clockBpm: number
  clockSync: boolean
  transpose: number
}

export interface NamedPatch { name: string; patch: InstrumentPatch }
export interface Stage3State {
  schemaVersion: 1
  patch: InstrumentPatch
  programs: NamedPatch[]
  liveSlots: NamedPatch[]
  mode: 'program' | 'live'
  selectedProgram: number
  selectedLive: number
  dirty: boolean
  storeFlow: 'idle' | 'destination' | 'name' | 'store-as-destination'
  draftName: string
  listOpen: boolean
}

const envelope = (values: Partial<EnvelopeState> = {}): EnvelopeState => ({ attack: 0.04, decay: 0.28, sustain: 0.68, release: 0.24, velocity: false, toPitch: false, amount: 0.42, ...values })
const organLayer = (overrides: Partial<OrganLayerState> = {}): OrganLayerState => ({
  enabled: false, level: 0.72, octave: 0, model: 'B3', drawbars: [8, 4, 7, 2, 6, 3, 5, 2, 4],
  percussionOn: false, percussionSoft: false, percussionFast: false, percussionThird: false, keyClick: false,
  vibratoOn: false, vibratoMode: 'C1', sustainPedal: true, zoneStart: 0, zoneEnd: 3, ...overrides,
})
const synthLayer = (effects: AudioConfiguration['effects']['units']['A'], overrides: Partial<SynthLayerState> = {}): SynthLayerState => ({
  enabled: false, level: 0.68, octave: 0, category: 'Pure', waveform: 'Saw', oscCtrl: 0.24, pitch: 0, fine: 0, subLevel: 0, noiseLevel: 0,
  effects: structuredClone(effects),
  filterType: 'LP24', cutoff: 0.68, resonance: 0.25, drive: 0, tracking: 3,
  oscillatorEnvelope: envelope({ amount: 0.22 }), filterEnvelope: envelope({ amount: 0.35 }), amplifierEnvelope: envelope({ attack: 0.02, decay: 0.32, sustain: 0.74, release: 0.24, velocity: true, amount: 0.72 }),
  lfoWaveform: 'Triangle', lfoDestination: 'Off', lfoRate: 0.31, lfoAmount: 0.25, lfoSync: false,
  voiceMode: 'Poly', priority: 'Off', glide: 0, unison: 0, vibratoMode: 'Wheel', vibratoRate: 0.5, vibratoAmount: 0.2,
  arpMode: 'Off', arpRate: 0.52, arpRange: 1, arpDirection: 'Up', arpHold: false, arpRun: false,
  sustainPedal: true, zoneStart: 0, zoneEnd: 3, ...overrides,
})

export function createDefaultPatch(piano: AudioConfiguration): InstrumentPatch {
  const pianoState = structuredClone(piano) as AudioConfiguration
  const pianoWithoutMaster = Object.fromEntries(Object.entries(pianoState).filter(([key]) => key !== 'masterLevel')) as Omit<AudioConfiguration, 'masterLevel'>
  const organ: OrganState = {
    sectionOn: true, focus: 'A', rotaryRoute: false,
    layers: {
      A: organLayer({ enabled: false, model: 'B3' }),
      B: organLayer({ enabled: false, model: 'Vox', level: 0.56, drawbars: [8, 3, 6, 1, 7, 4, 2, 3, 5] }),
    },
  }
  const synth = {
    focus: 'A' as SynthLayerId,
    layers: {
      A: synthLayer(piano.effects.units.A, { enabled: false }),
      B: synthLayer(piano.effects.units.B, { enabled: false, category: 'Multi', waveform: 'Multi Saw', oscCtrl: 0.18, cutoff: 0.56 }),
      C: synthLayer(piano.effects.units.A, { enabled: false, category: 'FM-H', waveform: 'FM 2-op (algorithm A)', oscCtrl: 0.38, level: 0.42 }),
    },
  }
  return {
    piano: pianoWithoutMaster,
    pianoZones: { A: { start: 0, end: 3 }, B: { start: 0, end: 3 } },
    organ,
    synth,
    splits: { enabled: false, points: [{ note: 'C4', crossfade: 0, enabled: true }, { note: 'F5', crossfade: 0, enabled: false }, { note: 'C6', crossfade: 0, enabled: false }], zoneCount: 1 },
    scenes: {
      active: 'I',
      enabled: {
        I: { 'piano-A': true, 'piano-B': false, 'organ-A': false, 'organ-B': false, 'synth-A': false, 'synth-B': false, 'synth-C': false },
        II: { 'piano-A': true, 'piano-B': false, 'organ-A': false, 'organ-B': false, 'synth-A': false, 'synth-B': false, 'synth-C': false },
      },
    },
    morph: { positions: { Wheel: 0.5, 'Control Pedal': 0 }, assignments: { Wheel: [], 'Control Pedal': [] }, assigningSource: null },
    clockBpm: 120, clockSync: false, transpose: 0,
  }
}

export function clonePatch(patch: InstrumentPatch): InstrumentPatch { return structuredClone(patch) }
export function patchEqual(a: InstrumentPatch, b: InstrumentPatch): boolean { return JSON.stringify(a) === JSON.stringify(b) }

const FACTORY_NAMES = ['Grand Piano', 'Upright Ballad', 'Tine Stack', 'B3 Gospel', 'Vox Split', 'Pipe Choir', 'Analog Lead', 'Clockwork Arp']
function factoryPatch(index: number, base: InstrumentPatch): InstrumentPatch {
  const patch = clonePatch(base)
  switch (index) {
    case 1: patch.piano.pianoType = 'Upright'; patch.piano.performance.softRelease = true; break
    case 2: patch.piano.pianoType = 'Electric'; patch.piano.layers.B.enabled = true; patch.piano.performance.unison = 1; break
    case 3: patch.organ.layers.A.enabled = true; patch.organ.layers.A.model = 'B3'; patch.organ.layers.A.drawbars = [8, 0, 7, 0, 6, 0, 5, 0, 4]; break
    case 4: patch.organ.layers.A.enabled = true; patch.organ.layers.A.model = 'Vox'; patch.organ.layers.B.enabled = true; patch.organ.layers.B.model = 'Farf'; patch.splits.enabled = true; patch.splits.zoneCount = 2; break
    case 5: patch.organ.layers.A.enabled = true; patch.organ.layers.A.model = 'Pipe 1'; patch.organ.layers.A.drawbars = [8, 5, 7, 5, 6, 4, 5, 3, 2]; break
    case 6: patch.synth.layers.A.enabled = true; patch.synth.layers.A.category = 'Sync'; patch.synth.layers.A.waveform = 'Sync Saw'; patch.synth.layers.A.oscCtrl = 0.35; break
    case 7: patch.synth.layers.A.enabled = true; patch.synth.layers.A.arpRun = true; patch.synth.layers.A.arpMode = 'Arp'; patch.synth.layers.A.arpRate = 0.52; patch.clockSync = true; break
  }
  return patch
}

export function createInitialStage3State(piano: AudioConfiguration): Stage3State {
  const base = createDefaultPatch(piano)
  return {
    schemaVersion: 1, patch: clonePatch(base),
    programs: Array.from({ length: 32 }, (_, index) => ({ name: FACTORY_NAMES[index] ?? `Program ${String(index + 1).padStart(2, '0')}`, patch: index < FACTORY_NAMES.length ? factoryPatch(index, base) : clonePatch(base) })),
    liveSlots: Array.from({ length: 8 }, (_, index) => ({ name: `Live ${index + 1}`, patch: clonePatch(base) })),
    mode: 'program', selectedProgram: 0, selectedLive: 0, dirty: false, storeFlow: 'idle', draftName: '', listOpen: false,
  }
}

export function readStage3State(serialized: string | null, piano: AudioConfiguration): Stage3State {
  const initial = createInitialStage3State(piano)
  if (!serialized) return initial
  try {
    const value = JSON.parse(serialized) as Stage3State
    if (value.schemaVersion !== 1 || !Array.isArray(value.programs) || value.programs.length !== 32 || !Array.isArray(value.liveSlots) || value.liveSlots.length !== 8 || !value.patch) return initial
    const normalizePatch = (saved: InstrumentPatch): InstrumentPatch => ({
      ...initial.patch,
      ...saved,
      piano: { ...initial.patch.piano, ...saved.piano, modelVariant: saved.piano?.modelVariant === 1 || saved.piano?.modelVariant === 2 ? saved.piano.modelVariant : 0 },
      pianoZones: { ...initial.patch.pianoZones, ...saved.pianoZones },
      synth: {
        ...initial.patch.synth,
        ...saved.synth,
        layers: Object.fromEntries(LAYER_IDS.map((id) => [id, {
          ...initial.patch.synth.layers[id],
          ...saved.synth?.layers?.[id],
          effects: { ...initial.patch.synth.layers[id].effects, ...saved.synth?.layers?.[id]?.effects },
        }])) as InstrumentPatch['synth']['layers'],
      },
    })
    const programs = value.programs.map((slot, index) => ({ ...initial.programs[index]!, ...slot, patch: normalizePatch(slot.patch) }))
    const liveSlots = value.liveSlots.map((slot, index) => ({ ...initial.liveSlots[index]!, ...slot, patch: normalizePatch(slot.patch) }))
    const selectedProgram = Math.max(0, Math.min(31, Number.isFinite(value.selectedProgram) ? Math.trunc(value.selectedProgram) : 0))
    const selectedLive = Math.max(0, Math.min(7, Number.isFinite(value.selectedLive) ? Math.trunc(value.selectedLive) : 0))
    const mode = value.mode === 'live' ? 'live' : 'program'
    const patch = normalizePatch(value.patch)
    return { ...initial, ...value, patch, programs, liveSlots, selectedProgram, selectedLive, mode, dirty: mode === 'program' && !patchEqual(patch, programs[selectedProgram]!.patch) }
  } catch { return initial }
}

export function persistStage3State(storage: Pick<Storage, 'setItem'>, state: Stage3State, key = STAGE3_STORAGE_KEY): void {
  storage.setItem(key, JSON.stringify(state))
}

export function editPatch(state: Stage3State, patch: InstrumentPatch): Stage3State {
  const next = { ...state, patch: clonePatch(patch) }
  if (state.mode === 'live') {
    const liveSlots = state.liveSlots.map((slot, index) => index === state.selectedLive ? { ...slot, patch: clonePatch(patch) } : slot)
    return { ...next, liveSlots, dirty: false }
  }
  return { ...next, dirty: !patchEqual(next.patch, next.programs[next.selectedProgram]!.patch) }
}

export function selectProgram(state: Stage3State, index: number): Stage3State {
  const selectedProgram = Math.max(0, Math.min(31, Math.trunc(index)))
  return { ...state, mode: 'program', selectedProgram, patch: clonePatch(state.programs[selectedProgram]!.patch), dirty: false, storeFlow: 'idle', listOpen: false }
}

export function selectLive(state: Stage3State, index: number): Stage3State {
  const selectedLive = Math.max(0, Math.min(7, Math.trunc(index)))
  return { ...state, mode: 'live', selectedLive, patch: clonePatch(state.liveSlots[selectedLive]!.patch), dirty: false, storeFlow: 'idle', listOpen: false }
}

export function storeProgram(state: Stage3State, index = state.selectedProgram, name?: string): Stage3State {
  const destination = Math.max(0, Math.min(31, Math.trunc(index)))
  const programs = state.programs.map((slot, slotIndex) => slotIndex === destination ? { name: (name ?? slot.name).trim() || slot.name, patch: clonePatch(state.patch) } : slot)
  return { ...state, programs, mode: 'program', selectedProgram: destination, dirty: false, storeFlow: 'idle', draftName: '' }
}

export function setLivePatch(state: Stage3State, index: number, patch: InstrumentPatch): Stage3State {
  const destination = Math.max(0, Math.min(7, Math.trunc(index)))
  const liveSlots = state.liveSlots.map((slot, slotIndex) => slotIndex === destination ? { ...slot, patch: clonePatch(patch) } : slot)
  return { ...state, liveSlots, mode: 'live', selectedLive: destination, patch: clonePatch(patch), dirty: false }
}

export function splitCrossfadeGains(midi: number, splitMidi: number, width: CrossfadeWidth): { lower: number; upper: number } {
  if (width === 0) return midi < splitMidi ? { lower: 1, upper: 0 } : { lower: 0, upper: 1 }
  const distance = Math.max(-1, Math.min(1, (midi - splitMidi) / width))
  const position = (distance + 1) / 2
  return { lower: Math.cos(position * Math.PI / 2), upper: Math.sin(position * Math.PI / 2) }
}

export function zoneGainsForNote(midi: number, split: SplitState): Record<number, number> {
  if (!split.enabled || split.zoneCount <= 1) return { 0: 1 }
  const points = split.points.filter((point) => point.enabled).slice(0, split.zoneCount - 1).map((point) => ({ midi: SPLIT_MIDI[point.note], width: point.crossfade })).sort((a, b) => a.midi - b.midi)
  const primaryZone = points.filter((point) => midi >= point.midi).length
  const gains: Record<number, number> = { [primaryZone]: 1 }
  points.forEach((point, index) => {
    if (point.width === 0 || Math.abs(midi - point.midi) > point.width) return
    const pair = splitCrossfadeGains(midi, point.midi, point.width)
    gains[index] = pair.lower
    gains[index + 1] = pair.upper
  })
  return gains
}

export function routeLayerByZones(midi: number, zoneStart: number, zoneEnd: number, split: SplitState): number | null {
  if (!split.enabled || split.zoneCount <= 1) return 0
  const points = split.points.filter((point) => point.enabled).slice(0, split.zoneCount - 1).map((point) => SPLIT_MIDI[point.note]).sort((a, b) => a - b)
  const zone = points.filter((point) => midi >= point).length
  return zone >= zoneStart && zone <= zoneEnd ? zone : null
}

export function morphValue(assignment: MorphAssignment, position: number): number {
  const mix = Math.max(0, Math.min(1, position))
  return assignment.start + (assignment.end - assignment.start) * mix
}

export function applyMorphAssignments<T extends object>(base: T, assignments: MorphAssignment[], position: number, write: (target: T, path: string, value: number) => void): T {
  const target = structuredClone(base)
  for (const assignment of assignments) write(target, assignment.path, morphValue(assignment, position))
  return target
}

export function activeRoutesForPatch(patch: InstrumentPatch, midi: number): string[] {
  const routes: string[] = []
  const isInSplit = (zoneStart: number, zoneEnd: number) => Object.entries(zoneGainsForNote(midi, patch.splits)).some(([zone, gain]) => Number(zone) >= zoneStart && Number(zone) <= zoneEnd && gain > 0.0001)
  if (patch.piano.sectionOn) for (const id of ['A', 'B'] as const) { const zone = patch.pianoZones[id]; if (patch.piano.layers[id].enabled && isInSplit(zone.start, zone.end)) routes.push(`piano-${id}`) }
  if (patch.organ.sectionOn) for (const id of ORGAN_IDS) { const layer = patch.organ.layers[id]; if (layer.enabled && isInSplit(layer.zoneStart, layer.zoneEnd)) routes.push(`organ-${id}`) }
  for (const id of LAYER_IDS) { const layer = patch.synth.layers[id]; if (layer.enabled && isInSplit(layer.zoneStart, layer.zoneEnd)) routes.push(`synth-${id}`) }
  return routes
}

export function getPatchPathNumber(patch: InstrumentPatch, path: string): number | null {
  let value: unknown = patch
  for (const part of path.split('.')) {
    if (value === null || typeof value !== 'object') return null
    value = (value as Record<string, unknown>)[part]
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function setPatchPathNumber(patch: InstrumentPatch, path: string, next: number): void {
  const parts = path.split('.')
  let value: unknown = patch
  for (const part of parts.slice(0, -1)) {
    if (value === null || typeof value !== 'object') return
    value = (value as Record<string, unknown>)[part]
  }
  if (value !== null && typeof value === 'object') (value as Record<string, unknown>)[parts.at(-1)!] = next
}

export function synthWaveForCategory(category: OscillatorCategory, index: number): SynthWaveform {
  const options = SYNTH_WAVEFORMS[category]
  return options[Math.max(0, Math.min(options.length - 1, Math.trunc(index)))]!
}

export function buildArpeggioSequence(notes: number[], range: number, direction: SynthLayerState['arpDirection']): number[] {
  const roots = [...new Set(notes.filter((note) => Number.isFinite(note)).map((note) => Math.max(0, Math.min(127, Math.round(note)))))].sort((a, b) => a - b)
  const expanded = Array.from({ length: Math.max(1, Math.min(4, Math.round(range))) }, (_, octave) => roots.map((note) => note + octave * 12).filter((note) => note <= 127)).flat()
  if (direction === 'Down') return expanded.reverse()
  if (direction === 'Up/Down' && expanded.length > 2) return [...expanded, ...expanded.slice(1, -1).reverse()]
  if (direction === 'Random') {
    let seed = (roots.reduce((total, note) => total + note, 0) + expanded.length * 19) || 1
    const shuffled = [...expanded]
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      seed = (seed * 16807) % 2147483647
      const other = seed % (index + 1)
      ;[shuffled[index], shuffled[other]] = [shuffled[other]!, shuffled[index]!]
    }
    return shuffled
  }
  return expanded
}
