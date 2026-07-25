import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GraphContext, Scheduler } from '../audio/graph'
import {
  createBrowserAudioContext,
  describeStatus,
  type AudioContextFactory,
  type AudioStatusReport,
} from '../audio/host'
import { PianoEngine, noteId, type NoteSource, type SampleReport } from '../audio/pianoEngine'
import { SampleLibrary, browserSampleFetcher, type SampleFetcher } from '../audio/sampleLibrary'
import { DEFAULT_SETTINGS, type EngineSettings } from '../audio/settings'
import {
  MIDI_MESSAGES,
  browserRequestMidiAccess,
  inputNamesOf,
  midiVelocityToUnit,
  parseMidiMessage,
  type MidiAccessLike,
  type MidiInputLike,
  type MidiStatus,
  type RequestMidiAccess,
} from '../input/midi'
import {
  DEFAULT_BASE_MIDI,
  OCTAVE_DOWN_KEY,
  OCTAVE_UP_KEY,
  SUSTAIN_KEY,
  clampBaseMidi,
  isTextEntryTarget,
  midiForKeyCode,
  shouldHandleSustainKey,
} from '../input/keymap'

export interface InstrumentOptions {
  /** Audio boundary. Tests pass the offline renderer factory. */
  readonly createContext?: AudioContextFactory
  /**
   * Asset boundary for the recorded sample sets. `null` means "no sample assets here", which
   * puts the engine into its labelled synthesised fallback instead of pretending to load.
   */
  readonly sampleFetcher?: SampleFetcher | null
  readonly sampleBaseUrl?: string
  /** Canonical engine settings derived from the panel. */
  readonly settings?: EngineSettings
  /** Timer boundary for voice reaping. */
  readonly scheduler?: Scheduler
  /** MIDI boundary. `null` means "this browser has no Web MIDI". */
  readonly requestMidiAccess?: RequestMidiAccess | null
  /** Start the audio context immediately instead of waiting for a user gesture. */
  readonly autoStart?: boolean
  readonly maxVoices?: number
}

export interface InstrumentApi {
  readonly audio: AudioStatusReport
  readonly samples: SampleReport
  readonly midi: MidiStatus
  /** MIDI note numbers currently held down, from every input source. */
  readonly heldNotes: ReadonlySet<number>
  readonly sustain: boolean
  readonly baseMidi: number
  readonly engine: PianoEngine | null
  startAudio(): void
  noteOn(source: NoteSource, key: string | number, midi: number, velocity?: number): void
  noteOff(source: NoteSource, key: string | number): void
  setSustain(down: boolean): void
  allNotesOff(): void
  shiftOctave(direction: -1 | 1): void
}

