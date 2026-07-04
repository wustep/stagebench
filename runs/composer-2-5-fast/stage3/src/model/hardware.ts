export type ControlKind =
  | 'knob'
  | 'button'
  | 'toggle'
  | 'fader'
  | 'drawbar'
  | 'wheel'
  | 'stick'
  | 'encoder'
  | 'display'
  | 'led'

export interface ControlDefinition {
  id: string
  section: SectionId
  kind: ControlKind
  label: string
  group?: string
  min?: number
  max?: number
  defaultValue?: number | boolean | string
}

export type SectionId =
  | 'performance'
  | 'organ'
  | 'piano'
  | 'program'
  | 'synth'
  | 'effects'

export const SECTIONS: { id: SectionId; label: string; fraction: number }[] = [
  { id: 'performance', label: 'Performance controls', fraction: 0.13 },
  { id: 'organ', label: 'Organ', fraction: 0.21 },
  { id: 'piano', label: 'Piano', fraction: 0.15 },
  { id: 'program', label: 'Program and morph', fraction: 0.09 },
  { id: 'synth', label: 'Synth', fraction: 0.21 },
  { id: 'effects', label: 'Layer effects', fraction: 0.21 },
]

export const VERTICAL_ALLOCATION = {
  deck: 0.54,
  keybed: 0.46,
} as const

export const CHASSIS_COLORS = {
  chassisMid: '#79232c',
  chassisDark: '#721f29',
  panelBlueGray: '#3c424d',
  keyBlack: '#0b0b0b',
  keyWhite: '#dcdcdc',
} as const

function knob(id: string, section: SectionId, label: string, group?: string): ControlDefinition {
  return { id, section, kind: 'knob', label, group, min: 0, max: 127, defaultValue: 64 }
}

function button(id: string, section: SectionId, label: string, group?: string): ControlDefinition {
  return { id, section, kind: 'button', label, group, defaultValue: false }
}

function toggle(id: string, section: SectionId, label: string, group?: string): ControlDefinition {
  return { id, section, kind: 'toggle', label, group, defaultValue: false }
}

function fader(id: string, section: SectionId, label: string, group?: string): ControlDefinition {
  return { id, section, kind: 'fader', label, group, min: 0, max: 127, defaultValue: 100 }
}

function drawbar(id: string, section: SectionId, label: string): ControlDefinition {
  return { id, section, kind: 'drawbar', label, min: 0, max: 8, defaultValue: 0 }
}

function wheel(id: string, section: SectionId, label: string): ControlDefinition {
  return { id, section, kind: 'wheel', label, min: 0, max: 127, defaultValue: 64 }
}

function stick(id: string, section: SectionId, label: string): ControlDefinition {
  return { id, section, kind: 'stick', label, min: 0, max: 127, defaultValue: 64 }
}

function encoder(id: string, section: SectionId, label: string, group?: string): ControlDefinition {
  return { id, section, kind: 'encoder', label, group, min: 0, max: 127, defaultValue: 64 }
}

function display(id: string, section: SectionId, label: string): ControlDefinition {
  return { id, section, kind: 'display', label, defaultValue: '' }
}

function led(id: string, section: SectionId, label: string, group?: string): ControlDefinition {
  return { id, section, kind: 'led', label, group, defaultValue: false }
}

const performanceControls: ControlDefinition[] = [
  knob('perf-master-level', 'performance', 'Master Level'),
  stick('perf-pitch-stick', 'performance', 'Pitch Stick'),
  wheel('perf-mod-wheel', 'performance', 'Modulation Wheel'),
  button('perf-panic', 'performance', 'Panic'),
  toggle('perf-transpose-up', 'performance', 'Transpose Up'),
  toggle('perf-transpose-down', 'performance', 'Transpose Down'),
]

const organDrawbars = [
  'Sub', 'Fund', 'Oct', '5th', '3rd', 'Mix', '7th', '9th', '11th',
].map((name, i) => drawbar(`organ-drawbar-${i + 1}`, 'organ', `${name} Drawbar`))

