import { describe, expect, it } from 'vitest';
import {
  CONTROLS,
  CONTROLS_BY_ID,
  SECTIONS,
  controlsForSection,
  OLED_SECTIONS,
  type SectionId,
} from '../src/model/controls';

// feature: visual.section-layout, visual.control-inventory
describe('section layout (visual.section-layout)', () => {
  it('has the six ordered sections at documented widths', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual([
      'performance',
      'organ',
      'piano',
      'program',
      'synth',
      'effects',
    ]);
    const fractions: Record<SectionId, number> = {
      performance: 0.13,
      organ: 0.21,
      piano: 0.15,
      program: 0.09,
      synth: 0.21,
      effects: 0.21,
    };
    for (const s of SECTIONS) expect(s.fraction).toBeCloseTo(fractions[s.id], 5);
  });

  it('section fractions sum to 1', () => {
    const sum = SECTIONS.reduce((a, s) => a + s.fraction, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it('performance is exposed chassis (no inset plate)', () => {
    expect(SECTIONS.find((s) => s.id === 'performance')?.surface).toBe('chassis');
  });
});

describe('control inventory (visual.control-inventory)', () => {
  it('every control has a stable unique id and an accessible name', () => {
    const ids = new Set<string>();
    for (const ctrl of CONTROLS) {
      expect(ctrl.id).toMatch(/^[a-z0-9-]+$/);
      expect(ctrl.name.length).toBeGreaterThan(0);
      expect(ids.has(ctrl.id)).toBe(false);
      ids.add(ctrl.id);
    }
    expect(CONTROLS_BY_ID.size).toBe(CONTROLS.length);
  });

  it('each section carries its required landmark controls', () => {
    // Organ: nine drawbars.
    const drawbars = controlsForSection('organ').filter((c) => c.kind === 'drawbar');
    expect(drawbars).toHaveLength(9);
    // Piano: type selector with all six types.
    const type = CONTROLS_BY_ID.get('piano-type');
    expect(type?.options).toEqual(['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc']);
    // Program: eight program buttons + large dial.
    const progButtons = controlsForSection('program').filter((c) => /program-button-\d/.test(c.id));
    expect(progButtons).toHaveLength(8);
    expect(CONTROLS_BY_ID.get('program-dial')?.kind).toBe('encoder');
    // Synth: three layer faders.
    const synthFaders = controlsForSection('synth').filter((c) => c.kind === 'fader');
    expect(synthFaders).toHaveLength(3);
    // Effects: mod1, mod2, delay, amp, comp, reverb on-buttons present.
    for (const id of [
      'effects-mod1-on',
      'effects-mod2-on',
      'effects-delay-on',
      'effects-amp-on',
      'effects-comp-on',
      'effects-reverb-on',
    ]) {
      expect(CONTROLS_BY_ID.has(id)).toBe(true);
    }
  });

  it('Program and Synth are the only OLED sections', () => {
    expect([...OLED_SECTIONS].sort()).toEqual(['program', 'synth']);
  });

  it('every section has at least one control', () => {
    for (const s of SECTIONS) {
      expect(controlsForSection(s.id).length).toBeGreaterThan(0);
    }
  });
});
