export type SectionId = 'performance' | 'organ' | 'piano' | 'program' | 'synth' | 'effects'
export type ControlKind = 'button' | 'knob' | 'fader' | 'drawbar' | 'encoder' | 'wheel'

export interface SectionSpec {
  id: SectionId
  label: string
  fraction: number
  hasOled?: boolean
}

export interface Control {
  id: string
  section: SectionId
  kind: ControlKind
  label: string
  initial: number
}

export type ControlState = Record<string, number>

export interface KeyModel {
  id: string
  note: string
  midi: number
  black: boolean
  index: number
  whiteIndex?: number
}

export const sections: SectionSpec[] = [
  { id: 'performance', label: 'Performance', fraction: 0.13 },
  { id: 'organ', label: 'Organ', fraction: 0.21 },
  { id: 'piano', label: 'Piano', fraction: 0.15 },
  { id: 'program', label: 'Program / Morph', fraction: 0.09, hasOled: true },
  { id: 'synth', label: 'Synth', fraction: 0.21, hasOled: true },
  { id: 'effects', label: 'Layer Effects', fraction: 0.21 },
]

const control = (section: SectionId, kind: ControlKind, id: string, label: string, initial = 0): Control => ({
  id: `${section}.${id}`,
  section,
  kind,
  label,
  initial,
})

