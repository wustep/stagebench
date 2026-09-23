import {
  AMP_TYPES,
  DELAY_FILTERS,
  MOD1_TYPES,
  MOD2_TYPES,
  PIANO_TYPES,
  REVERB_TYPES,
  TIMBRES as TIMBRE_LABELS,
  TOUCHES as TOUCH_LABELS,
} from '../audio/labels'
import type { SectionId } from './variant'

/**
 * Normalized hardware model for the Nord Stage 4 deck.
 * Every control keeps `decorative: true` so the Phase 1 inventory contract
 * stays intact. The DOM `data-decorative` attribute is the honesty flag:
 * spec-excluded controls are decorative, and every other control is bound.
 */
export type ControlType = 'knob' | 'encoder' | 'button' | 'fader' | 'drawbar' | 'wheel' | 'stick'

export interface HardwareControl {
  id: string
  section: SectionId
  group?: string
  type: ControlType
  label: string
  min?: number
  max?: number
  initial?: number
  latching?: boolean
  springLoaded?: boolean
  /** LED/selector labels cycled on each press. */
  cycleLabels?: readonly string[]
  /** Starting cycle index when cycleLabels is set. */
  cycleInitial?: number
  /** Starting latched state for buttons. */
  initialToggle?: boolean
  decorative: boolean
}

interface ControlSeed {
  id: string
  group?: string
  type: ControlType
  label: string
  min?: number
  max?: number
  initial?: number
  latching?: boolean
  springLoaded?: boolean
  cycleLabels?: readonly string[]
  cycleInitial?: number
  initialToggle?: boolean
}

const knob = (id: string, label: string, group?: string): ControlSeed => ({
  id,
  group,
  type: 'knob',
  label,
  min: 0,
  max: 127,
  initial: 64,
})
const encoder = (id: string, label: string, group?: string): ControlSeed => ({
  id,
  group,
  type: 'encoder',
  label,
  min: 0,
  max: 127,
  initial: 0,
})
const fader = (id: string, label: string, group?: string): ControlSeed => ({
  id,
  group,
  type: 'fader',
  label,
  min: 0,
  max: 127,
  initial: 100,
})
const drawbar = (id: string, label: string, group?: string): ControlSeed => ({
  id,
  group,
  type: 'drawbar',
  label,
  min: 0,
  max: 8,
  initial: 0,
})
const toggle = (id: string, label: string, group?: string): ControlSeed => ({
  id,
  group,
  type: 'button',
  label,
  latching: true,
})
const push = (id: string, label: string, group?: string): ControlSeed => ({
  id,
  group,
  type: 'button',
  label,
  latching: false,
})

function section(sectionId: SectionId, seeds: ControlSeed[]): HardwareControl[] {
  return seeds.map((seed) => ({ ...seed, section: sectionId, decorative: true }))
}

export {
  AMP_TYPES,
  DELAY_FILTERS,
  MOD1_TYPES,
  MOD2_TYPES,
  PIANO_TYPES,
  REVERB_TYPES,
  TIMBRE_LABELS,
  TOUCH_LABELS,
}

export const DRAWBAR_FOOTAGES = ['16′', '5⅓′', '8′', '4′', '2⅔′', '2′', '1⅗′', '1⅓′', '1′'] as const
export const DRAWBAR_COLORS = ['brown', 'brown', 'white', 'white', 'black', 'white', 'black', 'black', 'white'] as const
export const DRAWBAR_INITIAL = [3, 0, 8, 2, 5, 1, 4, 0, 6] as const
export const PROGRAM_BUTTON_LEGENDS = ['System', 'Sound', 'Organize', 'Aux KB', 'Output', 'Pedal', 'MIDI', 'Extern'] as const

const ORGAN_MODELS = ['B3', 'Vox', 'Farf', 'Pipe 1', 'Pipe 2'] as const
const VIB_STEPS = ['V1', 'V2', 'V3', 'C1', 'C2', 'C3'] as const

