import { useState, type KeyboardEvent, type PointerEvent } from 'react'
import { KEYS, type PianoKey } from '../model/hardware'

function Key({ pianoKey, active, setActive }: { pianoKey: PianoKey; active: boolean; setActive: (midi: number, value: boolean, velocity?: number) => void }) {
  const keyboardDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
      event.preventDefault()
      setActive(pianoKey.midi, true)
    }
  }
  const keyboardUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      setActive(pianoKey.midi, false)
    }
  }
  const pointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    const depth = bounds.height > 0 ? (event.clientY - bounds.top) / bounds.height : 0.65
    const velocity = Math.round(55 + Math.min(1, Math.max(0, depth)) * 72)
    setActive(pianoKey.midi, true, velocity)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const release = () => setActive(pianoKey.midi, false)
  const style = pianoKey.black ? { left: `${pianoKey.blackLeft}%` } : undefined
  return (
    <button
      type="button"
      className={`piano-key ${pianoKey.black ? 'black-key' : 'white-key'}${active ? ' is-pressed' : ''}`}
      style={style}
      aria-label={pianoKey.note}
      aria-pressed={active}
      data-midi={pianoKey.midi}
      onPointerDown={pointerDown}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onKeyDown={keyboardDown}
      onKeyUp={keyboardUp}
      onBlur={release}
    >
      <span className="key-note">{pianoKey.note}</span>
    </button>
  )
}

export function Keyboard({ activeNotes, onNoteOn, onNoteOff }: { activeNotes?: ReadonlySet<number>; onNoteOn?: (midi: number, velocity: number) => void; onNoteOff?: (midi: number) => void } = {}) {
  const [pressed, setPressed] = useState<Set<number>>(new Set())
  const setActive = (midi: number, active: boolean, velocity = 100) => {
    setPressed((current) => {
      const next = new Set(current)
      if (active) next.add(midi)
      else next.delete(midi)
      return next
    })
    if (active) onNoteOn?.(midi, velocity)
    else onNoteOff?.(midi)
  }
  const isActive = (midi: number) => pressed.has(midi) || Boolean(activeNotes?.has(midi))
  return (
    <div className="keyboard" aria-label="73-key E-to-E keyboard">
      <div className="white-keys">
        {KEYS.filter((key) => !key.black).map((key) => <Key key={key.id} pianoKey={key} active={isActive(key.midi)} setActive={setActive} />)}
      </div>
      <div className="black-keys">
        {KEYS.filter((key) => key.black).map((key) => <Key key={key.id} pianoKey={key} active={isActive(key.midi)} setActive={setActive} />)}
      </div>
    </div>
  )
}
