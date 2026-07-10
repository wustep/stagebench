/**
 * Bind hardware control IDs to full instrument engine state (Phase 3).
 * Spec-excluded controls remain presentation-only (honesty contract).
 */

import type { PianoEngine } from '../audio/piano-engine'
import {
  AMP_TYPES,
  cycleEnum,
  DELAY_FILTERS,
  dynCompFromKnob,
  kbTouchFromKnob,
  MOD1_TYPES,
  MOD2_TYPES,
  PIANO_TYPES,
  REVERB_TYPES,
  timbreFromKnob,
  type AmpType,
  type DelayFilter,
  type LayerId,
  type Mod1Type,
  type Mod2Type,
  type PianoType,
  type ReverbType,
  type Unison,
} from '../model/piano-types'
import { ORGAN_MODELS, VIBRATO_POSITIONS, type OrganModel } from '../model/organ-types'
import {
  ALL_REQUIRED_WAVEFORMS,
  FILTER_TYPES,
  LFO_DESTS,
  LFO_WAVES,
  type SynthWaveform,
} from '../model/synth-types'
import { hardwareStore } from '../state/hardware-store'
import { programStore } from '../state/program-store'
import { SPLIT_POSITIONS } from '../model/program-types'

/** Spec-excluded controls: decorative only */
export const UNSUPPORTED_CONTROLS = [
  'program-morph-aft', // aftertouch morph excluded
  'perf-hold', // Aux/hold menus excluded
  'perf-mono', // section mono via synth voice modes
] as const

const FUNCTIONAL_PREFIXES = [
  'piano-',
  'fx-',
  'organ-',
  'synth-',
  'program-',
  'perf-master-level',
  'perf-panic',
  'perf-transpose',
  'perf-kb-zones',
  'perf-mod-wheel',
  'perf-pitch-stick',
]

export function isFunctionalControl(id: string): boolean {
  if ((UNSUPPORTED_CONTROLS as readonly string[]).includes(id)) return false
  if (id === 'perf-master-level' || id === 'perf-panic' || id === 'perf-transpose') return true
  if (id === 'perf-kb-zones' || id === 'perf-mod-wheel' || id === 'perf-pitch-stick') return true
  return (
    id.startsWith('piano-') ||
    id.startsWith('fx-') ||
    id.startsWith('organ-') ||
    id.startsWith('synth-') ||
    id.startsWith('program-')
  )
}

const TYPE_BUTTONS: Record<string, PianoType> = {
  'piano-type-grand': 'Grand',
  'piano-type-upright': 'Upright',
  'piano-type-electric': 'Electric',
  'piano-type-clav': 'Clav',
  'piano-type-digital': 'Digital',
  'piano-type-misc': 'Misc',
}

let unisonPresses = 0
let mod1TypeIdx = 1
let mod2TypeIdx = 0
let reverbTypeIdx = 4
let waveIdx = 2
let filterTypeIdx = 1
let vibPosIdx = 0
let synthUnisonPresses = 0
let transposeValue = 0
const clockTaps: number[] = []

export function resetBindingCounters(): void {
  unisonPresses = 0
  mod1TypeIdx = 1
  mod2TypeIdx = 0
  reverbTypeIdx = 4
  waveIdx = 2
  filterTypeIdx = 1
  vibPosIdx = 0
  synthUnisonPresses = 0
  transposeValue = 0
  clockTaps.length = 0
}

function syncEngineToProgram(engine: PianoEngine): void {
  programStore.replaceWorking(engine.captureProgramSound(), true)
}

function focusedChainKey(
  engine: PianoEngine,
): 'Organ' | 'PianoA' | 'PianoB' | 'SynthA' | 'SynthB' | 'SynthC' {
  const fx = engine.getEffectsState()
  const map: Record<string, 'Organ' | 'PianoA' | 'PianoB' | 'SynthA' | 'SynthB' | 'SynthC'> = {
    OrganA: 'Organ',
    OrganB: 'Organ',
    PianoA: 'PianoA',
    PianoB: 'PianoB',
    SynthA: 'SynthA',
    SynthB: 'SynthB',
    SynthC: 'SynthC',
  }
  return map[fx.layerFocus] ?? 'PianoA'
}

function editFocusedChain(engine: PianoEngine, mutate: (c: ReturnType<typeof engine.getEffectsState>['chains']['PianoA']) => void) {
  const key = focusedChainKey(engine)
  engine.updateChain(key, (c) => {
    const next = { ...c, mod1: { ...c.mod1 }, mod2: { ...c.mod2 }, delay: { ...c.delay }, ampEq: { ...c.ampEq }, compressor: { ...c.compressor }, reverb: { ...c.reverb } }
    mutate(next)
    return next
  })
}

