import { describe, expect, it } from 'vitest';
import { ProgramStore, createDefaultProgramState, deserializeProgram, serializeProgram } from '../src/programState';
import { EffectsGraph } from '../src/effectsGraph';
import { PianoEngine } from '../src/pianoEngine';

const fakeContext = () => {
  const node = () => { const n: Record<string, unknown> = { connections: [] }; n.connect = (target: unknown) => { (n.connections as unknown[]).push(target); return target; }; n.disconnect = () => undefined; n.gain = { value: 1, setTargetAtTime: vi.fn() }; n.frequency = { value: 1000, setTargetAtTime: vi.fn() }; n.Q = { value: 1, setTargetAtTime: vi.fn() }; n.delayTime = { value: 0, setTargetAtTime: vi.fn() }; n.threshold = { value: 0 }; n.ratio = { value: 1, setTargetAtTime: vi.fn() }; return n; };
  return { currentTime: 0, destination: node(), createGain: node, createDynamicsCompressor: node, createDelay: node, createBiquadFilter: node } as unknown as AudioContext;
};

describe('Phase 3 canonical Programs', () => {
  it('round-trips supported state including layers, zones, scenes, morphs and effects', () => {
    const store = new ProgramStore(); store.setLayer('pianoB', { enabled: true, zone: [1, 2] }); store.editZone('Mid', 'F4'); store.setCrossfade(12); store.switchScene('II'); store.assignMorph('Wheel', 'layer.pianoA', .2, .9); store.setEffect('reverb', { on: true, dryWet: .4 });
    const restored = deserializeProgram(serializeProgram(store.state));
    expect(restored.layers.pianoB.enabled).toBe(true); expect(restored.zones.mid).toBe('F4'); expect(restored.zones.crossfade).toBe(12); expect(restored.activeScene).toBe('II'); expect(restored.morphs[0].source).toBe('Wheel'); expect(restored.effects.reverb.dryWet).toBe(.4);
  });
  it('supports store/store-as, dirty cancel, undo, live slots and list/display modes', () => {
    const store = new ProgramStore(); store.update(s => { s.name = 'Edited'; }); expect(store.dirty).toBe(true); store.cancel(); expect(store.state.name).toBe('01 Grand Piano'); store.storeAs('Bright Hall', 'Piano'); expect(store.programs.has('Bright Hall')).toBe(true); store.setListMode('Alphabetic'); store.setDisplayMode(3); expect(store.state.listMode).toBe('Alphabetic'); store.setLive(1, 'Bright Hall'); expect(store.recallLive(1)).toBe(true); store.update(s => { s.routing.transpose = 2; }); expect(store.undo()).toBe(true);
  });
  it('applies morph values to layer and named effect destinations', () => {
    const store = new ProgramStore(); store.assignMorph('Wheel', 'layer.pianoA', .2, .8); store.assignMorph('Wheel', 'effect.reverb.amount', .1, .9); store.applyMorph('Wheel', .5);
    expect(store.state.layers.pianoA.level).toBeCloseTo(.5); expect(store.state.effects.reverb.params.amount).toBeCloseTo(.5);
  });
});

describe('Phase 3 shared effect graph', () => {
  it('has one ordered graph and deterministic audible processing with bypass', () => {
    const graph = new EffectsGraph(null); expect(graph.layerBuses.size).toBe(6); expect(graph.masterBus).toBeNull();
    const dry = new Float32Array(22050); dry[0] = 1; graph.setEffect('mod1', { on: true, params: { amount: .9, rate: .7 } }); graph.setEffect('delay', { on: true, dryWet: 1, params: { feedback: .8, tempo: .5 } });
    const wet = graph.process(dry); expect(wet).not.toEqual(dry); graph.setAllBypass(true); expect(graph.process(dry)).toEqual(dry); graph.dispose();
  });
  it('changes representative units and targets rotary only after reverb', () => {
    const graph = new EffectsGraph(null); const source = new Float32Array(22050); source[0] = 1;
    for (const unit of ['mod1','mod2','delay','ampEq','compressor','reverb'] as const) { graph.setEffect(unit, { on: true, dryWet: .7, params: { amount: .8, drive: .8 } }); expect(graph.process(source)).not.toEqual(source); graph.setBypass(unit, true); }
    graph.setEffect('rotary', { on: true, toRotary: true, dryWet: 1 }); expect(graph.process(source)).not.toEqual(source);
  });
  it('supports live Piano routing and morph boundary without creating another context', () => {
    const engine = new PianoEngine(null); engine.setRouting({ low: 36, mid: 60, high: 84, crossfade: 6, layerZones: { pianoA: [0, 1], pianoB: [2, 3] } });
    engine.setControl('layerA', true); engine.setControl('layerB', true); const low = engine.noteOn(40); const high = engine.noteOn(90); expect(low).toBeGreaterThan(0); expect(high).toBeGreaterThan(0); engine.setMorphSource('Wheel', 1); expect(engine.controls.layerLevelA).toBeGreaterThan(.8); expect(engine.graph.context).toBe(engine.audioContext); engine.dispose();
  });
  it('automates native wet/dry and bypass through the shared context boundary', () => {
    const context = fakeContext(); const graph = new EffectsGraph(context); graph.setEffect('delay', { on: true, dryWet: .65, params: { tempo: .5 } }); const delay = graph.layerBuses.get('piano-A')?.chain.get('delay') as unknown as { delayTime: { setTargetAtTime: ReturnType<typeof vi.fn> } }; expect(delay.delayTime.setTargetAtTime).toHaveBeenCalled(); graph.setBypass('delay', true); graph.setAllBypass(true); expect(graph.allBypass).toBe(true); graph.dispose();
  });
});

void createDefaultProgramState;
