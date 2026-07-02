// Hardware model types and state

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

// Note lifecycle
export type NoteSource = 'pointer' | 'keyboard' | 'midi'

export interface Note {
  id: string
  source: NoteSource
  midiNote: number
  velocity: number
  startTime: number
  releaseTime: number | null
  sustainActive: boolean
}

export interface NoteEvent {
  type: 'note-on' | 'note-off' | 'sustain-on' | 'sustain-off'
  note: number
  velocity?: number
  source: NoteSource
}

// Hardware control
export type ControlType =
  | 'knob'
  | 'fader'
  | 'button'
  | 'switch'
  | 'drawbar'
  | 'wheel'
  | 'encoder'
  | 'key'
  | 'led'
  | 'display'

export interface Control {
  id: string
  type: ControlType
  section: string
  label: string
  ariaLabel: string
  bounds: Rect
  state: ControlState
}

export interface ControlState {
  position?: number // 0–1 for continuous controls
  pressed?: boolean
  enabled?: boolean
  text?: string
  color?: string
}

// Keyboard state
export interface KeyboardState {
  [note: number]: {
    active: boolean
    velocity: number
    source: NoteSource | null
  }
}

// Global audio/hardware state
export interface HardwareState {
  notes: Map<string, Note>
  keyboard: KeyboardState
  sustain: boolean
  masterLevel: number
  controls: Map<string, ControlState>
  audioReady: boolean
  audioError: string | null
}

// Instrument layout
export interface InstrumentLayout {
  viewport: Point
  instrument: Rect
  controlDeck: Rect
  keybed: Rect
  sections: Record<string, Rect>
  keyGeometry: {
    keyWidth: number
    keyHeight: number
    blackKeyHeight: number
    keySpacing: number
  }
}
