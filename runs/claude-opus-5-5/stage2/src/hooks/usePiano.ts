import { useCallback, useEffect, useRef, useState } from 'react'
import type { EngineSnapshot } from '../audio/noteEngine'
import { LayeredEngine, type LayeredSnapshot, type PlayEngine } from '../audio/layeredEngine'
import { PianoLibrary, type SourceInfo } from '../audio/library'
import { StageAudio, type StageStatus } from '../audio/stageAudio'
import { TapTempo } from '../audio/fx/delay'
import { attachComputerKeyboard, DEFAULT_BASE_NOTE } from '../input/computerKeyboard'
import { connectMidi, type MidiConnection, type MidiStatus } from '../input/midi'
import { HIGHEST_NOTE, LOWEST_NOTE } from '../model/keys'
import type { ControlBinding, HardwareAction, HardwareStore } from '../model/hardwareStore'
import { activate, FUNCTIONAL, indicators, isFunctional, presentation, setValue, type BindingContext } from '../model/panelBindings'
import { currentModel, defaultSound, type LayerId, type SoundState } from '../model/sound'
import type { Runtime } from '../runtime'

interface Session {
  midi: MidiConnection | null
  alive: boolean
}

export const EMPTY_SNAPSHOT: LayeredSnapshot = { held: [], sounding: [], sustain: false, voices: [], steals: 0, perLayer: { A: 0, B: 0 } }

export interface PianoApi {
  status: StageStatus
  snapshot: LayeredSnapshot
  midi: MidiStatus
  baseNote: number
  sound: SoundState
  sources: SourceInfo[]
  /** Stable getter for the live engine (null before mount / after unmount). */
  engine: () => PlayEngine | null
  /** Stable getter for the audio engine (tests and diagnostics). */
  stage: () => StageAudio | null
  noteOn: (note: number, velocity: number, source: string) => void
  noteOff: (note: number, source: string) => void
  setSustain: (down: boolean, source: string) => void
  releaseSources: (prefix: string) => void
  allNotesOff: () => void
  enableMidi: () => void
}

function initialStatus(runtime: Runtime): StageStatus {
  return runtime.createAudioContext
    ? { voice: 'loading', audio: 'not-started', progress: 0, detail: 'Loading piano library…', fallbackModels: [] }
    : { voice: 'error', audio: 'unavailable', progress: 0, detail: 'Web Audio is not available in this browser — the keybed cannot make sound.', fallbackModels: [] }
}

const sameStatus = (a: StageStatus, b: StageStatus) =>
  a.voice === b.voice && a.audio === b.audio && a.progress === b.progress && a.detail === b.detail && a.fallbackModels.join() === b.fallbackModels.join()

const SHIFTS = ['effects-shift', 'program-shift']

/**
 * The Phase 2 instrument session: piano library + one-context audio engine + two-layer note
 * routing, bound to the panel store so functional controls drive canonical sound state.
 */
export function usePiano(runtime: Runtime, store: HardwareStore): PianoApi {
  const [status, setStatus] = useState<StageStatus>(() => initialStatus(runtime))
  const [snapshot, setSnapshot] = useState<LayeredSnapshot>(EMPTY_SNAPSHOT)
  const [midi, setMidi] = useState<MidiStatus>(() => (runtime.requestMIDIAccess ? { state: 'idle' } : { state: 'unsupported' }))
  const [baseNote, setBaseNote] = useState(DEFAULT_BASE_NOTE)
  const [sound, setSoundState] = useState<SoundState>(defaultSound)
  const [sources, setSources] = useState<SourceInfo[]>([])
  const engineRef = useRef<LayeredEngine | null>(null)
  const stageRef = useRef<StageAudio | null>(null)
  const sessionRef = useRef<Session | null>(null)

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
    let current = defaultSound()
    const engine = new LayeredEngine({ A: stage.voices('A'), B: stage.voices('B') }, current, (layer, down) => stage.setLayerSustain(layer, down))
    stageRef.current = stage
    engineRef.current = engine
    let lastStatus = stage.status
    setStatus(lastStatus)
    setSnapshot(engine.snapshot())

    const failed = (layer: LayerId) => library.modelStatus(currentModel(current.piano.layers[layer])) === 'failed'
    const commit = (next: SoundState) => {
      current = next
      stage.apply(next)
      engine.setSound(next)
      store.sync(presentation(next), indicators(next, failed))
      if (session.alive) setSoundState(next)
    }
    const tap = new TapTempo()
    const ctx = (): BindingContext => ({ shift: SHIFTS.some((id) => store.get(id)?.pressed), nowMs: runtime.now() })
    const binding: ControlBinding = {
      intercept(action: HardwareAction) {
        if (action.type === 'reset' || !isFunctional(action.id)) return false
        if (action.type === 'activate') {
          const next = activate(current, action.id, ctx(), tap)
          if (!next) return false
          if (next !== current) commit(next)
          return true
        }
        if (action.type === 'step' && action.id === 'piano-model') {
          const next = setValue(current, action.id, 0, action.delta, ctx())
          if (next) commit(next)
          return true
        }
        if (action.id === 'effects-comp-amount' && (action.type === 'step' || action.type === 'set') && ctx().shift) {
          const cur = store.get(action.id)?.value ?? 0
          const delta = action.type === 'step' ? action.delta : action.value - cur
          const next = setValue(current, action.id, cur, delta, ctx())
          if (next) commit(next)
          return true
        }
        return false
      },
      observe(id, value, delta) {
        if (!isFunctional(id)) return
        const next = setValue(current, id, value, delta, ctx())
        if (next && next !== current) commit(next)
      },
      describe: (id) => FUNCTIONAL[id],
    }
    store.attach(binding)
    commit(current)

    const unsubStage = stage.subscribe(() => {
      if (!session.alive) return
      const next = stage.status
      if (!sameStatus(next, lastStatus)) {
        lastStatus = next
        setStatus(next)
        store.sync({}, indicators(current, failed))
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
      store.attach(null)
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
    }
  }, [runtime, store])

  const engine = useCallback(() => engineRef.current, [])
  const stage = useCallback(() => stageRef.current, [])
  const noteOn = useCallback((note: number, velocity: number, source: string) => engineRef.current?.noteOn(note, velocity, source), [])
  const noteOff = useCallback((note: number, source: string) => engineRef.current?.noteOff(note, source), [])
  const setSustain = useCallback((down: boolean, source: string) => {
    if (down) stageRef.current?.unlock()
    engineRef.current?.setSustain(down, source)
  }, [])
  const releaseSources = useCallback((prefix: string) => engineRef.current?.releaseSources(prefix), [])
  const allNotesOff = useCallback(() => engineRef.current?.allNotesOff(), [])

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
    ).then((connection) => {
      if (!connection) return
      if (!session.alive) connection.detach()
      else session.midi = connection
    })
  }, [runtime])

  return { status, snapshot, midi, baseNote, sound, sources, engine, stage, noteOn, noteOff, setSustain, releaseSources, allNotesOff, enableMidi }
}

export type { EngineSnapshot }
