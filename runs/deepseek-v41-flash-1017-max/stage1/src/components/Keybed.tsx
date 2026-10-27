import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { KeySpec } from '../hardware/keybed'

/**
 * The keybed.
 *
 * Each pointer is tracked independently by `pointerId`, so a touch on the low register
 * and a touch on the high register can hold two notes at once without either pointer
 * stealing the other's. Pointer capture is intentionally *not* used: a glissando must
 * move across keys, which needs the element under the finger, not the element the
 * gesture started on.
 */

export interface KeybedProps {
  keys: KeySpec[]
  /** Velocity response curve is applied upstream; this is the raw pointer-derived velocity. */
  onPress: (midi: number, velocity: number, pointerId: number) => void
  onRelease: (midi: number, pointerId: number) => void
  /** Notes currently held by any source, for the lit-key presentation. */
  held: Set<number>
  /** Notes sounding through sustain, shown in a dimmer state. */
  sustained: Set<number>
  lowestMidi: number
  highestMidi: number
}

interface PointerTrack {
  midi: number
  startY: number
  moved: boolean
}

export function Keybed({ keys, onPress, onRelease, held, sustained, lowestMidi, highestMidi }: KeybedProps) {
  const tracks = useRef(new Map<number, PointerTrack>())
  const keybedRef = useRef<HTMLDivElement | null>(null)

  const keyAtPoint = useCallback(
    (clientX: number, clientY: number): KeySpec | null => {
      const root = keybedRef.current
      if (!root) return null
      const rect = root.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return null
      const x = (clientX - rect.left) / rect.width
      const y = (clientY - rect.top) / rect.height
      if (x < 0 || x > 1 || y < 0 || y > 1) return null
      // Black keys sit on top: test them first so a touch on a raised key is a sharp.
      let blackHit: KeySpec | null = null
      let whiteHit: KeySpec | null = null
      for (const key of keys) {
        if (x < key.left || x > key.left + key.width) continue
        if (key.color === 'black') {
          if (y <= key.height) return key
          blackHit = key
        } else if (!whiteHit) {
          whiteHit = key
        }
      }
      return blackHit && y <= blackHit.height ? blackHit : whiteHit
    },
    [keys],
  )

  /** Velocity from where the key was struck: the front of the key reads as a softer stroke. */
  const velocityAtPoint = useCallback((clientY: number): number => {
    const root = keybedRef.current
    if (!root) return 0.72
    const rect = root.getBoundingClientRect()
    if (rect.height === 0) return 0.72
    const depth = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height))
    // Struck near the front (deep) = firmer; near the back (shallow) = lighter.
    return Math.min(1, Math.max(0.18, 0.34 + depth * 0.62))
  }, [])

  const press = useCallback(
    (pointerId: number, clientX: number, clientY: number) => {
      const key = keyAtPoint(clientX, clientY)
      if (!key) return
      const existing = tracks.current.get(pointerId)
      if (existing && existing.midi === key.midi) return
      if (existing) onRelease(existing.midi, pointerId)
      tracks.current.set(pointerId, { midi: key.midi, startY: clientY, moved: false })
      onPress(key.midi, velocityAtPoint(clientY), pointerId)
    },
    [keyAtPoint, onPress, onRelease, velocityAtPoint],
  )

  const lift = useCallback(
    (pointerId: number, clientX?: number, clientY?: number) => {
      const existing = tracks.current.get(pointerId)
      if (!existing) return
      tracks.current.delete(pointerId)
      // A glissando that leaves the keybed releases the note it was on.
      void clientX
      void clientY
      onRelease(existing.midi, pointerId)
    },
    [onRelease],
  )

  useEffect(() => {
    const map = tracks.current
    return () => {
      // Unmount cleanup: every pointer this keybed owned is released.
      for (const [pointerId, track] of map) onRelease(track.midi, pointerId)
      map.clear()
    }
  }, [onRelease])

  const keyElements = useMemo(
    () =>
      keys.map((key) => ({
        key,
        style: {
          left: `${key.left * 100}%`,
          width: `${key.width * 100}%`,
          height: `${key.height * 100}%`,
        } as React.CSSProperties,
      })),
    [keys],
  )

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // The keybed itself is one focusable widget: arrows audition individual keys.
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      const step = event.key === 'ArrowRight' ? 1 : -1
      const current = Number(event.currentTarget.dataset.auditionMidi ?? lowestMidi)
      const next = Math.min(highestMidi, Math.max(lowestMidi, current + step))
      event.currentTarget.dataset.auditionMidi = String(next)
      const el = event.currentTarget.querySelector<HTMLElement>(`[data-midi="${next}"]`)
      el?.focus()
    }
  }

  return (
    <div
      className="keybed"
      ref={keybedRef}
      data-testid="keybed"
      data-lowest-midi={lowestMidi}
      data-highest-midi={highestMidi}
      data-key-count={keys.length}
      onPointerDown={(event) => {
        // Pointer events on the keybed root cover the whole surface; individual keys
        // are presentation only so a glissando never loses the pointer.
        event.preventDefault()
        press(event.pointerId, event.clientX, event.clientY)
      }}
      onPointerMove={(event) => {
        if (!tracks.current.has(event.pointerId)) return
        const track = tracks.current.get(event.pointerId)!
        if (!track.moved) {
          if (Math.abs(event.clientY - track.startY) < 3) {
            // Moving across keys is a glissando; moving down is pressure, which the
            // pointer-derived velocity already sampled at strike time.
            const key = keyAtPoint(event.clientX, event.clientY)
            if (!key || key.midi === track.midi) return
          }
          track.moved = true
        }
        press(event.pointerId, event.clientX, event.clientY)
      }}
      onPointerUp={(event) => lift(event.pointerId, event.clientX, event.clientY)}
      onPointerCancel={(event) => lift(event.pointerId)}
      onPointerLeave={(event) => {
        // A mouse leaving the keybed while held must not strand a note; touch is
        // unaffected because it only leaves when the finger really goes away.
        if (event.pointerType === 'mouse') lift(event.pointerId)
      }}
      onLostPointerCapture={(event) => lift(event.pointerId)}
      onKeyDown={handleKeyDown}
      style={{ touchAction: 'none' }}
    >
      {keyElements.map(({ key, style }) => {
        const isHeld = held.has(key.midi)
        const isSustained = !isHeld && sustained.has(key.midi)
        return (
          <div
            key={key.id}
            className={`piano-key key-${key.color} ${isHeld ? 'is-held' : ''} ${isSustained ? 'is-sustained' : ''}`}
            style={style}
            data-key-id={key.id}
            data-midi={key.midi}
            data-color={key.color}
            data-note={key.name}
            aria-hidden="true"
          />
        )
      })}
      <div className="keybed-legend" aria-hidden="true">
        {keyElements
          .filter(({ key }) => key.isC)
          .map(({ key }) => (
            <span key={`label-${key.id}`} className="octave-label" style={{ left: `${key.left * 100}%`, width: `${key.width * 100}%` }}>
              {key.name}
            </span>
          ))}
      </div>
    </div>
  )
}
