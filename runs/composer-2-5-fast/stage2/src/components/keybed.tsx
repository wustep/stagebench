import { useCallback, useRef } from 'react'
import { KEYBED } from '../model/keyboard'
import type { InstrumentApi } from '../state/instrument'

interface KeybedProps {
  instrument: InstrumentApi
}

export function Keybed({ instrument }: KeybedProps) {
  const activePointers = useRef(new Map<number, number>())

  const handlePointerDown = useCallback((midi: number, e: React.PointerEvent) => {
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    if ('setPointerCapture' in el && typeof el.setPointerCapture === 'function') {
      el.setPointerCapture(e.pointerId)
    }
    activePointers.current.set(e.pointerId, midi)
    const rect = el.getBoundingClientRect()
    const y = e.clientY - rect.top
    const velocity = Math.round(40 + (1 - y / rect.height) * 87)
    instrument.keyPointerDown(midi, Math.min(127, Math.max(1, velocity)))
  }, [instrument])

  const handlePointerUp = useCallback((midi: number, e: React.PointerEvent) => {
    if (activePointers.current.get(e.pointerId) === midi) {
      activePointers.current.delete(e.pointerId)
      instrument.keyPointerUp(midi)
    }
  }, [instrument])

  const whiteKeys = KEYBED.filter((k) => k.color === 'white')
  const blackKeys = KEYBED.filter((k) => k.color === 'black')

  return (
    <div className="keybed" data-testid="keybed" aria-label="73-key keyboard E1 to E7">
      <div className="keybed-whites" style={{ gridTemplateColumns: `repeat(${whiteKeys.length}, 1fr)` }}>
        {whiteKeys.map((key) => (
          <button
            key={key.id}
            type="button"
            className={`key key--white ${instrument.pressedKeys.has(key.midi) ? 'is-pressed' : ''}`}
            data-key-id={key.id}
            data-midi={key.midi}
            aria-label={`${key.noteName} key`}
            aria-pressed={instrument.pressedKeys.has(key.midi)}
            onPointerDown={(e) => handlePointerDown(key.midi, e)}
            onPointerUp={(e) => handlePointerUp(key.midi, e)}
            onPointerCancel={(e) => handlePointerUp(key.midi, e)}
            onPointerLeave={(e) => {
              if (e.buttons === 0) handlePointerUp(key.midi, e)
            }}
          />
        ))}
      </div>
      <div className="keybed-blacks">
        {blackKeys.map((key) => {
          const whiteIndex = KEYBED.findIndex((k) => k.midi === key.midi)
          let whiteBefore = 0
          for (let i = 0; i < whiteIndex; i++) {
            if (KEYBED[i]!.color === 'white') whiteBefore++
          }
          const left = ((whiteBefore + 0.72) / whiteKeys.length) * 100
          return (
            <button
              key={key.id}
              type="button"
              className={`key key--black ${instrument.pressedKeys.has(key.midi) ? 'is-pressed' : ''}`}
              data-key-id={key.id}
              data-midi={key.midi}
              style={{ left: `${left}%`, width: `${(0.58 / whiteKeys.length) * 100}%` }}
              aria-label={`${key.noteName} key`}
              aria-pressed={instrument.pressedKeys.has(key.midi)}
              onPointerDown={(e) => handlePointerDown(key.midi, e)}
              onPointerUp={(e) => handlePointerUp(key.midi, e)}
              onPointerCancel={(e) => handlePointerUp(key.midi, e)}
              onPointerLeave={(e) => {
                if (e.buttons === 0) handlePointerUp(key.midi, e)
              }}
            />
          )
        })}
      </div>
    </div>
  )
}
