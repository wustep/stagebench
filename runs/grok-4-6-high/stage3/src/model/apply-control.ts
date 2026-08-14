import { PIANO_TYPES, type PianoType } from '../audio/samples'
import { recordMorph, clearMorphSource } from './morph'
import {
  beginStore,
  cancelStore,
  deleteNameChar,
  editNameChar,
  insertNameChar,
  markDirty,
  selectLive,
  selectProgram,
  switchScene,
  tapClock,
  toggleLiveMode,
  undoProgram,
} from './programs'
import { cycleSplitMidi, setLayerZone, toggleSplit } from './splits'
import {
  AMP_TYPES,
  AMP_VEL_LEVELS,
  ARP_DIRS,
  ARP_MODES,
  DELAY_FILTERS,
  DRAWBAR_IDS,
  DYN_COMP,
  FILTER_DRIVE,
  FILTER_TRACK,
  FILTER_TYPES,
  KB_TOUCH,
  LFO_DESTS,
  LFO_WAVES,
  MOD1_TYPES,
  MOD2_TYPES,
  NOTE_PRIORITY,
  ORGAN_MODELS,
  REVERB_TYPES,
  SYNTH_WAVES,
  TIMBRE_ACOUSTIC,
  TIMBRE_ELECTRIC,
  UNISON,
  UNSUPPORTED_CONTROL_IDS,
  VIBRATO_MODES,
  VIBRATO_POSITIONS,
  VOICE_MODES,
  XFADE_WIDTHS,
  copyFx,
  cycleIndex,
  discrete,
  focusedLayer,
  focusedOrganLayer,
  focusedSynthLayer,
  type InstrumentState,
  type LayerFx,
  type LayerId,
  type OrganLayerId,
  type SynthLayerId,
  type ZoneRange,
} from './instrument-state'

const TYPE_IDS: Record<string, PianoType> = {
  'piano-type-grand': 'grand',
  'piano-type-upright': 'upright',
  'piano-type-electric': 'electric',
  'piano-type-clav': 'clav',
  'piano-type-digital': 'digital',
  'piano-type-misc': 'misc',
}

const ORGAN_MODEL_IDS: Record<string, (typeof ORGAN_MODELS)[number]> = {
  'organ-model-b3': 'B3',
  'organ-model-vox': 'Vox',
  'organ-model-farfisa': 'Farf',
  'organ-model-pipe1': 'Pipe 1',
  'organ-model-pipe2': 'Pipe 2',
}

const UNSUPPORTED = new Set<string>(UNSUPPORTED_CONTROL_IDS)

export function applyHardwareControl(
  state: InstrumentState,
  id: string,
  value: number,
  hardware?: Record<string, number>,
): InstrumentState {
  const next: InstrumentState = structuredCloneState(state)
  const shift = (hardware?.['program-shift'] ?? 0) >= 1

  if (UNSUPPORTED.has(id)) return next

  if (next.morphLatch !== 'off') recordMorph(next, id, value)

  if (id === 'perf-master-level') {
    next.masterLevel = value
    return next
  }
  if (id === 'perf-pitch-stick') next.pitchStick = value
  if (id === 'perf-mod-wheel') next.modWheel = value
  if (id === 'perf-ctrl-pedal') next.ctrlPedal = value

  applyProgram(next, id, value, hardware, shift)
  applyOrgan(next, id, value, shift)
  applyPiano(next, id, value)
  applySynth(next, id, value)
  applyFx(next, id, value, hardware)
  applyZones(next, id, value, shift)

  if (id !== 'perf-mod-wheel' && id !== 'perf-ctrl-pedal' && id !== 'perf-pitch-stick' && id !== 'perf-master-level') {
    if (!id.startsWith('program-') || id === 'program-split' || id.startsWith('program-split') || id === 'program-layer-scene' || id === 'program-clk-sync') {
      markDirty(next)
    }
  }
  if (id === 'program-1' || id === 'program-2' || id.startsWith('program-page') || id === 'program-dial' || id === 'program-live-mode') {
    /* navigation may clear dirty inside select helpers */
  }

  return next
}

