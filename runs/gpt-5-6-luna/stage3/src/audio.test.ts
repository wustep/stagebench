import { describe, expect, it } from 'vitest';
import { PianoAudioEngine, SharedAudioGraph } from './audio';
import { initialPianoState, touchVelocity } from './pianoState';

describe('shared Piano audio boundary', () => {
  it('describes one context, per-layer buses, ordered chains, limiter, and cleanup topology', () => {
    const graph = new SharedAudioGraph(null);
    expect(graph.snapshot()).toEqual({ contextCount: 1, layerBuses: ['A', 'B'], effectOrder: ['mod1', 'mod2', 'delay', 'ampEq', 'compressor', 'reverb', 'rotary'], limiter: false, allEffectsBypass: false });
    graph.dispose();
  });

  it('keeps the offline fallback truthful and note parameters deterministic', () => {
    const engine = new PianoAudioEngine({ context: null, autoLoad: false });
    expect(engine.status.label).toBe('FALLBACK · SYNTH PIANO');
    expect(engine.graphSnapshot.contextCount).toBe(1);
    expect(touchVelocity('Heavy', 0.5)).toBeLessThan(0.5);
    expect(touchVelocity('Light', 0.5)).toBeGreaterThan(0.5);
    expect(initialPianoState.layerA.enabled).toBe(true);
  });
});
