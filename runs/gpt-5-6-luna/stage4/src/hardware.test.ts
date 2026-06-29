import { describe, expect, it } from 'vitest';
import { allControls, createKeyModel, keyboardModel, sections } from './hardware';

describe('Stage 4 88 hardware model', () => {
  it('models the selected A-to-C 88-key hammer-action keyboard', () => {
    const model = createKeyModel();
    expect(keyboardModel).toMatchObject({ variant: 'stage-4-88', action: 'hammer action', range: 'A to C', totalKeys: 88 });
    expect(model.keys).toHaveLength(88);
    expect(model.white).toHaveLength(52);
    expect(model.black).toHaveLength(36);
    expect(model.keys.slice(0, 12).map((key) => key.isBlack)).toEqual([false, true, false, false, true, false, true, false, false, true, false, true]);
  });

  it('keeps the six sections ordered with normalized reference ratios', () => {
    expect(sections.map((section) => section.id)).toEqual(['performance', 'organ', 'piano', 'program', 'synth', 'effects']);
    expect(sections.reduce((sum, section) => sum + section.fraction, 0)).toBeCloseTo(1);
    expect(sections.map((section) => section.fraction)).toEqual([0.13, 0.21, 0.15, 0.09, 0.21, 0.21]);
  });

  it('has stable, section-specific controls and only two primary OLED owners', () => {
    expect(new Set(allControls.map((control) => control.id)).size).toBe(allControls.length);
    expect(sections.find((section) => section.id === 'organ')?.controls.filter((control) => control.group === 'drawbars')).toHaveLength(9);
    expect(sections.find((section) => section.id === 'program')?.primaryDisplay).toBe('program-display');
    expect(sections.find((section) => section.id === 'synth')?.primaryDisplay).toBe('synth-display');
    expect(sections.filter((section) => section.primaryDisplay)).toHaveLength(2);
    expect(sections.filter((section) => ['performance', 'organ', 'piano', 'effects'].includes(section.id)).every((section) => !section.primaryDisplay)).toBe(true);
    expect(allControls.some((control) => control.id === 'performance-pitch-stick')).toBe(false);
  });
});
