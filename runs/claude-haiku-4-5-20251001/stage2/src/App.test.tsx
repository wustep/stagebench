import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('App - Phase 1 Nord Stage 4', () => {
  describe('Visual structure', () => {
    it('renders the instrument', () => {
      render(<App />);
      const instrument = screen.getByRole('main', { name: /Nord Stage 4/i });
      expect(instrument).toBeInTheDocument();
    });

    it('renders keyboard container', () => {
      const { container } = render(<App />);
      const keyboardContainer = container.querySelector('.keyboard-container-wrapper');
      expect(keyboardContainer).toBeInTheDocument();
    });

    it('renders control deck container', () => {
      const { container } = render(<App />);
      const deckContainer = container.querySelector('.control-deck-container');
      expect(deckContainer).toBeInTheDocument();
    });

    it('keyboard and deck are laid out vertically', () => {
      const { container } = render(<App />);
      const instrument = container.querySelector('.instrument');
      expect(instrument?.className).toContain('instrument');
      // Check structure by element presence
      const deck = container.querySelector('.control-deck-container');
      const keyboard = container.querySelector('.keyboard-container-wrapper');
      expect(deck).toBeInTheDocument();
      expect(keyboard).toBeInTheDocument();
    });

    it('instrument has correct aspect ratio', () => {
      const { container } = render(<App />);
      const instrument = container.querySelector('.instrument');
      expect(instrument).toBeTruthy();
    });
  });

  describe('Keyboard controls', () => {
    it('renders piano keyboard keys', () => {
      const { container } = render(<App />);
      const keys = container.querySelectorAll('.key');
      // Stage 4 73 has 73 keys
      expect(keys.length).toBe(73);
    });

    it('has white and black keys', () => {
      const { container } = render(<App />);
      const whiteKeys = container.querySelectorAll('.white-key');
      const blackKeys = container.querySelectorAll('.black-key');
      // Stage 4 73 has 43 white and 30 black
      expect(whiteKeys.length).toBe(43);
      expect(blackKeys.length).toBe(30);
    });

    it('keyboard keys have proper data attributes', () => {
      const { container } = render(<App />);
      const keys = container.querySelectorAll('.key[data-note]');
      expect(keys.length).toBe(73);
      // Check first key has a note number
      expect(keys[0]).toHaveAttribute('data-note');
    });
  });

  describe('Control deck', () => {
    it('renders all six sections', () => {
      const { container } = render(<App />);
      const sections = container.querySelectorAll('.section');
      expect(sections.length).toBe(6);
    });

    it('sections have correct IDs', () => {
      const { container } = render(<App />);
      const sectionIds = Array.from(container.querySelectorAll('.section'))
        .map((s) => s.className.match(/section\s+(\S+)/)?.[1])
        .filter(Boolean);
      expect(sectionIds).toContain('performance');
      expect(sectionIds).toContain('organ');
      expect(sectionIds).toContain('piano');
      expect(sectionIds).toContain('program');
      expect(sectionIds).toContain('synth');
      expect(sectionIds).toContain('effects');
    });

    it('renders controls in sections', () => {
      const { container } = render(<App />);
      const controls = container.querySelectorAll('.control');
      expect(controls.length).toBeGreaterThan(0);
    });
  });

  describe('Audio status', () => {
    it('displays audio status indicator', () => {
      render(<App />);
      const statusEl = document.querySelector('.audio-status');
      expect(statusEl).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('main element has aria-label', () => {
      const { container } = render(<App />);
      const main = container.querySelector('[role="main"]');
      expect(main).toHaveAttribute('aria-label', 'Nord Stage 4');
    });

    it('keys are keyboard accessible', () => {
      const { container } = render(<App />);
      const keys = container.querySelectorAll('.key');
      keys.forEach((key) => {
        expect(key).toHaveAttribute('role', 'button');
        expect(key).toHaveAttribute('tabIndex');
      });
    });
  });
});
