import type { SectionId } from './variant'

/**
 * Normalized, typed hardware model for the Nord Stage 4 control deck.
 * Every visible physical panel input has a stable ID and an accessible name.
 *
 * Contract: nearly every control is FUNCTIONAL — it writes canonical
 * instrument state that the audio engine applies to the live signal graph.
 * This now spans Piano, Organ (all six models), the complete Synth section
 * (oscillators, filter, envelopes, LFO, voice modes, arpeggiator/gate, Sound
 * Init, and Synth Mode's Analog<->Samples cycle), Layer Effects (per-layer
 * piano/organ-shared/synth-layer chains), Rotary, Master Level, pitch stick,
 * Shift/Panic, and Programs/scenes/splits/morphs/master clock/transpose. A
 * small, truthfully DECORATIVE remainder moves or presses and exposes
 * accessible presentation state but has no audio effect, matching spec
 * exclusions: Synth Mode's Extern position (the button cycles only between
 * the two real modes and never lands there). Morph A.T. is functional: its
 * source value moves from MIDI channel pressure (audit E10).
 * Mon/Copy is functional (manual p. 43): its click latches the
 * monitor/copy mode (knobs display without writing; Layer / effect ON /
 * Morph / PROGRAM buttons copy) and Shift + click latches Paste.
 * The Organ PRESET button is functional
 * (manual p. 21): it toggles the focused layer's Preset On / Drawbar Live
 * state, with SYNC as its Shift pairing. All three PRESET
 * LIBRARY buttons are functional (manual p. 41-42), each browsing/loading
 * its factory bank. Prog View is functional: it cycles the Program display's
 * four view modes (manual p. 42). Section Edit is fully functional: a plain
 * press latches the p. 43 sticky mode — edits done to a parameter fan out
 * to all Layers of that Section (the hardware's double-tap sticky maps to
 * click = sticky latch, a declared adaptation) — and LAYER INIT (Shift +
 * Section Edit, manual p. 43) opens the four-soft-button init screen on the
 * Program OLED.
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
 * Controls with canonical, audible behavior. Everything else stays
 * truthfully decorative until the Synth/Program scope is built.
 */
export const FUNCTIONAL_CONTROL_IDS: ReadonlySet<string> = new Set([
  // Performance / master / pitch
  'perf-master-level',
  'perf-pitch-stick',
  // Rotary Speaker (single instance; Piano routes via Amp Sim/EQ "To Rotary",
  // the Organ via the strip's ORGAN source button)
  'rotary-drive',
  'rotary-speed',
  'rotary-stop-mode',
  'rotary-source',
  // Organ section — all controls, including PRESET / Drawbar Live + SYNC
  // (manual p. 19/21)
  'organ-on',
  'organ-preset',
  'organ-level-a',
  'organ-level-b',
  'organ-layer-a',
  'organ-layer-b',
  'organ-model',
  'organ-vib-select',
  'organ-vib-on',
  'organ-perc-volume',
  'organ-perc-decay',
  'organ-perc-harmonic',
  'organ-perc-on',
  'organ-octave-down',
  'organ-octave-up',
  'organ-drawbar-1',
  'organ-drawbar-2',
  'organ-drawbar-3',
  'organ-drawbar-4',
  'organ-drawbar-5',
  'organ-drawbar-6',
  'organ-drawbar-7',
  'organ-drawbar-8',
  'organ-drawbar-9',
  // Piano section — all controls
  'piano-on',
  'piano-level-a',
  'piano-level-b',
  'piano-layer-a',
  'piano-layer-b',
  'piano-acoustics',
  'piano-unison',
  'piano-kb-touch',
  'piano-dyn-comp',
  'piano-timbre',
  'piano-type',
  'piano-model',
  'piano-octave-down',
  'piano-octave-up',
  // Program section: Shift (Global-mode / SUSTPED / Exit modifier) and the
  // Programs cluster (32 slots + 8 Live, store flows, navigation). PANIC is
  // Shift + Transpose On/Set (manual p. 40) — no separate physical button.
  'shift',
  // STORE AS… = Shift + Store (manual p. 41): one physical red button.
  'store',
  // PRESET LIBRARY (manual p. 41-42): browse/load the factory Organ, Piano
  // and Synth banks on the Program OLED; SINGLE LAYER = Shift + press for
  // Piano/Synth (Organ presets are always whole-Section — p. 41 note).
  'preset-organ',
  'preset-piano',
  'preset-synth',
  'prog-view',
  'program-dial',
  'page-left',
  'page-right',
  'live-mode',
  'solo-undo',
  // SECTION EDIT (manual p. 43): a plain press latches sticky mode — edits
  // done to a parameter fan out to all Layers of that Section (the
  // hardware's double-tap sticky maps to click = sticky latch, a declared
  // adaptation). LAYER INIT = Shift + Section Edit opens the init screen.
  'section-edit',
  // MONITOR / COPY / PASTE (manual p. 43): the Mon/Copy click latches the
  // monitor/copy mode, Shift + click latches Paste (pointer-first
  // adaptation of the hardware's hold gestures).
  'mon-copy',
  'layer-scene',
  'split-onset',
  'mstclk-tap',
  'transpose-onset',
  'morph-wheel',
  // Morph A.T. is functional (audit E10): the source moves from MIDI channel
  // pressure; the button arms assignments exactly like Wheel/Ctrl Pedal.
  'morph-at',
  'morph-ctrlped',
  'perf-mod-wheel',
  'program-1',
  'program-2',
  'program-3',
  'program-4',
  'program-5',
  'program-6',
  'program-7',
  'program-8',
  // Synth section (sources/layers, filters/envelopes/LFO, and now voice
  // modes + the arpeggiator/gate — every Synth control is functional except
  // Synth Mode's Extern/Samples positions, which stay spec-excluded)
  'synth-on',
  'synth-level-a',
  'synth-level-b',
  'synth-level-c',
  'synth-layer-a',
  'synth-layer-b',
  'synth-layer-c',
  'synth-octave-down',
  'synth-octave-up',
  'waveform-select',
  'synth-dial-1',
  'synth-dial-2',
  'synth-dial-3',
  'osc-ctrl',
  'amp-envelope',
  'filter-type',
  'filter-envelope',
  'filter-on',
  'filter-freq',
  'filter-res',
  'filter-env-amt',
  'osc-envelope',
  'osc-env-amt',
  'lfo-waveform',
  'lfo-destination',
  'lfo-rate',
  'lfo-mod-amt',
  'voice-mode',
  'glide',
  'synth-unison',
  'vibrato-mode',
  'vibrato-menu',
  'osc-pitch-smp',
  'arp-run',
  'arp-mode',
  'arp-rate',
  'arp-range',
  'arp-menu',
  'kb-hold',
  'fx-focus-synth',
  // Optional scope: Synth Mode (Analog <-> Samples; Extern stays
  // spec-excluded and unreachable from this button). Sound Init has no
  // button of its own: it is Shift + Waveform Select (manual p. 37).
  'synth-mode',
  // Layer Effects section
  'effects-on',
  'all-fx-off',
  'fx-focus-piano',
  'shift-2',
  'mod1-rate',
  'mod1-amount',
  'mod1-variation',
  'mod1-on',
  'mod2-rate',
  'mod2-amount',
  'mod2-variation',
  'mod2-on',
  'amp-drive',
  'amp-freq',
  'eq-bass',
  'eq-mid',
  'eq-treble',
  'amp-variation',
  'amp-on',
  'delay-tempo',
  'delay-variation',
  'delay-feedback',
  'delay-tap',
  'delay-filter',
  'delay-mix',
  'delay-on',
  'comp-amount',
  'comp-on',
  'reverb-bright',
  'reverb-variation',
  'reverb-mix',
  'reverb-on',
])

