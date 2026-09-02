import { useCallback } from 'react'
import { getControl, type ControlSpec } from '../../hardware/controls'
import { useStore } from '../../state/store'
import { useServices } from '../context'

export interface ControlHandle {
  spec: ControlSpec
  value: number
  pressed: boolean
  setValue(v: number): void
  nudge(direction: 1 | -1, multiplier?: number): void
  press(): void
  release(): void
  activate(): void
}

export function useControl(id: string): ControlHandle {
  const { hardware } = useServices()
  const spec = getControl(id)
  const value = useStore(hardware, (s) => s.values[id] ?? 0)
  const pressed = useStore(hardware, (s) => !!s.pressed[id])
  const setValue = useCallback((v: number) => hardware.setValue(id, v), [hardware, id])
  const nudge = useCallback((d: 1 | -1, m = 1) => hardware.nudge(id, d, m), [hardware, id])
  const press = useCallback(() => hardware.press(id), [hardware, id])
  const release = useCallback(() => hardware.release(id), [hardware, id])
  const activate = useCallback(() => hardware.activate(id), [hardware, id])
  return { spec, value, pressed, setValue, nudge, press, release, activate }
}

/** Shared keyboard handling for slider-like controls. Returns true when the key was consumed. */
export function sliderKey(key: string, handle: ControlHandle): boolean {
  const spec = handle.spec
  if (spec.kind === 'button') return false
  switch (key) {
    case 'ArrowUp':
    case 'ArrowRight':
      handle.nudge(1)
      return true
    case 'ArrowDown':
    case 'ArrowLeft':
      handle.nudge(-1)
      return true
    case 'PageUp':
      handle.nudge(1, 10)
      return true
    case 'PageDown':
      handle.nudge(-1, 10)
      return true
    case 'Home':
      handle.setValue(spec.min)
      return true
    case 'End':
      handle.setValue(spec.max)
      return true
    default:
      return false
  }
}

export function valueText(handle: ControlHandle): string {
  const spec = handle.spec
  if (spec.kind === 'button') {
    if (spec.mode === 'select') return spec.options?.[handle.value] ?? String(handle.value)
    return handle.value ? 'on' : 'off'
  }
  switch (spec.kind) {
    case 'fader':
      return `${Math.round(handle.value)}%`
    case 'drawbar':
      return `${handle.value} of ${spec.max}`
    case 'dial':
      return `${Math.round(handle.value)} degrees`
    case 'wheel':
      return `${Math.round(handle.value * 100)}%`
    case 'stick':
      return handle.value === 0 ? 'centre' : `${handle.value > 0 ? '+' : ''}${(handle.value * 100).toFixed(0)}%`
    default:
      return Number.isInteger(spec.step) ? String(handle.value) : handle.value.toFixed(1)
  }
}
