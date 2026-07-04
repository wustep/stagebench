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

// Phase 3: Organ Engine Types
export interface OrganState {
  enabled: boolean;
  activeLayers: ('A' | 'B')[];
  focusedLayer: 'A' | 'B';

  // Per-layer state
  layerA: OrganLayerState;
  layerB: OrganLayerState;
}

export interface OrganLayerState {
  enabled: boolean;
  model: 'B3' | 'B3 Bass' | 'Vox' | 'Farf' | 'Pipe 1' | 'Pipe 2';
  level: number; // 0-1
  octaveShift: number; // ±12

  // Drawbars (0-8, where 0 is pulled out, 8 is pushed in)
  drawbars: number[]; // 9 values for [16', 5⅓', 8', 4', 2⅔', 2', 1⅗', 1⅓', 1']

  // Effects
  vibratoChorus: 'C1' | 'C2' | 'C3' | 'V1' | 'V2' | 'V3' | 'Off';

  // Percussion (B3 only)
  percussionEnabled: boolean;
  percussionSoft: boolean;
  percussionDecayFast: boolean;
  percussionHarmonicThird: boolean;

  // Key click
  keyClickEnabled: boolean;

  // Rotary
  rotaryEnabled: boolean;
  rotarySpeed: 'Slow' | 'Fast' | 'Stop';
}

// Phase 3: Synth Engine Types
export interface SynthState {
  enabled: boolean;
  activeLayers: ('A' | 'B' | 'C')[];
  focusedLayer: 'A' | 'B' | 'C';

  // Per-layer state
  layerA: SynthLayerState;
  layerB: SynthLayerState;
  layerC: SynthLayerState;
}

export interface SynthLayerState {
  enabled: boolean;
  level: number; // 0-1
  octaveShift: number; // ±12

  // Oscillator
  waveform: 'Sine' | 'Triangle' | 'Saw' | 'Square' | 'Pulse 33' | 'Pulse 10' | 'White Noise' |
            'Sync Saw' | 'Sync Square' |
            'Multi Saw' | 'Multi Saw 8ve' |
            'Super Saw' | 'Super Square' |
            'FM 2-op (algorithm A)';
  oscCtrl: number; // 0-10, morphable
  oscPitchCoarse: number; // -24 to 24 semitones
  oscPitchFine: number; // -50 to 50 cents

  // Filter
  filterType: 'LP12' | 'LP24' | 'HP' | 'BP';
  filterFreq: number; // 0-1 (20Hz-20kHz)
  filterRes: number; // 0-1
  filterTracking: 'Off' | '1/3' | '2/3' | '1';
  filterDrive: 'Off' | 1 | 2 | 3;
  filterEnvAmount: number; // -1 to 1

  // Envelopes
  oscEnvelope: EnvelopeState;
  filterEnvelope: EnvelopeState;
  ampEnvelope: EnvelopeState;

  // LFO
  lfoWaveform: 'Triangle' | 'Saw down' | 'Saw up' | 'Square' | 'Sample & Hold';
  lfoRate: number; // 0-1 (morphable, clock-syncable)
  lfoModAmount: number; // 0-1 (morphable)
  lfoDestinations: ('Osc Pitch' | 'Osc Ctrl' | 'Filter Freq')[]; // up to 3

  // Voice modes
  voiceMode: 'Poly' | 'Mono' | 'Legato';
  priority: 'Off' | 'Low' | 'High';
  glideRate: number; // 0-1
  unison: 'Off' | 1 | 2 | 3;
  vibrato: {
    mode: 'On' | 'Wheel';
    rate: number; // 2-8 Hz
    amount: number; // 0-10
  };

  // Arpeggiator/Gate
  arpMode: 'Arp' | 'Poly' | 'Gate';
  arpRate: number; // 0-1 (quarter-note BPM or subdivision)
  arpRange: number; // 1-4 octaves
  arpDirection: 'Up' | 'Down' | 'Up/Down' | 'Random';
  arpKbHold: boolean;
  arpRun: boolean;
}

export interface EnvelopeState {
  attack: number; // 0-1
  decay: number; // 0-1
  release: number; // 0-1
  velocityEnabled: boolean;
}

// Phase 3: Program Management
export interface ProgramState {
  // Metadata
  name: string;
  number: number; // 0-31 for regular, 0-7 for live
  isLive: boolean;

  // Dirty tracking
  isDirty: boolean;

  // Complete instrument state
  piano: PianoState;
  organ: OrganState;
  synth: SynthState;
  effects: EffectsState;

  // Splits, scenes, morphs
  splits: SplitState;
  scenes: SceneState;
  morphs: MorphState;

  // Master controls
  masterClock: MasterClockState;
  transpose: number; // -6 to 6 semitones
}

export interface EffectsState {
  // Shared effects chain (inherited from Phase 2)
  mod1: EffectUnitState;
  mod2: EffectUnitState;
  delay: EffectUnitState;
  ampSim: EffectUnitState;
  compressor: EffectUnitState;
  reverb: EffectUnitState;
  rotary: RotaryState;
}

export interface EffectUnitState {
  enabled: boolean;
  type: string;
  dryWet: number; // 0-1
  // Additional parameters per effect type
  [key: string]: unknown;
}

export interface RotaryState {
  enabled: boolean;
  speed: 'Slow' | 'Fast' | 'Stop';
  routedToOrgan: boolean;
  routedToPiano: boolean;
  routedToSynth: boolean;
}

export interface SplitState {
  enabled: boolean;
  zones: ZoneState[];
  splitPoints: {
    low?: number; // MIDI note
    mid?: number; // MIDI note
    high?: number; // MIDI note
  };
  crossfade: {
    lowMid?: 0 | 6 | 12;
    midHigh?: 0 | 6 | 12;
  };
}

export interface ZoneState {
  id: string;
  name: string;
  noteRange: [number, number]; // [min, max] MIDI notes
  pianoLayers: ('A' | 'B')[];
  organLayers: ('A' | 'B')[];
  synthLayers: ('A' | 'B' | 'C')[];
  crossfadeAmountStart: number; // 0-1
  crossfadeAmountEnd: number; // 0-1
}

export interface SceneState {
  sceneI: {
    pianoEnabled: boolean;
    organLayerAEnabled: boolean;
    organLayerBEnabled: boolean;
    synthLayerAEnabled: boolean;
    synthLayerBEnabled: boolean;
    synthLayerCEnabled: boolean;
  };
  sceneII: {
    pianoEnabled: boolean;
    organLayerAEnabled: boolean;
    organLayerBEnabled: boolean;
    synthLayerAEnabled: boolean;
    synthLayerBEnabled: boolean;
    synthLayerCEnabled: boolean;
  };
  currentScene: 'I' | 'II';
}

export interface MorphState {
  wheel: MorphSourceState;
  controlPedal: MorphSourceState;
  wheelValue: number; // 0-1
  controlPedalValue: number; // 0-1
}

export interface MorphSourceState {
  isRecording: boolean;
  destinations: MorphDestination[];
}

export interface MorphDestination {
  id: string;
  parameter: string; // e.g., 'organA.level', 'synthB.filterFreq'
  startValue: number;
  endValue: number;
  currentValue: number;
}

export interface MasterClockState {
  bpm: number; // 30-300
  synced: boolean; // whether clock is synced
  running: boolean;
}
