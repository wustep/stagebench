import { createContext, useContext, useSyncExternalStore, type CSSProperties } from 'react'
import type { Instrument, InstrumentSnapshot } from '../audio/instrument'
import type { ControlState, HardwareStore } from '../hardware/store'

export const HardwareContext = createContext<HardwareStore | null>(null)
export const InstrumentContext = createContext<Instrument | null>(null)

export const useHardware = (): HardwareStore => {
  const store = useContext(HardwareContext)
  if (!store) throw new Error('HardwareContext missing')
  return store
}

export const useControlState = (id: string): ControlState => {
  const store = useHardware()
  return useSyncExternalStore(
    (cb) => store.subscribe(id, cb),
    () => store.get(id),
  )
}

const EMPTY_SNAPSHOT: InstrumentSnapshot = {
  pressed: new Set<number>(),
  sustain: false,
  voices: 0,
  maxVoices: 24,
  audio: { phase: 'idle', message: 'Audio starts on the first note' },
  midi: { phase: 'idle', devices: [], message: 'MIDI not connected' },
}

export const useInstrument = (): Instrument | null => useContext(InstrumentContext)

export const useInstrumentSnapshot = (): InstrumentSnapshot => {
  const instrument = useContext(InstrumentContext)
  return useSyncExternalStore(
    (cb) => (instrument ? instrument.subscribe(cb) : () => undefined),
    () => (instrument ? instrument.getSnapshot() : EMPTY_SNAPSHOT),
  )
}

/** all geometry is in instrument units: 1u = 1/1000 of the instrument width */
export const u = (n: number): string => `calc(var(--u) * ${n})`

export const box = (x: number, y: number, w?: number, h?: number, centered = true): CSSProperties => ({
  position: 'absolute',
  left: u(centered && w !== undefined ? x - w / 2 : x),
  top: u(centered && h !== undefined ? y - h / 2 : y),
  width: w !== undefined ? u(w) : undefined,
  height: h !== undefined ? u(h) : undefined,
})