function structuredCloneState(state: InstrumentState): InstrumentState {
  return JSON.parse(JSON.stringify(state)) as InstrumentState
}

function applyProgram(
  next: InstrumentState,
  id: string,
  value: number,
  hardware: Record<string, number> | undefined,
  shift: boolean,
): void {
  if (id === 'program-shift' && value < 1 && next.listView) next.listView = false
  if (id === 'program-dial') {
    const prev = next.programDial
    next.programDial = value
    const dir = value > prev + 0.0001 ? 1 : value < prev - 0.0001 ? -1 : 0
    if (dir === 0) return
    if (next.storeMode === 'name') {
      editNameChar(next, dir)
      return
    }
    if (next.clockHold) {
      next.clockBpm = Math.min(300, Math.max(30, next.clockBpm + dir * 2))
      markDirty(next)
      return
    }
    if (next.splitEdit !== 'off') {
      const pt = next.split[next.splitEdit]
      pt.midi = cycleSplitMidi(pt.midi, dir)
      markDirty(next)
      return
    }
    if (shift) {
      next.listView = true
      next.listOffset = (next.listOffset + dir + 32) % 32
      return
    }
    if (next.liveMode) selectLive(next, next.liveIndex + dir)
    else selectProgram(next, next.programIndex + dir)
    return
  }
  if (id === 'program-page-up' && value >= 1) {
    if (next.storeMode === 'name') {
      insertNameChar(next)
      return
    }
    if (next.listView) {
      next.listOffset = (next.listOffset + 8) % 32
      return
    }
    if (next.liveMode) return
    const page = (next.page + 1) % 4
    selectProgram(next, page * 8 + (next.programIndex % 8))
  }
  if (id === 'program-page-down' && value >= 1) {
    if (next.storeMode === 'name') {
      deleteNameChar(next)
      return
    }
    if (next.listView) {
      next.listOffset = (next.listOffset + 24) % 32
      return
    }
    if (next.liveMode) return
    const page = (next.page + 3) % 4
    selectProgram(next, page * 8 + (next.programIndex % 8))
  }
  if (id.startsWith('program-') && id.length === 9 && id[8] >= '1' && id[8] <= '8' && value >= 1) {
    const btn = Number(id[8]) - 1
    if (next.liveMode) selectLive(next, btn)
    else selectProgram(next, next.page * 8 + btn)
  }
  if (id === 'program-live-mode') toggleLiveMode(next, value >= 1)
  if (id === 'program-layer-scene' && value >= 1) switchScene(next, next.scene === 'I' ? 'II' : 'I')
  if (id === 'program-store' && value >= 1) beginStore(next, shift)
  if (id === 'program-store-as' && value >= 1) beginStore(next, true)
  if (id === 'program-exit' && value >= 1) {
    if (shift) undoProgram(next)
    else cancelStore(next)
  }
  if (id === 'program-split' && value >= 1) {
    if (shift) {
      next.splitEdit = next.splitEdit === 'off' ? 'mid' : next.splitEdit === 'mid' ? 'low' : next.splitEdit === 'low' ? 'high' : 'off'
      if (next.splitEdit !== 'off') next.split.on = true
    } else toggleSplit(next)
    markDirty(next)
  }
  if (id === 'program-split-low') {
    next.split.low.enabled = value >= 1
    if (value >= 1) next.split.on = true
    markDirty(next)
  }
  if (id === 'program-split-mid') {
    next.split.mid.enabled = value >= 1
    if (value >= 1) next.split.on = true
    markDirty(next)
  }
  if (id === 'program-split-high') {
    next.split.high.enabled = value >= 1
    if (value >= 1) next.split.on = true
    markDirty(next)
  }
  if (id === 'program-split-xfade') {
    const w = discrete(value, XFADE_WIDTHS)
    const target = next.splitEdit === 'off' ? 'mid' : next.splitEdit
    next.split[target].xfade = w
    markDirty(next)
  }
  if (id === 'program-morph-wheel') {
    if (shift && value >= 1) clearMorphSource(next, 'wheel')
    next.morphLatch = value >= 1 && !shift ? 'wheel' : next.morphLatch === 'wheel' ? 'off' : next.morphLatch
  }
  if (id === 'program-morph-pedal') {
    if (shift && value >= 1) clearMorphSource(next, 'pedal')
    next.morphLatch = value >= 1 && !shift ? 'pedal' : next.morphLatch === 'pedal' ? 'off' : next.morphLatch
  }
  if (id === 'program-mst-clk') {
    next.clockHold = value >= 1
    if (value >= 1) tapClock(next, hardware?.__now ?? Date.now() / 1000)
  }
  if (id === 'program-clk-sync') {
    next.clockSync = value >= 1
    markDirty(next)
  }
  if (id === 'program-transpose-up' && value >= 1) {
    if (shift) {
      next.panicFlag = true
    } else {
      next.transpose = Math.min(6, next.transpose + 1)
      markDirty(next)
    }
  }
  if (id === 'program-transpose-down' && value >= 1) {
    next.transpose = Math.max(-6, next.transpose - 1)
    markDirty(next)
  }
  if (id === 'program-panic' && value >= 1) next.panicFlag = true
}

