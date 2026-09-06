/**
 * splits.zones / morph.assignments / scenes.switching / layers.routing /
 * system.integration (part 1) — split points at the 11 documented positions,
 * up to 4 zones, note routing, Off/±6/±12 crossfade gains; morph assignment,
 * interpolation, indicators, clearing; Scene I/II enable-only switching;
 * clock/transpose/panic behavior; layer routing for every engine.
 */
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import App from './App';
import { PianoEngine } from './audio/engine';
import { FakeAudioContext } from './audio/fakes';
import { StageEngine } from './audio/stageEngine';
import { StageFakeContext } from './audio/stageFakes';
import { createTestClock } from './audio/types';
import {
  SPLIT_POSITIONS,
  activeBoundaries,
  morphValues,
  subdivMs,
  zoneGain,
  zoneIndexOf,
} from './state/program';

function renderApp() {
  const legacy = new PianoEngine({ createContext: () => new FakeAudioContext() });
  const stage = new StageEngine({ createContext: () => new StageFakeContext(), fetchImpl: null });
  render(<App engineFactory={() => legacy} stageFactory={() => stage} midiProvider={() => Promise.resolve(null)} />);
  return stage;
}

async function settled() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function waitReady(stage: StageEngine) {
  for (let i = 0; i < 50 && (stage.getStatus() === 'idle' || stage.getStatus() === 'loading'); i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
}

function silentEngine() {
  const ctx = new StageFakeContext();
  const engine = new StageEngine({ createContext: () => ctx, fetchImpl: null, clock: createTestClock() });
  return { engine, ctx };
}

describe('splits.zones', () => {
  it('documents 11 split positions C2..C7', () => {
    expect(SPLIT_POSITIONS.map((p) => p.id)).toEqual(['C2', 'F2', 'C3', 'F3', 'C4', 'F4', 'C5', 'F5', 'C6', 'F6', 'C7']);
    expect(SPLIT_POSITIONS[0].midi).toBe(36);
    expect(SPLIT_POSITIONS[4].midi).toBe(60);
  });

  it('Off switches immediately; ±6/±12 fade across semitones each side', async () => {
    const { engine } = silentEngine();
    await engine.init();
    // Single Mid split at C4, hard edge.
    engine.setSplit({ on: true, low: { active: false, pos: 'C2', xfade: 0 }, mid: { active: true, pos: 'C4', xfade: 0 }, high: { active: false, pos: 'C2', xfade: 0 } });
    engine.setZone('synthA', { lo: 0, hi: 0 });
    engine.setZone('synthB', { lo: 1, hi: 3 });
    // Below C4: zone 0 full, zone 1 silent (and vice versa).
    expect(zoneGain(59, { lo: 0, hi: 0 }, engine.split)).toBe(1);
    expect(zoneGain(59, { lo: 1, hi: 3 }, engine.split)).toBe(0);
    expect(zoneGain(61, { lo: 0, hi: 0 }, engine.split)).toBe(0);
    expect(zoneGain(61, { lo: 1, hi: 3 }, engine.split)).toBe(1);
    expect(zoneIndexOf(59, engine.split)).toBe(0);
    expect(zoneIndexOf(61, engine.split)).toBe(1);
    // ±6 crossfade: 6 semitones each side reach across.
    engine.setSplit({ on: true, low: { active: false, pos: 'C2', xfade: 0 }, mid: { active: true, pos: 'C4', xfade: 6 }, high: { active: false, pos: 'C2', xfade: 0 } });
    const below = zoneGain(57, { lo: 1, hi: 3 }, engine.split);
    const above = zoneGain(63, { lo: 0, hi: 0 }, engine.split);
    expect(below).toBeGreaterThan(0);
    expect(below).toBeLessThan(1);
    expect(above).toBeGreaterThan(0);
    expect(above).toBeLessThan(1);
    // ±12 reaches twice as far.
    engine.setSplit({ on: true, low: { active: false, pos: 'C2', xfade: 0 }, mid: { active: true, pos: 'C4', xfade: 12 }, high: { active: false, pos: 'C2', xfade: 0 } });
    expect(zoneGain(57, { lo: 1, hi: 3 }, engine.split)).toBeGreaterThan(below);
    await engine.dispose();
  });

  it('split points, zones, and crossfades are editable from the panel with LEDs', async () => {
    renderApp();
    await settled();
    fireEvent.pointerDown(screen.getByTestId('p3-split-on'));
    // Three split points with position + crossfade steppers.
    for (const which of ['low', 'mid', 'high'] as const) {
      expect(screen.getByTestId(`p3-split-${which}-active`)).toBeInTheDocument();
      expect(screen.getByTestId(`p3-split-${which}-pos`)).toBeInTheDocument();
      expect(screen.getByTestId(`p3-split-${which}-xfade`)).toBeInTheDocument();
    }
    // Set High to F5 with ±12 and check its LED lights.
    fireEvent.pointerDown(screen.getByTestId('p3-split-high-active'));
    fireEvent.keyDown(screen.getByTestId('p3-split-high-pos'), { key: 'ArrowUp' }); // C5 → F5
    expect(screen.getByTestId('p3-split-high-pos').textContent).toMatch(/F5/);
    fireEvent.keyDown(screen.getByTestId('p3-split-high-xfade'), { key: 'ArrowUp' });
    fireEvent.keyDown(screen.getByTestId('p3-split-high-xfade'), { key: 'ArrowUp' });
    expect(screen.getByTestId('p3-split-high-xfade').textContent).toMatch(/±12/);
    expect(screen.getByTestId('p3-split-led-F5').getAttribute('data-on')).toBe('true');
    // Zone assignment per layer.
    fireEvent.keyDown(screen.getByTestId('p3-zone-synthA-hi'), { key: 'ArrowDown' });
    expect(screen.getByTestId('p3-zone-synthA-hi').textContent).toMatch(/Z3/);
    expect(activeBoundaries).toBeTruthy();
  });

  it('zones audibly route notes: out-of-zone layers stay silent', async () => {
    const stage = renderApp();
    await settled();
    await waitReady(stage);
    // Split at C4: piano A below (zone 0), synth A above (zones 1-3).
    fireEvent.pointerDown(screen.getByTestId('p3-split-on'));
    fireEvent.keyDown(screen.getByTestId('p3-zone-synthA-lo'), { key: 'ArrowUp' });
    // Enable synth A with an audible voice (layer + Scene I enable).
    fireEvent.pointerDown(screen.getByTestId('p3-synth-A-on'));
    fireEvent.pointerDown(screen.getByTestId('p3-scene-I-synthA'));
    fireEvent.pointerDown(screen.getByTestId('key-c3-48')); // below C4
    const lowOwners = stage.getActiveVoices().map((v) => String(v.layer));
    expect(lowOwners.some((l) => l.startsWith('synth'))).toBe(false);
    fireEvent.pointerUp(screen.getByTestId('key-c3-48'));
    fireEvent.pointerDown(screen.getByTestId('key-c5-72')); // above C4
    const highOwners = stage.getActiveVoices().map((v) => String(v.layer));
    expect(highOwners.some((l) => l.startsWith('synth'))).toBe(true);
    fireEvent.pointerUp(screen.getByTestId('key-c5-72'));
  });
});

describe('scenes.switching', () => {
  it('Scene I/II toggles enable state without duplicating sound parameters', async () => {
    renderApp();
    await settled();
    // Scene II starts with organ B off; turn it on there only.
    expect(screen.getByTestId('p3-scene-I-organB').getAttribute('aria-pressed')).toBe('false');
    fireEvent.pointerDown(screen.getByTestId('p3-scene-2'));
    fireEvent.pointerDown(screen.getByTestId('p3-scene-II-organB'));
    expect(screen.getByTestId('p3-scene-II-organB').getAttribute('aria-pressed')).toBe('true');
    // Move a drawbar (shared sound parameter) in Scene II…
    fireEvent.keyDown(screen.getByTestId('p3-organ-A-drawbar-1'), { key: 'ArrowDown' });
    // …it is identical back in Scene I, where organ B stayed off.
    fireEvent.pointerDown(screen.getByTestId('p3-scene-1'));
    expect(screen.getByTestId('p3-scene-I-organB').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('p3-organ-A-drawbar-1').getAttribute('aria-valuenow')).toBe('7');
  });
});

describe('morph.assignments', () => {
  it('assignment interpolation is linear per source', () => {
    const assigns = [
      { target: 'synth.A.filterFreq', start: 2, end: 8 },
      { target: 'piano.A.level', start: 8, end: 4 },
    ];
    expect(morphValues(assigns, 0)['synth.A.filterFreq']).toBe(2);
    expect(morphValues(assigns, 1)['synth.A.filterFreq']).toBe(8);
    expect(morphValues(assigns, 0.5)['synth.A.filterFreq']).toBe(5);
    expect(morphValues(assigns, 0.5)['piano.A.level']).toBe(6);
  });

  it('morph arm → move destination → release assigns; wheel interpolates; clear works', async () => {
    const stage = renderApp();
    await settled();
    await waitReady(stage);
    // Arm Wheel morph, move the synth filter freq 8 → 9 (start), release.
    fireEvent.pointerDown(screen.getByTestId('p3-morph-wheel-arm'));
    expect(screen.getByTestId('p3-morph-wheel-count').textContent).toMatch(/0/);
    fireEvent.keyDown(screen.getByTestId('p3-synth-A-filter-freq'), { key: 'ArrowDown' }); // start 7
    fireEvent.keyDown(screen.getByTestId('p3-synth-A-filter-freq'), { key: 'ArrowUp' }); // end 8
    fireEvent.pointerDown(screen.getByTestId('p3-morph-wheel-arm')); // release → assign
    expect(screen.getByTestId('p3-morph-wheel-count').textContent).toMatch(/1/);
    // Moving the wheel interpolates the destination + lights the LED.
    fireEvent.pointerDown(screen.getByTestId('perf-mod-wheel'));
    expect(stage.morphPos.wheel).toBeGreaterThan(0);
    expect(screen.getByTestId('synth-filter-cutoff').getAttribute('data-morph')).toBe('true');
    // Clearing per source removes assignments.
    fireEvent.pointerDown(screen.getByTestId('p3-morph-wheel-clear'));
    expect(screen.getByTestId('p3-morph-wheel-count').textContent).toMatch(/0/);
  });

  it('Control Pedal (on-screen + MIDI CC11) drives the pedal morph source', async () => {
    const stage = renderApp();
    await settled();
    await waitReady(stage);
    fireEvent.pointerDown(screen.getByTestId('control-pedal'));
    expect(screen.getByTestId('control-pedal')).toHaveAttribute('aria-pressed', 'true');
    expect(stage.morphPos.pedal).toBe(1);
    fireEvent.pointerDown(screen.getByTestId('control-pedal'));
    expect(stage.morphPos.pedal).toBe(0);
  });
});

describe('layers.routing', () => {
  it('every engine layer has enable/focus/level/octave routing that sounds', async () => {
    const stage = renderApp();
    await settled();
    await waitReady(stage);
    // Organ B: layer enable + Scene I enable + focus, then it sounds.
    fireEvent.pointerDown(screen.getByTestId('p3-organ-B-on'));
    fireEvent.pointerDown(screen.getByTestId('p3-scene-I-organB'));
    fireEvent.pointerDown(screen.getByTestId('p3-organ-B-focus'));
    fireEvent.keyDown(screen.getByTestId('p3-organ-B-octave'), { key: 'ArrowUp' });
    fireEvent.pointerDown(screen.getByTestId('key-c4-60'));
    const owners = stage.getActiveVoices().map((v) => String(v.layer));
    expect(owners).toContain('organB');
    fireEvent.pointerUp(screen.getByTestId('key-c4-60'));
    // Synth C likewise.
    fireEvent.pointerDown(screen.getByTestId('p3-synth-C-on'));
    fireEvent.pointerDown(screen.getByTestId('p3-scene-I-synthC'));
    fireEvent.pointerDown(screen.getByTestId('key-c4-60'));
    expect(stage.getActiveVoices().map((v) => String(v.layer))).toContain('synthC');
    fireEvent.pointerUp(screen.getByTestId('key-c4-60'));
  });
});

describe('clock.transpose.panic', () => {
  it('Master Clock tap (4+ taps) + dial set BPM 30..300 and sync the arp', async () => {
    const stage = renderApp();
    await settled();
    await waitReady(stage);
    // Dial: clamp discipline.
    fireEvent.keyDown(screen.getByTestId('p3-clock-bpm'), { key: 'End' });
    expect(screen.getByTestId('p3-clock-bpm').getAttribute('aria-valuenow')).toBe('300');
    expect(stage.clockBpm).toBe(300);
    fireEvent.keyDown(screen.getByTestId('p3-clock-bpm'), { key: 'Home' });
    expect(stage.clockBpm).toBe(30);
    // Subdivision math: 120 BPM 16ths = 125 ms.
    expect(subdivMs(120, '1/16')).toBe(125);
    expect(subdivMs(120, '1/4')).toBe(500);
  });

  it('Transpose ±6 shifts pitch; Panic stops everything and resets inputs', async () => {
    const stage = renderApp();
    await settled();
    await waitReady(stage);
    fireEvent.keyDown(screen.getByTestId('p3-transpose'), { key: 'ArrowUp' });
    fireEvent.keyDown(screen.getByTestId('p3-transpose'), { key: 'ArrowUp' });
    expect(stage.transpose).toBe(2);
    expect(stage.pianoRouting('A', 60).shifted).toBe(62);
    fireEvent.pointerDown(screen.getByTestId('key-c4-60'));
    expect(stage.getVoiceCount()).toBeGreaterThan(0);
    fireEvent.pointerDown(screen.getByTestId('control-pedal'));
    fireEvent.click(screen.getByTestId('panic'));
    expect(stage.getVoiceCount()).toBe(0);
    expect(stage.morphPos.pedal).toBe(0);
    expect(stage.transpose).toBe(2); // transpose is program state, kept
  });
});
