import { useCallback, useSyncExternalStore } from 'react'
import { CONTROLS, defaultControlValues } from '../model/hardware'
import { notifyButtonPress, notifyControlChange } from './engine-registry'

export type HardwareValues = Record<string, number>

type Listener = () => void

class HardwareStore {
  private values: HardwareValues = defaultControlValues()
  private pressedKeys = new Set<number>()
  private listeners = new Set<Listener>()
  private version = 0

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    this.version++
    for (const fn of this.listeners) fn()
  }

  getSnapshot = (): number => this.version

  getValues(): HardwareValues {
    return this.values
  }

  getValue(id: string): number {
    return this.values[id] ?? 0
  }

  setValue(id: string, value: number): void {
    const def = CONTROLS.find((c) => c.id === id)
    if (!def) return
    const min = def.min ?? 0
    const max = def.max ?? 1
    const next = Math.max(min, Math.min(max, value))
    if (this.values[id] === next) return
    this.values = { ...this.values, [id]: next }
    this.emit()
    notifyControlChange(id, next)
  }

  /** Toggle or set button presentation state */
  pressButton(id: string): void {
    const def = CONTROLS.find((c) => c.id === id)
    if (!def || def.kind !== 'button') return
    if (def.momentary) {
      this.values = { ...this.values, [id]: 1 }
      this.emit()
      notifyButtonPress(id)
      window.setTimeout(() => {
        this.values = { ...this.values, [id]: 0 }
        this.emit()
      }, 120)
      return
    }
    this.values = { ...this.values, [id]: this.values[id] ? 0 : 1 }
    this.emit()
    notifyButtonPress(id)
  }

  setKeyPressed(midi: number, pressed: boolean): void {
    const has = this.pressedKeys.has(midi)
    if (pressed && !has) {
      this.pressedKeys.add(midi)
      this.emit()
    } else if (!pressed && has) {
      this.pressedKeys.delete(midi)
      this.emit()
    }
  }

  isKeyPressed(midi: number): boolean {
    return this.pressedKeys.has(midi)
  }

  getPressedKeys(): number[] {
    return [...this.pressedKeys]
  }

  reset(): void {
    this.values = defaultControlValues()
    this.pressedKeys.clear()
    this.emit()
  }
}

export const hardwareStore = new HardwareStore()

export function useHardwareVersion(): number {
  return useSyncExternalStore(hardwareStore.subscribe, hardwareStore.getSnapshot, hardwareStore.getSnapshot)
}

export function useControlValue(id: string): number {
  useHardwareVersion()
  return hardwareStore.getValue(id)
}

export function useIsKeyPressed(midi: number): boolean {
  useHardwareVersion()
  return hardwareStore.isKeyPressed(midi)
}

export function useSetControl(): (id: string, value: number) => void {
  return useCallback((id: string, value: number) => hardwareStore.setValue(id, value), [])
}

export function usePressButton(): (id: string) => void {
  return useCallback((id: string) => hardwareStore.pressButton(id), [])
}
