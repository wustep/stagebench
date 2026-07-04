export type SectionId = 'performance' | 'organ' | 'piano' | 'program' | 'synth' | 'effects'

export type ControlType = 'button' | 'knob' | 'encoder' | 'fader' | 'drawbar' | 'wheel' | 'stick'

export interface SectionSpec {
  id: SectionId
  label: string
  fraction: number
}

export interface HardwareControl {
  id: string
  section: SectionId
  type: ControlType
  label: string
  x: number
  y: number
  group?: string
}

export interface KeySpec {
  id: string
  midi: number
  note: string
  octave: number
  color: 'white' | 'black'
  whiteIndex: number
  blackIndex: number | null
  x: number
  width: number
  keyboardKey?: string
}

export const VARIANT = {
  id: 'stage-4-73',
  name: 'Nord Stage 4 73',
  keyAction: 'hammer action',
  totalKeys: 73,
  whiteKeys: 43,
  blackKeys: 30,
  range: 'E1 to E7',
  aspectRatio: 3.0951,
  deckFraction: 0.54,
  keybedFraction: 0.46,
}

export const SECTIONS: SectionSpec[] = [
  { id: 'performance', label: 'Performance controls', fraction: 0.13 },
  { id: 'organ', label: 'Organ', fraction: 0.21 },
  { id: 'piano', label: 'Piano', fraction: 0.15 },
  { id: 'program', label: 'Program and morph', fraction: 0.09 },
  { id: 'synth', label: 'Synth', fraction: 0.21 },
  { id: 'effects', label: 'Layer effects', fraction: 0.21 },
]

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const BLACK_NOTES = new Set(['C#', 'D#', 'F#', 'G#', 'A#'])
const KEYBOARD_KEYS = ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j', 'k', 'o', 'l', 'p', ';', "'", 'z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/']

function noteName(midi: number) {
  const name = NOTE_NAMES[midi % 12]
  const octave = Math.floor(midi / 12) - 1
  return { name, octave }
}

export function generateKeybed(): KeySpec[] {
  const keys: KeySpec[] = []
  let whiteIndex = -1
  let blackIndex = -1
  const startMidi = 28
  for (let offset = 0; offset < VARIANT.totalKeys; offset += 1) {
    const midi = startMidi + offset
    const { name, octave } = noteName(midi)
    const color = BLACK_NOTES.has(name) ? 'black' : 'white'
    if (color === 'white') {
      whiteIndex += 1
      keys.push({
        id: `key-${name.replace('#', 'sharp')}${octave}`,
        midi,
        note: `${name}${octave}`,
        octave,
        color,
        whiteIndex,
        blackIndex: null,
        x: whiteIndex / VARIANT.whiteKeys,
        width: 1 / VARIANT.whiteKeys,
        keyboardKey: KEYBOARD_KEYS[offset] ?? undefined,
      })
    } else {
      blackIndex += 1
      keys.push({
        id: `key-${name.replace('#', 'sharp')}${octave}`,
        midi,
        note: `${name}${octave}`,
        octave,
        color,
        whiteIndex,
        blackIndex,
        x: (whiteIndex + 0.68) / VARIANT.whiteKeys,
        width: 0.62 / VARIANT.whiteKeys,
        keyboardKey: KEYBOARD_KEYS[offset] ?? undefined,
      })
    }
  }
  return keys
}

const buttonRow = (section: SectionId, group: string, labels: string[], x: number, y: number, step = 7): HardwareControl[] =>
  labels.map((label, index) => ({
    id: `${section}-${group}-${label.toLowerCase().replaceAll(' ', '-').replaceAll('/', '-')}`,
    section,
    type: 'button',
    label,
    x: x + index * step,
    y,
    group,
  }))

const faderBank = (section: SectionId, group: string, labels: string[], x: number, y: number, step = 9): HardwareControl[] =>
  labels.map((label, index) => ({
    id: `${section}-${group}-${label.toLowerCase().replaceAll(' ', '-').replaceAll('/', '-')}`,
    section,
    type: group === 'drawbar' ? 'drawbar' : 'fader',
    label,
    x: x + index * step,
    y,
    group,
  }))

const knobBank = (section: SectionId, group: string, labels: string[], x: number, y: number, step = 8): HardwareControl[] =>
  labels.map((label, index) => ({
    id: `${section}-${group}-${label.toLowerCase().replaceAll(' ', '-').replaceAll('/', '-')}`,
    section,
    type: 'knob',
    label,
    x: x + index * step,
    y,
    group,
  }))

