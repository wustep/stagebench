import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  browserMidiProvider,
  type MidiProvider,
  type PianoEngineStatusSnapshot,
  type PianoVoiceBackend,
} from './audio/boundaries'
import { MidiController, type MidiStatusSnapshot } from './audio/midiController'
import { NoteLifecycleController, type NoteLifecycleSnapshot } from './audio/noteLifecycle'
import { StageAudioEngine } from './audio/stageAudioEngine'
import { Keybed } from './components/Keybed'
import { EffectsSection } from './components/sections/EffectsSection'
import { OrganSection } from './components/sections/OrganSection'
import { PerformanceSection } from './components/sections/PerformanceSection'
import { PianoSection } from './components/sections/PianoSection'
import { ProgramSection } from './components/sections/ProgramSection'
import { SynthSection } from './components/sections/SynthSection'
import { StatusFooter } from './components/StatusFooter'
import {
  createInitialInstrumentState,
  instrumentStateReducer,
  projectPanelControlState,
} from './model/instrumentState'
import { COMPUTER_KEY_TO_MIDI, STAGE_4_73_VARIANT } from './model/variant'

export interface AppProps {
  readonly pianoBackend?: PianoVoiceBackend
  readonly midiProvider?: MidiProvider
  readonly maxPolyphony?: number
}

function isInteractivePanelTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.closest('[data-component="keybed"]')) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') {
    return true
  }
  const role = target.getAttribute('role')
  return role === 'slider' || role === 'button' || role === 'switch'
}

