import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import {
  STAGE_4_73_BLACK_KEYS,
  STAGE_4_73_VARIANT,
  STAGE_4_73_WHITE_KEYS,
  type KeyDefinition,
} from '../model/variant'

export interface KeybedProps {
  readonly activeNotes: ReadonlySet<number>
  readonly sustainedNotes: ReadonlySet<number>
  readonly onNoteOn: (midi: number, velocity: number, sourceId: string) => void
  readonly onNoteOff: (midi: number, sourceId: string) => void
  readonly onReleaseSource: (sourceId: string) => void
}

function estimatePointerVelocity(clientY: number, rect: DOMRect): number {
  if (rect.height <= 0) return 96
  const frac = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
  // Striking lower toward the key front produces stronger velocity (62..118)
  return Math.round(62 + frac * 56)
}

export function Keybed({
  activeNotes,
  sustainedNotes,
  onNoteOn,
  onNoteOff,
  onReleaseSource,
}: KeybedProps) {
  const pointerToMidiRef = useRef<Map<number, number>>(new Map())

  const handleKeyPointerDown = (key: KeyDefinition, e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const rect = e.currentTarget.getBoundingClientRect()
    const vel = estimatePointerVelocity(e.clientY, rect)
    const sourceId = `pointer:${e.pointerId}`
    pointerToMidiRef.current.set(e.pointerId, key.midi)
    onNoteOn(key.midi, vel, sourceId)
  }

  const handleKeyPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const sourceId = `pointer:${e.pointerId}`
    const midi = pointerToMidiRef.current.get(e.pointerId)
    pointerToMidiRef.current.delete(e.pointerId)
    if (midi !== undefined) {
      onNoteOff(midi, sourceId)
    } else {
      onReleaseSource(sourceId)
    }
  }

  const handleKeyDown = (key: KeyDefinition, e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      e.stopPropagation()
      if (e.repeat) return
      onNoteOn(key.midi, 100, `kbd-focus:${key.midi}`)
    }
  }

  const handleKeyUp = (key: KeyDefinition, e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      e.stopPropagation()
      onNoteOff(key.midi, `kbd-focus:${key.midi}`)
    }
  }

  const blackHeightPercent = STAGE_4_73_VARIANT.keyboard.blackKeyHeightFraction * 100

  return (
    <div
      className="ns4-keybed-assembly"
      data-component="keybed"
      data-total-keys={STAGE_4_73_VARIANT.keyboard.totalKeys}
      data-white-keys={STAGE_4_73_VARIANT.keyboard.whiteKeys}
      data-black-keys={STAGE_4_73_VARIANT.keyboard.blackKeys}
      data-range="E1-E7"
      role="group"
      aria-label="Nord Stage 4 73 hammer-action keybed, E1 to E7"
    >
      <div className="ns4-felt-strip" aria-hidden="true" />
      <div className="ns4-keys-stage">
        {STAGE_4_73_WHITE_KEYS.map((key) => {
          const isPressed = activeNotes.has(key.midi)
          const isSustained = !isPressed && sustainedNotes.has(key.midi)
          return (
            <button
              key={key.id}
              id={key.id}
              type="button"
              data-key-midi={key.midi}
              data-key-note={key.noteName}
              data-key-color="white"
              aria-label={`Piano key ${key.noteName}`}
              aria-pressed={isPressed}
              className={`ns4-key ns4-key-white ${isPressed ? 'is-pressed' : ''} ${isSustained ? 'is-sustained' : ''}`}
              style={{
                left: `${key.leftPercent}%`,
                width: `${key.widthPercent}%`,
              }}
              onPointerDown={(e) => handleKeyPointerDown(key, e)}
              onPointerUp={handleKeyPointerUp}
              onPointerCancel={handleKeyPointerUp}
              onLostPointerCapture={handleKeyPointerUp}
              onKeyDown={(e) => handleKeyDown(key, e)}
              onKeyUp={(e) => handleKeyUp(key, e)}
              onBlur={() => onNoteOff(key.midi, `kbd-focus:${key.midi}`)}
            >
              {key.noteName === 'C4' ? (
                <span className="ns4-key-c4-mark" aria-hidden="true">
                  C4
                </span>
              ) : null}
            </button>
          )
        })}

        {STAGE_4_73_BLACK_KEYS.map((key) => {
          const isPressed = activeNotes.has(key.midi)
          const isSustained = !isPressed && sustainedNotes.has(key.midi)
          return (
            <button
              key={key.id}
              id={key.id}
              type="button"
              data-key-midi={key.midi}
              data-key-note={key.noteName}
              data-key-color="black"
              aria-label={`Piano key ${key.noteName}`}
              aria-pressed={isPressed}
              className={`ns4-key ns4-key-black ${isPressed ? 'is-pressed' : ''} ${isSustained ? 'is-sustained' : ''}`}
              style={{
                left: `${key.leftPercent}%`,
                width: `${key.widthPercent}%`,
                height: `${blackHeightPercent}%`,
              }}
              onPointerDown={(e) => handleKeyPointerDown(key, e)}
              onPointerUp={handleKeyPointerUp}
              onPointerCancel={handleKeyPointerUp}
              onLostPointerCapture={handleKeyPointerUp}
              onKeyDown={(e) => handleKeyDown(key, e)}
              onKeyUp={(e) => handleKeyUp(key, e)}
              onBlur={() => onNoteOff(key.midi, `kbd-focus:${key.midi}`)}
            />
          )
        })}
      </div>
    </div>
  )
}
