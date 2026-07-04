// Hardware model types for Nord Stage 4
// Based on specs/nord-stage-4.visual.json and specs/nord-stage-4.piano.json

export interface KeyboardNote {
  note: number; // MIDI note number 0-127
  octave: number; // derived from note
  naturalName: string; // C, C#, D, etc.
  isBlack: boolean;
}

export interface VoiceState {
  note: number;
  velocity: number; // 0-127
  startTime: number; // when the note started playing
  releaseTime?: number; // when release was triggered
  sustainActive: boolean;
}

export interface PianoState {
  enabled: boolean;
  activeLayers: ('A' | 'B')[];
  focusedLayer: 'A' | 'B';
  selectedType: 'Grand' | 'Upright' | 'Electric' | 'Clav' | 'Digital' | 'Misc';
  octaveShiftA: number; // ±12
  octaveShiftB: number; // ±12
  levelA: number; // 0-1
  levelB: number; // 0-1
  kbTouch: 'Heavy' | 'Medium' | 'Light';
  dynComp: 'Off' | 1 | 2 | 3;
  timbre: string; // 'Off', 'Soft', 'Mid', 'Bright', etc.
  unison: 'Off' | 1 | 2 | 3;
  softRelease: boolean;
  stringRes: boolean;
  sustainActive: boolean;
  sustainPedal: boolean;
  currentVoices: VoiceState[];
  maxPolyphony: number;
  loadingState: 'idle' | 'loading' | 'ready' | 'error';
}

export interface ControlState {
  id: string;
  type: 'knob' | 'fader' | 'button' | 'wheel' | 'drawbar' | 'encoder';
  section: string;
  label: string;
  value: number; // 0-1 for most, -1 to 1 for pitch wheel
  isPressed?: boolean;
  isActive?: boolean;
  displayValue?: string;
}

export interface Variant {
  id: string;
  label: string;
  fullName: string;
  keyCount: number;
  whiteKeys: number;
  blackKeys: number;
  range: string;
  keyAction: string;
  aspectRatio: number;
}

export interface Section {
  id: string;
  label: string;
  fraction: number;
  controls: ControlState[];
}

export interface HardwareModel {
  variant: Variant;
  sections: Section[];
  piano: PianoState;
  sustainPedalDown: boolean;
  pitchStickBend: number; // -2 to +2 semitones
  modWheelValue: number; // 0-1
  masterLevel: number; // 0-1
}

export interface MidiInputState {
  connected: boolean;
  connecting: boolean;
  error?: string;
}

export interface AudioBoundary {
  audioContext?: AudioContext;
  masterGain?: GainNode;
  analyser?: AnalyserNode;
}
