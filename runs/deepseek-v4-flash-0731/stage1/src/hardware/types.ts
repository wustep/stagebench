// Normalized, typed hardware model for the Nord Stage 4 (variant 73).
//
// Everything about the physical instrument's *surface* — sections, keys, and
// controls — is declared here with stable string IDs. The live *presentation
// state* of every movable control lives in a normalized hardware store keyed
// by those same IDs. In Phase 1 this presentation state and nothing else
// changes when a control is moved: the keybed (notes + sustain) is the only
// thing connected to audio.

export type ControlKind =
  | 'knob' // continuous rotary, black indexed
  | 'encoder' // continuous endless rotator with dial
  | 'fader' // vertical slider
  | 'drawbar' // vertical organ drawbar, discrete 0..8
  | 'button' // latching (toggles on/off)
  | 'momentary' // momentary push button
  | 'wheel' // modulation wheel (vertical, stays)
  | 'stick' // pitch stick (vertical, spring returns to center)
  | 'led' // indicator (not interactive)
  | 'oled' // display (not interactive)
  | 'graph' // LED ladder graph (read-only) with fractional fill

// Presentation value semantics are intentionally narrow so a control can
// *look* like it is doing something without ever touching audio/system state.
export type ControlValue =
  | number // knobs/faders/drawbars: continuous or discrete position in 0..1 (knobs/faders/wheels) or integer step
  | boolean // buttons
  | string // oled/led label text

export interface BaseControlSpec {
  id: string
  kind: ControlKind
  label: string // accessible name + legend
  ariaRole?: string
}

export interface KnobSpec extends BaseControlSpec {
  kind: 'knob'
  /** Number of detent steps, or 0 for smooth. Stepped knobs snap. */
  steps?: number
  /** Whether the knob is endless (encoder-style) vs bounded 0..1. */
  endless?: boolean
  /** Default presentation position in 0..1. */
  defaultValue?: number
}

export interface EncoderSpec extends BaseControlSpec {
  kind: 'encoder'
  /** Default presentation position in 0..1. */
  defaultValue?: number
}

export interface FaderSpec extends BaseControlSpec {
  kind: 'fader'
  /** value represented as integer 0..(max-1) for LED-ladder faders. */
  segments?: number
  defaultValue?: number
}

export interface DrawbarSpec extends BaseControlSpec {
  kind: 'drawbar'
  /** 0..8 drawbar setting. */
  defaultValue?: number
}

export interface ButtonSpec extends BaseControlSpec {
  kind: 'button' | 'momentary'
  defaultValue?: boolean
}

export interface WheelSpec extends BaseControlSpec {
  kind: 'wheel'
  defaultValue?: number
}

export interface StickSpec extends BaseControlSpec {
  kind: 'stick'
}

export interface LedSpec extends BaseControlSpec {
  kind: 'led'
  /** base label shown when inactive; becomes lit when on. */
}

export interface OledSpec extends BaseControlSpec {
  kind: 'oled'
  /** placeholder text rendered on the display (blue-green). */
  text?: string
}

export interface GraphSpec extends BaseControlSpec {
  kind: 'graph'
  /** number of lit segments, 0..segments. */
  segments: number
  defaultValue?: number
}

export type ControlSpec =
  | KnobSpec
  | EncoderSpec
  | FaderSpec
  | DrawbarSpec
  | ButtonSpec
  | WheelSpec
  | StickSpec
  | LedSpec
  | OledSpec
  | GraphSpec

export interface SectionSpec {
  id: string
  label: string
  /** Horizontal fraction of the deck width (fractions sum to 1). */
  fraction: number
  /** Landmark group used by the visual audit (from the visual spec). */
  landmarks: string[]
  /** Dark inset plate with red perimeter, or exposed red chassis. */
  surface: 'inset' | 'chassis'
  controls: ControlSpec[]
}

export interface KeySpec {
  /** stable id, e.g. "key-w-0", "key-b-0" with the variant midi note. */
  id: string
  midi: number
  isBlack: boolean
  /** Horizontal coordinate in keybed units (0 = left edge). */
  x: number
  width: number
  /** display label (scientific pitch class, e.g. C4). */
  name: string
}

export interface KeybedSpec {
  totalKeys: number
  whiteKeys: number
  blackKeys: number
  rangeLow: string
  rangeHigh: string
  /** normalized black-key height = fraction of white-key height. */
  blackKeyHeightFraction: number
  keys: KeySpec[]
}

export interface InstrumentSpec {
  variant: string
  /** deck (including top rail) vs keybed (including bottom rail) split, 0..1 of deck. */
  deckFraction: number
  keybedFraction: number
  sections: SectionSpec[]
  keybed: KeybedSpec
  /** reference material colors. */
  colors: {
    chassisMid: string
    chassisDark: string
    panelBlueGray: string
    keyBlack: string
    keyWhite: string
  }
}