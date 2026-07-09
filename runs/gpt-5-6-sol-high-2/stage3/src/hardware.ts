export type SectionId = 'performance' | 'organ' | 'piano' | 'program' | 'synth' | 'effects'
export type ControlKind = 'button' | 'knob' | 'encoder' | 'fader' | 'drawbar' | 'wheel'

export interface HardwareControl {
  id: string
  label: string
  kind: ControlKind
  section: SectionId
  initial: number
  min: number
  max: number
  step: number
}

export interface KeyDefinition {
  id: string
  midi: number
  note: string
  octave: number
  black: boolean
  whiteIndex: number
  blackOffset?: number
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] as const

export const KEYS: KeyDefinition[] = Array.from({ length: 73 }, (_, index) => {
  const midi = 28 + index
  const pitch = midi % 12
  const note = NOTE_NAMES[pitch]
  const black = note.includes('♯')
  const octave = Math.floor(midi / 12) - 1
  const prior = Array.from({ length: index }, (__, priorIndex) => NOTE_NAMES[(28 + priorIndex) % 12])
  const whiteIndex = prior.filter((name) => !name.includes('♯')).length
  return {
    id: `key-${midi}`,
    midi,
    note,
    octave,
    black,
    whiteIndex,
    blackOffset: black ? whiteIndex - 0.34 : undefined,
  }
})

const control = (
  section: SectionId,
  id: string,
  label: string,
  kind: ControlKind,
  initial = kind === 'button' ? 0 : 50,
  min = 0,
  max = kind === 'button' ? 1 : 100,
  step = kind === 'button' ? 1 : 1,
): HardwareControl => ({ section, id: `${section}-${id}`, label, kind, initial, min, max, step })

export const PERFORMANCE_CONTROLS = [
  control('performance', 'master-level', 'Master level', 'knob', 72),
  control('performance', 'pitch-stick', 'Pitch stick', 'wheel', 50),
  control('performance', 'mod-wheel', 'Modulation wheel', 'wheel', 0),
  control('performance', 'monitor-level', 'Monitor level', 'knob', 55),
  control('performance', 'panel-lock', 'Panel lock', 'button'),
]

export const ORGAN_DRAWBARS = ['16′', '5⅓′', '8′', '4′', '2⅔′', '2′', '1⅗′', '1⅓′', '1′'].map((label, index) =>
  control('organ', `drawbar-${index + 1}`, `Organ drawbar ${label}`, 'drawbar', index < 3 ? 82 : 35),
)

export const ORGAN_CONTROLS = [
  control('organ', 'layer-a', 'Organ layer A', 'button', 1), control('organ', 'layer-b', 'Organ layer B', 'button'),
  control('organ', 'level-a', 'Organ layer A level', 'fader', 74), control('organ', 'level-b', 'Organ layer B level', 'fader', 64),
  control('organ', 'model-b3', 'B3 organ model', 'button', 1), control('organ', 'model-vox', 'Vox organ model', 'button'),
  control('organ', 'model-farf', 'Farfisa organ model', 'button'), control('organ', 'model-pipe', 'Pipe organ model', 'button'),
  control('organ', 'percussion', 'Organ percussion', 'button'), control('organ', 'percussion-soft', 'Percussion soft', 'button'),
  control('organ', 'percussion-fast', 'Percussion fast', 'button'), control('organ', 'percussion-third', 'Percussion third harmonic', 'button'),
  control('organ', 'vibrato', 'Organ vibrato chorus', 'button'), control('organ', 'vibrato-type', 'Organ vibrato type', 'encoder', 30),
  control('organ', 'rotary-speed', 'Rotary speed', 'button'), control('organ', 'rotary-drive', 'Rotary drive', 'knob', 38),
  control('organ', 'sustped', 'Organ sustain pedal routing', 'button'), control('organ', 'pstick', 'Organ pitch stick routing', 'button'),
  control('organ', 'key-click', 'Organ key click', 'button', 1), control('organ', 'octave-down', 'Organ octave down', 'button'),
  control('organ', 'octave-up', 'Organ octave up', 'button'), control('organ', 'section-on', 'Organ section on', 'button', 1),
  control('organ', 'rotary-route', 'Organ rotary routing', 'button', 1), control('organ', 'rotary-stop', 'Rotary stop', 'button'),
]

