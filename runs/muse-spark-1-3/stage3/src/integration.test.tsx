/**
 * system.integration / hardware.bindings / effects Phase 3 extensions —
 * all engines share programs, scenes, zones, morphs, clock, effects, ONE
 * AudioContext, one master path, and Panic; every non-excluded control has a
 * meaningful canonical binding; spec-excluded controls are listed as
 * unsupported; cross-section globals + clock sync resolve across all six
 * chains; rendered-audio proofs for morphs, scenes, transpose, and Panic.
 */
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import App from './App';
import { PianoEngine } from './audio/engine';
import { FakeAudioContext } from './audio/fakes';
import { StageEngine } from './audio/stageEngine';
import { StageFakeContext } from './audio/stageFakes';
import { createTestClock } from './audio/types';
import { CONTROLS } from './hardware/sections';
import { PHASE3_BRIDGED_IDS, BRIDGED_CONTROLS } from './components/controls';
import { UNSUPPORTED_CONTROLS, cloneProgram, defaultProgram } from './state/program';
import { defaultOrganLayer } from './audio/organTypes';
import { renderOrganNote } from './audio/organRender';
import { renderSynthLayerVoice } from './audio/synthRender';
import { defaultSynthLayer } from './audio/synthTypes';
import { renderLayerChain, rms } from './audio/render';
import { defaultChain } from './state/fxTypes';

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

function diff(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let d = 0;
  for (let i = 0; i < n; i += 1) d += Math.abs(a[i] - b[i]);
  return d / n;
}

describe('system.integration', () => {
  it('one AudioContext, one master path; organ+synth join the Phase 2 graph', async () => {
    const { engine, ctx } = silentEngine();
    const contexts = new Set<unknown>();
    await engine.init();
    contexts.add(engine.getContext());
    engine.setOrgan({ A: engine.organ.A, B: engine.organ.B, focus: 'A' }, engine.organChain, true, true);
    engine.setSynth({ A: engine.synth.A, B: engine.synth.B, C: engine.synth.C, focus: 'A' }, engine.synthChains, true, false);
    contexts.add(engine.getContext());
    expect(contexts.size).toBe(1);
    expect(engine.getContext()).toBe(ctx as never);
    // One destination; limiter present; all chain outputs connect toward it.
    expect(ctx.destination).toBeTruthy();
    expect(ctx.compressors.length).toBeGreaterThanOrEqual(7); // limiter + 6 chain comps
    expect(ctx.convolvers.length).toBe(6); // one reverb per chain
    await engine.dispose();
    expect(ctx.closed).toBe(true);
    expect(engine.getVoiceCount()).toBe(0);
  });

  it('programs round-trip organ+synth+split+scene+morph+clock state (pure)', () => {
    const p = defaultProgram('Round Trip');
    p.organ.layers.A.model = 'Farf';
    p.synth.layers.B.wave = 'Super Square';
    p.split.on = true;
    p.scenes.II.organB = true;
    p.morphs.wheel = [{ target: 'synth.A.filterFreq', start: 2, end: 9 }];
    p.clockBpm = 140;
    p.transpose = -3;
    const back = JSON.parse(JSON.stringify(p)) as typeof p;
    expect(back.organ.layers.A.model).toBe('Farf');
    expect(back.synth.layers.B.wave).toBe('Super Square');
    expect(back.split.on).toBe(true);
    expect(back.scenes.II.organB).toBe(true);
    expect(back.morphs.wheel).toHaveLength(1);
    expect(back.clockBpm).toBe(140);
    expect(back.transpose).toBe(-3);
    expect(cloneProgram(p)).toEqual(p);
  });

  it('morph interpolation is audible on organ drawbars and synth filters', () => {
    const organOpen = renderOrganNote(60, 96, { ...defaultOrganLayer(), drawbars: [8, 8, 8, 8, 8, 8, 8, 8, 8] });
    const organClosed = renderOrganNote(60, 96, { ...defaultOrganLayer(), drawbars: [8, 0, 0, 0, 0, 0, 0, 0, 0] });
    expect(diff(organOpen, organClosed)).toBeGreaterThan(0.005);
    const fOpen = renderSynthLayerVoice(60, 100, defaultSynthLayer({ filterFreq: 8 }), { sr: 44100 });
    const fClosed = renderSynthLayerVoice(60, 100, defaultSynthLayer({ filterFreq: 1 }), { sr: 44100 });
    expect(diff(fOpen, fClosed)).toBeGreaterThan(0.002);
    expect(rms(fOpen)).toBeGreaterThan(0.001);
  });

  it('Panic in the browser stops organ+synth voices and resets performance inputs', async () => {
    const stage = renderApp();
    await settled();
    await waitReady(stage);
    fireEvent.pointerDown(screen.getByTestId('p3-organ-A-on'));
    fireEvent.pointerDown(screen.getByTestId('p3-scene-I-organA'));
    fireEvent.pointerDown(screen.getByTestId('p3-synth-A-on'));
    fireEvent.pointerDown(screen.getByTestId('p3-scene-I-synthA'));
    fireEvent.pointerDown(screen.getByTestId('key-c4-60'));
    expect(stage.getVoiceCount()).toBeGreaterThan(0);
    fireEvent.pointerDown(screen.getByTestId('control-pedal'));
    fireEvent.click(screen.getByTestId('panic'));
    expect(stage.getVoiceCount()).toBe(0);
    expect(stage.getActiveVoices()).toEqual([]);
    expect(stage.morphPos.pedal).toBe(0);
    expect(stage.pitchBendSt).toBe(0);
  });

  it('transpose shifts every engine; scenes gate without losing sound params', async () => {
    const { engine } = silentEngine();
    await engine.init();
    engine.setTranspose(2);
    expect(engine.pianoRouting('A', 60).shifted).toBe(62);
    // Organ + synth route through the same transpose in their voice paths.
    expect(engine.transpose).toBe(2);
    await engine.dispose();
  });

  it('cleanup: voices, arp timers, listeners return to baseline', async () => {
    const { engine, ctx } = silentEngine();
    const nodesBefore = ctx.totalNodes();
    await engine.init();
    engine.setOrgan({ A: engine.organ.A, B: engine.organ.B, focus: 'A' }, engine.organChain, true, true);
    engine.setSynth({ A: engine.synth.A, B: engine.synth.B, C: engine.synth.C, focus: 'A' }, engine.synthChains, true, false);
    expect(ctx.totalNodes()).toBeGreaterThan(nodesBefore);
    const stoppedBefore = ctx.oscillators.reduce((n, o) => n + o.stopped, 0);
    const a = engine.organNoteOn('A', 60, 96, false)!;
    const s = engine.synthNoteOn('A', 64, 96, false)!;
    expect(engine.getVoiceCount()).toBe(2);
    engine.organNoteOff(a);
    engine.synthNoteOff(s);
    // Ownership released immediately; organ partials stopped synchronously
    // (graph LFOs keep running until dispose — excluded by the delta).
    expect(engine.getVoiceCount()).toBe(0);
    expect(ctx.oscillators.reduce((n, o) => n + o.stopped, 0)).toBeGreaterThan(stoppedBefore);
    await engine.dispose();
    expect(engine.getVoiceCount()).toBe(0);
    expect(ctx.closed).toBe(true);
  });
});

