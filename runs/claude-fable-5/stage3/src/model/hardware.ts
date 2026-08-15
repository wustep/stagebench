import type { SectionId } from './variant'

/**
 * Normalized, typed hardware model for the Nord Stage 4 control deck.
 * Every visible physical panel input has a stable ID and an accessible name.
 *
 * Phase 3 contract: every control is FUNCTIONAL — it writes canonical
 * instrument state that the audio engine applies to the live signal graph —
 * except the small documented UNSUPPORTED set (aftertouch morphing, the
 * preset libraries, and the Section Edit / Layer Init / Monitor-Copy and
 * Samples/Extern mode menus), which stays truthfully DECORATIVE: it moves or
 * presses and exposes accessible presentation state, but has no effect on
 * audio or canonical state.
 */
export type ControlType = 'knob' | 'encoder' | 'button' | 'fader' | 'drawbar' | 'wheel' | 'stick'

export interface HardwareControl {
  id: string
  section: SectionId
  /** Panel group box the control belongs to (e.g. "B3 Percussion"). */
  group?: string
  type: ControlType
  /** Accessible name. */
  label: string
  /** Continuous controls: integer range. */
  min?: number
  max?: number
  initial?: number
  /** Buttons: true = latching toggle with visible lit state. */
  latching?: boolean
  /** Continuous controls that spring back to `initial` on release (pitch stick). */
  springLoaded?: boolean
  /**
   * True when the control is presentation-only (Phase 3 scope). Functional
   * controls write canonical instrument state with audible results.
   */
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
}

/**
 * Controls that stay truthfully decorative in Phase 3. Everything else is
 * functional. These map to features the benchmark excludes (preset libraries,
 * aftertouch input, copy/paste + section-edit menus, Samples/Extern synth
 * modes) and are listed as unsupported in IMPLEMENTATION_DETAILS.json.
 */
export const UNSUPPORTED_CONTROL_IDS: ReadonlySet<string> = new Set([
  'morph-at', // no aftertouch input path exists in a pointer/keyboard UI
  'preset-organ',
  'preset-piano',
  'preset-synth',
  'organ-preset',
  'section-edit',
  'layer-init',
  'mon-copy',
  'synth-mode', // Analog only: Samples/Extern modes are excluded
])

function section(sectionId: SectionId, seeds: ControlSeed[]): HardwareControl[] {
  return seeds.map((seed) => ({ ...seed, section: sectionId, decorative: UNSUPPORTED_CONTROL_IDS.has(seed.id) }))
}

const knob = (id: string, label: string, group?: string): ControlSeed => ({ id, group, type: 'knob', label, min: 0, max: 127, initial: 64 })
const encoder = (id: string, label: string, group?: string): ControlSeed => ({ id, group, type: 'encoder', label, min: 0, max: 127, initial: 0 })
const fader = (id: string, label: string, group?: string): ControlSeed => ({ id, group, type: 'fader', label, min: 0, max: 127, initial: 100 })
const drawbar = (id: string, label: string, group?: string): ControlSeed => ({ id, group, type: 'drawbar', label, min: 0, max: 8, initial: 0 })
const toggle = (id: string, label: string, group?: string): ControlSeed => ({ id, group, type: 'button', label, latching: true })
const push = (id: string, label: string, group?: string): ControlSeed => ({ id, group, type: 'button', label, latching: false })

export const DRAWBAR_FOOTAGES = ['16′', '5⅓′', '8′', '4′', '2⅔′', '2′', '1⅗′', '1⅓′', '1′'] as const
export const DRAWBAR_LEGENDS = ['BASS16', 'STR16', 'FLUTE8', 'OBOE8', 'TRMP8', 'STRB', 'FLUTE4', 'STR4', '2⅔–1'] as const
/** Initial registration = the canonical default program's 88 8000 000 (matches instrument state). */
export const DRAWBAR_INITIAL = [8, 8, 8, 0, 0, 0, 0, 0, 0] as const

export const PROGRAM_BUTTON_LEGENDS = ['System', 'Sound', 'Organize', 'Aux KB', 'Output', 'Pedal', 'MIDI', 'Extern'] as const

const performanceControls = section('performance', [
  { ...knob('perf-master-level', 'Master Level'), initial: 100 },
  { id: 'perf-pitch-stick', type: 'stick', label: 'Pitch Stick', min: -100, max: 100, initial: 0, springLoaded: true },
  { id: 'perf-mod-wheel', type: 'wheel', label: 'Mod Wheel', min: 0, max: 127, initial: 0 },
  // On-screen stand-in for the external control pedal jack (also driven by MIDI CC11).
  { id: 'perf-ctrl-pedal', type: 'wheel', label: 'Control Pedal', min: 0, max: 127, initial: 0 },
  // Rotary Speaker strip sits at the performance/organ boundary on the reference.
  knob('rotary-drive', 'Rotary Drive', 'Rotary Speaker'),
  toggle('rotary-source', 'Rotary Organ Source', 'Rotary Speaker'),
  toggle('rotary-stop-mode', 'Rotary Stop Mode', 'Rotary Speaker'),
  toggle('rotary-speed', 'Rotary Speed Slow Fast', 'Rotary Speaker'),
  push('rotary-morph', 'Rotary Morph', 'Rotary Speaker'),
])

