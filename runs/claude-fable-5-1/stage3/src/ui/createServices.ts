import { PianoEngine, type PianoEngineOptions } from '../audio/engine'
import type { Boundaries } from '../audio/boundaries'
import { InstrumentController } from '../audio/instrumentController'
import { Performer } from '../audio/performer'
import { SampleLibrary, type SampleFile, type SampleManifest } from '../audio/sampleLibrary'
import { STAGE_4_73 } from '../hardware/keybed'
import { attachComputerKeyboard, DEFAULT_BASE_MIDI, type ComputerKeyboard } from '../input/computerKeyboard'
import { MidiController } from '../input/midi'
import { NoteBus } from '../input/noteBus'
import { loadBank, saveBank } from '../state/bankStorage'
import { createFactoryBank } from '../state/factoryPrograms'
import { createHardwareStore } from '../state/hardwareStore'
import { createInstrumentStore } from '../state/instrumentState'
import { createStore, type Store } from '../state/store'
import type { InstrumentServices } from './context'

export interface ServiceOptions {
  /** Restricts which sample files a set loads (tests keep decoding fast); production loads everything. */
  sampleFilter?: (file: SampleFile, manifest: SampleManifest) => boolean
  libraryConcurrency?: number
}

export interface Services extends InstrumentServices {
  boundaries: Boundaries
  keyboardBase: Store<number>
  /** Attaches window listeners (computer keyboard), the panel controller, and requests MIDI. Returns a teardown. */
  activate(options?: { midi?: boolean }): () => void
  keyboardRef: { current: ComputerKeyboard | null }
}

export function createServices(boundaries: Boundaries, engineOptions: Partial<PianoEngineOptions> = {}, options: ServiceOptions = {}): Services {
  const hardware = createHardwareStore()
  const library = boundaries.assets ? new SampleLibrary({ assets: boundaries.assets, filter: options.sampleFilter, concurrency: options.libraryConcurrency }) : null
  const engine = new PianoEngine({ createContext: boundaries.createAudioContext, timers: boundaries.timers, library, createProcessor: boundaries.createProcessor, ...engineOptions })
  // The bank: factory content, or the persisted Live / stored programs when the storage boundary has them.
  const factory = createFactoryBank(library !== null)
  const restored = loadBank(boundaries.storage, factory)
  const state = createInstrumentStore(library !== null, restored ? { bank: restored } : {})
  const bus = new NoteBus(engine, { lowest: STAGE_4_73.lowestMidi, highest: STAGE_4_73.highestMidi })
  const controller = new InstrumentController({
    hardware,
    state,
    engine,
    timers: boundaries.timers,
    panic: () => bus.releaseAll(),
    saveBank: (bank) => {
      saveBank(boundaries.storage, bank)
    },
  })
  const performer = new Performer(engine, state, { onKey: (midi) => controller.onKey(midi) })
  bus.setSink(performer)
  const midi = new MidiController(boundaries.midi, bus, { onControlPedal: (value) => controller.setControlPedal(value) })
  const keyboardBase = createStore<number>(DEFAULT_BASE_MIDI)
  const keyboardRef: { current: ComputerKeyboard | null } = { current: null }
  const services: Services = {
    hardware,
    engine,
    bus,
    midi,
    keyboard: null,
    state,
    controller,
    performer,
    library,
    boundaries,
    keyboardBase,
    keyboardRef,
    activate(options = {}) {
      const detachController = controller.attach()
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
        detachController()
        engine.destroy()
      }
    },
  }
  return services
}
