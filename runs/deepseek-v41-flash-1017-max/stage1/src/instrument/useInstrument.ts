import { useCallback, useEffect, useRef, useState } from 'react'
import { createManualClock, systemClock, type Clock } from '../audio/clock'
import { createPianoSession, type PianoSession, type PianoSnapshot } from '../audio/noteSession'
import { createSilentEngine, createWebAudioEngine } from '../audio/webAudioEngine'
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

/**
 * Composition root for the playable instrument.
 *
 * Audio, MIDI and the clock are all injected, so tests mount a real note lifecycle with
 * fake boundaries and no devices. Nothing here reaches for a global.
 */
export interface InstrumentDeps {
  /** Fully injected engine, used by tests and by the capture pass. */
  engine?: AudioEngine
  createAudioContext?: AudioContextFactory
  requestMidiAccess?: MidiAccessFactory
  clock?: Clock
  /** Force the silent engine; used by the capture pass and by tests. */
  disableAudio?: boolean
}

export interface UseInstrumentResult {
  snapshot: PianoSnapshot
  midi: MidiStatusReport
  pressPointer: (midi: number, velocity: number, pointerId: number) => void
  releasePointer: (midi: number, pointerId: number) => void
  sustainFromUi: (down: boolean) => void
  panic: () => void
  midiConnect: () => void
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

export function createDefaultAudioEngine(): AudioEngine {
  const Ctor =
    typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
  if (!Ctor) {
    return createSilentEngine('Web Audio unavailable — the keybed is silent in this browser')
  }
  return createWebAudioEngine({ createContext: () => adaptAudioContext(new Ctor()) })
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
        : createDefaultAudioEngine())
  }
  const engine = engineRef.current
  const ownsEngine = deps.engine === undefined

  const sessionRef = useRef<PianoSession | null>(null)
  if (!sessionRef.current) {
    sessionRef.current = createPianoSession({
      engine,
      clock,
      lowestMidi: VARIANT.lowestMidi,
      highestMidi: VARIANT.highestMidi,
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

  return {
    snapshot,
    midi: midiStatus,
    pressPointer,
    releasePointer,
    sustainFromUi,
    panic,
    midiConnect,
  }
}

/** Exposed for tests that want the manual clock. */
export { createManualClock }
