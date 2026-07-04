import type { ControlValue } from '../model/hardware'
import { PIANO_TYPES, type InstrumentAudioState, type KbTouch, type DynCompLevel, type UnisonLevel } from '../audio/types'

const KB_TOUCH: KbTouch[] = ['Heavy', 'Medium', 'Light']
const DYN_COMP: DynCompLevel[] = ['Off', '1', '2', '3']
const UNISON: UnisonLevel[] = ['Off', '1', '2', '3']

export function presentationToAudioState(
  presentation: Record<string, ControlValue>,
  prev: InstrumentAudioState,
): InstrumentAudioState {
  const next = structuredClone(prev)

  next.masterLevel = num(presentation['perf-master-level'], next.masterLevel)

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

  const fx = next.effects
  fx.layerAFocus = bool(presentation['fx-layer-a-focus'], fx.layerAFocus)
  fx.layerBFocus = bool(presentation['fx-layer-b-focus'], fx.layerBFocus)
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
  } else if (id === 'fx-layer-a-focus') {
    next['fx-layer-a-focus'] = true
    next['fx-layer-b-focus'] = false
  } else if (id === 'fx-layer-b-focus') {
    next['fx-layer-a-focus'] = false
    next['fx-layer-b-focus'] = true
  }
  return next
}

export const FUNCTIONAL_CONTROL_PREFIXES = [
  'perf-master-level',
  'piano-',
  'fx-',
]

export function isFunctionalControl(id: string): boolean {
  if (id === 'perf-master-level') return true
  if (id.startsWith('piano-')) return true
  if (id.startsWith('fx-')) return true
  return false
}