const performanceControls = section('performance', [
  { ...knob('perf-master-level', 'Master Level'), initial: 100 },
  { id: 'perf-pitch-stick', type: 'stick', label: 'Pitch Stick', min: -100, max: 100, initial: 0, springLoaded: true },
  { id: 'perf-mod-wheel', type: 'wheel', label: 'Mod Wheel', min: 0, max: 127, initial: 0 },
  knob('rotary-drive', 'Rotary Drive', 'Rotary Speaker'),
  toggle('rotary-source', 'Rotary Organ Source', 'Rotary Speaker'),
  toggle('rotary-stop-mode', 'Rotary Stop Mode', 'Rotary Speaker'),
  toggle('rotary-speed', 'Rotary Speed Slow Fast', 'Rotary Speaker'),
])

const organControls = section('organ', [
  toggle('organ-on', 'Organ Section On'),
  fader('organ-level-a', 'Organ Layer A Level'),
  fader('organ-level-b', 'Organ Layer B Level'),
  toggle('organ-layer-a', 'Organ Layer A On/Off'),
  toggle('organ-layer-b', 'Organ Layer B On/Off'),
  { ...push('organ-model', 'Organ Model Select', 'Organ Model'), cycleLabels: ORGAN_MODELS },
  { ...push('organ-vib-select', 'Vibrato Chorus Select', 'Vib/Chorus'), cycleLabels: VIB_STEPS },
  toggle('organ-vib-on', 'Vibrato Chorus On', 'Vib/Chorus'),
  toggle('organ-perc-volume', 'Percussion Volume Soft', 'B3 Percussion'),
  toggle('organ-perc-decay', 'Percussion Decay Fast', 'B3 Percussion'),
  toggle('organ-perc-harmonic', 'Percussion Harmonic Third', 'B3 Percussion'),
  toggle('organ-perc-on', 'Percussion On', 'B3 Percussion'),
  toggle('organ-preset', 'Organ Preset'),
  push('organ-octave-down', 'Organ Octave Shift Down'),
  push('organ-octave-up', 'Organ Octave Shift Up'),
  ...DRAWBAR_FOOTAGES.map((footage, index) => ({
    ...drawbar(`organ-drawbar-${index + 1}`, `Drawbar ${index + 1} (${footage})`, 'Drawbars'),
    initial: DRAWBAR_INITIAL[index]!,
  })),
])

const pianoControls = section('piano', [
  { ...toggle('piano-on', 'Piano Section On'), initialToggle: true },
  fader('piano-level-a', 'Piano Layer A Level'),
  fader('piano-level-b', 'Piano Layer B Level'),
  { ...toggle('piano-layer-a', 'Piano Layer A On/Off'), initialToggle: true },
  toggle('piano-layer-b', 'Piano Layer B On/Off'),
  { ...push('piano-acoustics', 'Acoustics Select', 'Acoustics'), cycleLabels: ['Off', 'Soft Rel', 'String Res'] },
  { ...push('piano-unison', 'Unison Select', 'Acoustics'), cycleLabels: ['Off', '1', '2', '3'] },
  { ...push('piano-kb-touch', 'KB Touch Select'), cycleLabels: TOUCH_LABELS, cycleInitial: 1 },
  { ...push('piano-dyn-comp', 'Dynamic Compression Select'), cycleLabels: ['Off', '1', '2', '3'] },
  { ...push('piano-timbre', 'Piano Timbre Select', 'Timbre'), cycleLabels: TIMBRE_LABELS },
  { ...push('piano-type', 'Piano Type Select', 'Piano Select'), cycleLabels: PIANO_TYPES },
  encoder('piano-model', 'Piano Model Dial', 'Piano Select'),
  push('piano-octave-down', 'Piano Octave Shift Down'),
  push('piano-octave-up', 'Piano Octave Shift Up'),
])

const programControls = section('program', [
  toggle('morph-wheel', 'Morph Assign Wheel', 'Morph Assign'),
  toggle('morph-at', 'Morph Assign Aftertouch', 'Morph Assign'),
  toggle('morph-ctrlped', 'Morph Assign Control Pedal', 'Morph Assign'),
  toggle('split-onset', 'Split On/Set', 'Split'),
  push('mstclk-tap', 'Master Clock Tap/Set', 'Mst Clk'),
  toggle('transpose-onset', 'Transpose On/Set', 'Transp'),
  push('prog-view', 'Prog View'),
  push('store', 'Store'),
  push('preset-organ', 'Preset Library Organ', 'Preset Library'),
  push('preset-piano', 'Preset Library Piano', 'Preset Library'),
  push('preset-synth', 'Preset Library Synth', 'Preset Library'),
  encoder('program-dial', 'Program Dial'),
  push('page-left', 'Page/Cat Left'),
  push('page-right', 'Page/Cat Right'),
  toggle('live-mode', 'Live Mode'),
  toggle('layer-scene', 'Layer Scene II'),
  ...PROGRAM_BUTTON_LEGENDS.map((legend, index) => push(`program-${index + 1}`, `Program ${index + 1}`, 'Program')),
  push('solo-undo', 'Solo/Undo'),
  push('section-edit', 'Section Edit'),
  push('mon-copy', 'Monitor/Copy Paste'),
  toggle('shift', 'Shift/Exit'),
])