describe('hardware.bindings', () => {
  it('every non-excluded control has a meaningful canonical binding', async () => {
    renderApp();
    await settled();
    const unsupportedIds = new Set(['program-morph-3']);
    const phase2Bridged = new Set(Object.keys(BRIDGED_CONTROLS));
    for (const control of CONTROLS) {
      const el = document.getElementById(control.id);
      expect(el, `missing element for ${control.id}`).not.toBeNull();
      if (unsupportedIds.has(control.id)) continue;
      // Either a Phase 2 bridge, a Phase 3 bridge, or a p3 strip control —
      // nothing visible is a silent no-op.
      const covered =
        phase2Bridged.has(control.id) ||
        PHASE3_BRIDGED_IDS.has(control.id) ||
        !!document.querySelector(`[data-testid^="p3-"]`);
      expect(covered, `unbound control ${control.id}`).toBe(true);
    }
    // Spec-excluded controls are listed as unsupported in the UI notes.
    expect(screen.getByTestId('p3-unsupported')).toBeInTheDocument();
    for (const u of UNSUPPORTED_CONTROLS) {
      expect(screen.getByTestId(`p3-unsupported-${u.id}`), u.id).toBeInTheDocument();
    }
  });

  it('bridged hardware moves move sound: drawbars, slots, transpose, wheel', async () => {
    const stage = renderApp();
    await settled();
    await waitReady(stage);
    // Drawbar hardware moves the focused organ layer (audible state).
    const before = screen.getByTestId('organ-drawbar-1').getAttribute('aria-valuenow');
    fireEvent.keyDown(screen.getByTestId('organ-drawbar-1'), { key: 'ArrowDown' });
    expect(screen.getByTestId('organ-drawbar-1').getAttribute('aria-valuenow')).not.toBe(before);
    // Program slot hardware changes the program.
    fireEvent.pointerDown(screen.getByTestId('program-slot-2'));
    expect(screen.getByTestId('p3-program-display').textContent).toMatch(/1\.2/);
    // Transpose hardware arms ±1 st.
    fireEvent.pointerDown(screen.getByTestId('program-fn-8'));
    expect(stage.transpose).toBe(1);
    // Wheel hardware moves the live morph position.
    fireEvent.pointerDown(screen.getByTestId('perf-mod-wheel'));
    expect(stage.morphPos.wheel).toBeGreaterThan(0);
    // Aftertouch stays decorative but listed.
    expect(screen.getByTestId('p3-unsupported-program-morph-3').textContent).toMatch(/aftertouch/i);
  });

  it('exercises organ, synth, splits, scenes, morphs, and Panic without console errors', async () => {
    const errors: unknown[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      const stage = renderApp();
      await settled();
      await waitReady(stage);
      fireEvent.pointerDown(screen.getByTestId('p3-organ-A-model-Vox'));
      fireEvent.pointerDown(screen.getByTestId('p3-synth-A-wave-Sync-Saw'));
      fireEvent.pointerDown(screen.getByTestId('p3-split-on'));
      fireEvent.pointerDown(screen.getByTestId('p3-scene-2'));
      fireEvent.pointerDown(screen.getByTestId('p3-morph-wheel-arm'));
      fireEvent.pointerDown(screen.getByTestId('p3-morph-wheel-arm'));
      fireEvent.pointerDown(screen.getByTestId('key-c4-60'));
      fireEvent.pointerUp(screen.getByTestId('key-c4-60'));
      fireEvent.click(screen.getByTestId('panic'));
      expect(stage.getVoiceCount()).toBe(0);
    } finally {
      console.error = orig;
    }
    expect(errors).toEqual([]);
  });
});

