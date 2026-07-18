import { useCallback, useEffect, useRef } from 'react'
import { KEYS, WHITE_KEY_COUNT } from '../hardware/keys'
import { useEngine } from '../state/app-context'
import { KEY_TO_NOTE, MAPPED_VELOCITY, SUSTAIN_KEY } from '../input/keyboard-map'

/**
 * The playable keybed. Pointer (with independent multi-touch via pointerId)
 * and the mapped computer keys funnel into the shared engine lifecycle.
 * Blur, pointer-cancel and unmount all release held notes (cleanup contract).
 */
export function Keybed({ onActiveChange }: { onActiveChange?: (active: ReadonlySet<number>) => void }) {
  const engine = useEngine()
  const heldByPointer = useRef(new Map<number, number>()) // pointerId -> midi
  const heldByKey = useRef(new Set<string>()) // keyboard keys currently down
  const activeNotes = useRef(new Set<number>())

  const markActive = useCallback(() => {
    onActiveChange?.(new Set(activeNotes.current))
  }, [onActiveChange])

  const noteDown = useCallback(
    (midi: number, velocity: number) => {
      activeNotes.current.add(midi)
      engine.noteOn(midi, velocity)
      markActive()
    },
    [engine, markActive],
  )
  const noteUp = useCallback(
    (midi: number) => {
      activeNotes.current.delete(midi)
      engine.noteOff(midi)
      markActive()
    },
    [engine, markActive],
  )

  // Computer keyboard input with repeat suppression and blur cleanup.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return // repeat suppression
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === SUSTAIN_KEY) {
        e.preventDefault()
        engine.setSustain(true)
        return
      }
      const midi = KEY_TO_NOTE.get(k)
      if (midi === undefined || heldByKey.current.has(k)) return
      heldByKey.current.add(k)
      noteDown(midi, MAPPED_VELOCITY)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (k === SUSTAIN_KEY) {
        engine.setSustain(false)
        return
      }
      if (!heldByKey.current.delete(k)) return
      const midi = KEY_TO_NOTE.get(k)
      if (midi !== undefined) noteUp(midi)
    }
    const onBlur = () => {
      for (const k of heldByKey.current) {
        const midi = KEY_TO_NOTE.get(k)
        if (midi !== undefined) noteUp(midi)
      }
      heldByKey.current.clear()
      engine.setSustain(false)
      engine.allNotesOff() // blur cleanup: nothing keeps ringing
      activeNotes.current.clear()
      markActive()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      onBlur()
    }
  }, [engine, noteDown, noteUp, markActive])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>, midi: number) => {
      e.currentTarget.setPointerCapture?.(e.pointerId)
      heldByPointer.current.set(e.pointerId, midi)
      // Vertical position approximates strike velocity: front edge = harder.
      const rect = e.currentTarget.getBoundingClientRect()
      const frac = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.6
      const velocity = Math.min(1, Math.max(0.15, 0.35 + frac * 0.65))
      noteDown(midi, velocity)
    },
    [noteDown],
  )

  const releasePointer = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const midi = heldByPointer.current.get(e.pointerId)
      if (midi === undefined) return
      heldByPointer.current.delete(e.pointerId)
      noteUp(midi)
    },
    [noteUp],
  )

  const whites = KEYS.filter((k) => k.color === 'white')
  const blacks = KEYS.filter((k) => k.color === 'black')

  return (
    <div className="keybed" role="group" aria-label="Keyboard, 73 keys, E1 to E7" data-keybed="">
      {whites.map((k) => (
        <button
          key={k.id}
          type="button"
          className={`key key-white ${activeNotes.current.has(k.midi) ? 'key-down' : ''}`}
          style={{ width: `${100 / WHITE_KEY_COUNT}%` }}
          aria-label={`Piano key ${k.name}`}
          data-key-id={k.id}
          data-midi={k.midi}
          onPointerDown={(e) => onPointerDown(e, k.midi)}
          onPointerUp={releasePointer}
          onPointerCancel={releasePointer}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              if (!heldByKey.current.has(`focus:${k.midi}`)) {
                heldByKey.current.add(`focus:${k.midi}`)
                noteDown(k.midi, MAPPED_VELOCITY)
              }
            }
          }}
          onKeyUp={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && heldByKey.current.delete(`focus:${k.midi}`)) noteUp(k.midi)
          }}
        />
      ))}
      {blacks.map((k) => {
        const left = ((k.whiteIndex + 1) / WHITE_KEY_COUNT) * 100
        return (
          <button
            key={k.id}
            type="button"
            className={`key key-black ${activeNotes.current.has(k.midi) ? 'key-down' : ''}`}
            style={{ left: `${left}%`, width: `${(100 / WHITE_KEY_COUNT) * 0.62}%`, height: '61%' }}
            aria-label={`Piano key ${k.name}`}
            data-key-id={k.id}
            data-midi={k.midi}
            onPointerDown={(e) => onPointerDown(e, k.midi)}
            onPointerUp={releasePointer}
            onPointerCancel={releasePointer}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                if (!heldByKey.current.has(`focus:${k.midi}`)) {
                  heldByKey.current.add(`focus:${k.midi}`)
                  noteDown(k.midi, MAPPED_VELOCITY)
                }
              }
            }}
            onKeyUp={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && heldByKey.current.delete(`focus:${k.midi}`)) noteUp(k.midi)
            }}
          />
        )
      })}
    </div>
  )
}