export const decorativeControls: Control[] = [
  control('performance', 'knob', 'master-level', 'Master Level', 0.72),
  control('performance', 'wheel', 'pitch-stick', 'Pitch Stick', 0.5),
  control('performance', 'wheel', 'mod-wheel', 'Modulation Wheel', 0.12),
  control('performance', 'knob', 'organ-level', 'Organ Level', 0.55),
  control('performance', 'button', 'octave-down', 'Octave Down'),
  control('performance', 'button', 'octave-up', 'Octave Up'),
  control('performance', 'button', 'transpose', 'Transpose'),

  ...Array.from({ length: 9 }, (_, index) => control('organ', 'drawbar', `drawbar-${index + 1}`, `Organ drawbar ${index + 1}`, 1 - index * 0.08)),
  control('organ', 'fader', 'layer-a-level', 'Organ Layer A Level', 0.72),
  control('organ', 'fader', 'layer-b-level', 'Organ Layer B Level', 0.55),
  control('organ', 'button', 'b3-model', 'B3 Model', 1),
  control('organ', 'button', 'vox-model', 'Vox Model'),
  control('organ', 'button', 'farf-model', 'Farf Model'),
  control('organ', 'button', 'pipe-model', 'Pipe Model'),
  control('organ', 'button', 'percussion', 'Percussion'),
  control('organ', 'button', 'vibrato', 'Vibrato Chorus'),
  control('organ', 'button', 'rotary-speed', 'Rotary Speed'),
  control('organ', 'knob', 'key-click', 'Key Click', 0.45),
  control('organ', 'button', 'sustain-pedal', 'Sustain Pedal'),

  control('piano', 'fader', 'layer-a-level', 'Piano Layer A Level', 0.82),
  control('piano', 'fader', 'layer-b-level', 'Piano Layer B Level', 0.24),
  control('piano', 'button', 'section-on', 'Piano Section On', 1),
  control('piano', 'button', 'layer-a', 'Piano Layer A', 1),
  control('piano', 'button', 'layer-b', 'Piano Layer B'),
  control('piano', 'button', 'layer-a-focus', 'Piano Layer A Focus', 1),
  control('piano', 'button', 'layer-b-focus', 'Piano Layer B Focus'),
  control('piano', 'button', 'layer-a-octave-down', 'Piano A Octave Down'),
  control('piano', 'button', 'layer-a-octave-up', 'Piano A Octave Up'),
  control('piano', 'button', 'layer-b-octave-down', 'Piano B Octave Down'),
  control('piano', 'button', 'layer-b-octave-up', 'Piano B Octave Up'),
  control('piano', 'button', 'sustped-a', 'Piano A SUSTPED', 1),
  control('piano', 'button', 'sustped-b', 'Piano B SUSTPED', 1),
  control('piano', 'button', 'pstick-a', 'Piano A PSTICK', 1),
  control('piano', 'button', 'pstick-b', 'Piano B PSTICK', 1),
  control('piano', 'button', 'grand', 'Grand Type', 1),
  control('piano', 'button', 'upright', 'Upright Type'),
  control('piano', 'button', 'electric', 'Electric Type'),
  control('piano', 'button', 'clav', 'Clav Type'),
  control('piano', 'button', 'digital', 'Digital Type'),
  control('piano', 'button', 'misc', 'Misc Type'),
  control('piano', 'encoder', 'model-select', 'Piano Model Select', 0.36),
  control('piano', 'button', 'kb-touch', 'KB Touch'),
  control('piano', 'button', 'dyn-comp', 'Dyn Comp'),
  control('piano', 'button', 'timbre', 'Timbre'),
  control('piano', 'button', 'unison', 'Unison'),
  control('piano', 'button', 'soft-release', 'Soft Release'),
  control('piano', 'button', 'string-res', 'String Resonance'),

  control('program', 'encoder', 'program-dial', 'Program Dial', 0.42),
  ...Array.from({ length: 8 }, (_, index) => control('program', 'button', `program-${index + 1}`, `Program Button ${index + 1}`, index === 0 ? 1 : 0)),
  control('program', 'button', 'page-left', 'Page Left'),
  control('program', 'button', 'page-right', 'Page Right'),
  control('program', 'button', 'live-mode', 'Live Mode'),
  control('program', 'button', 'scene-1', 'Layer Scene I', 1),
  control('program', 'button', 'scene-2', 'Layer Scene II'),
  control('program', 'button', 'store', 'Store'),
  control('program', 'button', 'split', 'Split'),
  control('program', 'button', 'morph-wheel', 'Morph Wheel'),
  control('program', 'button', 'morph-pedal', 'Morph Control Pedal'),
  control('program', 'button', 'morph-aftertouch', 'Morph Aftertouch'),

  control('synth', 'fader', 'layer-a-level', 'Synth Layer A Level', 0.62),
  control('synth', 'fader', 'layer-b-level', 'Synth Layer B Level', 0.48),
  control('synth', 'button', 'layer-a', 'Synth Layer A', 1),
  control('synth', 'button', 'layer-b', 'Synth Layer B'),
  control('synth', 'button', 'sample', 'Sample Source', 1),
  control('synth', 'button', 'analog', 'Analog Source'),
  control('synth', 'button', 'wavetable', 'Wavetable Source'),
  control('synth', 'encoder', 'osc-select', 'Oscillator Select', 0.18),
  control('synth', 'knob', 'osc-control', 'Oscillator Control', 0.5),
  control('synth', 'knob', 'filter-cutoff', 'Filter Cutoff', 0.58),
  control('synth', 'knob', 'filter-resonance', 'Filter Resonance', 0.34),
  control('synth', 'button', 'filter-type', 'Filter Type'),
  control('synth', 'knob', 'attack', 'Attack', 0.16),
  control('synth', 'knob', 'decay', 'Decay', 0.48),
  control('synth', 'knob', 'sustain', 'Sustain', 0.66),
  control('synth', 'knob', 'release', 'Release', 0.38),
  control('synth', 'knob', 'lfo-rate', 'LFO Rate', 0.42),
  control('synth', 'knob', 'arp-rate', 'Arpeggiator Rate', 0.52),
  control('synth', 'button', 'arp-run', 'Arpeggiator Run'),
  control('synth', 'button', 'mono', 'Mono Mode'),

  control('effects', 'button', 'focus-organ', 'Organ FX Focus'),
  control('effects', 'button', 'focus-piano', 'Piano FX Focus', 1),
  control('effects', 'button', 'focus-synth', 'Synth FX Focus'),
  control('effects', 'button', 'all-on', 'Layer Effects On', 1),
  control('effects', 'button', 'piano-group', 'Piano FX Group'),
  control('effects', 'knob', 'mod1-rate', 'Mod 1 Rate', 0.42),
  control('effects', 'knob', 'mod1-amount', 'Mod 1 Amount', 0.38),
  control('effects', 'button', 'mod1-on', 'Mod 1 On'),
  control('effects', 'button', 'mod1-type', 'Mod 1 Type'),
  control('effects', 'knob', 'mod2-rate', 'Mod 2 Rate', 0.34),
  control('effects', 'knob', 'mod2-amount', 'Mod 2 Amount', 0.44),
  control('effects', 'button', 'mod2-on', 'Mod 2 On'),
  control('effects', 'button', 'mod2-type', 'Mod 2 Type'),
  control('effects', 'knob', 'delay-time', 'Delay Time', 0.46),
  control('effects', 'knob', 'delay-feedback', 'Delay Feedback', 0.31),
  control('effects', 'knob', 'delay-mix', 'Delay Mix', 0.2),
  control('effects', 'button', 'delay-on', 'Delay On'),
  control('effects', 'button', 'delay-tempo', 'Delay Tempo'),
  control('effects', 'button', 'delay-global', 'Delay Global'),
  control('effects', 'button', 'delay-filter', 'Delay Feedback Filter'),
  control('effects', 'knob', 'amp-drive', 'Amp Drive', 0.28),
  control('effects', 'button', 'amp-on', 'Amp Sim EQ On'),
  control('effects', 'button', 'amp-type', 'Amp Sim EQ Type'),
  control('effects', 'knob', 'eq-bass', 'EQ Bass', 0.5),
  control('effects', 'knob', 'eq-mid', 'EQ Mid', 0.47),
  control('effects', 'knob', 'eq-treble', 'EQ Treble', 0.58),
  control('effects', 'knob', 'compressor', 'Compressor Amount', 0.36),
  control('effects', 'button', 'compressor-on', 'Compressor On'),
  control('effects', 'button', 'compressor-global', 'Compressor Global'),
  control('effects', 'knob', 'reverb-amount', 'Reverb Amount', 0.41),
  control('effects', 'button', 'reverb-on', 'Reverb On'),
  control('effects', 'button', 'reverb-type', 'Reverb Type'),
  control('effects', 'button', 'reverb-global', 'Reverb Global'),
  control('effects', 'button', 'rotary', 'Rotary'),
  control('effects', 'button', 'rotary-fast', 'Rotary Fast'),
  control('effects', 'knob', 'rotary-drive', 'Rotary Drive', 0.32),
]

