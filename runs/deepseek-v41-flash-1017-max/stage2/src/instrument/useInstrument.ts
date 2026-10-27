/**
 * Composition root for the playable instrument.
 *
 * Audio, MIDI and the clock are all injected, so tests mount a real note lifecycle with
 * fake boundaries and no devices. Nothing here reaches for a global.
 *
 * Phase 2 adds three collaborators that the panel talks to:
 *   - the Piano store (types, layers, performance controls, master level)
 *   - the Layer Effects store (chains, focus, group/global, rotary)
 *   - the piano sample library, loaded per selected model
 *
 * Every panel edit flows: presentation value -> panel binding -> store -> engine -> graph.
 * Nothing is written back into the graph except through those stores, which is what keeps
 * the LEDs and the audio in agreement.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createManualClock, systemClock, type Clock } from '../audio/clock'
import { createPianoSession, type PianoSession, type PianoSnapshot } from '../audio/noteSession'
import { createSilentEngine, createWebAudioEngine, type PianoEngine } from '../audio/webAudioEngine'
import { adaptAudioContext, adaptMidiAccess } from '../audio/adapters'
import type { AudioContextFactory, AudioEngine, AudioStatusReport } from '../audio/types'
import {
  browserMidiAccess,
  createMidiBridge,
  type MidiAccessFactory,
  type MidiBridge,
  type MidiStatusReport,
} from '../input/midi'
import { KEYBOARD_VELOCITY, SUSTAIN_KEY_CODE, mappingForCode } from '../input/keyboardMap'
import { VARIANT } from '../hardware/variant'
import { createPresentationStore, type PresentationStore } from '../hardware/presentation'
import {
  createEffectStore,
  defaultEffectState,
  type EffectState,
  type EffectStore,
} from '../audio/effectState'
import {
  createPianoStore,
  defaultPianoState,
  type PianoState,
  type PianoStore,
} from '../audio/pianoState'
import {
  applyEffectEdit,
  applyPianoEdit,
  focusCounterpart,
  focusTargetFor,
  isFunctionalControl,
  pianoStateFromPanel,
} from '../audio/panelBindings'
import { modelById } from '../audio/pianoLibrary'
import type { LibraryStatus } from '../audio/webAudioEngine'

/**
 * Composition root for the playable instrument.
 */
export interface InstrumentDeps {
  /** Fully injected engine, used by tests and by the capture pass. */
  engine?: AudioEngine
  createAudioContext?: AudioContextFactory
  requestMidiAccess?: MidiAccessFactory
  clock?: Clock
  /** Force the silent engine; used by the capture pass and by tests. */
  disableAudio?: boolean
  /** Where the bundled sample files live. Defaults to `./samples/`. */
  sampleBaseUrl?: string
  /** Injected sample fetch, so tests can exercise load failure without a network. */
  fetchSampleBytes?: (url: string) => Promise<ArrayBuffer>
  /** Start with every effect off, for tests that need a dry reference. */
  initialState?: { piano?: PianoState; effects?: EffectState }
}

export interface UseInstrumentResult {
  snapshot: PianoSnapshot
  midi: MidiStatusReport
  piano: PianoState
  effects: EffectState
  library: LibraryStatus
  pressPointer: (midi: number, velocity: number, pointerId: number) => void
  releasePointer: (midi: number, pointerId: number) => void
  sustainFromUi: (down: boolean) => void
  panic: () => void
  midiConnect: () => void
  /** Writes a real control value (used by the panel and by tests). */
  setControl: (id: string, value: number | boolean) => void
  /** True when the engine can process effects in this environment. */
  effectsAvailable: boolean
  /** Reloads samples for a model, so a test can force the fallback path. */
  loadModel: (modelId: string) => Promise<string[]>
  stores: { piano: PianoStore; effects: EffectStore; presentation: PresentationStore }
}