function section(sectionId: SectionId, seeds: ControlSeed[]): HardwareControl[] {
  return seeds.map((seed) => ({ ...seed, section: sectionId, decorative: !FUNCTIONAL_CONTROL_IDS.has(seed.id) }))
}

const knob = (id: string, label: string, group?: string): ControlSeed => ({ id, group, type: 'knob', label, min: 0, max: 127, initial: 64 })
const encoder = (id: string, label: string, group?: string): ControlSeed => ({ id, group, type: 'encoder', label, min: 0, max: 127, initial: 0 })
const fader = (id: string, label: string, group?: string): ControlSeed => ({ id, group, type: 'fader', label, min: 0, max: 127, initial: 100 })
const drawbar = (id: string, label: string, group?: string): ControlSeed => ({ id, group, type: 'drawbar', label, min: 0, max: 8, initial: 0 })
const toggle = (id: string, label: string, group?: string): ControlSeed => ({ id, group, type: 'button', label, latching: true })
const push = (id: string, label: string, group?: string): ControlSeed => ({ id, group, type: 'button', label, latching: false })

export const DRAWBAR_FOOTAGES = ['16′', '5⅓′', '8′', '4′', '2⅔′', '2′', '1⅗′', '1⅓′', '1′'] as const
export const DRAWBAR_LEGENDS = ['BASS16', 'STR16', 'FLUTE8', 'OBOE8', 'TRMP8', 'STR8', 'FLUTE4', 'STR4', '2 2/3'] as const
/** Second dim register row printed under each drawbar name (reference photo):
 *  blank under STR4, a sine-span glyph under the last column. */
export const DRAWBAR_REGISTERS = ['16′', '8′', '4′', '2′', 'II', 'III', 'IV', '', '∿–∿'] as const
/** Initial visual registration pose, loosely matching the reference photo. */
export const DRAWBAR_INITIAL = [3, 0, 8, 2, 5, 1, 4, 0, 6] as const

export const PROGRAM_BUTTON_LEGENDS = ['System', 'Sound', 'Organize', 'Aux KB', 'Output', 'Pedal', 'MIDI', 'Extern'] as const