const synthControls = section('synth', [
  toggle('synth-on', 'Synth Section On'),
  encoder('synth-dial-1', 'Synth Display Dial 1'),
  encoder('synth-dial-2', 'Synth Display Dial 2'),
  encoder('synth-dial-3', 'Synth Display Dial 3'),
  { ...push('synth-mode', 'Synth Mode Select', 'Mode'), cycleLabels: ['Analog', 'Samples'] },
  knob('arp-rate', 'Arpeggiator Rate/Time', 'Arpeggiator/Gate'),
  { ...push('arp-mode', 'Arpeggiator Mode', 'Arpeggiator/Gate'), cycleLabels: ['Up', 'Down', 'Up/Dn', 'Rnd'] },
  { ...knob('arp-range', 'Arpeggiator Range', 'Arpeggiator/Gate'), initial: 0 },
  push('arp-menu', 'Arpeggiator Menu', 'Arpeggiator/Gate'),
  { ...push('voice-mode', 'Voice Mode', 'Voice'), cycleLabels: ['Poly', 'Mono', 'Legato'] },
  { ...knob('glide', 'Glide', 'Voice'), initial: 0 },
  { ...push('vibrato-mode', 'Synth Vibrato Mode', 'Vibrato'), cycleLabels: ['Off', 'Dly', 'Whl'] },
  push('vibrato-menu', 'Synth Vibrato Menu', 'Vibrato'),
  push('waveform-select', 'Waveform Select'),
  { ...push('lfo-waveform', 'LFO Waveform', 'LFO'), cycleLabels: ['Tri', 'Saw', 'Sqr', 'S&H'] },
  { ...push('lfo-destination', 'LFO Destination', 'LFO'), cycleLabels: ['Osc', 'Flt', 'Amp'] },
  knob('lfo-rate', 'LFO Rate/Time', 'LFO'),
  { ...knob('lfo-mod-amt', 'LFO Mod Amount', 'LFO'), initial: 0 },
  push('osc-pitch-smp', 'Oscillator Pitch/Sample', 'Oscillators'),
  { ...push('osc-envelope', 'Oscillator Envelope', 'Oscillators'), cycleLabels: ['Atk', 'Dec', 'Rel'] },
  knob('osc-ctrl', 'Oscillator Control', 'Oscillators'),
  knob('osc-env-amt', 'Oscillator Envelope Amount', 'Oscillators'),
  { ...push('filter-type', 'Filter Type', 'Filter'), cycleLabels: ['LP24', 'LP12', 'HP', 'BP'] },
  { ...push('filter-envelope', 'Filter Envelope', 'Filter'), cycleLabels: ['Atk', 'Dec', 'Rel'] },
  toggle('filter-on', 'Filter On', 'Filter'),
  { ...knob('filter-freq', 'Filter Frequency', 'Filter'), initial: 127 },
  { ...knob('filter-res', 'Filter Resonance', 'Filter'), initial: 0 },
  knob('filter-env-amt', 'Filter Envelope Amount', 'Filter'),
  toggle('amp-envelope', 'Amp Envelope', 'Amp'),
  { ...push('synth-unison', 'Synth Unison', 'Unison'), cycleLabels: ['Off', '1', '2', '3'] },
  fader('synth-level-a', 'Synth Layer A Level'),
  fader('synth-level-b', 'Synth Layer B Level'),
  fader('synth-level-c', 'Synth Layer C Level'),
  toggle('synth-layer-a', 'Synth Layer A On/Off'),
  toggle('synth-layer-b', 'Synth Layer B On/Off'),
  toggle('synth-layer-c', 'Synth Layer C On/Off'),
  toggle('kb-hold', 'KB Hold'),
  toggle('arp-run', 'Arpeggiator Run'),
  push('synth-octave-down', 'Synth Octave Shift Down'),
  push('synth-octave-up', 'Synth Octave Shift Up'),
])

