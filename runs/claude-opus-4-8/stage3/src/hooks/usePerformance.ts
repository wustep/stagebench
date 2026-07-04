import { useSyncExternalStore } from 'react';
import type { PerformanceStore } from '../state/performanceStore';
import type { ProgramManager } from '../state/programManager';
import type { PerformanceState } from '../state/program';

/** Subscribe a component to a PerformanceStore. */
export function usePerformanceState(store: PerformanceStore): PerformanceState {
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getState(),
    () => store.getState(),
  );
}

/** Subscribe a component to a ProgramManager (returns a monotonically bumped tick). */
export function useProgramTick(manager: ProgramManager): number {
  return useSyncExternalStore(
    (cb) => manager.subscribe(cb),
    () => versionOf(manager),
    () => versionOf(manager),
  );
}

const versions = new WeakMap<ProgramManager, number>();
function versionOf(m: ProgramManager): number {
  // A cheap changing snapshot: dirty + location + name length + store-armed.
  const loc = m.location();
  const key = `${loc.bank}:${loc.index}:${m.isDirty()}:${m.isStoreArmed()}:${m.currentName()}`;
  const prev = versions.get(m);
  const hash = hashString(key);
  if (prev !== hash) versions.set(m, hash);
  return hash;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
