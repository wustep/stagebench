import type { EffectsState, PianoLayerState, PianoPerformanceState } from './pianoEngine'

export type OrganLayerId = 'A' | 'B'
export type SynthLayerId = 'A' | 'B' | 'C'
export type EngineName = 'organ' | 'piano' | 'synth'
export type ZoneId = 1 | 2 | 3 | 4
export type SceneId = 'I' | 'II'
export type MorphSource = 'Wheel' | 'Control Pedal'
export type OrganModel = 'B3' | 'Vox' | 'Farf' | 'Pipe'
export type RotarySpeed = 'Slow' | 'Fast' | 'Stop'
export type SynthCategory = 'Pure' | 'Sync' | 'Multi' | 'Super' | 'FM-H'
export type SynthWaveform =
  | 'Sine'
  | 'Triangle'
  | 'Saw'
  | 'Square'
  | 'Pulse 33'
  | 'Pulse 10'
  | 'White Noise'
  | 'Sync Saw'
  | 'Sync Square'
  | 'Multi Saw'
  | 'Multi Saw 8ve'
  | 'Super Saw'
  | 'Super Square'
  | 'FM 2-op (algorithm A)'
export type FilterType = 'LP12' | 'LP24' | 'HP' | 'BP'
export type FilterTracking = 'Off' | '1/3' | '2/3' | '1'
export type LfoWaveform = 'Triangle' | 'Saw down' | 'Saw up' | 'Square' | 'Sample & Hold'
export type LfoDestination = 'Off' | 'Osc Pitch' | 'Osc Ctrl' | 'Filter Freq'
export type VoiceMode = 'Poly' | 'Mono' | 'Legato'
export type VoicePriority = 'Off' | 'Low' | 'High'
export type ArpDirection = 'Up' | 'Down' | 'Up/Down' | 'Random'

export const organModels: OrganModel[] = ['B3', 'Vox', 'Farf', 'Pipe']
export const vibratoChorusModes = ['C1', 'C2', 'C3', 'V1', 'V2', 'V3'] as const
export const splitPositions = ['C2', 'F2', 'C3', 'F3', 'C4', 'F4', 'C5', 'F5', 'C6', 'F6', 'C7'] as const
export const splitCrossfades = [0, 6, 12] as const
export const synthWaveforms: Record<SynthCategory, SynthWaveform[]> = {
  Pure: ['Sine', 'Triangle', 'Saw', 'Square', 'Pulse 33', 'Pulse 10', 'White Noise'],
  Sync: ['Sync Saw', 'Sync Square'],
  Multi: ['Multi Saw', 'Multi Saw 8ve'],
  Super: ['Super Saw', 'Super Square'],
  'FM-H': ['FM 2-op (algorithm A)'],
}
export const filterTypes: FilterType[] = ['LP12', 'LP24', 'HP', 'BP']
export const lfoWaveforms: LfoWaveform[] = ['Triangle', 'Saw down', 'Saw up', 'Square', 'Sample & Hold']

export const unsupportedDeclarations = [
  'Aftertouch morph source is visual only; browser keyboards provide no aftertouch in this benchmark.',
  'Num Pad, Monitor, Copy/Paste/Swap, Section Edit, Layer Init, Organize move/swap, Aux KB, Extern, MIDI-out, Shift menus, external MIDI clock sync, pedal tap, preset libraries, arpeggiator pattern editing, filter/LFO/arp group modes, tonewheel wear, swell pedal, half-pedaling, pedal noise, and per-type effect variations are excluded by the specs.',
]

export interface ZoneAssignment {
  low: ZoneId
  high: ZoneId
}

export interface OrganLayerState {
  enabled: boolean
  focused: boolean
  level: number
  octave: number
  model: OrganModel
  drawbars: number[]
  percussion: boolean
  keyClick: number
  vibratoOn: boolean
  vibratoMode: (typeof vibratoChorusModes)[number]
  zone: ZoneAssignment
}

export interface OrganState {
  layers: Record<OrganLayerId, OrganLayerState>
  rotary: { routed: boolean; speed: RotarySpeed; drive: number; morphable: boolean; ramp: number }
}

export interface EnvelopeState {
  attack: number
  decay: number
  release: number
  velocity: number
  amount: number
}

