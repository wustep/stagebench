import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { KEYBED, type PianoKey } from '../model/keyboard'
import type { NoteSource } from '../audio/pianoEngine'

export interface SplitMarker {
  readonly note: number
  readonly crossfade: number
}

export interface KeybedProps {
  readonly heldNotes: ReadonlySet<number>
  /** Active split points, so the LED strip above the keys shows where the keyboard divides. */
  readonly splitPoints?: readonly SplitMarker[]
  noteOn(source: NoteSource, key: string | number, midi: number, velocity?: number): void
  noteOff(source: NoteSource, key: string | number): void
}

/** Softest strike at the very top of the key, loudest at the front lip, as on a real action. */
function velocityFromPointer(event: ReactPointerEvent<HTMLElement>): number {
  const bounds = event.currentTarget.getBoundingClientRect()
  if (bounds.height <= 0) return 0.8
  const depth = (event.clientY - bounds.top) / bounds.height
  return Math.min(1, Math.max(0.15, 0.35 + 0.65 * depth))
}

/**
 * The 73-key hammer-action keybed. Every key is a real button so it is reachable by keyboard and
 * exposed to assistive technology; pointer and touch input run through the same note lifecycle
 * as the computer keyboard and MIDI.
 */
export function Keybed({ heldNotes, splitPoints = [], noteOn, noteOff }: KeybedProps) {
  // pointerId -> midi note currently owned by that pointer. Independent per touch point.
  const pointers = useRef(new Map<number, number>())

  const stopPointer = useCallback(
    (pointerId: number) => {
      if (!pointers.current.delete(pointerId)) return
      noteOff('pointer', pointerId)
    },
    [noteOff],
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const release = (event: PointerEvent) => stopPointer(event.pointerId)
    const releaseAll = () => {
      for (const pointerId of Array.from(pointers.current.keys())) stopPointer(pointerId)
    }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    window.addEventListener('blur', releaseAll)
    return () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      window.removeEventListener('blur', releaseAll)
      releaseAll()
    }
  }, [stopPointer])

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, key: PianoKey) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      event.preventDefault()
      pointers.current.set(event.pointerId, key.midi)
      noteOn('pointer', event.pointerId, key.midi, velocityFromPointer(event))
    },
    [noteOn],
  )

  /** Glissando: dragging across the keybed moves the note this pointer owns. */
  const onPointerEnter = useCallback(
    (event: ReactPointerEvent<HTMLElement>, key: PianoKey) => {
      const owned = pointers.current.get(event.pointerId)
      if (owned === undefined || owned === key.midi) return
      noteOff('pointer', event.pointerId)
      pointers.current.set(event.pointerId, key.midi)
      noteOn('pointer', event.pointerId, key.midi, velocityFromPointer(event))
    },
    [noteOff, noteOn],
  )

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>, key: PianoKey) => {
      if (event.key !== ' ' && event.key !== 'Enter') return
      event.preventDefault()
      if (event.repeat) return
      noteOn('ui', key.midi, key.midi, 0.8)
    },
    [noteOn],
  )

  const onKeyUp = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>, key: PianoKey) => {
      if (event.key !== ' ' && event.key !== 'Enter') return
      noteOff('ui', key.midi)
    },
    [noteOff],
  )

  const renderKey = (key: PianoKey) => (
    <button
      key={key.id}
      type="button"
      id={key.id}
      className={`pkey pkey--${key.color}`}
      style={{ left: `${key.x * 100}%`, width: `${key.width * 100}%`, height: `${key.height * 100}%` }}
      aria-label={`${key.name}, MIDI note ${key.midi}`}
      aria-pressed={heldNotes.has(key.midi)}
      data-midi={key.midi}
      data-note={key.name}
      data-key-color={key.color}
      data-held={heldNotes.has(key.midi) ? 'true' : 'false'}
      onPointerDown={(event) => onPointerDown(event, key)}
      onPointerEnter={(event) => onPointerEnter(event, key)}
      onKeyDown={(event) => onKeyDown(event, key)}
      onKeyUp={(event) => onKeyUp(event, key)}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span aria-hidden="true" className="pkey__front" />
    </button>
  )

  return (
    <div className="keybed" role="group" aria-label="73 key hammer action keybed, E1 to E7">
      <div className="keybed__splits" aria-hidden="true">
        {splitPoints.map((point) => {
          const key = KEYBED.find((entry) => entry.midi === point.note)
          if (!key) return null
          return (
            <span
              key={point.note}
              className="keybed__split"
              data-split-note={point.note}
              data-split-crossfade={point.crossfade}
              style={{ left: `${key.x * 100}%` }}
            />
          )
        })}
      </div>
      <div className="keybed__whites">{KEYBED.filter((key) => key.color === 'white').map(renderKey)}</div>
      <div className="keybed__blacks">{KEYBED.filter((key) => key.color === 'black').map(renderKey)}</div>
    </div>
  )
}
