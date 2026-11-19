import type { SectionId } from './variant'

export type ControlKind = 'button' | 'knob' | 'encoder' | 'fader' | 'drawbar' | 'wheel'

export interface PanelControlSpec {
  readonly id: string
  readonly section: SectionId
  readonly group: string
  readonly label: string
  readonly kind: ControlKind
  readonly min: number
  readonly max: number
  readonly step: number
  readonly defaultValue: number
  readonly options?: readonly string[]
  readonly shortLabel?: string
  readonly capColor?: 'black' | 'white'
}

export const ORGAN_DRAWBAR_SPECS: readonly PanelControlSpec[] = [
  { id: 'organ-drawbar-1', section: 'organ', group: 'drawbars', label: "Organ Drawbar 1 (16')", shortLabel: "16'", kind: 'drawbar', min: 0, max: 8, step: 1, defaultValue: 7, capColor: 'black' },
  { id: 'organ-drawbar-2', section: 'organ', group: 'drawbars', label: "Organ Drawbar 2 (5 1/3')", shortLabel: "5⅓'", kind: 'drawbar', min: 0, max: 8, step: 1, defaultValue: 6, capColor: 'black' },
  { id: 'organ-drawbar-3', section: 'organ', group: 'drawbars', label: "Organ Drawbar 3 (8')", shortLabel: "8'", kind: 'drawbar', min: 0, max: 8, step: 1, defaultValue: 8, capColor: 'white' },
  { id: 'organ-drawbar-4', section: 'organ', group: 'drawbars', label: "Organ Drawbar 4 (4')", shortLabel: "4'", kind: 'drawbar', min: 0, max: 8, step: 1, defaultValue: 5, capColor: 'white' },
  { id: 'organ-drawbar-5', section: 'organ', group: 'drawbars', label: "Organ Drawbar 5 (2 2/3')", shortLabel: "2⅔'", kind: 'drawbar', min: 0, max: 8, step: 1, defaultValue: 5, capColor: 'black' },
  { id: 'organ-drawbar-6', section: 'organ', group: 'drawbars', label: "Organ Drawbar 6 (2')", shortLabel: "2'", kind: 'drawbar', min: 0, max: 8, step: 1, defaultValue: 6, capColor: 'white' },
  { id: 'organ-drawbar-7', section: 'organ', group: 'drawbars', label: "Organ Drawbar 7 (1 3/5')", shortLabel: "1⅗'", kind: 'drawbar', min: 0, max: 8, step: 1, defaultValue: 7, capColor: 'black' },
  { id: 'organ-drawbar-8', section: 'organ', group: 'drawbars', label: "Organ Drawbar 8 (1 1/3')", shortLabel: "1⅓'", kind: 'drawbar', min: 0, max: 8, step: 1, defaultValue: 5, capColor: 'black' },
  { id: 'organ-drawbar-9', section: 'organ', group: 'drawbars', label: "Organ Drawbar 9 (1')", shortLabel: "1'", kind: 'drawbar', min: 0, max: 8, step: 1, defaultValue: 6, capColor: 'white' },
]

