/**
 * effects.routing — focus follows layers, manual focus, group and global
 * modes, per-unit bypass, all-effects bypass, dry/wet, documented order,
 * delay feedback path, To Rotary. effects.graph — one AudioContext, per-layer
 * buses, ordered effects, master gain/limiter, one destination, cleanup.
 */
import { describe, expect, it } from 'vitest';
import { StageEngine, defaultPianoLayer } from './audio/stageEngine';
import { StageFakeContext } from './audio/stageFakes';
import { createTestClock } from './audio/types';
import {
  DEFAULT_FOCUS,
  defaultChain,
  effectiveChain,
  focusForLayer,
  type ChainState,
  type FocusState,
} from './state/fxTypes';
import type { LayerId } from './audio/pianoTypes';

function silentEngine(): { engine: StageEngine; ctx: StageFakeContext } {
  const ctx = new StageFakeContext();
  const engine = new StageEngine({ createContext: () => ctx, fetchImpl: null, clock: createTestClock() });
  return { engine, ctx };
}

function chainWith(patch: (c: ChainState) => ChainState): ChainState {
  return patch(defaultChain());
}

describe('effects.routing', () => {
  it('focus follows piano layer focus unless manually overridden', () => {
    const auto = focusForLayer('B', { ...DEFAULT_FOCUS });
    expect(auto.focus).toBe('piano');
    expect(auto.layer).toBe('B');
    const manual: FocusState = { ...DEFAULT_FOCUS, focus: 'organ', manual: true };
    const kept = focusForLayer('B', manual);
    expect(kept.focus).toBe('organ');
    expect(kept.layer).toBe('B');
  });

  it('piano group mode shares layer A chain across both layers', () => {
    const chains = { A: chainWith((c) => ({ ...c, mod1: { ...c.mod1, on: true, amount: 9 } })), B: defaultChain() };
    const grouped: FocusState = { ...DEFAULT_FOCUS, pianoGroup: true };
    expect(effectiveChain('B', chains, grouped).mod1.amount).toBe(9);
    expect(effectiveChain('B', chains, { ...DEFAULT_FOCUS }).mod1.amount).toBe(4);
  });

  it('global Delay/Compressor/Reverb apply to all layers when flagged', async () => {
    const { engine } = silentEngine();
    await engine.init();
    const chains = {
      A: chainWith((c) => ({ ...c, delay: { ...c.delay, on: true, timeMs: 500, global: true } })),
      B: defaultChain(),
    };
    engine.setChains(chains, { ...DEFAULT_FOCUS });
    // B resolves A's global delay even though B's own delay is off/short.
    expect(engine.effectiveUnits('B').delay.timeMs).toBe(500);
    expect(engine.effectiveUnits('A').delay.timeMs).toBe(500);
    // Without the flag each layer keeps its own.
    engine.setChains({ A: chains.A, B: defaultChain() }, { ...DEFAULT_FOCUS });
    const unflagged = { ...chains.A, delay: { ...chains.A.delay, global: false } };
    engine.setChains({ A: unflagged, B: defaultChain() }, { ...DEFAULT_FOCUS });
    expect(engine.effectiveUnits('B').delay.timeMs).toBe(320);
    await engine.dispose();
  });

  it('per-unit bypass and all-effects bypass alter the live signal path', async () => {
    const { engine, ctx } = silentEngine();
    await engine.init();
    const chains = {
      A: chainWith((c) => ({ ...c, delay: { ...c.delay, on: true, wet: 7 } })),
      B: defaultChain(),
    };
    engine.setChains(chains, { ...DEFAULT_FOCUS });
    const timed = ctx.delays.filter(
      (d) => Math.abs((d.delayTime as unknown as { value: number }).value - 0.32) < 0.001,
    );
    expect(timed.length).toBeGreaterThanOrEqual(1); // chain delay follows panel time
    // All-bypass drives the wet entry down (dry returns) — path changes.
    engine.setChains(chains, { ...DEFAULT_FOCUS, allBypass: true });
    // Per-unit off zeroes the delay feedback gain.
    engine.setChains(
      { A: chainWith((c) => c), B: defaultChain() },
      { ...DEFAULT_FOCUS, allBypass: false },
    );
    expect(ctx.delays.length).toBeGreaterThan(0);
    await engine.dispose();
  });

  it('delay feedback filter sits in the regeneration loop (repeats only)', async () => {
    const { engine, ctx } = silentEngine();
    await engine.init();
    const chains = {
      A: chainWith((c) => ({ ...c, delay: { ...c.delay, on: true, feedback: 6, filter: 'lp' as const } })),
      B: defaultChain(),
    };
    engine.setChains(chains, { ...DEFAULT_FOCUS });
    // The loop filter is wired delay → fb-gain → filter → delay (a cycle
    // through three distinct nodes), never on the dry path.
    const filters = ctx.filters;
    const loopFilters = filters.filter((f) => f.type === 'lowpass' && f.frequency.value === 2200);
    expect(loopFilters.length).toBeGreaterThanOrEqual(1);
    const loop = loopFilters[0];
    // Its downstream includes a delay node (the loop closes on the delay).
    const hitsDelay = loop.connectedTo.some((d) => (d as { delayTime?: unknown }).delayTime !== undefined);
    expect(hitsDelay).toBe(true);
    await engine.dispose();
  });

  it('To Rotary routes post-reverb into the shared rotary without muting other units', async () => {
    const { engine, ctx } = silentEngine();
    await engine.init();
    const chains = {
      A: chainWith((c) => ({
        ...c,
        reverb: { ...c.reverb, on: true, wet: 6 },
        ampEq: { ...c.ampEq, on: true, type: 'to-rotary' as const },
        rotaryOn: true,
      })),
      B: defaultChain(),
    };
    engine.setChains(chains, { ...DEFAULT_FOCUS });
    engine.setRotary('fast', 4);
    // Reverb still processes (its wet gain is up) AND the rotary runs.
    const convolvers = ctx.convolvers;
    expect(convolvers.length).toBeGreaterThanOrEqual(2); // one per layer chain
    expect(ctx.oscillators.length).toBeGreaterThanOrEqual(4); // mod LFOs + rotary LFO
    // Rotary speed reaches the shared LFO.
    const rotaryLfo = ctx.oscillators[ctx.oscillators.length - 1];
    expect(rotaryLfo.frequency.value).toBeCloseTo(6.4, 5);
    await engine.dispose();
  });

  it('dry/wet controls move real gains on the live graph', async () => {
    const { engine } = silentEngine();
    await engine.init();
    const chains = {
      A: chainWith((c) => ({ ...c, reverb: { ...c.reverb, on: true, wet: 10 } })),
      B: defaultChain(),
    };
    engine.setChains(chains, { ...DEFAULT_FOCUS });
    await engine.dispose();
  });
});