export const PIANO_CONTROLS = [
  control('piano', 'layer-a', 'Piano layer A', 'button', 1), control('piano', 'layer-b', 'Piano layer B', 'button'),
  control('piano', 'level-a', 'Piano layer A level', 'fader', 78), control('piano', 'level-b', 'Piano layer B level', 'fader', 60),
  control('piano', 'type-grand', 'Grand piano type', 'button', 1), control('piano', 'type-upright', 'Upright piano type', 'button'),
  control('piano', 'type-electric', 'Electric piano type', 'button'), control('piano', 'type-clav', 'Clav piano type', 'button'),
  control('piano', 'type-digital', 'Digital piano type', 'button'), control('piano', 'type-misc', 'Miscellaneous piano type', 'button'),
  control('piano', 'model', 'Piano model selector', 'encoder', 48), control('piano', 'timbre', 'Piano timbre', 'button'),
  control('piano', 'kb-touch', 'Keyboard touch', 'button'), control('piano', 'dyn-comp', 'Dynamic compression', 'button'),
  control('piano', 'unison', 'Piano unison', 'button'), control('piano', 'soft-release', 'Soft release', 'button'),
  control('piano', 'string-res', 'String resonance', 'button'), control('piano', 'sustped', 'Piano sustain pedal routing', 'button', 1),
  control('piano', 'pstick', 'Piano pitch stick routing', 'button'), control('piano', 'octave-down', 'Piano octave down', 'button'),
  control('piano', 'octave-up', 'Piano octave up', 'button'), control('piano', 'section-on', 'Piano section on', 'button', 1),
]

export const PROGRAM_CONTROLS = [
  control('program', 'value-dial', 'Program value dial', 'encoder', 42),
  ...Array.from({ length: 8 }, (_, index) => control('program', `program-${index + 1}`, `Program button ${index + 1}`, 'button', index === 0 ? 1 : 0)),
  control('program', 'page-left', 'Previous program page', 'button'), control('program', 'page-right', 'Next program page', 'button'),
  control('program', 'live-mode', 'Live mode', 'button'), control('program', 'scene-i', 'Layer scene one', 'button', 1),
  control('program', 'scene-ii', 'Layer scene two', 'button'), control('program', 'store', 'Store program', 'button'),
  control('program', 'split', 'Keyboard split', 'button'), control('program', 'shift', 'Shift', 'button'),
  control('program', 'morph-wheel', 'Wheel morph assign', 'button'), control('program', 'morph-control', 'Control pedal morph assign', 'button'),
  control('program', 'morph-aftertouch', 'Aftertouch morph assign', 'button'), control('program', 'transpose', 'Transpose', 'button'),
  control('program', 'store-as', 'Store As', 'button'), control('program', 'list-view', 'Numeric program list view', 'button'),
  control('program', 'master-clock', 'Master clock', 'encoder', 30), control('program', 'clock-tap', 'Master clock tap', 'button'),
  control('program', 'split-low', 'Low split point', 'button'), control('program', 'split-mid', 'Mid split point', 'button', 1),
  control('program', 'split-high', 'High split point', 'button'), control('program', 'split-crossfade', 'Split crossfade width', 'button'),
  control('program', 'zone-range', 'Focused layer keyboard zone', 'button'), control('program', 'control-pedal', 'Control pedal', 'fader'),
  control('program', 'panic', 'Panic all notes off', 'button'), control('program', 'keyboard-sync', 'Master clock keyboard sync', 'button'),
]

