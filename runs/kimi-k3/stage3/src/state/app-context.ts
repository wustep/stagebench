import { createContext, useContext, useSyncExternalStore } from 'react'
import type { PianoEngine, EngineStatus } from '../audio/engine'
import type { MidiStatus } from '../input/midi'

export interface AppServices {
  engine: PianoEngine
}

export const AppContext = createContext<AppServices | null>(null)

export function useEngine(): PianoEngine {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('AppContext missing')
  return ctx.engine
}

const engineEvents = new Map<PianoEngine, Set<() => void>>()
const engineVersions = new Map<PianoEngine, number>()

function versionOf(engine: PianoEngine): number {
  return engineVersions.get(engine) ?? 0
}

/** Called by App when the engine reports a state change: bumps the version + notifies subscribers. */
export function notifyEngineChanged(engine: PianoEngine): void {
  engineVersions.set(engine, versionOf(engine) + 1)
  const set = engineEvents.get(engine)
  if (set) for (const l of set) l()
}

/** Re-render hook: subscribes to engine state changes (engine is external state). */
export function useEngineVersion(): number {
  const engine = useEngine()
  return useSyncExternalStore(
    (listener) => {
      let set = engineEvents.get(engine)
      if (!set) {
        set = new Set()
        engineEvents.set(engine, set)
      }
      set.add(listener)
      return () => {
        set.delete(listener)
      }
    },
    () => versionOf(engine),
  )
}

export interface StatusSnapshot {
  audio: EngineStatus
  audioDetail: string
  midi: MidiStatus
  /** True when running on the labeled fallback (no Web Audio) path. */
  fallback: boolean
}

export const FALLBACK_LABEL = 'Silent fallback'
/** Label for the synthesized fallback used when a recorded type's assets fail. */
export const SYNTH_FALLBACK_LABEL = 'Synthesized fallback'