export default function App({
  pianoBackend,
  midiProvider = browserMidiProvider,
  maxPolyphony = 32,
}: AppProps = {}) {
  const [instrumentState, dispatchInstrument] = useReducer(
    instrumentStateReducer,
    undefined,
    createInitialInstrumentState,
  )

  const panelState = useMemo(
    () => projectPanelControlState(instrumentState),
    [instrumentState],
  )

  const ownsBackendRef = useRef(!pianoBackend)
  const backendRef = useRef<PianoVoiceBackend | null>(null)
  if (!backendRef.current) {
    backendRef.current = pianoBackend ?? new StageAudioEngine({ initialState: instrumentState })
  }

  const lifecycleRef = useRef<NoteLifecycleController | null>(null)
  if (!lifecycleRef.current) {
    lifecycleRef.current = new NoteLifecycleController(backendRef.current, { maxPolyphony })
  }

  const [audioStatus, setAudioStatus] = useState<PianoEngineStatusSnapshot>(() =>
    backendRef.current!.getStatus(),
  )
  const [noteSnapshot, setNoteSnapshot] = useState<NoteLifecycleSnapshot>(() =>
    lifecycleRef.current!.getSnapshot(),
  )
  const [midiStatus, setMidiStatus] = useState<MidiStatusSnapshot>({
    status: 'initializing',
    connectedInputs: [],
    message: 'Initializing Web MIDI…',
  })

  const midiControllerRef = useRef<MidiController | null>(null)

  // Synchronize canonical Phase 2 Piano & Layer Effects state to the audio engine and sustain router
  useEffect(() => {
    backendRef.current?.applyInstrumentState?.(instrumentState)
    lifecycleRef.current?.setSustainEnabled(instrumentState.piano.sustped)
  }, [instrumentState])

  const unlockAudio = useCallback(() => {
    void backendRef.current?.unlock()
  }, [])

  const handleNoteOn = useCallback((midi: number, velocity: number, sourceId: string) => {
    void backendRef.current?.unlock()
    lifecycleRef.current?.noteOn(midi, velocity, sourceId)
  }, [])

  const handleNoteOff = useCallback((midi: number, sourceId: string) => {
    lifecycleRef.current?.noteOff(midi, sourceId)
  }, [])

  const handleReleaseSource = useCallback((sourceId: string) => {
    lifecycleRef.current?.releaseSource(sourceId)
  }, [])

  const handleToggleSustain = useCallback((active: boolean) => {
    lifecycleRef.current?.setSustain(active, 'ui:sustain')
  }, [])

  const handleAllNotesOff = useCallback(() => {
    lifecycleRef.current?.allNotesOff()
  }, [])

  // Subscribe to audio status, note lifecycle, and initialize Web MIDI immediately on load
  useEffect(() => {
    const backend = backendRef.current!
    const lifecycle = lifecycleRef.current!

    const unsubStatus = backend.subscribeStatus(setAudioStatus)
    const unsubNotes = lifecycle.subscribe(setNoteSnapshot)
    setAudioStatus(backend.getStatus())
    setNoteSnapshot(lifecycle.getSnapshot())

    const midi = new MidiController(
      {
        onNoteOn: (midiNote, velocity, sourceId) => {
          void backend.unlock()
          lifecycle.noteOn(midiNote, velocity, sourceId)
        },
        onNoteOff: (midiNote, sourceId) => {
          lifecycle.noteOff(midiNote, sourceId)
        },
        onSustain: (active, sourceId) => {
          lifecycle.setSustain(active, sourceId)
        },
        onAllNotesOff: (portPrefix) => {
          lifecycle.releaseSourcesByPrefix(portPrefix)
        },
        onPortDisconnect: (portPrefix) => {
          lifecycle.releaseSourcesByPrefix(portPrefix)
        },
      },
      midiProvider,
    )
    midiControllerRef.current = midi
    const unsubMidi = midi.subscribe(setMidiStatus)
    void midi.init()

    return () => {
      unsubStatus()
      unsubNotes()
      unsubMidi()
      midi.dispose()
      midiControllerRef.current = null
      lifecycle.allNotesOff()
      if (ownsBackendRef.current) {
        backend.dispose()
      }
    }
  }, [midiProvider])

  // Global first-gesture unlock (ensures clicking anywhere, including top-left corner, unlocks AudioContext & MIDI)
  useEffect(() => {
    const onFirstGesture = () => {
      unlockAudio()
      if (midiControllerRef.current && midiControllerRef.current.getSnapshot().status === 'initializing') {
        void midiControllerRef.current.init()
      }
    }
    window.addEventListener('pointerdown', onFirstGesture, { capture: true })
    window.addEventListener('click', onFirstGesture, { capture: true })
    window.addEventListener('keydown', onFirstGesture, { capture: true })
    return () => {
      window.removeEventListener('pointerdown', onFirstGesture, { capture: true })
      window.removeEventListener('click', onFirstGesture, { capture: true })
      window.removeEventListener('keydown', onFirstGesture, { capture: true })
    }
  }, [unlockAudio])

  // Computer keyboard playing with repeat suppression, Space sustain, and blur/visibility cleanup
  useEffect(() => {
    const lifecycle = lifecycleRef.current!

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isInteractivePanelTarget(e.target)) return

      if (e.code === 'Space') {
        e.preventDefault()
        if (!e.repeat) {
          lifecycle.setSustain(true, 'kbd:Space')
        }
        return
      }

      const midi = COMPUTER_KEY_TO_MIDI[e.code]
      if (midi === undefined) return
      e.preventDefault()
      if (e.repeat) return
      handleNoteOn(midi, 96, `kbd:${e.code}`)
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        lifecycle.setSustain(false, 'kbd:Space')
        return
      }
      const midi = COMPUTER_KEY_TO_MIDI[e.code]
      if (midi === undefined) return
      lifecycle.noteOff(midi, `kbd:${e.code}`)
    }

    const onBlur = () => {
      lifecycle.allNotesOff()
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        lifecycle.allNotesOff()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [handleNoteOn])

  return (
    <main className="ns4-studio" data-variant={STAGE_4_73_VARIANT.id}>
      <div className="ns4-stage-scroller">
        <div
          className="ns4-chassis"
          data-component="instrument-chassis"
          role="region"
          aria-label="Nord Stage 4 73 instrument"
        >
          {/* Left grained dark-red wooden end cheek */}
          <div className="ns4-cheek ns4-cheek-left" aria-hidden="true" />

          {/* Continuous central red chassis housing deck (54%) + keybed (46%) */}
          <div className="ns4-body">
            {/* Upper 54%: Control Deck including top red lip with rear-jack legends */}
            <div className="ns4-deck-assembly" data-component="control-deck">
              <div className="ns4-top-rail" aria-hidden="true">
                <div className="ns4-jack-group">
                  <span>MONITOR IN</span>
                  <span>HEADPHONES</span>
                  <span>OUT 1 — OUT 2</span>
                  <span>OUT 3 — OUT 4</span>
                  <span>CONTROL PEDAL</span>
                  <span>ORGAN SWELL</span>
                  <span>SUSTAIN PEDAL</span>
                  <span>TRIPLE PEDAL</span>
                </div>
                <div className="ns4-jack-group">
                  <span>MIDI IN</span>
                  <span>MIDI OUT</span>
                  <span>ROTOR PEDAL</span>
                  <span>USB</span>
                  <span>FOOT SWITCH</span>
                </div>
                <div className="ns4-jack-group">
                  <span>AC IN</span>
                  <span>POWER ON/OFF</span>
                </div>
              </div>

              <div className="ns4-deck-sections" data-component="deck-sections">
                <PerformanceSection state={panelState} dispatch={dispatchInstrument} />
                <OrganSection state={panelState} dispatch={dispatchInstrument} />
                <PianoSection
                  state={panelState}
                  dispatch={dispatchInstrument}
                  pianoState={instrumentState.piano}
                  audioStatus={audioStatus}
                />
                <ProgramSection
                  state={panelState}
                  dispatch={dispatchInstrument}
                  audioStatus={audioStatus}
                  noteSnapshot={noteSnapshot}
                  instrumentState={instrumentState}
                />
                <SynthSection state={panelState} dispatch={dispatchInstrument} />
                <EffectsSection
                  state={panelState}
                  dispatch={dispatchInstrument}
                  effectsState={instrumentState.effects}
                />
              </div>

              <div className="ns4-deck-bottom-bevel" aria-hidden="true">
                <span className="ns4-split-led" style={{ left: '29%' }} />
                <span className="ns4-split-led is-lit" style={{ left: '47%' }} />
                <span className="ns4-split-led" style={{ left: '66%' }} />
              </div>
            </div>

            {/* Lower 46%: 73-key Hammer-Action Keybed (E1–E7) + bottom red rail */}
            <div className="ns4-keybed-band" data-component="keybed-band">
              <Keybed
                activeNotes={noteSnapshot.activeNotes}
                sustainedNotes={noteSnapshot.sustainedNotes}
                onNoteOn={handleNoteOn}
                onNoteOff={handleNoteOff}
                onReleaseSource={handleReleaseSource}
              />
              <div className="ns4-bottom-rail" aria-hidden="true" />
            </div>
          </div>

          {/* Right grained dark-red wooden end cheek */}
          <div className="ns4-cheek ns4-cheek-right" aria-hidden="true" />
        </div>
      </div>

      <StatusFooter
        audioStatus={audioStatus}
        midiStatus={midiStatus}
        noteSnapshot={noteSnapshot}
        onToggleSustain={handleToggleSustain}
        onAllNotesOff={handleAllNotesOff}
      />
    </main>
  )
}
