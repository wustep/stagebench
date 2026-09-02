import { createContext, useContext } from 'react'
import type { PianoEngine } from '../audio/engine'
import type { ComputerKeyboard } from '../input/computerKeyboard'
import type { MidiController } from '../input/midi'
import type { NoteBus } from '../input/noteBus'
import type { HardwareStore } from '../state/hardwareStore'

export interface InstrumentServices {
  hardware: HardwareStore
  bus: NoteBus
  engine: PianoEngine
  midi: MidiController
  keyboard: ComputerKeyboard | null
}

export const InstrumentContext = createContext<InstrumentServices | null>(null)

export function useServices(): InstrumentServices {
  const ctx = useContext(InstrumentContext)
  if (!ctx) throw new Error('InstrumentContext is missing')
  return ctx
}
