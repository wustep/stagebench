/**
 * Normalized hardware model for the Nord Stage 4 control surface.
 *
 * Everything on the panel is described as data: controls a hand can operate,
 * LEDs, printed legends, plates, and the two OLED windows. Positions are stored
 * twice — as the pixel coordinate read off the reference photo (`photo`) and as
 * the design-space coordinate inside the owning section (`x`, `y`).
 */

export type SectionId = 'performance' | 'organ' | 'piano' | 'program' | 'synth' | 'effects'

export type ControlKind = 'button' | 'knob' | 'encoder' | 'fader' | 'drawbar' | 'wheel' | 'stick'

export interface PhotoPoint {
  /** Absolute pixel position on reference/nord-stage-4-73.jpg. */
  x: number
  y: number
}

interface Placed {
  section: SectionId
  /** Centre, design px, relative to the section's top-left corner. */
  x: number
  y: number
  photo: PhotoPoint
}

interface ControlBase extends Placed {
  /** Stable ID. Also used as the DOM id. */
  id: string
  kind: ControlKind
  /** Accessible name. */
  name: string
  /** Border-box size in design px. */
  w: number
  h: number
}

export type ButtonLook = 'dark' | 'light' | 'red'

export interface ButtonDef extends ControlBase {
  kind: 'button'
  look: ButtonLook
  orientation: 'horizontal' | 'vertical'
  /** Red printed surround used around several Synth buttons. */
  surround: boolean
  /**
   * Number of indicator positions the button steps through.
   * 0 = momentary (no indicator), 2 = off/on, n = selector with n positions.
   */
  steps: number
  /** Printed legend for each indicator position, when the button is a selector. */
  stepLabels?: readonly string[]
  initial: number
}

export type KnobScale = 'none' | 'zero-to-ten' | 'bipolar-10' | 'bipolar-15' | 'eq-freq' | 'arp-range' | 'master'

export interface RangeDef extends ControlBase {
  kind: Exclude<ControlKind, 'button'>
  min: number
  max: number
  /** Resolution the value snaps to. */
  step: number
  /** Arrow-key increment. */
  keyStep: number
  /** PageUp/PageDown increment. */
  bigStep: number
  initial: number
  /** Knob: printed scale. */
  scale: KnobScale
  /** Knob: numerals are printed dark because the knob sits on a light block. */
  onLight?: boolean
  /** Encoder: endless, value wraps. */
  wrap: boolean
  /** Stick: value it springs back to on release. */
  springTo?: number
  /** Encoder: light ring printed around the dial. */
  ring?: boolean
  /** Drawbar: cap colour. */
  cap?: 'brown' | 'white' | 'black'
  /** Wheel/stick: rotation of the part on the chassis, degrees. */
  tilt?: number
  /** Human unit used in aria-valuetext. */
  unit?: string
}

export type ControlDef = ButtonDef | RangeDef

export type LedColor = 'red' | 'green' | 'yellow'
export type LedShape = 'round' | 'left' | 'right' | 'up' | 'down'

/** What an LED shows. All of it is presentation state — never audio or program state. */
export type LedBinding =
  | { type: 'static'; lit: boolean }
  | { type: 'step'; control: string; on: readonly number[] }

export interface LedDef extends Placed {
  id: string
  color: LedColor
  shape: LedShape
  binding: LedBinding
}

export type LabelFont = 'legend' | 'wide' | 'logo' | 'logo-sub'
export type LabelTone = 'light' | 'dark' | 'dim' | 'pink'
export type LabelBox = 'none' | 'outline' | 'red' | 'pill' | 'filled' | 'cut-dark' | 'cut-light' | 'cut-red'

export interface LabelDef extends Placed {
  /** Only set for legends that are landmarks in their own right (the logotype). */
  id?: string
  text: string
  size: number
  font: LabelFont
  tone: LabelTone
  box: LabelBox
  align: 'center' | 'left' | 'right'
  vertical: boolean
}

export type PlateStyle =
  | 'dark' /* dark blue-gray inset plate */
  | 'light' /* light blue-gray printed block */
  | 'frame' /* light outline on the dark plate */
  | 'frame-red' /* light outline on red chassis */
  | 'led-box' /* black window holding triangle LEDs */
  | 'arch' /* dark arch behind a knob on a light block */
  | 'red-box' /* dark red printed box behind a legend */
  | 'rule' /* thin printed line, light */
  | 'rule-dark' /* thin printed line on a light block */
  | 'ring' /* white arc printed around Master Level */

export interface PlateDef {
  section: SectionId
  style: PlateStyle
  /** Design px relative to the section. */
  x: number
  y: number
  w: number
  h: number
  radius: number
}

export interface OledDef extends Placed {
  id: string
  name: string
  w: number
  h: number
}

/** Fader LED ladder and drawbar LED graph are derived from the owning control. */
export interface SectionInventory {
  id: SectionId
  controls: ControlDef[]
  leds: LedDef[]
  labels: LabelDef[]
  plates: PlateDef[]
  oleds: OledDef[]
  /** Spec landmark → IDs of the hardware that satisfies it. */
  landmarks: Record<string, string[]>
}

export function isButton(control: ControlDef): control is ButtonDef {
  return control.kind === 'button'
}

export function isRange(control: ControlDef): control is RangeDef {
  return control.kind !== 'button'
}
