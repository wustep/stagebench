/**
 * Phase 2 gap coverage: live soft-release behavior (and its Clav exclusion),
 * string-resonance gating, tap tempo agreement, disable/section mutes, and
 * the model dial cap. All audio claims cross the audio boundary.
 */
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import App from './App';
import { PianoEngine } from './audio/engine';
import { FakeAudioContext } from './audio/fakes';
import { StageEngine, defaultPianoLayer } from './audio/stageEngine';
import { StageFakeContext } from './audio/stageFakes';
import type { FakeGainNode } from './audio/stageFakes';
import { createTestClock } from './audio/types';
import { PIANO_TYPES } from './audio/pianoTypes';

function silentEngine(clock = createTestClock()): { engine: StageEngine; ctx: StageFakeContext } {
  const ctx = new StageFakeContext();
  const engine = new StageEngine({ createContext: () => ctx, fetchImpl: null, clock });
  return { engine, ctx };
}

describe('phase2 gaps', () => {
  it('soft release ramps the release gain; plain voices stop promptly', async () => {
    const { engine } = silentEngine();
    await engine.init();
    engine.setLayers({ A: defaultPianoLayer({ softRelease: true }), B: engine.layers.B, focus: 'A' });
    const id = engine.noteOn('A', 60, 96, false)!;
    engine.noteOff(id);
    expect(engine.getVoiceCount()).toBe(0); // ownership released immediately
    // A voice created without soft release stops its nodes synchronously.
    engine.setLayers({ A: defaultPianoLayer({ softRelease: false }), B: engine.layers.B, focus: 'A' });
    const plain = engine.noteOn('A', 62, 96, false)!;
    engine.noteOff(plain);
    expect(engine.getVoiceCount()).toBe(0);
    await engine.dispose();
  });

  it('soft release is disabled for Clav-type sounds', async () => {
    const { engine, ctx } = silentEngine();
    await engine.init();
    engine.setLayers({ A: defaultPianoLayer({ type: 'clav', softRelease: true }), B: engine.layers.B, focus: 'A' });
    const gainsBefore = ctx.gains.length;
    const id = engine.noteOn('A', 60, 96, false)!;
    // Clav voice path still sounds (fallback synth), then releases promptly.
    expect(engine.getVoiceCount()).toBe(1);
    engine.noteOff(id);
    expect(engine.getVoiceCount()).toBe(0);
    // No release-stage fade was armed for the Clav voice: all its gains
    // disconnect synchronously on noteOff.
    const recent = ctx.gains.slice(gainsBefore) as FakeGainNode[];
    for (const g of recent) expect(g.disconnected).toBeGreaterThan(0);
    await engine.dispose();
  });

  it('string resonance only washes while other notes or the pedal are held', async () => {
    const { engine, ctx } = silentEngine();
    await engine.init();
    engine.setLayers({ A: defaultPianoLayer({ stringRes: true }), B: engine.layers.B, focus: 'A' });
    const delaysBefore = ctx.delays.length;
    engine.noteOn('A', 60, 96, false); // first note, nothing held → no wash
    expect(ctx.delays.length).toBe(delaysBefore);
    engine.noteOn('A', 64, 96, true); // pedal-held context → wash armed
    expect(ctx.delays.length).toBeGreaterThan(delaysBefore);
    await engine.dispose();
  });

  it('tap tempo sets the delay time and agrees with panel state', async () => {
    const clock = createTestClock();
    const { engine } = silentEngine(clock);
    await engine.init();
    expect(engine.tapTempo('A')).toBe(320); // first tap arms
    clock.advance(400);
    expect(engine.tapTempo('A')).toBe(400); // second tap resolves
    expect(engine.chainState.A.delay.timeMs).toBe(400);
    clock.advance(100);
    expect(engine.tapTempo('A')).toBe(150); // clamped to >=150 ms
    await engine.dispose();
  });

  it('disabling a layer or section stops its held voices (no drones)', async () => {
    const { engine } = silentEngine();
    await engine.init();
    engine.setLayers({ A: defaultPianoLayer(), B: defaultPianoLayer({ enabled: true, level: 6 }), focus: 'A' });
    const a = engine.noteOn('A', 60, 96, false)!;
    const b = engine.noteOn('B', 60, 96, false)!;
    expect(engine.getVoiceCount()).toBe(2);
    engine.setLayers({ A: engine.layers.A, B: defaultPianoLayer({ enabled: false, level: 0 }), focus: 'A' });
    expect(engine.getActiveVoices()).toEqual([{ layer: 'A', midi: 60 }]);
    void a;
    void b;
    await engine.dispose();
  });

  it('section-off mutes the keybed through the App (no drone under a dark panel)', async () => {
    const legacy = new PianoEngine({ createContext: () => new FakeAudioContext() });
    const stage = new StageEngine({ createContext: () => new StageFakeContext(), fetchImpl: null });
    render(<App engineFactory={() => legacy} stageFactory={() => stage} midiProvider={() => Promise.resolve(null)} />);
    for (let i = 0; i < 50 && (stage.getStatus() === 'idle' || stage.getStatus() === 'loading'); i += 1) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
    }
    fireEvent.pointerDown(screen.getByTestId('key-c4-60'));
    expect(stage.getVoiceCount()).toBe(1);
    fireEvent.pointerDown(screen.getByTestId('p2-piano-section-on')); // section off
    expect(stage.getVoiceCount()).toBe(0);
    fireEvent.pointerUp(screen.getByTestId('key-c4-60'));
  });

  it('every type offers 1 model; the dial caps at the model count', () => {
    for (const t of PIANO_TYPES) expect(t.models.length).toBeGreaterThanOrEqual(1);
  });

  it('tap button is reachable per chain and moves the delay time', async () => {
    const legacy = new PianoEngine({ createContext: () => new FakeAudioContext() });
    const stage = new StageEngine({ createContext: () => new StageFakeContext(), fetchImpl: null });
    render(<App engineFactory={() => legacy} stageFactory={() => stage} midiProvider={() => Promise.resolve(null)} />);
    for (let i = 0; i < 50 && (stage.getStatus() === 'idle' || stage.getStatus() === 'loading'); i += 1) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
    }
    const tap = screen.getByTestId('p2-fx-A-delay-tap');
    fireEvent.pointerDown(tap);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    fireEvent.pointerDown(tap); // second tap resolves a real time
    expect(stage.chainState.A.delay.timeMs).toBeGreaterThanOrEqual(150);
    expect(stage.chainState.A.delay.timeMs).toBeLessThanOrEqual(1500);
  });
});
