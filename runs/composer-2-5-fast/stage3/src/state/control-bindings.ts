import type { ControlValue } from '../model/hardware'
import {
  PIANO_TYPES,
  type InstrumentAudioState,
  type KbTouch,
  type DynCompLevel,
  type UnisonLevel,
  type OrganModel,
  type SynthWaveCategory,
  type SynthFilterType,
  type SynthVoiceMode,
} from '../audio/types'
import { isUnsupportedControl } from './unsupported-controls'

const KB_TOUCH: KbTouch[] = ['Heavy', 'Medium', 'Light']
const DYN_COMP: DynCompLevel[] = ['Off', '1', '2', '3']
const UNISON: UnisonLevel[] = ['Off', '1', '2', '3']
const ORGAN_MODELS: OrganModel[] = ['B3', 'Vox', 'Farf', 'Pipe']
const SYNTH_CATEGORIES: SynthWaveCategory[] = ['Pure', 'Sync', 'Multi', 'Super', 'FM-H']
const FILTER_TYPES: SynthFilterType[] = ['LP12', 'LP24', 'HP', 'BP']

export function presentationToAudioState(
  presentation: Record<string, ControlValue>,
  prev: InstrumentAudioState,
): InstrumentAudioState {
  const next = structuredClone(prev)

  next.masterLevel = num(presentation['perf-master-level'], next.masterLevel)
  next.performance.modWheel = num(presentation['perf-mod-wheel'], next.performance.modWheel)
  next.performance.controlPedal = num(presentation['perf-control-pedal'], next.performance.controlPedal)
  next.performance.pitchStick = num(presentation['perf-pitch-stick'], next.performance.pitchStick)

  next.pianoA.enabled = bool(presentation['piano-layer-a-enable'], next.pianoA.enabled)
  next.pianoB.enabled = bool(presentation['piano-layer-b-enable'], next.pianoB.enabled)
  next.pianoA.level = num(presentation['piano-layer-a-level'], next.pianoA.level)
  next.pianoB.level = num(presentation['piano-layer-b-level'], next.pianoB.level)
  next.pianoA.octave = octaveFromKnob(num(presentation['piano-layer-a-octave'], 64))
  next.pianoB.octave = octaveFromKnob(num(presentation['piano-layer-b-octave'], 64))
  next.pianoA.focused = bool(presentation['fx-layer-a-focus'], next.pianoA.focused ?? true)
  next.pianoB.focused = bool(presentation['fx-layer-b-focus'], next.pianoB.focused ?? false)
  next.pianoA.sustPed = bool(presentation['piano-sustped'], next.pianoA.sustPed)
  next.pianoB.sustPed = bool(presentation['piano-sustped'], next.pianoB.sustPed)

  const typeIndex = PIANO_TYPES.findIndex((_, i) => bool(presentation[`piano-type-led-${i}`], i === next.pianoA.typeIndex))
  if (typeIndex >= 0) {
    next.pianoA.typeIndex = typeIndex
    next.pianoB.typeIndex = typeIndex
  }
  next.pianoA.modelDial = num(presentation['piano-model-dial'], next.pianoA.modelDial)
  next.pianoPerf.sectionOn = bool(presentation['piano-section-on'], next.pianoPerf.sectionOn)
  next.pianoPerf.softRelease = bool(presentation['piano-soft-release'], next.pianoPerf.softRelease)
  next.pianoPerf.stringRes = bool(presentation['piano-string-res'], next.pianoPerf.stringRes)

  if (presentation['piano-kb-touch-cycle'] != null) {
    next.pianoPerf.kbTouch = KB_TOUCH[num(presentation['piano-kb-touch-cycle'], 1) % 3]!
  }
  if (presentation['piano-dyn-comp-cycle'] != null) {
    next.pianoPerf.dynComp = DYN_COMP[num(presentation['piano-dyn-comp-cycle'], 0) % 4]!
  }
  if (presentation['piano-timbre-cycle'] != null) {
    next.pianoPerf.timbreIndex = num(presentation['piano-timbre-cycle'], 0)
  }
  if (presentation['piano-unison-cycle'] != null) {
    next.pianoPerf.unison = UNISON[num(presentation['piano-unison-cycle'], 0) % 4]!
  }

  const organModel = ORGAN_MODELS.find((m) => bool(presentation[`organ-model-${m.toLowerCase()}`], false))
  if (organModel) {
    next.organ.layerA.model = organModel
  }
  next.organ.sectionOn = true
  next.organ.layerA.enabled = bool(presentation['organ-layer-a-enable'], next.organ.layerA.enabled)
  next.organ.layerB.enabled = bool(presentation['organ-layer-b-enable'], next.organ.layerB.enabled)
  next.organ.layerA.level = num(presentation['organ-layer-a-level'], next.organ.layerA.level)
  next.organ.layerB.level = num(presentation['organ-layer-b-level'], next.organ.layerB.level)
  next.organ.layerA.octave = octaveFromKnob(num(presentation['organ-layer-a-octave'], 64))
  next.organ.layerB.octave = octaveFromKnob(num(presentation['organ-layer-b-octave'], 64))
  next.organ.percussion.on = bool(presentation['organ-perc-on'], next.organ.percussion.on)
  next.organ.percussion.soft = bool(presentation['organ-perc-soft'], next.organ.percussion.soft)
  next.organ.percussion.fast = bool(presentation['organ-perc-fast'], next.organ.percussion.fast)
  next.organ.keyClick = num(presentation['organ-key-click'], next.organ.keyClick)
  next.organ.rotaryRoute = bool(presentation['fx-organ-rotary'], next.organ.rotaryRoute)
  for (let i = 0; i < 9; i++) {
    next.organ.layerA.drawbars[i] = drawbarVal(presentation[`organ-drawbar-${i + 1}`], next.organ.layerA.drawbars[i] ?? 0)
  }

  for (const layer of ['a', 'b', 'c'] as const) {
    const L = layer.toUpperCase() as 'A' | 'B' | 'C'
    const st = next.synth[`layer${L}`]
    st.enabled = bool(presentation[`synth-layer-${layer}-enable`], st.enabled)
    st.level = num(presentation[`synth-layer-${layer}-level`], st.level)
    st.oscCtrl = num(presentation[`synth-osc-${layer}-ctrl`], st.oscCtrl)
    st.filterFreq = num(presentation['synth-filter-freq'], st.filterFreq)
    st.filterRes = num(presentation['synth-filter-res'], st.filterRes)
    st.filterDrive = Math.floor((num(presentation['synth-filter-drive'], st.filterDrive * 42) / 127) * 3)
    st.lfoRate = num(presentation['synth-lfo-rate'], st.lfoRate)
    st.lfoAmount = num(presentation['synth-lfo-amount'], st.lfoAmount)
    st.arpRate = num(presentation['synth-arp-rate'], st.arpRate)
    st.arpRange = Math.max(1, Math.round(num(presentation['synth-arp-range'], st.arpRange * 21) / 21))
    st.arpRun = bool(presentation['synth-arp-on'], st.arpRun)
    st.glide = num(presentation['synth-glide'], st.glide)
    st.unison = Math.floor((num(presentation['synth-unison'], st.unison * 42) / 127) * 3)
  }
  if (bool(presentation['synth-voice-poly'], false)) next.synth.layerA.voiceMode = 'Poly'
  if (bool(presentation['synth-voice-mono'], false)) next.synth.layerA.voiceMode = 'Mono'
  if (bool(presentation['synth-voice-legato'], false)) next.synth.layerA.voiceMode = 'Legato'

  next.split.enabled = bool(presentation['program-split-on'], next.split.enabled)
  next.clock.bpm = num(presentation['program-clock-bpm'], next.clock.bpm)
  next.performance.transpose = Math.max(-6, Math.min(6, Math.round((num(presentation['program-transpose'], 64) / 127) * 12 - 6)))

  if (bool(presentation['program-scene-ii-active'], false)) next.activeScene = 'II'
  else if (bool(presentation['program-scene-i-active'], true)) next.activeScene = 'I'

  const fx = next.effects
  fx.layerAFocus = bool(presentation['fx-layer-a-focus'], fx.layerAFocus)
  fx.layerBFocus = bool(presentation['fx-layer-b-focus'], fx.layerBFocus)
  fx.layerCFocus = bool(presentation['fx-layer-c-focus'], fx.layerCFocus)
  fx.pianoGroup = bool(presentation['fx-group-a-enable'], fx.pianoGroup)
  fx.allBypass = bool(presentation['fx-all-bypass'], fx.allBypass)
  fx.mod1.type = num(presentation['fx-mod1-type'], fx.mod1.type)
  fx.mod1.rate = num(presentation['fx-mod1-rate'], fx.mod1.rate)
  fx.mod1.amount = num(presentation['fx-mod1-amount'], fx.mod1.amount)
  fx.mod1.bypass = bool(presentation['fx-mod1-bypass'], fx.mod1.bypass)
  fx.mod2.type = num(presentation['fx-mod2-type'], fx.mod2.type)
  fx.mod2.rate = num(presentation['fx-mod2-rate'], fx.mod2.rate)
  fx.mod2.amount = num(presentation['fx-mod2-amount'], fx.mod2.amount)
  fx.mod2.bypass = bool(presentation['fx-mod2-bypass'], fx.mod2.bypass)
  fx.delay.rate = num(presentation['fx-delay-time'], fx.delay.rate)
  fx.delay.feedback = num(presentation['fx-delay-feedback'], fx.delay.feedback)
  fx.delay.mix = num(presentation['fx-delay-mix'], fx.delay.mix)
  fx.delay.bypass = bool(presentation['fx-delay-bypass'], fx.delay.bypass)
  fx.delay.global = bool(presentation['fx-delay-global'], fx.delay.global)
  fx.amp.type = num(presentation['fx-amp-type'], fx.amp.type)
  fx.amp.rate = num(presentation['fx-eq-low'], fx.amp.rate)
  fx.amp.amount = num(presentation['fx-eq-mid'], fx.amp.amount)
  fx.amp.mix = num(presentation['fx-eq-high'], fx.amp.mix)
  fx.amp.bypass = bool(presentation['fx-amp-bypass'], fx.amp.bypass)
  fx.amp.toRotary = bool(presentation['fx-to-rotary'], fx.amp.toRotary ?? false)
  fx.comp.amount = num(presentation['fx-comp-threshold'], fx.comp.amount)
  fx.comp.bypass = bool(presentation['fx-comp-bypass'], fx.comp.bypass)
  fx.comp.global = bool(presentation['fx-comp-global'], fx.comp.global)
  fx.comp.fastMode = bool(presentation['fx-comp-fast'], fx.comp.fastMode ?? false)
  fx.reverb.type = num(presentation['fx-reverb-size'], fx.reverb.type)
  fx.reverb.mix = num(presentation['fx-reverb-mix'], fx.reverb.mix)
  fx.reverb.bypass = bool(presentation['fx-reverb-bypass'], fx.reverb.bypass)
  fx.reverb.global = bool(presentation['fx-reverb-global'], fx.reverb.global)
  fx.rotaryOn = bool(presentation['fx-rotary-on'], fx.rotaryOn)
  fx.rotaryDrive = num(presentation['fx-rotary-drive'], fx.rotaryDrive)

  return next
}