/** Apply a control value change to the engine when functional */
export function applyControlToEngine(engine: PianoEngine, id: string, value: number): void {
  if (!isFunctionalControl(id)) return

  if (id === 'perf-master-level') {
    engine.setMasterLevel(value)
    return
  }

  // Piano continuous
  if (id === 'piano-level-a') {
    engine.updateLayer('A', { level: value })
    return
  }
  if (id === 'piano-level-b') {
    engine.updateLayer('B', { level: value })
    return
  }
  if (id === 'piano-kb-touch') {
    engine.setPianoState({ kbTouch: kbTouchFromKnob(value) })
    return
  }
  if (id === 'piano-dyn-comp') {
    engine.setPianoState({ dynComp: dynCompFromKnob(value) })
    return
  }
  if (id === 'piano-timbre') {
    engine.setPianoState({ timbre: timbreFromKnob(engine.getPianoState().type, value) })
    return
  }
  if (id === 'piano-model') {
    engine.setPianoState({ modelIndex: Math.floor(value * 8) })
    return
  }

  // Effects knobs
  if (id === 'fx-mod1-rate') {
    editFocusedChain(engine, (c) => {
      c.mod1.rate = value
    })
    return
  }
  if (id === 'fx-mod1-amount') {
    editFocusedChain(engine, (c) => {
      c.mod1.amount = value
    })
    return
  }
  if (id === 'fx-mod2-rate') {
    editFocusedChain(engine, (c) => {
      c.mod2.rate = value
    })
    return
  }
  if (id === 'fx-mod2-amount') {
    editFocusedChain(engine, (c) => {
      c.mod2.amount = value
    })
    return
  }
  if (id === 'fx-delay-time') {
    editFocusedChain(engine, (c) => {
      c.delay.tempo = value
    })
    return
  }
  if (id === 'fx-delay-feedback') {
    editFocusedChain(engine, (c) => {
      c.delay.feedback = value
    })
    return
  }
  if (id === 'fx-delay-mix') {
    editFocusedChain(engine, (c) => {
      c.delay.mix = value
    })
    return
  }
  if (id === 'fx-amp-drive') {
    editFocusedChain(engine, (c) => {
      c.ampEq.drive = value
    })
    return
  }
  if (id === 'fx-eq-bass') {
    editFocusedChain(engine, (c) => {
      c.ampEq.bass = value
    })
    return
  }
  if (id === 'fx-eq-mid') {
    editFocusedChain(engine, (c) => {
      c.ampEq.mid = value
    })
    return
  }
  if (id === 'fx-eq-treble') {
    editFocusedChain(engine, (c) => {
      c.ampEq.treble = value
    })
    return
  }
  if (id === 'fx-comp-amount') {
    editFocusedChain(engine, (c) => {
      c.compressor.amount = value
    })
    return
  }
  if (id === 'fx-reverb-amount') {
    editFocusedChain(engine, (c) => {
      c.reverb.mix = value
    })
    return
  }
  if (id === 'fx-reverb-time') {
    editFocusedChain(engine, (c) => {
      c.reverb.time = value
    })
    return
  }

  // Organ continuous
  if (id === 'organ-level-a') {
    engine.updateOrganLayer('A', { level: value })
    return
  }
  if (id === 'organ-level-b') {
    engine.updateOrganLayer('B', { level: value })
    return
  }
  if (id === 'organ-drive') {
    engine.setOrganState({ rotaryDrive: value })
    return
  }
  if (id === 'organ-key-click') {
    engine.setOrganState({ keyClick: value })
    return
  }
  if (id.startsWith('organ-drawbar-')) {
    const n = Number(id.split('-').pop()) - 1
    const focus = engine.getOrganState().focus
    const bars = [...engine.getOrganState().layers[focus].drawbars]
    if (n >= 0 && n < 9) {
      bars[n] = value
      engine.updateOrganLayer(focus, { drawbars: bars })
      // morph assign
      if (programStore.getState().morphAssignSource) {
        programStore.assignMorph(`organ.drawbar.${n + 1}`, 0, value)
      }
    }
    return
  }

  // Synth continuous
  if (id === 'synth-level-a') {
    engine.updateSynthLayer('A', { level: value })
    return
  }
  if (id === 'synth-level-b') {
    engine.updateSynthLayer('B', { level: value })
    return
  }
  if (id === 'synth-level-c') {
    engine.updateSynthLayer('C', { level: value })
    return
  }
  if (id === 'synth-osc-ctrl') {
    engine.updateSynthLayer(engine.getSynthState().focus, { oscCtrl: value })
    return
  }
  if (id === 'synth-filter-freq') {
    engine.updateSynthLayer(engine.getSynthState().focus, { filterFreq: value })
    return
  }
  if (id === 'synth-filter-res') {
    engine.updateSynthLayer(engine.getSynthState().focus, { filterRes: value })
    return
  }
  if (id === 'synth-filter-drive') {
    const d = value < 0.2 ? 'Off' : value < 0.45 ? 1 : value < 0.7 ? 2 : 3
    engine.updateSynthLayer(engine.getSynthState().focus, { filterDrive: d as 'Off' | 1 | 2 | 3 })
    return
  }
  if (id === 'synth-env-attack') {
    const focus = engine.getSynthState().focus
    const env = engine.getSynthState().layers[focus].ampEnv
    engine.updateSynthLayer(focus, { ampEnv: { ...env, attack: value } })
    return
  }
  if (id === 'synth-env-decay') {
    const focus = engine.getSynthState().focus
    const env = engine.getSynthState().layers[focus].ampEnv
    engine.updateSynthLayer(focus, { ampEnv: { ...env, decay: value } })
    return
  }
  if (id === 'synth-env-release') {
    const focus = engine.getSynthState().focus
    const env = engine.getSynthState().layers[focus].ampEnv
    engine.updateSynthLayer(focus, { ampEnv: { ...env, release: value } })
    return
  }
  if (id === 'synth-mod-env-attack') {
    const focus = engine.getSynthState().focus
    const env = engine.getSynthState().layers[focus].filterEnv
    engine.updateSynthLayer(focus, { filterEnv: { ...env, attack: value } })
    return
  }
  if (id === 'synth-mod-env-decay') {
    const focus = engine.getSynthState().focus
    const env = engine.getSynthState().layers[focus].filterEnv
    engine.updateSynthLayer(focus, { filterEnv: { ...env, decay: value } })
    return
  }
  if (id === 'synth-lfo-rate') {
    engine.updateSynthLayer(engine.getSynthState().focus, { lfoRate: value })
    return
  }
  if (id === 'synth-lfo-amount') {
    engine.updateSynthLayer(engine.getSynthState().focus, { lfoAmount: value })
    return
  }
  if (id === 'synth-arp-rate') {
    engine.updateSynthLayer(engine.getSynthState().focus, { arpRate: value })
    return
  }
  if (id === 'synth-osc-shape') {
    // optional shape — map to oscCtrl for Super/Multi
    engine.updateSynthLayer(engine.getSynthState().focus, { oscCtrl: value })
    return
  }

  // Performance continuous
  if (id === 'perf-mod-wheel') {
    programStore.setWheel(value)
    engine.applyMorphValues('Wheel', value)
    // synth vibrato wheel mode
    for (const layer of ['A', 'B', 'C'] as const) {
      const ls = engine.getSynthState().layers[layer]
      if (ls.vibrato === 'Wheel') {
        engine.updateSynthLayer(layer, { vibratoAmount: value })
      }
    }
    return
  }
  if (id === 'program-dial') {
    // continuous dial position maps to browse on large change handled at button-like steps via binding
    return
  }
}

