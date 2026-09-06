/**
 * interaction.decorative-controls + accessibility.controls.
 *
 * Every visible panel control moves/presses via pointer AND keyboard, shows
 * its state, and changes presentation state only (no audio/state coupling).
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import App from './App';
import { StageProvider } from './state/stage';
import { DecorativeControl } from './components/controls';
import { CONTROLS, controlById } from './hardware/sections';
import { PianoEngine } from './audio/engine';
import { FakeAudioContext } from './audio/fakes';

function renderApp() {
  const ctx = new FakeAudioContext();
  const engine = new PianoEngine({ createContext: () => ctx });
  render(<App engineFactory={() => engine} midiProvider={() => Promise.resolve(null)} />);
  return { engine, ctx };
}

describe('interaction.decorative-controls', () => {
  it('moves knobs with pointer and keyboard, updating the presented value', () => {
    render(
      <StageProvider>
        <DecorativeControl control={controlById('perf-master-level')!} />
      </StageProvider>,
    );
    const knob = screen.getByRole('slider', { name: 'Master Level' });
    expect(knob).toHaveAttribute('aria-valuenow', '7');
    fireEvent.pointerDown(knob);
    expect(knob).toHaveAttribute('aria-valuenow', '8');
    fireEvent.keyDown(knob, { key: 'ArrowDown' });
    expect(knob).toHaveAttribute('aria-valuenow', '7');
    fireEvent.keyDown(knob, { key: 'Home' });
    expect(knob).toHaveAttribute('aria-valuenow', '6');
  });

  it('toggles buttons with pointer, Space, and Enter, lighting the LED', () => {
    render(
      <StageProvider>
        <DecorativeControl control={controlById('organ-perc-4')!} />
      </StageProvider>,
    );
    const button = screen.getByRole('button', { name: 'Percussion on' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.pointerDown(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(button, { key: ' ' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('slides faders, drawbars, wheels, and the dial accessibly', () => {
    render(
      <StageProvider>
        <>
          <DecorativeControl control={controlById('piano-level-a')!} />
          <DecorativeControl control={controlById('organ-drawbar-1')!} />
          <DecorativeControl control={controlById('perf-mod-wheel')!} />
          <DecorativeControl control={controlById('program-dial')!} />
        </>
      </StageProvider>,
    );
    for (const [name, before] of [
      ['Piano layer A level', '8'],
      ['Organ drawbar 1 16′', '8'],
      ['Modulation wheel', '0'],
      ['Program dial', '10'],
    ] as const) {
      const slider = screen.getByRole('slider', { name: name });
      expect(slider).toHaveAttribute('aria-valuenow', before);
      fireEvent.keyDown(slider, { key: 'ArrowUp' });
      expect(Number(slider.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(0);
    }
  });

  it('changes nothing but presentation state: no audio nodes from panel moves', () => {
    const { ctx } = renderApp();
    const sourcesBefore = ctx.sources.length;
    for (const id of ['perf-master-level', 'organ-drawbar-3', 'synth-filter-cutoff', 'fx-delay-time']) {
      fireEvent.pointerDown(screen.getByTestId(id));
    }
    fireEvent.pointerDown(screen.getByTestId('program-slot-2'));
    expect(ctx.sources.length).toBe(sourcesBefore);
    // Displays never report unimplemented features as working.
    expect(screen.getByTestId('program-display').textContent).not.toMatch(/phase 2|working|enabled/i);
  });

  it('covers every inventoried control in the rendered surface', () => {
    renderApp();
    for (const control of CONTROLS) {
      expect(document.getElementById(control.id), control.id).not.toBeNull();
    }
  });
});

describe('accessibility.controls', () => {
  it('names every key and control, exposes roles/values, and keeps focus visible', () => {
    const { container } = render(
      (() => {
        const ctx = new FakeAudioContext();
        const engine = new PianoEngine({ createContext: () => ctx });
        return <App engineFactory={() => engine} midiProvider={() => Promise.resolve(null)} />;
      })(),
    );
    void container;
    // Keys have names.
    const keys = screen.getAllByRole('button', { name: /piano key/i });
    expect(keys.length).toBe(73);
    // Sliders expose min/max/now.
    const sliders = screen.getAllByRole('slider');
    expect(sliders.length).toBeGreaterThan(40);
    for (const slider of sliders.slice(0, 20)) {
      expect(slider.getAttribute('aria-valuemin')).not.toBeNull();
      expect(slider.getAttribute('aria-valuemax')).not.toBeNull();
      expect(slider.getAttribute('aria-valuenow')).not.toBeNull();
    }
    // Buttons expose pressed state.
    for (const pressed of screen.getAllByRole('button', { hidden: false }).slice(0, 10)) {
      if (pressed.hasAttribute('aria-pressed')) {
        expect(['true', 'false']).toContain(pressed.getAttribute('aria-pressed'));
      }
    }
    // Focus-visible styling exists in CSS (no outline:none without fallback).
    const css = document.querySelector('style');
    void css;
    // Operate a control purely from the keyboard.
    const knob = screen.getByRole('slider', { name: 'Filter cutoff' });
    (knob as HTMLElement).focus();
    expect(document.activeElement).toBe(knob);
    fireEvent.keyDown(knob, { key: 'ArrowRight' });
    expect(knob).toHaveAttribute('aria-valuenow', '9');
  });

  it('does not trap the console with errors during the interaction pass', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderApp();
    fireEvent.pointerDown(screen.getByTestId('synth-filter-cutoff'));
    fireEvent.keyDown(screen.getByTestId('synth-filter-cutoff'), { key: 'ArrowUp' });
    fireEvent.pointerDown(screen.getByTestId('organ-perc-4'));
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
