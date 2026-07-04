import { useEffect, useRef } from 'react';
import type { ControlStore } from '../state/controlStore';
import type { PerformanceStore } from '../state/performanceStore';
import type { MorphAssignment } from '../state/program';

/**
 * Morph engine. When a morph SOURCE control (mod wheel / control pedal) moves,
 * every assigned destination interpolates from its `from` value to its `to`
 * value by the source position (0..1). A morph may raise one destination while
 * lowering another (each assignment carries its own from/to). Assigned knobs
 * light their green morph LED via PerformanceStore state.
 *
 * The write goes to the ControlStore so the panel and audio move together
 * (honesty contract). Morph writes are marked transient so they do not re-arm
 * the program dirty flag beyond the underlying edits.
 */
export function useMorph(
  store: ControlStore,
  perfStore: PerformanceStore,
): void {
  const applyingRef = useRef(false);

  useEffect(() => {
    const applyMorph = (source: 'wheel' | 'ctrlPedal', assignments: MorphAssignment[], position: number) => {
      if (assignments.length === 0) return;
      applyingRef.current = true;
      for (const a of assignments) {
        const value = a.from + (a.to - a.from) * position;
        store.set(a.controlId, clampFor(value));
      }
      applyingRef.current = false;
      void source;
    };

    const unsub = store.subscribe((state) => {
      if (applyingRef.current) return;
      const perf = perfStore.getState();
      const wheel = Number(state['performance-mod-wheel'] ?? 0);
      const pedal = Number(state['performance-ctrl-pedal'] ?? 0);
      // Only re-apply if there are assignments (avoids feedback storms).
      if (perf.morph.wheel.length > 0) applyMorph('wheel', perf.morph.wheel, wheel);
      if (perf.morph.ctrlPedal.length > 0) applyMorph('ctrlPedal', perf.morph.ctrlPedal, pedal);
    });
    return unsub;
  }, [store, perfStore]);
}

function clampFor(v: number): number {
  return Math.max(0, Math.min(1, v));
}
