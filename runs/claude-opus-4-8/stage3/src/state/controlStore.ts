/**
 * Presentation-only store for decorative control state.
 *
 * Every control's current value lives here as normalized presentation state:
 * knobs/faders/wheels as 0..1, drawbars as 0..8, selectors as an option index,
 * buttons as boolean on/off. Changing a value changes NOTHING sonic or systemic
 * (honesty contract) — it only moves the on-screen control. The piano keybed and
 * sustain are the sole functional paths and do not read from this store.
 */

import { CONTROLS, CONTROLS_BY_ID, type ControlDef } from '../model/controls';

export type ControlValue = number | boolean;

export interface ControlState {
  [id: string]: ControlValue;
}

function initialValue(def: ControlDef): ControlValue {
  switch (def.kind) {
    case 'button':
      // Buttons honor a default of 1 to start pressed (e.g. Piano section/layer ON).
      return def.default === 1;
    case 'selector':
      return def.default ?? 0;
    case 'drawbar':
      return def.default ?? 0;
    case 'knob':
    case 'fader':
    case 'wheel':
    case 'encoder':
      return def.default ?? 0;
    default:
      return 0;
  }
}

export function createInitialState(): ControlState {
  const state: ControlState = {};
  for (const def of CONTROLS) state[def.id] = initialValue(def);
  return state;
}

export class ControlStore {
  private state: ControlState;
  private readonly listeners = new Set<(state: ControlState) => void>();

  constructor(initial: ControlState = createInitialState()) {
    this.state = initial;
  }

  getState(): ControlState {
    return this.state;
  }

  /** Replace the entire control state (program load). Emits once. */
  replaceState(next: ControlState): void {
    this.state = { ...next };
    this.emit();
  }

  get(id: string): ControlValue | undefined {
    return this.state[id];
  }

  set(id: string, value: ControlValue): void {
    if (!CONTROLS_BY_ID.has(id)) return;
    if (this.state[id] === value) return;
    this.state = { ...this.state, [id]: value };
    this.emit();
  }

  /** Toggle a boolean button control; no-op for non-buttons. */
  toggle(id: string): void {
    const def = CONTROLS_BY_ID.get(id);
    if (!def || def.kind !== 'button') return;
    this.set(id, !this.state[id]);
  }

  /** Advance a selector to the next option (wraps). */
  cycle(id: string, direction: 1 | -1 = 1): void {
    const def = CONTROLS_BY_ID.get(id);
    if (!def || def.kind !== 'selector' || !def.options) return;
    const count = def.options.length;
    const current = Number(this.state[id]) || 0;
    this.set(id, (current + direction + count) % count);
  }

  subscribe(fn: (state: ControlState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.state);
  }
}
