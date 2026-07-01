// Hardware model types for Nord Stage 4 73

export type SectionId = 'performance' | 'organ' | 'piano' | 'program' | 'synth' | 'effects'

export interface KeyModel {
  totalKeys: number
  whiteKeys: number
  blackKeys: number
  range: string
  blackKeyHeightFraction: number
  startNoteIndex: number // E is 28 in 88-key, 0 in 73-key numbering
}

export type ControlType = 'knob' | 'button' | 'led' | 'drawbar' | 'switch' | 'encoder' | 'wheel' | 'fader'

export interface ControlBase {
  id: string
  label: string
  type: ControlType
}

export interface NumericControl extends ControlBase {
  type: 'knob' | 'drawbar' | 'encoder' | 'wheel' | 'fader'
  value: number
  min: number
  max: number
  step?: number
}

export interface ButtonControl extends ControlBase {
  type: 'button' | 'switch'
  active: boolean
}

export interface LedControl extends ControlBase {
  type: 'led'
  lit: boolean
  color?: 'red' | 'green' | 'blue'
}

export type Control = NumericControl | ButtonControl | LedControl

export interface Section {
  id: SectionId
  label: string
  widthFraction: number
  controls: Control[]
}

export interface HardwareModel {
  variant: 'stage-4-73'
  keyboard: KeyModel
  sections: Section[]
  displayLocations: Array<{
    sectionId: SectionId
    label: string
  }>
}

export interface VisualsSpec {
  chassisMid: string
  chassisDark: string
  panelBlueGray: string
  keyBlack: string
  keyWhite: string
  controlDeckHeightFraction: number
  keybedHeightFraction: number
}
