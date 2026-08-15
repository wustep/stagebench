import { LayerZoneAssignment } from '../../model/splits';

export type SynthOscCategory = 'Pure' | 'Sync' | 'Multi' | 'Super' | 'FM-H';

export type SynthFilterType = 'LP12' | 'LP24' | 'HP' | 'BP';

export type SynthLfoWaveform = 'Triangle' | 'Saw down' | 'Saw up' | 'Square' | 'Sample & Hold';

export type SynthLfoDestination = 'Off' | 'Osc Pitch' | 'Osc Ctrl' | 'Filter Freq';

export type SynthVoiceMode = 'Poly' | 'Mono' | 'Legato';

export type SynthVoicePriority = 'Off' | 'Low' | 'High';

export type SynthArpMode = 'Arp' | 'Poly' | 'Gate';

export type SynthArpDirection = 'Up' | 'Down' | 'Up/Down' | 'Random';

export interface SynthLayerState {
  enabled: boolean;
  focused: boolean;
  level: number; // 0..10
  octave: number; // -2..+2 (-24..+24 semitones)
  sustainPedal: boolean;
  pitchStick: boolean;
  zones?: LayerZoneAssignment;
  zoneAssignment?: LayerZoneAssignment;
}

export interface SynthParams {
  oscCategory: SynthOscCategory;
  waveformIndex: number;
  oscMod: number; // Osc Ctrl (0..10)

  pitchCoarse: number; // -24..+24
  pitchFine: number; // -50..+50

  filterType: SynthFilterType;
  filterCutoff: number; // 0..10
  filterResonance: number; // 0..10
  filterDrive: number; // 0..3
  filterEnvAmt: number; // -10..+10
  filterKbTracking: number; // 0: Off, 1: 1/3, 2: 2/3, 3: 1

  ampAttack: number;
  ampDecay: number;
  ampSustain: number;
  ampRelease: number;
  ampVelocity: number; // 0..3

  modAttack: number;
  modDecay: number;
  modRelease: number;
  modVelocity: boolean;
  modToPitch: boolean;
  modEnvAmt: number; // -10..+10

  lfoWaveform: SynthLfoWaveform;
  lfoDestination: SynthLfoDestination;
  lfoRate: number; // 0..10
  lfoAmount: number; // 0..10
  lfoClockSync: boolean;

  voiceMode: SynthVoiceMode;
  voicePriority: SynthVoicePriority;
  glide: number; // 0..10
  unison: number; // 0..3
  vibratoMode: 'Off' | 'On' | 'Wheel';
  vibratoRate: number; // 2..8 Hz
  vibratoAmount: number; // 0..10

  arpMode: SynthArpMode;
  arpDirection: SynthArpDirection;
  arpRange: number; // 1..4
  arpRate: number; // 0..10
  arpClockSync: boolean;
  arpKbHold: boolean;
  arpRun: boolean;
}
