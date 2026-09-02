import { createContext, useContext, useSyncExternalStore } from 'react'
import type { EngineStatus, PianoEngine } from '../audio/engine'
import type { InstrumentController } from '../audio/instrumentController'
import type { SampleLibrary } from '../audio/sampleLibrary'
import type { ComputerKeyboard } from '../input/computerKeyboard'
import type { MidiController } from '../input/midi'
import type { NoteBus } from '../input/noteBus'
import type { HardwareStore } from '../state/hardwareStore'
import type { InstrumentState, InstrumentStore } from '../state/instrumentState'
import { useStore } from '../state/store'

export interface InstrumentServices {
  hardware: HardwareStore
  bus: NoteBus
  engine: PianoEngine
  midi: MidiController
  keyboard: ComputerKeyboard | null
  /** Canonical Phase 2 state (piano layers, effect chains, rotary, master, shift latch). */
  state: InstrumentStore
  controller: InstrumentController
  /** Bundled sample library, or null when the app runs with the generated voice only. */
  library: SampleLibrary | null
}

export const InstrumentContext = createContext<InstrumentServices | null>(null)

export function useServices(): InstrumentServices {
  const ctx = useContext(InstrumentContext)
  if (!ctx) throw new Error('InstrumentContext is missing')
  return ctx
}

export function useInstrumentState<S>(selector: (s: InstrumentState) => S): S {
  const { state } = useServices()
  return useStore(state, selector)
}

export function useEngineStatus(): EngineStatus {
  const { engine } = useServices()
  return useSyncExternalStore(engine.subscribe, engine.getStatus, engine.getStatus)
}
