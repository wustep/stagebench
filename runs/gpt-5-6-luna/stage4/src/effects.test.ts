import { describe, expect, it } from 'vitest';
import { EFFECT_ORDER, createInitialEffectRack, processEffectFrame, setAllEffectsEnabled } from './effects';

describe('connected representative effect behavior', () => {
  it('keeps the documented order and bypasses every unit', () => {
    const rack = createInitialEffectRack();
    expect(EFFECT_ORDER).toEqual(['mod1', 'mod2', 'delay', 'ampEq', 'compressor', 'reverb', 'rotary']);
    const bypassed = setAllEffectsEnabled(rack, false);
    expect(Object.values(bypassed).every((unit) => !unit.enabled)).toBe(true);
  });

  it('changes a rendered audio frame for each representative family and restores by bypass', () => {
    const input = new Float32Array(Array.from({ length: 96 }, (_, index) => Math.sin(index * 0.19) * 0.65));
    const rack = createInitialEffectRack();
    for (const id of EFFECT_ORDER) {
      const changed = processEffectFrame(input, { ...rack, [id]: { ...rack[id], enabled: true, amount: 0.8, dryWet: 0.8, drive: 0.8, feedback: 0.65, toRotary: true } });
      expect(Array.from(changed)).not.toEqual(Array.from(input));
    }
    expect(Array.from(processEffectFrame(input, setAllEffectsEnabled(rack, false)))).toEqual(Array.from(input));
  });
});