function num(v: ControlValue | undefined, fallback: number): number {
  return typeof v === 'number' ? v : fallback
}

function bool(v: ControlValue | undefined, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function drawbarVal(v: ControlValue | undefined, fallback: number): number {
  return typeof v === 'number' ? Math.max(0, Math.min(8, Math.round(v))) : fallback
}

function octaveFromKnob(knob: number): number {
  return Math.round((knob / 127) * 24 - 12)
}

export function cyclePresentationControl(id: string, presentation: Record<string, ControlValue>): Record<string, ControlValue> {
  const next = { ...presentation }
  if (id === 'piano-kb-touch') {
    next['piano-kb-touch-cycle'] = (num(next['piano-kb-touch-cycle'], 1) + 1) % 3
  } else if (id === 'piano-dyn-comp') {
    next['piano-dyn-comp-cycle'] = (num(next['piano-dyn-comp-cycle'], 0) + 1) % 4
  } else if (id === 'piano-timbre') {
    next['piano-timbre-cycle'] = (num(next['piano-timbre-cycle'], 0) + 1) % 7
  } else if (id === 'piano-unison') {
    next['piano-unison-cycle'] = (num(next['piano-unison-cycle'], 0) + 1) % 4
  } else if (id.startsWith('piano-type-') && !id.includes('led')) {
    const idx = Number(id.replace('piano-type-', ''))
    PIANO_TYPES.forEach((_, i) => {
      next[`piano-type-led-${i}`] = i === idx
    })
    next['program-oled'] = `${PIANO_TYPES[idx] ?? 'Grand'} Model`
  } else if (id.startsWith('organ-model-')) {
    ORGAN_MODELS.forEach((m) => {
      next[`organ-model-${m.toLowerCase()}`] = id === `organ-model-${m.toLowerCase()}`
    })
  } else if (id === 'fx-layer-a-focus') {
    next['fx-layer-a-focus'] = true
    next['fx-layer-b-focus'] = false
  } else if (id === 'fx-layer-b-focus') {
    next['fx-layer-a-focus'] = false
    next['fx-layer-b-focus'] = true
  } else if (id === 'organ-rotary-slow') {
    next['fx-rotary-speed'] = 'slow'
  } else if (id === 'organ-rotary-fast') {
    next['fx-rotary-speed'] = 'fast'
  }
  return next
}

export function isFunctionalControl(id: string): boolean {
  if (isUnsupportedControl(id)) return false
  if (id === 'perf-master-level' || id === 'perf-mod-wheel' || id === 'perf-control-pedal' || id === 'perf-pitch-stick') return true
  if (id === 'perf-panic' || id === 'perf-transpose-up' || id === 'perf-transpose-down') return true
  if (id.startsWith('piano-')) return true
  if (id.startsWith('fx-')) return true
  if (id.startsWith('organ-')) return true
  if (id.startsWith('synth-')) return true
  if (id.startsWith('program-') && id !== 'program-morph-knob') return true
  return false
}

export function synthCategoryFromPresentation(presentation: Record<string, ControlValue>): SynthWaveCategory | null {
  for (const cat of SYNTH_CATEGORIES) {
    if (bool(presentation[`synth-cat-${cat.toLowerCase()}`], false)) return cat
  }
  return null
}

export function filterTypeFromIndex(index: number): SynthFilterType {
  return FILTER_TYPES[index % FILTER_TYPES.length] ?? 'LP24'
}

export function voiceModeFromPresentation(presentation: Record<string, ControlValue>): SynthVoiceMode {
  if (bool(presentation['synth-voice-mono'], false)) return 'Mono'
  if (bool(presentation['synth-voice-legato'], false)) return 'Legato'
  return 'Poly'
}
