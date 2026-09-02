import { PianoEngine, type PianoEngineOptions } from '../audio/engine'
import type { Boundaries } from '../audio/boundaries'
import { STAGE_4_73 } from '../hardware/keybed'
import { attachComputerKeyboard, DEFAULT_BASE_MIDI, type ComputerKeyboard } from '../input/computerKeyboard'
import { MidiController } from '../input/midi'
import { NoteBus } from '../input/noteBus'
import { createHardwareStore } from '../state/hardwareStore'
import { createStore, type Store } from '../state/store'
import type { InstrumentServices } from './context'

export interface Services extends InstrumentServices {
  boundaries: Boundaries
  keyboardBase: Store<number>
  /** Attaches window listeners (computer keyboard) and requests MIDI. Returns a teardown. */
  activate(options?: { midi?: boolean }): () => void
  keyboardRef: { current: ComputerKeyboard | null }
}

export function createServices(boundaries: Boundaries, engineOptions: Partial<PianoEngineOptions> = {}): Services {
  const hardware = createHardwareStore()
  const engine = new PianoEngine({ createContext: boundaries.createAudioContext, timers: boundaries.timers, ...engineOptions })
  const bus = new NoteBus(engine, { lowest: STAGE_4_73.lowestMidi, highest: STAGE_4_73.highestMidi })
  const midi = new MidiController(boundaries.midi, bus)
  const keyboardBase = createStore<number>(DEFAULT_BASE_MIDI)
  const keyboardRef: { current: ComputerKeyboard | null } = { current: null }
  const services: Services = {
    hardware,
    engine,
    bus,
    midi,
    keyboard: null,
    boundaries,
    keyboardBase,
    keyboardRef,
    activate(options = {}) {
      const kb = attachComputerKeyboard(boundaries.windowTarget, bus, {
        baseMidi: keyboardBase.get(),
        lowest: STAGE_4_73.lowestMidi,
        highest: STAGE_4_73.highestMidi,
        onBaseChange: (base) => keyboardBase.set(base),
      })
      keyboardRef.current = kb
      services.keyboard = kb
      if (options.midi !== false) void midi.connect()
      return () => {
        kb.detach()
        keyboardRef.current = null
        services.keyboard = null
        midi.dispose()
        bus.releaseAll()
        engine.dispose()
      }
    },
  }
  return services
}