const UI_SUSTAIN_OWNER = 'ui:sustain'
/** Broadcast so the keyboard listener can forget keys that panic already stopped. */
export const PANIC_EVENT = 'nord:panic'
const pointerOwner = (pointerId: number) => `pointer:${pointerId}`
const keyboardOwner = (code: string) => `keyboard:${code}`

/** Converts a pointer velocity estimate to the 0..1 curve the model expects. */
function normalizePointerVelocity(velocity: number): number {
  if (!Number.isFinite(velocity)) return 0.72
  return Math.min(1, Math.max(0.05, velocity))
}

/**
 * Resolves the bundled sample directory relative to the built page. `base: './'` means the
 * app may be served from a sub-path, so the URL is built from the document base rather
 * than assuming the site root.
 */
export function defaultSampleBaseUrl(): string {
  if (typeof document === 'undefined') return './samples/'
  const base = document.baseURI ?? ''
  try {
    return new URL('samples/', base).href
  } catch {
    return './samples/'
  }
}

export function createDefaultAudioEngine(sampleBaseUrl?: string, fetchSampleBytes?: (url: string) => Promise<ArrayBuffer>): AudioEngine {
  const Ctor =
    typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
  if (!Ctor) {
    return createSilentEngine('Web Audio unavailable — the keybed is silent in this browser')
  }
  return createWebAudioEngine({
    createContext: () => adaptAudioContext(new Ctor()),
    sampleBaseUrl,
    fetchBytes: fetchSampleBytes,
  })
}

function asPianoEngine(engine: AudioEngine): PianoEngine | null {
  return 'effects' in engine ? (engine as PianoEngine) : null
}

