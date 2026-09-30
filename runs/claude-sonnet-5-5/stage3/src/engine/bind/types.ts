import type { Scheduler } from '../../audio/types'
import type { ControlAction, HardwareStore } from '../../hardware/store'
import type { ProgramSystem } from '../programs'
import type { EngineState, EngineStore } from '../state'
import type { UiModeStore } from '../uiMode'

/** what every section binder can use: the stores, the clock, the Shift key and the hold gesture */
export interface BindCtx {
  store: HardwareStore
  engine: EngineStore
  programs: ProgramSystem | null
  ui: UiModeStore
  scheduler: Scheduler
  now(): number
  /** apply a canonical edit, then write the result back to the panel */
  edit(fn: (s: EngineState) => EngineState): void
  reflect(): void
  shiftHeld(a?: ControlAction): boolean
  /** run `onHold` if the button stays down for the hold time; the returned id is cleared by `endHold` */
  startHold(id: string, onHold: () => void): void
  /** true when the hold fired (the release is then not a tap) */
  endHold(id: string): boolean
  /** mark the current press as consumed, so its release does nothing */
  consume(id: string): void
  /** show a transient line on the Program display for a moment */
  flash(text: string): void
  /** the section whose control was touched last (what SOLO isolates) */
  lastSection(): 'piano' | 'organ' | 'synth'
  /** Panic: all notes off, held performance inputs reset */
  panic(): void
  /** be told about every key press on the keybed (SET KEY) */
  observeNotes(observer: (note: number) => void): () => void
}

export type ContinuousHandler = (s: EngineState, v: number, ctx: BindCtx) => EngineState

export interface Binder {
  /** ids this binder makes functional */
  ids: readonly string[]
  continuous?: Record<string, ContinuousHandler>
  press?(a: ControlAction, ctx: BindCtx): boolean
  release?(a: ControlAction, ctx: BindCtx): boolean
  /** endless encoders: `delta` detents since the last event (wrapped, signed) */
  dial?(id: string, delta: number, ctx: BindCtx): boolean
  /** encoder ids this binder wants delta events for */
  dials?: readonly string[]
  sync(s: EngineState, ctx: BindCtx): void
  dispose?(): void
}

export const octaveText = (n: number) => (n > 0 ? `+${n}` : String(n))
export const shortestDelta = (prev: number, next: number, n: number): number => {
  const d = (((next - prev) % n) + n) % n
  return d > n / 2 ? d - n : d
}