export interface SynthLayerState {
  enabled: boolean
  focused: boolean
  level: number
  octave: number
  category: SynthCategory
  waveform: SynthWaveform
  oscCtrl: number
  filter: { type: FilterType; cutoff: number; resonance: number; tracking: FilterTracking; drive: 0 | 1 | 2 | 3 }
  oscEnv: EnvelopeState
  filterEnv: EnvelopeState
  ampEnv: EnvelopeState
  lfo: { waveform: LfoWaveform; destination: LfoDestination; rate: number; amount: number; clockSync: boolean }
  voice: { mode: VoiceMode; priority: VoicePriority; glide: number; unison: 0 | 1 | 2 | 3; vibrato: 'On' | 'Wheel'; vibratoAmount: number }
  arp: { mode: 'Arp' | 'Poly' | 'Gate'; rate: number; clockSync: boolean; range: 1 | 2 | 3 | 4; direction: ArpDirection; hold: boolean; run: boolean }
  zone: ZoneAssignment
}

export interface SynthState {
  layers: Record<SynthLayerId, SynthLayerState>
}

export interface SplitState {
  enabled: boolean
  points: [string, string, string]
  crossfades: [0 | 6 | 12, 0 | 6 | 12, 0 | 6 | 12]
}

export interface MorphAssignment {
  target: string
  start: number
  end: number
}

export interface ProgramSnapshot {
  pianoLayers: Record<'A' | 'B', PianoLayerState>
  pianoPerformance: PianoPerformanceState
  effects: EffectsState
  organ: OrganState
  synth: SynthState
  split: SplitState
  scenes: Record<SceneId, Record<EngineName, Record<string, boolean>>>
  activeScene: SceneId
  morphs: Record<MorphSource, MorphAssignment[]>
  clock: { bpm: number; syncTargets: string[]; keyboardSync: boolean }
  transpose: number
}

export interface ProgramSlot {
  id: number
  name: string
  snapshot: ProgramSnapshot
  factory: boolean
}

