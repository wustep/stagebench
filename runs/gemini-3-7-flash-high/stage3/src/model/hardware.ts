import { SplitPosition, CrossfadeWidth, LayerZoneAssignment, ALL_ZONES_ASSIGNMENT } from './splits';
import { MorphSource, MorphAssignment } from './morph';

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
  pitch_stick: number; // -1..+1
  mod_wheel: number; // 0..1
  ctrl_pedal: number; // 0..1 (virtual control pedal / MIDI CC11)
  tempo_bpm: number; // 30..300 BPM
  transpose: number; // -6..+6 semitones
  transpose_active: boolean;
  panic: boolean;

  // Program & Performance System
  program_number: number; // 1..32
  program_button: number; // 1..8
  program_page: number; // 1..4
  live_mode: boolean;
  live_slot: number; // 1..8
  store_mode: boolean;
  store_as_mode: boolean;
  store_target_slot: number;
  store_as_name: string;
  list_view_open: boolean;
  is_dirty: boolean;
  layer_scene: 1 | 2;

  // Splits & Zones
  split: boolean; // SPLIT ON/SET toggle
  split_menu_open: boolean;
  split_low_active: boolean;
  split_low_pos: SplitPosition;
  split_low_xfade: CrossfadeWidth;
  split_mid_active: boolean;
  split_mid_pos: SplitPosition;
  split_mid_xfade: CrossfadeWidth;
  split_high_active: boolean;
  split_high_pos: SplitPosition;
  split_high_xfade: CrossfadeWidth;

  // Morphs
  morph_wheel: boolean;
  morph_aftertouch: boolean;
  morph_ctrlped: boolean;
  morph_edit_source: MorphSource | null;
  morph_assignments: MorphAssignment[];

  // Organ Section
  organ_on: boolean;
  organ_model: number; // 0: B3, 1: Vox, 2: Farf, 3: Pipe 1, 4: Pipe 2, 5: B3 Bass
  organ_layer_a_on: boolean;
  organ_layer_a_focus: boolean;
  organ_layer_a_level: number;
  organ_layer_a_octave: number;
  organ_layer_a_vibrato: boolean;
  organ_layer_a_zones: LayerZoneAssignment;
  organ_layer_b_on: boolean;
  organ_layer_b_focus: boolean;
  organ_layer_b_level: number;
  organ_layer_b_octave: number;
  organ_layer_b_vibrato: boolean;
  organ_layer_b_zones: LayerZoneAssignment;

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
  organ_vibrato_mode: number; // 0: C1, 1: C2, 2: C3, 3: V1, 4: V2, 5: V3
  organ_rotary_stop: boolean;
  organ_rotary_speed: boolean; // false=slow, true=fast
  organ_octave_shift: number;
  organ_sustain: boolean;
  organ_pstick: boolean;

  // Piano Section
  piano_on: boolean;
  piano_layer_a_on: boolean;
  piano_layer_a_focus: boolean;
  piano_layer_a_level: number;
  piano_layer_a_octave: number;
  piano_layer_a_zones: LayerZoneAssignment;
  piano_layer_b_on: boolean;
  piano_layer_b_focus: boolean;
  piano_layer_b_level: number;
  piano_layer_b_octave: number;
  piano_layer_b_zones: LayerZoneAssignment;
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

  // Synth Section
  synth_on: boolean;
  synth_layer_a_on: boolean;
  synth_layer_a_focus: boolean;
  synth_layer_a_level: number;
  synth_layer_a_octave: number;
  synth_layer_a_zones: LayerZoneAssignment;
  synth_layer_b_on: boolean;
  synth_layer_b_focus: boolean;
  synth_layer_b_level: number;
  synth_layer_b_octave: number;
  synth_layer_b_zones: LayerZoneAssignment;
  synth_layer_c_on: boolean;
  synth_layer_c_focus: boolean;
  synth_layer_c_level: number;
  synth_layer_c_octave: number;
  synth_layer_c_zones: LayerZoneAssignment;

  synth_osc_category: number; // 0: Pure, 1: Sync, 2: Multi, 3: Super, 4: FM-H
  synth_osc_type: number; // alias for synth_osc_category / display
  synth_waveform: number;
  synth_osc_mod: number; // Osc Ctrl (0..10)
  synth_filter_type: number; // 0: LP12, 1: LP24, 2: HP, 3: BP
  synth_filter_cutoff: number; // 0..10
  synth_filter_resonance: number; // 0..10
  synth_filter_drive: number; // 0..3
  synth_filter_env_amt: number; // -10..+10
  synth_filter_kb_tracking: number; // 0: Off, 1: 1/3, 2: 2/3, 3: 1

  synth_amp_attack: number;
  synth_amp_decay: number;
  synth_amp_sustain: number;
  synth_amp_release: number;
  synth_amp_velocity: number; // 0..3

  synth_mod_attack: number;
  synth_mod_decay: number;
  synth_mod_release: number;
  synth_mod_velocity: boolean;
  synth_mod_to_pitch: boolean;
  synth_mod_env_amt: number;

  synth_lfo_waveform: number; // 0: Tri, 1: Saw down, 2: Saw up, 3: Square, 4: S&H
  synth_lfo_destination: number; // 0: Off, 1: Osc Pitch, 2: Osc Ctrl, 3: Filter Freq
  synth_lfo_rate: number;
  synth_lfo_amount: number;
  synth_lfo_clock_sync: boolean;

  synth_voice_mode: number; // 0: Poly, 1: Mono, 2: Legato
  synth_voice_priority: number; // 0: Off, 1: Low, 2: High
  synth_glide: number; // 0..10
  synth_unison: boolean; // boolean or 0..3
  synth_unison_level: number; // 0..3
  synth_vibrato: boolean;
  synth_vibrato_mode: number; // 0: Off, 1: On, 2: Wheel
  synth_vibrato_rate: number;
  synth_vibrato_amount: number;

  synth_arp_mode: number; // 0: Arp, 1: Poly, 2: Gate
  synth_arp_direction: number; // 0: Up, 1: Down, 2: Up/Down, 3: Random
  synth_arp_range: number; // 1..4
  synth_arp_rate: number;
  synth_arp_clock_sync: boolean;
  synth_arp_kb_hold: boolean;
  synth_arp_run: boolean;

  synth_sustain: boolean;
  synth_pstick: boolean;
  synth_pitch_coarse: number;
  synth_pitch_fine: number;

  // Layer Effects
  layer_effects_on: boolean; // All-effects bypass master button
  effects_group_piano: boolean;
  effects_group_synth: boolean;
  layer_focus_section: 'piano' | 'organ' | 'synth';
  layer_focus_piano: boolean;
  layer_focus_organ: boolean;
  layer_focus_synth: boolean;

  effect_1_on: boolean;
  effect_1_type: number;
  effect_1_rate: number;
  effect_1_amount: number;
  effect_1_clock_sync: boolean;

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
  delay_clock_sync: boolean;

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
  rotary_organ_routed: boolean;
}

