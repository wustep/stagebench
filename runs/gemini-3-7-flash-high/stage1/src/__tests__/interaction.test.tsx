import { render, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../App';

describe('Interaction and Accessibility Specifications (Phase 1)', () => {
  describe('interaction.keys', () => {
    it('handles pointer down, up, and cancel on keybed keys', () => {
      const { container } = render(<App />);
      const c4Key = container.querySelector('#key-60') as HTMLElement; // Middle C
      expect(c4Key).toBeInTheDocument();
      expect(c4Key).not.toHaveClass('key-pressed');

      // Pointer down
      fireEvent.pointerDown(c4Key, { pointerId: 1, clientY: 200 });
      expect(c4Key).toHaveClass('key-pressed');
      expect(c4Key).toHaveAttribute('aria-pressed', 'true');

      // Pointer up
      fireEvent.pointerUp(c4Key, { pointerId: 1 });
      expect(c4Key).not.toHaveClass('key-pressed');
      expect(c4Key).toHaveAttribute('aria-pressed', 'false');

      // Pointer cancel
      fireEvent.pointerDown(c4Key, { pointerId: 2, clientY: 200 });
      expect(c4Key).toHaveClass('key-pressed');
      fireEvent.pointerCancel(c4Key, { pointerId: 2 });
      expect(c4Key).not.toHaveClass('key-pressed');
    });

    it('handles mapped computer keyboard keys with repeat suppression and blur cleanup', () => {
      const { container } = render(<App />);
      const c3Key = container.querySelector('#key-48') as HTMLElement; // 'z' key -> C3 (MIDI 48)
      expect(c3Key).toBeInTheDocument();

      // Press 'z'
      fireEvent.keyDown(window, { key: 'z', code: 'KeyZ' });
      expect(c3Key).toHaveClass('key-pressed');

      // Repeated keydown (OS auto-repeat) should be ignored
      fireEvent.keyDown(window, { key: 'z', code: 'KeyZ', repeat: true });
      expect(c3Key).toHaveClass('key-pressed');

      // Release 'z'
      fireEvent.keyUp(window, { key: 'z', code: 'KeyZ' });
      expect(c3Key).not.toHaveClass('key-pressed');

      // Press multiple keys
      fireEvent.keyDown(window, { key: 'z', code: 'KeyZ' });
      fireEvent.keyDown(window, { key: 'q', code: 'KeyQ' }); // C4 (60)
      const c4Key = container.querySelector('#key-60') as HTMLElement;
      expect(c3Key).toHaveClass('key-pressed');
      expect(c4Key).toHaveClass('key-pressed');

      // Window blur releases all keys
      fireEvent.blur(window);
      expect(c3Key).not.toHaveClass('key-pressed');
      expect(c4Key).not.toHaveClass('key-pressed');
    });
  });

  describe('interaction.decorative-controls', () => {
    it('allows buttons to toggle presentation state without breaking honesty contract', () => {
      const { container } = render(<App />);
      const organOnBtn = container.querySelector('#organ-on') as HTMLElement;
      expect(organOnBtn).toBeInTheDocument();
      expect(organOnBtn).toHaveAttribute('aria-pressed', 'false');

      fireEvent.click(organOnBtn);
      expect(organOnBtn).toHaveAttribute('aria-pressed', 'true');

      fireEvent.click(organOnBtn);
      expect(organOnBtn).toHaveAttribute('aria-pressed', 'false');
    });

    it('allows knobs, sliders, and drawbars to move via keyboard and pointer', () => {
      const { container } = render(<App />);

      // Master Level Knob
      const masterKnob = container.querySelector('#master-level') as HTMLElement;
      expect(masterKnob).toBeInTheDocument();
      expect(masterKnob).toHaveAttribute('role', 'slider');
      const initialVal = Number(masterKnob.getAttribute('aria-valuenow'));

      // Arrow Up
      fireEvent.keyDown(masterKnob, { key: 'ArrowUp' });
      const upVal = Number(masterKnob.getAttribute('aria-valuenow'));
      expect(upVal).toBeGreaterThanOrEqual(initialVal);

      // Organ Drawbar 16'
      const drawbar16 = container.querySelector('#organ-db-16') as HTMLElement;
      expect(drawbar16).toBeInTheDocument();
      expect(drawbar16).toHaveAttribute('role', 'slider');
      expect(drawbar16).toHaveAttribute('aria-valuemin', '0');
      expect(drawbar16).toHaveAttribute('aria-valuemax', '8');

      fireEvent.keyDown(drawbar16, { key: 'Home' }); // set to 0
      expect(drawbar16).toHaveAttribute('aria-valuenow', '0');
      fireEvent.keyDown(drawbar16, { key: 'End' }); // set to 8
      expect(drawbar16).toHaveAttribute('aria-valuenow', '8');
    });
  });

  describe('accessibility.controls', () => {
    it('has proper accessible names, roles, values, and visible focusability across all controls', () => {
      const { container } = render(<App />);

      // Test keybed roles
      const app = container.querySelector('[role="application"]');
      expect(app).toBeInTheDocument();

      // Sliders have accessible names and limits
      const sliders = container.querySelectorAll('[role="slider"]');
      expect(sliders.length).toBeGreaterThan(15);
      sliders.forEach((slider) => {
        expect(slider).toHaveAttribute('aria-label');
        expect(slider).toHaveAttribute('aria-valuemin');
        expect(slider).toHaveAttribute('aria-valuemax');
        expect(slider).toHaveAttribute('aria-valuenow');
        expect(slider).toHaveAttribute('tabIndex', '0');
      });

      // Buttons have accessible names
      const buttons = container.querySelectorAll('button[role="button"]');
      expect(buttons.length).toBeGreaterThan(20);
      buttons.forEach((btn) => {
        expect(btn).toHaveAttribute('aria-label');
      });
    });
  });
});
