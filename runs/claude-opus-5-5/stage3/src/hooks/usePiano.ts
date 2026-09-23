import { useCallback, useEffect, useRef, useState } from 'react'
import type { EngineSnapshot } from '../audio/noteEngine'
import { LayeredEngine, type LayeredSnapshot, type PlayEngine } from '../audio/layeredEngine'
import { PianoLibrary, type SourceInfo } from '../audio/library'
import { StageAudio, type StageStatus } from '../audio/stageAudio'
import { synthLayerParams } from '../audio/synthParams'
import { attachComputerKeyboard, DEFAULT_BASE_NOTE } from '../input/computerKeyboard'
import { connectMidi, type MidiConnection, type MidiStatus } from '../input/midi'
import { HIGHEST_NOTE, LOWEST_NOTE } from '../model/keys'
import type { HardwareStore } from '../model/hardwareStore'
import { MemoryStorage, ProgramBank } from '../model/programs'
import { currentModel, defaultSound, SLOTS, type SoundState } from '../model/sound'
import { StageController, type ControllerView } from '../system/controller'
import type { Runtime } from '../runtime'

interface Session {
  midi: MidiConnection | null
  alive: boolean
}

export const EMPTY_SNAPSHOT: LayeredSnapshot = {
  held: [],
  sounding: [],
  sustain: false,
  voices: [],
  steals: 0,
  perLayer: { A: 0, B: 0 },
  perSlot: { organA: 0, organB: 0, A: 0, B: 0, synthA: 0, synthB: 0, synthC: 0 },
}

export interface PianoApi {
  status: StageStatus
  snapshot: LayeredSnapshot
  midi: MidiStatus
  baseNote: number
  sound: SoundState
  sources: SourceInfo[]
  /** Program system view (location, dirty, modes, OLED content). */
  view: ControllerView | null
  /** Stable getter for the live engine (null before mount / after unmount). */
  engine: () => PlayEngine | null
  /** Stable getter for the audio engine (tests and diagnostics). */
  stage: () => StageAudio | null
  /** Stable getter for the controller (tests and diagnostics). */
  controller: () => StageController | null
  noteOn: (note: number, velocity: number, source: string) => void
  noteOff: (note: number, source: string) => void
  setSustain: (down: boolean, source: string) => void
  releaseSources: (prefix: string) => void
  allNotesOff: () => void
  enableMidi: () => void
  /** Virtual Control Pedal (0…127), also driven by MIDI CC11. */
  setPedal: (value: number) => void
  /** Store As naming from the accessible text field. */
  setProgramName: (name: string) => void
  panic: () => void
}

function initialStatus(runtime: Runtime): StageStatus {
  return runtime.createAudioContext
    ? { voice: 'loading', audio: 'not-started', progress: 0, detail: 'Loading piano library…', fallbackModels: [] }
    : { voice: 'error', audio: 'unavailable', progress: 0, detail: 'Web Audio is not available in this browser — the keybed cannot make sound.', fallbackModels: [] }
}

const sameStatus = (a: StageStatus, b: StageStatus) =>
  a.voice === b.voice && a.audio === b.audio && a.progress === b.progress && a.detail === b.detail && a.fallbackModels.join() === b.fallbackModels.join()

/** The arpeggiator clock period (ms). */
const TICK_MS = 5

/**
 * The instrument session: piano library + one-context audio engine + seven-layer note routing +
 * the program controller, bound to the panel store so every functional control drives canonical
 * state, and every input (pointer, keys, MIDI) shares one note lifecycle.
 */
