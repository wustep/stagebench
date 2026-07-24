import { createContext, useCallback, useContext, useMemo, useReducer, type ReactNode } from 'react'
import { control, controlValueText, type ControlSpec } from '../model/controls'
import {
  hardwareReducer,
  initialHardwareValues,
  normalisedPosition,
  type HardwareValues,
} from './hardware'

interface HardwareApi {
  readonly values: HardwareValues
  setValue(id: string, value: number): void
  activate(id: string): void
  nudge(id: string, steps: number): void
  reset(): void
}

const HardwareContext = createContext<HardwareApi | null>(null)

export function HardwareProvider({ children }: { children: ReactNode }) {
  const [values, dispatch] = useReducer(hardwareReducer, undefined, initialHardwareValues)

  const api = useMemo<HardwareApi>(
    () => ({
      values,
      setValue: (id, value) => dispatch({ type: 'set', id, value }),
      activate: (id) => dispatch({ type: 'activate', id }),
      nudge: (id, steps) => dispatch({ type: 'nudge', id, steps }),
      reset: () => dispatch({ type: 'reset' }),
    }),
    [values],
  )

  return <HardwareContext.Provider value={api}>{children}</HardwareContext.Provider>
}

export function useHardware(): HardwareApi {
  const api = useContext(HardwareContext)
  if (!api) throw new Error('useHardware must be used inside a HardwareProvider')
  return api
}

export interface ControlHandle {
  readonly spec: ControlSpec
  readonly value: number
  readonly position: number
  readonly valueText: string
  set(value: number): void
  activate(): void
  nudge(steps: number): void
}

export function useControl(id: string): ControlHandle {
  const api = useHardware()
  const spec = control(id)
  const value = api.values[id] ?? spec.initial
  const { setValue, activate, nudge } = api
  const set = useCallback((next: number) => setValue(id, next), [id, setValue])
  const activateControl = useCallback(() => activate(id), [activate, id])
  const nudgeControl = useCallback((steps: number) => nudge(id, steps), [id, nudge])
  return {
    spec,
    value,
    position: normalisedPosition(spec, value),
    valueText: controlValueText(spec, value),
    set,
    activate: activateControl,
    nudge: nudgeControl,
  }
}
