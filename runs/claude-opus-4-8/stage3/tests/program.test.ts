import { describe, expect, it } from 'vitest';
import { ControlStore } from '../src/state/controlStore';
import { PerformanceStore } from '../src/state/performanceStore';
import { ProgramManager, SLOT_COUNT, LIVE_SLOT_COUNT } from '../src/state/programManager';
import { factoryPrograms } from '../src/state/factoryPrograms';
import { serializeProgram, deserializeProgram, makeProgram, defaultPerformanceState } from '../src/state/program';

function setup() {
  const controls = new ControlStore();
  const perf = new PerformanceStore();
  const pm = new ProgramManager(controls, perf);
  return { controls, perf, pm };
}

// feature: programs.roundtrip
describe('program round-trip (programs.roundtrip)', () => {
  it('serializes and deserializes a program losslessly', () => {
    const controls = new ControlStore();
    controls.set('synth-on', true);
    controls.set('synth-filter-freq', 0.42);
    const perf = defaultPerformanceState();
    perf.transpose = 4;
    perf.split.on = true;
    perf.split.points.mid = 3;
    perf.morph.wheel = [{ controlId: 'synth-filter-freq', from: 0.42, to: 0.9 }];
    const p = makeProgram('Test Prog', controls.getState(), perf);
    const round = deserializeProgram(serializeProgram(p));
    expect(round.name).toBe('Test Prog');
    expect(round.controls['synth-filter-freq']).toBe(0.42);
    expect(round.controls['synth-on']).toBe(true);
    expect(round.performance.transpose).toBe(4);
    expect(round.performance.split.on).toBe(true);
    expect(round.performance.morph.wheel).toEqual([{ controlId: 'synth-filter-freq', from: 0.42, to: 0.9 }]);
  });

  it('Master Level is excluded from stored program state', () => {
    const controls = new ControlStore();
    controls.set('performance-master-level', 0.9);
    const p = makeProgram('X', controls.getState(), defaultPerformanceState());
    expect('performance-master-level' in p.controls).toBe(false);
  });

  it('storing then reloading a slot restores every supported control', () => {
    const { controls, pm } = setup();
    // Edit several controls, then STORE (arm captures edits), browse to slot 5,
    // and STORE again to confirm — the edited buffer is written to slot 5.
    controls.set('synth-on', true);
    controls.set('synth-filter-freq', 0.77);
    controls.set('organ-on', true);
    controls.set('organ-drawbar-4', 6);
    pm.store(); // arm — captures the edited buffer
    pm.selectProgramIndex(5); // browse destination (audition)
    pm.store(); // confirm — writes edited buffer to slot 5
    // Change to another program (edit-discard), then return.
    pm.selectProgramIndex(6);
    expect(controls.get('synth-filter-freq')).not.toBe(0.77);
    pm.selectProgramIndex(5);
    expect(controls.get('synth-on')).toBe(true);
    expect(controls.get('synth-filter-freq')).toBe(0.77);
    expect(controls.get('organ-drawbar-4')).toBe(6);
  });
});

// feature: programs.navigation
describe('program navigation (programs.navigation)', () => {
  it('has 32 slots across 4 pages and 8 live slots', () => {
    const { pm } = setup();
    expect(pm.programList().length).toBe(SLOT_COUNT);
    expect(pm.liveList().length).toBe(LIVE_SLOT_COUNT);
    expect(pm.displayLabel({ bank: 'program', index: 0 })).toBe('1.1');
    expect(pm.displayLabel({ bank: 'program', index: 9 })).toBe('2.2');
    expect(pm.displayLabel({ bank: 'program', index: 31 })).toBe('4.8');
  });

  it('ships at least 8 factory programs demonstrating varied setups', () => {
    const fp = factoryPrograms();
    expect(fp.length).toBeGreaterThanOrEqual(8);
    const names = fp.map((p) => p.name);
    expect(names.some((n) => /grand|piano/i.test(n))).toBe(true);
    expect(names.some((n) => /b3|vox|organ/i.test(n))).toBe(true);
    expect(names.some((n) => /saw|pad|lead|synth/i.test(n))).toBe(true);
    expect(names.some((n) => /split/i.test(n))).toBe(true);
  });

  it('dial step and page buttons move through slots', () => {
    const { pm } = setup();
    pm.selectProgramIndex(0);
    pm.step(1);
    expect(pm.location().index).toBe(1);
    pm.pageStep(1);
    expect(pm.location().index).toBe(9); // page 2, button 2
    pm.pressButton(0);
    expect(pm.location().index).toBe(8); // page 2, button 1
  });
});

