/**
 * Normalized presentation-only hardware store for Phase 1 decorative controls.
 * Values change how controls look (knob angle, fader position, button LED)
 * and nothing else: no audio, no program/effect state. The piano voice reads
 * no value from this store; keybed input bypasses it entirely.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { CONTROLS, type ControlModel } from '../hardware/sections';

export type HardwareState = Record<string, number>;

export function initialHardwareState(): HardwareState {
  const state: HardwareState = {};
  for (const control of CONTROLS) state[control.id] = control.initial ?? 0;
  return state;
}

/** Next presentation value for an interaction. Buttons toggle, the rest step. */
export function nextDecorativeValue(control: ControlModel, current: number, direction: 1 | -1 = 1): number {
  if (control.kind === 'button') return current > 0 ? 0 : 1;
  const steps = Math.max(2, control.steps ?? 11);
  return (current + (direction === 1 ? 1 : steps - 1)) % steps;
}

interface StageContextValue {
  values: HardwareState;
  interact: (id: string, direction?: 1 | -1) => void;
  valueOf: (id: string) => number;
}

const StageContext = createContext<StageContextValue | null>(null);

export function StageProvider({ children }: { children: React.ReactNode }) {
  const [values, setValues] = useState<HardwareState>(initialHardwareState);

  const interact = useCallback((id: string, direction: 1 | -1 = 1) => {
    setValues((prev) => {
      const control = CONTROLS.find((c) => c.id === id);
      if (!control || control.kind === 'display') return prev;
      return { ...prev, [id]: nextDecorativeValue(control, prev[id] ?? 0, direction) };
    });
  }, []);

  const valueOf = useCallback((id: string) => values[id] ?? 0, [values]);

  const value = useMemo(() => ({ values, interact, valueOf }), [values, interact, valueOf]);
  return <StageContext.Provider value={value}>{children}</StageContext.Provider>;
}

export function useStage(): StageContextValue {
  const ctx = useContext(StageContext);
  if (!ctx) throw new Error('useStage must be used inside <StageProvider>');
  return ctx;
}
