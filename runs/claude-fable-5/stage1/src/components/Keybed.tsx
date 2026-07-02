import { memo, useRef, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { InstrumentController } from '../input/controller'
import { KEYS, WHITE_KEY_COUNT, type KeyDef } from '../model/keys'
import { VARIANT } from '../model/variant'

interface KeybedProps {
  controller: InstrumentController
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
export function Keybed({ controller }: KeybedProps) {
  // pointerId -> midi ownership map; one pointer owns at most one note.
  const pointerNotes = useRef(new Map<number, number>())

  const onPointerDownKey = (event: ReactPointerEvent<HTMLButtonElement>, midi: number) => {
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
  }

  const onPointerUpKey = (event: ReactPointerEvent<HTMLButtonElement>, midi: number) => {
    const owned = pointerNotes.current.get(event.pointerId)
    if (owned !== midi) return
    pointerNotes.current.delete(event.pointerId)
    controller.noteOff(midi, 'pointer')
  }

  return (
    <div className="keybed-row">
      <div className="end-cheek left" aria-hidden="true" />
      <div
        className="keybed"
        role="group"
        aria-label={`${VARIANT.keyboard.totalKeys}-key ${VARIANT.keyAction} keybed, E1 to E7`}
        data-testid="keybed"
      >
        {KEYS.filter((k) => !k.isBlack).map((keyDef) => (
          <KeyView key={keyDef.id} keyDef={keyDef} controller={controller} onPointerDownKey={onPointerDownKey} onPointerUpKey={onPointerUpKey} />
        ))}
        {KEYS.filter((k) => k.isBlack).map((keyDef) => (
          <KeyView key={keyDef.id} keyDef={keyDef} controller={controller} onPointerDownKey={onPointerDownKey} onPointerUpKey={onPointerUpKey} />
        ))}
      </div>
      <div className="end-cheek right" aria-hidden="true" />
    </div>
  )
}