export function useInstrument(deps: InstrumentDeps = {}): UseInstrumentResult {
  const depsRef = useRef(deps)
  depsRef.current = deps

  const clock = deps.clock ?? systemClock

  const engineRef = useRef<AudioEngine | null>(null)
  if (!engineRef.current) {
    engineRef.current =
      deps.engine ??
      (deps.disableAudio
        ? createSilentEngine('Audio disabled for this run — the keybed is silent')
        : createDefaultAudioEngine(deps.sampleBaseUrl ?? defaultSampleBaseUrl(), deps.fetchSampleBytes))
  }
  const engine = engineRef.current
  const ownsEngine = deps.engine === undefined
  const pianoEngine = asPianoEngine(engine)

  // ---- stores -------------------------------------------------------------
  const initialPiano = useMemo(
    () => (deps.initialState?.piano ? deps.initialState.piano : pianoStateFromPanel(defaultPianoState())),
    // Deliberately mount-time only: these are the instrument's power-on defaults.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const pianoStoreRef = useRef<PianoStore | null>(null)
  if (!pianoStoreRef.current) pianoStoreRef.current = createPianoStore(initialPiano)
  const pianoStore = pianoStoreRef.current

  const effectsStoreRef = useRef<EffectStore | null>(null)
  if (!effectsStoreRef.current) {
    // The engine owns the effect state so the graph and the panel read one object.
    effectsStoreRef.current =
      pianoEngine?.effects ?? createEffectStore(deps.initialState?.effects ?? defaultEffectState())
  }
  const effectsStore = effectsStoreRef.current

  const presentationRef = useRef<PresentationStore | null>(null)
  if (!presentationRef.current) presentationRef.current = createPresentationStore()
  const presentation = presentationRef.current

  const [pianoState, setPianoState] = useState<PianoState>(() => pianoStore.get())
  const [effectState, setEffectState] = useState<EffectState>(() => effectsStore.get())
  const [library, setLibrary] = useState<LibraryStatus>(() => ({
    state: 'idle',
    model: null,
    detail: 'Piano library not loaded',
    loadedFiles: 0,
    failedFiles: 0,
  }))

  const sessionRef = useRef<PianoSession | null>(null)
  if (!sessionRef.current) {
    sessionRef.current = createPianoSession({
      engine,
      clock,
      lowestMidi: VARIANT.lowestMidi,
      highestMidi: VARIANT.highestMidi,
      // Reads at press time, so a panel change applies to the very next note.
      pianoState: () => pianoStore.get(),
    })
  }
  const session = sessionRef.current

  const [snapshot, setSnapshot] = useState<PianoSnapshot>(() => session.snapshot())
  const [midiStatus, setMidiStatus] = useState<MidiStatusReport>({
    state: 'idle',
    detail: 'MIDI not connected',
    inputCount: 0,
    inputNames: [],
  })
  const midiBridgeRef = useRef<MidiBridge | null>(null)

  useEffect(() => {
    const unsubscribe = session.subscribe(setSnapshot)
    const unsubscribeAudio = engine.subscribe((report: AudioStatusReport) => {
      session.reportAudio(report)
    })
    return () => {
      unsubscribe()
      unsubscribeAudio()
    }
  }, [engine, session])

  // Mirror the stores into React state so the panel re-renders on a real change.
  useEffect(() => {
    setPianoState(pianoStore.get())
    return pianoStore.subscribe(setPianoState)
  }, [pianoStore])

  useEffect(() => {
    setEffectState(effectsStore.get())
    return effectsStore.subscribe(setEffectState)
  }, [effectsStore])

  /**
   * Push state into the graph. Piano state is applied immediately (level, master, sustain
   * routing); the effect state is applied through the engine's own sync so a single code
   * path owns every ramp.
   */
  useEffect(() => {
    if (!pianoEngine) return
    pianoEngine.setMasterLevel(pianoState.masterLevel / 100)
    pianoEngine.setLayerLevel('piano.a', pianoState.layers['piano.a'].level / 100)
    pianoEngine.setLayerLevel('piano.b', pianoState.layers['piano.b'].level / 100)
    const aOn = pianoState.sectionOn && pianoState.layers['piano.a'].enabled
    const bOn = pianoState.sectionOn && pianoState.layers['piano.b'].enabled
    for (const [layer, on] of [
      ['piano.a', aOn],
      ['piano.b', bOn],
    ] as const) {
      if (!on) {
        // The session drops the layer's voices so its snapshot stays truthful, then the
        // engine mutes the layer bus.
        session.releaseLayer(layer)
      }
      pianoEngine.setLayerEnabled(layer, on)
    }
    session.setSustainRouting('piano.a', pianoState.layers['piano.a'].sustPed)
    session.setSustainRouting('piano.b', pianoState.layers['piano.b'].sustPed)
  }, [pianoEngine, pianoState, session])

  useEffect(() => {
    pianoEngine?.syncEffects()
  }, [pianoEngine, effectState])

  /**
   * FX focus follows layer focus (manual p. 48). The Piano section is the authority on which
   * layer is focused; the effect store follows it, so pressing a layer button retargets the
   * effect controls exactly as it does on the instrument.
   */
  useEffect(() => {
    const focused = pianoState.focused
    // The pair always shows which layer is focused, whichever side changed it.
    presentation.set('effects.focus.piano-a', focused === 'piano.a', 'api')
    presentation.set('effects.focus.piano-b', focused === 'piano.b', 'api')
    if (effectsStore.get().focusedLayer === focused) return
    effectsStore.update((draft) => {
      draft.focusedLayer = focused
      draft.focus = 'piano'
    })
  }, [effectsStore, pianoState.focused, presentation])

  /**
   * Panel -> real state. Only catalog ids that Phase 2 made functional reach this sink;
   * every other control writes presentation state and stops there, which is the Phase 1
   * contract that `interaction.decorative-controls` still asserts.
   */
  useEffect(() => {
    presentation.setSink({
      onControlChange(id, value) {
        if (!isFunctionalControl(id)) return
        if (id.startsWith('effects.') || id.startsWith('performance.rotary.')) {
          effectsStore.update((draft) => applyEffectEdit(draft, id, value))
          // A manual focus press also moves the Piano section's focus, so the two
          // indications cannot disagree.
          const target = focusTargetFor(id, value)
          if (target) {
            pianoStore.update((draft) => {
              draft.focused = target
            })
            // Mirror the radio pair back into the panel so exactly one LED is lit.
            const other = focusCounterpart(id)
            if (other) presentation.set(other, false, 'api')
          }
          return
        }
        pianoStore.update((draft) => applyPianoEdit(draft, id, value))
      },
    })
    return () => presentation.setSink(null)
  }, [effectsStore, pianoStore, presentation])

  // Load the samples the selected model needs whenever the selection changes.
  const loadModel = useCallback(
    async (modelId: string) => {
      if (!pianoEngine) {
        // With no Web Audio engine there is no library and nothing is sounding, so the
        // display must not claim a fallback is playing.
        setLibrary({
          state: 'fallback',
          model: modelId,
          detail: 'No audio engine — the piano library is not loaded',
          loadedFiles: 0,
          failedFiles: 0,
        })
        return ['no-engine']
      }
      const failures = await pianoEngine.preloadModel(modelId)
      setLibrary(pianoEngine.libraryStatus())
      return failures
    },
    [pianoEngine],
  )

  const loadedModels = useRef(new Set<string>())
  useEffect(() => {
    // The focused layer's model is the one the player is about to use.
    const layer = pianoState.layers[pianoState.focused]
    const model = modelById(layer.model)
    if (!model || model.source !== 'recorded') {
      setLibrary({
        state: 'ready',
        model: layer.model,
        detail: 'Modelled piano — no samples to load',
        loadedFiles: 0,
        failedFiles: 0,
      })
      return
    }
    if (loadedModels.current.has(layer.model)) {
      setLibrary(pianoEngine ? pianoEngine.libraryStatus() : {
        state: 'ready', model: layer.model, detail: 'Piano library ready', loadedFiles: 0, failedFiles: 0,
      })
      return
    }
    loadedModels.current.add(layer.model)
    void loadModel(layer.model)
  }, [loadModel, pianoEngine, pianoState.focused, pianoState.layers])

  // Keyboard input: one listener on the window, repeat suppressed, blur cleaned up.
  useEffect(() => {
    const held = new Set<string>()
    let sustainHeld = false

    const isTypingTarget = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null
      if (!el || !el.tagName) return false
      const tag = el.tagName.toLowerCase()
      return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      if (event.code === SUSTAIN_KEY_CODE) {
        event.preventDefault()
        if (!sustainHeld && !event.repeat) {
          sustainHeld = true
          session.setSustain(true, `${keyboardOwner(SUSTAIN_KEY_CODE)}`)
        }
        return
      }
      const mapping = mappingForCode(event.code)
      if (!mapping) return
      event.preventDefault()
      // Repeat suppression is the held-key set, not the `repeat` flag: while the key is
      // tracked as down, every auto-repeat is ignored. If the set no longer contains the
      // key (panic cleared it, or focus returned mid-hold), a repeat is a genuine stroke
      // that must sound rather than being swallowed until the key is released.
      if (held.has(event.code)) return
      held.add(event.code)
      session.press({
        midi: 48 + mapping.offset,
        velocity: KEYBOARD_VELOCITY,
        source: 'keyboard',
        owner: keyboardOwner(event.code),
      })
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === SUSTAIN_KEY_CODE) {
        if (!sustainHeld) return
        sustainHeld = false
        session.setSustain(false, `${keyboardOwner(SUSTAIN_KEY_CODE)}`)
        return
      }
      if (!held.has(event.code)) return
      held.delete(event.code)
      const mapping = mappingForCode(event.code)
      if (!mapping) return
      session.release('keyboard', keyboardOwner(event.code), 48 + mapping.offset)
    }

    const releaseEverything = () => {
      for (const code of held) {
        const mapping = mappingForCode(code)
        if (mapping) session.release('keyboard', keyboardOwner(code), 48 + mapping.offset)
      }
      held.clear()
      if (sustainHeld) {
        sustainHeld = false
        session.setSustain(false, `${keyboardOwner(SUSTAIN_KEY_CODE)}`)
      }
      session.allNotesOff('blur')
    }

    const onBlur = () => releaseEverything()

    /**
     * A panic (or any other source stopping every voice) must reset this listener's view of
     * which keys are down, or the next keyup for a key that was held would be ignored and the
     * keydown would never fire again until the key is released and re-pressed. Clearing the
     * held set means the next keydown for a still-held key is treated as a fresh stroke.
     */
    const onPanic = () => {
      held.clear()
      sustainHeld = false
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') releaseEverything()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    window.addEventListener(PANIC_EVENT, onPanic)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener(PANIC_EVENT, onPanic)
      document.removeEventListener('visibilitychange', onVisibility)
      releaseEverything()
    }
  }, [session])

  // Unmount: stop every voice this session owns and dispose the engine.
  useEffect(() => {
    const sessionToDispose = session
    const engineToDispose = engine
    const shouldDisposeEngine = ownsEngine
    return () => {
      // Unmount stops every voice this instrument owns; an injected engine is the
      // caller's to dispose, so only one we created ourselves is closed here.
      sessionToDispose.dispose()
      if (shouldDisposeEngine) engineToDispose.dispose()
    }
  }, [engine, ownsEngine, session])

  const pressPointer = useCallback(
    (midi: number, velocity: number, pointerId: number) => {
      session.press({
        midi,
        velocity: normalizePointerVelocity(velocity),
        source: 'pointer',
        owner: pointerOwner(pointerId),
      })
    },
    [session],
  )

  const releasePointer = useCallback(
    (midi: number, pointerId: number) => {
      session.release('pointer', pointerOwner(pointerId), midi)
    },
    [session],
  )

  const sustainFromUi = useCallback(
    (down: boolean) => {
      session.setSustain(down, UI_SUSTAIN_OWNER)
    },
    [session],
  )

  const panic = useCallback(() => {
    // Panic is a global all-notes-off; the key handler's own held-key set is rebuilt on the
    // next keydown because a key that is still physically down will auto-repeat, and the
    // repeat guard only suppresses notes the session still owns.
    session.allNotesOff('panic')
    window.dispatchEvent(new CustomEvent(PANIC_EVENT))
  }, [session])

  const midiConnect = useCallback(() => {
    if (midiBridgeRef.current) {
      void midiBridgeRef.current.connect()
      return
    }
    const access = depsRef.current.requestMidiAccess ?? (() => browserMidiAccess(adaptMidiAccess))
    const bridge = createMidiBridge({
      requestAccess: access,
      onNoteOn: (owner, midi, velocity) => {
        session.press({ midi, velocity, source: 'midi', owner })
      },
      onNoteOff: (owner, midi) => {
        session.release('midi', owner, midi)
      },
      onSustain: (owner, down) => {
        session.setSustain(down, owner)
      },
      onStatus: (report) => setMidiStatus(report),
      onDisconnect: () => {
        // A MIDI device going away must not leave notes ringing: every owned voice stops.
        session.allNotesOff('midi-disconnect')
      },
    })
    midiBridgeRef.current = bridge
    void bridge.connect()
  }, [session])

  useEffect(() => {
    const bridge = midiBridgeRef.current
    return () => {
      bridge?.disconnect()
    }
  }, [])

  /**
   * The one programmatic write path. A test (or an automation) can set any functional
   * control through the same code a pointer uses, and the presentation store is updated so
   * the panel shows the new position.
   */
  const setControl = useCallback(
    (id: string, value: number | boolean) => {
      presentation.set(id, value, 'pointer')
    },
    [presentation],
  )

  return {
    snapshot,
    midi: midiStatus,
    piano: pianoState,
    effects: effectState,
    library,
    pressPointer,
    releasePointer,
    sustainFromUi,
    panic,
    midiConnect,
    setControl,
    effectsAvailable: pianoEngine ? pianoEngine.effectsAvailable : false,
    loadModel,
    stores: { piano: pianoStore, effects: effectsStore, presentation },
  }
}

/** Exposed for tests that want the manual clock. */
export { createManualClock }
