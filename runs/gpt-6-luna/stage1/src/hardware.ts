export type SectionId = 'performance' | 'organ' | 'piano' | 'program' | 'synth' | 'effects'
export type ControlKind = 'button' | 'knob' | 'encoder' | 'fader' | 'drawbar' | 'wheel'

export interface SectionDefinition {
  id: SectionId
  label: string
  fraction: number
  panel: boolean
}

export interface ControlDefinition {
  id: string
  name: string
  legend: string
  section: SectionId
  group: string
  kind: ControlKind
  initial: number
  min: number
  max: number
  step: number
}

export interface KeyDefinition {
  id: string
  midi: number
  note: string
  pitchClass: number
  octave: number
  color: 'white' | 'black'
  whiteIndex: number
  blackKeyOffset?: number
}

export const SECTIONS: SectionDefinition[] = [
  { id: 'performance', label: 'Performance', fraction: 0.14, panel: false },
  { id: 'organ', label: 'Organ', fraction: 0.2, panel: true },
  { id: 'piano', label: 'Piano', fraction: 0.085, panel: true },
  { id: 'program', label: 'Program / Morph', fraction: 0.125, panel: false },
  { id: 'synth', label: 'Synth', fraction: 0.25, panel: true },
  { id: 'effects', label: 'Layer Effects', fraction: 0.2, panel: true },
]

const WHITE_PITCH_CLASSES = new Set([0, 2, 4, 5, 7, 9, 11])
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

function makeKeyModel(): KeyDefinition[] {
  const keys: KeyDefinition[] = []
  let whiteIndex = 0
  for (let midi = 40; midi <= 112; midi += 1) {
    const pitchClass = midi % 12
    const octave = Math.floor(midi / 12) - 1
    const color = WHITE_PITCH_CLASSES.has(pitchClass) ? 'white' : 'black'
    const key: KeyDefinition = {
      id: `key-${NOTE_NAMES[pitchClass].replace('♯', 's').toLowerCase()}${octave}`,
      midi,
      note: `${NOTE_NAMES[pitchClass]}${octave}`,
      pitchClass,
      octave,
      color,
      whiteIndex,
    }
    if (color === 'white') whiteIndex += 1
    else key.blackKeyOffset = whiteIndex - 0.5
    keys.push(key)
  }
  return keys
}

export const KEY_MODEL = makeKeyModel()
export const WHITE_KEY_COUNT = KEY_MODEL.filter((key) => key.color === 'white').length
export const BLACK_KEY_COUNT = KEY_MODEL.filter((key) => key.color === 'black').length

const button = (section: SectionId, group: string, id: string, name: string, legend = name, initial = 0): ControlDefinition => ({
  id: `${section}-${id}`,
  name,
  legend,
  section,
  group,
  kind: 'button',
  initial,
  min: 0,
  max: 1,
  step: 1,
})

const rotary = (section: SectionId, group: string, id: string, name: string, kind: ControlKind = 'knob', initial = 48): ControlDefinition => ({
  id: `${section}-${id}`,
  name,
  legend: name,
  section,
  group,
  kind,
  initial,
  min: 0,
  max: 100,
  step: 1,
})

const organDrawbars: ControlDefinition[] = Array.from({ length: 9 }, (_, index) => rotary(
  'organ', 'Drawbars', `drawbar-${index + 1}`, `Organ drawbar ${index + 1}`, 'drawbar', [75, 46, 64, 31, 72, 38, 61, 42, 68][index] ?? 50,
))

