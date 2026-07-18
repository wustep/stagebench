import { createContext, useContext } from 'react'
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

export interface StatusSnapshot {
  audio: EngineStatus
  audioDetail: string
  midi: MidiStatus
  /** True when running on the labeled fallback (no Web Audio) path. */
  fallback: boolean
}

export const FALLBACK_LABEL = 'Silent fallback'
