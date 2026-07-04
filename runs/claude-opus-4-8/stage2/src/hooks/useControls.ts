import { useCallback, useSyncExternalStore } from 'react';
import { ControlStore, type ControlState, type ControlValue } from '../state/controlStore';

export interface ControlApi {
  state: ControlState;
  get(id: string): ControlValue | undefined;
  set(id: string, value: ControlValue): void;
  toggle(id: string): void;
  cycle(id: string, dir?: 1 | -1): void;
}

/** Subscribe a component tree to a ControlStore instance. */
export function useControls(store: ControlStore): ControlApi {
  const state = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getState(),
    () => store.getState(),
  );

  const set = useCallback((id: string, value: ControlValue) => store.set(id, value), [store]);
  const toggle = useCallback((id: string) => store.toggle(id), [store]);
  const cycle = useCallback((id: string, dir: 1 | -1 = 1) => store.cycle(id, dir), [store]);
  const get = useCallback((id: string) => store.get(id), [store]);

  return { state, get, set, toggle, cycle };
}