export const HARDWARE_CONTROLS: HardwareControl[] = [
  { id: 'performance-pitch-stick', section: 'performance', type: 'stick', label: 'Pitch stick', x: 20, y: 47, group: 'left controllers' },
  { id: 'performance-mod-wheel', section: 'performance', type: 'wheel', label: 'Modulation wheel', x: 9, y: 36, group: 'left controllers' },
  { id: 'performance-master-level', section: 'performance', type: 'knob', label: 'Master level', x: 70, y: 17, group: 'main' },
  { id: 'performance-organ-level', section: 'performance', type: 'knob', label: 'Organ level', x: 70, y: 38, group: 'main' },
  { id: 'performance-section-organ', section: 'performance', type: 'button', label: 'Organ', x: 68, y: 53, group: 'section' },
  { id: 'performance-section-piano', section: 'performance', type: 'button', label: 'Piano', x: 68, y: 63, group: 'section' },
  { id: 'performance-section-synth', section: 'performance', type: 'button', label: 'Synth', x: 68, y: 73, group: 'section' },
  { id: 'performance-section-extern', section: 'performance', type: 'button', label: 'Extern', x: 68, y: 83, group: 'section' },

  ...faderBank('organ', 'drawbar', ['16', '5 1/3', '8', '4', '2 2/3', '2', '1 3/5', '1 1/3', '1'], 6, 32, 9.2),
  ...buttonRow('organ', 'model', ['B3', 'Vox', 'Farf', 'Pipe'], 37, 12, 8),
  ...buttonRow('organ', 'percussion', ['On', 'Soft', 'Fast', 'Third'], 56, 20, 8),
  ...buttonRow('organ', 'vibrato-chorus', ['V1', 'V2', 'V3', 'C1', 'C2', 'C3'], 51, 69, 7),
  ...buttonRow('organ', 'rotary', ['Stop Mode', 'Slow/Fast', 'Drive'], 7, 70, 12),

  ...faderBank('piano', 'level', ['Layer A', 'Layer B'], 8, 29, 19),
  ...buttonRow('piano', 'type', ['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'], 35, 13, 9),
  ...buttonRow('piano', 'layer', ['A On', 'B On', 'Focus', 'SustPed', 'PStick'], 8, 72, 11),
  ...buttonRow('piano', 'detail', ['KB Touch', 'Dyn Comp', 'Timbre', 'Unison', 'Soft Release', 'String Res'], 31, 53, 9),
  { id: 'piano-model-dial', section: 'piano', type: 'encoder', label: 'Piano model dial', x: 77, y: 36, group: 'model' },

  { id: 'program-oled', section: 'program', type: 'button', label: 'Program OLED decorative focus', x: 42, y: 35, group: 'display' },
  { id: 'program-dial', section: 'program', type: 'encoder', label: 'Program dial', x: 78, y: 38, group: 'program' },
  ...buttonRow('program', 'program', ['1', '2', '3', '4', '5', '6', '7', '8'], 16, 63, 8),
  ...buttonRow('program', 'nav', ['Page Left', 'Page Right', 'Store', 'Split', 'Live Mode', 'Scene I', 'Scene II'], 7, 13, 11),
  ...buttonRow('program', 'morph', ['Wheel', 'Ctrl Ped', 'Aftertouch'], 8, 84, 15),

  { id: 'synth-oled', section: 'synth', type: 'button', label: 'Synth OLED decorative focus', x: 34, y: 20, group: 'display' },
  ...faderBank('synth', 'level', ['Layer A', 'Layer B', 'Layer C'], 7, 21, 10),
  ...knobBank('synth', 'oscillator', ['Osc Ctrl', 'Shape', 'Detune', 'Mix'], 31, 50, 10),
  ...knobBank('synth', 'filter', ['Cutoff', 'Resonance', 'Drive', 'Env Amt'], 54, 56, 10),
  ...knobBank('synth', 'envelope', ['Attack', 'Decay', 'Sustain', 'Release'], 33, 78, 10),
  ...buttonRow('synth', 'source', ['Analog', 'Wavetable', 'Sample', 'FM'], 57, 16, 9),
  ...buttonRow('synth', 'lfo-arp', ['LFO', 'Arp Run', 'Hold', 'Gate'], 74, 78, 8),

  ...knobBank('effects', 'mod-1', ['Rate', 'Amount'], 5, 29, 10),
  ...knobBank('effects', 'mod-2', ['Rate', 'Amount'], 5, 66, 10),
  ...knobBank('effects', 'delay', ['Tempo', 'Feedback', 'Mix'], 58, 23, 10),
  ...knobBank('effects', 'amp-eq', ['Drive', 'Bass', 'Mid', 'Treble'], 24, 55, 9),
  ...knobBank('effects', 'reverb', ['Dry Wet', 'Brightness'], 78, 69, 10),
  ...buttonRow('effects', 'focus', ['Layer A', 'Layer B', 'Layer C', 'Global'], 5, 9, 9),
  ...buttonRow('effects', 'units', ['Mod 1', 'Mod 2', 'Delay', 'Amp/EQ', 'Comp', 'Reverb', 'Rotary'], 29, 9, 9),
]

export const SECTION_LABELS: Record<SectionId, string> = Object.fromEntries(SECTIONS.map((section) => [section.id, section.label])) as Record<SectionId, string>