export function usePiano(runtime: Runtime, store: HardwareStore, onPanic?: () => void): PianoApi {
  const [status, setStatus] = useState<StageStatus>(() => initialStatus(runtime))
  const [snapshot, setSnapshot] = useState<LayeredSnapshot>(EMPTY_SNAPSHOT)
  const [midi, setMidi] = useState<MidiStatus>(() => (runtime.requestMIDIAccess ? { state: 'idle' } : { state: 'unsupported' }))
  const [baseNote, setBaseNote] = useState(DEFAULT_BASE_NOTE)
  const [sound, setSoundState] = useState<SoundState>(defaultSound)
  const [view, setView] = useState<ControllerView | null>(null)
  const [sources, setSources] = useState<SourceInfo[]>([])
  const engineRef = useRef<LayeredEngine | null>(null)
  const stageRef = useRef<StageAudio | null>(null)
  const controllerRef = useRef<StageController | null>(null)
  const sessionRef = useRef<Session | null>(null)
  const panicRef = useRef(onPanic)
  panicRef.current = onPanic

  useEffect(() => {
    const session: Session = { midi: null, alive: true }
    sessionRef.current = session
    const library = new PianoLibrary({
      fetchAsset: runtime.fetchAsset,
      toneOptions: runtime.toneOptions,
      lowNote: LOWEST_NOTE,
      highNote: HIGHEST_NOTE,
      yieldToEventLoop: runtime.yieldToEventLoop,
      maxZoneSeconds: runtime.audioTuning?.maxZoneSeconds,
    })
    const stage = new StageAudio({ createContext: runtime.createAudioContext, library, irScale: runtime.audioTuning?.irScale })
    const audioTime = () => stage.context?.currentTime ?? 0
    let controller: StageController | null = null
    const factories = Object.fromEntries(SLOTS.map((slot) => [slot, stage.voices(slot)]))
    const initial = defaultSound()
    const engine = new LayeredEngine(factories, initial, (layer, down) => stage.setLayerSustain(layer, down), {
      synthParams: (slot, s) => synthLayerParams(slot, s, controller?.gridOrigin ?? 0),
      now: audioTime,
      onGate: (slot, t, step) => stage.gateStep(slot, t, step),
    })
    stageRef.current = stage
    engineRef.current = engine
    let lastStatus = stage.status
    setStatus(lastStatus)
    setSnapshot(engine.snapshot())

    const bank = new ProgramBank(runtime.storage === undefined ? new MemoryStorage() : runtime.storage)
    controller = new StageController({
      store,
      stage,
      engine,
      bank,
      initial,
      nowMs: runtime.now,
      audioTime,
      onPanic: () => panicRef.current?.(),
      pianoFailed: (layer, s) => library.modelStatus(currentModel(s.piano.layers[layer])) === 'failed',
    })
    controllerRef.current = controller
    const ctl = controller
    const unsubController = ctl.subscribe(() => {
      if (!session.alive) return
      setSoundState(ctl.sound)
      setView(ctl.snapshot())
    })
    store.attach(ctl.binding)
    ctl.commit(ctl.sound, 'load')
    const stopTimer = runtime.every?.(TICK_MS, () => ctl.tick()) ?? (() => undefined)
    runtime.inspect?.({ controller: ctl, stage, engine })

    const unsubStage = stage.subscribe(() => {
      if (!session.alive) return
      const next = stage.status
      if (!sameStatus(next, lastStatus)) {
        lastStatus = next
        setStatus(next)
        ctl.refresh()
      }
      setSources(library.sources())
    })
    const unsubEngine = engine.subscribe(() => {
      if (session.alive) setSnapshot(engine.snapshot())
    })
    void library.load()

    const keyboard = attachComputerKeyboard({
      engine: () => engineRef.current,
      target: runtime.keyboardTarget,
      visibility: runtime.visibility,
      onBaseChange: setBaseNote,
      onUserGesture: () => stage.unlock(),
    })
    // Leaving the page (window blur / hidden tab) stops every voice this app owns.
    const onBlur = () => engine.allNotesOff()
    const onVisibility = () => {
      if (runtime.visibility.visibilityState === 'hidden') engine.allNotesOff()
    }
    runtime.keyboardTarget.addEventListener('blur', onBlur)
    runtime.visibility.addEventListener('visibilitychange', onVisibility)

    return () => {
      session.alive = false
      runtime.inspect?.(null)
      stopTimer()
      store.attach(null)
      unsubController()
      keyboard.detach()
      runtime.keyboardTarget.removeEventListener('blur', onBlur)
      runtime.visibility.removeEventListener('visibilitychange', onVisibility)
      session.midi?.detach()
      session.midi = null
      if (sessionRef.current === session) sessionRef.current = null
      unsubStage()
      unsubEngine()
      engine.dispose()
      stage.dispose()
      library.dispose()
      engineRef.current = null
      stageRef.current = null
      controllerRef.current = null
    }
  }, [runtime, store])

  const engine = useCallback(() => engineRef.current, [])
  const stage = useCallback(() => stageRef.current, [])
  const controller = useCallback(() => controllerRef.current, [])
  const noteOn = useCallback((note: number, velocity: number, source: string) => engineRef.current?.noteOn(note, velocity, source), [])
  const noteOff = useCallback((note: number, source: string) => engineRef.current?.noteOff(note, source), [])
  const setSustain = useCallback((down: boolean, source: string) => {
    if (down) stageRef.current?.unlock()
    engineRef.current?.setSustain(down, source)
  }, [])
  const releaseSources = useCallback((prefix: string) => engineRef.current?.releaseSources(prefix), [])
  const allNotesOff = useCallback(() => engineRef.current?.allNotesOff(), [])
  const setPedal = useCallback((value: number) => controllerRef.current?.setPedal(value), [])
  const setProgramName = useCallback((name: string) => controllerRef.current?.setPendingName(name), [])
  const panic = useCallback(() => controllerRef.current?.panic(), [])

  const enableMidi = useCallback(() => {
    const session = sessionRef.current
    if (!session || session.midi) return
    stageRef.current?.unlock()
    void connectMidi(
      runtime.requestMIDIAccess,
      () => engineRef.current,
      (s) => {
        if (session.alive) setMidi(s)
      },
      () => stageRef.current?.unlock(),
      (cc, value) => {
        // CC1 = modulation wheel, CC11 = Control Pedal (programs spec morph.controlPedalInput).
        if (cc === 1) {
          store.dispatch({ type: 'set', id: 'performance-mod-wheel', value })
        } else if (cc === 11) controllerRef.current?.setPedal(value)
      },
    ).then((connection) => {
      if (!connection) return
      if (!session.alive) connection.detach()
      else session.midi = connection
    })
  }, [runtime, store])

  return { status, snapshot, midi, baseNote, sound, sources, view, engine, stage, controller, noteOn, noteOff, setSustain, releaseSources, allNotesOff, enableMidi, setPedal, setProgramName, panic }
}

export type { EngineSnapshot }