export const HARDWARE_CONTROLS: ControlDefinition[] = [
  rotary('performance', 'Master', 'master-level', 'Master Level', 'knob', 72),
  rotary('performance', 'Rotary speaker', 'rotary-speed', 'Rotary Speaker Speed', 'knob', 35),
  button('performance', 'Rotary speaker', 'rotary-stop', 'Rotary Speaker Stop', 'STOP'),
  button('performance', 'Rotary speaker', 'rotary-fast', 'Rotary Speaker Fast', 'FAST'),
  rotary('performance', 'Performance', 'pitch-stick', 'Pitch Stick', 'wheel', 50),
  rotary('performance', 'Performance', 'modulation-wheel', 'Modulation Wheel', 'wheel', 50),
  ...organDrawbars,
  button('organ', 'Organ model', 'section-on', 'Organ Section On', 'ON'),
  button('organ', 'Organ model', 'model-b3', 'B3 Organ Model', 'B3', 1),
  button('organ', 'Organ model', 'model-vox', 'Vox Organ Model', 'VOX'),
  button('organ', 'Organ model', 'model-farfisa', 'Farfisa Organ Model', 'FARF'),
  rotary('organ', 'Organ model', 'organ-level', 'Organ Level', 'fader', 74),
  button('organ', 'Percussion', 'percussion-on', 'Percussion On', 'PERC'),
  button('organ', 'Percussion', 'percussion-soft', 'Percussion Soft', 'SOFT'),
  button('organ', 'Percussion', 'percussion-third', 'Percussion Third', '3RD'),
  button('organ', 'Percussion', 'percussion-fast', 'Percussion Fast Decay', 'FAST'),
  button('organ', 'Vibrato', 'vibrato-on', 'Vibrato Chorus On', 'V/C'),
  button('organ', 'Vibrato', 'vibrato-mode', 'Vibrato Chorus Mode', 'C1'),
  button('piano', 'Piano layers', 'section-on', 'Piano Section On', 'ON', 1),
  button('piano', 'Piano layers', 'layer-a', 'Layer A Enabled', 'A', 1),
  button('piano', 'Piano layers', 'layer-b', 'Layer B Enabled', 'B'),
  rotary('piano', 'Piano layers', 'layer-a-level', 'Layer A Level', 'fader', 72),
  rotary('piano', 'Piano layers', 'layer-b-level', 'Layer B Level', 'fader', 48),
  ...(['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'] as const).map((type, index) => button('piano', 'Piano type', `type-${type.toLowerCase()}`, `Piano Type ${type}`, type.slice(0, 4).toUpperCase(), index === 0 ? 1 : 0)),
  rotary('piano', 'Piano model', 'model-selector', 'Piano Model Selector', 'encoder', 24),
  button('piano', 'Piano detail', 'kb-touch', 'Keyboard Touch', 'KB TCH'),
  button('piano', 'Piano detail', 'timbre', 'Piano Timbre', 'TIMBRE'),
  button('piano', 'Piano detail', 'unison', 'Piano Unison', 'UNISON'),
  button('piano', 'Piano detail', 'soft-release', 'Soft Release', 'SOFT REL'),
  button('piano', 'Piano detail', 'string-res', 'String Resonance', 'STR RES'),
  button('piano', 'Piano detail', 'sustain-pedal', 'Piano Sustain Pedal', 'SUST'),
  button('piano', 'Piano detail', 'pitch-stick-enable', 'Piano Pitch Stick', 'PSTICK'),
  rotary('program', 'Program', 'program-dial', 'Program Dial', 'encoder', 41),
  ...Array.from({ length: 8 }, (_, index) => button('program', 'Program buttons', `program-${index + 1}`, `Program Button ${index + 1}`, String(index + 1), index === 0 ? 1 : 0)),
  button('program', 'Navigation', 'page-up', 'Program Page Up', '▲'),
  button('program', 'Navigation', 'page-down', 'Program Page Down', '▼'),
  button('program', 'Modes', 'live-mode', 'Live Mode', 'LIVE'),
  button('program', 'Modes', 'layer-scene', 'Layer Scene', 'SCENE'),
  button('program', 'Store and split', 'store', 'Store', 'STORE'),
  button('program', 'Store and split', 'split', 'Split', 'SPLIT'),
  button('program', 'Morph assign', 'morph-wheel', 'Morph Wheel Assign', 'WHEEL'),
  button('program', 'Morph assign', 'morph-aftertouch', 'Morph Aftertouch Assign', 'A.T.'),
  button('program', 'Morph assign', 'morph-control', 'Morph Control Assign', 'CTRL'),
  button('synth', 'Synth layers', 'layer-a', 'Synth Layer A Enabled', 'A', 1),
  button('synth', 'Synth layers', 'layer-b', 'Synth Layer B Enabled', 'B'),
  rotary('synth', 'Synth layers', 'layer-a-level', 'Synth Layer A Level', 'fader', 68),
  rotary('synth', 'Synth layers', 'layer-b-level', 'Synth Layer B Level', 'fader', 47),
  rotary('synth', 'Oscillator', 'oscillator-shape', 'Oscillator Shape', 'encoder', 25),
  rotary('synth', 'Oscillator', 'oscillator-wave', 'Oscillator Wave', 'encoder', 54),
  rotary('synth', 'Oscillator', 'oscillator-pitch', 'Oscillator Pitch'),
  rotary('synth', 'Oscillator', 'oscillator-fine', 'Oscillator Fine Tune'),
  rotary('synth', 'Oscillator', 'oscillator-sub', 'Sub Oscillator Level'),
  rotary('synth', 'Oscillator', 'oscillator-noise', 'Noise Level'),
  rotary('synth', 'Filter', 'filter-cutoff', 'Filter Cutoff', 'knob', 68),
  rotary('synth', 'Filter', 'filter-resonance', 'Filter Resonance', 'knob', 25),
  rotary('synth', 'Filter', 'filter-drive', 'Filter Drive', 'knob', 12),
  rotary('synth', 'Filter', 'filter-envelope', 'Filter Envelope Amount'),
  rotary('synth', 'Amp Envelope', 'amp-attack', 'Amp Envelope Attack', 'knob', 9),
  rotary('synth', 'Amp Envelope', 'amp-decay', 'Amp Envelope Decay', 'knob', 44),
  rotary('synth', 'Amp Envelope', 'amp-sustain', 'Amp Envelope Sustain', 'knob', 67),
  rotary('synth', 'Amp Envelope', 'amp-release', 'Amp Envelope Release', 'knob', 27),
  rotary('synth', 'Mod Envelope', 'mod-attack', 'Modulation Envelope Attack', 'knob', 8),
  rotary('synth', 'Mod Envelope', 'mod-decay', 'Modulation Envelope Decay', 'knob', 44),
  rotary('synth', 'Mod Envelope', 'mod-sustain', 'Modulation Envelope Sustain', 'knob', 30),
  rotary('synth', 'LFO and Arpeggiator', 'lfo-rate', 'LFO Rate', 'knob', 31),
  rotary('synth', 'LFO and Arpeggiator', 'lfo-amount', 'LFO Amount', 'knob', 25),
  rotary('synth', 'LFO and Arpeggiator', 'arp-rate', 'Arpeggiator Rate', 'knob', 52),
  button('synth', 'LFO and Arpeggiator', 'arp-on', 'Arpeggiator On', 'ARP'),
  rotary('effects', 'Effect 1', 'effect-1-rate', 'Effect 1 Rate', 'knob', 38),
  rotary('effects', 'Effect 1', 'effect-1-depth', 'Effect 1 Depth', 'knob', 44),
  button('effects', 'Effect 1', 'effect-1-on', 'Effect 1 On', 'ON'),
  rotary('effects', 'Effect 2', 'effect-2-rate', 'Effect 2 Rate', 'knob', 31),
  rotary('effects', 'Effect 2', 'effect-2-depth', 'Effect 2 Depth', 'knob', 41),
  button('effects', 'Effect 2', 'effect-2-on', 'Effect 2 On', 'ON'),
  rotary('effects', 'Amp Simulator and EQ', 'amp-drive', 'Amp Simulator Drive', 'knob', 22),
  rotary('effects', 'Amp Simulator and EQ', 'eq-treble', 'Equalizer Treble', 'knob', 51),
  rotary('effects', 'Amp Simulator and EQ', 'eq-bass', 'Equalizer Bass', 'knob', 48),
  rotary('effects', 'Delay', 'delay-time', 'Delay Time', 'knob', 40),
  rotary('effects', 'Delay', 'delay-feedback', 'Delay Feedback', 'knob', 38),
  button('effects', 'Delay', 'delay-on', 'Delay On', 'ON'),
  rotary('effects', 'Compressor', 'compressor-amount', 'Compressor Amount', 'knob', 37),
  button('effects', 'Compressor', 'compressor-on', 'Compressor On', 'ON'),
  rotary('effects', 'Reverb', 'reverb-depth', 'Reverb Depth', 'knob', 45),
  rotary('effects', 'Reverb', 'reverb-time', 'Reverb Time', 'knob', 58),
  button('effects', 'Reverb', 'reverb-on', 'Reverb On', 'ON'),
  button('effects', 'Layer focus', 'focus-a', 'Effects Layer Focus A', 'A', 1),
  button('effects', 'Layer focus', 'focus-b', 'Effects Layer Focus B', 'B'),
]

export const INITIAL_HARDWARE_STATE: Record<string, number> = Object.fromEntries(
  HARDWARE_CONTROLS.map((control) => [control.id, control.initial]),
)

export const CONTROL_GROUPS = (section: SectionId): string[] => [...new Set(
  HARDWARE_CONTROLS.filter((control) => control.section === section).map((control) => control.group),
)]

export const COMPUTER_KEY_MAP: Record<string, number> = {
  KeyA: 52, KeyW: 53, KeyS: 54, KeyE: 55, KeyD: 56, KeyF: 57,
  KeyT: 58, KeyG: 59, KeyH: 60, KeyU: 61, KeyJ: 62, KeyI: 63,
  KeyK: 64, KeyO: 65, KeyL: 66, KeyP: 67, Semicolon: 68,
  Quote: 69, BracketLeft: 70, BracketRight: 71, Backslash: 72,
}