export const SYNTH_CONTROLS = [
  control('synth', 'layer-a', 'Synth layer A', 'button', 1), control('synth', 'layer-b', 'Synth layer B', 'button'), control('synth', 'layer-c', 'Synth layer C', 'button'),
  control('synth', 'level-a', 'Synth layer A level', 'fader', 72), control('synth', 'level-b', 'Synth layer B level', 'fader', 55), control('synth', 'level-c', 'Synth layer C level', 'fader', 44),
  control('synth', 'osc-category', 'Oscillator category', 'encoder', 25), control('synth', 'osc-control', 'Oscillator control', 'knob', 54),
  control('synth', 'osc-wave', 'Oscillator waveform', 'encoder', 35), control('synth', 'pitch', 'Oscillator pitch', 'knob', 50),
  control('synth', 'shape', 'Oscillator shape', 'knob', 48), control('synth', 'unison', 'Synth unison', 'button'),
  control('synth', 'filter-frequency', 'Filter frequency', 'knob', 66), control('synth', 'filter-resonance', 'Filter resonance', 'knob', 30),
  control('synth', 'filter-drive', 'Filter drive', 'knob', 20), control('synth', 'filter-type', 'Filter type', 'button'),
  control('synth', 'filter-tracking', 'Filter keyboard tracking', 'button'), control('synth', 'lfo-rate', 'LFO rate', 'knob', 38),
  control('synth', 'lfo-amount', 'LFO amount', 'knob', 18), control('synth', 'lfo-wave', 'LFO waveform', 'button'),
  control('synth', 'amp-attack', 'Amplifier envelope attack', 'knob', 8), control('synth', 'amp-decay', 'Amplifier envelope decay', 'knob', 45),
  control('synth', 'amp-sustain', 'Amplifier envelope sustain', 'knob', 76), control('synth', 'amp-release', 'Amplifier envelope release', 'knob', 36),
  control('synth', 'mod-attack', 'Modulation envelope attack', 'knob', 12), control('synth', 'mod-decay', 'Modulation envelope decay', 'knob', 50),
  control('synth', 'mod-amount', 'Modulation envelope amount', 'knob', 52), control('synth', 'arp-run', 'Arpeggiator run', 'button'),
  control('synth', 'arp-rate', 'Arpeggiator rate', 'knob', 42), control('synth', 'arp-range', 'Arpeggiator range', 'button'),
  control('synth', 'voice-mode', 'Synth voice mode', 'button'), control('synth', 'glide', 'Synth glide', 'knob', 8),
  control('synth', 'filter-env-attack', 'Filter envelope attack', 'knob', 8), control('synth', 'filter-env-decay', 'Filter envelope decay', 'knob', 48),
  control('synth', 'filter-env-release', 'Filter envelope release', 'knob', 32), control('synth', 'filter-env-velocity', 'Filter envelope velocity', 'button'),
  control('synth', 'osc-env-attack', 'Oscillator envelope attack', 'knob', 8), control('synth', 'osc-env-decay', 'Oscillator envelope decay', 'knob', 48),
  control('synth', 'osc-env-release', 'Oscillator envelope release', 'knob', 32), control('synth', 'osc-env-velocity', 'Oscillator envelope velocity', 'button'),
  control('synth', 'amp-env-velocity', 'Amplifier envelope velocity', 'button'), control('synth', 'lfo-destination', 'LFO destination', 'button'),
  control('synth', 'lfo-sync', 'LFO master clock sync', 'button'), control('synth', 'voice-priority', 'Synth note priority', 'button'),
  control('synth', 'vibrato-mode', 'Synth vibrato mode', 'button'), control('synth', 'vibrato-rate', 'Synth vibrato rate', 'knob', 40),
  control('synth', 'vibrato-amount', 'Synth vibrato amount', 'knob', 18), control('synth', 'arp-mode', 'Arpeggiator mode', 'button'),
  control('synth', 'arp-sync', 'Arpeggiator master clock sync', 'button'), control('synth', 'arp-direction', 'Arpeggiator direction', 'button'),
  control('synth', 'arp-hold', 'Arpeggiator keyboard hold', 'button'), control('synth', 'section-on', 'Synth section on', 'button', 1),
  control('synth', 'sustped', 'Synth sustain pedal routing', 'button', 1), control('synth', 'pstick', 'Synth pitch stick routing', 'button', 1),
  control('synth', 'octave-down', 'Synth octave down', 'button'), control('synth', 'octave-up', 'Synth octave up', 'button'),
  control('synth', 'fine', 'Oscillator fine tune', 'knob', 50), control('synth', 'filter-env-amount', 'Filter envelope amount', 'knob', 55),
]