export function createControlState() {
  return Object.fromEntries(decorativeControls.map((entry) => [entry.id, entry.initial])) as ControlState
}

const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export function getMidiNote(note: string) {
  const match = /^([A-G]#?)(-?\d+)$/.exec(note)
  if (!match) throw new Error(`Invalid note name: ${note}`)
  const [, name, octaveText] = match
  return noteNames.indexOf(name) + (Number(octaveText) + 1) * 12
}

function noteName(midi: number) {
  const name = noteNames[midi % 12]
  const octave = Math.floor(midi / 12) - 1
  return `${name}${octave}`
}

export function isBlackKey(key: KeyModel) {
  return key.black
}

export const keyboard: KeyModel[] = (() => {
  const first = getMidiNote('E1')
  const last = getMidiNote('E7')
  let whiteIndex = -1
  return Array.from({ length: last - first + 1 }, (_, index) => {
    const midi = first + index
    const note = noteName(midi)
    const black = note.includes('#')
    if (!black) whiteIndex += 1
    return {
      id: `key-${note.replace('#', 's')}`,
      note,
      midi,
      black,
      index,
      whiteIndex: black ? whiteIndex : whiteIndex,
    }
  })
})()

export const whiteKeyCount = keyboard.filter((key) => !key.black).length
export const blackKeyCount = keyboard.filter((key) => key.black).length

const centerKeyIds = ['key-C3', 'key-D3', 'key-E3', 'key-F3', 'key-G3', 'key-A3', 'key-B3', 'key-C4', 'key-D4', 'key-E4', 'key-F4', 'key-G4', 'key-A4', 'key-B4', 'key-C5', 'key-D5', 'key-E5']
const computerKeys = ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j', 'k', 'o', 'l', 'p', ';']

export const computerKeyMap: Record<string, string> = Object.fromEntries([
  ...computerKeys.map((key, index) => [key, centerKeyIds[index]]),
  [' ', 'sustain'],
])
