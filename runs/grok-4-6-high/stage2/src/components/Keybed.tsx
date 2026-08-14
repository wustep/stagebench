import type { PointerEvent } from 'react'
import { BLACK_KEYS, KEYBED, WHITE_KEYS, blackKeyLeftPercent } from '../model/keys'
import { VARIANT } from '../model/variant'
import { useInstrument, usePointerMap } from '../state/instrument-context'

function velocityFromPointer(event: PointerEvent<HTMLElement>): number {
  const rect = event.currentTarget.getBoundingClientRect()
  const height = rect.height || 1
  const y = (event.clientY - rect.top) / height
  return Math.min(1, Math.max(0.12, 0.18 + y * 0.82))
}

export function Keybed() {
  const { pressed, noteOn, noteOff } = useInstrument()
  const pointers = usePointerMap()
  const blackWidth = 58

  function down(event: PointerEvent<HTMLButtonElement>, midi: number) {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    pointers.current.set(event.pointerId, midi)
    noteOn(midi, velocityFromPointer(event))
  }

  function up(event: PointerEvent<HTMLButtonElement>) {
    const midi = pointers.current.get(event.pointerId)
    if (midi == null) return
    pointers.current.delete(event.pointerId)
    noteOff(midi)
  }

  return (
    <div
      className="keybed"
      data-key-count={VARIANT.totalKeys}
      data-white-keys={VARIANT.whiteKeys}
      data-black-keys={VARIANT.blackKeys}
      data-range={VARIANT.rangeLabel}
      aria-label={`Keybed ${VARIANT.rangeLabel}, ${VARIANT.totalKeys} keys`}
    >
      <div className="white-row">
        {WHITE_KEYS.map((key) => (
          <button
            key={key.id}
            type="button"
            id={key.id}
            data-key={key.midi}
            data-key-color="white"
            className={`key key-white ${pressed.has(key.midi) ? 'is-down' : ''}`}
            aria-label={key.name}
            aria-pressed={pressed.has(key.midi)}
            onPointerDown={(event) => down(event, key.midi)}
            onPointerUp={up}
            onPointerCancel={up}
          />
        ))}
      </div>
      <div className="black-row">
        {BLACK_KEYS.map((key) => (
          <button
            key={key.id}
            type="button"
            id={key.id}
            data-key={key.midi}
            data-key-color="black"
            className={`key key-black ${pressed.has(key.midi) ? 'is-down' : ''}`}
            aria-label={key.name}
            aria-pressed={pressed.has(key.midi)}
            style={{
              left: `${blackKeyLeftPercent(key, blackWidth / 100)}%`,
              width: `${(100 / WHITE_KEYS.length) * (blackWidth / 100)}%`,
              height: `${VARIANT.blackKeyHeightFraction * 100}%`,
            }}
            onPointerDown={(event) => down(event, key.midi)}
            onPointerUp={up}
            onPointerCancel={up}
          />
        ))}
      </div>
      <span className="sr-only">{KEYBED.length} keys from {VARIANT.rangeLabel}</span>
    </div>
  )
}
