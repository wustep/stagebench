/**
 * Composition root for the playable instrument.
 *
 * Audio, MIDI, timing and storage are all injected, so tests mount a real note lifecycle
 * with fake boundaries and no devices. Nothing here reaches for a global.
 *
 * Phase 3 wires the whole system together:
 *
 *   - One `ProgramState` (via the four stores) is the instrument's truth.
 *   - The Program system reads and writes that state, so the dirty flag is a comparison
 *     against what is really playing rather than against a cached copy.
 *   - Every panel edit flows: presentation value -> binding -> the owning store -> engine.
 *   - Splits, scenes, morphs, transpose and the clock are applied to the live state and
 *     pushed to the audio graph, so all three engines obey them.
 *
 * Nothing is written back into the graph except through the stores, which is what keeps
 * the LEDs, the display and the audio in agreement.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createManualClock, systemClock, type Clock } from '../audio/clock'
import {
  createPianoSession,
  type PianoSession,
  type PianoSnapshot,
} from '../audio/noteSession'
import {
  createSilentEngine,
  createWebAudioEngine,
  type InstrumentEngine,
} from '../audio/webAudioEngine'
import { adaptAudioContext, adaptMidiAccess } from '../audio/adapters'
import type { AudioContextFactory, AudioEngine, AudioStatusReport, LayerId } from '../audio/types'
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
  focusChain,
  type EffectState,
  type EffectStore,
} from '../audio/effectState'
import { createPianoStore, defaultPianoState, type PianoState, type PianoStore } from '../audio/pianoState'
import {
  createOrganStore,
  defaultOrganState,
  type OrganState,
  type OrganStore,
} from '../audio/organState'
import {
  createSynthStore,
  defaultSynthState,
  type SynthState,
  type SynthStore,
} from '../audio/synthState'
import {
  applyEffectEdit,
  applyOrganEdit,
  applyPianoEdit,
  applySynthEdit,
  EFFECT_CONTROL_IDS,
  ORGAN_CONTROL_IDS,
  PIANO_CONTROL_IDS,
  PROGRAM_CONTROL_IDS,
  SYNTH_CONTROL_IDS,
  focusTargetFor,
  isFunctionalControl,
  organPanelValue,
  pianoPanelValue,
  synthPanelValue,
  effectPanelValue,
} from '../audio/panelBindings'
import { modelById } from '../audio/pianoLibrary'
import type { LibraryStatus } from '../audio/webAudioEngine'
import {
  assignMorph,
  assignmentsFor,
  clearMorph,
  cloneProgramState,
  defaultProgramState,
  layerGainForNote,
  morphPosition,
  type CrossfadeWidth,
  type MorphSource,
  type ProgramState,
  type SplitPosition,
} from '../audio/programState'
import {
  browserProgramStorage,
  createProgramSystem,
  pageForSlot,
  type ProgramStorage,
  type ProgramSystem,
} from '../audio/programStore'
import { morphParameterFor, morphValues } from '../audio/panelBindings'
import { planArp, stepSecondsFor } from '../audio/synthModel'

/** Composition root for the playable instrument. */
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
  /** Where Live slots and stored programs persist. Defaults to `localStorage`. */
  programStorage?: ProgramStorage
  /** Start with a specific program slot selected. */
  programSlot?: number
}

export interface UseInstrumentResult {
  snapshot: PianoSnapshot
  midi: MidiStatusReport
  piano: PianoState
  organ: OrganState
  synth: SynthState
  effects: EffectState
  library: LibraryStatus
  /** The live program state, serialised on demand by the program system. */
  program: ProgramState
  /** The program system's own snapshot: slots, dirty flag, store flow, list view. */
  programs: ReturnType<ProgramSystem['get']>
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
  /** Runs a program-system command by its stable name, so the panel stays declarative. */
  programAction: (action: ProgramAction, arg?: number | string | boolean) => void
  /** Drives the wheel or the control pedal morph source. */
  setMorphSource: (source: MorphSource, position: number) => void
  /** Assigns the focused control's current value as a morph destination. */
  morphAssign: (source: MorphSource, controlId: string, start: number, end: number) => void
  /** Clears one source's assignments, or one assignment when a control id is given. */
  morphClear: (source: MorphSource, controlId?: string) => void
  /** Split-point and zone edits, from the Program band's split editor. */
  setSplitOn: (on: boolean) => void
  setSplitPoint: (
    point: 'Low' | 'Mid' | 'High',
    change: { position?: SplitPosition; crossfade?: CrossfadeWidth },
  ) => void
  setZone: (layer: LayerId, zone: number, on: boolean) => void
  /** The morph assignment currently being recorded, if a source button is held. */
  recordingMorph: MorphSource | null
  /** Starts and stops recording morph destinations for a source. */
  setRecordingMorph: (source: MorphSource | null) => void
  stores: {
    piano: PianoStore
    organ: OrganStore
    synth: SynthStore
    effects: EffectStore
    presentation: PresentationStore
  }
}

