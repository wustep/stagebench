export const EFFECT_ORDER = ['mod1', 'mod2', 'delay', 'ampEq', 'compressor', 'reverb', 'rotary'] as const;
export type EffectId = (typeof EFFECT_ORDER)[number];
export type EffectSection = 'Organ' | 'Piano' | 'Synth';

export interface EffectUnitState {
  enabled: boolean;
  type: string;
  amount: number;
  rate: number;
  feedback: number;
  dryWet: number;
  drive: number;
  filterFrequency: number;
  resonance: number;
  global: boolean;
  group: boolean;
  target: EffectSection;
  toRotary: boolean;
}

export type EffectRackState = Record<EffectId, EffectUnitState>;

const unit = (type: string, target: EffectSection, values: Partial<EffectUnitState> = {}): EffectUnitState => ({
  enabled: true,
  type,
  amount: 0.35,
  rate: 0.35,
  feedback: 0.25,
  dryWet: 0.25,
  drive: 0.15,
  filterFrequency: 0.55,
  resonance: 0.15,
  global: false,
  group: false,
  target,
  toRotary: false,
  ...values,
});

export function createInitialEffectRack(): EffectRackState {
  return {
    mod1: unit('Tremolo', 'Piano', { amount: 0.18, rate: 0.3 }),
    mod2: unit('Chorus', 'Piano', { amount: 0.2, rate: 0.25 }),
    delay: unit('Clean delay', 'Piano', { amount: 0.22, feedback: 0.28, dryWet: 0.18, global: true }),
    ampEq: unit('Neutral EQ', 'Piano', { amount: 0.2, drive: 0.12 }),
    compressor: unit('Compressor', 'Piano', { amount: 0.2, global: true }),
    reverb: unit('Stage', 'Piano', { amount: 0.32, dryWet: 0.22, global: true }),
    rotary: unit('Rotary Speaker', 'Piano', { amount: 0.08, rate: 0.3, enabled: false }),
  };
}

export function patchEffectRack(rack: EffectRackState, id: EffectId, patch: Partial<EffectUnitState>): EffectRackState {
  return { ...rack, [id]: { ...rack[id], ...patch } };
}

export function setAllEffectsEnabled(rack: EffectRackState, enabled: boolean): EffectRackState {
  return Object.fromEntries(EFFECT_ORDER.map((id) => [id, { ...rack[id], enabled }])) as EffectRackState;
}

export function processEffectFrame(input: Float32Array, rack: EffectRackState): Float32Array {
  let output = new Float32Array(input);
  const mod1 = rack.mod1;
  if (mod1.enabled) {
    const depth = Math.min(0.9, mod1.amount);
    output = output.map((sample, index) => sample * (1 - depth * 0.5 + depth * 0.5 * Math.sin(index * (0.015 + mod1.rate * 0.06))));
  }
  const mod2 = rack.mod2;
  if (mod2.enabled) {
    const amount = Math.min(0.8, mod2.amount);
    output = output.map((sample, index) => sample * (1 - amount * 0.15) + (input[index - 2] ?? 0) * amount * 0.15 * Math.sin(index * (0.01 + mod2.rate * 0.03)));
  }
  const delay = rack.delay;
  if (delay.enabled && delay.dryWet > 0) {
    const delayed = new Float32Array(output);
    const offset = Math.max(1, Math.round(2 + delay.rate * 12));
    for (let index = offset; index < delayed.length; index += 1) delayed[index] += delayed[index - offset] * delay.feedback * delay.dryWet;
    output = output.map((sample, index) => sample * (1 - delay.dryWet) + delayed[index] * delay.dryWet);
  }
  const ampEq = rack.ampEq;
  if (ampEq.enabled) output = output.map((sample) => Math.tanh(sample * (1 + ampEq.drive * 4)) * (1 + ampEq.amount * 0.1));
  const compressor = rack.compressor;
  if (compressor.enabled) {
    const threshold = 0.65 - compressor.amount * 0.35;
    output = output.map((sample) => Math.sign(sample) * (Math.abs(sample) > threshold ? threshold + (Math.abs(sample) - threshold) * 0.35 : Math.abs(sample)));
  }
  const reverb = rack.reverb;
  if (reverb.enabled && reverb.dryWet > 0) {
    const tail = new Float32Array(output.length);
    for (let index = 1; index < output.length; index += 1) tail[index] = tail[index - 1] * 0.92 + output[index - 1] * 0.08;
    output = output.map((sample, index) => sample * (1 - reverb.dryWet) + tail[index] * reverb.dryWet);
  }
  const rotary = rack.rotary;
  if (rotary.enabled) output = output.map((sample, index) => sample * (0.9 + 0.1 * Math.sin(index * (0.03 + rotary.rate * 0.07))));
  return output;
}
