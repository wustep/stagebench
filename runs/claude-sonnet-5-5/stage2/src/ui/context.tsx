import { createContext, useContext, useSyncExternalStore, type CSSProperties } from 'react'
import type { Instrument, InstrumentSnapshot } from '../audio/instrument'
import { defaultState, type EngineState, type EngineStore } from '../engine/state'
import type { ControlState, HardwareStore } from '../hardware/store'

export const HardwareContext = createContext<HardwareStore | null>(null)
export const InstrumentContext = createContext<Instrument | null>(null)
export const EngineContext = createContext<EngineStore | null>(null)

const DEFAULT_ENGINE_STATE = defaultState()

/** the canonical piano + effects state (what the OLED shows) */
export const useEngineState = (): EngineState => {
  const engine = useContext(EngineContext)
  return useSyncExternalStore(
    (cb) => (engine ? engine.subscribe(cb) : () => undefined),
    () => (engine ? engine.get() : DEFAULT_ENGINE_STATE),
  )
}

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

/** lit state of an LED that is not a button (FX focus, rotary on); indicators without an id are static prints */
export const useIndicator = (id: string | undefined): boolean => {
  const store = useHardware()
  return useSyncExternalStore(
    (cb) => (id ? store.subscribeIndicator(id, cb) : () => undefined),
    () => (id ? store.getIndicator(id) : false),
  )
}

const EMPTY_SNAPSHOT: InstrumentSnapshot = {
  pressed: new Set<number>(),
  sustain: false,
  voices: 0,
  maxVoices: 24,
  audio: { phase: 'idle', message: 'Audio starts on the first note' },
  midi: { phase: 'idle', devices: [], message: 'MIDI not connected' },
  models: {
    A: { phase: 'idle', name: 'Grand', loaded: 0, total: 0 },
    B: { phase: 'idle', name: 'Electric', loaded: 0, total: 0 },
  },
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