export type ProgramAction =
  | 'selectSlot'
  | 'browse'
  | 'pageUp'
  | 'pageDown'
  | 'liveMode'
  | 'store'
  | 'storeConfirm'
  | 'storeAs'
  | 'setName'
  | 'cancelStore'
  | 'storeBrowse'
  | 'listView'
  | 'undo'
  | 'sceneII'
  | 'tapClock'

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

export function createDefaultAudioEngine(
  sampleBaseUrl?: string,
  fetchSampleBytes?: (url: string) => Promise<ArrayBuffer>,
): AudioEngine {
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

function asInstrumentEngine(engine: AudioEngine): InstrumentEngine | null {
  return 'effects' in engine ? (engine as InstrumentEngine) : null
}

/** The clock's tempo, used by the delay, arp and synced LFO rates. */
export function tapTempo(times: number[]): number {
  if (times.length < 2) return 120
  // Use the last four taps: a player's most recent taps are the intended tempo.
  const recent = times.slice(-5)
  const gaps: number[] = []
  for (let i = 1; i < recent.length; i += 1) gaps.push(recent[i] - recent[i - 1])
  const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length
  if (!Number.isFinite(mean) || mean <= 0) return 120
  return Math.min(300, Math.max(30, Math.round(60000 / mean)))
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
  const instrumentEngine = asInstrumentEngine(engine)

  // ---- stores -------------------------------------------------------------
  const initialPiano = useMemo(
    () => (deps.initialState?.piano ? deps.initialState.piano : defaultPianoState()),
    // Deliberately mount-time only: these are the instrument's power-on defaults.
    [],
  )
  const pianoStoreRef = useRef<PianoStore | null>(null)
  if (!pianoStoreRef.current) pianoStoreRef.current = createPianoStore(initialPiano)
  const pianoStore = pianoStoreRef.current

  const organStoreRef = useRef<OrganStore | null>(null)
  if (!organStoreRef.current) organStoreRef.current = createOrganStore(defaultOrganState())
  const organStore = organStoreRef.current

  const synthStoreRef = useRef<SynthStore | null>(null)
  if (!synthStoreRef.current) synthStoreRef.current = createSynthStore(defaultSynthState())
  const synthStore = synthStoreRef.current

  const effectsStoreRef = useRef<EffectStore | null>(null)
  if (!effectsStoreRef.current) {
    // The engine owns the effect state so the graph and the panel read one object.
    effectsStoreRef.current =
      instrumentEngine?.effects ?? createEffectStore(deps.initialState?.effects ?? defaultEffectState())
  }
  const effectsStore = effectsStoreRef.current

  const presentationRef = useRef<PresentationStore | null>(null)
  if (!presentationRef.current) presentationRef.current = createPresentationStore()
  const presentation = presentationRef.current

  /**
   * The performance-only state a program does *not* store: the split, scenes, morphs,
   * clock and transpose all live in the program state (they are part of a stored sound),
   * but Master Level is a performance control and is deliberately excluded.
   */
  const programStateRef = useRef<ProgramState | null>(null)
  if (!programStateRef.current) {
    const base = defaultProgramState()
    programStateRef.current = base
  }

  /** The live program state, assembled from the four stores plus the program-only parts. */
  const readProgramState = useCallback((): ProgramState => {
    const base = programStateRef.current ?? defaultProgramState()
    return {
      ...base,
      piano: pianoStore.get(),
      organ: organStore.get(),
      synth: synthStore.get(),
      effects: effectsStore.get(),
    }
  }, [pianoStore, organStore, synthStore, effectsStore])


  /** Tells the program system that an edit happened, so its dirty flag is recomputed. */
  const programRefreshRef = useRef<() => void>(() => {})
  /**
   * The zone writer, held in a ref so the presentation sink can call it without being
   * reinstalled on every render. `setZone` is defined below the sink, and a ref keeps the
   * two from forming a dependency cycle.
   */
  const setZoneRef = useRef<(layer: LayerId, zone: number, on: boolean) => void>(() => {})
  /** The morph recorder, held in a ref for the same reason as the zone writer. */
  const setRecordingMorphRef = useRef<(source: MorphSource | null) => void>(() => {})
  /**
   * Reports a panel edit. In Live mode this auto-stores the edit into the selected Live slot,
   * which is the difference between a Live slot and a bank program.
   */
  function reportEdit(): void {
    programRefreshRef.current()
  }

  /**
   * Writes a program state into the instrument's stores.
   *
   * The effect store is the engine's own object, so its state is replaced through `update`
   * rather than by swapping the reference — otherwise the graph and the panel would be
   * reading different objects.
   */
  const writeProgramState = useCallback(
    (state: ProgramState) => {
      const next = cloneProgramState(state)
      programStateRef.current = next
      pianoStore.update((draft) => {
        Object.assign(draft, next.piano)
        draft.layers = {
          'piano.a': { ...next.piano.layers['piano.a'] },
          'piano.b': { ...next.piano.layers['piano.b'] },
        }
      })
      organStore.update((draft) => {
        draft.sectionOn = next.organ.sectionOn
        draft.focused = next.organ.focused
        for (const id of ['organ.a', 'organ.b'] as const) {
          Object.assign(draft.layers[id], next.organ.layers[id])
          draft.layers[id].drawbars = [...next.organ.layers[id].drawbars]
          draft.layers[id].percussion = { ...next.organ.layers[id].percussion }
          draft.layers[id].zones = [...next.organ.layers[id].zones] as [boolean, boolean, boolean, boolean]
        }
      })
      synthStore.update((draft) => {
        draft.sectionOn = next.synth.sectionOn
        draft.focused = next.synth.focused
        for (const id of ['synth.a', 'synth.b', 'synth.c'] as const) {
          Object.assign(draft.layers[id], next.synth.layers[id])
          draft.layers[id].oscEnv = { ...next.synth.layers[id].oscEnv }
          draft.layers[id].filterEnv = { ...next.synth.layers[id].filterEnv }
          draft.layers[id].ampEnv = { ...next.synth.layers[id].ampEnv }
          draft.layers[id].lfo = { ...next.synth.layers[id].lfo }
          draft.layers[id].arp = { ...next.synth.layers[id].arp }
          draft.layers[id].zones = [...next.synth.layers[id].zones] as [boolean, boolean, boolean, boolean]
        }
      })
      effectsStore.update((draft) => {
        draft.allOn = next.effects.allOn
        draft.focus = next.effects.focus
        draft.focusedLayer = next.effects.focusedLayer
        draft.pianoGroup = next.effects.pianoGroup
        draft.rotary = { ...next.effects.rotary }
        for (const owner of Object.keys(next.effects.chains) as Array<keyof typeof draft.chains>) {
          Object.assign(draft.chains[owner], next.effects.chains[owner])
        }
      })
    },
    [pianoStore, organStore, synthStore, effectsStore],
  )

  // ---- the program system --------------------------------------------
  //
  // Built after the stores and the read/write pair, and before the React state
  // initializers below, because booting a program writes into the stores and the first
  // render must show the booted program rather than the constructor's defaults.
  const programSystemRef = useRef<ProgramSystem | null>(null)
  if (!programSystemRef.current) {
    const system = createProgramSystem({
      read: readProgramState,
      write: writeProgramState,
      slot: deps.programSlot ?? 1,
      storage: deps.programStorage ?? browserProgramStorage(),
    })
    // The instrument boots into its selected program, exactly as the hardware does: the
    // slot's stored state is the power-on state, not the constructor's defaults.
    const boot = system.get()
    writeProgramState(boot.stored ?? boot.programs[boot.slot - 1].state)
    // Re-read, so the first snapshot's dirty flag compares the live state against the slot
    // it was just booted from rather than against the constructor's defaults.
    system.refresh()
    programSystemRef.current = system
  }
  const programSystem = programSystemRef.current
  programRefreshRef.current = programSystem.noteEdit

  const [pianoState, setPianoState] = useState<PianoState>(() => pianoStore.get())
  const [organState, setOrganState] = useState<OrganState>(() => organStore.get())
  const [synthState, setSynthState] = useState<SynthState>(() => synthStore.get())
  const [effectState, setEffectState] = useState<EffectState>(() => effectsStore.get())
  const [library, setLibrary] = useState<LibraryStatus>(() => ({
    state: 'idle',
    model: null,
    detail: 'Piano library not loaded',
    loadedFiles: 0,
    failedFiles: 0,
  }))

  const [programSnapshot, setProgramSnapshot] = useState(() => programSystem.get())

  const sessionRef = useRef<PianoSession | null>(null)
  if (!sessionRef.current) {
    sessionRef.current = createPianoSession({
      engine,
      clock,
      lowestMidi: VARIANT.lowestMidi,
      highestMidi: VARIANT.highestMidi,
      // All read at press time, so a panel change applies to the very next note.
      pianoState: () => pianoStore.get(),
      organState: () => organStore.get(),
      synthState: () => synthStore.get(),
      programState: () => readProgramState(),
      modWheel: () => (programStateRef.current?.morph.wheelPosition ?? 0),
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
    setOrganState(organStore.get())
    return organStore.subscribe(setOrganState)
  }, [organStore])

  useEffect(() => {
    setSynthState(synthStore.get())
    return synthStore.subscribe(setSynthState)
  }, [synthStore])

  useEffect(() => {
    setEffectState(effectsStore.get())
    return effectsStore.subscribe(setEffectState)
  }, [effectsStore])

  useEffect(() => programSystem.subscribe(setProgramSnapshot), [programSystem])

  /**
   * Mirror real state back into the panel.
   *
   * Every functional control's printed position must equal the state the audio graph is
   * using, or a knob would show a value the sound is not making. A program load, a morph, or
   * an edit from any other source therefore re-writes the panel values here. Writes are
   * tagged `api`, so the presentation store does not echo them back into the engine.
   */
  useEffect(() => {
    const state = { piano: pianoState, organ: organState, synth: synthState, effects: effectState }
    for (const id of FUNCTIONAL_IDS) {
      const value = panelValueFor(id, state)
      if (value === undefined) continue
      if (presentation.value(id) === value) continue
      presentation.set(id, value, 'api')
    }
    // The Program section's own readouts: the scene LED, split LED and live-mode LED follow
    // the state the same way.
    const liveLit = programSnapshot.liveMode
    if (presentation.value('program.live-mode') !== liveLit) {
      presentation.set('program.live-mode', liveLit, 'api')
    }
  }, [effectState, organState, pianoState, presentation, programSnapshot, synthState])

  /**
   * Push state into the graph. Every engine is applied here, so a single effect owns the
   * path from state to sound and nothing can set the graph behind the panel's back.
   */
  useEffect(() => {
    if (!instrumentEngine) return
    instrumentEngine.setPianoState(pianoState)
    instrumentEngine.setOrganState(organState)
    instrumentEngine.setSynthState(synthState)
    instrumentEngine.setMasterLevel(pianoState.masterLevel / 100)

    // Piano
    for (const layer of ['piano.a', 'piano.b'] as const) {
      const layerState = pianoState.layers[layer]
      const on = pianoState.sectionOn && layerState.enabled
      instrumentEngine.setLayerLevel(layer, layerState.level / 100)
      if (!on) session.releaseLayer(layer)
      instrumentEngine.setLayerEnabled(layer, on)
      session.setSustainRouting(layer, layerState.sustPed)
    }
    // Organ — two layers, one shared chain.
    for (const layer of ['organ.a', 'organ.b'] as const) {
      const layerState = organState.layers[layer]
      const on = organState.sectionOn && layerState.enabled
      instrumentEngine.setLayerLevel(layer, layerState.level / 100)
      if (!on) session.releaseLayer(layer)
      instrumentEngine.setLayerEnabled(layer, on)
      session.setSustainRouting(layer, layerState.sustPed)
    }
    // Synth — three independent layers.
    for (const layer of ['synth.a', 'synth.b', 'synth.c'] as const) {
      const layerState = synthState.layers[layer]
      const on = synthState.sectionOn && layerState.enabled
      instrumentEngine.setLayerLevel(layer, layerState.level / 100)
      if (!on) session.releaseLayer(layer)
      instrumentEngine.setLayerEnabled(layer, on)
      session.setSustainRouting(layer, layerState.sustPed)
    }
  }, [instrumentEngine, pianoState, organState, synthState, session])

  useEffect(() => {
    instrumentEngine?.syncEffects()
  }, [instrumentEngine, effectState])

  // Clock, and the arp run state follow the program state.
  useEffect(() => {
    instrumentEngine?.setClock(programSnapshot.programs[programSnapshot.slot - 1]?.state.clock.bpm ?? 120)
  }, [instrumentEngine, programSnapshot])

  /**
   * FX focus follows layer focus (manual p. 48).
   *
   * The section that most recently changed focus is the authority. Each engine's layer
   * buttons set their own section's focus, so this effect watches all three and moves the
   * shared effect focus to whichever section changed last — and mirrors the seven focus
   * LEDs back into the panel so exactly one is lit.
   */
  const focusRef = useRef<{ piano: string; organ: string; synth: string } | null>(null)
  useEffect(() => {
    const previous = focusRef.current
    focusRef.current = {
      piano: pianoState.focused,
      organ: organState.focused,
      synth: synthState.focused,
    }
    const changed: string[] = []
    if (!previous) {
      // Mount: the Piano section is the power-on focus.
      changed.push('piano')
    } else {
      if (previous.piano !== pianoState.focused) changed.push('piano')
      if (previous.organ !== organState.focused) changed.push('organ')
      if (previous.synth !== synthState.focused) changed.push('synth')
    }
    // The last section to change wins, which is the one the player just pressed.
    const winner = changed.at(-1)
    if (!winner) return
    const target =
      winner === 'piano'
        ? pianoState.focused
        : winner === 'organ'
          ? ('organ' as const)
          : synthState.focused
    const current = effectsStore.get().focusedLayer
    if (current !== target) {
      effectsStore.update((draft) => {
        focusChain(draft, target)
      })
    }
    // Mirror the radio group: only the LED of the focused chain stays lit.
    const litId = focusPanelId(target)
    for (const id of FOCUS_IDS) {
      const shouldBeOn = id === litId
      if (presentation.value(id) !== shouldBeOn) presentation.set(id, shouldBeOn, 'api')
    }
  }, [effectsStore, organState.focused, pianoState.focused, presentation, synthState.focused])

  /**
   * Panel -> real state. Only catalog ids that the bindings made functional reach this sink;
   * every other control writes presentation state and stops there.
   */
  useEffect(() => {
    presentation.setSink({
      onControlChange(id, value) {
        if (!isFunctionalControl(id)) return
        if (isProgramControl(id)) {
          handleProgramControl(id, value)
          return
        }
        // While a morph source is recording, a moved control becomes a destination: its
        // position before the move is the start, and the new value is the end.
        if (recordingMorphRef.current) {
          const parameter = morphParameterFor(id)
          if (parameter) {
            const source = recordingMorphRef.current
            const previous = previousMorphStartRef.current.get(id)
            const start = previous ?? (typeof value === 'number' ? value : value ? 1 : 0)
            if (typeof value === 'number') {
              previousMorphStartRef.current.set(id, start)
              morphAssignRef.current(source, id, start, value)
            }
          }
        }
        if (EFFECT_CONTROL_IDS.has(id)) {
          effectsStore.update((draft) => applyEffectEdit(draft, id, value))
          const target = focusTargetFor(id, value)
          if (target) {
            // Mirror the radio group back into the panel so exactly one LED is lit.
            for (const other of FOCUS_IDS) {
              if (other !== id && presentation.value(other) === true) {
                presentation.set(other, false, 'api')
              }
            }
          }
          reportEdit()
          return
        }
        if (ORGAN_CONTROL_IDS.has(id)) {
          // The Organ's KB ZONE switches assign the focused layer to a zone, which lives in
          // the program's split state rather than the organ store.
          const zoneMatch = /^(organ|piano)\.kb-zone\.([1-4])$/.exec(id)
          if (zoneMatch) {
            const engine = zoneMatch[1] as 'organ' | 'piano'
            const zone = Number(zoneMatch[2]) - 1
            const focused = engine === 'organ' ? organStore.get().focused : pianoStore.get().focused
            setZoneRef.current(focused, zone, Boolean(value))
            return
          }
          organStore.update((draft) => applyOrganEdit(draft, id, value))
          reportEdit()
          return
        }
        if (SYNTH_CONTROL_IDS.has(id)) {
          synthStore.update((draft) => applySynthEdit(draft, id, value))
          reportEdit()
          return
        }
        if (PIANO_CONTROL_IDS.has(id)) {
          const zoneMatch = /^piano\.kb-zone\.([1-4])$/.exec(id)
          if (zoneMatch) {
            setZoneRef.current(pianoStore.get().focused, Number(zoneMatch[1]) - 1, Boolean(value))
            return
          }
          pianoStore.update((draft) => applyPianoEdit(draft, id, value))
          reportEdit()
        }
      },
    })
    return () => presentation.setSink(null)
    // The refs are stable, and re-installing the sink on every edit would drop a drag in
    // progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectsStore, organStore, pianoStore, presentation, synthStore])

  /* ---------------------------------------------------------------- */
  /* Program panel actions                                            */
  /* ---------------------------------------------------------------- */

  const tapTimesRef = useRef<number[]>([])

  function isProgramControl(id: string): boolean {
    return PROGRAM_CONTROL_IDS.has(id)
  }

  /**
   * The Program section's momentary controls. Each one maps to a program-system command;
   * the mapping lives here because it needs the clock and the panel, which the system does
   * not.
   */
  function handleProgramControl(id: string, value: number | boolean): void {
    void value
    switch (id) {
      case 'program.dial':
        // The dial is a numeric position, not a delta: selecting a slot is the intent.
        programSystem.selectSlot(Number(presentation.value('program.dial') ?? 1))
        return
      case 'program.page.up':
        programSystem.setPage(programSystem.get().page + 1)
        return
      case 'program.page.down':
        programSystem.setPage(programSystem.get().page - 1)
        return
      case 'program.live-mode':
        programSystem.setLiveMode(presentation.value('program.live-mode') === true)
        return
      case 'program.layer-scene':
        programSystem.setSceneII(presentation.value('program.layer-scene') === true)
        session.refreshRouting()
        return
      case 'program.store':
        // First press enters the destination step; a second press confirms it.
        if (programSystem.get().storeTarget === null) programSystem.beginStore()
        else programSystem.confirmStore()
        return
      case 'program.split':
        setSplitOn(presentation.value('program.split') === true)
        return
      case 'program.morph.wheel':
        // The morph source button is held while the player sweeps destinations. A press
        // starts recording for that source; the panel reports the release through the same
        // control, so the second edge ends it.
        // `value` is the press edge for a momentary button: true on press, false on release.
        setRecordingMorphRef.current(value ? 'Wheel' : null)
        return
      case 'program.morph.ctrlped':
        setRecordingMorphRef.current(value ? 'Control Pedal' : null)
        return
      case 'program.mst-clk': {
        // Tapping four or more times sets the tempo; the button's own state is the gate.
        const now = clock.now()
        const taps = [...tapTimesRef.current, now].filter((time) => now - time < 2500)
        tapTimesRef.current = taps
        if (taps.length >= 4) {
          const bpm = tapTempo(taps)
          updateProgram((draft) => {
            draft.clock.bpm = bpm
          })
        }
        return
      }
      case 'program.transpose.on':
        updateProgram((draft) => {
          draft.transposeOn = presentation.value('program.transpose.on') === true
        })
        session.refreshRouting()
        return
      case 'program.transpose.set':
        // SET KEY steps the transpose up one semitone and wraps inside ±6.
        updateProgram((draft) => {
          draft.transpose = draft.transpose >= 6 ? -6 : draft.transpose + 1
          draft.transposeOn = true
        })
        session.refreshRouting()
        return
      case 'program.panic':
        panicRef.current()
        return
      case 'program.shift':
        // SHIFT/EXIT cancels a pending store, which is its documented job here.
        programSystem.cancelStore()
        return
      default: {
        const match = /^program\.slot\.(\d+)$/.exec(id)
        if (match) programSystem.selectSlot(Number(match[1]) + (programSystem.get().page - 1) * 8)
      }
    }
  }

  /** Applies an edit to the program-only part of the state and publishes it. */
  const updateProgram = useCallback(
    (mutate: (draft: ProgramState) => void) => {
      const base = readProgramState()
      const next = cloneProgramState(base)
      mutate(next)
      programStateRef.current = next
      // The stores did not change, so the program system has to be told to re-read.
      programSystem.refresh()
      // Splits and scenes change routing; the session re-evaluates the held keys.
      session.refreshRouting()
    },
    [programSystem, readProgramState, session],
  )

  const setSplitOn = useCallback(
    (on: boolean) => {
      updateProgram((draft) => {
        draft.split.on = on
      })
      // Mirror the panel's SPLIT LED so it can never disagree with the routing.
      presentation.set('program.split', on, 'api')
    },
    [presentation, updateProgram],
  )

  const setSplitPoint = useCallback(
    (
      point: 'Low' | 'Mid' | 'High',
      change: { position?: SplitPosition; crossfade?: CrossfadeWidth },
    ) => {
      updateProgram((draft) => {
        const current = draft.split.points[point]
        if (change.position) current.position = change.position
        if (change.crossfade !== undefined) current.crossfade = change.crossfade
      })
    },
    [updateProgram],
  )

  const setZone = useCallback(
    (layer: LayerId, zone: number, on: boolean) => {
      const index = Math.max(0, Math.min(3, Math.round(zone)))
      updateProgram((draft) => {
        const zones = draft.split.zones[layer]
        if (!zones) return
        zones[index] = on
      })
      // The per-engine zone LEDs show the focused layer's assignment.
      if (layer.startsWith('organ')) {
        presentation.set(`organ.kb-zone.${index + 1}`, on, 'api')
      } else if (layer.startsWith('piano')) {
        presentation.set(`piano.kb-zone.${index + 1}`, on, 'api')
      }
    },
    [presentation, updateProgram],
  )

  setZoneRef.current = setZone

  const [recordingMorph, setRecordingMorphState] = useState<MorphSource | null>(null)
  /** Refs so the presentation sink can read them without being reinstalled. */
  const recordingMorphRef = useRef<MorphSource | null>(null)
  recordingMorphRef.current = recordingMorph
  /** The value a control had when a recording started, per control. */
  const previousMorphStartRef = useRef(new Map<string, number>())
  const morphAssignRef = useRef<(source: MorphSource, controlId: string, start: number, end: number) => void>(
    () => {},
  )

  /**
   * Starts or stops recording morph destinations for a source.
   *
   * While a source is recording, moving a control writes that control's start and end into
   * the assignment list. Ending the recording drops any assignment that never moved, because
   * an unmoved control is not a morph.
   */
  const setRecordingMorph = useCallback(
    (source: MorphSource | null) => {
      if (recordingMorph && source === null) {
        const list = assignmentsFor(readProgramState().morph, recordingMorph)
        if (list.some((entry) => entry.start === entry.end)) {
          const finished = recordingMorph
          updateProgram((draft) => {
            const key = finished === 'Wheel' ? 'wheel' : 'pedal'
            draft.morph[key] = draft.morph[key].filter((entry) => entry.start !== entry.end)
          })
        }
      }
      previousMorphStartRef.current.clear()
      setRecordingMorphState(source)
    },
    [readProgramState, recordingMorph, updateProgram],
  )
  setRecordingMorphRef.current = setRecordingMorph


  // A ref to panic, so the program control handler can call it without a circular dependency.
  const panicRef = useRef<() => void>(() => {})

  /* ---------------------------------------------------------------- */
  /* Morphs                                                           */
  /* ---------------------------------------------------------------- */

  const setMorphSource = useCallback(
    (source: MorphSource, position: number) => {
      const clamped = Math.min(1, Math.max(0, position))
      updateProgram((draft) => {
        if (source === 'Wheel') draft.morph.wheelPosition = clamped
        else draft.morph.pedalPosition = clamped
      })
      // A morph writes its destinations through the same edit path a hand uses, so the
      // panels and the LEDs follow automatically.
      const values = morphValues(readProgramState().morph, source)
      for (const [controlId, value] of Object.entries(values.values)) {
        applyControlFromMorph(controlId, value)
      }
      if (source === 'Wheel') instrumentEngine?.setModWheel(clamped)
    },
    [instrumentEngine, readProgramState, updateProgram],
  )

  const morphAssign = useCallback(
    (source: MorphSource, controlId: string, start: number, end: number) => {
      updateProgram((draft) => {
        assignMorph(draft.morph, source, controlId, start, end)
      })
    },
    [updateProgram],
  )

  morphAssignRef.current = morphAssign

  const morphClear = useCallback(
    (source: MorphSource, controlId?: string) => {
      updateProgram((draft) => {
        clearMorph(draft.morph, source, controlId)
      })
    },
    [updateProgram],
  )

  /** Applies a morph-driven value without re-entering the morph recorder. */
  function applyControlFromMorph(id: string, value: number): void {
    if (EFFECT_CONTROL_IDS.has(id)) {
      effectsStore.update((draft) => applyEffectEdit(draft, id, value))
      return
    }
    if (ORGAN_CONTROL_IDS.has(id)) {
      organStore.update((draft) => applyOrganEdit(draft, id, value))
      return
    }
    if (SYNTH_CONTROL_IDS.has(id)) {
      synthStore.update((draft) => applySynthEdit(draft, id, value))
      return
    }
    pianoStore.update((draft) => applyPianoEdit(draft, id, value))
  }

  /* ---------------------------------------------------------------- */
  /* Sample library                                                   */
  /* ---------------------------------------------------------------- */

  const loadModel = useCallback(
    async (modelId: string) => {
      if (!instrumentEngine) {
        setLibrary({
          state: 'fallback',
          model: modelId,
          detail: 'No audio engine — the piano library is not loaded',
          loadedFiles: 0,
          failedFiles: 0,
        })
        return ['no-engine']
      }
      const failures = await instrumentEngine.preloadModel(modelId)
      setLibrary(instrumentEngine.libraryStatus())
      return failures
    },
    [instrumentEngine],
  )

  const loadedModels = useRef(new Set<string>())
  useEffect(() => {
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
      setLibrary(
        instrumentEngine
          ? instrumentEngine.libraryStatus()
          : { state: 'ready', model: layer.model, detail: 'Piano library ready', loadedFiles: 0, failedFiles: 0 },
      )
      return
    }
    loadedModels.current.add(layer.model)
    void loadModel(layer.model)
  }, [instrumentEngine, loadModel, pianoState.focused, pianoState.layers])

  /* ---------------------------------------------------------------- */
  /* Input                                                            */
  /* ---------------------------------------------------------------- */

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
     * keydown would never fire again until the key was released and re-pressed.
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
    session.allNotesOff('panic')
    // Panic also resets the held performance inputs: the wheel and pedal morph sources
    // return to rest, and the arpeggiator stops walking.
    session.setArpRun(false)
    updateProgram((draft) => {
      draft.morph.wheelPosition = 0
      draft.morph.pedalPosition = 0
    })
    window.dispatchEvent(new CustomEvent(PANIC_EVENT))
  }, [session, updateProgram])
  panicRef.current = panic

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
      onControl: (owner, controller, value) => {
        // CC11 drives the Control Pedal morph source, which is the documented input.
        if (controller === 11) setMorphSource('Control Pedal', value / 127)
        void owner
      },
      onStatus: (report) => setMidiStatus(report),
      onDisconnect: () => {
        // A MIDI device going away must not leave notes ringing: every owned voice stops.
        session.allNotesOff('midi-disconnect')
      },
    })
    midiBridgeRef.current = bridge
    void bridge.connect()
  }, [session, setMorphSource])

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

  const programAction = useCallback(
    (action: ProgramAction, arg?: number | string | boolean) => {
      switch (action) {
        case 'selectSlot':
          programSystem.selectSlot(Number(arg ?? programSystem.get().slot))
          return
        case 'browse':
          programSystem.browse(Number(arg ?? 1))
          return
        case 'pageUp':
          programSystem.setPage(programSystem.get().page + 1)
          return
        case 'pageDown':
          programSystem.setPage(programSystem.get().page - 1)
          return
        case 'liveMode':
          programSystem.setLiveMode(Boolean(arg))
          return
        case 'store':
          programSystem.beginStore()
          return
        case 'storeConfirm':
          programSystem.confirmStore()
          return
        case 'storeAs':
          programSystem.beginStoreAs()
          return
        case 'setName':
          programSystem.setName(String(arg ?? ''))
          return
        case 'cancelStore':
          programSystem.cancelStore()
          return
        case 'storeBrowse':
          programSystem.storeBrowse(Number(arg ?? 1))
          return
        case 'listView':
          programSystem.setListView(Boolean(arg))
          return
        case 'undo':
          programSystem.undoLastChange()
          return
        case 'sceneII':
          programSystem.setSceneII(Boolean(arg))
          session.refreshRouting()
          return
        case 'tapClock': {
          const now = clock.now()
          const taps = [...tapTimesRef.current, now].filter((time) => now - time < 2500)
          tapTimesRef.current = taps
          if (taps.length >= 4) {
            updateProgram((draft) => {
              draft.clock.bpm = tapTempo(taps)
            })
          }
          return
        }
      }
    },
    [clock, programSystem, session, updateProgram],
  )

  // The arpeggiator follows the focused synth layer's ARP RUN state.
  useEffect(() => {
    const focused = synthState.layers[synthState.focused]
    const shouldRun = synthState.sectionOn && focused.enabled && focused.arp.mode === 'Arp' && focused.arp.run
    session.setArpRun(shouldRun)
  }, [session, synthState])

  // Routing changes (a scene, a zone, an enable) re-evaluate the keys still held.
  const routingKey = useMemo(
    () =>
      [
        programSnapshot.sceneII,
        programSnapshot.dirty,
        programSnapshot.slot,
        pianoState.sectionOn,
        organState.sectionOn,
        synthState.sectionOn,
        pianoState.layers['piano.a'].enabled,
        pianoState.layers['piano.b'].enabled,
        organState.layers['organ.a'].enabled,
        organState.layers['organ.b'].enabled,
        synthState.layers['synth.a'].enabled,
        synthState.layers['synth.b'].enabled,
        synthState.layers['synth.c'].enabled,
      ].join('|'),
    [programSnapshot, pianoState, organState, synthState],
  )
  useEffect(() => {
    session.refreshRouting()
  }, [session, routingKey])

  return {
    snapshot,
    midi: midiStatus,
    piano: pianoState,
    organ: organState,
    synth: synthState,
    effects: effectState,
    library,
    program: readProgramState(),
    programs: programSnapshot,
    pressPointer,
    releasePointer,
    sustainFromUi,
    panic,
    midiConnect,
    setControl,
    effectsAvailable: instrumentEngine ? instrumentEngine.effectsAvailable : false,
    loadModel,
    programAction,
    setMorphSource,
    morphAssign,
    morphClear,
    setSplitOn,
    setSplitPoint,
    setZone,
    recordingMorph,
    setRecordingMorph,
    stores: {
      piano: pianoStore,
      organ: organStore,
      synth: synthStore,
      effects: effectsStore,
      presentation,
    },
  }
}