/** Apply button press to engine */
export function applyButtonToEngine(engine: PianoEngine, id: string): void {
  if (!isFunctionalControl(id)) return

  if (id === 'perf-panic') {
    engine.panic()
    return
  }

  if (id === 'perf-transpose') {
    if (programStore.getState().shift) {
      engine.panic()
      return
    }
    transposeValue = transposeValue >= 6 ? -6 : transposeValue + 1
    engine.setProgramExtras({ transpose: transposeValue })
    programStore.setWorking({ transpose: transposeValue })
    return
  }

  if (id === 'perf-kb-zones') {
    // open split editing: toggle mid split
    const split = engine.getProgramSound().split
    engine.setProgramExtras({
      split: {
        ...split,
        on: !split.on,
        points: {
          ...split.points,
          Mid: { enabled: true, note: 'C4', crossfade: split.points.Mid.crossfade },
        },
      },
    })
    programStore.setSplitOn(!split.on)
    return
  }

  // --- Program ---
  if (id.startsWith('program-btn-')) {
    const n = Number(id.split('-').pop()) - 1
    const st = programStore.getState()
    if (st.storeMode !== 'off') {
      const dest = st.liveMode ? n : st.page * 8 + n
      programStore.setStoreDest(dest)
      return
    }
    if (st.liveMode) {
      // discard dirty on change
      programStore.selectLive(n)
    } else {
      programStore.selectProgram(st.page * 8 + n)
    }
    engine.applyProgramSound(programStore.getWorking())
    for (let i = 1; i <= 8; i++) {
      hardwareStore.setValue(`program-btn-${i}`, i === n + 1 ? 1 : 0)
    }
    return
  }
  if (id === 'program-page-up') {
    programStore.pageUp()
    engine.applyProgramSound(programStore.getWorking())
    return
  }
  if (id === 'program-page-down') {
    programStore.pageDown()
    engine.applyProgramSound(programStore.getWorking())
    return
  }
  if (id === 'program-live') {
    const on = hardwareStore.getValue(id) > 0.5
    programStore.setLiveMode(on)
    engine.applyProgramSound(programStore.getWorking())
    return
  }
  if (id === 'program-scene-1') {
    programStore.setScene('I')
    engine.applyProgramSound(programStore.getWorking())
    hardwareStore.setValue('program-scene-1', 1)
    hardwareStore.setValue('program-scene-2', 0)
    return
  }
  if (id === 'program-scene-2') {
    programStore.setScene('II')
    engine.applyProgramSound(programStore.getWorking())
    hardwareStore.setValue('program-scene-1', 0)
    hardwareStore.setValue('program-scene-2', 1)
    return
  }
  if (id === 'program-store') {
    programStore.storePress()
    if (programStore.getState().storeMode === 'off') {
      // confirmed — already stored working
    } else if (programStore.getState().storeMode === 'store') {
      // first press — wait
    }
    return
  }
  if (id === 'program-store-as') {
    programStore.storeAsPress()
    programStore.setStoreName(programStore.currentName())
    programStore.confirmStore()
    return
  }
  if (id === 'program-split') {
    const on = hardwareStore.getValue(id) > 0.5
    programStore.setSplitOn(on)
    engine.setProgramExtras({ split: programStore.getWorking().split })
    return
  }
  if (id === 'program-morph-wheel') {
    if (programStore.getState().shift) {
      programStore.clearMorph('Wheel')
      return
    }
    const latch = programStore.getState().morphAssignSource === 'Wheel'
    programStore.beginMorphAssign('Wheel', latch)
    return
  }
  if (id === 'program-morph-ctrl') {
    if (programStore.getState().shift) {
      programStore.clearMorph('Control Pedal')
      return
    }
    programStore.beginMorphAssign('Control Pedal')
    return
  }
  if (id === 'program-list') {
    programStore.setListView(!(programStore.getState().listView))
    return
  }
  if (id === 'program-shift') {
    programStore.setShift(hardwareStore.getValue(id) > 0.5)
    return
  }
  if (id === 'program-dial') {
    // encoder step: browse
    programStore.dialBrowse(1)
    engine.applyProgramSound(programStore.getWorking())
    return
  }

  // --- Organ ---
  if (id === 'organ-section-on') {
    engine.setOrganState({ sectionOn: hardwareStore.getValue(id) > 0.5 })
    return
  }
  if (id === 'organ-layer-a') {
    const org = engine.getOrganState()
    if (org.focus !== 'A') {
      engine.setOrganState({ focus: 'A' })
      engine.setEffectsState({ layerFocus: 'OrganA', focusSection: 'Organ' })
      syncFxFocusButtons('OrganA')
    } else {
      engine.updateOrganLayer('A', { enabled: hardwareStore.getValue(id) > 0.5 })
    }
    return
  }
  if (id === 'organ-layer-b') {
    const org = engine.getOrganState()
    if (org.focus !== 'B') {
      engine.setOrganState({ focus: 'B' })
      if (!org.layers.B.enabled) engine.updateOrganLayer('B', { enabled: true, level: 0.7 })
      engine.setEffectsState({ layerFocus: 'OrganB', focusSection: 'Organ' })
      syncFxFocusButtons('OrganB')
    } else {
      engine.updateOrganLayer('B', { enabled: hardwareStore.getValue(id) > 0.5 })
    }
    return
  }
  const organModels: Record<string, OrganModel> = {
    'organ-model-b3': 'B3',
    'organ-model-vox': 'Vox',
    'organ-model-farf': 'Farf',
    'organ-model-pipe': 'Pipe 1',
  }
  if (id in organModels) {
    const model = organModels[id]!
    const focus = engine.getOrganState().focus
    engine.updateOrganLayer(focus, { model })
    for (const [btn, m] of Object.entries(organModels)) {
      hardwareStore.setValue(btn, m === model ? 1 : 0)
    }
    return
  }
  if (id === 'organ-oct-a-down') {
    engine.updateOrganLayer('A', {
      octave: Math.max(-2, engine.getOrganState().layers.A.octave - 1),
    })
    return
  }
  if (id === 'organ-oct-a-up') {
    engine.updateOrganLayer('A', {
      octave: Math.min(2, engine.getOrganState().layers.A.octave + 1),
    })
    return
  }
  if (id === 'organ-oct-b-down') {
    engine.updateOrganLayer('B', {
      octave: Math.max(-2, engine.getOrganState().layers.B.octave - 1),
    })
    return
  }
  if (id === 'organ-oct-b-up') {
    engine.updateOrganLayer('B', {
      octave: Math.min(2, engine.getOrganState().layers.B.octave + 1),
    })
    return
  }
  if (id === 'organ-perc-on') {
    engine.setOrganState({
      percussion: { ...engine.getOrganState().percussion, on: hardwareStore.getValue(id) > 0.5 },
    })
    return
  }
  if (id === 'organ-perc-soft') {
    engine.setOrganState({
      percussion: { ...engine.getOrganState().percussion, soft: hardwareStore.getValue(id) > 0.5 },
    })
    return
  }
  if (id === 'organ-perc-fast') {
    engine.setOrganState({
      percussion: { ...engine.getOrganState().percussion, fast: hardwareStore.getValue(id) > 0.5 },
    })
    return
  }
  if (id === 'organ-perc-third') {
    engine.setOrganState({
      percussion: { ...engine.getOrganState().percussion, third: hardwareStore.getValue(id) > 0.5 },
    })
    return
  }
  if (id === 'organ-vibrato') {
    vibPosIdx = (vibPosIdx + 1) % VIBRATO_POSITIONS.length
    const focus = engine.getOrganState().focus
    const on = true
    engine.updateOrganLayer(focus, {
      vibratoOn: on,
      vibratoPos: VIBRATO_POSITIONS[vibPosIdx]!,
    })
    hardwareStore.setValue(id, 1)
    return
  }
  if (id === 'organ-rotary-speed') {
    const cur = engine.getOrganState().rotarySpeed
    const next = cur === 'Slow' ? 'Fast' : 'Slow'
    engine.setOrganState({ rotarySpeed: next, rotaryOn: true })
    engine.setEffectsState({ rotary: { ...engine.getEffectsState().rotary, on: true, fast: next === 'Fast' } })
    return
  }
  if (id === 'organ-rotary-stop') {
    const stop = hardwareStore.getValue(id) > 0.5
    engine.setOrganState({ rotarySpeed: stop ? 'Stop' : 'Slow', rotaryOn: !stop })
    return
  }
  if (id === 'organ-sustped') {
    const on = hardwareStore.getValue(id) > 0.5
    engine.updateOrganLayer('A', { sustped: on })
    engine.updateOrganLayer('B', { sustped: on })
    return
  }

  // --- Synth ---
  if (id === 'synth-section-on') {
    engine.setSynthState({ sectionOn: hardwareStore.getValue(id) > 0.5 })
    return
  }
  if (id === 'synth-layer-a' || id === 'synth-layer-b' || id === 'synth-layer-c') {
    const layer = id.endsWith('-a') ? 'A' : id.endsWith('-b') ? 'B' : 'C'
    const syn = engine.getSynthState()
    if (syn.focus !== layer) {
      engine.setSynthState({ focus: layer })
      const lf = layer === 'A' ? 'SynthA' : layer === 'B' ? 'SynthB' : 'SynthC'
      engine.setEffectsState({ layerFocus: lf, focusSection: 'Synth' })
      syncFxFocusButtons(lf)
      if (!syn.layers[layer].enabled) {
        engine.updateSynthLayer(layer, { enabled: true, level: Math.max(0.5, syn.layers[layer].level) })
      }
    } else {
      engine.updateSynthLayer(layer, { enabled: hardwareStore.getValue(id) > 0.5 })
    }
    return
  }
  if (id === 'synth-osc-wave') {
    waveIdx = (waveIdx + 1) % ALL_REQUIRED_WAVEFORMS.length
    const w = ALL_REQUIRED_WAVEFORMS[waveIdx]! as SynthWaveform
    engine.updateSynthLayer(engine.getSynthState().focus, { waveform: w })
    return
  }
  if (id === 'synth-filter-type') {
    filterTypeIdx = (filterTypeIdx + 1) % FILTER_TYPES.length
    engine.updateSynthLayer(engine.getSynthState().focus, {
      filterType: FILTER_TYPES[filterTypeIdx]!,
    })
    return
  }
  if (id === 'synth-voice-poly') {
    engine.updateSynthLayer(engine.getSynthState().focus, { voiceMode: 'Poly' })
    hardwareStore.setValue('synth-voice-poly', 1)
    hardwareStore.setValue('synth-voice-mono', 0)
    hardwareStore.setValue('synth-voice-legato', 0)
    return
  }
  if (id === 'synth-voice-mono') {
    engine.updateSynthLayer(engine.getSynthState().focus, { voiceMode: 'Mono' })
    hardwareStore.setValue('synth-voice-poly', 0)
    hardwareStore.setValue('synth-voice-mono', 1)
    hardwareStore.setValue('synth-voice-legato', 0)
    return
  }
  if (id === 'synth-voice-legato') {
    engine.updateSynthLayer(engine.getSynthState().focus, { voiceMode: 'Legato' })
    hardwareStore.setValue('synth-voice-poly', 0)
    hardwareStore.setValue('synth-voice-mono', 0)
    hardwareStore.setValue('synth-voice-legato', 1)
    return
  }
  if (id === 'synth-unison') {
    synthUnisonPresses++
    const levels = ['Off', 1, 2, 3] as const
    engine.updateSynthLayer(engine.getSynthState().focus, {
      unison: levels[synthUnisonPresses % 4]!,
    })
    return
  }
  if (id === 'synth-vibrato') {
    const focus = engine.getSynthState().focus
    const cur = engine.getSynthState().layers[focus].vibrato
    const next = cur === 'Off' ? 'On' : cur === 'On' ? 'Wheel' : 'Off'
    engine.updateSynthLayer(focus, { vibrato: next })
    hardwareStore.setValue(id, next === 'Off' ? 0 : 1)
    return
  }
  if (id === 'synth-arp-on') {
    const focus = engine.getSynthState().focus
    const on = hardwareStore.getValue(id) > 0.5
    engine.updateSynthLayer(focus, { arpOn: on, arpRun: on })
    return
  }
  if (id === 'synth-arp-hold') {
    engine.updateSynthLayer(engine.getSynthState().focus, {
      arpHold: hardwareStore.getValue(id) > 0.5,
    })
    return
  }
  if (id.startsWith('synth-oct-')) {
    const m = id.match(/synth-oct-([abc])-(down|up)/)
    if (m) {
      const layer = m[1]!.toUpperCase() as 'A' | 'B' | 'C'
      const dir = m[2] === 'up' ? 1 : -1
      const o = engine.getSynthState().layers[layer].octave
      engine.updateSynthLayer(layer, { octave: Math.max(-2, Math.min(2, o + dir)) })
    }
    return
  }
  if (id === 'synth-sustped') {
    const on = hardwareStore.getValue(id) > 0.5
    for (const l of ['A', 'B', 'C'] as const) engine.updateSynthLayer(l, { sustped: on })
    return
  }

  // Piano type exclusive selection
  if (id in TYPE_BUTTONS) {
    const type = TYPE_BUTTONS[id]!
    engine.setPianoState({ type })
    for (const [btn, t] of Object.entries(TYPE_BUTTONS)) {
      hardwareStore.setValue(btn, t === type ? 1 : 0)
    }
    // refresh timbre scale for type family
    const timbreKnob = hardwareStore.getValue('piano-timbre')
    engine.setPianoState({ timbre: timbreFromKnob(type, timbreKnob) })
    return
  }

  if (id === 'piano-section-on') {
    const on = hardwareStore.getValue(id) > 0.5
    engine.setPianoState({ sectionOn: on })
    return
  }

  if (id === 'piano-layer-a') {
    // focus + enable toggle pattern: first press focuses; if already focus, toggle enable
    const piano = engine.getPianoState()
    if (piano.focus !== 'A') {
      engine.setPianoState({ focus: 'A' })
      hardwareStore.setValue('piano-layer-a', 1)
      hardwareStore.setValue('piano-layer-b', piano.layers.B.enabled ? 1 : 0)
      engine.setEffectsState({ layerFocus: 'PianoA', focusSection: 'Piano' })
      syncFxFocusButtons('PianoA')
    } else {
      const en = !(hardwareStore.getValue(id) > 0.5)
      // store already toggled by pressButton — read inverted
      const enabled = hardwareStore.getValue(id) > 0.5
      engine.updateLayer('A', { enabled })
      void en
    }
    return
  }

  if (id === 'piano-layer-b') {
    const piano = engine.getPianoState()
    if (piano.focus !== 'B') {
      engine.setPianoState({ focus: 'B' })
      hardwareStore.setValue('piano-layer-b', 1)
      engine.setEffectsState({ layerFocus: 'PianoB', focusSection: 'Piano' })
      syncFxFocusButtons('PianoB')
      // enable B if it was off so focus is useful
      if (!piano.layers.B.enabled) {
        engine.updateLayer('B', { enabled: true, level: Math.max(0.5, piano.layers.B.level) })
        hardwareStore.setValue('piano-level-b', Math.max(0.5, piano.layers.B.level))
        hardwareStore.setValue('piano-layer-b', 1)
      }
    } else {
      const enabled = hardwareStore.getValue(id) > 0.5
      engine.updateLayer('B', { enabled })
    }
    return
  }

  if (id === 'piano-oct-a-down') {
    const o = Math.max(-2, engine.getPianoState().layers.A.octave - 1)
    engine.updateLayer('A', { octave: o })
    return
  }
  if (id === 'piano-oct-a-up') {
    const o = Math.min(2, engine.getPianoState().layers.A.octave + 1)
    engine.updateLayer('A', { octave: o })
    return
  }
  if (id === 'piano-oct-b-down') {
    const o = Math.max(-2, engine.getPianoState().layers.B.octave - 1)
    engine.updateLayer('B', { octave: o })
    return
  }
  if (id === 'piano-oct-b-up') {
    const o = Math.min(2, engine.getPianoState().layers.B.octave + 1)
    engine.updateLayer('B', { octave: o })
    return
  }

  if (id === 'piano-unison') {
    unisonPresses++
    const levels: Unison[] = ['Off', 1, 2, 3]
    const u = levels[unisonPresses % 4]!
    engine.setPianoState({ unison: u })
    hardwareStore.setValue('piano-unison', u === 'Off' ? 0 : 1)
    return
  }

  if (id === 'piano-soft-release') {
    engine.setPianoState({ softRelease: hardwareStore.getValue(id) > 0.5 })
    return
  }
  if (id === 'piano-string-res') {
    engine.setPianoState({ stringRes: hardwareStore.getValue(id) > 0.5 })
    return
  }
  if (id === 'piano-sustped') {
    engine.updateLayer('A', { sustped: hardwareStore.getValue(id) > 0.5 })
    engine.updateLayer('B', { sustped: hardwareStore.getValue(id) > 0.5 })
    return
  }
  if (id === 'piano-pstick') {
    engine.updateLayer('A', { pstick: hardwareStore.getValue(id) > 0.5 })
    engine.updateLayer('B', { pstick: hardwareStore.getValue(id) > 0.5 })
    return
  }

  // Effects focus
  if (id === 'fx-focus-piano-a') {
    engine.setEffectsState({ layerFocus: 'PianoA', focusSection: 'Piano' })
    syncFxFocusButtons('PianoA')
    engine.setPianoState({ focus: 'A' })
    return
  }
  if (id === 'fx-focus-piano-b') {
    engine.setEffectsState({ layerFocus: 'PianoB', focusSection: 'Piano' })
    syncFxFocusButtons('PianoB')
    engine.setPianoState({ focus: 'B' })
    return
  }
  if (id === 'fx-focus-organ-a' || id === 'fx-focus-organ-b') {
    engine.setEffectsState({ focusSection: 'Organ', layerFocus: id.endsWith('-b') ? 'OrganB' : 'OrganA' })
    syncFxFocusButtons(id.endsWith('-b') ? 'OrganB' : 'OrganA')
    return
  }
  if (id.startsWith('fx-focus-synth')) {
    const map: Record<string, 'SynthA' | 'SynthB' | 'SynthC'> = {
      'fx-focus-synth-a': 'SynthA',
      'fx-focus-synth-b': 'SynthB',
      'fx-focus-synth-c': 'SynthC',
    }
    engine.setEffectsState({ focusSection: 'Synth', layerFocus: map[id] ?? 'SynthA' })
    syncFxFocusButtons(map[id] ?? 'SynthA')
    return
  }

  if (id === 'fx-group-1') {
    engine.setEffectsState({ pianoGroup: hardwareStore.getValue(id) > 0.5 })
    return
  }
  if (id === 'fx-group-2') {
    // group 2 = ungroup piano (independent chains)
    const on = hardwareStore.getValue(id) > 0.5
    engine.setEffectsState({ pianoGroup: !on })
    return
  }

  if (id === 'fx-bypass') {
    engine.setEffectsState({ allBypass: hardwareStore.getValue(id) > 0.5 })
    return
  }

  if (id === 'fx-global') {
    // toggle global on delay/comp/reverb for focused chain
    const on = hardwareStore.getValue(id) > 0.5
    editFocusedChain(engine, (c) => {
      c.delay.global = on
      c.compressor.global = on
      c.reverb.global = on
    })
    if (on) {
      const chain = engine.getEffectsState().chains[focusedChainKey(engine)]
      engine.setEffectsState({
        globalDelay: { ...chain.delay, global: true, on: chain.delay.on },
        globalCompressor: { ...chain.compressor, global: true, on: chain.compressor.on },
        globalReverb: { ...chain.reverb, global: true, on: chain.reverb.on },
      })
    }
    return
  }

  if (id === 'fx-mod1-on') {
    editFocusedChain(engine, (c) => {
      c.mod1.on = hardwareStore.getValue(id) > 0.5
    })
    return
  }
  if (id === 'fx-mod2-on') {
    editFocusedChain(engine, (c) => {
      c.mod2.on = hardwareStore.getValue(id) > 0.5
    })
    return
  }
  if (id === 'fx-delay-on') {
    editFocusedChain(engine, (c) => {
      c.delay.on = hardwareStore.getValue(id) > 0.5
    })
    return
  }
  if (id === 'fx-amp-on') {
    editFocusedChain(engine, (c) => {
      c.ampEq.on = hardwareStore.getValue(id) > 0.5
    })
    return
  }
  if (id === 'fx-comp-on') {
    editFocusedChain(engine, (c) => {
      c.compressor.on = hardwareStore.getValue(id) > 0.5
    })
    return
  }
  if (id === 'fx-reverb-on') {
    editFocusedChain(engine, (c) => {
      c.reverb.on = hardwareStore.getValue(id) > 0.5
    })
    return
  }

  if (id === 'fx-mod1-type') {
    mod1TypeIdx = (mod1TypeIdx + 1) % MOD1_TYPES.length
    const t = MOD1_TYPES[mod1TypeIdx]!
    editFocusedChain(engine, (c) => {
      c.mod1.type = t
    })
    return
  }
  if (id === 'fx-mod2-type') {
    mod2TypeIdx = (mod2TypeIdx + 1) % MOD2_TYPES.length
    const t = MOD2_TYPES[mod2TypeIdx]!
    editFocusedChain(engine, (c) => {
      c.mod2.type = t
    })
    return
  }
  if (id === 'fx-reverb-type') {
    reverbTypeIdx = (reverbTypeIdx + 1) % REVERB_TYPES.length
    const t = REVERB_TYPES[reverbTypeIdx]!
    editFocusedChain(engine, (c) => {
      c.reverb.type = t
    })
    return
  }
  if (id === 'fx-to-rotary') {
    const on = hardwareStore.getValue(id) > 0.5
    editFocusedChain(engine, (c) => {
      if (on) {
        c.ampEq.type = 'To Rotary'
        c.ampEq.on = true
      } else {
        c.ampEq.type = 'EQ only'
      }
    })
    engine.setEffectsState({
      rotary: { ...engine.getEffectsState().rotary, on },
    })
    hardwareStore.setValue('fx-amp-on', on ? 1 : hardwareStore.getValue('fx-amp-on'))
    return
  }

  void FUNCTIONAL_PREFIXES
  void cycleEnum
  void AMP_TYPES
  void DELAY_FILTERS
  void PIANO_TYPES
  void ORGAN_MODELS
  void LFO_WAVES
  void LFO_DESTS
  void SPLIT_POSITIONS
  void syncEngineToProgram
}

