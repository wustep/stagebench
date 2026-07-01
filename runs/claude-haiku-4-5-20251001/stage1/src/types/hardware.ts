// Hardware control types and data structures

export type ControlType =
  | 'knob'
  | 'button'
  | 'fader'
  | 'switch'
  | 'stick'
  | 'wheel'
  | 'drawbar'
  | 'encoder'
  | 'oled'
  | 'led'
  | 'label'

export type SurfaceType = 'red' | 'dark-plate'

export interface ControlPosition {
  x: number // percentage of section width (0-100)
  y: number // percentage of section height (0-100)
  width?: number // percentage
  height?: number // percentage
}

export interface Control {
  id: string
  label: string
  type: ControlType
  position?: ControlPosition
  value?: number
  min?: number
  max?: number
  group?: string
  ariaLabel?: string
  ariaRole?: string
}

export interface ControlSection {
  id: string
  label: string
  widthFraction: number // 0.13, 0.21, etc.
  surface: SurfaceType
  controls: Control[]
}

export interface KeybedSpec {
  totalKeys: number
  whiteKeys: number
  blackKeys: number
  range: string
  blackKeyHeightFraction: number
}

export interface HardwareMap {
  variant: string
  sections: ControlSection[]
  keybed: KeybedSpec
  verticalAllocation: {
    controlDeck: number
    keybed: number
  }
}

// Stage 4 88 specific variant
export const STAGE_4_88_KEYBED: KeybedSpec = {
  totalKeys: 88,
  whiteKeys: 52,
  blackKeys: 36,
  range: 'A to C',
  blackKeyHeightFraction: 0.61,
}

// Vertical allocation (control deck 54%, keybed 46%)
export const VERTICAL_ALLOCATION = {
  controlDeck: 0.54,
  keybed: 0.46,
}

// Horizontal section widths
export const SECTION_WIDTHS = {
  performance: 0.13,
  organ: 0.21,
  piano: 0.15,
  program: 0.09,
  synth: 0.21,
  effects: 0.21,
}