const organControls: ControlDefinition[] = [
  ...organDrawbars,
  ...Array.from({ length: 9 }, (_, i) => led(`organ-drawbar-led-${i + 1}`, 'organ', `Drawbar ${i + 1} LED`, 'drawbar-leds')),
  toggle('organ-model-b3', 'organ', 'B3 Model', 'model'),
  toggle('organ-model-vox', 'organ', 'Vox Model', 'model'),
  toggle('organ-model-farf', 'organ', 'Farf Model', 'model'),
  toggle('organ-model-pipe', 'organ', 'Pipe Model', 'model'),
  knob('organ-perc-level', 'organ', 'Percussion Level', 'percussion'),
  toggle('organ-perc-soft', 'organ', 'Perc Soft', 'percussion'),
  toggle('organ-perc-fast', 'organ', 'Perc Fast', 'percussion'),
  knob('organ-key-click', 'organ', 'Key Click', 'percussion'),
  toggle('organ-vib-chorus', 'organ', 'Vibrato Chorus', 'rotary'),
  knob('organ-rotary-drive', 'organ', 'Rotary Drive', 'rotary'),
  button('organ-rotary-slow', 'organ', 'Rotary Slow', 'rotary'),
  button('organ-rotary-fast', 'organ', 'Rotary Fast', 'rotary'),
  button('organ-rotary-stop', 'organ', 'Rotary Stop', 'rotary'),
  fader('organ-layer-a-level', 'organ', 'Organ Layer A Level', 'layers'),
  fader('organ-layer-b-level', 'organ', 'Organ Layer B Level', 'layers'),
  toggle('organ-layer-a-enable', 'organ', 'Organ Layer A Enable', 'layers'),
  toggle('organ-layer-b-enable', 'organ', 'Organ Layer B Enable', 'layers'),
  knob('organ-layer-a-octave', 'organ', 'Organ Layer A Octave', 'layers'),
  knob('organ-layer-b-octave', 'organ', 'Organ Layer B Octave', 'layers'),
]

const pianoTypes = ['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc']
const pianoControls: ControlDefinition[] = [
  ...pianoTypes.map((t, i) => button(`piano-type-${i}`, 'piano', `${t} Type`, 'types')),
  ...pianoTypes.map((t, i) => led(`piano-type-led-${i}`, 'piano', `${t} Type LED`, 'types')),
  encoder('piano-model-dial', 'piano', 'Model Dial', 'model'),
  fader('piano-layer-a-level', 'piano', 'Piano Layer A Level', 'layers'),
  fader('piano-layer-b-level', 'piano', 'Piano Layer B Level', 'layers'),
  toggle('piano-layer-a-enable', 'piano', 'Piano Layer A Enable', 'layers'),
  toggle('piano-layer-b-enable', 'piano', 'Piano Layer B Enable', 'layers'),
  knob('piano-layer-a-octave', 'piano', 'Piano Layer A Octave', 'layers'),
  knob('piano-layer-b-octave', 'piano', 'Piano Layer B Octave', 'layers'),
  button('piano-kb-touch', 'piano', 'KB Touch', 'performance'),
  button('piano-dyn-comp', 'piano', 'Dyn Comp', 'performance'),
  button('piano-timbre', 'piano', 'Timbre', 'performance'),
  button('piano-unison', 'piano', 'Unison', 'performance'),
  toggle('piano-soft-release', 'piano', 'Soft Release', 'performance'),
  toggle('piano-string-res', 'piano', 'String Res', 'performance'),
  toggle('piano-sustped', 'piano', 'SUSTPED', 'performance'),
  toggle('piano-pstick', 'piano', 'PSTICK', 'performance'),
  toggle('piano-section-on', 'piano', 'Piano Section On', 'section'),
]