export const INITIAL_HARDWARE_STATE: HardwareState = {
  // Performance
  master_level: 7.0,
  pitch_stick: 0,
  mod_wheel: 0,
  ctrl_pedal: 0,
  tempo_bpm: 120,
  transpose: 0,
  transpose_active: false,
  panic: false,

  // Program
  program_number: 1,
  program_button: 1,
  program_page: 1,
  live_mode: false,
  live_slot: 1,
  store_mode: false,
  store_as_mode: false,
  store_target_slot: 1,
  store_as_name: 'Concert Grand',
  list_view_open: false,
  is_dirty: false,
  layer_scene: 1,

  // Splits & Zones
  split: false,
  split_menu_open: false,
  split_low_active: false,
  split_low_pos: 'C3',
  split_low_xfade: 0,
  split_mid_active: true,
  split_mid_pos: 'C4',
  split_mid_xfade: 0,
  split_high_active: false,
  split_high_pos: 'C5',
  split_high_xfade: 0,

  // Morphs
  morph_wheel: false,
  morph_aftertouch: false,
  morph_ctrlped: false,
  morph_edit_source: null,
  morph_assignments: [],

  // Organ
  organ_on: false,
  organ_model: 0,
  organ_layer_a_on: true,
  organ_layer_a_focus: true,
  organ_layer_a_level: 8.0,
  organ_layer_a_octave: 0,
  organ_layer_a_vibrato: true,
  organ_layer_a_zones: { ...ALL_ZONES_ASSIGNMENT },
  organ_layer_b_on: false,
  organ_layer_b_focus: false,
  organ_layer_b_level: 7.0,
  organ_layer_b_octave: 0,
  organ_layer_b_vibrato: false,
  organ_layer_b_zones: { ...ALL_ZONES_ASSIGNMENT },

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
  piano_layer_a_zones: { ...ALL_ZONES_ASSIGNMENT },
  piano_layer_b_on: false,
  piano_layer_b_focus: false,
  piano_layer_b_level: 6.0,
  piano_layer_b_octave: 0,
  piano_layer_b_zones: { ...ALL_ZONES_ASSIGNMENT },
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

  // Synth
  synth_on: false,
  synth_layer_a_on: true,
  synth_layer_a_focus: true,
  synth_layer_a_level: 7.5,
  synth_layer_a_octave: 0,
  synth_layer_a_zones: { ...ALL_ZONES_ASSIGNMENT },
  synth_layer_b_on: false,
  synth_layer_b_focus: false,
  synth_layer_b_level: 5.0,
  synth_layer_b_octave: 0,
  synth_layer_b_zones: { ...ALL_ZONES_ASSIGNMENT },
  synth_layer_c_on: false,
  synth_layer_c_focus: false,
  synth_layer_c_level: 5.0,
  synth_layer_c_octave: 0,
  synth_layer_c_zones: { ...ALL_ZONES_ASSIGNMENT },

  synth_osc_category: 0, // Pure
  synth_osc_type: 0,
  synth_waveform: 2, // Saw
  synth_osc_mod: 0,
  synth_filter_type: 1, // LP24
  synth_filter_cutoff: 7.0,
  synth_filter_resonance: 2.0,
  synth_filter_drive: 0,
  synth_filter_env_amt: 3.0,
  synth_filter_kb_tracking: 3,

  synth_amp_attack: 0.05,
  synth_amp_decay: 2.0,
  synth_amp_sustain: 8.0,
  synth_amp_release: 1.0,
  synth_amp_velocity: 1,

  synth_mod_attack: 0.1,
  synth_mod_decay: 1.5,
  synth_mod_release: 1.0,
  synth_mod_velocity: false,
  synth_mod_to_pitch: false,
  synth_mod_env_amt: 0,

  synth_lfo_waveform: 0,
  synth_lfo_destination: 0,
  synth_lfo_rate: 4.0,
  synth_lfo_amount: 0,
  synth_lfo_clock_sync: false,

  synth_voice_mode: 0, // Poly
  synth_voice_priority: 0,
  synth_glide: 0,
  synth_unison: false,
  synth_unison_level: 0,
  synth_vibrato: false,
  synth_vibrato_mode: 0,
  synth_vibrato_rate: 5.0,
  synth_vibrato_amount: 2.0,

  synth_arp_mode: 0,
  synth_arp_direction: 0,
  synth_arp_range: 1,
  synth_arp_rate: 5.0,
  synth_arp_clock_sync: false,
  synth_arp_kb_hold: false,
  synth_arp_run: false,

  synth_sustain: true,
  synth_pstick: false,
  synth_pitch_coarse: 0,
  synth_pitch_fine: 0,

  // Layer Effects
  layer_effects_on: true,
  effects_group_piano: false,
  effects_group_synth: false,
  layer_focus_section: 'piano',
  layer_focus_piano: true,
  layer_focus_organ: false,
  layer_focus_synth: false,

  effect_1_on: false,
  effect_1_type: 0,
  effect_1_rate: 5.0,
  effect_1_amount: 5.0,
  effect_1_clock_sync: false,

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
  delay_clock_sync: false,

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
  rotary_organ_routed: true,
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
  'Farf',
  'Pipe 1',
  'Pipe 2',
  'B3 Bass',
] as const;