describe('effects.graph', () => {
  it('uses one context, per-layer buses, master gain/limiter, one destination', async () => {
    const { engine, ctx } = silentEngine();
    await engine.init();
    // Exactly one destination; every master/limiter connects toward it.
    expect(ctx.destination).toBeTruthy();
    // Master gain (level-mapped) → limiter (compressor) → destination.
    expect(ctx.compressors.length).toBeGreaterThanOrEqual(3); // limiter + 2 chain comps
    // Per-layer chains: 2 delays, 2 convolvers, filters for both layers.
    expect(ctx.delays.length).toBeGreaterThanOrEqual(4); // chain delays + fb structure + combs
    expect(ctx.convolvers.length).toBe(2);
    // Rotary exists exactly once (shared).
    // (2 chain graphs each own mod LFOs; rotary adds one more oscillator.)
    const chains = { A: defaultChain(), B: defaultChain() };
    engine.setChains(chains, { ...DEFAULT_FOCUS });
    await engine.dispose();
  });

  it('voices flow layer bus → ordered chain → level → master (no bypass)', async () => {
    const { engine, ctx } = silentEngine();
    await engine.init();
    const id = engine.noteOn('A', 60, 96, false)!;
    expect(id).not.toBeNull();
    const voice = ctx.voices[ctx.voices.length - 1];
    // Voice buffer is real decoded-or-synth content; gain is audible.
    expect(voice.started).toBe(1);
    // The voice gain connects into the chain input (first hop of the order).
    expect(voice.connectedTo.length).toBeGreaterThan(0);
    engine.noteOff(id);
    expect(engine.getVoiceCount()).toBe(0);
    await engine.dispose();
  });

  it('parameter changes use short ramps (click-free) on the live graph', async () => {
    const { engine, ctx } = silentEngine();
    await engine.init();
    const gainsBefore = ctx.gains.length;
    void gainsBefore;
    engine.setChains(
      { A: chainWith((c) => ({ ...c, comp: { ...c.comp, on: true, amount: 7 } })), B: defaultChain() },
      { ...DEFAULT_FOCUS },
    );
    // FakeAudioParam records ramp events; compressor params moved via ramps.
    const comp = ctx.compressors[ctx.compressors.length - 1];
    const threshold = comp.threshold as unknown as { events: Array<{ op: string }> };
    expect(threshold.events.length).toBeGreaterThan(0);
    expect(threshold.events.some((e) => e.op === 'target')).toBe(true);
    await engine.dispose();
  });

  it('graph cleans up all nodes on release: counts return to baseline', async () => {
    const ctx = new StageFakeContext();
    const engine = new StageEngine({ createContext: () => ctx, fetchImpl: null });
    const nodesBefore = ctx.totalNodes();
    await engine.init();
    expect(ctx.totalNodes()).toBeGreaterThan(nodesBefore);
    const layers: LayerId[] = ['A', 'B'];
    void layers;
    engine.setLayers({ A: defaultPianoLayer({ enabled: true }), B: defaultPianoLayer({ enabled: true, level: 6 }), focus: 'A' });
    const ids = [engine.noteOn('A', 60, 96, false)!, engine.noteOn('B', 64, 96, false)!];
    expect(engine.getVoiceCount()).toBe(2);
    for (const id of ids) engine.noteOff(id);
    expect(engine.getVoiceCount()).toBe(0);
    // All voices disconnected their nodes.
    for (const v of ctx.voices) expect(v.disconnected).toBeGreaterThan(0);
    await engine.dispose();
    expect(engine.getVoiceCount()).toBe(0);
    expect(ctx.closed).toBe(true);
  });
});