const organControls = section('organ', [
  toggle('organ-on', 'Organ Section On'),
  fader('organ-level-a', 'Organ Layer A Level'),
  fader('organ-level-b', 'Organ Layer B Level'),
  toggle('organ-layer-a', 'Organ Layer A On/Off'),
  toggle('organ-layer-b', 'Organ Layer B On/Off'),
  push('organ-model', 'Organ Model Select', 'Organ Model'),
  push('organ-vib-select', 'Vibrato Chorus Select', 'Vib/Chorus'),
  toggle('organ-vib-on', 'Vibrato Chorus On', 'Vib/Chorus'),
  toggle('organ-perc-volume', 'Percussion Volume Soft', 'B3 Percussion'),
  toggle('organ-perc-decay', 'Percussion Decay Fast', 'B3 Percussion'),
  toggle('organ-perc-harmonic', 'Percussion Harmonic Third', 'B3 Percussion'),
  toggle('organ-perc-on', 'Percussion On', 'B3 Percussion'),
  push('organ-preset', 'Organ Preset'),
  push('organ-octave-down', 'Organ Octave Shift Down'),
  push('organ-octave-up', 'Organ Octave Shift Up'),
  ...DRAWBAR_FOOTAGES.map((footage, i) => ({
    ...drawbar(`organ-drawbar-${i + 1}`, `Drawbar ${i + 1} (${footage})`, 'Drawbars'),
    initial: DRAWBAR_INITIAL[i]!,
  })),
])

const pianoControls = section('piano', [
  toggle('piano-on', 'Piano Section On'),
  fader('piano-level-a', 'Piano Layer A Level'),
  fader('piano-level-b', 'Piano Layer B Level'),
  toggle('piano-layer-a', 'Piano Layer A On/Off'),
  toggle('piano-layer-b', 'Piano Layer B On/Off'),
  push('piano-acoustics', 'Acoustics Select', 'Acoustics'),
  push('piano-unison', 'Unison Select', 'Acoustics'),
  push('piano-kb-touch', 'KB Touch Select'),
  push('piano-dyn-comp', 'Dynamic Compression Select'),
  push('piano-timbre', 'Piano Timbre Select', 'Timbre'),
  push('piano-type', 'Piano Type Select', 'Piano Select'),
  push('piano-info', 'Piano Info', 'Piano Select'),
  encoder('piano-model', 'Piano Model Dial', 'Piano Select'),
  push('piano-octave-down', 'Piano Octave Shift Down'),
  push('piano-octave-up', 'Piano Octave Shift Up'),
])

const programControls = section('program', [
  push('morph-wheel', 'Morph Assign Wheel', 'Morph Assign'),
  push('morph-at', 'Morph Assign Aftertouch', 'Morph Assign'),
  push('morph-ctrlped', 'Morph Assign Control Pedal', 'Morph Assign'),
  push('split-onset', 'Split On/Set', 'Split'),
  push('mstclk-tap', 'Master Clock Tap/Set', 'Mst Clk'),
  push('transpose-onset', 'Transpose On/Set', 'Transp'),
  push('panic', 'Panic', 'Transp'),
  push('prog-view', 'Prog View'),
  push('store', 'Store'),
  push('store-as', 'Store As'),
  push('preset-organ', 'Preset Library Organ', 'Preset Library'),
  push('preset-piano', 'Preset Library Piano', 'Preset Library'),
  push('preset-synth', 'Preset Library Synth', 'Preset Library'),
  encoder('program-dial', 'Program Dial'),
  push('page-left', 'Page/Cat Left'),
  push('page-right', 'Page/Cat Right'),
  toggle('live-mode', 'Live Mode'),
  toggle('layer-scene', 'Layer Scene II'),
  ...PROGRAM_BUTTON_LEGENDS.map((legend, i) => push(`program-${i + 1}`, `Program ${i + 1}`, 'Program')),
  push('solo-undo', 'Solo/Undo'),
  push('section-edit', 'Section Edit'),
  push('layer-init', 'Layer Init'),
  push('mon-copy', 'Monitor/Copy Paste'),
  toggle('shift', 'Shift/Exit'),
])

