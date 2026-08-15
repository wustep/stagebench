import { LayerZoneAssignment } from '../../model/splits';

export type OrganModel = 'B3' | 'Vox' | 'Farf' | 'Pipe 1' | 'Pipe 2' | 'B3 Bass';

export type VibratoChorusMode = 'C1' | 'C2' | 'C3' | 'V1' | 'V2' | 'V3';

export interface OrganLayerState {
  enabled: boolean;
  focused: boolean;
  level: number; // 0..10
  octave: number; // -2..+2 (-24..+24 semitones)
  model: OrganModel;
  vibratoOn: boolean;
  sustainPedal: boolean;
  pitchStick: boolean;
  zones?: LayerZoneAssignment;
  zoneAssignment?: LayerZoneAssignment;
}

export interface OrganParams {
  model: OrganModel;
  drawbars: [number, number, number, number, number, number, number, number, number]; // 0..8 each
  percussionOn: boolean;
  percussionSoft: boolean;
  percussionFast: boolean;
  percussionThird: boolean;
  vibratoOn: boolean;
  vibratoMode: VibratoChorusMode;
  rotarySpeed: 'slow' | 'fast';
  rotaryStop: boolean;
  rotaryDrive: number;
}