export const ORGAN_VIBRATO_MODES = ['C1', 'C2', 'C3', 'V1', 'V2', 'V3'] as const;

export const SYNTH_OSC_CATEGORIES = ['Pure', 'Sync', 'Multi', 'Super', 'FM-H'] as const;

export const SYNTH_WAVEFORMS: Record<string, string[]> = {
  Pure: ['Sine', 'Triangle', 'Saw', 'Square', 'Pulse 33', 'Pulse 10', 'White Noise'],
  Sync: ['Sync Saw', 'Sync Square'],
  Multi: ['Multi Saw', 'Multi Saw 8ve'],
  Super: ['Super Saw', 'Super Square'],
  'FM-H': ['FM 2-op (algorithm A)'],
};

export const SYNTH_FILTER_TYPES = ['LP12', 'LP24', 'HP', 'BP'] as const;
export const SYNTH_LFO_WAVEFORMS = ['Triangle', 'Saw down', 'Saw up', 'Square', 'Sample & Hold'] as const;
export const SYNTH_LFO_DESTINATIONS = ['Off', 'Osc Pitch', 'Osc Ctrl', 'Filter Freq'] as const;
export const SYNTH_VOICE_MODES = ['Poly', 'Mono', 'Legato'] as const;
export const SYNTH_ARP_MODES = ['Arp', 'Poly', 'Gate'] as const;
export const SYNTH_ARP_DIRECTIONS = ['Up', 'Down', 'Up/Down', 'Random'] as const;

export const EFFECT_1_TYPES = ['A-Pan', 'Trem', 'RM', 'A-Wah', 'Wah', 'Pump'] as const;
export const EFFECT_2_TYPES = ['Chorus', 'Flang', 'Phas', 'Vibe', 'Ens', 'Spin'] as const;
export const AMP_TYPES = ['EQ only', 'Twin', 'JC', 'Small', 'LP24', 'HP24', 'To Rotary'] as const;
export const REVERB_TYPES = ['Booth', 'Room', 'Stage', 'Hall', 'Cath', 'Spring'] as const;
export const DELAY_FILTER_MODES = ['Off', 'LP', 'HP', 'BP'] as const;