export const PANEL_CONTROLS: readonly PanelControlSpec[] = [
  // ===================== 1. PERFORMANCE (14%) =====================
  { id: 'perf-pitch-stick', section: 'performance', group: 'wheels', label: 'Pitch Stick', kind: 'wheel', min: -100, max: 100, step: 5, defaultValue: 0 },
  { id: 'perf-mod-wheel', section: 'performance', group: 'wheels', label: 'Modulation Wheel', kind: 'wheel', min: 0, max: 100, step: 5, defaultValue: 0 },
  { id: 'perf-master-level', section: 'performance', group: 'master', label: 'Master Level', kind: 'knob', min: 0, max: 100, step: 2, defaultValue: 75 },
  { id: 'perf-rotary-drive', section: 'performance', group: 'rotary', label: 'Rotary Speaker Drive', kind: 'knob', min: 0, max: 100, step: 2, defaultValue: 35 },
  { id: 'perf-rotary-drive-on', section: 'performance', group: 'rotary', label: 'Rotary Drive On', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'perf-rotary-stop', section: 'performance', group: 'rotary', label: 'Rotary Stop Mode', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'perf-rotary-speed', section: 'performance', group: 'rotary', label: 'Rotary Speed Slow Fast', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0, options: ['SLOW', 'FAST'] },

  // ===================== 2. ORGAN (20%) =====================
  { id: 'organ-section-on', section: 'organ', group: 'header', label: 'Organ Section On', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 1 },
  { id: 'organ-layer-a-fader', section: 'organ', group: 'layers', label: 'Organ Layer A Level', kind: 'fader', min: 0, max: 100, step: 2, defaultValue: 82 },
  { id: 'organ-layer-b-fader', section: 'organ', group: 'layers', label: 'Organ Layer B Level', kind: 'fader', min: 0, max: 100, step: 2, defaultValue: 64 },
  { id: 'organ-layer-a-on', section: 'organ', group: 'layers', label: 'Organ Layer A On/Off', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 1 },
  { id: 'organ-layer-b-on', section: 'organ', group: 'layers', label: 'Organ Layer B On/Off', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 1 },
  { id: 'organ-preset', section: 'organ', group: 'layers', label: 'Organ Preset / Sync', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'organ-octave-down', section: 'organ', group: 'layers', label: 'Organ Octave Shift Down', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'organ-octave-up', section: 'organ', group: 'layers', label: 'Organ Octave Shift Up', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'organ-model-select', section: 'organ', group: 'model', label: 'Organ Model', kind: 'button', min: 0, max: 5, step: 1, defaultValue: 0, options: ['B3', 'VOX', 'FARF', 'PIPE1', 'PIPE2', 'B3 BASS'] },
  { id: 'organ-vib-type', section: 'organ', group: 'vib-chorus', label: 'Organ Vibrato Chorus Type', kind: 'button', min: 0, max: 5, step: 1, defaultValue: 5, options: ['V1', 'C1', 'V2', 'C2', 'V3', 'C3'] },
  { id: 'organ-vib-on', section: 'organ', group: 'vib-chorus', label: 'Organ Vibrato Chorus On', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 1 },
  { id: 'organ-perc-soft', section: 'organ', group: 'percussion', label: 'B3 Percussion Volume Soft', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'organ-perc-fast', section: 'organ', group: 'percussion', label: 'B3 Percussion Decay Fast', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 1 },
  { id: 'organ-perc-third', section: 'organ', group: 'percussion', label: 'B3 Percussion Harmonic Third', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 1 },
  { id: 'organ-perc-on', section: 'organ', group: 'percussion', label: 'B3 Percussion On', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  ...ORGAN_DRAWBAR_SPECS,

  // ===================== 3. PIANO (8.5%) =====================
  { id: 'piano-section-on', section: 'piano', group: 'header', label: 'Piano Section On', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 1 },
  { id: 'piano-layer-a-fader', section: 'piano', group: 'layers', label: 'Piano Layer A Level', kind: 'fader', min: 0, max: 100, step: 2, defaultValue: 92 },
  { id: 'piano-layer-b-fader', section: 'piano', group: 'layers', label: 'Piano Layer B Level', kind: 'fader', min: 0, max: 100, step: 2, defaultValue: 70 },
  { id: 'piano-layer-a-on', section: 'piano', group: 'layers', label: 'Piano Layer A On/Off', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 1 },
  { id: 'piano-layer-b-on', section: 'piano', group: 'layers', label: 'Piano Layer B On/Off', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'piano-sustped', section: 'piano', group: 'layers', label: 'Piano Sustain Pedal Enable', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 1 },
  { id: 'piano-pstick', section: 'piano', group: 'layers', label: 'Piano Pitch Stick Enable', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 1 },
  { id: 'piano-timbre', section: 'piano', group: 'timbre', label: 'Piano Timbre', kind: 'button', min: 0, max: 5, step: 1, defaultValue: 0, options: ['OFF', 'SOFT', 'MID', 'BRIGHT', 'DYNO1', 'DYNO2'] },
  { id: 'piano-octave-down', section: 'piano', group: 'layers', label: 'Piano Octave Shift Down', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'piano-octave-up', section: 'piano', group: 'layers', label: 'Piano Octave Shift Up', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'piano-acoustics', section: 'piano', group: 'detail', label: 'Piano Acoustics Soft Release String Resonance', kind: 'button', min: 0, max: 3, step: 1, defaultValue: 2, options: ['OFF', 'SOFT REL', 'STRING RES', 'BOTH'] },
  { id: 'piano-unison', section: 'piano', group: 'detail', label: 'Piano Unison', kind: 'button', min: 0, max: 3, step: 1, defaultValue: 0, options: ['OFF', '1', '2', '3'] },
  { id: 'piano-kb-touch', section: 'piano', group: 'detail', label: 'Piano KB Touch', kind: 'button', min: 0, max: 2, step: 1, defaultValue: 1, options: ['HEAVY', 'MED', 'LIGHT'] },
  { id: 'piano-dyn-comp', section: 'piano', group: 'detail', label: 'Piano Dynamic Compression', kind: 'button', min: 0, max: 3, step: 1, defaultValue: 0, options: ['OFF', '1', '2', '3'] },
  { id: 'piano-type-select', section: 'piano', group: 'select', label: 'Piano Type Select', kind: 'button', min: 0, max: 5, step: 1, defaultValue: 0, options: ['GRAND', 'UPRIGHT', 'ELECTRIC', 'CLAV', 'DIGITAL', 'MISC'] },
  { id: 'piano-model-dial', section: 'piano', group: 'select', label: 'Piano Model Dial', kind: 'encoder', min: 0, max: 100, step: 5, defaultValue: 0 },
  // ===================== 4. PROGRAM & MORPH (12.5%) =====================
  { id: 'program-morph-wheel', section: 'program', group: 'morph', label: 'Morph Assign Wheel', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 1 },
  { id: 'program-morph-at', section: 'program', group: 'morph', label: 'Morph Assign Aftertouch', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'program-morph-ctrlped', section: 'program', group: 'morph', label: 'Morph Assign Control Pedal', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'program-split', section: 'program', group: 'top', label: 'Split On/Set', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 1 },
  { id: 'program-mst-clk', section: 'program', group: 'top', label: 'Master Clock Tap/Set', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'program-transpose', section: 'program', group: 'top', label: 'Transpose / Panic', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'program-store', section: 'program', group: 'mid', label: 'Store Program', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'program-preset-organ', section: 'program', group: 'preset-lib', label: 'Preset Library Organ', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'program-preset-piano', section: 'program', group: 'preset-lib', label: 'Preset Library Piano', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'program-preset-synth', section: 'program', group: 'preset-lib', label: 'Preset Library Synth', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'program-prog-view', section: 'program', group: 'top', label: 'Program View', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'program-dial', section: 'program', group: 'nav', label: 'Program Dial', kind: 'encoder', min: 0, max: 100, step: 2, defaultValue: 50 },
  { id: 'program-page-prev', section: 'program', group: 'nav', label: 'Program Page Previous', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'program-page-next', section: 'program', group: 'nav', label: 'Program Page Next', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'program-solo', section: 'program', group: 'edit-rail', label: 'Solo / Undo', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'program-section-edit', section: 'program', group: 'edit-rail', label: 'Section Edit / Layer Init', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'program-mon-copy', section: 'program', group: 'edit-rail', label: 'Monitor / Copy / Paste', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'program-live-mode', section: 'program', group: 'mode', label: 'Live Mode', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'program-layer-scene', section: 'program', group: 'mode', label: 'Layer Scene II', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'program-btn-1', section: 'program', group: 'bank', label: 'Program 1 (System)', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 1 },
  { id: 'program-btn-2', section: 'program', group: 'bank', label: 'Program 2 (Sound)', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'program-btn-3', section: 'program', group: 'bank', label: 'Program 3 (Organize)', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'program-btn-4', section: 'program', group: 'bank', label: 'Program 4 (Aux KB)', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'program-btn-5', section: 'program', group: 'bank', label: 'Program 5 (Output)', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'program-btn-6', section: 'program', group: 'bank', label: 'Program 6 (Pedal)', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'program-btn-7', section: 'program', group: 'bank', label: 'Program 7 (MIDI)', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'program-btn-8', section: 'program', group: 'bank', label: 'Program 8 (Extern)', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'program-shift', section: 'program', group: 'shift', label: 'Shift / Exit', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },

  // ===================== 5. SYNTH (25%) =====================
  { id: 'synth-section-on', section: 'synth', group: 'header', label: 'Synth Section On', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 1 },
  { id: 'synth-layer-a-fader', section: 'synth', group: 'layers', label: 'Synth Layer A Level', kind: 'fader', min: 0, max: 100, step: 2, defaultValue: 90 },
  { id: 'synth-layer-b-fader', section: 'synth', group: 'layers', label: 'Synth Layer B Level', kind: 'fader', min: 0, max: 100, step: 2, defaultValue: 34 },
  { id: 'synth-layer-c-fader', section: 'synth', group: 'layers', label: 'Synth Layer C Level', kind: 'fader', min: 0, max: 100, step: 2, defaultValue: 74 },
  { id: 'synth-layer-a-on', section: 'synth', group: 'layers', label: 'Synth Layer A On/Off', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 1 },
  { id: 'synth-layer-b-on', section: 'synth', group: 'layers', label: 'Synth Layer B On/Off', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 1 },
  { id: 'synth-layer-c-on', section: 'synth', group: 'layers', label: 'Synth Layer C On/Off', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 1 },
  { id: 'synth-kb-hold', section: 'synth', group: 'layers', label: 'Synth KB Hold', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'synth-arp-run', section: 'synth', group: 'layers', label: 'Synth Arpeggiator Run', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'synth-octave-down', section: 'synth', group: 'layers', label: 'Synth Octave Shift Down', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'synth-octave-up', section: 'synth', group: 'layers', label: 'Synth Octave Shift Up', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'synth-enc-type', section: 'synth', group: 'osc-display', label: 'Synth Type Encoder', kind: 'encoder', min: 0, max: 100, step: 5, defaultValue: 25 },
  { id: 'synth-enc-cat', section: 'synth', group: 'osc-display', label: 'Synth Category Encoder', kind: 'encoder', min: 0, max: 100, step: 5, defaultValue: 40 },
  { id: 'synth-enc-wave', section: 'synth', group: 'osc-display', label: 'Synth Wave Encoder', kind: 'encoder', min: 0, max: 100, step: 5, defaultValue: 55 },
  { id: 'synth-mode', section: 'synth', group: 'mode', label: 'Synth Mode Samples Analog Extern', kind: 'button', min: 0, max: 2, step: 1, defaultValue: 1, options: ['SAMPLES', 'ANALOG', 'EXTERN'] },
  { id: 'synth-waveform-btn', section: 'synth', group: 'mode', label: 'Synth Waveform / Sound Init', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 1 },
  { id: 'synth-arp-rate', section: 'synth', group: 'arp', label: 'Arpeggiator Rate/Time', kind: 'knob', min: 0, max: 100, step: 2, defaultValue: 38 },
  { id: 'synth-arp-mode', section: 'synth', group: 'arp', label: 'Arpeggiator Mode Poly Arp Gate', kind: 'button', min: 0, max: 2, step: 1, defaultValue: 1, options: ['POLY', 'ARP', 'GATE'] },
  { id: 'synth-arp-range', section: 'synth', group: 'arp', label: 'Arpeggiator Range/Env', kind: 'knob', min: 0, max: 100, step: 5, defaultValue: 52 },
  { id: 'synth-arp-menu', section: 'synth', group: 'arp', label: 'Arpeggiator Menu/Group', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'synth-voice-mode', section: 'synth', group: 'voice', label: 'Synth Voice Mono Legato', kind: 'button', min: 0, max: 2, step: 1, defaultValue: 0, options: ['POLY', 'MONO', 'LEGATO'] },
  { id: 'synth-voice-glide', section: 'synth', group: 'voice', label: 'Synth Glide', kind: 'knob', min: 0, max: 100, step: 2, defaultValue: 74 },
  { id: 'synth-vibrato-mode', section: 'synth', group: 'vibrato', label: 'Synth Vibrato', kind: 'button', min: 0, max: 4, step: 1, defaultValue: 0, options: ['OFF', 'WHL', 'DLY', 'A.T.', 'PED'] },
  { id: 'synth-vibrato-menu', section: 'synth', group: 'vibrato', label: 'Synth Vibrato Menu', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'synth-lfo-wave', section: 'synth', group: 'lfo', label: 'LFO Waveform', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'synth-lfo-amt', section: 'synth', group: 'lfo', label: 'LFO Mod Amount', kind: 'knob', min: 0, max: 100, step: 2, defaultValue: 78 },
  { id: 'synth-lfo-rate', section: 'synth', group: 'lfo', label: 'LFO Rate/Time', kind: 'knob', min: 0, max: 100, step: 2, defaultValue: 26 },
  { id: 'synth-lfo-dest', section: 'synth', group: 'lfo', label: 'LFO Destination', kind: 'button', min: 0, max: 2, step: 1, defaultValue: 2, options: ['OSC PITCH', 'OSC CTRL', 'FILTER'] },
  { id: 'synth-osc-pitch', section: 'synth', group: 'oscillators', label: 'Oscillator Pitch/Smp', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'synth-osc-env', section: 'synth', group: 'oscillators', label: 'Oscillator Envelope', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'synth-osc-ctrl', section: 'synth', group: 'oscillators', label: 'Oscillator Control', kind: 'knob', min: 0, max: 100, step: 2, defaultValue: 30 },
  { id: 'synth-osc-env-amt', section: 'synth', group: 'oscillators', label: 'Oscillator Envelope Amount', kind: 'knob', min: 0, max: 100, step: 2, defaultValue: 62 },
  { id: 'synth-filter-type', section: 'synth', group: 'filter', label: 'Filter Type', kind: 'button', min: 0, max: 5, step: 1, defaultValue: 0, options: ['LP12', 'LP24', 'LPM', 'HP', 'BP', 'LP+HP'] },
  { id: 'synth-filter-env', section: 'synth', group: 'filter', label: 'Filter Envelope', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'synth-filter-env-amt', section: 'synth', group: 'filter', label: 'Filter Envelope Amount', kind: 'knob', min: 0, max: 100, step: 2, defaultValue: 48 },
  { id: 'synth-filter-freq', section: 'synth', group: 'filter', label: 'Filter Frequency', kind: 'knob', min: 0, max: 100, step: 2, defaultValue: 35 },
  { id: 'synth-filter-res', section: 'synth', group: 'filter', label: 'Filter Resonance', kind: 'knob', min: 0, max: 100, step: 2, defaultValue: 28 },
  { id: 'synth-filter-on', section: 'synth', group: 'filter', label: 'Filter On', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 1 },
  { id: 'synth-amp-env', section: 'synth', group: 'amp', label: 'Amp Envelope', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'synth-unison', section: 'synth', group: 'amp', label: 'Synth Unison', kind: 'button', min: 0, max: 3, step: 1, defaultValue: 1, options: ['OFF', '1', '2', '3'] },

  // ===================== 6. LAYER EFFECTS (20%) =====================
  { id: 'fx-section-on', section: 'effects', group: 'header', label: 'Layer Effects On', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 1 },
  { id: 'fx-focus-organ', section: 'effects', group: 'fx-focus', label: 'FX Focus Organ A/B', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'fx-focus-piano', section: 'effects', group: 'fx-focus', label: 'FX Focus Piano A/B', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 1 },
  { id: 'fx-focus-synth', section: 'effects', group: 'fx-focus', label: 'FX Focus Synth A/B/C', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'fx-shift', section: 'effects', group: 'fx-focus', label: 'Effects Shift / Exit', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },

  // Group 1: MOD 1, MOD 2, AMP SIM/EQ
  { id: 'fx-mod1-rate', section: 'effects', group: 'mod1', label: 'Mod 1 Rate/Sens', kind: 'knob', min: 0, max: 100, step: 2, defaultValue: 40 },
  { id: 'fx-mod1-amount', section: 'effects', group: 'mod1', label: 'Mod 1 Amount', kind: 'knob', min: 0, max: 100, step: 2, defaultValue: 64 },
  { id: 'fx-mod1-type', section: 'effects', group: 'mod1', label: 'Mod 1 Type', kind: 'button', min: 0, max: 5, step: 1, defaultValue: 0, options: ['A-PAN', 'TREM', 'RM', 'A-WAH', 'WAH', 'PUMP'] },
  { id: 'fx-mod1-on', section: 'effects', group: 'mod1', label: 'Mod 1 On', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },

  { id: 'fx-mod2-rate', section: 'effects', group: 'mod2', label: 'Mod 2 Rate', kind: 'knob', min: 0, max: 100, step: 2, defaultValue: 45 },
  { id: 'fx-mod2-amount', section: 'effects', group: 'mod2', label: 'Mod 2 Amount', kind: 'knob', min: 0, max: 100, step: 2, defaultValue: 55 },
  { id: 'fx-mod2-type', section: 'effects', group: 'mod2', label: 'Mod 2 Type', kind: 'button', min: 0, max: 5, step: 1, defaultValue: 0, options: ['CHOR', 'FLANG', 'PHAS', 'VIBE', 'ENS', 'SPIN'] },
  { id: 'fx-mod2-on', section: 'effects', group: 'mod2', label: 'Mod 2 On', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },

  { id: 'fx-amp-drive', section: 'effects', group: 'amp-eq', label: 'Amp Sim Drive', kind: 'knob', min: 0, max: 100, step: 2, defaultValue: 32 },
  { id: 'fx-amp-freq', section: 'effects', group: 'amp-eq', label: 'EQ Mid Frequency', kind: 'knob', min: 0, max: 100, step: 2, defaultValue: 50 },
  { id: 'fx-amp-type', section: 'effects', group: 'amp-eq', label: 'Amp Sim Type', kind: 'button', min: 0, max: 6, step: 1, defaultValue: 0, options: ['EQ ONLY', 'TWIN', 'JC', 'SMALL', 'LP24', 'HP24', 'TO ROTARY'] },
  { id: 'fx-amp-on', section: 'effects', group: 'amp-eq', label: 'Amp Sim EQ On', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'fx-eq-bass', section: 'effects', group: 'amp-eq', label: 'EQ Bass', kind: 'knob', min: 0, max: 100, step: 2, defaultValue: 50 },
  { id: 'fx-eq-mid', section: 'effects', group: 'amp-eq', label: 'EQ Mid', kind: 'knob', min: 0, max: 100, step: 2, defaultValue: 50 },
  { id: 'fx-eq-treble', section: 'effects', group: 'amp-eq', label: 'EQ Treble', kind: 'knob', min: 0, max: 100, step: 2, defaultValue: 50 },

  // Group 2: DELAY, COMP, REVERB
  { id: 'fx-delay-tempo', section: 'effects', group: 'delay', label: 'Delay Tempo', kind: 'knob', min: 0, max: 100, step: 2, defaultValue: 48 },
  { id: 'fx-delay-type', section: 'effects', group: 'delay', label: 'Delay Feedback Filter', kind: 'button', min: 0, max: 3, step: 1, defaultValue: 0, options: ['OFF', 'LP', 'HP', 'BP'] },
  { id: 'fx-delay-feedback', section: 'effects', group: 'delay', label: 'Delay Feedback', kind: 'knob', min: 0, max: 100, step: 2, defaultValue: 45 },
  { id: 'fx-delay-tap', section: 'effects', group: 'delay', label: 'Delay Tap Tempo', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'fx-delay-dry-wet', section: 'effects', group: 'delay', label: 'Delay Dry/Wet', kind: 'knob', min: 0, max: 100, step: 2, defaultValue: 34 },
  { id: 'fx-delay-pingpong', section: 'effects', group: 'delay', label: 'Delay Ping Pong', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'fx-delay-on', section: 'effects', group: 'delay', label: 'Delay On', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },

  { id: 'fx-comp-amount', section: 'effects', group: 'comp', label: 'Compressor Amount', kind: 'knob', min: 0, max: 100, step: 2, defaultValue: 36 },
  { id: 'fx-comp-fast', section: 'effects', group: 'comp', label: 'Compressor Fast Mode', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },
  { id: 'fx-comp-on', section: 'effects', group: 'comp', label: 'Compressor On', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 0 },

  { id: 'fx-reverb-tone', section: 'effects', group: 'reverb', label: 'Reverb Bright Dark', kind: 'button', min: 0, max: 2, step: 1, defaultValue: 0, options: ['NORMAL', 'BRIGHT', 'DARK'] },
  { id: 'fx-reverb-type', section: 'effects', group: 'reverb', label: 'Reverb Type', kind: 'button', min: 0, max: 5, step: 1, defaultValue: 1, options: ['ROOM', 'BOOTH', 'SPRING', 'STAGE', 'HALL', 'CATH'] },
  { id: 'fx-reverb-dry-wet', section: 'effects', group: 'reverb', label: 'Reverb Dry/Wet', kind: 'knob', min: 0, max: 100, step: 2, defaultValue: 10 },
  { id: 'fx-reverb-on', section: 'effects', group: 'reverb', label: 'Reverb On', kind: 'button', min: 0, max: 1, step: 1, defaultValue: 1 },
]

export const PANEL_CONTROL_BY_ID: Readonly<Record<string, PanelControlSpec>> = Object.fromEntries(
  PANEL_CONTROLS.map((c) => [c.id, c]),
)