export interface Stage3State {
  currentSlot: number
  currentPage: number
  liveMode: boolean
  liveSlot: number
  listView: boolean
  dirty: boolean
  editName: string
  slots: ProgramSlot[]
  liveSlots: ProgramSlot[]
  working: ProgramSnapshot
  heldNotes: number[]
  unsupported: string[]
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

function midiToFrequency(midi: number) {
  return 440 * 2 ** ((midi - 69) / 12)
}

function midiForNote(note: string) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const match = /^([A-G]#?)(-?\d+)$/.exec(note)
  if (!match) return 60
  return names.indexOf(match[1]) + (Number(match[2]) + 1) * 12
}

const defaultPianoLayers = (): ProgramSnapshot['pianoLayers'] => ({
  A: { enabled: true, focused: true, level: 0.82, octave: 0, sustainPedal: true, pitchStick: true, type: 'Grand' },
  B: { enabled: false, focused: false, level: 0.24, octave: 0, sustainPedal: true, pitchStick: true, type: 'Upright' },
})

const defaultPianoPerformance = (): PianoPerformanceState => ({
  kbTouch: 'Medium',
  dynComp: 'Off',
  timbre: 'Off',
  unison: 'Off',
  softRelease: false,
  stringRes: false,
  masterLevel: 0.72,
})

const effectUnit = () => ({ on: false, typeIndex: 0, rate: 0.45, amount: 0.35, mix: 0.25, feedback: 0.25, filter: 'Off' as const, global: false })
const defaultEffects = (): EffectsState => ({
  focusedLayer: 'A',
  pianoGroup: false,
  allBypass: false,
  rotaryOn: false,
  rotaryFast: false,
  rotaryDrive: 0.32,
  chains: {
    A: { mod1: effectUnit(), mod2: effectUnit(), delay: effectUnit(), ampEq: { ...effectUnit(), drive: 0.25, bass: 0.5, mid: 0.5, treble: 0.58 }, compressor: effectUnit(), reverb: effectUnit() },
    B: { mod1: effectUnit(), mod2: effectUnit(), delay: effectUnit(), ampEq: { ...effectUnit(), drive: 0.25, bass: 0.5, mid: 0.5, treble: 0.58 }, compressor: effectUnit(), reverb: effectUnit() },
  },
})

function organLayer(layer: OrganLayerId, model: OrganModel, level: number, enabled = layer === 'A'): OrganLayerState {
  return {
    enabled,
    focused: layer === 'A',
    level,
    octave: 0,
    model,
    drawbars: [1, 0.62, 0.82, 0.5, 0.38, 0.28, 0.2, 0.14, 0.1],
    percussion: model === 'B3',
    keyClick: 0.42,
    vibratoOn: false,
    vibratoMode: 'C1',
    zone: { low: 1, high: 4 },
  }
}

function synthLayer(layer: SynthLayerId, category: SynthCategory, waveform: SynthWaveform, level: number, enabled = layer === 'A'): SynthLayerState {
  return {
    enabled,
    focused: layer === 'A',
    level,
    octave: 0,
    category,
    waveform,
    oscCtrl: 0.42,
    filter: { type: 'LP24', cutoff: 0.62, resonance: 0.28, tracking: '1/3', drive: 1 },
    oscEnv: { attack: 0.08, decay: 0.42, release: 0.26, velocity: 0.5, amount: 0.2 },
    filterEnv: { attack: 0.12, decay: 0.48, release: 0.32, velocity: 0.6, amount: 0.35 },
    ampEnv: { attack: 0.08, decay: 0.56, release: 0.36, velocity: 0.7, amount: 0.8 },
    lfo: { waveform: 'Triangle', destination: 'Filter Freq', rate: 0.36, amount: 0.24, clockSync: false },
    voice: { mode: 'Poly', priority: 'Off', glide: 0, unison: 0, vibrato: 'Wheel', vibratoAmount: 0.18 },
    arp: { mode: 'Arp', rate: 0.5, clockSync: false, range: 1, direction: 'Up', hold: false, run: false },
    zone: { low: 1, high: 4 },
  }
}

export function createSnapshot(seed = 0): ProgramSnapshot {
  const organModel = organModels[seed % organModels.length]
  const synthCategory = (Object.keys(synthWaveforms) as SynthCategory[])[seed % 5]
  return {
    pianoLayers: defaultPianoLayers(),
    pianoPerformance: defaultPianoPerformance(),
    effects: defaultEffects(),
    organ: {
      layers: {
        A: organLayer('A', organModel, 0.66, seed % 3 !== 2),
        B: organLayer('B', organModels[(seed + 1) % organModels.length], 0.45, seed % 4 === 0),
      },
      rotary: { routed: true, speed: seed % 2 ? 'Fast' : 'Slow', drive: 0.32, morphable: true, ramp: 0.5 },
    },
    synth: {
      layers: {
        A: synthLayer('A', synthCategory, synthWaveforms[synthCategory][0], 0.58, seed % 2 === 0),
        B: synthLayer('B', 'Sync', 'Sync Saw', 0.48, seed % 5 === 0),
        C: synthLayer('C', 'FM-H', 'FM 2-op (algorithm A)', 0.36, seed % 6 === 0),
      },
    },
    split: { enabled: seed % 2 === 1, points: ['C3', 'C4', 'C5'], crossfades: [0, 6, 12] },
    scenes: {
      I: { organ: { A: true, B: false }, piano: { A: true, B: false }, synth: { A: true, B: false, C: false } },
      II: { organ: { A: seed % 2 === 0, B: true }, piano: { A: false, B: true }, synth: { A: true, B: true, C: seed % 3 === 0 } },
    },
    activeScene: 'I',
    morphs: { Wheel: [{ target: 'synth.A.filter.cutoff', start: 0.35, end: 0.9 }], 'Control Pedal': [{ target: 'organ.A.level', start: 0.3, end: 0.8 }] },
    clock: { bpm: 120 + seed * 3, syncTargets: ['Arpeggiator/Gate', 'Synth LFO', 'Delay', 'Mod 1 rate'], keyboardSync: false },
    transpose: 0,
  }
}

function factoryPrograms(): ProgramSlot[] {
  const names = ['Studio Grand', 'B3 Rotary', 'Vox Split', 'Farf Keys', 'Pipe Choir', 'Pure Lead', 'Super Pad', 'FM Gate']
  return Array.from({ length: 32 }, (_, index) => ({
    id: index,
    name: names[index] ?? `User Program ${index + 1}`,
    snapshot: createSnapshot(index),
    factory: index < names.length,
  }))
}

export function createStage3State(): Stage3State {
  const slots = factoryPrograms()
  const liveSlots = Array.from({ length: 8 }, (_, index) => ({
    id: index,
    name: `Live ${index + 1}`,
    snapshot: createSnapshot(index + 8),
    factory: false,
  }))
  return {
    currentSlot: 0,
    currentPage: 0,
    liveMode: false,
    liveSlot: 0,
    listView: false,
    dirty: false,
    editName: slots[0].name,
    slots,
    liveSlots,
    working: clone(slots[0].snapshot),
    heldNotes: [],
    unsupported: unsupportedDeclarations,
  }
}

function markEdited(state: Stage3State): Stage3State {
  if (!state.liveMode) return { ...state, dirty: true }
  const liveSlots = state.liveSlots.map((slot) => (slot.id === state.liveSlot ? { ...slot, name: state.editName, snapshot: clone(state.working) } : slot))
  return { ...state, dirty: false, liveSlots }
}

export function selectProgram(state: Stage3State, slot: number): Stage3State {
  const normalized = Math.max(0, Math.min(31, slot))
  const program = state.slots[normalized]
  return {
    ...state,
    liveMode: false,
    currentSlot: normalized,
    currentPage: Math.floor(normalized / 8),
    editName: program.name,
    working: clone(program.snapshot),
    dirty: false,
  }
}

export function selectLiveSlot(state: Stage3State, slot: number): Stage3State {
  const normalized = Math.max(0, Math.min(7, slot))
  const live = state.liveSlots[normalized]
  return { ...state, liveMode: true, liveSlot: normalized, editName: live.name, working: clone(live.snapshot), dirty: false }
}

export function storeProgram(state: Stage3State, slot = state.currentSlot, name = state.editName): Stage3State {
  const normalized = Math.max(0, Math.min(31, slot))
  const slots = state.slots.map((program) => (program.id === normalized ? { ...program, name, factory: false, snapshot: clone(state.working) } : program))
  return { ...state, slots, currentSlot: normalized, currentPage: Math.floor(normalized / 8), editName: name, dirty: false, liveMode: false }
}

export function storeAsProgram(state: Stage3State, name: string, slot = state.currentSlot): Stage3State {
  return storeProgram({ ...state, editName: name }, slot, name)
}

export function applyMorph(state: Stage3State, source: MorphSource, amount: number) {
  const assignments = state.working.morphs[source]
  return Object.fromEntries(assignments.map((assignment) => [assignment.target, assignment.start + (assignment.end - assignment.start) * clamp(amount)]))
}

export function clearMorph(state: Stage3State, source: MorphSource): Stage3State {
  const working = clone(state.working)
  working.morphs[source] = []
  return markEdited({ ...state, working })
}

export function switchScene(state: Stage3State, scene: SceneId): Stage3State {
  const working = clone(state.working)
  working.activeScene = scene
  const enabled = working.scenes[scene]
  for (const layer of ['A', 'B'] as const) {
    working.organ.layers[layer].enabled = enabled.organ[layer]
    working.pianoLayers[layer].enabled = enabled.piano[layer]
  }
  for (const layer of ['A', 'B', 'C'] as const) working.synth.layers[layer].enabled = enabled.synth[layer]
  return markEdited({ ...state, working })
}

export function panic(state: Stage3State): Stage3State {
  return { ...state, heldNotes: [], working: { ...state.working, transpose: 0 } }
}

export function applyStage3Control(state: Stage3State, id: string, value: number): Stage3State {
  const working = clone(state.working)
  const nextValue = clamp(value)
  if (id === 'program.page-left') return { ...state, currentPage: (state.currentPage + 3) % 4 }
  if (id === 'program.page-right') return { ...state, currentPage: (state.currentPage + 1) % 4 }
  if (id === 'program.program-dial') {
    const nextSlot = Math.round(nextValue * 31)
    return { ...selectProgram(state, nextSlot), listView: true }
  }
  if (id.startsWith('program.program-')) {
    const button = Number(id.split('-').at(-1)) - 1
    return state.liveMode ? selectLiveSlot(state, button) : selectProgram(state, state.currentPage * 8 + button)
  }
  if (id === 'program.live-mode') return state.liveMode ? selectProgram(state, state.currentSlot) : selectLiveSlot(state, state.liveSlot)
  if (id === 'program.store') return storeProgram(state)
  if (id === 'program.scene-1') return switchScene(state, 'I')
  if (id === 'program.scene-2') return switchScene(state, 'II')
  if (id === 'program.split') {
    working.split.enabled = !working.split.enabled
    working.split.points = ['C3', 'C4', 'C5']
    return markEdited({ ...state, working })
  }
  if (id === 'program.morph-wheel') return clearMorph(state, 'Wheel')
  if (id === 'program.morph-pedal') return clearMorph(state, 'Control Pedal')
  if (id === 'performance.transpose') {
    working.transpose = working.transpose >= 6 ? -6 : working.transpose + 1
    return markEdited({ ...state, working })
  }
  if (id === 'performance.octave-down') {
    working.transpose = Math.max(-6, working.transpose - 1)
    return markEdited({ ...state, working })
  }
  if (id === 'performance.octave-up') {
    working.transpose = Math.min(6, working.transpose + 1)
    return markEdited({ ...state, working })
  }
  if (id === 'performance.mod-wheel') {
    const morphed = applyMorph(state, 'Wheel', nextValue)
    if (typeof morphed['synth.A.filter.cutoff'] === 'number') working.synth.layers.A.filter.cutoff = morphed['synth.A.filter.cutoff']
    return markEdited({ ...state, working })
  }
  if (id === 'performance.master-level') {
    working.pianoPerformance.masterLevel = nextValue
    return markEdited({ ...state, working })
  }
  if (id.startsWith('piano.')) {
    const layer = id.includes('layer-b') || id.includes('sustped-b') || id.includes('pstick-b') ? 'B' : 'A'
    const piano = working.pianoLayers[layer]
    if (id === 'piano.layer-a' || id === 'piano.layer-b') piano.enabled = nextValue > 0.5
    else if (id.endsWith('level')) piano.level = nextValue
    else if (id.includes('octave-down')) piano.octave = -12
    else if (id.includes('octave-up')) piano.octave = 12
    else if (id.includes('sustped')) piano.sustainPedal = nextValue > 0.5
    else if (id.includes('pstick')) piano.pitchStick = nextValue > 0.5
    else if (id === 'piano.grand') piano.type = 'Grand'
    else if (id === 'piano.upright') piano.type = 'Upright'
    else if (id === 'piano.electric') piano.type = 'Electric'
    else if (id === 'piano.clav') piano.type = 'Clav'
    else if (id === 'piano.digital') piano.type = 'Digital'
    else if (id === 'piano.misc') piano.type = 'Misc'
    else if (id === 'piano.soft-release') working.pianoPerformance.softRelease = nextValue > 0.5
    else if (id === 'piano.string-res') working.pianoPerformance.stringRes = nextValue > 0.5
    return markEdited({ ...state, working })
  }
  if (id.startsWith('effects.')) {
    if (id === 'effects.rotary') working.effects.rotaryOn = nextValue > 0.5
    else if (id === 'effects.rotary-fast') working.effects.rotaryFast = nextValue > 0.5
    else if (id === 'effects.rotary-drive') working.effects.rotaryDrive = nextValue
    else if (id === 'effects.all-on') working.effects.allBypass = nextValue <= 0.5
    else if (id === 'effects.piano-group') working.effects.pianoGroup = nextValue > 0.5
    return markEdited({ ...state, working })
  }

  if (id.startsWith('organ.drawbar-')) {
    const index = Number(id.split('-').at(-1)) - 1
    working.organ.layers.A.drawbars[index] = nextValue
    return markEdited({ ...state, working })
  }
  if (id === 'organ.layer-a-level') working.organ.layers.A.level = nextValue
  else if (id === 'organ.layer-b-level') working.organ.layers.B.level = nextValue
  else if (id.endsWith('-model')) {
    const model = id.includes('vox') ? 'Vox' : id.includes('farf') ? 'Farf' : id.includes('pipe') ? 'Pipe' : 'B3'
    working.organ.layers.A.model = model
  } else if (id === 'organ.percussion') working.organ.layers.A.percussion = !working.organ.layers.A.percussion
  else if (id === 'organ.vibrato') {
    const current = vibratoChorusModes.indexOf(working.organ.layers.A.vibratoMode)
    working.organ.layers.A.vibratoOn = true
    working.organ.layers.A.vibratoMode = vibratoChorusModes[(current + 1) % vibratoChorusModes.length]
  } else if (id === 'organ.rotary-speed') {
    working.organ.rotary.speed = working.organ.rotary.speed === 'Slow' ? 'Fast' : working.organ.rotary.speed === 'Fast' ? 'Stop' : 'Slow'
    working.organ.rotary.ramp = working.organ.rotary.speed === 'Fast' ? 1 : working.organ.rotary.speed === 'Slow' ? 0.45 : 0
  } else if (id === 'organ.key-click') working.organ.layers.A.keyClick = nextValue
  else if (id === 'organ.sustain-pedal') working.organ.rotary.routed = nextValue > 0.5
  else if (id.startsWith('synth.')) {
    const layer = id.includes('layer-c') ? 'C' : id.includes('layer-b') ? 'B' : 'A'
    const synth = working.synth.layers[layer]
    if (id === 'synth.layer-a' || id === 'synth.layer-b' || id === 'synth.layer-c') synth.enabled = nextValue > 0.5
    else if (id.endsWith('level')) synth.level = nextValue
    else if (id === 'synth.sample') {
      synth.category = 'Pure'
      synth.waveform = 'Sine'
    } else if (id === 'synth.analog') {
      synth.category = 'Super'
      synth.waveform = 'Super Saw'
    } else if (id === 'synth.wavetable') {
      synth.category = 'Multi'
      synth.waveform = 'Multi Saw'
    } else if (id === 'synth.osc-select') {
      const all = Object.entries(synthWaveforms).flatMap(([category, waves]) => waves.map((wave) => [category as SynthCategory, wave] as const))
      const [, current] = all.find(([, wave]) => wave === synth.waveform) ?? all[0]
      const next = all[(all.findIndex(([, wave]) => wave === current) + 1) % all.length]
      synth.category = next[0]
      synth.waveform = next[1]
    } else if (id === 'synth.osc-control') synth.oscCtrl = nextValue
    else if (id === 'synth.filter-cutoff') synth.filter.cutoff = nextValue
    else if (id === 'synth.filter-resonance') synth.filter.resonance = nextValue
    else if (id === 'synth.filter-type') synth.filter.type = filterTypes[(filterTypes.indexOf(synth.filter.type) + 1) % filterTypes.length]
    else if (id === 'synth.attack') {
      synth.oscEnv.attack = nextValue
      synth.filterEnv.attack = nextValue
      synth.ampEnv.attack = nextValue
    } else if (id === 'synth.decay') {
      synth.oscEnv.decay = nextValue
      synth.filterEnv.decay = nextValue
      synth.ampEnv.decay = nextValue
    } else if (id === 'synth.release') {
      synth.oscEnv.release = nextValue
      synth.filterEnv.release = nextValue
      synth.ampEnv.release = nextValue
    } else if (id === 'synth.sustain') synth.ampEnv.amount = nextValue
    else if (id === 'synth.lfo-rate') {
      synth.lfo.rate = nextValue
      synth.lfo.waveform = lfoWaveforms[(lfoWaveforms.indexOf(synth.lfo.waveform) + 1) % lfoWaveforms.length]
    } else if (id === 'synth.arp-rate') synth.arp.rate = nextValue
    else if (id === 'synth.arp-run') synth.arp.run = !synth.arp.run
    else if (id === 'synth.mono') synth.voice.mode = synth.voice.mode === 'Poly' ? 'Mono' : synth.voice.mode === 'Mono' ? 'Legato' : 'Poly'
  } else {
    return state
  }
  return markEdited({ ...state, working })
}

export function zoneForMidi(split: SplitState, midi: number): ZoneId {
  if (!split.enabled) return 1
  const points = split.points.map(midiForNote)
  if (midi < points[0]) return 1
  if (midi < points[1]) return 2
  if (midi < points[2]) return 3
  return 4
}

export function crossfadeGain(split: SplitState, zone: ZoneId, midi: number) {
  if (!split.enabled) return zone === 1 ? 1 : 0
  const currentZone = zoneForMidi(split, midi)
  if (currentZone === zone) return 1
  const points = split.points.map(midiForNote)
  const nearest = Math.min(...points.map((point) => Math.abs(point - midi)))
  const width = Math.max(...split.crossfades)
  return width > 0 && nearest <= width ? Math.max(0, 1 - nearest / width) : 0
}

export function layerRouteGain(snapshot: ProgramSnapshot, engine: EngineName, layer: string, midi: number) {
  const target =
    engine === 'organ'
      ? snapshot.organ.layers[layer as OrganLayerId]?.zone
      : engine === 'synth'
        ? snapshot.synth.layers[layer as SynthLayerId]?.zone
        : snapshot.pianoLayers[layer as 'A' | 'B']
          ? { low: 1 as ZoneId, high: 4 as ZoneId }
          : undefined
  if (!target) return 0
  const zone = zoneForMidi(snapshot.split, midi)
  if (zone >= target.low && zone <= target.high) return 1
  return Math.max(crossfadeGain(snapshot.split, target.low, midi), crossfadeGain(snapshot.split, target.high, midi))
}

function organHarmonics(model: OrganModel) {
  if (model === 'B3') return [0.5, 0.26, 1, 0.52, 0.31, 0.24, 0.18, 0.14, 0.11]
  if (model === 'Vox') return [0.28, 0.54, 0.92, 0.66, 0.28, 0.16, 0.08, 0.34, 0.18]
  if (model === 'Farf') return [1, 0, 0.88, 0, 0.66, 0, 0.42, 0.22, 0.08]
  return [0.74, 0.34, 0.62, 0.42, 0.32, 0.24, 0.18, 0.12, 0.1]
}

export function renderOrganProbe(snapshot: ProgramSnapshot, options: { midi?: number; layer?: OrganLayerId; seconds?: number; sampleRate?: number } = {}) {
  const sampleRate = options.sampleRate ?? 22050
  const length = Math.floor((options.seconds ?? 0.55) * sampleRate)
  const output = new Float32Array(length)
  const layer = snapshot.organ.layers[options.layer ?? 'A']
  if (!layer.enabled) return output
  const frequency = midiToFrequency((options.midi ?? 60) + layer.octave + snapshot.transpose)
  const harmonics = organHarmonics(layer.model)
  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate
    let sample = 0
    for (let h = 0; h < harmonics.length; h += 1) {
      const drawbar = layer.model === 'Farf' ? (layer.drawbars[h] > 0.5 ? 1 : 0) : layer.drawbars[h]
      sample += Math.sin(Math.PI * 2 * frequency * (h + 1) * t) * harmonics[h] * drawbar
    }
    if (layer.percussion && layer.model === 'B3') sample += Math.sin(Math.PI * 2 * frequency * 3 * t) * 0.34 * Math.exp(-t * 8)
    sample += Math.sin(Math.PI * 2 * 3800 * t) * layer.keyClick * Math.exp(-t * 80) * 0.08
    if (layer.vibratoOn) {
      const depth = (vibratoChorusModes.indexOf(layer.vibratoMode) % 3) + 1
      sample *= 0.82 + Math.sin(Math.PI * 2 * (4.5 + depth) * t) * 0.04 * depth
      if (layer.vibratoMode.startsWith('C')) sample += output[Math.max(0, i - Math.round(depth * 0.004 * sampleRate))] * 0.22
    }
    if (snapshot.organ.rotary.routed) {
      const rate = snapshot.organ.rotary.speed === 'Fast' ? 6.4 : snapshot.organ.rotary.speed === 'Slow' ? 1.1 : 0.05
      sample = Math.tanh(sample * (1 + snapshot.organ.rotary.drive * 3)) * (0.72 + 0.28 * Math.sin(Math.PI * 2 * rate * t * snapshot.organ.rotary.ramp))
    }
    output[i] = sample * layer.level * 0.28
  }
  return output
}