const effectsControls = section('effects', [
  toggle('effects-on', 'Layer Effects On'),
  push('all-fx-off', 'All FX Off', 'FX Focus'),
  { ...toggle('fx-focus-organ', 'Organ FX Focus', 'FX Focus'), initialToggle: false },
  { ...toggle('fx-focus-piano', 'Piano FX Focus Group', 'FX Focus'), initialToggle: true },
  toggle('fx-focus-synth', 'Synth FX Focus Group', 'FX Focus'),
  toggle('shift-2', 'Shift/Exit (FX)', 'FX Focus'),
  knob('mod1-rate', 'Mod 1 Rate', 'Mod 1'),
  knob('mod1-amount', 'Mod 1 Amount', 'Mod 1'),
  { ...push('mod1-variation', 'Mod 1 Type', 'Mod 1'), cycleLabels: MOD1_TYPES },
  toggle('mod1-on', 'Mod 1 On', 'Mod 1'),
  knob('mod2-rate', 'Mod 2 Rate', 'Mod 2'),
  knob('mod2-amount', 'Mod 2 Amount', 'Mod 2'),
  { ...push('mod2-variation', 'Mod 2 Type', 'Mod 2'), cycleLabels: MOD2_TYPES },
  toggle('mod2-on', 'Mod 2 On', 'Mod 2'),
  knob('amp-drive', 'Amp Sim Drive', 'Amp Sim/EQ'),
  knob('amp-freq', 'Amp Sim EQ Frequency', 'Amp Sim/EQ'),
  { ...knob('eq-bass', 'EQ Bass', 'Amp Sim/EQ'), initial: 64 },
  { ...knob('eq-mid', 'EQ Mid', 'Amp Sim/EQ'), initial: 64 },
  { ...knob('eq-treble', 'EQ Treble', 'Amp Sim/EQ'), initial: 64 },
  { ...push('amp-variation', 'Amp Sim Variation', 'Amp Sim/EQ'), cycleLabels: AMP_TYPES },
  toggle('amp-on', 'Amp Sim/EQ On', 'Amp Sim/EQ'),
  knob('delay-tempo', 'Delay Tempo', 'Delay'),
  { ...push('delay-variation', 'Delay Effects Variation', 'Delay'), cycleLabels: ['1', '2', '3', '4'] },
  knob('delay-feedback', 'Delay Feedback', 'Delay'),
  push('delay-tap', 'Delay Tap/Set', 'Delay'),
  { ...push('delay-filter', 'Delay Feedback Filter', 'Delay'), cycleLabels: DELAY_FILTERS },
  knob('delay-mix', 'Delay Dry/Wet', 'Delay'),
  toggle('delay-on', 'Delay On', 'Delay'),
  knob('comp-amount', 'Compressor Amount', 'Comp'),
  toggle('comp-on', 'Compressor On', 'Comp'),
  toggle('reverb-bright', 'Reverb Bright/Dark', 'Reverb'),
  { ...push('reverb-variation', 'Reverb Variation', 'Reverb'), cycleLabels: REVERB_TYPES },
  knob('reverb-mix', 'Reverb Dry/Wet', 'Reverb'),
  toggle('reverb-on', 'Reverb On', 'Reverb'),
])

export const HARDWARE_CONTROLS: readonly HardwareControl[] = [
  ...performanceControls,
  ...organControls,
  ...pianoControls,
  ...programControls,
  ...synthControls,
  ...effectsControls,
]

const CONTROL_BY_ID: ReadonlyMap<string, HardwareControl> = new Map(HARDWARE_CONTROLS.map((control) => [control.id, control]))

export function controlsForSection(sectionId: SectionId): HardwareControl[] {
  return HARDWARE_CONTROLS.filter((control) => control.section === sectionId)
}

export function getControl(id: string): HardwareControl {
  const control = CONTROL_BY_ID.get(id)
  if (!control) throw new Error(`Unknown hardware control: ${id}`)
  return control
}

export function decorativeControls(): HardwareControl[] {
  return HARDWARE_CONTROLS.filter((control) => control.decorative)
}
