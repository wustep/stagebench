import { describe, expect, it } from 'vitest';
import { ControlStore, createInitialState } from '../src/state/controlStore';
import { CONTROLS, CONTROLS_BY_ID } from '../src/model/controls';

// feature: interaction.decorative-controls (presentation state only)
describe('control store (interaction.decorative-controls)', () => {
  it('initializes every control with a defined presentation value', () => {
    const state = createInitialState();
    for (const ctrl of CONTROLS) {
      expect(state[ctrl.id]).toBeDefined();
    }
  });

  it('buttons default off and toggle on/off', () => {
    const store = new ControlStore();
    const btn = CONTROLS.find((c) => c.kind === 'button')!;
    expect(store.get(btn.id)).toBe(false);
    store.toggle(btn.id);
    expect(store.get(btn.id)).toBe(true);
    store.toggle(btn.id);
    expect(store.get(btn.id)).toBe(false);
  });

  it('selectors cycle within their option list and wrap', () => {
    const store = new ControlStore();
    const sel = CONTROLS_BY_ID.get('piano-type')!;
    const count = sel.options!.length;
    const start = Number(store.get('piano-type'));
    store.cycle('piano-type', 1);
    expect(store.get('piano-type')).toBe((start + 1) % count);
    // wrap backwards from 0
    for (let i = 0; i < count; i++) store.cycle('piano-type', -1);
    expect(store.get('piano-type')).toBe((start + 1) % count);
  });

  it('knobs/faders clamp to their set value and notify subscribers', () => {
    const store = new ControlStore();
    let notified = 0;
    store.subscribe(() => notified++);
    store.set('performance-master-level', 0.42);
    expect(store.get('performance-master-level')).toBe(0.42);
    expect(notified).toBe(1);
  });

  it('ignores unknown ids and toggling non-buttons', () => {
    const store = new ControlStore();
    store.set('does-not-exist', 1);
    expect(store.get('does-not-exist')).toBeUndefined();
    store.toggle('performance-master-level'); // not a button
    expect(store.get('performance-master-level')).not.toBe(true);
  });

  it('setting the same value does not re-notify', () => {
    const store = new ControlStore();
    let notified = 0;
    store.subscribe(() => notified++);
    const v = store.get('organ-level-a');
    store.set('organ-level-a', v as number);
    expect(notified).toBe(0);
  });
});