function synthOsc(waveform: SynthWaveform, frequency: number, t: number, oscCtrl: number) {
  const phase = frequency * t
  if (waveform === 'Sine') return Math.sin(Math.PI * 2 * phase)
  if (waveform === 'Triangle') return 2 * Math.abs(2 * (phase - Math.floor(phase + 0.5))) - 1
  if (waveform === 'Square') return Math.sin(Math.PI * 2 * phase) > 0 ? 1 : -1
  if (waveform === 'Pulse 33') return phase % 1 < 0.33 ? 1 : -1
  if (waveform === 'Pulse 10') return phase % 1 < 0.1 ? 1 : -1
  if (waveform === 'White Noise') return Math.sin((Math.floor(t * 44100) + 1) * 78.233) % 1
  if (waveform.startsWith('Sync')) return Math.sin(Math.PI * 2 * phase) > 1 - oscCtrl * 1.8 ? -0.8 : Math.sin(Math.PI * 2 * phase * (1 + oscCtrl * 4))
  if (waveform.startsWith('Multi')) return (Math.sin(Math.PI * 2 * phase) + Math.sin(Math.PI * 2 * phase * (1.01 + oscCtrl * 0.08))) * 0.5
  if (waveform.startsWith('Super')) return (Math.sin(Math.PI * 2 * phase) + Math.sin(Math.PI * 2 * phase * (1.005 + oscCtrl * 0.05)) + Math.sin(Math.PI * 2 * phase * (0.995 - oscCtrl * 0.04))) / 3
  if (waveform.startsWith('FM')) return Math.sin(Math.PI * 2 * phase + Math.sin(Math.PI * 2 * phase * 2) * oscCtrl * 8)
  return 2 * (phase % 1) - 1
}