export const EFFECTS_CONTROLS = [
  control('effects', 'focus-organ', 'Effects focus Organ', 'button'), control('effects', 'focus-piano', 'Effects focus Piano', 'button', 1), control('effects', 'focus-synth', 'Effects focus Synth', 'button'),
  control('effects', 'focus-a', 'Effects focus Piano A', 'button', 1), control('effects', 'focus-b', 'Effects focus Piano B', 'button'), control('effects', 'piano-group', 'Piano effects group mode', 'button'),
  control('effects', 'focus-c', 'Effects focus Synth C', 'button'), control('effects', 'synth-group', 'Synth effects group mode', 'button'),
  control('effects', 'mod1-on', 'Modulation effect one on', 'button'), control('effects', 'mod1-sync', 'Modulation effect one master clock sync', 'button'), control('effects', 'mod1-type', 'Modulation effect one type', 'button'), control('effects', 'mod1-rate', 'Modulation effect one rate', 'knob', 38), control('effects', 'mod1-amount', 'Modulation effect one amount', 'knob', 45),
  control('effects', 'mod2-on', 'Modulation effect two on', 'button'), control('effects', 'mod2-type', 'Modulation effect two type', 'button'), control('effects', 'mod2-rate', 'Modulation effect two rate', 'knob', 52), control('effects', 'mod2-amount', 'Modulation effect two amount', 'knob', 34),
  control('effects', 'amp-on', 'Amp simulator and EQ on', 'button'), control('effects', 'amp-model', 'Amp simulator model', 'button'), control('effects', 'amp-drive', 'Amp simulator drive', 'knob', 22),
  control('effects', 'eq-bass', 'Equalizer bass', 'knob', 50), control('effects', 'eq-mid', 'Equalizer mid', 'knob', 50), control('effects', 'eq-mid-freq', 'Equalizer mid frequency', 'knob', 50), control('effects', 'eq-treble', 'Equalizer treble', 'knob', 50),
  control('effects', 'delay-on', 'Delay on', 'button'), control('effects', 'delay-global', 'Delay global mode', 'button'), control('effects', 'delay-sync', 'Delay master clock sync', 'button'), control('effects', 'delay-tap', 'Delay tap tempo', 'button'), control('effects', 'delay-tempo', 'Delay tempo', 'knob', 45), control('effects', 'delay-feedback', 'Delay feedback', 'knob', 28), control('effects', 'delay-mix', 'Delay mix', 'knob', 20), control('effects', 'delay-filter', 'Delay feedback filter', 'button'),
  control('effects', 'compressor-on', 'Compressor on', 'button'), control('effects', 'compressor-global', 'Compressor global mode', 'button'), control('effects', 'compressor-fast', 'Compressor fast mode', 'button'), control('effects', 'compressor-amount', 'Compressor amount', 'knob', 32),
  control('effects', 'reverb-on', 'Reverb on', 'button'), control('effects', 'reverb-global', 'Reverb global mode', 'button'), control('effects', 'reverb-type', 'Reverb type', 'button'), control('effects', 'reverb-bright', 'Reverb brightness', 'knob', 55), control('effects', 'reverb-mix', 'Reverb mix', 'knob', 27),
  control('effects', 'rotary-on', 'Shared rotary on', 'button', 1), control('effects', 'rotary-speed', 'Shared rotary speed', 'button'), control('effects', 'rotary-drive', 'Shared rotary drive', 'knob', 25), control('effects', 'all-bypass', 'All effects bypass', 'button'),
]

export const ALL_CONTROLS = [
  ...PERFORMANCE_CONTROLS, ...ORGAN_DRAWBARS, ...ORGAN_CONTROLS, ...PIANO_CONTROLS,
  ...PROGRAM_CONTROLS, ...SYNTH_CONTROLS, ...EFFECTS_CONTROLS,
]

export type HardwareState = Record<string, number>

export const INITIAL_HARDWARE_STATE: HardwareState = Object.fromEntries(ALL_CONTROLS.map((item) => [item.id, item.initial]))

export const SECTION_WIDTHS: Record<SectionId, number> = {
  performance: 14, organ: 20, piano: 8.5, program: 12.5, synth: 25, effects: 20,
}
