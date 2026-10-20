import { useRef, type PointerEvent } from 'react'
import { KEYS, KEYBED, noteName, type KeyModel } from '../model/keybed'
import { COMPUTER_KEY_VELOCITY } from '../input/computerKeys'

export interface KeybedProps {
  heldNotes: ReadonlySet<number>
  onNoteOn: (source: string, note: number, velocity: number) => void
  onNoteOff: (source: string, note: number) => void
}

const WHITE_KEYS = KEYS.filter((key) => key.color === 'white')
const BLACK_KEYS = KEYS.filter((key) => key.color === 'black')

function keyFromPoint(event: PointerEvent<HTMLDivElement>): number | undefined {
  const element = document.elementFromPoint?.(event.clientX, event.clientY)
  const keyElement = element?.closest?.('[data-note]') as HTMLElement | null | undefined
  if (!keyElement) return undefined
  return Number(keyElement.dataset.note)
}

/**
 * The 73-key keybed. Every pointer (mouse, pen, each touch) owns its own note source, so multi-touch
 * is independent. Dragging across keys glides: the old note is released and the new one starts.
 */
export function Keybed({ heldNotes, onNoteOn, onNoteOff }: KeybedProps) {
  const pointerNotes = useRef(new Map<number, number>())

  const startPointer = (pointerId: number, note: number) => {
    pointerNotes.current.set(pointerId, note)
    onNoteOn(`pointer:${pointerId}`, note, COMPUTER_KEY_VELOCITY)
  }

  const endPointer = (pointerId: number) => {
    const note = pointerNotes.current.get(pointerId)
    if (note === undefined) return
    pointerNotes.current.delete(pointerId)
    onNoteOff(`pointer:${pointerId}`, note)
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const note = Number((event.target as HTMLElement).closest?.('[data-note]')?.getAttribute('data-note'))
    if (!Number.isInteger(note) || pointerNotes.current.has(event.pointerId)) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    startPointer(event.pointerId, note)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = pointerNotes.current.get(event.pointerId)
    if (current === undefined) return
    const note = keyFromPoint(event)
    if (note === undefined || note === current || !Number.isInteger(note)) return
    endPointer(event.pointerId)
    startPointer(event.pointerId, note)
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => endPointer(event.pointerId)

  return (
    <div
      className="keybed"
      role="group"
      aria-label={`Keybed, ${KEYBED.totalKeys} keys, ${noteName(KEYBED.lowestNote)} to ${noteName(KEYBED.highestNote)}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
    >
      {WHITE_KEYS.map((key) => (
        <KeyView key={key.note} model={key} pressed={heldNotes.has(key.note)} />
      ))}
      {BLACK_KEYS.map((key) => (
        <KeyView key={key.note} model={key} pressed={heldNotes.has(key.note)} />
      ))}
    </div>
  )
}

function KeyView({ model, pressed }: { model: KeyModel; pressed: boolean }) {
  const style = {
    left: `${model.left * 100}%`,
    width: `${model.width * 100}%`,
  }
  return (
    <div
      className={`key ${model.color} ${pressed ? 'pressed' : ''}`}
      style={style}
      data-note={model.note}
      data-label={model.label}
      title={model.label}
    />
  )
}