const programControls: ControlDefinition[] = [
  display('program-oled', 'program', 'Program OLED'),
  encoder('program-dial', 'program', 'Program Dial'),
  ...Array.from({ length: 8 }, (_, i) => button(`program-btn-${i + 1}`, 'program', `Program ${i + 1}`)),
  button('program-page-up', 'program', 'Page Up'),
  button('program-page-down', 'program', 'Page Down'),
  button('program-live-mode', 'program', 'Live Mode'),
  button('program-scene-i', 'program', 'Scene I'),
  button('program-scene-ii', 'program', 'Scene II'),
  button('program-store', 'program', 'Store'),
  button('program-store-as', 'program', 'Store As'),
  button('program-split', 'program', 'Split'),
  button('program-morph-wheel', 'program', 'Morph Wheel Assign'),
  button('program-morph-pedal', 'program', 'Morph Pedal Assign'),
  button('program-morph-knob', 'program', 'Morph Knob Assign'),
  knob('program-transpose', 'program', 'Transpose'),
  toggle('program-dirty', 'program', 'Dirty Indicator'),
]

const synthControls: ControlDefinition[] = [
  display('synth-oled', 'synth', 'Synth OLED'),
  fader('synth-layer-a-level', 'synth', 'Synth Layer A Level', 'layers'),
  fader('synth-layer-b-level', 'synth', 'Synth Layer B Level', 'layers'),
  fader('synth-layer-c-level', 'synth', 'Synth Layer C Level', 'layers'),
  toggle('synth-layer-a-enable', 'synth', 'Synth Layer A Enable', 'layers'),
  toggle('synth-layer-b-enable', 'synth', 'Synth Layer B Enable', 'layers'),
  toggle('synth-layer-c-enable', 'synth', 'Synth Layer C Enable', 'layers'),
  knob('synth-osc-a-wave', 'synth', 'Osc A Wave', 'osc'),
  knob('synth-osc-a-ctrl', 'synth', 'Osc A Control', 'osc'),
  knob('synth-osc-a-level', 'synth', 'Osc A Level', 'osc'),
  knob('synth-osc-b-wave', 'synth', 'Osc B Wave', 'osc'),
  knob('synth-osc-b-ctrl', 'synth', 'Osc B Control', 'osc'),
  knob('synth-osc-b-level', 'synth', 'Osc B Level', 'osc'),
  knob('synth-osc-c-wave', 'synth', 'Osc C Wave', 'osc'),
  knob('synth-osc-c-ctrl', 'synth', 'Osc C Control', 'osc'),
  knob('synth-osc-c-level', 'synth', 'Osc C Level', 'osc'),
  knob('synth-filter-type', 'synth', 'Filter Type', 'filter'),
  knob('synth-filter-freq', 'synth', 'Filter Frequency', 'filter'),
  knob('synth-filter-res', 'synth', 'Filter Resonance', 'filter'),
  knob('synth-filter-drive', 'synth', 'Filter Drive', 'filter'),
  knob('synth-amp-attack', 'synth', 'Amp Attack', 'envelope'),
  knob('synth-amp-decay', 'synth', 'Amp Decay', 'envelope'),
  knob('synth-amp-sustain', 'synth', 'Amp Sustain', 'envelope'),
  knob('synth-amp-release', 'synth', 'Amp Release', 'envelope'),
  knob('synth-filter-attack', 'synth', 'Filter Attack', 'filter-env'),
  knob('synth-filter-decay', 'synth', 'Filter Decay', 'filter-env'),
  knob('synth-filter-sustain', 'synth', 'Filter Sustain', 'filter-env'),
  knob('synth-filter-release', 'synth', 'Filter Release', 'filter-env'),
  knob('synth-lfo-rate', 'synth', 'LFO Rate', 'lfo'),
  knob('synth-lfo-amount', 'synth', 'LFO Amount', 'lfo'),
  toggle('synth-arp-on', 'synth', 'Arpeggiator On', 'arp'),
  knob('synth-arp-rate', 'synth', 'Arpeggiator Rate', 'arp'),
  knob('synth-arp-range', 'synth', 'Arpeggiator Range', 'arp'),
  button('synth-voice-poly', 'synth', 'Poly Voice Mode', 'voice'),
  button('synth-voice-mono', 'synth', 'Mono Voice Mode', 'voice'),
  button('synth-voice-legato', 'synth', 'Legato Voice Mode', 'voice'),
  knob('synth-glide', 'synth', 'Glide', 'voice'),
  knob('synth-unison', 'synth', 'Unison', 'voice'),
]