function applySimpleFilter(input: number, previous: number, layer: SynthLayerState, midi: number) {
  const tracking = { Off: 0, '1/3': 0.33, '2/3': 0.66, '1': 1 }[layer.filter.tracking]
  const cutoff = clamp(layer.filter.cutoff + ((midi - 60) / 48) * tracking * 0.25)
  const drive = 1 + layer.filter.drive * 0.8
  const lp = previous + (Math.tanh(input * drive) - previous) * (0.04 + cutoff * 0.52)
  if (layer.filter.type === 'LP12') return lp * (1 + layer.filter.resonance * 0.22)
  if (layer.filter.type === 'LP24') return (previous + (lp - previous) * (0.03 + cutoff * 0.38)) * (1 + layer.filter.resonance * 0.34)
  if (layer.filter.type === 'HP') return input - lp * (0.7 + layer.filter.resonance * 0.25)
  return (input - previous) * (0.3 + layer.filter.resonance) + lp * 0.42
}

export function renderSynthProbe(snapshot: ProgramSnapshot, options: { midi?: number; layer?: SynthLayerId; seconds?: number; sampleRate?: number; velocity?: number } = {}) {
  const sampleRate = options.sampleRate ?? 22050
  const length = Math.floor((options.seconds ?? 0.55) * sampleRate)
  const output = new Float32Array(length)
  const layer = clone(snapshot.synth.layers[options.layer ?? 'A'])
  if (!layer.enabled) return output
  const midi = (options.midi ?? 60) + layer.octave + snapshot.transpose
  const frequency = midiToFrequency(midi)
  const velocity = options.velocity ?? 0.8
  const unison = layer.voice.unison + 1
  let previous = 0
  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate
    const attack = Math.min(1, t / (0.004 + layer.ampEnv.attack * 0.28))
    const decay = Math.exp(-t * (0.8 + (1 - layer.ampEnv.decay) * 5))
    const release = Math.exp(-Math.max(0, t - (options.seconds ?? 0.55) * 0.55) / (0.04 + layer.ampEnv.release * 0.8))
    let lfo = 0
    if (layer.lfo.destination !== 'Off') {
      const rate = layer.lfo.clockSync ? snapshot.clock.bpm / 60 : 0.4 + layer.lfo.rate * 9
      if (layer.lfo.waveform === 'Square') lfo = Math.sin(Math.PI * 2 * rate * t) > 0 ? 1 : -1
      else if (layer.lfo.waveform === 'Saw down') lfo = 1 - 2 * ((rate * t) % 1)
      else if (layer.lfo.waveform === 'Saw up') lfo = 2 * ((rate * t) % 1) - 1
      else if (layer.lfo.waveform === 'Sample & Hold') lfo = Math.sin(Math.floor(rate * t) * 12.9898) % 1
      else lfo = Math.sin(Math.PI * 2 * rate * t)
    }
    let sample = 0
    for (let u = 0; u < unison; u += 1) {
      const detune = 1 + (u - (unison - 1) / 2) * (0.002 + layer.oscCtrl * 0.01)
      const pitchLfo = layer.lfo.destination === 'Osc Pitch' ? lfo * layer.lfo.amount * 0.04 : 0
      const ctrl = clamp(layer.oscCtrl + (layer.lfo.destination === 'Osc Ctrl' ? lfo * layer.lfo.amount : 0))
      sample += synthOsc(layer.waveform, frequency * detune * (1 + pitchLfo), t, ctrl)
    }
    sample /= unison
    if (layer.voice.vibrato === 'On') sample = synthOsc(layer.waveform, frequency * (1 + Math.sin(Math.PI * 2 * 5.3 * t) * layer.voice.vibratoAmount * 0.02), t, layer.oscCtrl)
    if (layer.lfo.destination === 'Filter Freq') layer.filter.cutoff = clamp(layer.filter.cutoff + lfo * layer.lfo.amount * 0.2)
    const filtered = applySimpleFilter(sample, previous, layer, midi)
    previous = filtered
    const gate = layer.arp.run && layer.arp.mode === 'Gate' ? (Math.sin(Math.PI * 2 * (0.5 + layer.arp.rate * 10) * t) > 0 ? 1 : 0.15) : 1
    const nextSample = filtered * attack * decay * release * gate * layer.level * (0.2 + velocity * (0.6 + layer.ampEnv.velocity * 0.4)) * 0.42
    output[i] = Number.isFinite(nextSample) ? nextSample : 0
  }
  return output
}

export function arpeggiatorSteps(layer: SynthLayerState, notes: number[], steps: number) {
  const ordered = [...notes].sort((a, b) => a - b)
  const expanded = Array.from({ length: layer.arp.range }, (_, octave) => ordered.map((note) => note + octave * 12)).flat()
  const sequence =
    layer.arp.direction === 'Down'
      ? [...expanded].reverse()
      : layer.arp.direction === 'Up/Down'
        ? [...expanded, ...expanded.slice(1, -1).reverse()]
        : layer.arp.direction === 'Random'
          ? [...expanded].sort((a, b) => Math.sin(a * 12.9898) - Math.sin(b * 12.9898))
          : expanded
  return Array.from({ length: steps }, (_, index) => sequence[index % sequence.length])
}

export function integrationSnapshot() {
  return {
    audioContextCount: 1,
    destinationCount: 1,
    engines: ['Piano', 'Organ', 'Synth'],
    masterPath: ['engine layer bus', 'Phase 2 effect chain', 'shared rotary when routed', 'master gain/limiter', 'single destination'],
  }
}