function syncFxFocusButtons(focus: string) {
  const ids = [
    'fx-focus-organ-a',
    'fx-focus-organ-b',
    'fx-focus-piano-a',
    'fx-focus-piano-b',
    'fx-focus-synth-a',
    'fx-focus-synth-b',
    'fx-focus-synth-c',
  ]
  const map: Record<string, string> = {
    OrganA: 'fx-focus-organ-a',
    OrganB: 'fx-focus-organ-b',
    PianoA: 'fx-focus-piano-a',
    PianoB: 'fx-focus-piano-b',
    SynthA: 'fx-focus-synth-a',
    SynthB: 'fx-focus-synth-b',
    SynthC: 'fx-focus-synth-c',
  }
  const active = map[focus]
  for (const id of ids) {
    hardwareStore.setValue(id, id === active ? 1 : 0)
  }
}

/** Subscribe store → engine for continuous values */
export function attachEngineBindings(engine: PianoEngine): () => void {
  // Initial sync from store defaults
  applyControlToEngine(engine, 'perf-master-level', hardwareStore.getValue('perf-master-level'))
  applyControlToEngine(engine, 'piano-level-a', hardwareStore.getValue('piano-level-a'))
  applyControlToEngine(engine, 'piano-level-b', hardwareStore.getValue('piano-level-b'))
  applyControlToEngine(engine, 'piano-kb-touch', hardwareStore.getValue('piano-kb-touch'))
  applyControlToEngine(engine, 'piano-dyn-comp', hardwareStore.getValue('piano-dyn-comp'))
  applyControlToEngine(engine, 'piano-timbre', hardwareStore.getValue('piano-timbre'))
  // Load factory program 0 into engine
  engine.applyProgramSound(programStore.getWorking())

  let last = { ...hardwareStore.getValues() }
  return hardwareStore.subscribe(() => {
    const vals = hardwareStore.getValues()
    for (const id of Object.keys(vals)) {
      if (vals[id] !== last[id]) {
        if (isFunctionalControl(id)) {
          const kind =
            id.includes('level') ||
            id.includes('rate') ||
            id.includes('amount') ||
            id.includes('time') ||
            id.includes('feedback') ||
            id.includes('mix') ||
            id.includes('drive') ||
            id.includes('bass') ||
            id.includes('mid') ||
            id.includes('treble') ||
            id.includes('kb-touch') ||
            id.includes('dyn-comp') ||
            id.includes('timbre') ||
            id.includes('model') ||
            id.includes('drawbar') ||
            id.includes('filter') ||
            id.includes('env') ||
            id.includes('lfo') ||
            id.includes('arp') ||
            id.includes('osc') ||
            id.includes('key-click') ||
            id === 'perf-master-level' ||
            id === 'perf-mod-wheel'
          if (kind) applyControlToEngine(engine, id, vals[id]!)
        }
      }
    }
    last = { ...vals }
  })
}

export function handleButtonPress(engine: PianoEngine, id: string): void {
  // hardwareStore.pressButton already toggled presentation; sync engine
  applyButtonToEngine(engine, id)
}

export type { LayerId, PianoType, Mod1Type, Mod2Type, AmpType, ReverbType, DelayFilter }
