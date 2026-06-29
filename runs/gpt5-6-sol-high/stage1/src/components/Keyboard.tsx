import { useState } from 'react'

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

export function Keyboard() {
  const keys = KEYS
  const whiteKeys = keys.filter((key) => !key.black)
  const [pressed, setPressed] = useState<Set<number>>(() => new Set())

  const press = (note: number) => setPressed((current) => new Set(current).add(note))
  const release = (note: number) => setPressed((current) => {
    const next = new Set(current)
    next.delete(note)
    return next
  })

  const whiteIndexBefore = (note: number) => keys.filter((key) => key.note < note && !key.black).length

  return (
    <div className="keyboard" aria-label="73-key keyboard">
      <div className="white-keys">
        {whiteKeys.map((key) => (
          <button
            type="button"
            key={key.note}
            className={`white-key ${pressed.has(key.note) ? 'pressed' : ''}`}
            aria-label={`${key.name}${key.octave}`}
            onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); press(key.note) }}
            onPointerUp={() => release(key.note)}
            onPointerCancel={() => release(key.note)}
            onPointerLeave={() => release(key.note)}
            onKeyDown={(event) => { if (!event.repeat && (event.key === 'Enter' || event.key === ' ')) press(key.note) }}
            onKeyUp={(event) => { if (event.key === 'Enter' || event.key === ' ') release(key.note) }}
          >
            {key.name === 'C' && <span className="key-note">C{key.octave}</span>}
          </button>
        ))}
      </div>
      <div className="black-keys" aria-hidden="true">
        {keys.filter((key) => key.black).map((key) => (
          <button
            tabIndex={-1}
            type="button"
            key={key.note}
            className={`black-key ${pressed.has(key.note) ? 'pressed' : ''}`}
            aria-label={`${key.name}${key.octave}`}
            onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); press(key.note) }}
            onPointerUp={() => release(key.note)}
            onPointerCancel={() => release(key.note)}
            style={{ left: `${((whiteIndexBefore(key.note) - 0.32) / whiteKeys.length) * 100}%` }}
          />
        ))}
      </div>
    </div>
  )
}
