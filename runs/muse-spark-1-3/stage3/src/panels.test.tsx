/**
 * Panel agreement: every functional Phase 2 control is reachable, operable by
 * pointer AND keyboard, exposes roles/values, and agrees with audible state.
 * Covers piano.* + effects.* UI seams (the audio-boundary substance lives in
 * the companion test files).
 */
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import App from './App';
import { PianoEngine } from './audio/engine';
import { FakeAudioContext } from './audio/fakes';
import { StageEngine } from './audio/stageEngine';
import { StageFakeContext } from './audio/stageFakes';
import { PIANO_TYPES } from './audio/pianoTypes';
import { AMP_TYPES, MOD1_TYPES, MOD2_TYPES, REVERB_TYPES } from './state/fxTypes';

function renderApp(stage?: StageEngine) {
  const legacy = new PianoEngine({ createContext: () => new FakeAudioContext() });
  const st = stage ?? new StageEngine({ createContext: () => new StageFakeContext(), fetchImpl: null });
  render(<App engineFactory={() => legacy} stageFactory={() => st} midiProvider={() => Promise.resolve(null)} />);
  return st;
}

async function settled() {
  await act(async () => {
    await Promise.resolve();
  });
}

/**
 * The App owns engine lifecycle: wait for it to leave loading instead of
 * driving init directly (a direct call races StrictMode remount disposal).
 */