function applyOrgan(next: InstrumentState, id: string, value: number, shift: boolean): void {
  if (id === 'organ-on') next.organOn = value >= 1
  if (id === 'organ-layer-a-enable') next.organ.A.enable = value >= 1
  if (id === 'organ-layer-b-enable') next.organ.B.enable = value >= 1
  if (id === 'organ-layer-a-level') next.organ.A.level = value
  if (id === 'organ-layer-b-level') next.organ.B.level = value
  if (id === 'organ-layer-a-focus' && value >= 1) {
    next.organ.A.focus = true
    next.organ.B.focus = false
    next.fxSectionFocus = 'organ'
  }
  if (id === 'organ-layer-b-focus' && value >= 1) {
    next.organ.B.focus = true
    next.organ.A.focus = false
    next.fxSectionFocus = 'organ'
  }
  if (id === 'organ-layer-a-focus' && value < 1) next.organ.A.focus = false
  if (id === 'organ-layer-b-focus' && value < 1) next.organ.B.focus = false
  const ofocus = focusedOrganLayer(next)
  if (id === 'organ-oct-up') next.organ[ofocus].octave = Math.min(12, next.organ[ofocus].octave + 12)
  if (id === 'organ-oct-down') next.organ[ofocus].octave = Math.max(-12, next.organ[ofocus].octave - 12)
  const db = DRAWBAR_IDS.indexOf(id as (typeof DRAWBAR_IDS)[number])
  if (db >= 0) next.organ[ofocus].drawbars[db] = Math.round(value)
  const model = ORGAN_MODEL_IDS[id]
  if (model && value >= 1) next.organ[ofocus].model = model
  if (id === 'organ-vibrato-on') next.organ[ofocus].vibratoOn = value >= 1
  if (id === 'organ-vibrato-type') next.organ[ofocus].vibratoType = discrete(value, VIBRATO_POSITIONS)
  if (id === 'organ-perc-on') next.organ[ofocus].percOn = value >= 1
  if (id === 'organ-perc-volume') next.organ[ofocus].percSoft = value >= 1
  if (id === 'organ-perc-decay') next.organ[ofocus].percFast = value >= 1
  if (id === 'organ-perc-harmonic') next.organ[ofocus].percThird = value >= 1
  if (id === 'organ-rotary-stop') next.rotaryStop = value >= 1
  if (id === 'organ-rotary-fast') next.rotaryFast = value >= 1
  if (id === 'organ-rotary-drive') next.rotaryDrive = value
  if (id === 'organ-sustped') next.organ[ofocus].sustped = value >= 1
  if (id === 'organ-pstick') next.organ[ofocus].pstick = value >= 1
  void shift
}

