import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import App from '../src/App';
import { createFakeBackend } from '../src/audio/fakeBackend';
import { CONTROLS } from '../src/model/controls';

afterEach(cleanup);

function renderApp() {
  const backend = createFakeBackend();
  const utils = render(<App audioBackend={backend} enableComputerKeyboard={false} />);
  return { backend, ...utils };
}

// feature: visual.section-layout / control-inventory (rendered surface)
describe('surface renders (visual.*)', () => {
  it('renders all six sections', () => {
    renderApp();
    for (const label of [
      'Performance controls',
      'Organ',
      'Piano',
      'Program and morph',
      'Synth',
      'Layer effects',
    ]) {
      expect(screen.getByRole('region', { name: label }) ?? screen.getByLabelText(label)).toBeTruthy();
    }
  });

  it('renders exactly two OLED displays, in Program and Synth', () => {
    const { container } = renderApp();
    const oleds = container.querySelectorAll('[data-oled]');
    expect(oleds).toHaveLength(2);
    const kinds = [...oleds].map((o) => o.getAttribute('data-oled')).sort();
    expect(kinds).toEqual(['program', 'synth']);
  });

  it('renders 73 playable keys (43 white + 30 black)', () => {
    const { container } = renderApp();
    const keys = container.querySelectorAll('.key[data-midi]');
    expect(keys).toHaveLength(73);
    expect(container.querySelectorAll('.key.white')).toHaveLength(43);
    expect(container.querySelectorAll('.key.black')).toHaveLength(30);
  });
});

// feature: accessibility.controls
describe('accessibility (accessibility.controls)', () => {
  it('every decorative control exposes an accessible name via data-control-id', () => {
    const { container } = renderApp();
    for (const ctrl of CONTROLS) {
      if (ctrl.kind === 'led' || ctrl.kind === 'oled') continue;
      const el = container.querySelector(`[data-control-id="${ctrl.id}"]`);
      expect(el, `missing control ${ctrl.id}`).not.toBeNull();
      const name =
        el!.getAttribute('aria-label') ||
        el!.getAttribute('aria-labelledby') ||
        el!.textContent;
      expect(name && name.length > 0, `control ${ctrl.id} lacks a name`).toBe(true);
    }
  });

  it('knobs and faders are ARIA sliders with value text', () => {
    const { container } = renderApp();
    const knob = container.querySelector('[data-control-id="performance-master-level"]')!;
    expect(knob.getAttribute('role')).toBe('slider');
    expect(knob.getAttribute('aria-valuenow')).not.toBeNull();
  });

  it('keys are buttons with pressed state', () => {
    const { container } = renderApp();
    const key = container.querySelector('.key[data-midi="60"]')!;
    expect(key.tagName).toBe('BUTTON');
    expect(key.getAttribute('aria-pressed')).toBe('false');
  });
});

// feature: interaction.keys (pointer press produces a voice)
describe('keybed interaction (interaction.keys)', () => {
  it('pressing a key starts a tone and releasing stops it', () => {
    const { backend, container } = renderApp();
    const key = container.querySelector('.key[data-midi="60"]') as HTMLElement;
    fireEvent.pointerDown(key, { pointerId: 1 });
    expect(backend.tones).toHaveLength(1);
    expect(backend.tones[0].startTime).not.toBeNull();
    expect(key.getAttribute('aria-pressed')).toBe('true');
    fireEvent.pointerUp(key, { pointerId: 1 });
    expect(backend.tones[0].stopped).toBe(true);
    expect(key.getAttribute('aria-pressed')).toBe('false');
  });

  it('pointer cancel releases the note (cancel/blur behavior)', () => {
    const { backend, container } = renderApp();
    const key = container.querySelector('.key[data-midi="64"]') as HTMLElement;
    fireEvent.pointerDown(key, { pointerId: 2 });
    fireEvent.pointerCancel(key, { pointerId: 2 });
    expect(backend.tones[0].stopped).toBe(true);
  });
});

// feature: interaction.decorative-controls (change presentation, not audio)
describe('decorative controls (interaction.decorative-controls)', () => {
  it('toggling a decorative button does not create any audio', () => {
    const { backend, container } = renderApp();
    const btn = container.querySelector('[data-control-id="organ-on"]') as HTMLElement;
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(backend.tones).toHaveLength(0); // no tone created
  });

  it('a knob responds to keyboard and updates its own value only', () => {
    const { backend, container } = renderApp();
    const knob = container.querySelector('[data-control-id="performance-master-level"]') as HTMLElement;
    const before = knob.getAttribute('aria-valuenow');
    fireEvent.keyDown(knob, { key: 'ArrowUp' });
    expect(knob.getAttribute('aria-valuenow')).not.toBe(before);
    expect(backend.tones).toHaveLength(0);
  });

  it('a selector cycles its option in its accessible name', () => {
    const { container } = renderApp();
    const sel = container.querySelector('[data-control-id="piano-type"]') as HTMLElement;
    expect(sel.getAttribute('aria-label')).toContain('Grand');
    fireEvent.click(sel);
    expect(sel.getAttribute('aria-label')).toContain('Upright');
  });
});

// feature: piano.basic-status-cleanup (status reporting + unmount cleanup)
describe('status and cleanup (piano.basic-status-cleanup)', () => {
  it('reports the synthesized voice as ready, not as a recording', () => {
    renderApp();
    const chip = screen.getByText(/synthesized voice/i);
    expect(chip).toBeTruthy();
  });

  it('stops all owned voices on unmount', () => {
    const { backend, container, unmount } = renderApp();
    const key = container.querySelector('.key[data-midi="60"]') as HTMLElement;
    fireEvent.pointerDown(key, { pointerId: 1 });
    expect(backend.activeToneCount).toBe(1);
    unmount();
    expect(backend.activeToneCount).toBe(0);
  });
});

// feature: regression.chassis (no marketing hero; chassis + keybed present)
describe('chassis integrity (regression.chassis)', () => {
  it('renders one chassis with the variant marker and no hero image', () => {
    const { container } = renderApp();
    const chassis = container.querySelector('.chassis[data-variant="stage-4-73"]');
    expect(chassis).not.toBeNull();
    expect(container.querySelector('img')).toBeNull(); // no rendered reference/hero image
    expect(within(chassis as HTMLElement).getByRole('group', { name: /keybed/i })).toBeTruthy();
  });
});