// feature: programs.undo-cancel — dirty state + edit-discard
describe('dirty state and edit-discard (programs.undo-cancel)', () => {
  it('editing marks dirty; selecting another program discards edits', () => {
    const { controls, pm } = setup();
    expect(pm.isDirty()).toBe(false);
    controls.set('synth-filter-freq', 0.33);
    expect(pm.isDirty()).toBe(true);
    pm.selectProgramIndex(3); // discard
    expect(pm.isDirty()).toBe(false);
    pm.selectProgramIndex(0);
    expect(controls.get('synth-filter-freq')).not.toBe(0.33);
  });

  it('store clears the dirty flag', () => {
    const { controls, pm } = setup();
    controls.set('synth-osc-ctrl', 0.9);
    expect(pm.isDirty()).toBe(true);
    pm.store();
    pm.store();
    expect(pm.isDirty()).toBe(false);
  });

  it('cancel store reverts to the current program', () => {
    const { pm } = setup();
    pm.store(); // arm
    expect(pm.isStoreArmed()).toBe(true);
    pm.cancelStore();
    expect(pm.isStoreArmed()).toBe(false);
  });
});

// feature: programs.store-live
describe('live slots auto-store (programs.store-live)', () => {
  it('live mode edits persist automatically and survive export/import', () => {
    const { controls, pm } = setup();
    pm.setLiveMode(true);
    expect(pm.isLiveMode()).toBe(true);
    controls.set('synth-on', true);
    controls.set('synth-filter-freq', 0.61);
    // Live auto-stores: dirty stays false.
    expect(pm.isDirty()).toBe(false);
    // Move to another live slot and back — the edit persisted.
    pm.pressButton(1);
    pm.pressButton(0);
    expect(controls.get('synth-filter-freq')).toBe(0.61);

    // Survives a bank export/import (reload).
    const json = pm.exportBank();
    const controls2 = new ControlStore();
    const perf2 = new PerformanceStore();
    const pm2 = new ProgramManager(controls2, perf2);
    pm2.importBank(json);
    pm2.setLiveMode(true);
    pm2.pressButton(0);
    expect(controls2.get('synth-filter-freq')).toBe(0.61);
  });

  it('store as writes a named program', () => {
    const { controls, pm } = setup();
    controls.set('synth-on', true);
    pm.selectProgramIndex(10);
    pm.storeAs('My Lead');
    expect(pm.programList()[10].name).toBe('My Lead');
  });
});

// feature: scenes.switching
describe('layer scenes (scenes.switching)', () => {
  it('scene toggles enable state without changing sound params', () => {
    const { controls, perf, pm } = setup();
    void pm;
    controls.set('synth-filter-freq', 0.55);
    perf.setLayerEnabled('I', 'synth-A', true);
    perf.setLayerEnabled('II', 'synth-A', false);
    perf.setScene('I');
    expect(perf.getState().scenes.I['synth-A']).toBe(true);
    perf.setScene('II');
    expect(perf.getState().scenes.II['synth-A']).toBe(false);
    // Sound param unchanged across scenes.
    expect(controls.get('synth-filter-freq')).toBe(0.55);
  });
});

// feature: morph.assignments
describe('morph assignment + clear (morph.assignments)', () => {
  it('adds, replaces, and clears morph assignments per source', () => {
    const { perf } = setup();
    perf.addMorph('wheel', { controlId: 'synth-filter-freq', from: 0.2, to: 0.9 });
    perf.addMorph('wheel', { controlId: 'synth-osc-ctrl', from: 0.5, to: 0.1 });
    expect(perf.getState().morph.wheel.length).toBe(2);
    // Replace an existing assignment.
    perf.addMorph('wheel', { controlId: 'synth-filter-freq', from: 0.2, to: 0.5 });
    expect(perf.getState().morph.wheel.length).toBe(2);
    expect(perf.getState().morph.wheel.find((a) => a.controlId === 'synth-filter-freq')!.to).toBe(0.5);
    // Clear the source.
    perf.clearMorphSource('wheel');
    expect(perf.getState().morph.wheel.length).toBe(0);
  });
});