function applyPiano(next: InstrumentState, id: string, value: number): void {
  if (id === 'piano-on') next.pianoOn = value >= 1
  if (id === 'piano-layer-a-enable') next.layers.A.enable = value >= 1
  if (id === 'piano-layer-b-enable') next.layers.B.enable = value >= 1
  if (id === 'piano-layer-a-level') next.layers.A.level = value
  if (id === 'piano-layer-b-level') next.layers.B.level = value
  if (id === 'piano-layer-a-focus' && value >= 1) {
    next.layers.A.focus = true
    next.layers.B.focus = false
    next.fxSectionFocus = 'piano'
  }
  if (id === 'piano-layer-b-focus' && value >= 1) {
    next.layers.B.focus = true
    next.layers.A.focus = false
    next.fxSectionFocus = 'piano'
  }
  if (id === 'piano-layer-a-focus' && value < 1) next.layers.A.focus = false
  if (id === 'piano-layer-b-focus' && value < 1) next.layers.B.focus = false
  const focus = focusedLayer(next)
  if (id === 'piano-oct-up') bumpOctave(next, focus, 12)
  if (id === 'piano-oct-down') bumpOctave(next, focus, -12)
  const mappedType = TYPE_IDS[id]
  if (mappedType && value >= 1) next.layers[focus].type = mappedType
  if (id === 'piano-type') {
    const i = PIANO_TYPES.indexOf(next.layers[focus].type)
    next.layers[focus].type = PIANO_TYPES[(i + 1) % PIANO_TYPES.length]
  }
  if (id === 'piano-model') next.layers[focus].model = cycleIndex(value * 8, 4)
  if (id === 'piano-kb-touch') next.layers[focus].kbTouch = discrete(value, KB_TOUCH)
  if (id === 'piano-dyn-comp') next.layers[focus].dynComp = discrete(value, DYN_COMP)
  if (id === 'piano-timbre') {
    const type = next.layers[focus].type
    const table = type === 'electric' || type === 'clav' ? TIMBRE_ELECTRIC : TIMBRE_ACOUSTIC
    next.layers[focus].timbre = discrete(value, table)
  }
  if (id === 'piano-unison') next.layers[focus].unison = discrete(value, UNISON)
  if (id === 'piano-soft-release') next.layers[focus].softRelease = value >= 1
  if (id === 'piano-string-res') next.layers[focus].stringRes = value >= 1
  if (id === 'piano-sustped') next.layers[focus].sustped = value >= 1
  if (id === 'piano-pstick') next.layers[focus].pstick = value >= 1
}

