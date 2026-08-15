export type Mod1Type = 'A-Pan' | 'Tremolo' | 'Ring Mod' | 'A-Wah' | 'Wah' | 'Pump';
export type Mod2Type = 'Chorus' | 'Flanger' | 'Phaser' | 'Vibe' | 'Ensemble' | 'Spin';
export type AmpType = 'EQ only' | 'Twin' | 'JC' | 'Small' | 'LP24 Filter' | 'HP24 Filter' | 'LP24' | 'HP24' | 'To Rotary';
export type ReverbType = 'Booth' | 'Room' | 'Stage' | 'Hall' | 'Cathedral' | 'Spring';
export type DelayFilterType = 'Off' | 'LP' | 'HP' | 'BP';

export interface Mod1Params {
  on: boolean;
  enabled?: boolean;
  type: Mod1Type;
  rate: number; // 0..10
  amount: number; // 0..10
}

export interface Mod2Params {
  on: boolean;
  enabled?: boolean;
  type: Mod2Type;
  rate: number; // 0..10
  amount: number; // 0..10
}

export interface DelayParams {
  on: boolean;
  enabled?: boolean;
  tempo: number; // 0..10 (e.g. 50ms - 1000ms)
  feedback: number; // 0..10 (0 - 0.92)
  amount: number; // 0..10 (Dry/Wet 0% - 100%)
  filter: DelayFilterType;
  pingPong: boolean;
  global?: boolean;
}

export interface AmpEqParams {
  on: boolean;
  enabled?: boolean;
  type: AmpType;
  drive: number; // 0..10
  bass: number; // -10..10 (-15dB to +15dB)
  mid: number; // -10..10 (-15dB to +15dB)
  midFreq: number; // 0..10 (200Hz to 8000Hz)
  treble: number; // -10..10 (-15dB to +15dB)
  toRotary?: boolean;
}

export interface CompressorParams {
  on: boolean;
  enabled?: boolean;
  amount: number; // 0..10
  fast: boolean;
  global?: boolean;
}

export interface ReverbParams {
  on: boolean;
  enabled?: boolean;
  type: ReverbType;
  decay: number; // 0..10
  amount: number; // 0..10 (Dry/Wet 0% - 100%)
  bright: boolean;
  global?: boolean;
}

export interface RotaryParams {
  on: boolean;
  enabled?: boolean;
  speed: 'slow' | 'fast' | 'Slow' | 'Fast';
  stop: boolean;
  drive: number; // 0..10
}
