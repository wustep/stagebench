import { useCallback, useEffect, useRef, useState } from 'react'
import { NoteEngine, type EngineSnapshot } from '../audio/noteEngine'
import { PianoAudio, type PianoStatus } from '../audio/pianoAudio'
import { attachComputerKeyboard, DEFAULT_BASE_NOTE } from '../input/computerKeyboard'
import { connectMidi, type MidiConnection, type MidiStatus } from '../input/midi'
import { HIGHEST_NOTE, LOWEST_NOTE } from '../model/keys'
import type { Runtime } from '../runtime'

interface Session {
  midi: MidiConnection | null
  alive: boolean
}

export const EMPTY_SNAPSHOT: EngineSnapshot = { held: [], sounding: [], sustain: false, voices: [], steals: 0 }

export interface PianoApi {
  status: PianoStatus
  snapshot: EngineSnapshot
  midi: MidiStatus
  baseNote: number
  /** Stable getter for the live engine (null before mount / after unmount). */
  engine: () => NoteEngine | null
  noteOn: (note: number, velocity: number, source: string) => void
  noteOff: (note: number, source: string) => void
  setSustain: (down: boolean, source: string) => void
  releaseSources: (prefix: string) => void
  allNotesOff: () => void
  enableMidi: () => void
}

function initialStatus(runtime: Runtime): PianoStatus {
  return runtime.createAudioContext
    ? { voice: 'loading', audio: 'not-started', progress: 0, detail: 'Generating piano tones…' }
    : { voice: 'error', audio: 'unavailable', progress: 0, detail: 'Web Audio is not available in this browser — the keybed cannot make sound.' }
}

export function usePiano(runtime: Runtime): PianoApi {
  const [status, setStatus] = useState<PianoStatus>(() => initialStatus(runtime))
  const [snapshot, setSnapshot] = useState<EngineSnapshot>(EMPTY_SNAPSHOT)
  const [midi, setMidi] = useState<MidiStatus>(() => (runtime.requestMIDIAccess ? { state: 'idle' } : { state: 'unsupported' }))
  const [baseNote, setBaseNote] = useState(DEFAULT_BASE_NOTE)
  const engineRef = useRef<NoteEngine | null>(null)
  const audioRef = useRef<PianoAudio | null>(null)
  // Per-mount session so cleanup always detaches the MIDI connection opened by that mount.
  const sessionRef = useRef<Session | null>(null)

  useEffect(() => {
    const session: Session = { midi: null, alive: true }
    sessionRef.current = session
    const audio = new PianoAudio({
      createContext: runtime.createAudioContext,
      lowNote: LOWEST_NOTE,
      highNote: HIGHEST_NOTE,
      toneOptions: runtime.toneOptions,
      yieldToEventLoop: runtime.yieldToEventLoop,
    })
    const engine = new NoteEngine(audio)
    audioRef.current = audio
    engineRef.current = engine
    setStatus(audio.status)
    setSnapshot(engine.snapshot())
    const unsubAudio = audio.subscribe(() => {
      if (session.alive) setStatus(audio.status)
    })
    const unsubEngine = engine.subscribe(() => {
      if (session.alive) setSnapshot(engine.snapshot())
    })
    void audio.load()

    const keyboard = attachComputerKeyboard({
      engine: () => engineRef.current,
      target: runtime.keyboardTarget,
      visibility: runtime.visibility,
      onBaseChange: setBaseNote,
      onUserGesture: () => audio.unlock(),
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
      keyboard.detach()
      runtime.keyboardTarget.removeEventListener('blur', onBlur)
      runtime.visibility.removeEventListener('visibilitychange', onVisibility)
      session.midi?.detach()
      session.midi = null
      if (sessionRef.current === session) sessionRef.current = null
      unsubAudio()
      unsubEngine()
      engine.dispose()
      audio.dispose()
      engineRef.current = null
      audioRef.current = null
    }
  }, [runtime])

  const engine = useCallback(() => engineRef.current, [])
  const noteOn = useCallback((note: number, velocity: number, source: string) => engineRef.current?.noteOn(note, velocity, source), [])
  const noteOff = useCallback((note: number, source: string) => engineRef.current?.noteOff(note, source), [])
  const setSustain = useCallback((down: boolean, source: string) => {
    if (down) audioRef.current?.unlock()
    engineRef.current?.setSustain(down, source)
  }, [])
  const releaseSources = useCallback((prefix: string) => engineRef.current?.releaseSources(prefix), [])
  const allNotesOff = useCallback(() => engineRef.current?.allNotesOff(), [])

  const enableMidi = useCallback(() => {
    const session = sessionRef.current
    if (!session || session.midi) return
    audioRef.current?.unlock()
    void connectMidi(
      runtime.requestMIDIAccess,
      () => engineRef.current,
      (s) => {
        if (session.alive) setMidi(s)
      },
      () => audioRef.current?.unlock(),
    ).then((connection) => {
      if (!connection) return
      if (!session.alive) connection.detach()
      else session.midi = connection
    })
  }, [runtime])

  return { status, snapshot, midi, baseNote, engine, noteOn, noteOff, setSustain, releaseSources, allNotesOff, enableMidi }
}
