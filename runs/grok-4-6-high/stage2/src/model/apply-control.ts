import { PIANO_TYPES, type PianoType } from '../audio/samples'
import {
  AMP_TYPES,
  DELAY_FILTERS,
  DYN_COMP,
  KB_TOUCH,
  MOD1_TYPES,
  MOD2_TYPES,
  REVERB_TYPES,
  TIMBRE_ACOUSTIC,
  TIMBRE_ELECTRIC,
  UNISON,
  copyFx,
  cycleIndex,
  discrete,
  focusedLayer,
  type InstrumentState,
  type LayerId,
  type LayerFx,
} from './instrument-state'

const TYPE_IDS: Record<string, PianoType> = {
  'piano-type-grand': 'grand',
  'piano-type-upright': 'upright',
  'piano-type-electric': 'electric',
  'piano-type-clav': 'clav',
  'piano-type-digital': 'digital',
  'piano-type-misc': 'misc',
}

export function applyHardwareControl(
  state: InstrumentState,
  id: string,
  value: number,
  hardware?: Record<string, number>,
): InstrumentState {
  const next: InstrumentState = {
    ...state,
    layers: {
      A: { ...state.layers.A, fx: copyFx(state.layers.A.fx) },
      B: { ...state.layers.B, fx: copyFx(state.layers.B.fx) },
    },
  }
  const focus = focusedLayer(next)

  if (id === 'perf-master-level') next.masterLevel = value
  if (id === 'perf-pitch-stick') next.pitchStick = value
  if (id === 'piano-on') next.pianoOn = value >= 1
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
  if (id === 'fx-focus-a') next.fxSectionFocus = value >= 1 ? 'organ' : next.fxSectionFocus
  if (id === 'fx-focus-b') next.fxSectionFocus = value >= 1 ? 'piano' : next.fxSectionFocus
  if (id === 'fx-focus-c') next.fxSectionFocus = value >= 1 ? 'synth' : next.fxSectionFocus

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

  const edit = next.pianoGroup ? 'A' : focus
  patchFx(next.layers[edit].fx, id, value)
  if (next.pianoGroup) next.layers.B.fx = copyFx(next.layers.A.fx)
  if (next.delayGlobal) {
    next.layers.B.fx.delayOn = next.layers.A.fx.delayOn
    next.layers.B.fx.delayTempo = next.layers.A.fx.delayTempo
    next.layers.B.fx.delayFeedback = next.layers.A.fx.delayFeedback
    next.layers.B.fx.delayMix = next.layers.A.fx.delayMix
    next.layers.B.fx.delayFilter = next.layers.A.fx.delayFilter
  }
  if (next.compGlobal) {
    next.layers.B.fx.compOn = next.layers.A.fx.compOn
    next.layers.B.fx.compAmount = next.layers.A.fx.compAmount
    next.layers.B.fx.compFast = next.layers.A.fx.compFast
  }
  if (next.reverbGlobal) {
    next.layers.B.fx.reverbOn = next.layers.A.fx.reverbOn
    next.layers.B.fx.reverbType = next.layers.A.fx.reverbType
    next.layers.B.fx.reverbMix = next.layers.A.fx.reverbMix
    next.layers.B.fx.reverbBright = next.layers.A.fx.reverbBright
  }

  return next
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
