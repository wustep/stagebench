import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../App';
import { STAGE_4_73_KEYS, KEYBED_CONFIG } from '../model/keyboard';

describe('Visual Specifications (Phase 1)', () => {
  describe('visual.key-count', () => {
    it('models exactly 73 keys from E1 (MIDI 28) to E7 (MIDI 100)', () => {
      expect(STAGE_4_73_KEYS).toHaveLength(73);
      expect(KEYBED_CONFIG.totalKeys).toBe(73);
      expect(KEYBED_CONFIG.whiteKeys).toBe(43);
      expect(KEYBED_CONFIG.blackKeys).toBe(30);
      expect(KEYBED_CONFIG.startMidi).toBe(28);
      expect(KEYBED_CONFIG.endMidi).toBe(100);
      expect(KEYBED_CONFIG.range).toBe('E to E');
      expect(KEYBED_CONFIG.blackKeyHeightFraction).toBe(0.61);

      const whiteKeys = STAGE_4_73_KEYS.filter((k) => !k.isBlack);
      const blackKeys = STAGE_4_73_KEYS.filter((k) => k.isBlack);
      expect(whiteKeys).toHaveLength(43);
      expect(blackKeys).toHaveLength(30);

      // Verify first key is E1 (28) and last key is E7 (100)
      expect(STAGE_4_73_KEYS[0].midi).toBe(28);
      expect(STAGE_4_73_KEYS[0].noteName).toBe('E1');
      expect(STAGE_4_73_KEYS[STAGE_4_73_KEYS.length - 1].midi).toBe(100);
      expect(STAGE_4_73_KEYS[STAGE_4_73_KEYS.length - 1].noteName).toBe('E7');
    });

    it('renders all 73 physical keys in DOM with correct roles and aria attributes', () => {
      const { container } = render(<App />);
      const keys = container.querySelectorAll('.key');
      expect(keys.length).toBe(73);

      const firstKey = container.querySelector('#key-28');
      expect(firstKey).toBeInTheDocument();
      expect(firstKey?.getAttribute('aria-label')).toContain('E1');

      const lastKey = container.querySelector('#key-100');
      expect(lastKey).toBeInTheDocument();
      expect(lastKey?.getAttribute('aria-label')).toContain('E7');
    });
  });

  describe('visual.section-layout', () => {
    it('renders the 6 ordered sections at documented widths with continuous chassis', () => {
      const { container } = render(<App />);

      const chassis = container.querySelector('#nord-stage-4-instrument');
      expect(chassis).toBeInTheDocument();
      expect(chassis).toHaveClass('nord-stage-4-chassis');

      const deckZone = container.querySelector('.chassis-deck-zone');
      const keybedZone = container.querySelector('.chassis-keybed-zone');
      expect(deckZone).toBeInTheDocument();
      expect(keybedZone).toBeInTheDocument();

      const sections = container.querySelectorAll('.deck-section-wrapper');
      expect(sections.length).toBe(6);

      // Section order: Performance, Organ, Piano, Program, Synth, Effects
      expect(container.querySelector('#section-performance')).toBeInTheDocument();
      expect(container.querySelector('#section-organ')).toBeInTheDocument();
      expect(container.querySelector('#section-piano')).toBeInTheDocument();
      expect(container.querySelector('#section-program')).toBeInTheDocument();
      expect(container.querySelector('#section-synth')).toBeInTheDocument();
      expect(container.querySelector('#section-effects')).toBeInTheDocument();

      // Check section widths
      const perfWrapper = container.querySelector('.deck-section-performance') as HTMLElement;
      const organWrapper = container.querySelector('.deck-section-organ') as HTMLElement;
      const pianoWrapper = container.querySelector('.deck-section-piano') as HTMLElement;
      const progWrapper = container.querySelector('.deck-section-program') as HTMLElement;
      const synthWrapper = container.querySelector('.deck-section-synth') as HTMLElement;
      const fxWrapper = container.querySelector('.deck-section-effects') as HTMLElement;

      expect(perfWrapper.style.flex).toContain('14%');
      expect(organWrapper.style.flex).toContain('20%');
      expect(pianoWrapper.style.flex).toContain('8.5%');
      expect(progWrapper.style.flex).toContain('12.5%');
      expect(synthWrapper.style.flex).toContain('25%');
      expect(fxWrapper.style.flex).toContain('20%');
    });
  });

  describe('visual.control-inventory', () => {
    it('contains all documented physical landmark controls per section', () => {
      const { container } = render(<App />);

      // Performance landmarks
      expect(container.querySelector('#master-level')).toBeInTheDocument();
      expect(container.querySelector('#pitch-stick')).toBeInTheDocument();
      expect(container.querySelector('#mod-wheel')).toBeInTheDocument();
      expect(container.querySelector('.nord-logo-main')).toHaveTextContent(/nord stage 4/i);

      // Organ landmarks: 9 drawbars and rotary
      expect(container.querySelector('#organ-db-16')).toBeInTheDocument();
      expect(container.querySelector('#organ-db-8')).toBeInTheDocument();
      expect(container.querySelector('#organ-db-1')).toBeInTheDocument();
      expect(container.querySelector('#organ-rotary-speed')).toBeInTheDocument();

      // Piano landmarks
      expect(container.querySelector('#piano-layer-a-level')).toBeInTheDocument();
      expect(container.querySelector('#piano-layer-b-level')).toBeInTheDocument();
      expect(container.querySelector('#piano-type-btn')).toBeInTheDocument();
      expect(container.querySelector('#piano-model-dial')).toBeInTheDocument();

      // Program landmarks: primary OLED, dial, 8 buttons
      expect(container.querySelector('#program-oled')).toBeInTheDocument();
      expect(container.querySelector('#program-dial')).toBeInTheDocument();
      expect(container.querySelector('#program-btn-1')).toBeInTheDocument();
      expect(container.querySelector('#program-btn-8')).toBeInTheDocument();

      // Synth landmarks: synth OLED, layer faders, filter/env controls
      expect(container.querySelector('#synth-oled')).toBeInTheDocument();
      expect(container.querySelector('#synth-layer-a-level')).toBeInTheDocument();
      expect(container.querySelector('#synth-filter-cutoff')).toBeInTheDocument();
      expect(container.querySelector('#synth-amp-attack')).toBeInTheDocument();

      // Effects landmarks: 6 units + layer focus
      expect(container.querySelector('#effect-1-on')).toBeInTheDocument();
      expect(container.querySelector('#effect-2-on')).toBeInTheDocument();
      expect(container.querySelector('#delay-on')).toBeInTheDocument();
      expect(container.querySelector('#amp-eq-on')).toBeInTheDocument();
      expect(container.querySelector('#compressor-on')).toBeInTheDocument();
      expect(container.querySelector('#reverb-on')).toBeInTheDocument();
      expect(container.querySelector('#focus-piano')).toBeInTheDocument();
    });

    it('has OLED displays ONLY in Program and Synth sections, strictly forbidden elsewhere', () => {
      const { container } = render(<App />);
      const oledDisplays = container.querySelectorAll('.oled-display-screen');
      expect(oledDisplays.length).toBe(2);

      const progOled = container.querySelector('#section-program #program-oled');
      const synthOled = container.querySelector('#section-synth #synth-oled');
      expect(progOled).toBeInTheDocument();
      expect(synthOled).toBeInTheDocument();

      // Forbidden elsewhere
      expect(container.querySelector('#section-performance .oled-display-screen')).toBeNull();
      expect(container.querySelector('#section-organ .oled-display-screen')).toBeNull();
      expect(container.querySelector('#section-piano .oled-display-screen')).toBeNull();
      expect(container.querySelector('#section-effects .oled-display-screen')).toBeNull();
    });
  });

  describe('regression.chassis', () => {
    it('has no marketing heroes or detached rails and maintains clean layout hierarchy', () => {
      const { container } = render(<App />);
      expect(container.querySelector('.hero-banner')).toBeNull();
      expect(container.querySelector('.marketing-title')).toBeNull();
      expect(container.querySelector('.chassis-top-rail')).toBeInTheDocument();
      expect(container.querySelector('.chassis-bottom-rail')).toBeInTheDocument();
      expect(container.querySelector('.keybed-container')).toBeInTheDocument();
    });
  });
});
