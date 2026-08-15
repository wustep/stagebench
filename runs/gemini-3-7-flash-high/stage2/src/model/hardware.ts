export interface HardwareControlMeta {
  id: string;
  name: string;
  section: 'performance' | 'organ' | 'piano' | 'program' | 'synth' | 'effects';
  type: 'knob' | 'fader' | 'drawbar' | 'button' | 'wheel' | 'stick' | 'encoder';
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  defaultValue: number | boolean | string;
}

export interface HardwareState {
  // Performance
  master_level: number;
  pitch_stick: number;
  mod_wheel: number;

  // Organ
  organ_on: boolean;
  organ_model: number; // 0..5
  organ_preset_1: boolean;
  organ_preset_2: boolean;
  organ_db_16: number;
  organ_db_5_1_3: number;
  organ_db_8: number;
  organ_db_4: number;
  organ_db_2_2_3: number;
  organ_db_2: number;
  organ_db_1_3_5: number;
  organ_db_1_1_3: number;
  organ_db_1: number;
  organ_percussion_on: boolean;
  organ_percussion_soft: boolean;
  organ_percussion_fast: boolean;
  organ_percussion_third: boolean;
  organ_vibrato_on: boolean;
  organ_vibrato_mode: number;
  organ_rotary_stop: boolean;
  organ_rotary_speed: boolean;
  organ_octave_shift: number;
  organ_sustain: boolean;
  organ_pstick: boolean;

  // Piano
  piano_on: boolean;
  piano_layer_a_on: boolean;
  piano_layer_a_focus: boolean;
  piano_layer_a_level: number;
  piano_layer_a_octave: number;
  piano_layer_b_on: boolean;
  piano_layer_b_focus: boolean;
  piano_layer_b_level: number;
  piano_layer_b_octave: number;
  piano_type: number; // 0..5: Grand, Upright, Electric, Clav, Digital, Misc
  piano_model: number; // 1..9
  piano_kb_touch: number; // 0..3: Off, Light, Med, Heavy
  piano_timbre: number; // 0..5: Off, Soft, Mid, Bright, Dyno 1, Dyno 2
  piano_dyn_comp: number; // 0..3: Off, 1, 2, 3
  piano_unison: number; // 0..3: Off, 1, 2, 3
  piano_soft_release: boolean;
  piano_string_res: boolean;
  piano_sustain: boolean;
  piano_pstick: boolean;
  piano_soft_pedal?: boolean;
  piano_sostenuto?: boolean;

  // Program & Morph
  program_number: number; // 1..32
  program_button: number; // 1..8
  program_page: number;
  live_mode: boolean;
  layer_scene: number; // 1..2
  store: boolean;
  split: boolean;
  morph_wheel: boolean;
  morph_aftertouch: boolean;
  morph_ctrlped: boolean;
  transpose: boolean;
  panic: boolean;

  // Synth
  synth_on: boolean;
  synth_layer_a_on: boolean;
  synth_layer_a_level: number;
  synth_layer_b_on: boolean;
  synth_layer_b_level: number;
  synth_layer_c_on: boolean;
  synth_layer_c_level: number;
  synth_osc_type: number; // 0..3
  synth_osc_mod: number;
  synth_filter_type: number; // 0..4
  synth_filter_cutoff: number;
  synth_filter_resonance: number;
  synth_filter_drive: number;
  synth_filter_env_amt: number;
  synth_amp_attack: number;
  synth_amp_decay: number;
  synth_amp_sustain: number;
  synth_amp_release: number;
  synth_mod_attack: number;
  synth_mod_decay: number;
  synth_mod_release: number;
  synth_lfo_rate: number;
  synth_lfo_amount: number;
  synth_arp_run: boolean;
  synth_arp_rate: number;
  synth_unison: boolean;
  synth_vibrato: boolean;
  synth_sustain: boolean;
  synth_pstick: boolean;

  // Layer Effects
  layer_effects_on: boolean; // All-effects bypass master button
  effect_1_on: boolean;
  effect_1_type: number;
  effect_1_rate: number;
  effect_1_amount: number;
  effect_2_on: boolean;
  effect_2_type: number;
  effect_2_rate: number;
  effect_2_amount: number;
  delay_on: boolean;
  delay_tempo: number;
  delay_feedback: number;
  delay_amount: number;
  delay_pingpong: boolean;
  delay_filter: number; // 0: Off, 1: LP, 2: HP, 3: BP
  delay_global: boolean;
  amp_eq_on: boolean;
  amp_type: number;
  amp_drive: number;
  eq_bass: number;
  eq_mid: number;
  eq_mid_freq: number;
  eq_treble: number;
  compressor_on: boolean;
  compressor_amount: number;
  compressor_fast: boolean;
  compressor_global: boolean;
  reverb_on: boolean;
  reverb_type: number;
  reverb_decay: number;
  reverb_amount: number;
  reverb_bright: boolean;
  reverb_global: boolean;
  rotary_on: boolean;
  rotary_speed: boolean; // false=slow, true=fast
  rotary_stop: boolean;
  rotary_drive: number;
  effects_group_piano: boolean;
  layer_focus_piano: boolean;
  layer_focus_organ: boolean;
  layer_focus_synth: boolean;
}