/** Every catalog id that is bound to real state. */
const FUNCTIONAL_IDS: readonly string[] = [
  ...PIANO_CONTROL_IDS,
  ...ORGAN_CONTROL_IDS,
  ...SYNTH_CONTROL_IDS,
  ...EFFECT_CONTROL_IDS,
]

/** The focus buttons whose LEDs form one radio group across all three sections. */
const FOCUS_IDS = [
  'effects.focus.organ-a',
  'effects.focus.organ-b',
  'effects.focus.piano-a',
  'effects.focus.piano-b',
  'effects.focus.synth-a',
  'effects.focus.synth-b',
  'effects.focus.synth-c',
]

/** The panel id whose LED indicates a given chain's focus. */
function focusPanelId(owner: string): string {
  // The organ's two layers share one chain, and the panel shows that on the A button.
  if (owner === 'organ') return 'effects.focus.organ-a'
  return `effects.focus.${owner.replace('.', '-')}`
}

/** Panel read-back for every functional control, so a control never shows stale state. */
export function panelValueFor(
  id: string,
  state: { piano: PianoState; organ: OrganState; synth: SynthState; effects: EffectState },
): number | boolean | undefined {
  if (EFFECT_CONTROL_IDS.has(id)) return effectPanelValue(state.effects, id)
  if (ORGAN_CONTROL_IDS.has(id)) return organPanelValue(state.organ, id)
  if (SYNTH_CONTROL_IDS.has(id)) return synthPanelValue(state.synth, id)
  return pianoPanelValue(state.piano, id)
}

/** Exposed for tests that want the manual clock. */
export { createManualClock }
export { pageForSlot, planArp, stepSecondsFor, layerGainForNote, morphPosition }