const synthControls = section('synth', [
  toggle('synth-on', 'Synth Section On'),
  encoder('synth-dial-1', 'Synth Display Dial 1'),
  encoder('synth-dial-2', 'Synth Display Dial 2'),
  encoder('synth-dial-3', 'Synth Display Dial 3'),
  push('synth-mode', 'Synth Mode Select', 'Mode'),
  knob('arp-rate', 'Arpeggiator Rate/Time', 'Arpeggiator/Gate'),
  push('arp-mode', 'Arpeggiator Mode', 'Arpeggiator/Gate'),
  { ...knob('arp-range', 'Arpeggiator Range', 'Arpeggiator/Gate'), initial: 0 },
  push('arp-menu', 'Arpeggiator Menu', 'Arpeggiator/Gate'),
  push('voice-mode', 'Voice Mode', 'Voice'),
  { ...knob('glide', 'Glide', 'Voice'), initial: 0 },
  push('vibrato-mode', 'Synth Vibrato Mode', 'Vibrato'),
  push('vibrato-menu', 'Synth Vibrato Menu', 'Vibrato'),
  push('waveform-select', 'Waveform Select'),
  push('sound-init', 'Sound Init'),
  push('lfo-waveform', 'LFO Waveform', 'LFO'),
  knob('lfo-rate', 'LFO Rate/Time', 'LFO'),
  { ...knob('lfo-mod-amt', 'LFO Mod Amount', 'LFO'), initial: 0 },
  push('osc-pitch-smp', 'Oscillator Pitch/Sample', 'Oscillators'),
  push('osc-envelope', 'Oscillator Envelope', 'Oscillators'),
  knob('osc-ctrl', 'Oscillator Control', 'Oscillators'),
  knob('osc-env-amt', 'Oscillator Envelope Amount', 'Oscillators'),
  push('filter-type', 'Filter Type', 'Filter'),
  push('filter-envelope', 'Filter Envelope', 'Filter'),
  toggle('filter-on', 'Filter On', 'Filter'),
  { ...knob('filter-freq', 'Filter Frequency', 'Filter'), initial: 90 },
  { ...knob('filter-res', 'Filter Resonance', 'Filter'), initial: 20 },
  { ...knob('filter-env-amt', 'Filter Envelope Amount', 'Filter'), initial: 40 },
  push('amp-envelope', 'Amp Envelope', 'Amp'),
  push('synth-unison', 'Synth Unison', 'Unison'),
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
  push('fx-focus-piano', 'Piano FX Focus Group', 'FX Focus'),
  push('fx-focus-synth', 'Synth FX Focus Group', 'FX Focus'),
  knob('mod1-rate', 'Mod 1 Rate', 'Mod 1'),
  knob('mod1-amount', 'Mod 1 Amount', 'Mod 1'),
  push('mod1-variation', 'Mod 1 Variation', 'Mod 1'),
  toggle('mod1-on', 'Mod 1 On', 'Mod 1'),
  knob('mod2-rate', 'Mod 2 Rate', 'Mod 2'),
  knob('mod2-amount', 'Mod 2 Amount', 'Mod 2'),
  push('mod2-variation', 'Mod 2 Variation', 'Mod 2'),
  toggle('mod2-on', 'Mod 2 On', 'Mod 2'),
  knob('amp-drive', 'Amp Sim Drive', 'Amp Sim/EQ'),
  knob('amp-freq', 'Amp Sim EQ Frequency', 'Amp Sim/EQ'),
  knob('eq-bass', 'EQ Bass', 'Amp Sim/EQ'),
  knob('eq-mid', 'EQ Mid', 'Amp Sim/EQ'),
  knob('eq-treble', 'EQ Treble', 'Amp Sim/EQ'),
  push('amp-variation', 'Amp Sim Variation', 'Amp Sim/EQ'),
  toggle('amp-on', 'Amp Sim/EQ On', 'Amp Sim/EQ'),
  knob('delay-tempo', 'Delay Tempo', 'Delay'),
  push('delay-variation', 'Delay Effects Variation', 'Delay'),
  knob('delay-feedback', 'Delay Feedback', 'Delay'),
  push('delay-tap', 'Delay Tap/Set', 'Delay'),
  toggle('delay-analog', 'Delay Analog Mode', 'Delay'),
  push('delay-filter', 'Delay Feedback Filter', 'Delay'),
  knob('delay-mix', 'Delay Dry/Wet', 'Delay'),
  toggle('delay-on', 'Delay On', 'Delay'),
  knob('comp-amount', 'Compressor Amount', 'Comp'),
  toggle('comp-on', 'Compressor On', 'Comp'),
  toggle('reverb-bright', 'Reverb Bright/Dark', 'Reverb'),
  push('reverb-variation', 'Reverb Variation', 'Reverb'),
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

/** Controls with canonical, audible behavior (Phase 3: everything not listed unsupported). */
export const FUNCTIONAL_CONTROL_IDS: ReadonlySet<string> = new Set(
  HARDWARE_CONTROLS.filter((c) => !c.decorative).map((c) => c.id),
)

export function controlsForSection(sectionId: SectionId): HardwareControl[] {
  return HARDWARE_CONTROLS.filter((c) => c.section === sectionId)
}

export function getControl(id: string): HardwareControl {
  const control = HARDWARE_CONTROLS.find((c) => c.id === id)
  if (!control) throw new Error(`Unknown hardware control: ${id}`)
  return control
}

export function functionalControls(): HardwareControl[] {
  return HARDWARE_CONTROLS.filter((c) => !c.decorative)
}

export function decorativeControls(): HardwareControl[] {
  return HARDWARE_CONTROLS.filter((c) => c.decorative)
}
