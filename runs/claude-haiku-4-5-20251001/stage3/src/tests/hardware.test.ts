import { describe, it, expect } from 'vitest';
import { createHardwareModel, VARIANTS, SECTION_CONFIG } from '../model/hardware';

describe('Hardware Model', () => {
  it('creates hardware model with correct variant', () => {
    const hardware = createHardwareModel('stage-4-73');
    expect(hardware.variant.id).toBe('stage-4-73');
    expect(hardware.variant.keyCount).toBe(73);
  });

  it('has all six sections', () => {
    const hardware = createHardwareModel('stage-4-73');
    expect(hardware.sections).toHaveLength(6);
    expect(hardware.sections.map((s) => s.id)).toEqual([
      'performance',
      'organ',
      'piano',
      'program',
      'synth',
      'effects',
    ]);
  });

  it('section fractions sum to 1.0', () => {
    const total = SECTION_CONFIG.reduce((sum, section) => sum + section.fraction, 0);
    expect(Math.abs(total - 1.0)).toBeLessThan(0.001);
  });

  it('piano state initialized correctly', () => {
    const hardware = createHardwareModel('stage-4-73');
    expect(hardware.piano.enabled).toBe(true);
    expect(hardware.piano.activeLayers).toContain('A');
    expect(hardware.piano.selectedType).toBe('Grand');
    expect(hardware.piano.currentVoices).toHaveLength(0);
  });

  it('stage-4-73 has exactly 73 keys', () => {
    const variant = VARIANTS['stage-4-73'];
    expect(variant.keyCount).toBe(73);
    expect(variant.whiteKeys).toBe(43);
    expect(variant.blackKeys).toBe(30);
    expect(variant.whiteKeys + variant.blackKeys).toBe(73);
  });

  it('has correct aspect ratio for stage-4-73', () => {
    const variant = VARIANTS['stage-4-73'];
    expect(variant.aspectRatio).toBeCloseTo(3.0951, 3);
  });
});
