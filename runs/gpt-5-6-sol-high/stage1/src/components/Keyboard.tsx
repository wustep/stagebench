import { useState, type KeyboardEvent, type PointerEvent } from 'react'
import { KEYS, type PianoKey } from '../model/hardware'

function Key({ pianoKey, active, setActive }: { pianoKey: PianoKey; active: boolean; setActive: (midi: number, value: boolean) => void }) {
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
    setActive(pianoKey.midi, true)
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

export function Keyboard() {
  const [pressed, setPressed] = useState<Set<number>>(new Set())
  const setActive = (midi: number, active: boolean) => {
    setPressed((current) => {
      const next = new Set(current)
      if (active) next.add(midi)
      else next.delete(midi)
      return next
    })
  }
  return (
    <div className="keyboard" aria-label="73-key E-to-E keyboard">
      <div className="white-keys">
        {KEYS.filter((key) => !key.black).map((key) => <Key key={key.id} pianoKey={key} active={pressed.has(key.midi)} setActive={setActive} />)}
      </div>
      <div className="black-keys">
        {KEYS.filter((key) => key.black).map((key) => <Key key={key.id} pianoKey={key} active={pressed.has(key.midi)} setActive={setActive} />)}
      </div>
    </div>
  )
}