function applySynth(next: InstrumentState, id: string, value: number): void {
  if (id === 'synth-on') next.synthOn = value >= 1
  if (id === 'synth-layer-a-enable') next.synth.A.enable = value >= 1
  if (id === 'synth-layer-b-enable') next.synth.B.enable = value >= 1
  if (id === 'synth-layer-c-enable') next.synth.C.enable = value >= 1
  if (id === 'synth-layer-a-level') next.synth.A.level = value
  if (id === 'synth-layer-b-level') next.synth.B.level = value
  if (id === 'synth-layer-c-level') next.synth.C.level = value
  if (id === 'synth-layer-a-focus' && value >= 1) {
    next.synth.A.focus = true
    next.synth.B.focus = false
    next.synth.C.focus = false
    next.fxSectionFocus = 'synth'
  }
  if (id === 'synth-layer-b-focus' && value >= 1) {
    next.synth.B.focus = true
    next.synth.A.focus = false
    next.synth.C.focus = false
    next.fxSectionFocus = 'synth'
  }
  if (id === 'synth-layer-c-focus' && value >= 1) {
    next.synth.C.focus = true
    next.synth.A.focus = false
    next.synth.B.focus = false
    next.fxSectionFocus = 'synth'
  }
  if (id === 'synth-layer-a-focus' && value < 1) next.synth.A.focus = false
  if (id === 'synth-layer-b-focus' && value < 1) next.synth.B.focus = false
  if (id === 'synth-layer-c-focus' && value < 1) next.synth.C.focus = false
  const layer = next.synth[focusedSynthLayer(next)]
  if (id === 'synth-oct-up') layer.octave = Math.min(12, layer.octave + 12)
  if (id === 'synth-oct-down') layer.octave = Math.max(-12, layer.octave - 12)
  if (id === 'synth-osc-wave') layer.wave = discrete(value, SYNTH_WAVES)
  if (id === 'synth-osc-shape') layer.oscCtrl = value
  if (id === 'synth-osc-detune') layer.fine = (value - 0.5) * 100
  if (id === 'synth-osc-semi') layer.coarse = Math.round((value - 0.5) * 48)
  if (id === 'synth-filter-type' && value >= 0) {
    layer.filterType = FILTER_TYPES[cycleIndex(FILTER_TYPES.indexOf(layer.filterType) + 1, FILTER_TYPES.length)]
  }
  if (id === 'synth-filter-freq') layer.filterFreq = value
  if (id === 'synth-filter-res') layer.filterRes = value
  if (id === 'synth-filter-drive') layer.filterDrive = discrete(value, FILTER_DRIVE)
  if (id === 'synth-filter-kb') layer.filterTrack = discrete(value, FILTER_TRACK)
  if (id === 'synth-env-attack') layer.ampEnvA = value
  if (id === 'synth-env-decay') layer.ampEnvD = value
  if (id === 'synth-env-sustain') layer.ampEnvS = value
  if (id === 'synth-env-release') layer.ampEnvR = value
  if (id === 'synth-mod-attack') layer.filtEnvA = value
  if (id === 'synth-mod-decay') layer.filtEnvD = value
  if (id === 'synth-mod-amount') layer.filterEnvAmt = value
  if (id === 'synth-filter-env-amt') layer.filterEnvAmt = value
  if (id === 'synth-osc-env-amt') layer.oscEnvAmt = (value - 0.5) * 2
  if (id === 'synth-lfo-rate') layer.lfoRate = value
  if (id === 'synth-lfo-amount') layer.lfoAmt = value
  if (id === 'synth-lfo-wave' && value >= 0) {
    layer.lfoWave = LFO_WAVES[cycleIndex(LFO_WAVES.indexOf(layer.lfoWave) + 1, LFO_WAVES.length)]
  }
  if (id === 'synth-lfo-dest' && value >= 1) {
    layer.lfoDest = LFO_DESTS[cycleIndex(LFO_DESTS.indexOf(layer.lfoDest) + 1, LFO_DESTS.length)]
  }
  if (id === 'synth-lfo-sync') layer.lfoSync = value >= 1
  if (id === 'synth-arp-on') layer.arpOn = value >= 1
  if (id === 'synth-arp-run') layer.arpRun = value >= 1
  if (id === 'synth-arp-hold') layer.arpHold = value >= 1
  if (id === 'synth-arp-rate') layer.arpRate = value
  if (id === 'synth-arp-range') layer.arpRange = 1 + Math.round(value * 3)
  if (id === 'synth-arp-dir' && value >= 1) {
    layer.arpDir = ARP_DIRS[cycleIndex(ARP_DIRS.indexOf(layer.arpDir) + 1, ARP_DIRS.length)]
  }
  if (id === 'synth-arp-mode' && value >= 1) {
    layer.arpMode = ARP_MODES[cycleIndex(ARP_MODES.indexOf(layer.arpMode) + 1, ARP_MODES.length)]
  }
  if (id === 'synth-glide') layer.glide = value
  if (id === 'synth-unison') layer.unison = discrete(value, UNISON)
  if (id === 'synth-vibrato') layer.vibrato = discrete(value, VIBRATO_MODES)
  if (id === 'synth-voice-mode' && value >= 1) {
    layer.voiceMode = VOICE_MODES[cycleIndex(VOICE_MODES.indexOf(layer.voiceMode) + 1, VOICE_MODES.length)]
  }
  if (id === 'synth-priority' && value >= 1) {
    layer.priority = NOTE_PRIORITY[cycleIndex(NOTE_PRIORITY.indexOf(layer.priority) + 1, NOTE_PRIORITY.length)]
  }
  if (id === 'synth-sustped') layer.sustped = value >= 1
  if (id === 'synth-pstick') layer.pstick = value >= 1
  void AMP_VEL_LEVELS
}