export const INITIAL_HARDWARE_STATE: HardwareState = {
  // Performance
  master_level: 7.0,
  pitch_stick: 0,
  mod_wheel: 0,

  // Organ
  organ_on: false,
  organ_model: 0,
  organ_preset_1: true,
  organ_preset_2: false,
  organ_db_16: 8,
  organ_db_5_1_3: 8,
  organ_db_8: 8,
  organ_db_4: 0,
  organ_db_2_2_3: 0,
  organ_db_2: 0,
  organ_db_1_3_5: 0,
  organ_db_1_1_3: 0,
  organ_db_1: 0,
  organ_percussion_on: false,
  organ_percussion_soft: false,
  organ_percussion_fast: false,
  organ_percussion_third: false,
  organ_vibrato_on: false,
  organ_vibrato_mode: 0,
  organ_rotary_stop: false,
  organ_rotary_speed: false,
  organ_octave_shift: 0,
  organ_sustain: true,
  organ_pstick: false,

  // Piano
  piano_on: true,
  piano_layer_a_on: true,
  piano_layer_a_focus: true,
  piano_layer_a_level: 8.5,
  piano_layer_a_octave: 0,
  piano_layer_b_on: false,
  piano_layer_b_focus: false,
  piano_layer_b_level: 6.0,
  piano_layer_b_octave: 0,
  piano_type: 0, // Grand
  piano_model: 1, // Concert Grand
  piano_kb_touch: 0, // Off
  piano_timbre: 0, // Off
  piano_dyn_comp: 0, // Off
  piano_unison: 0, // Off
  piano_soft_release: false,
  piano_string_res: true,
  piano_sustain: true,
  piano_pstick: false,
  piano_soft_pedal: false,
  piano_sostenuto: false,

  // Program
  program_number: 1,
  program_button: 1,
  program_page: 1,
  live_mode: false,
  layer_scene: 1,
  store: false,
  split: false,
  morph_wheel: false,
  morph_aftertouch: false,
  morph_ctrlped: false,
  transpose: false,
  panic: false,

  // Synth
  synth_on: false,
  synth_layer_a_on: true,
  synth_layer_a_level: 7.0,
  synth_layer_b_on: false,
  synth_layer_b_level: 5.0,
  synth_layer_c_on: false,
  synth_layer_c_level: 5.0,
  synth_osc_type: 0,
  synth_osc_mod: 5.0,
  synth_filter_type: 0,
  synth_filter_cutoff: 7.0,
  synth_filter_resonance: 2.0,
  synth_filter_drive: 0,
  synth_filter_env_amt: 3.0,
  synth_amp_attack: 0.1,
  synth_amp_decay: 3.0,
  synth_amp_sustain: 7.0,
  synth_amp_release: 1.5,
  synth_mod_attack: 0.2,
  synth_mod_decay: 2.0,
  synth_mod_release: 1.0,
  synth_lfo_rate: 4.0,
  synth_lfo_amount: 0,
  synth_arp_run: false,
  synth_arp_rate: 5.0,
  synth_unison: false,
  synth_vibrato: false,
  synth_sustain: true,
  synth_pstick: false,

  // Effects
  layer_effects_on: true,
  effect_1_on: false,
  effect_1_type: 0,
  effect_1_rate: 5.0,
  effect_1_amount: 5.0,
  effect_2_on: false,
  effect_2_type: 0,
  effect_2_rate: 5.0,
  effect_2_amount: 5.0,
  delay_on: false,
  delay_tempo: 5.0,
  delay_feedback: 4.0,
  delay_amount: 3.0,
  delay_pingpong: false,
  delay_filter: 0,
  delay_global: false,
  amp_eq_on: false,
  amp_type: 0,
  amp_drive: 2.0,
  eq_bass: 0,
  eq_mid: 0,
  eq_mid_freq: 5.0,
  eq_treble: 0,
  compressor_on: false,
  compressor_amount: 4.0,
  compressor_fast: false,
  compressor_global: false,
  reverb_on: false,
  reverb_type: 2, // Stage
  reverb_decay: 5.0,
  reverb_amount: 4.0,
  reverb_bright: false,
  reverb_global: false,
  rotary_on: false,
  rotary_speed: false,
  rotary_stop: false,
  rotary_drive: 2.0,
  effects_group_piano: false,
  layer_focus_piano: true,
  layer_focus_organ: false,
  layer_focus_synth: false,
};

export const SECTION_WIDTH_FRACTIONS = {
  performance: 0.14,
  organ: 0.2,
  piano: 0.085,
  program: 0.125,
  synth: 0.25,
  effects: 0.2,
} as const;

export const PIANO_TYPES = [
  'Grand',
  'Upright',
  'Electric',
  'Clav',
  'Digital',
  'Misc',
] as const;

export const ORGAN_MODELS = [
  'B3',
  'Vox',
  'Farfisa',
  'Pipe 1',
  'Pipe 2',
  'B3 Bass',
] as const;

export const EFFECT_1_TYPES = ['A-Pan', 'Trem', 'RM', 'A-Wah', 'Wah', 'Pump'] as const;
export const EFFECT_2_TYPES = ['Chorus', 'Flang', 'Phas', 'Vibe', 'Ens', 'Spin'] as const;
export const AMP_TYPES = ['EQ only', 'Twin', 'JC', 'Small', 'LP24', 'HP24', 'To Rotary'] as const;
export const REVERB_TYPES = ['Booth', 'Room', 'Stage', 'Hall', 'Cath', 'Spring'] as const;
export const DELAY_FILTER_MODES = ['Off', 'LP', 'HP', 'BP'] as const;
export const SYNTH_OSC_TYPES = ['Classic', 'Wave', 'Sample', 'FM'] as const;
export const SYNTH_FILTER_TYPES = ['LP24', 'LP12', 'LP/HP', 'BP', 'HP'] as const;