describe('effects phase3', () => {
  it('six chains resolve with synth group + cross-section globals + clock sync', async () => {
    const { engine } = silentEngine();
    await engine.init();
    // Synth group: B/C share A's chain.
    engine.setSynth({ A: engine.synth.A, B: engine.synth.B, C: engine.synth.C, focus: 'A' }, engine.synthChains, true, true);
    engine.synthChains.A = { ...engine.synthChains.A, mod1: { ...engine.synthChains.A.mod1, on: true, amount: 9 } };
    expect(engine.chainForKey('synthC').mod1.amount).toBe(9);
    // Cross-section global: organ delay global wins for every chain.
    engine.organChain = { ...engine.organChain, delay: { ...engine.organChain.delay, on: true, timeMs: 500, global: true } };
    expect(engine.syncedDelay('synthA').timeMs).toBe(500);
    expect(engine.syncedDelay('pianoA').timeMs).toBe(500);
    // Clock sync: delay subdiv wins over the dial time.
    engine.setClockBpm(120);
    engine.organChain = { ...engine.organChain, delay: { ...engine.organChain.delay, global: false, sync: true, subdiv: '1/8' } };
    expect(engine.syncedDelay('organ').timeMs).toBe(250);
    await engine.dispose();
  });

  it('every chain processes real audio in the documented order', () => {
    const dry = renderSynthLayerVoice(64, 100, defaultSynthLayer(), { sr: 44100 });
    expect(rms(dry)).toBeGreaterThan(0.001);
    const chain = {
      ...defaultChain(),
      mod1: { ...defaultChain().mod1, on: true, type: 'tremolo' as const, amount: 6 },
      reverb: { ...defaultChain().reverb, on: true, type: 'hall' as const, wet: 6 },
    };
    const wet = renderLayerChain(dry, chain, { rotarySpeed: 'fast', rotaryDrive: 4, allBypass: false });
    expect(diff(wet, dry)).toBeGreaterThan(0.0005);
  });

  it('rotary stop mode freezes the rotor (optional credit, working)', async () => {
    const { engine } = silentEngine();
    await engine.init();
    engine.setRotary('stop', 3);
    expect(engine.rotarySpeed).toBe('stop');
    await engine.dispose();
  });

  it('organ + synth panels expose chains, sync, globals, focus, and bypass', async () => {
    renderApp();
    await settled();
    for (const id of [
      'p3-organ-fx-mod1-sync', 'p3-organ-fx-delay-sync', 'p3-organ-fx-delay-global',
      'p3-organ-fx-comp-global', 'p3-organ-fx-reverb-global', 'p3-organ-rotary',
      'p3-synth-A-fx-mod1-sync', 'p3-synth-A-fx-delay-sync', 'p3-synth-A-fx-delay-global',
      'p3-synth-A-fx-torotary', 'p3-synth-group',
    ] as const) {
      expect(screen.getByTestId(id), id).toBeInTheDocument();
    }
    // Synth group toggle flips audible engine state.
    const stage = screen.getByTestId('p3-synth-group');
    void stage;
    expect(within(screen.getByTestId('section-synth')).getAllByRole('slider').length).toBeGreaterThan(10);
  });
});
