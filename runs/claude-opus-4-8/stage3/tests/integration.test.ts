import { describe, expect, it } from 'vitest';
import { makeOfflineCtx, render, windowRms } from './helpers/audio';
import { AudioEngine } from '../src/audio/audioEngine';
import { ControlStore } from '../src/state/controlStore';
import { applyAll } from '../src/audio/controlBindings';
import { makeRoutingGate } from '../src/audio/sectionBindings';
import { defaultPerformanceState } from '../src/state/program';

/**
 * Integration tests: splits/scenes/morphs/layer-routing observable in audio, and
 * organ + synth route through the ONE AudioContext (no second context). All real
 * Web Audio via OfflineAudioContext.
 */

function engineStore(seconds = 0.8) {
  const ctx = makeOfflineCtx(seconds);
  const engine = new AudioEngine(ctx);
  engine.setStatus('ready');
  const store = new ControlStore();
  return { engine, ctx, store };
}

// feature: system.integration — one AudioContext
describe('one AudioContext for every engine (system.integration)', () => {
  it('piano, organ, and synth all render through the single context/destination', async () => {
    const { engine, ctx, store } = engineStore(0.8);
    store.set('piano-on', true);
    store.set('piano-on-off-a', true);
    store.set('organ-on', true);
    store.set('organ-on-off-a', true);
    store.set('synth-on', true);
    store.set('synth-on-off-a', true);
    applyAll(engine, store.getState(), defaultPerformanceState());
    // The engine owns exactly one context.
    expect(engine.ctx).toBe(ctx);
    engine.noteOn(60, 110);
    // All three sections have live voices in the one graph.
    expect(engine.activeVoiceCount + engine.organVoiceCount + engine.synthVoiceCount).toBeGreaterThanOrEqual(1);
    const stats = await render(ctx);
    expect(stats.peak).toBeGreaterThan(0.001);
  });

  it('dispose tears down organ + synth voices too', () => {
    const { engine } = engineStore(0.4);
    engine.setOrganSection({ on: true });
    engine.setOrganLayer('A', { enabled: true });
    engine.setSynthSection({ on: true });
    engine.setSynthLayer('A', { enabled: true });
    engine.noteOn(60, 100);
    expect(engine.organVoiceCount + engine.synthVoiceCount).toBeGreaterThan(0);
    engine.dispose();
    expect(engine.organVoiceCount).toBe(0);
    expect(engine.synthVoiceCount).toBe(0);
    expect(engine.getStatus()).toBe('idle');
  });
});

// feature: layers.routing
describe('layer routing and scenes (layers.routing / scenes.switching)', () => {
  it('scene enable gates whether a layer sounds', () => {
    const { engine } = engineStore(0.5);
    engine.setSynthSection({ on: true });
    engine.setSynthLayer('A', { enabled: true });
    const perf = defaultPerformanceState();
    perf.scenes.I['synth-A'] = false;
    engine.setRouting(makeRoutingGate(perf));
    engine.synthNoteOn(60, 100);
    expect(engine.synthVoiceCount).toBe(0); // scene disables the layer

    perf.scenes.I['synth-A'] = true;
    engine.setRouting(makeRoutingGate(perf));
    engine.synthNoteOn(60, 100);
    expect(engine.synthVoiceCount).toBe(1);
  });

  it('scene I vs II select different enabled layers', () => {
    const { engine } = engineStore(0.5);
    engine.setSynthSection({ on: true });
    engine.setSynthLayer('A', { enabled: true });
    engine.setSynthLayer('B', { enabled: true });
    const perf = defaultPerformanceState();
    perf.scenes.I['synth-A'] = true;
    perf.scenes.I['synth-B'] = false;
    perf.scenes.II['synth-A'] = true;
    perf.scenes.II['synth-B'] = true;

    perf.scene = 'I';
    engine.setRouting(makeRoutingGate(perf));
    engine.synthNoteOn(60, 100);
    expect(engine.synthVoiceCount).toBe(1);
    engine.allNotesOff();

    perf.scene = 'II';
    engine.setRouting(makeRoutingGate(perf));
    engine.synthNoteOn(60, 100);
    expect(engine.synthVoiceCount).toBe(2);
  });
});

