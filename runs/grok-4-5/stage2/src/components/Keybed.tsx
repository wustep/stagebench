import { useCallback, useRef, type CSSProperties } from 'react'
import { KEYBED, VARIANT } from '../model/variant'
import { useIsKeyPressed } from '../state/hardware-store'
import { hardwareStore } from '../state/hardware-store'
import type { PianoEngine } from '../audio/piano-engine'

interface Props {
  engine: PianoEngine
}

function Key({
  midi,
  name,
  color,
  whiteIndex,
  onDown,
  onUp,
}: {
  midi: number
  name: string
  color: 'white' | 'black'
  whiteIndex: number
  onDown: (midi: number, velocity: number, pointerId: number) => void
  onUp: (midi: number, pointerId: number) => void
}) {
  const pressed = useIsKeyPressed(midi)
  const whiteCount = VARIANT.keyboard.whiteKeys
  const widthPct = 100 / whiteCount

  // Black key horizontal placement: offset from white key left edge
  const blackOffsets: Record<number, number> = {
    1: 0.65, // C#
    3: 1.7, // D#
    6: 3.65, // F#
    8: 4.7, // G#
    10: 5.75, // A#
  }
  const pc = midi % 12
  // Find white key index of the white key to the left
  let style: CSSProperties
  if (color === 'white') {
    style = {
      left: `${whiteIndex * widthPct}%`,
      width: `${widthPct}%`,
    }
  } else {
    // Position relative to previous white key
    const leftWhite = whiteIndex
    const offset = blackOffsets[pc] ?? 0.7
    // offset is in white-key units within the octave-ish; use simpler approach:
    // black key sits between whiteIndex and whiteIndex+1
    style = {
      left: `calc(${leftWhite * widthPct}% + ${widthPct * 0.65}%)`,
      width: `${widthPct * 0.62}%`,
    }
    void offset
  }

  return (
    <button
      type="button"
      id={`key-${midi}`}
      data-key-midi={midi}
      data-key-color={color}
      data-key-name={name}
      className={`piano-key ${color}${pressed ? ' is-pressed' : ''}`}
      style={style}
      aria-label={`${name} key`}
      aria-pressed={pressed}
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture?.(e.pointerId)
        const rect = e.currentTarget.getBoundingClientRect()
        const y = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5
        const velocity = Math.max(0.2, Math.min(1, 0.4 + y * 0.6))
        onDown(midi, velocity, e.pointerId)
      }}
      onPointerUp={(e) => {
        onUp(midi, e.pointerId)
      }}
      onPointerCancel={(e) => {
        onUp(midi, e.pointerId)
      }}
      onLostPointerCapture={(e) => {
        onUp(midi, e.pointerId)
      }}
    />
  )
}

export function Keybed({ engine }: Props) {
  // pointerId → { midi, noteId }
  const activePointers = useRef(new Map<number, { midi: number; noteId: string }>())
  // midi → noteId for keyboard/midi path tracked externally; pointer path here
  const pointerNotes = useRef(new Map<number, string>())

  const onDown = useCallback(
    (midi: number, velocity: number, pointerId: number) => {
      // Allow independent multi-touch: each pointer tracks its own note
      if (activePointers.current.has(pointerId)) return
      const noteId = engine.noteOn(midi, velocity, `pointer-${pointerId}`)
      if (!noteId) return
      activePointers.current.set(pointerId, { midi, noteId })
      pointerNotes.current.set(midi, noteId)
      hardwareStore.setKeyPressed(midi, true)
    },
    [engine],
  )

  const onUp = useCallback(
    (midi: number, pointerId: number) => {
      const entry = activePointers.current.get(pointerId)
      if (!entry) return
      activePointers.current.delete(pointerId)
      engine.noteOff(entry.noteId)
      // Only un-press visual if no other pointer holds this midi
      let stillHeld = false
      for (const v of activePointers.current.values()) {
        if (v.midi === midi) stillHeld = true
      }
      if (!stillHeld) {
        hardwareStore.setKeyPressed(midi, false)
        pointerNotes.current.delete(midi)
      }
    },
    [engine],
  )

  return (
    <div
      className="keybed"
      data-testid="keybed"
      data-key-count={VARIANT.keyboard.totalKeys}
      data-white-keys={VARIANT.keyboard.whiteKeys}
      data-black-keys={VARIANT.keyboard.blackKeys}
      data-range={VARIANT.keyboard.range}
      role="group"
      aria-label={`Piano keybed ${VARIANT.keyboard.range}, ${VARIANT.keyboard.totalKeys} keys`}
    >
      <div className="keybed-inner">
        {KEYBED.filter((k) => k.color === 'white').map((k) => (
          <Key
            key={k.id}
            midi={k.midi}
            name={k.name}
            color="white"
            whiteIndex={k.whiteIndex}
            onDown={onDown}
            onUp={onUp}
          />
        ))}
        {KEYBED.filter((k) => k.color === 'black').map((k) => (
          <Key
            key={k.id}
            midi={k.midi}
            name={k.name}
            color="black"
            whiteIndex={k.whiteIndex}
            onDown={onDown}
            onUp={onUp}
          />
        ))}
      </div>
    </div>
  )
}
