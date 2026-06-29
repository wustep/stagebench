import { useRef, type PointerEvent } from 'react'
import { getComputerKeyLabel } from '../hooks/usePianoInstrument'

type PianoKey = { note: number; name: string; black: boolean; octave: number }
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
const BLACK = new Set([1, 3, 6, 8, 10])

function makeKeyboard(): PianoKey[] {
  // The reference 73-key action spans E1–E7.
  return Array.from({ length: 73 }, (_, index) => {
    const midi = 28 + index
    const chroma = midi % 12
    return { note: midi, name: NOTE_NAMES[chroma], black: BLACK.has(chroma), octave: Math.floor(midi / 12) - 1 }
  })
}

const KEYS = makeKeyboard()

type KeyboardProps = {
  activeNotes: Set<number>
  onNoteOn: (note: number, velocity: number, sourceId: string) => void
  onNoteOff: (sourceId: string) => void
}

export function Keyboard({ activeNotes, onNoteOn, onNoteOff }: KeyboardProps) {
  const whiteKeys = KEYS.filter((key) => !key.black)
  const pointerSources = useRef(new Map<number, string>())

  const pressPointer = (event: PointerEvent<HTMLButtonElement>, note: number, black: boolean) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const sourceId = `pointer:${event.pointerId}`
    pointerSources.current.set(event.pointerId, sourceId)
    const bounds = event.currentTarget.getBoundingClientRect()
    const position = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height))
    const velocity = Math.min(1, 0.42 + position * 0.55 + (black ? 0.04 : 0))
    onNoteOn(note, velocity, sourceId)
  }

  const releasePointer = (pointerId: number) => {
    const sourceId = pointerSources.current.get(pointerId)
    if (!sourceId) return
    pointerSources.current.delete(pointerId)
    onNoteOff(sourceId)
  }

  const whiteIndexBefore = (note: number) => KEYS.filter((key) => key.note < note && !key.black).length

  const renderKeyContents = (key: PianoKey) => {
    const computerKey = getComputerKeyLabel(key.note)
    return (
      <>
        {computerKey ? <span className="computer-key-label">{computerKey}</span> : null}
        {key.name === 'C' ? <span className="key-note">C{key.octave}</span> : null}
      </>
    )
  }

  return (
    <div className="keyboard" aria-label="73-key playable keyboard">
      <div className="white-keys">
        {whiteKeys.map((key) => {
          const keyboardSource = `accessible:${key.note}`
          return (
            <button
              type="button"
              key={key.note}
              className={`white-key ${activeNotes.has(key.note) ? 'pressed' : ''}`}
              aria-label={`${key.name}${key.octave}`}
              aria-pressed={activeNotes.has(key.note)}
              onPointerDown={(event) => pressPointer(event, key.note, false)}
              onPointerUp={(event) => releasePointer(event.pointerId)}
              onPointerCancel={(event) => releasePointer(event.pointerId)}
              onLostPointerCapture={(event) => releasePointer(event.pointerId)}
              onKeyDown={(event) => { if (!event.repeat && (event.key === 'Enter' || event.key === ' ')) onNoteOn(key.note, event.shiftKey ? 1 : 0.8, keyboardSource) }}
              onKeyUp={(event) => { if (event.key === 'Enter' || event.key === ' ') onNoteOff(keyboardSource) }}
            >
              {renderKeyContents(key)}
            </button>
          )
        })}
      </div>
      <div className="black-keys">
        {KEYS.filter((key) => key.black).map((key) => (
          <button
            tabIndex={-1}
            type="button"
            key={key.note}
            className={`black-key ${activeNotes.has(key.note) ? 'pressed' : ''}`}
            aria-label={`${key.name}${key.octave}`}
            aria-pressed={activeNotes.has(key.note)}
            onPointerDown={(event) => pressPointer(event, key.note, true)}
            onPointerUp={(event) => releasePointer(event.pointerId)}
            onPointerCancel={(event) => releasePointer(event.pointerId)}
            onLostPointerCapture={(event) => releasePointer(event.pointerId)}
            style={{ left: `${((whiteIndexBefore(key.note) - 0.32) / whiteKeys.length) * 100}%` }}
          >
            {renderKeyContents(key)}
          </button>
        ))}
      </div>
    </div>
  )
}