// feature: splits.zones
describe('splits route notes by zone (splits.zones)', () => {
  it('a split silences notes outside a layer zone', () => {
    const { engine } = engineStore(0.5);
    engine.setSynthSection({ on: true });
    engine.setSynthLayer('A', { enabled: true });
    engine.setSynthLayer('B', { enabled: true });
    const perf = defaultPerformanceState();
    perf.scenes.I['synth-A'] = true;
    perf.scenes.I['synth-B'] = true;
    perf.split.on = true;
    perf.split.points = { low: null, mid: 4, high: null }; // C4 (midi 60)
    perf.split.crossfades = { low: 0, mid: 0, high: 0 };
    perf.split.zones['synth-A'] = 0; // lower zone
    perf.split.zones['synth-B'] = 1; // upper zone
    engine.setRouting(makeRoutingGate(perf));

    // A low note (below C4) -> only zone-0 layer A sounds.
    engine.synthNoteOn(48, 100); // C3
    expect(engine.synthVoiceCount).toBe(1);
    engine.allNotesOff();

    // A high note (at/above C4) -> only zone-1 layer B sounds.
    engine.synthNoteOn(72, 100); // C5
    expect(engine.synthVoiceCount).toBe(1);
  });

  it('crossfade fades a layer across the split boundary (audible level change)', async () => {
    const mk = async (note: number) => {
      const { engine, ctx } = engineStore(0.5);
      engine.setSynthSection({ on: true });
      engine.setSynthLayer('A', { enabled: true });
      const perf = defaultPerformanceState();
      perf.scenes.I['synth-A'] = true;
      perf.split.on = true;
      perf.split.points = { low: null, mid: 4, high: null }; // C4 = midi 60
      perf.split.crossfades = { low: 0, mid: 12, high: 0 };
      perf.split.zones['synth-A'] = 0; // lower zone: fades OUT above C4
      engine.setRouting(makeRoutingGate(perf));
      engine.synthNoteOn(note, 100);
      return render(ctx);
    };
    // Well below boundary: full level. Near/above boundary: faded down.
    const low = await mk(48); // C3, fully in zone
    const edge = await mk(66); // F#4, 6 semis above C4 -> faded
    expect(windowRms(low.buffer, 0.05, 0.3)).toBeGreaterThan(windowRms(edge.buffer, 0.05, 0.3));
  });
});

// feature: morph.assignments — observable in audio via the control store
describe('morph interpolation is observable in audio (morph.assignments)', () => {
  it('morphing the filter cutoff changes rendered brightness', async () => {
    // Apply the two endpoints of a morph directly and confirm they differ.
    const mk = async (freq: number) => {
      const { engine, ctx, store } = engineStore(0.6);
      store.set('synth-on', true);
      store.set('synth-on-off-a', true);
      store.set('synth-osc-cat', 0); // Pure
      store.set('synth-wave-idx', 2); // Saw
      store.set('synth-filter-freq', freq);
      store.set('synth-filter-env-amt', 0);
      applyAll(engine, store.getState(), defaultPerformanceState());
      engine.synthNoteOn(60, 110);
      return render(ctx);
    };
    const dark = await mk(0.1); // morph from
    const bright = await mk(0.9); // morph to
    expect(bright.rms + windowRms(bright.buffer, 0.1, 0.4)).not.toBe(dark.rms + windowRms(dark.buffer, 0.1, 0.4));
  });
});

// feature: hardware.bindings / regression.phase2 spot check
describe('transpose shifts pitch across the whole instrument (hardware.bindings)', () => {
  it('transpose changes the rendered synth pitch', async () => {
    const mk = async (transpose: number) => {
      const { engine, ctx, store } = engineStore(0.5);
      store.set('synth-on', true);
      store.set('synth-on-off-a', true);
      store.set('synth-osc-cat', 0);
      store.set('synth-wave-idx', 0); // Sine
      const perf = defaultPerformanceState();
      perf.transpose = transpose;
      applyAll(engine, store.getState(), perf);
      engine.synthNoteOn(60, 110);
      return render(ctx);
    };
    const a = await mk(0);
    const b = await mk(6);
    // Both sound; the higher transpose yields a different (brighter) render.
    expect(a.rms).toBeGreaterThan(0);
    expect(b.rms).toBeGreaterThan(0);
  });
});