const performanceControls = section('performance', [
  { ...knob('perf-master-level', 'Master Level'), initial: 100 },
  { id: 'perf-pitch-stick', type: 'stick', label: 'Pitch Stick', min: -100, max: 100, initial: 0, springLoaded: true },
  { id: 'perf-mod-wheel', type: 'wheel', label: 'Mod Wheel', min: 0, max: 127, initial: 0 },
  // Rotary Speaker strip sits at the performance/organ boundary on the reference.
  knob('rotary-drive', 'Rotary Drive', 'Rotary Speaker'),
  toggle('rotary-source', 'Rotary Organ Source', 'Rotary Speaker'),
  toggle('rotary-stop-mode', 'Rotary Stop Mode', 'Rotary Speaker'),
  toggle('rotary-speed', 'Rotary Speed Slow Fast', 'Rotary Speaker'),
  // No MORPH button: the hardware's MORPH is an indicator LED, lit while a
  // morph source is assigned to the rotary speed (manual p. 53).
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
  // PRESET (manual p. 21): latching per-layer Preset On/Off toggle (Off =
  // Drawbar Live); SYNC is its Shift pairing.
  toggle('organ-preset', 'Organ Preset'),
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
  // One physical Piano Select button; INFO is its Shift pairing (manual
  // p. 25: "Pressing INFO (Shift + Piano Select)"), printed under the cap.
  push('piano-type', 'Piano Type Select', 'Piano Select'),
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
  ...PROGRAM_BUTTON_LEGENDS.map((legend, i) => push(`program-${i + 1}`, `Program ${i + 1}`, 'Program')),
  push('solo-undo', 'Solo/Undo'),
  // ONE physical button (reference photo): LAYER INIT is its Shift pairing
  // (manual p. 43, printed as the ▽ shift-legend below the cap). The plain
  // press latches the p. 43 SECTION EDIT sticky mode — edits done to a
  // parameter fan out to all Layers of that Section (the hardware's
  // double-tap sticky maps to click = sticky latch, a declared adaptation).
  push('section-edit', 'Section Edit'),
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
  // ONE physical red-framed button: WAVEFORM select on press, SOUND INIT on
  // Shift + press (manual p. 37: "SOUND INIT (Shift+Waveform)").
  push('waveform-select', 'Waveform Select'),
  push('lfo-waveform', 'LFO Waveform', 'LFO'),
  push('lfo-destination', 'LFO Destination', 'LFO'),
  knob('lfo-rate', 'LFO Rate/Time', 'LFO'),
  { ...knob('lfo-mod-amt', 'LFO Mod Amount', 'LFO'), initial: 0 },
  push('osc-pitch-smp', 'Oscillator Pitch/Sample', 'Oscillators'),
  push('osc-envelope', 'Oscillator Envelope', 'Oscillators'),
  knob('osc-ctrl', 'Oscillator Control', 'Oscillators'),
  knob('osc-env-amt', 'Oscillator Envelope Amount', 'Oscillators'),
  push('filter-type', 'Filter Type', 'Filter'),
  push('filter-envelope', 'Filter Envelope', 'Filter'),
  toggle('filter-on', 'Filter On', 'Filter'),
  { ...knob('filter-freq', 'Filter Frequency', 'Filter'), initial: 127 },
  { ...knob('filter-res', 'Filter Resonance', 'Filter'), initial: 0 },
  knob('filter-env-amt', 'Filter Envelope Amount', 'Filter'),
  toggle('amp-envelope', 'Amp Envelope', 'Amp'),
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
  // The panel has TWO physical Shift/Exit buttons (reference photo: one at
  // the Program section's right rail, one at the FX FOCUS strip's foot).
  // This one mirrors the same latched modifier as 'shift'.
  toggle('shift-2', 'Shift/Exit (FX)', 'FX Focus'),
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
  // ONE physical TAP/SET button (reference photo): tap tempo on press,
  // ANALOG mode on Shift + press (the ▿-marked '● ANALOG ▿' panel print).
  push('delay-tap', 'Delay Tap/Set', 'Delay'),
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

export function controlsForSection(sectionId: SectionId): HardwareControl[] {
  return HARDWARE_CONTROLS.filter((c) => c.section === sectionId)
}

/** O(1) id → control lookup. `getControl` sits on the 120 Hz drag/emit path
 *  (presentation.ts re-reads every mounted control on each store tick), so the
 *  former `HARDWARE_CONTROLS.find` linear scan over ~100 entries is replaced by
 *  a Map built once at module load. */
const CONTROL_BY_ID: ReadonlyMap<string, HardwareControl> = new Map(HARDWARE_CONTROLS.map((c) => [c.id, c]))

export function getControl(id: string): HardwareControl {
  const control = CONTROL_BY_ID.get(id)
  if (!control) throw new Error(`Unknown hardware control: ${id}`)
  return control
}

export function functionalControls(): HardwareControl[] {
  return HARDWARE_CONTROLS.filter((c) => !c.decorative)
}

export function decorativeControls(): HardwareControl[] {
  return HARDWARE_CONTROLS.filter((c) => c.decorative)
}
