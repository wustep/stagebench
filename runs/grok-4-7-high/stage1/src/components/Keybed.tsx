import { useCallback, useRef, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { InstrumentController } from '../input/controller'
import { KEYS, WHITE_KEY_COUNT, type KeyDef } from '../model/keys'
import { VARIANT } from '../model/variant'

interface KeybedProps {
  controller: InstrumentController | null
}

const POINTER_FALLBACK_VELOCITY = 0.8

function KeyView({
  keyDef,
  controller,
  onPointerDownKey,
  onPointerUpKey,
}: {
  keyDef: KeyDef
  controller: InstrumentController
  onPointerDownKey: (event: ReactPointerEvent<HTMLButtonElement>, midi: number) => void
  onPointerUpKey: (event: ReactPointerEvent<HTMLButtonElement>, midi: number) => void
}) {
  const pressed = useSyncExternalStore(controller.subscribe, () => controller.isNoteHeld(keyDef.midi))
  const focusHeld = useRef(false)
  const whiteWidth = 100 / WHITE_KEY_COUNT

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    if (event.repeat || focusHeld.current) return
    focusHeld.current = true
    controller.noteOn(keyDef.midi, POINTER_FALLBACK_VELOCITY, 'keyboard')
  }
  const onKeyUp = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    if (!focusHeld.current) return
    focusHeld.current = false
    controller.noteOff(keyDef.midi, 'keyboard')
  }
  const onBlur = () => {
    if (!focusHeld.current) return
    focusHeld.current = false
    controller.noteOff(keyDef.midi, 'keyboard')
  }

  return (
    <button
      type="button"
      className={keyDef.isBlack ? 'key black-key' : 'key white-key'}
      data-control-id={keyDef.id}
      data-midi={keyDef.midi}
      data-note={keyDef.name}
      data-black={keyDef.isBlack ? 'true' : 'false'}
      data-pressed={pressed ? 'true' : 'false'}
      aria-label={`${keyDef.name} key`}
      aria-pressed={pressed}
      style={{
        left: `${keyDef.x * whiteWidth}%`,
        width: `${keyDef.w * whiteWidth}%`,
        height: keyDef.isBlack ? `${VARIANT.keyboard.blackKeyHeightFraction * 100}%` : '100%',
      }}
      onPointerDown={(event) => onPointerDownKey(event, keyDef.midi)}
      onPointerUp={(event) => onPointerUpKey(event, keyDef.midi)}
      onPointerCancel={(event) => onPointerUpKey(event, keyDef.midi)}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={onBlur}
      onContextMenu={(event) => event.preventDefault()}
    />
  )
}

export function Keybed({ controller }: KeybedProps) {
  const pointers = useRef(new Map<number, number>())

  const onPointerDownKey = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, midi: number) => {
      if (!controller) return
      event.preventDefault()
      if (pointers.current.has(event.pointerId)) return
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        /* jsdom */
      }
      pointers.current.set(event.pointerId, midi)
      const rect = event.currentTarget.getBoundingClientRect()
      const relativeY = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.72
      const velocity = Math.min(1, Math.max(0.2, 0.18 + 0.82 * relativeY))
      controller.noteOn(midi, Number.isFinite(velocity) ? velocity : POINTER_FALLBACK_VELOCITY, 'pointer')
    },
    [controller],
  )

  const onPointerUpKey = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, midi: number) => {
      if (!controller) return
      const owned = pointers.current.get(event.pointerId)
      if (owned !== midi) return
      pointers.current.delete(event.pointerId)
      controller.noteOff(midi, 'pointer')
    },
    [controller],
  )

  return (
    <div className="keybed-band" data-testid="keybed-band" data-split={VARIANT.vertical.keybed}>
      <div className="end-cheek" aria-hidden="true" />
      <div className="keybed-col">
        <div className="key-slot" aria-hidden="true" />
        <div
          className="keybed"
          role="group"
          aria-label={`${VARIANT.keyboard.totalKeys}-key ${VARIANT.keyAction} keybed, E1 to E7`}
          data-testid="keybed"
          data-key-count={VARIANT.keyboard.totalKeys}
        >
          {controller
            ? KEYS.map((keyDef) => (
                <KeyView
                  key={keyDef.id}
                  keyDef={keyDef}
                  controller={controller}
                  onPointerDownKey={onPointerDownKey}
                  onPointerUpKey={onPointerUpKey}
                />
              ))
            : null}
        </div>
      </div>
      <div className="end-cheek" aria-hidden="true" />
    </div>
  )
}
