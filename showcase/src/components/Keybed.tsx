import { memo, useCallback, useRef, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { InstrumentController } from '../input/controller'
import type { InstrumentStore, SplitState } from '../state/instrument'
import { KEYS, WHITE_KEY_COUNT, type KeyDef } from '../model/keys'
import { VARIANT } from '../model/variant'

interface KeybedProps {
  controller: InstrumentController
  /** When provided, active split points render as markers above the keys (manual p. 39). */
  instrument?: InstrumentStore
}

const noSubscribe = () => () => {}

function useSplitState(instrument: InstrumentStore | undefined): SplitState | null {
  return useSyncExternalStore(instrument ? instrument.subscribe : noSubscribe, () =>
    instrument ? instrument.getState().split : null,
  )
}

const DEFAULT_POINTER_VELOCITY = 0.8

interface KeyProps {
  keyDef: KeyDef
  controller: InstrumentController
  onPointerDownKey: (event: ReactPointerEvent<HTMLButtonElement>, midi: number) => void
  onPointerUpKey: (event: ReactPointerEvent<HTMLButtonElement>, midi: number) => void
}

const KeyView = memo(function KeyView({ keyDef, controller, onPointerDownKey, onPointerUpKey }: KeyProps) {
  const pressed = useSyncExternalStore(controller.subscribe, () => controller.isNoteHeld(keyDef.midi))
  const heldByFocusKey = useRef(false)

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    if (event.repeat || heldByFocusKey.current) return
    heldByFocusKey.current = true
    controller.noteOn(keyDef.midi, DEFAULT_POINTER_VELOCITY, 'keyboard')
  }
  const onKeyUp = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    if (!heldByFocusKey.current) return
    heldByFocusKey.current = false
    controller.noteOff(keyDef.midi, 'keyboard')
  }
  const onBlur = () => {
    if (!heldByFocusKey.current) return
    heldByFocusKey.current = false
    controller.noteOff(keyDef.midi, 'keyboard')
  }

  const whiteWidth = 100 / WHITE_KEY_COUNT
  return (
    <button
      type="button"
      className={keyDef.isBlack ? 'key black-key' : 'key white-key'}
      data-control-id={keyDef.id}
      data-midi={keyDef.midi}
      data-pressed={pressed ? 'true' : 'false'}
      aria-label={`${keyDef.name} key`}
      aria-pressed={pressed}
      style={{ left: `${keyDef.x * whiteWidth}%`, width: `${keyDef.w * whiteWidth}%` }}
      onPointerDown={(event) => onPointerDownKey(event, keyDef.midi)}
      onPointerUp={(event) => onPointerUpKey(event, keyDef.midi)}
      onPointerCancel={(event) => onPointerUpKey(event, keyDef.midi)}
      onLostPointerCapture={(event) => onPointerUpKey(event, keyDef.midi)}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={onBlur}
      onContextMenu={(event) => event.preventDefault()}
    />
  )
})

/**
 * The exact 73-key E–E keybed. Each key owns its pointer via pointer capture,
 * so independent touches drive independent notes through the shared
 * controller lifecycle.
 */
export function Keybed({ controller, instrument }: KeybedProps) {
  // pointerId -> midi ownership map; one pointer owns at most one note.
  const pointerNotes = useRef(new Map<number, number>())
  const split = useSplitState(instrument)

  // Stable across renders so the 73 memo'd KeyViews don't all re-render when
  // Keybed re-renders (it re-renders on every instrument-store tick via
  // useSplitState). controller is stable, so [] deps would do — [controller]
  // keeps it correct if a new controller is ever passed.
  const onPointerDownKey = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, midi: number) => {
      event.preventDefault()
      if (pointerNotes.current.has(event.pointerId)) return
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        /* jsdom or detached node */
      }
      pointerNotes.current.set(event.pointerId, midi)
      const rect = event.currentTarget.getBoundingClientRect()
      const relativeY = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.7
      const velocity = Math.min(1, Math.max(0.25, 0.3 + 0.7 * relativeY))
      controller.noteOn(midi, Number.isFinite(velocity) ? velocity : DEFAULT_POINTER_VELOCITY, 'pointer')
    },
    [controller],
  )

  const onPointerUpKey = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, midi: number) => {
      const owned = pointerNotes.current.get(event.pointerId)
      if (owned !== midi) return
      pointerNotes.current.delete(event.pointerId)
      controller.noteOff(midi, 'pointer')
    },
    [controller],
  )

  return (
    <div className="keybed-row">
      <div className="end-cheek left" aria-hidden="true" />
      <div className="keybed-col">
        {/* Recessed key-well slot behind the keys (reference photo: a dark
            band between the deck's front edge and the key tops, flanked by
            the red cheeks). Drawn at ~half its apparent photo height — the
            askew product shot also shows the well's shadowed back wall,
            which a top-down view would not. */}
        <div className="key-slot" aria-hidden="true" />
        <div
          className="keybed"
          role="group"
          aria-label={`${VARIANT.keyboard.totalKeys}-key ${VARIANT.keyAction} keybed, E1 to E7`}
          data-testid="keybed"
        >
        {/* Chromatic DOM order (tab/focus order matches pitch order); black
            keys stack above via .black-key's z-index — they stay absolutely
            positioned by .key (never position:relative, see SHOWCASE.md
            iteration 17). */}
          {KEYS.map((keyDef) => (
            <KeyView key={keyDef.id} keyDef={keyDef} controller={controller} onPointerDownKey={onPointerDownKey} onPointerUpKey={onPointerUpKey} />
          ))}
          {split?.on &&
            split.points
              .filter((point) => point.active)
              .map((point) => {
                const key = KEYS.find((k) => k.midi === point.note)
                if (!key) return null
                return (
                  <span
                    key={point.note}
                    className="split-marker"
                    data-split-note={point.note}
                    style={{ left: `${key.x * (100 / WHITE_KEY_COUNT)}%` }}
                    aria-hidden="true"
                  />
                )
              })}
        </div>
      </div>
      <div className="end-cheek right" aria-hidden="true" />
    </div>
  )
}
