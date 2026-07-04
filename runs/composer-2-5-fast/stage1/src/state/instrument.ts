import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PianoEngine } from '../audio/engine'
import type { AudioContextFactory, TimingBoundary } from '../audio/boundaries'
import { createPresentationState, type ControlDefinition, type PresentationState } from '../model/hardware'
import { COMPUTER_KEY_MAP } from '../model/keyboard'
import { NoteLifecycle } from '../input/note-lifecycle'
import { attachMidiHandlers, createMockMidiPort, type MidiInputPort } from '../input/midi'

export interface InstrumentOptions {
  audioContextFactory?: AudioContextFactory
  timing?: TimingBoundary
  midiPort?: MidiInputPort
}

export interface InstrumentState {
  presentation: PresentationState
  pressedKeys: Set<number>
  sustain: boolean
  pianoStatus: ReturnType<PianoEngine['getStatus']>
  activeVoiceCount: number
}

export function useInstrument(options: InstrumentOptions = {}) {
  const engineRef = useRef<PianoEngine | null>(null)
  const lifecycleRef = useRef<NoteLifecycle | null>(null)
  const midiPort = options.midiPort ?? createMockMidiPort('connected')

  if (!engineRef.current) {
    engineRef.current = new PianoEngine({
      audioContextFactory: options.audioContextFactory,
      timing: options.timing,
    })
    lifecycleRef.current = new NoteLifecycle(engineRef.current, {
      onKeyDown: () => syncPressed(),
      onKeyUp: () => syncPressed(),
    })
  }

  const [presentation, setPresentation] = useState(createPresentationState)
  const [pressedKeys, setPressedKeys] = useState<Set<number>>(() => new Set())
  const [sustain, setSustain] = useState(false)
  const [pianoStatus, setPianoStatus] = useState(engineRef.current.getStatus())
  const [activeVoiceCount, setActiveVoiceCount] = useState(0)

  const syncPressed = useCallback(() => {
    const lc = lifecycleRef.current
    if (!lc) return
    setPressedKeys(new Set(lc.getPressedKeys()))
    setActiveVoiceCount(engineRef.current?.getActiveVoiceCount() ?? 0)
    setPianoStatus(engineRef.current?.getStatus() ?? 'loading')
  }, [])

  const setControlValue = useCallback((id: string, value: number | boolean | string) => {
    setPresentation((prev) => ({ ...prev, [id]: value }))
  }, [])

  const interactControl = useCallback((control: ControlDefinition, value: number | boolean | string) => {
    setControlValue(control.id, value)
  }, [setControlValue])

  const keyPointerDown = useCallback((midi: number, velocity?: number) => {
    void engineRef.current?.ensureStarted()
    lifecycleRef.current?.pointerDown(midi, velocity)
    syncPressed()
  }, [syncPressed])

  const keyPointerUp = useCallback((midi: number) => {
    lifecycleRef.current?.pointerUp(midi)
    syncPressed()
  }, [syncPressed])

  const toggleSustain = useCallback((on: boolean) => {
    lifecycleRef.current?.setSustain(on)
    setSustain(on)
    syncPressed()
  }, [syncPressed])

  useEffect(() => {
    const detach = attachMidiHandlers(midiPort, {
      onNoteOn: (note, velocity) => keyPointerDown(note, velocity),
      onNoteOff: (note) => keyPointerUp(note),
      onSustain: toggleSustain,
    })
    return detach
  }, [midiPort, keyPointerDown, keyPointerUp, toggleSustain])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return
      const midi = COMPUTER_KEY_MAP[e.key.toLowerCase()]
      if (midi == null) return
      if (e.code === 'Space') {
        e.preventDefault()
        toggleSustain(true)
        return
      }
      e.preventDefault()
      lifecycleRef.current?.computerKeyDown(e.code, midi)
      syncPressed()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const midi = COMPUTER_KEY_MAP[e.key.toLowerCase()]
      if (e.code === 'Space') {
        e.preventDefault()
        toggleSustain(false)
        return
      }
      if (midi == null) return
      lifecycleRef.current?.computerKeyUp(e.code, midi)
      syncPressed()
    }
    const onBlur = () => {
      lifecycleRef.current?.blurCleanup()
      setSustain(false)
      syncPressed()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [syncPressed, toggleSustain])

  useEffect(() => () => lifecycleRef.current?.dispose(), [])

  return useMemo(() => ({
    presentation,
    pressedKeys,
    sustain,
    pianoStatus,
    activeVoiceCount,
    setControlValue,
    interactControl,
    keyPointerDown,
    keyPointerUp,
    toggleSustain,
    engine: engineRef.current!,
    lifecycle: lifecycleRef.current!,
    midiPort,
  }), [
    presentation,
    pressedKeys,
    sustain,
    pianoStatus,
    activeVoiceCount,
    setControlValue,
    interactControl,
    keyPointerDown,
    keyPointerUp,
    toggleSustain,
    midiPort,
  ])
}

export type InstrumentApi = ReturnType<typeof useInstrument>