function applyFx(next: InstrumentState, id: string, value: number, hardware?: Record<string, number>): void {
  if (id === 'fx-on') next.fxSectionOn = value >= 1
  if (id === 'fx-group') next.pianoGroup = value >= 1
  if (id === 'delay-global') next.delayGlobal = value >= 1
  if (id === 'comp-global') next.compGlobal = value >= 1
  if (id === 'reverb-global') next.reverbGlobal = value >= 1
  if (hardware && hardware['program-shift'] >= 1) {
    if (id === 'delay-on') next.delayGlobal = !next.delayGlobal
    if (id === 'comp-on') next.compGlobal = !next.compGlobal
    if (id === 'reverb-on') next.reverbGlobal = !next.reverbGlobal
  }
  if (id === 'rotary-on') next.rotaryOn = value >= 1
  if (id === 'rotary-speed') next.rotarySpeed = value
  if (id === 'rotary-drive-fx') next.rotaryDrive = value
  if (id === 'rotary-organ') next.rotaryOrgan = value >= 1
  if (id === 'fx-focus-a') next.fxSectionFocus = value >= 1 ? 'organ' : next.fxSectionFocus
  if (id === 'fx-focus-b') next.fxSectionFocus = value >= 1 ? 'piano' : next.fxSectionFocus
  if (id === 'fx-focus-c') next.fxSectionFocus = value >= 1 ? 'synth' : next.fxSectionFocus

  const fx = targetFx(next)
  patchFx(fx, id, value)
  if (next.fxSectionFocus === 'piano' && next.pianoGroup) next.layers.B.fx = copyFx(next.layers.A.fx)
  if (next.delayGlobal && next.fxSectionFocus === 'piano') {
    next.layers.B.fx.delayOn = next.layers.A.fx.delayOn
    next.layers.B.fx.delayTempo = next.layers.A.fx.delayTempo
    next.layers.B.fx.delayFeedback = next.layers.A.fx.delayFeedback
    next.layers.B.fx.delayMix = next.layers.A.fx.delayMix
    next.layers.B.fx.delayFilter = next.layers.A.fx.delayFilter
  }
  if (next.compGlobal && next.fxSectionFocus === 'piano') {
    next.layers.B.fx.compOn = next.layers.A.fx.compOn
    next.layers.B.fx.compAmount = next.layers.A.fx.compAmount
    next.layers.B.fx.compFast = next.layers.A.fx.compFast
  }
  if (next.reverbGlobal && next.fxSectionFocus === 'piano') {
    next.layers.B.fx.reverbOn = next.layers.A.fx.reverbOn
    next.layers.B.fx.reverbType = next.layers.A.fx.reverbType
    next.layers.B.fx.reverbMix = next.layers.A.fx.reverbMix
    next.layers.B.fx.reverbBright = next.layers.A.fx.reverbBright
  }
}

function targetFx(state: InstrumentState): LayerFx {
  if (state.fxSectionFocus === 'organ') return state.organFx
  if (state.fxSectionFocus === 'synth') return state.synth[focusedSynthLayer(state)].fx
  const edit = state.pianoGroup ? 'A' : focusedLayer(state)
  return state.layers[edit].fx
}

function applyZones(next: InstrumentState, id: string, value: number, shift: boolean): void {
  const match = /^(organ|piano|synth)-zone-([1-4])$/.exec(id)
  if (!match || value < 1) return
  const z = Number(match[2]) - 1
  let zone: ZoneRange
  if (match[1] === 'organ') zone = next.organ[focusedOrganLayer(next)].zone
  else if (match[1] === 'synth') zone = next.synth[focusedSynthLayer(next)].zone
  else zone = next.layers[focusedLayer(next)].zone
  setLayerZone(zone, z, shift)
}

function bumpOctave(state: InstrumentState, layer: LayerId, delta: number): void {
  state.layers[layer].octave = Math.min(12, Math.max(-12, state.layers[layer].octave + delta))
}

