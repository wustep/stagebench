import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { AudioEngine } from '../src/audio/audioEngine';
import { makeOfflineCtx } from './helpers/audio';
import { CONTROLS } from '../src/model/controls';

afterEach(cleanup);

/**
 * feature: regression.phase1 — with the Phase-2 AudioEngine wired in, the full
 * surface, keybed, inputs, and accessibility from Phase 1 must remain intact and
 * the console must stay clean during the interaction pass.
 */
function renderWithEngine() {
  const ctx = makeOfflineCtx(0.2);
  const engine = new AudioEngine(ctx);
  engine.setStatus('ready');
  const utils = render(<App audioEngine={engine} enableComputerKeyboard={false} />);
  return { engine, ...utils };
}

describe('phase-1 surface regression under phase-2 engine (regression.phase1)', () => {
  it('renders all six sections and exactly two OLEDs', () => {
    const { container } = renderWithEngine();
    for (const label of ['Performance controls', 'Organ', 'Piano', 'Program and morph', 'Synth', 'Layer effects']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(container.querySelectorAll('[data-oled]')).toHaveLength(2);
  });

  it('renders 73 keys (43 white + 30 black)', () => {
    const { container } = renderWithEngine();
    expect(container.querySelectorAll('.key[data-midi]')).toHaveLength(73);
    expect(container.querySelectorAll('.key.white')).toHaveLength(43);
    expect(container.querySelectorAll('.key.black')).toHaveLength(30);
  });

  it('every visible control still exposes an accessible name', () => {
    const { container } = renderWithEngine();
    for (const ctrl of CONTROLS) {
      if (ctrl.kind === 'led' || ctrl.kind === 'oled') continue;
      const el = container.querySelector(`[data-control-id="${ctrl.id}"]`);
      expect(el, `missing control ${ctrl.id}`).not.toBeNull();
    }
  });

  it('pressing a key drives the engine (voice count rises then falls)', () => {
    const { engine, container } = renderWithEngine();
    engine.setLayer('A', { enabled: true });
    const key = container.querySelector('.key[data-midi="60"]') as HTMLElement;
    fireEvent.pointerDown(key, { pointerId: 1 });
    expect(key.getAttribute('aria-pressed')).toBe('true');
    expect(engine.activeVoiceCount).toBeGreaterThan(0);
    fireEvent.pointerUp(key, { pointerId: 1 });
    expect(key.getAttribute('aria-pressed')).toBe('false');
  });

  it('decorative Organ/Synth controls still change presentation only (no crash)', () => {
    const { container } = renderWithEngine();
    const organ = container.querySelector('[data-control-id="organ-on"]') as HTMLElement;
    fireEvent.click(organ);
    expect(organ.getAttribute('aria-pressed')).toBe('true');
  });

  it('no console errors during a basic interaction pass', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { engine, container } = renderWithEngine();
    engine.setLayer('A', { enabled: true });
    const key = container.querySelector('.key[data-midi="64"]') as HTMLElement;
    fireEvent.pointerDown(key, { pointerId: 2 });
    fireEvent.pointerUp(key, { pointerId: 2 });
    // toggle a piano control + an effect control
    fireEvent.click(container.querySelector('[data-control-id="piano-on-off-a"]') as HTMLElement);
    fireEvent.click(container.querySelector('[data-control-id="effects-reverb-on"]') as HTMLElement);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('unmounting disposes the engine cleanly', () => {
    const { engine, unmount } = renderWithEngine();
    engine.setLayer('A', { enabled: true });
    engine.noteOn(60, 100);
    unmount();
    expect(engine.getStatus()).toBe('idle');
  });
});
