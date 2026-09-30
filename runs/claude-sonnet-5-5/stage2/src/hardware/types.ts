/** Normalized, typed description of every physical thing on the panel. */

export type SectionId = 'performance' | 'organ' | 'piano' | 'program' | 'synth' | 'effects'

export type LedColor = 'red' | 'green' | 'amber'

export type LedRule = 'on' | 'held' | number

export interface LedSpec {
  /** section-local centre, instrument units */
  x: number
  y: number
  color: LedColor
  /** 'on' = lit while value>0, 'held' = lit while pressed, n = lit while value===n */
  rule: LedRule
  shape?: 'dot' | 'left' | 'right' | 'up' | 'down'
  text?: string
  textSide?: 'l' | 'r'
}

interface ControlBase {
  id: string
  section: SectionId
  label: string
  x: number
  y: number
}

export interface KnobSpec extends ControlBase {
  kind: 'knob'
  size: number
  min: number
  max: number
  initial: number
  ticks: string[] | 'none'
  ringTone?: 'light' | 'dark'
}

export interface EncoderSpec extends ControlBase {
  kind: 'encoder'
  size: number
  detents: number
}

export interface FaderSpec extends ControlBase {
  kind: 'fader'
  /** y is the middle of the travel */
  travel: number
  capW: number
  capH: number
  initial: number
  ladderDx: number
  ladderLeds: number
}

export interface DrawbarSpec extends ControlBase {
  kind: 'drawbar'
  /** y is the cap centre at value 0; travel is the distance to value 8 */
  travel: number
  capW: number
  capH: number
  capTone: 'black' | 'white'
  initial: number
  ladderLeds: number
}

export interface WheelSpec extends ControlBase {
  kind: 'wheel'
  variant: 'mod' | 'pitch'
  length: number
  width: number
  angle: number
  initial: number
  spring: boolean
}

export type ButtonStyle = 'dark' | 'gray' | 'red' | 'rocker' | 'grayrocker' | 'tag'
export type ButtonMode = 'latch' | 'momentary' | 'cycle'

export interface ButtonSpec extends ControlBase {
  kind: 'button'
  style: ButtonStyle
  w: number
  h: number
  mode: ButtonMode
  /** cycle modes: option names, length = number of states */
  options: string[]
  /** red rim around the cap, as on the synth group buttons */
  rim: boolean
  leds: LedSpec[]
  /** tag buttons: printed text next to the led */
  text?: string
}

export type ControlSpec = KnobSpec | EncoderSpec | FaderSpec | DrawbarSpec | WheelSpec | ButtonSpec

export interface FrameSpec {
  section: SectionId
  x: number
  y: number
  w: number
  h: number
  tone: 'plate' | 'light' | 'line' | 'rim' | 'strip' | 'well'
  title?: string
  titleTone?: 'light' | 'dark'
  titleSize?: number
  radius?: number
}

export interface LegendSpec {
  section: SectionId
  text: string
  x: number
  y: number
  align: 'l' | 'c' | 'r'
  size: number
  tone: 'white' | 'dark' | 'muted' | 'red' | 'tag'
  weight?: 'normal' | 'bold' | 'black'
  spacing?: number
  rotate?: number
  font?: 'brand' | 'label'
}

export interface IndicatorSpec {
  /** present on indicators that reflect real state (FX focus, rotary on); the rest are static panel prints */
  id?: string
  section: SectionId
  x: number
  y: number
  color: LedColor
}

export interface JackSpec {
  x: number
}

export interface SectionSpec {
  id: SectionId
  label: string
  fraction: number
  /** left edge in instrument units */
  left: number
  width: number
  /** range of the reference photo (instrument units) mapped onto the section box */
  photo: [number, number]
}