const effectsControls: ControlDefinition[] = [
  toggle('fx-layer-a-focus', 'effects', 'Layer A Focus', 'focus'),
  toggle('fx-layer-b-focus', 'effects', 'Layer B Focus', 'focus'),
  toggle('fx-layer-c-focus', 'effects', 'Layer C Focus', 'focus'),
  toggle('fx-group-a-enable', 'effects', 'Effect Group A Enable', 'groups'),
  toggle('fx-group-b-enable', 'effects', 'Effect Group B Enable', 'groups'),
  knob('fx-mod1-type', 'effects', 'Mod 1 Type', 'mod1'),
  knob('fx-mod1-rate', 'effects', 'Mod 1 Rate', 'mod1'),
  knob('fx-mod1-amount', 'effects', 'Mod 1 Amount', 'mod1'),
  toggle('fx-mod1-bypass', 'effects', 'Mod 1 Bypass', 'mod1'),
  knob('fx-mod2-type', 'effects', 'Mod 2 Type', 'mod2'),
  knob('fx-mod2-rate', 'effects', 'Mod 2 Rate', 'mod2'),
  knob('fx-mod2-amount', 'effects', 'Mod 2 Amount', 'mod2'),
  toggle('fx-mod2-bypass', 'effects', 'Mod 2 Bypass', 'mod2'),
  knob('fx-delay-time', 'effects', 'Delay Time', 'delay'),
  knob('fx-delay-feedback', 'effects', 'Delay Feedback', 'delay'),
  knob('fx-delay-mix', 'effects', 'Delay Mix', 'delay'),
  toggle('fx-delay-bypass', 'effects', 'Delay Bypass', 'delay'),
  knob('fx-amp-type', 'effects', 'Amp Sim Type', 'amp'),
  knob('fx-eq-low', 'effects', 'EQ Low', 'amp'),
  knob('fx-eq-mid', 'effects', 'EQ Mid', 'amp'),
  knob('fx-eq-high', 'effects', 'EQ High', 'amp'),
  toggle('fx-amp-bypass', 'effects', 'Amp Sim Bypass', 'amp'),
  knob('fx-comp-threshold', 'effects', 'Compressor Threshold', 'comp'),
  knob('fx-comp-ratio', 'effects', 'Compressor Ratio', 'comp'),
  toggle('fx-comp-bypass', 'effects', 'Compressor Bypass', 'comp'),
  knob('fx-reverb-size', 'effects', 'Reverb Size', 'reverb'),
  knob('fx-reverb-mix', 'effects', 'Reverb Mix', 'reverb'),
  toggle('fx-reverb-bypass', 'effects', 'Reverb Bypass', 'reverb'),
  toggle('fx-all-bypass', 'effects', 'All Effects Bypass', 'global'),
  knob('fx-master-wet', 'effects', 'Master Wet', 'global'),
  button('fx-to-rotary', 'effects', 'To Rotary', 'global'),
]

export const CONTROLS: ControlDefinition[] = [
  ...performanceControls,
  ...organControls,
  ...pianoControls,
  ...programControls,
  ...synthControls,
  ...effectsControls,
]

export function controlsForSection(section: SectionId): ControlDefinition[] {
  return CONTROLS.filter((c) => c.section === section)
}

export function defaultControlValue(control: ControlDefinition): number | boolean | string {
  return control.defaultValue ?? (control.kind === 'button' || control.kind === 'toggle' || control.kind === 'led' ? false : 0)
}

export type ControlValue = number | boolean | string

export type PresentationState = Record<string, ControlValue>

export function createPresentationState(): PresentationState {
  const state: PresentationState = {}
  for (const control of CONTROLS) {
    state[control.id] = defaultControlValue(control)
  }
  state['program-oled'] = 'Init Program'
  state['synth-oled'] = 'Init Synth'
  return state
}
