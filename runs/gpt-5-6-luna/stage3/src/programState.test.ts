import { describe, expect, it } from 'vitest';
import { createInitialProgramState, deserializeProgram, morphValue, reduceProgramState, serializeProgram } from './programState';

describe('canonical Stage 4 Program state', () => {
  it('round-trips supported layers, effects, routing, splits, scenes, and morphs', () => {
    let state = createInitialProgramState();
    state = reduceProgramState(state, { type: 'split-enabled', value: true });
    state = reduceProgramState(state, { type: 'split-point', point: 'Mid', value: 'F4' });
    state = reduceProgramState(state, { type: 'crossfade', point: 'Mid', value: 12 });
    state = reduceProgramState(state, { type: 'zone', layer: 'pianoB', zone: 2, enabled: true });
    state = reduceProgramState(state, { type: 'scene', scene: 'II' });
    state = reduceProgramState(state, { type: 'morph-assign', source: 'Wheel', destination: 'Piano Layer Level', start: 0.2, end: 0.9 });
    state = reduceProgramState(state, { type: 'effect', id: 'delay', patch: { feedback: 0.7, dryWet: 0.45 } });
    const restored = deserializeProgram(serializeProgram(state));
    expect(restored.splits).toEqual(state.splits);
    expect(restored.layers.pianoB.zones).toContain(2);
    expect(restored.scenes.active).toBe('II');
    expect(restored.morphs.Wheel[0].end).toBe(0.9);
    expect(restored.effects.delay.feedback).toBe(0.7);
    expect(restored.routing.focus).toBe('Piano');
  });

  it('supports dirty, store, store-as, cancel, undo, live slots, and display modes', () => {
    const initial = createInitialProgramState();
    let state = reduceProgramState(initial, { type: 'rename', name: 'Morph Study', category: 'Synth' });
    expect(state.meta.dirty).toBe(true);
    state = reduceProgramState(state, { type: 'undo' });
    expect(state.meta.name).toBe('Stage 4');
    state = reduceProgramState(state, { type: 'rename', name: 'Stored Study', category: 'Piano' });
    state = reduceProgramState(state, { type: 'store-as', number: 'B:22' });
    expect(state.meta.dirty).toBe(false);
    expect(state.storedPrograms.some((item) => item.number === 'B:22')).toBe(true);
    state = reduceProgramState(state, { type: 'set-list', value: 'Category' });
    state = reduceProgramState(state, { type: 'set-view', value: 'edit' });
    expect(state.meta.listMode).toBe('Category');
    expect(state.meta.viewMode).toBe('edit');
    state = reduceProgramState(state, { type: 'live', slot: 7 });
    expect(state.meta.number).toBe('LIVE 8');
    expect(state.liveSlots).toHaveLength(8);
  });

  it('interpolates, copies, and clears morph assignments', () => {
    let state = createInitialProgramState();
    state = reduceProgramState(state, { type: 'morph-assign', source: 'Aftertouch', destination: 'Delay Dry/Wet', start: 0.1, end: 0.8 });
    expect(morphValue(state, 'Aftertouch', 'Delay Dry/Wet', 0.5)).toBeCloseTo(0.45);
    state = reduceProgramState(state, { type: 'morph-copy', source: 'Aftertouch', destination: 'Control Pedal' });
    expect(state.morphs['Control Pedal'][0].source).toBe('Control Pedal');
    state = reduceProgramState(state, { type: 'morph-clear', source: 'Aftertouch' });
    expect(state.morphs.Aftertouch).toHaveLength(0);
  });
});
