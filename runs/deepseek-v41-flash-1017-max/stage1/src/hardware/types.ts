/** Ordered section identifiers for the shared Nord Stage 4 control deck. */
export type SectionId = 'performance' | 'organ' | 'piano' | 'program' | 'synth' | 'effects'

export type SurfaceKind = 'exposed-chassis' | 'inset-plate' | 'red-and-dark'

/** Every visible physical input on the instrument is one of these kinds. */
export type ControlKind =
  | 'knob'
  | 'dial'
  | 'fader'
  | 'drawbar'
  | 'wheel'
  | 'pitch-stick'
  | 'button'
  | 'toggle'
  | 'selector'

export interface ControlBase {
  /** Stable dotted identifier, e.g. `organ.drawbar.16`. Never reused or renumbered. */
  id: string
  section: SectionId
  /** Sub-panel this control sits inside. */
  block: string
  /** Legend printed on the chassis next to the control. */
  legend: string
  /** Accessible name. Always section-qualified so screen readers stay unambiguous. */
  name: string
  /** Small explanatory text for the control's printed group, where the photo has one. */
  hint?: string
}

export interface NumericControl extends ControlBase {
  kind: 'knob' | 'dial' | 'fader' | 'drawbar' | 'wheel' | 'pitch-stick'
  min: number
  max: number
  step: number
  value: number
  /** Springs back to `restValue` when released (pitch stick only on this instrument). */
  spring?: boolean
  restValue?: number
  /** Renders an LED ladder beside the control (drawbars and layer faders). */
  leds?: number
  /** Printed cap colour of a drawbar or fader, taken from the photograph. */
  cap?: 'brown' | 'white' | 'black' | 'grey'
  size?: 'sm' | 'md' | 'lg'
  /** Printed end legends, e.g. ['0', '10']. */
  scale?: [string, string]
}

export interface SwitchControl extends ControlBase {
  kind: 'button' | 'toggle'
  value: 0 | 1
  /** Momentary button: pressing is a transient presentation flash. */
  momentary?: boolean
  led?: 'red' | 'green' | 'amber' | 'none'
  size?: 'sm' | 'md' | 'lg'
}

export interface SelectorControl extends ControlBase {
  kind: 'selector'
  options: string[]
  value: number
  orientation?: 'row' | 'column'
  led?: 'red' | 'green' | 'amber'
}

export type ControlSpec = NumericControl | SwitchControl | SelectorControl

export interface BlockSpec {
  id: string
  section: SectionId
  /** Printed group legend, uppercase, exactly as on the chassis where the photo has one. */
  legend?: string
  /** CSS grid-template-areas name used by the section layout. */
  area?: string
  /** Column count for the block's internal control grid. */
  columns?: number
  /** Printed note rendered under the group. */
  note?: string
  controls: ControlSpec[]
}

export function isNumeric(c: ControlSpec): c is NumericControl {
  return c.kind === 'knob' || c.kind === 'dial' || c.kind === 'fader' || c.kind === 'drawbar' || c.kind === 'wheel' || c.kind === 'pitch-stick'
}

export function isSelector(c: ControlSpec): c is SelectorControl {
  return c.kind === 'selector'
}
