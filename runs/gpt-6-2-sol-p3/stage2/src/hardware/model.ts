export const variant = {
  id: 'stage-4-73',
  name: 'Nord Stage 4 73',
  action: 'Hammer action',
  firstNote: 28,
  lastNote: 100,
  aspect: 3.0951,
  deckFraction: 0.54,
  blackHeight: 0.61,
} as const

const pitchNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

export interface Key {
  id: string
  note: number
  label: string
  black: boolean
  whiteIndex: number
}

let whiteCount = 0
export const keys: readonly Key[] = Array.from(
  { length: variant.lastNote - variant.firstNote + 1 },
  (_, index) => {
    const note = variant.firstNote + index
    const pitch = pitchNames[note % 12]
    const black = pitch.includes('♯')
    return {
      id: `key-${note}`,
      note,
      label: `${pitch}${Math.floor(note / 12) - 1}`,
      black,
      whiteIndex: black ? whiteCount : whiteCount++,
    }
  },
)
export const whiteKeyCount = whiteCount

export const sectionBands = [
  { id: 'performance', name: 'Performance', fraction: 0.14 },
  { id: 'organ', name: 'Organ', fraction: 0.20 },
  { id: 'piano', name: 'Piano', fraction: 0.085 },
  { id: 'program', name: 'Program and Morph', fraction: 0.125 },
  { id: 'synth', name: 'Synth', fraction: 0.25 },
  { id: 'effects', name: 'Layer Effects', fraction: 0.20 },
] as const

export type SectionId = typeof sectionBands[number]['id']
export type Box = readonly [x: number, y: number, width: number, height: number]
export type LedColor = 'red' | 'green' | 'amber'
export type RangeKind = 'knob' | 'fader' | 'drawbar' | 'wheel' | 'stick'

export interface ButtonControl {
  type: 'button'
  id: string
  name: string
  box: Box
  initial: boolean
  style?: 'light' | 'red' | 'black' | 'indicator'
  led?: LedColor
}

export interface RangeControl {
  type: RangeKind
  id: string
  name: string
  box: Box
  initial: number
  maximum: number
  style?: 'white' | 'dark' | 'gray' | 'wood'
  legend?: string
}

export type Control = ButtonControl | RangeControl
export type Lamp = { left: number; top: number; color: LedColor; on?: boolean; controlId?: string }
export type Legend = { x: number; y: number; text: string; style?: 'title' | 'tiny' | 'dark' | 'inverse' }
export type Plate = { box: Box; title?: string; style?: 'panel' | 'silver' | 'outline' | 'red' }
export type Readout = { box: Box; kind: 'program' | 'synth' }

export interface Panel {
  controls: Control[]
  legends: Legend[]
  lamps: Lamp[]
  plates: Plate[]
  readout?: Readout
}

export function initialPanelState(controls: readonly Control[]): Record<string, number | boolean> {
  return Object.fromEntries(controls.map((control) => [control.id, control.initial]))
}