async function waitReady(stage: StageEngine) {
  for (let i = 0; i < 50 && (stage.getStatus() === 'idle' || stage.getStatus() === 'loading'); i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
  expect(['ready', 'fallback']).toContain(stage.getStatus());
}

describe('phase2 panels', () => {
  it('exposes the piano strips: 6 types per layer, model/level/octave/pedals', async () => {
    renderApp();
    await settled();
    for (const layer of ['A', 'B'] as const) {
      expect(screen.getByTestId(`p2-piano-layer-${layer}`)).toBeInTheDocument();
      for (const t of PIANO_TYPES) {
        expect(screen.getByTestId(`p2-piano-${layer}-type-${t.id}`)).toBeInTheDocument();
      }
      for (const id of ['model', 'level', 'octave', 'touch', 'dyncomp', 'unison', 'timbre'] as const) {
        const el = screen.getByTestId(`p2-piano-${layer}-${id}`);
        expect(el.getAttribute('role')).toBe('slider');
        expect(el.getAttribute('aria-valuenow')).not.toBeNull();
      }
      for (const id of ['on', 'focus', 'sustped', 'pstick', 'softrel', 'stringres'] as const) {
        expect(screen.getByTestId(`p2-piano-${layer}-${id}`).getAttribute('aria-pressed')).toMatch(/true|false/);
      }
    }
  });

  it('selecting a type updates panel feedback and the program model line', async () => {
    renderApp();
    await settled();
    const ep = screen.getByTestId('p2-piano-A-type-electric');
    expect(ep).toHaveAttribute('data-active', 'false');
    fireEvent.pointerDown(ep);
    expect(screen.getByTestId('p2-piano-A-type-electric')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('p2-program-model').textContent).toMatch(/tine/i);
    // Keyboard operation on steppers.
    const level = screen.getByTestId('p2-piano-A-level');
    const before = level.getAttribute('aria-valuenow');
    fireEvent.keyDown(level, { key: 'ArrowUp' });
    expect(level.getAttribute('aria-valuenow')).not.toBe(before);
  });

  it('layer enable/focus moves audible ownership (keys only sound enabled layers)', async () => {
    const stage = renderApp();
    await settled();
    await waitReady(stage);
    // Disable A, enable B via the panel: keybed sounds only B.
    fireEvent.pointerDown(screen.getByTestId('p2-piano-A-on'));
    fireEvent.pointerDown(screen.getByTestId('p2-piano-B-on'));
    fireEvent.pointerDown(screen.getByTestId('key-c4-60'));
    const owners = stage.getActiveVoices().map((v) => v.layer);
    expect(owners).toEqual(['B']);
    fireEvent.pointerUp(screen.getByTestId('key-c4-60'));
  });

  it('exposes every effect unit per chain with on/type/params and bypass', async () => {
    renderApp();
    await settled();
    for (const layer of ['A', 'B'] as const) {
      for (const id of [
        'mod1-on', 'mod1-type', 'mod1-rate', 'mod1-amount',
        'mod2-on', 'mod2-type', 'mod2-rate', 'mod2-amount',
        'delay-on', 'delay-time', 'delay-fb', 'delay-wet', 'delay-filter', 'delay-global',
        'amp-on', 'amp-type', 'amp-drive', 'amp-bass', 'amp-mid', 'amp-freq', 'amp-treble',
        'torotary',
        'comp-on', 'comp-amount', 'comp-fast', 'comp-global',
        'reverb-on', 'reverb-type', 'reverb-wet', 'reverb-bright', 'reverb-global',
      ] as const) {
        expect(screen.getByTestId(`p2-fx-${layer}-${id}`), `${layer}/${id}`).toBeInTheDocument();
      }
    }
    for (const id of ['p2-fx-focus-organ', 'p2-fx-focus-piano', 'p2-fx-focus-synth', 'p2-fx-piano-group', 'p2-fx-all-bypass'] as const) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    // Type steppers cycle the full documented lists.
    const mod1 = screen.getByTestId('p2-fx-A-mod1-type');
    for (let i = 0; i < MOD1_TYPES.length; i += 1) fireEvent.keyDown(mod1, { key: 'ArrowUp' });
    const mod2 = screen.getByTestId('p2-fx-A-mod2-type');
    for (let i = 0; i < MOD2_TYPES.length; i += 1) fireEvent.keyDown(mod2, { key: 'ArrowUp' });
    const amp = screen.getByTestId('p2-fx-A-amp-type');
    for (let i = 0; i < AMP_TYPES.length; i += 1) fireEvent.keyDown(amp, { key: 'ArrowUp' });
    const verb = screen.getByTestId('p2-fx-A-reverb-type');
    for (let i = 0; i < REVERB_TYPES.length; i += 1) fireEvent.keyDown(verb, { key: 'ArrowUp' });
  });

  it('effect toggles flip audible engine state (panel agrees with audio)', async () => {
    const stage = renderApp();
    await settled();
    await waitReady(stage);
    fireEvent.pointerDown(screen.getByTestId('p2-fx-A-delay-on'));
    expect(stage.chainState.A.delay.on).toBe(true);
    fireEvent.pointerDown(screen.getByTestId('p2-fx-all-bypass'));
    expect(stage.focus.allBypass).toBe(true);
    fireEvent.pointerDown(screen.getByTestId('p2-fx-piano-group'));
    expect(stage.focus.pianoGroup).toBe(true);
    // Rotary speed/drive live on the bridged hardware controls (Performance).
    fireEvent.pointerDown(screen.getByTestId('perf-rotary-speed'));
    expect(stage.rotarySpeed).toBe('fast');
    expect(screen.getByTestId('p2-rotary-readout').textContent).toMatch(/fast/);
  });

  it('bridged hardware controls drive audible state: Master Level + pitch stick', async () => {
    const stage = renderApp();
    await settled();
    await waitReady(stage);
    // Master Level is THE hardware knob (perf-master-level), now functional.
    const master = screen.getByTestId('perf-master-level');
    expect(master.getAttribute('aria-valuenow')).toBe('7');
    fireEvent.keyDown(master, { key: 'ArrowUp' });
    expect(master.getAttribute('aria-valuenow')).toBe('8');
    expect(stage.masterLevel).toBe(8);
    // Pitch stick position maps onto bend ±2 st; the readout agrees.
    const stick = screen.getByTestId('perf-pitch-stick');
    expect(stick.getAttribute('aria-valuenow')).toBe('5');
    fireEvent.keyDown(stick, { key: 'ArrowUp' });
    expect(stage.pitchBendSt).toBeGreaterThan(0);
    expect(screen.getByTestId('p2-pitch-readout').textContent).toMatch(/\+0\.4 st/);
  });

  it('keeps every Phase 1 control ID in place with no console errors', async () => {
    const errors: unknown[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      renderApp();
      await settled();
      for (const id of ['perf-master-level', 'piano-level-a', 'fx-delay-time', 'program-display', 'synth-display', 'organ-drawbar-1']) {
        expect(document.getElementById(id), id).not.toBeNull();
      }
      fireEvent.pointerDown(screen.getByTestId('p2-piano-A-type-clav'));
      fireEvent.pointerDown(screen.getByTestId('p2-fx-A-reverb-on'));
      fireEvent.pointerDown(screen.getByTestId('key-c4-60'));
      fireEvent.pointerUp(screen.getByTestId('key-c4-60'));
    } finally {
      console.error = orig;
    }
    expect(errors).toEqual([]);
  });
});
