import type { MutableRefObject, ReactNode } from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { PianoEngine } from '../audio/piano-engine'
import type { AudioContextFactory, AudioStatus } from '../audio/types'
import { COMPUTER_KEY_MAP, COMPUTER_KEY_VELOCITY, SUSTAIN_KEY } from '../input/keymap'
import {
  MidiController,
  type MidiAccessFactory,
  type MidiConnectionState,
} from '../input/midi'
import { CONTROL_BY_ID, defaultHardwareValues } from '../model/controls'
import { VARIANT } from '../model/variant'

export interface InstrumentDeps {
  createAudioContext?: AudioContextFactory
  requestMIDIAccess?: MidiAccessFactory | null
  autoMidi?: boolean
}

interface InstrumentApi {
  values: Record<string, number>
  setControl: (id: string, value: number) => void
  pressed: Set<number>
  sustain: boolean
  setSustain: (down: boolean) => void
  noteOn: (note: number, velocity: number) => void
  noteOff: (note: number) => void
  allNotesOff: () => void
  audioStatus: AudioStatus
  audioDetail: string
  midiState: MidiConnectionState
  engine: PianoEngine
  ensureAudio: () => Promise<void>
}

const InstrumentContext = createContext<InstrumentApi | null>(null)
const PointerMapContext = createContext<MutableRefObject<Map<number, number>> | null>(null)

export function useInstrument(): InstrumentApi {
  const ctx = useContext(InstrumentContext)
  if (!ctx) throw new Error('useInstrument requires InstrumentProvider')
  return ctx
}

export function usePointerMap() {
  const ref = useContext(PointerMapContext)
  if (!ref) throw new Error('pointer map missing')
  return ref
}

export function InstrumentProvider({
  deps,
  children,
}: {
  deps?: InstrumentDeps
  children: ReactNode
}) {
  const engineRef = useRef<PianoEngine>(
    new PianoEngine({ createAudioContext: deps?.createAudioContext }),
  )
  const [values, setValues] = useState<Record<string, number>>(defaultHardwareValues)
  const [pressed, setPressed] = useState<Set<number>>(() => new Set())
  const [sustain, setSustainState] = useState(false)
  const [audioStatus, setAudioStatus] = useState<AudioStatus>('loading')
  const [audioDetail, setAudioDetail] = useState('Initializing audio')
  const [midiState, setMidiState] = useState<MidiConnectionState>('idle')
  const pointers = useRef(new Map<number, number>())
  const computerHeld = useRef(new Set<string>())

  const ensureAudio = useCallback(async () => {
    const engine = engineRef.current
    await engine.init()
    setAudioStatus(engine.getStatus())
    setAudioDetail(engine.getStatusDetail())
  }, [])

  const noteOn = useCallback(
    (note: number, velocity: number) => {
      if (note < VARIANT.midiMin || note > VARIANT.midiMax) return
      void ensureAudio()
      engineRef.current.noteOn(note, velocity)
      setPressed((prev) => {
        const next = new Set(prev)
        next.add(note)
        return next
      })
    },
    [ensureAudio],
  )

  const noteOff = useCallback((note: number) => {
    engineRef.current.noteOff(note)
    setPressed((prev) => {
      if (!prev.has(note)) return prev
      const next = new Set(prev)
      next.delete(note)
      return next
    })
  }, [])

  const allNotesOff = useCallback(() => {
    engineRef.current.allNotesOff()
    pointers.current.clear()
    computerHeld.current.clear()
    setPressed(new Set())
    setSustainState(false)
  }, [])

  const setSustain = useCallback(
    (down: boolean) => {
      void ensureAudio()
      engineRef.current.setSustain(down)
      setSustainState(down)
    },
    [ensureAudio],
  )

  const setControl = useCallback((id: string, value: number) => {
    const def = CONTROL_BY_ID[id]
    if (!def || def.kind === 'oled') return
    setValues((prev) => ({ ...prev, [id]: value }))
  }, [])

  useEffect(() => {
    const engine = new PianoEngine({ createAudioContext: deps?.createAudioContext })
    engineRef.current = engine
    void engine.init().then(() => {
      setAudioStatus(engine.getStatus())
      setAudioDetail(engine.getStatusDetail())
    })
    return () => {
      engine.allNotesOff()
      engine.dispose()
    }
  }, [deps?.createAudioContext])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (event.code === SUSTAIN_KEY) {
        event.preventDefault()
        setSustain(true)
        return
      }
      const note = COMPUTER_KEY_MAP[event.code]
      if (note == null) return
      if (computerHeld.current.has(event.code)) return
      computerHeld.current.add(event.code)
      event.preventDefault()
      noteOn(note, COMPUTER_KEY_VELOCITY)
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.code === SUSTAIN_KEY) {
        setSustain(false)
        return
      }
      const note = COMPUTER_KEY_MAP[event.code]
      if (note == null) return
      computerHeld.current.delete(event.code)
      noteOff(note)
    }
    function onBlur() {
      allNotesOff()
      engineRef.current.setSustain(false)
    }
    function onVisibility() {
      if (document.hidden) onBlur()
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    window.addEventListener('pagehide', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('pagehide', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [allNotesOff, noteOff, noteOn, setSustain])

  const midiHandlers = useRef({ noteOn, noteOff, setSustain, allNotesOff })
  midiHandlers.current = { noteOn, noteOff, setSustain, allNotesOff }

  useEffect(() => {
    if (deps?.autoMidi === false) return
    const midi = new MidiController(
      {
        noteOn: (note, velocity) => midiHandlers.current.noteOn(note, velocity),
        noteOff: (note) => midiHandlers.current.noteOff(note),
        sustain: (down) => midiHandlers.current.setSustain(down),
        onState: (state) => {
          setMidiState(state)
          if (state === 'denied' || state === 'disconnected' || state === 'unavailable') {
            midiHandlers.current.allNotesOff()
          }
        },
      },
      deps?.requestMIDIAccess,
    )
    void midi.connect()
    return () => midi.dispose()
  }, [deps?.autoMidi, deps?.requestMIDIAccess])

  const api = useMemo<InstrumentApi>(
    () => ({
      values,
      setControl,
      pressed,
      sustain,
      setSustain,
      noteOn,
      noteOff,
      allNotesOff,
      audioStatus,
      audioDetail,
      midiState,
      engine: engineRef.current,
      ensureAudio,
    }),
    [
      allNotesOff,
      audioDetail,
      audioStatus,
      ensureAudio,
      midiState,
      noteOff,
      noteOn,
      pressed,
      setControl,
      setSustain,
      sustain,
      values,
    ],
  )

  return (
    <InstrumentContext.Provider value={api}>
      <PointerMapContext.Provider value={pointers}>{children}</PointerMapContext.Provider>
    </InstrumentContext.Provider>
  )
}