function patchFx(fx: LayerFx, id: string, value: number): void {
  if (id === 'fx1-on') fx.mod1On = value >= 1
  if (id === 'fx1-type' && value >= 0) fx.mod1Type = MOD1_TYPES[cycleIndex(MOD1_TYPES.indexOf(fx.mod1Type) + 1, MOD1_TYPES.length)]
  if (id === 'fx1-rate') fx.mod1Rate = value
  if (id === 'fx1-amount') fx.mod1Amount = value
  if (id === 'fx2-on') fx.mod2On = value >= 1
  if (id === 'fx2-type') fx.mod2Type = MOD2_TYPES[cycleIndex(MOD2_TYPES.indexOf(fx.mod2Type) + 1, MOD2_TYPES.length)]
  if (id === 'fx2-rate') fx.mod2Rate = value
  if (id === 'fx2-amount') fx.mod2Amount = value
  if (id === 'delay-on') fx.delayOn = value >= 1
  if (id === 'delay-tempo') fx.delayTempo = value
  if (id === 'delay-feedback') fx.delayFeedback = value
  if (id === 'delay-mix') fx.delayMix = value
  if (id === 'delay-filter') fx.delayFilter = DELAY_FILTERS[cycleIndex(DELAY_FILTERS.indexOf(fx.delayFilter) + 1, DELAY_FILTERS.length)]
  if (id === 'amp-on') fx.ampOn = value >= 1
  if (id === 'amp-type') fx.ampType = AMP_TYPES[cycleIndex(AMP_TYPES.indexOf(fx.ampType) + 1, AMP_TYPES.length)]
  if (id === 'amp-drive') fx.ampDrive = value
  if (id === 'amp-bass') fx.ampBass = value
  if (id === 'amp-mid') fx.ampMid = value
  if (id === 'amp-mid-freq') fx.ampMidFreq = value
  if (id === 'amp-treble') fx.ampTreble = value
  if (id === 'comp-on') fx.compOn = value >= 1
  if (id === 'comp-amount') fx.compAmount = value
  if (id === 'comp-fast') fx.compFast = value >= 1
  if (id === 'reverb-on') fx.reverbOn = value >= 1
  if (id === 'reverb-type') fx.reverbType = REVERB_TYPES[cycleIndex(REVERB_TYPES.indexOf(fx.reverbType) + 1, REVERB_TYPES.length)]
  if (id === 'reverb-mix') fx.reverbMix = value
  if (id === 'reverb-bright') fx.reverbBright = value >= 1
}

export function typeLedValues(type: PianoType): Record<string, number> {
  return {
    'piano-type-grand': type === 'grand' ? 1 : 0,
    'piano-type-upright': type === 'upright' ? 1 : 0,
    'piano-type-electric': type === 'electric' ? 1 : 0,
    'piano-type-clav': type === 'clav' ? 1 : 0,
    'piano-type-digital': type === 'digital' ? 1 : 0,
    'piano-type-misc': type === 'misc' ? 1 : 0,
  }
}

export function organModelLeds(model: (typeof ORGAN_MODELS)[number]): Record<string, number> {
  return {
    'organ-model-b3': model === 'B3' ? 1 : 0,
    'organ-model-vox': model === 'Vox' ? 1 : 0,
    'organ-model-farfisa': model === 'Farf' ? 1 : 0,
    'organ-model-pipe1': model === 'Pipe 1' ? 1 : 0,
    'organ-model-pipe2': model === 'Pipe 2' ? 1 : 0,
  }
}

export function programPadLeds(state: InstrumentState): Record<string, number> {
  const idx = state.liveMode ? state.liveIndex : state.programIndex % 8
  const leds: Record<string, number> = {}
  for (let i = 1; i <= 8; i++) leds[`program-${i}`] = i - 1 === idx ? 1 : 0
  return leds
}

export function zoneLeds(prefix: string, zone: ZoneRange): Record<string, number> {
  const leds: Record<string, number> = {}
  for (let i = 1; i <= 4; i++) leds[`${prefix}-zone-${i}`] = i - 1 >= zone.lo && i - 1 <= zone.hi ? 1 : 0
  return leds
}

export type { OrganLayerId, SynthLayerId }
