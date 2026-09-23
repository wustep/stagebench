import type { SectionId } from './geometry'

export type LedColor = 'red' | 'green' | 'yellow'
export type LedShape = 'dot' | 'tri-left' | 'tri-right' | 'tri-up' | 'tri-down'
export type Tone = 'light' | 'dark' | 'red'

export interface LedDef {
  id: string
  section: SectionId
  x: number
  y: number
  color: LedColor
  shape: LedShape
  /** Control whose presentation state lights this LED (none = never lit in Phase 1). */
  owner?: string
}

export interface LegendDef {
  section: SectionId
  text: string
  x: number
  y: number
  size: number
  align: 'left' | 'center' | 'right'
  weight: 400 | 600 | 700 | 800
  tone: Tone
  boxed?: 'light' | 'red'
  rotate?: number
  spacing?: number
  font?: 'brand'
}

export interface BoxDef {
  section: SectionId
  x1: number
  y1: number
  x2: number
  y2: number
  title?: string
  /** 'band' = light title band across the top (Program area style). */
  titleStyle: 'notch' | 'band'
  fill: 'none' | 'light' | 'mid' | 'dark' | 'black'
  outline: 'light' | 'red' | 'none'
}

export interface PlateDef {
  section: SectionId
  x1: number
  y1: number
  x2: number
  y2: number
  headerTop: number
  headerBottom: number
  tab?: { x1: number; x2: number; y1: number }
  /** Region under the header that stays red (e.g. the FX FOCUS column). */
  redColumn?: { x1: number; x2: number }
}

export interface GraphDef {
  id: string
  section: SectionId
  kind: 'ladder' | 'drawbar'
  owner: string
  x: number
  y1: number
  y2: number
  cells: number
  w: number
}

export interface OledDef {
  id: string
  section: SectionId
  x1: number
  y1: number
  x2: number
  y2: number
  label: string
}

export interface DecorLine {
  section: SectionId
  points: [number, number][]
}

interface BaseControl {
  id: string
  section: SectionId
  label: string
  /** Centre, instrument design coordinates. */
  x: number
  y: number
  w: number
  h: number
}

export type ButtonStyle = 'dark' | 'light' | 'red' | 'rocker-dark' | 'rocker-light'

export interface ButtonControl extends BaseControl {
  kind: 'button'
  style: ButtonStyle
  outline: boolean
  /** LED ids lit in each presentation state; one state = momentary button. */
  states: string[][]
  stateNames: string[]
}

export interface KnobControl extends BaseControl {
  kind: 'knob'
  min: number
  max: number
  initial: number
  scale: 'unit' | 'bipolar' | 'eq' | 'range' | 'freq' | 'none'
  halo: boolean
  /** Legend colour of the printed scale (depends on the surface under the knob). */
  tone: Tone
}

export interface EncoderControl extends BaseControl {
  kind: 'encoder'
}

export interface FaderControl extends BaseControl {
  kind: 'fader'
  trackTop: number
  trackBottom: number
  initial: number
  min: number
  max: number
}

export interface DrawbarControl extends BaseControl {
  kind: 'drawbar'
  footage: string
  cap: 'black' | 'white'
  slotTop: number
  initial: number
  min: number
  max: number
}

export interface StickControl extends BaseControl {
  kind: 'pitch-stick'
  rotate: number
  min: number
  max: number
}

export interface WheelControl extends BaseControl {
  kind: 'mod-wheel'
  rotate: number
  min: number
  max: number
  initial: number
}

export type ControlDef =
  | ButtonControl
  | KnobControl
  | EncoderControl
  | FaderControl
  | DrawbarControl
  | StickControl
  | WheelControl

export type ControlKind = ControlDef['kind']
