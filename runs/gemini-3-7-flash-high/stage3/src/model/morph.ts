export type MorphSource = 'wheel' | 'ctrlped';

export type MorphDestination =
  | 'organ_layer_a_level'
  | 'organ_layer_b_level'
  | 'organ_db_16'
  | 'organ_db_5_1_3'
  | 'organ_db_8'
  | 'organ_db_4'
  | 'organ_db_2_2_3'
  | 'organ_db_2'
  | 'organ_db_1_3_5'
  | 'organ_db_1_1_3'
  | 'organ_db_1'
  | 'organ_rotary_speed'
  | 'piano_layer_a_level'
  | 'piano_layer_b_level'
  | 'synth_layer_a_level'
  | 'synth_layer_b_level'
  | 'synth_layer_c_level'
  | 'synth_lfo_rate'
  | 'synth_osc_mod'
  | 'synth_lfo_amount'
  | 'synth_filter_cutoff'
  | 'synth_filter_resonance'
  | 'synth_arp_rate'
  | 'effect_1_rate'
  | 'effect_1_amount'
  | 'effect_2_amount'
  | 'delay_tempo'
  | 'delay_feedback'
  | 'delay_amount'
  | 'eq_mid_freq'
  | 'amp_drive'
  | 'reverb_amount';

export interface MorphAssignment {
  source: MorphSource;
  destination: MorphDestination;
  baseValue: number;
  targetValue: number;
}

export interface MorphState {
  wheelValue: number; // 0..1
  ctrlPedValue: number; // 0..1
  activeMorphEditSource: MorphSource | null; // which morph source button is currently held/latched for assignment
  assignments: MorphAssignment[];
}

export const DEFAULT_MORPH_STATE: MorphState = {
  wheelValue: 0,
  ctrlPedValue: 0,
  activeMorphEditSource: null,
  assignments: [],
};

/**
 * Calculates the interpolated value for a destination parameter
 * given base value and active morph assignments.
 */
export function calculateMorphedValue(
  destination: MorphDestination,
  baseValue: number,
  morphState: MorphState
): number {
  let finalValue = baseValue;

  for (const assign of morphState.assignments) {
    if (assign.destination !== destination) continue;

    const sourceVal =
      assign.source === 'wheel' ? morphState.wheelValue : morphState.ctrlPedValue;

    // Interpolate: baseValue + (targetValue - baseValue) * sourceVal
    const delta = (assign.targetValue - assign.baseValue) * sourceVal;
    finalValue = assign.baseValue + delta;
  }

  return finalValue;
}

/**
 * Checks if a destination has any active morph assignment.
 */
export function hasMorphAssignment(
  destination: MorphDestination,
  morphState: MorphState,
  source?: MorphSource
): boolean {
  return morphState.assignments.some(
    (a) => a.destination === destination && (!source || a.source === source)
  );
}

/**
 * Gets all assignments for a destination.
 */
export function getMorphAssignmentsForDestination(
  destination: MorphDestination,
  morphState: MorphState
): MorphAssignment[] {
  return morphState.assignments.filter((a) => a.destination === destination);
}
