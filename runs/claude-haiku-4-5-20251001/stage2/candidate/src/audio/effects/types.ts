// Phase 2: Effect unit types and interfaces

export interface EffectUnitConfig {
  id: string;
  unit: EffectUnitType;
  type: string; // e.g., 'Tremolo', 'Chorus', etc.
  enabled: boolean;
  parameters: Record<string, number>;
  dryWet: number; // 0-1, where 1 is fully wet
}

export type EffectUnitType = 'mod1' | 'mod2' | 'delay' | 'ampEq' | 'compressor' | 'reverb';

export interface EffectNodeCleanup {
  cleanup(): void;
}

export interface EffectProcessing extends EffectNodeCleanup {
  input: AudioNode;
  output: AudioNode;
  setType(type: string): void;
  setParameter(name: string, value: number): void;
  setEnabled(enabled: boolean): void;
  setDryWet(amount: number): void;
}

// Mod 1 types
export const MOD1_TYPES = ['A-Pan', 'Tremolo', 'Ring Mod', 'A-Wah', 'Wah', 'Pump'] as const;
export type Mod1Type = (typeof MOD1_TYPES)[number];

// Mod 2 types
export const MOD2_TYPES = ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin'] as const;
export type Mod2Type = (typeof MOD2_TYPES)[number];

// Amp Sim / EQ types
export const AMPEQ_TYPES = ['EQ only', 'Twin', 'JC', 'Small', 'LP24 Filter', 'HP24 Filter', 'To Rotary'] as const;
export type AmpEqType = (typeof AMPEQ_TYPES)[number];

// Reverb types
export const REVERB_TYPES = ['Room', 'Booth', 'Spring', 'Stage', 'Hall', 'Cathedral'] as const;
export type ReverbType = (typeof REVERB_TYPES)[number];