export function useInstrument(options: InstrumentOptions = {}): InstrumentApi {
  const { createContext, scheduler, autoStart = false, maxVoices } = options
  const settings = options.settings ?? DEFAULT_SETTINGS

  const [audio, setAudio] = useState<AudioStatusReport>(() => describeStatus('idle'))
  const [midiStatus, setMidiStatus] = useState<MidiStatus>(() => ({
    permission: 'requesting',
    inputNames: [],
    message: MIDI_MESSAGES.requesting,
  }))
  const [heldNotes, setHeldNotes] = useState<ReadonlySet<number>>(() => new Set())
  const [sustain, setSustainState] = useState(false)
  const [baseMidi, setBaseMidi] = useState(DEFAULT_BASE_MIDI)
  const [engine, setEngine] = useState<PianoEngine | null>(null)
  const [samples, setSamples] = useState<SampleReport>(() => ({
    sets: { grand: 'idle', upright: 'idle', electric: 'idle' },
    fallbackActive: false,
    message: 'Audio has not started yet.',
  }))

  const engineRef = useRef<PianoEngine | null>(null)
  const contextRef = useRef<GraphContext | null>(null)
  const heldRef = useRef(new Map<string, number>())
  const startedRef = useRef(false)
  const mountedRef = useRef(true)

  // Boundaries are held in refs so that passing them inline does not re-create callbacks or
  // re-run the input effects on every render.
  const boundaryRef = useRef({
    factory: createContext ?? createBrowserAudioContext,
    scheduler,
    maxVoices,
    fetcher: options.sampleFetcher === undefined ? browserSampleFetcher : options.sampleFetcher,
    baseUrl: options.sampleBaseUrl ?? 'samples/',
    settings,
  })
  boundaryRef.current = {
    factory: createContext ?? createBrowserAudioContext,
    scheduler,
    maxVoices,
    fetcher: options.sampleFetcher === undefined ? browserSampleFetcher : options.sampleFetcher,
    baseUrl: options.sampleBaseUrl ?? 'samples/',
    settings,
  }

  const syncHeld = useCallback(() => {
    setHeldNotes(new Set(heldRef.current.values()))
  }, [])

  const startAudio = useCallback(() => {
    if (startedRef.current) return
    startedRef.current = true
    const { factory, scheduler: timers, maxVoices: voiceLimit } = boundaryRef.current
    let context: GraphContext | null = null
    try {
      context = factory()
    } catch (error) {
      setAudio(describeStatus('error', errorText(error)))
      return
    }
    if (!context) {
      setAudio(describeStatus('unsupported'))
      return
    }
    contextRef.current = context
    try {
      const { fetcher, baseUrl, settings: initial } = boundaryRef.current
      const library = fetcher ? new SampleLibrary(context, fetcher, baseUrl) : null
      const created = new PianoEngine(context, {
        scheduler: timers,
        maxVoices: voiceLimit,
        library,
        settings: initial,
      })
      created.onSampleReport = (report) => {
        if (mountedRef.current) setSamples(report)
      }
      setSamples(created.sampleReport())
      engineRef.current = created
      setEngine(created)
    } catch (error) {
      setAudio(describeStatus('error', errorText(error)))
      return
    }
    setAudio(describeStatus('starting'))
    void Promise.resolve(context.resume()).then(
      () => {
        if (mountedRef.current) setAudio(describeStatus('ready'))
      },
      (error: unknown) => {
        if (mountedRef.current) setAudio(describeStatus('error', errorText(error)))
      },
    )
  }, [])

  const noteOn = useCallback(
    (source: NoteSource, key: string | number, midi: number, velocity = 0.8) => {
      startAudio()
      const id = noteId(source, key)
      heldRef.current.set(id, midi)
      syncHeld()
      engineRef.current?.noteOn(id, midi, velocity)
    },
    [startAudio, syncHeld],
  )

  const noteOff = useCallback(
    (source: NoteSource, key: string | number) => {
      const id = noteId(source, key)
      if (!heldRef.current.delete(id)) return
      syncHeld()
      engineRef.current?.noteOff(id)
    },
    [syncHeld],
  )

  const setSustain = useCallback((down: boolean) => {
    setSustainState(down)
    engineRef.current?.setSustain(down)
  }, [])

  const allNotesOff = useCallback(() => {
    heldRef.current.clear()
    syncHeld()
    engineRef.current?.allNotesOff()
  }, [syncHeld])

  const shiftOctave = useCallback((direction: -1 | 1) => {
    setBaseMidi((current) => clampBaseMidi(current + direction * 12))
  }, [])

  /* -------------------------------------------------- computer keyboard */

  const pressedCodes = useRef(new Set<string>())
  const baseMidiRef = useRef(baseMidi)
  baseMidiRef.current = baseMidi

  useEffect(() => {
    if (typeof window === 'undefined') return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return // repeat suppression
      if (isTextEntryTarget(event.target)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.code === SUSTAIN_KEY) {
        if (!shouldHandleSustainKey(document.activeElement)) return
        event.preventDefault()
        setSustain(true)
        return
      }
      if (event.code === OCTAVE_DOWN_KEY) {
        shiftOctave(-1)
        return
      }
      if (event.code === OCTAVE_UP_KEY) {
        shiftOctave(1)
        return
      }
      const midi = midiForKeyCode(event.code, baseMidiRef.current)
      if (midi === null) return
      if (pressedCodes.current.has(event.code)) return // belt and braces against key repeat
      pressedCodes.current.add(event.code)
      event.preventDefault()
      noteOn('keyboard', event.code, midi, 0.75)
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === SUSTAIN_KEY) {
        setSustain(false)
        return
      }
      if (!pressedCodes.current.delete(event.code)) return
      noteOff('keyboard', event.code)
    }

    const onBlur = () => {
      pressedCodes.current.clear()
      allNotesOff()
      setSustain(false)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [allNotesOff, noteOff, noteOn, setSustain, shiftOctave])

  /* -------------------------------------------------- Web MIDI */

  const requestMidiAccess = useMemo(() => {
    if (options.requestMidiAccess !== undefined) return options.requestMidiAccess
    return browserRequestMidiAccess()
  }, [options.requestMidiAccess])

  useEffect(() => {
    if (!requestMidiAccess) {
      setMidiStatus({ permission: 'unsupported', inputNames: [], message: MIDI_MESSAGES.unsupported })
      return
    }
    let cancelled = false
    let access: MidiAccessLike | null = null
    const attached: MidiInputLike[] = []

    setMidiStatus({ permission: 'requesting', inputNames: [], message: MIDI_MESSAGES.requesting })

    const attach = (granted: MidiAccessLike) => {
      for (const input of granted.inputs.values()) {
        input.onmidimessage = (event) => {
          const parsed = parseMidiMessage(event.data)
          if (!parsed) return
          if (parsed.type === 'noteOn') {
            noteOn('midi', `${input.id}#${parsed.note}`, parsed.note, midiVelocityToUnit(parsed.velocity))
          } else if (parsed.type === 'noteOff') {
            noteOff('midi', `${input.id}#${parsed.note}`)
          } else if (parsed.type === 'sustain') {
            setSustain(parsed.down)
          } else {
            allNotesOff()
          }
        }
        attached.push(input)
      }
      setMidiStatus({
        permission: 'granted',
        inputNames: inputNamesOf(granted),
        message: MIDI_MESSAGES.granted,
      })
    }

    void requestMidiAccess().then(
      (granted) => {
        if (cancelled) return
        access = granted
        attach(granted)
        granted.onstatechange = () => {
          // A device appearing or vanishing invalidates any note it was holding.
          allNotesOff()
          if (!cancelled) attach(granted)
        }
      },
      (error: unknown) => {
        if (cancelled) return
        setMidiStatus({
          permission: 'denied',
          inputNames: [],
          message: `${MIDI_MESSAGES.denied}${errorText(error) ? ` (${errorText(error)})` : ''}`,
        })
      },
    )

    return () => {
      cancelled = true
      for (const input of attached) input.onmidimessage = null
      if (access) access.onstatechange = null
      allNotesOff()
    }
  }, [allNotesOff, noteOff, noteOn, requestMidiAccess, setSustain])

  /* -------------------------------------------------- lifecycle */

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      heldRef.current.clear()
      engineRef.current?.dispose()
      engineRef.current = null
      const context = contextRef.current
      contextRef.current = null
      startedRef.current = false
      if (context) void Promise.resolve(context.close()).catch(() => undefined)
    }
  }, [])

  useEffect(() => {
    if (autoStart) startAudio()
  }, [autoStart, startAudio])

  // Panel -> engine: every derived settings object is applied to the live graph.
  useEffect(() => {
    engineRef.current?.applySettings(settings)
  }, [settings, engine])

  return {
    audio,
    samples,
    midi: midiStatus,
    heldNotes,
    sustain,
    baseMidi,
    engine,
    startAudio,
    noteOn,
    noteOff,
    setSustain,
    allNotesOff,
    shiftOctave,
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return ''
}
