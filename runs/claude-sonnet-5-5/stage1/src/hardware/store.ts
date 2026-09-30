import type { ButtonSpec, ControlSpec } from './types'

/**
 * Normalized hardware model. It stores *presentation state only*: where a knob is turned, whether
 * a button is lit or held. Nothing in the audio path reads from this module.
 */
export interface ControlState {
  /** knob/fader/wheel: 0..1; drawbar: 0..8; encoder: detent index; button: 0/1 or option index */
  value: number
  held: boolean
}

export interface HardwareStore {
  get(id: string): ControlState
  subscribe(id: string, listener: () => void): () => void
  subscribeAll(listener: () => void): () => void
  set(id: string, value: number): void
  step(id: string, direction: 1 | -1, coarse?: boolean): void
  press(id: string): void
  release(id: string): void
  home(id: string, target: 'min' | 'max' | 'center'): void
  /** returns a plain object for tests and diagnostics */
  snapshot(): Record<string, ControlState>
  listenerCount(): number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export const buttonSteps = (spec: ButtonSpec): number => (spec.mode === 'cycle' ? Math.max(2, spec.options.length) : 2)

const initialValue = (spec: ControlSpec): number => {
  switch (spec.kind) {
    case 'knob':
    case 'fader':
    case 'wheel':
    case 'drawbar':
      return spec.initial
    case 'encoder':
    case 'button':
      return 0
  }
}

export const stepSize = (spec: ControlSpec): number => {
  switch (spec.kind) {
    case 'knob':
    case 'fader':
      return 0.05
    case 'wheel':
      return 0.05
    default:
      return 1
  }
}

export function createHardwareStore(specs: readonly ControlSpec[]): HardwareStore {
  const byId = new Map(specs.map((s) => [s.id, s]))
  const states = new Map<string, ControlState>()
  const listeners = new Map<string, Set<() => void>>()
  const allListeners = new Set<() => void>()
  for (const s of specs) states.set(s.id, { value: initialValue(s), held: false })

  const spec = (id: string): ControlSpec => {
    const s = byId.get(id)
    if (!s) throw new Error(`unknown control ${id}`)
    return s
  }
  const commit = (id: string, next: ControlState) => {
    const prev = states.get(id)
    if (prev && prev.value === next.value && prev.held === next.held) return
    states.set(id, next)
    listeners.get(id)?.forEach((l) => l())
    allListeners.forEach((l) => l())
  }
  const quantize = (s: ControlSpec, v: number): number => {
    switch (s.kind) {
      case 'knob':
      case 'fader':
      case 'wheel':
        return clamp(Math.round(v * 1000) / 1000, 0, 1)
      case 'drawbar':
        return clamp(Math.round(v), 0, 8)
      case 'encoder': {
        const n = s.detents
        return ((Math.round(v) % n) + n) % n
      }
      case 'button':
        return clamp(Math.round(v), 0, buttonSteps(s) - 1)
    }
  }

  return {
    get: (id) => {
      const s = states.get(id)
      if (!s) throw new Error(`unknown control ${id}`)
      return s
    },
    subscribe(id, listener) {
      let set = listeners.get(id)
      if (!set) listeners.set(id, (set = new Set()))
      set.add(listener)
      return () => {
        set.delete(listener)
      }
    },
    subscribeAll(listener) {
      allListeners.add(listener)
      return () => {
        allListeners.delete(listener)
      }
    },
    set(id, value) {
      const s = spec(id)
      const cur = states.get(id)!
      commit(id, { ...cur, value: quantize(s, value) })
    },
    step(id, direction, coarse = false) {
      const s = spec(id)
      const cur = states.get(id)!
      const amount = stepSize(s) * (coarse ? (s.kind === 'knob' || s.kind === 'fader' || s.kind === 'wheel' ? 2 : 4) : 1)
      commit(id, { ...cur, value: quantize(s, cur.value + direction * amount) })
    },
    press(id) {
      const s = spec(id)
      const cur = states.get(id)!
      if (s.kind !== 'button') return
      if (s.mode === 'latch') commit(id, { value: cur.value ? 0 : 1, held: true })
      else if (s.mode === 'cycle') commit(id, { value: (cur.value + 1) % buttonSteps(s), held: true })
      else commit(id, { value: 1, held: true })
    },
    release(id) {
      const s = spec(id)
      const cur = states.get(id)!
      if (s.kind === 'button') {
        commit(id, { value: s.mode === 'momentary' ? 0 : cur.value, held: false })
      } else if (s.kind === 'wheel' && s.spring) {
        commit(id, { value: s.initial, held: false })
      } else {
        commit(id, { ...cur, held: false })
      }
    },
    home(id, target) {
      const s = spec(id)
      const cur = states.get(id)!
      const max = s.kind === 'drawbar' ? 8 : s.kind === 'encoder' ? s.detents - 1 : 1
      const value = target === 'min' ? 0 : target === 'max' ? max : s.kind === 'wheel' ? s.initial : max / 2
      commit(id, { ...cur, value: quantize(s, value) })
    },
    snapshot() {
      return Object.fromEntries(states)
    },
    listenerCount() {
      let n = allListeners.size
      listeners.forEach((s) => (n += s.size))
      return n
    },
  }
}
