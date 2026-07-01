import { Fragment, useState, useCallback } from 'react'
import type { KeyModel } from '../types'
import type { InputHandler } from '../audio/inputHandler'
import './Keyboard.css'

interface KeyboardProps {
  model: KeyModel
  inputHandler?: InputHandler
}

// White key pattern: W = white, B = black key follows
// E F G A B C D pattern (repeats)
const getKeyPattern = (totalKeys: number): string => {
  const patterns: Record<number, string> = {
    73: 'WBWBWWBWBWBWWB', // 73 keys starting at E
  }
  return patterns[totalKeys] || 'W'.repeat(totalKeys)
}

export default function Keyboard({ model, inputHandler }: KeyboardProps) {
  const [pressedKeys, setPressedKeys] = useState<Set<number>>(new Set())
  const pattern = getKeyPattern(model.totalKeys)

  // Create piano keys from pattern
  const keys = []
  let keyIndex = 0

  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === 'W') {
      keys.push({
        index: keyIndex,
        isWhite: true,
        hasBlackAfter: i + 1 < pattern.length && pattern[i + 1] === 'B',
      })
      keyIndex++
    }
  }

  const handleKeyDown = useCallback((index: number, event?: React.PointerEvent<HTMLButtonElement>) => {
    setPressedKeys(prev => new Set(prev).add(index))

    if (inputHandler && event) {
      const noteNumber = keyIndexToMidi(index)
      const velocity = event ? pointerYToVelocity(event.nativeEvent as PointerEvent) : 0.7
      const sourceId = `pointer-${index}`

      // Access the noteLifecycle through inputHandler
      const noteLifecycle = (inputHandler as any).noteLifecycle
      if (noteLifecycle) {
        noteLifecycle.noteOn(noteNumber, velocity, sourceId)
      }
    }
  }, [inputHandler])

  const handleKeyUp = useCallback((index: number) => {
    setPressedKeys(prev => {
      const next = new Set(prev)
      next.delete(index)
      return next
    })

    if (inputHandler) {
      const sourceId = `pointer-${index}`
      const noteLifecycle = (inputHandler as any).noteLifecycle
      if (noteLifecycle) {
        noteLifecycle.noteOff(sourceId)
      }
    }
  }, [inputHandler])

  return (
    <div className="keyboard-container" role="group" aria-label={`${model.totalKeys}-key piano keyboard`}>
      {keys.map(key => (
        <Fragment key={key.index}>
          <button
            className={`key white-key ${pressedKeys.has(key.index) ? 'pressed' : ''}`}
            onPointerDown={(e) => handleKeyDown(key.index, e)}
            onPointerUp={() => handleKeyUp(key.index)}
            onPointerLeave={() => handleKeyUp(key.index)}
            aria-label={`White key ${key.index}`}
            type="button"
          />
          {key.hasBlackAfter && (
            <button
              className={`key black-key ${pressedKeys.has(key.index + 0.5) ? 'pressed' : ''}`}
              onPointerDown={(e) => handleKeyDown(key.index + 0.5, e)}
              onPointerUp={() => handleKeyUp(key.index + 0.5)}
              onPointerLeave={() => handleKeyUp(key.index + 0.5)}
              aria-label={`Black key ${key.index}`}
              type="button"
            />
          )}
        </Fragment>
      ))}
    </div>
  )
}

// Helper functions
function keyIndexToMidi(keyIndex: number): number {
  // Map white key index to MIDI note
  // 73 keys starting at E (MIDI 40)
  // Pattern: E, F#, G#, A#, B, C#, D# repeats (white keys only)
  const baseNote = 40 // E4
  const pattern = [0, 2, 4, 5, 7, 9, 11] // E, F, G, A, B, C, D

  const octave = Math.floor(keyIndex / 7)
  const noteInOctave = keyIndex % 7
  return baseNote + octave * 12 + pattern[noteInOctave]
}

function pointerYToVelocity(event: PointerEvent): number {
  const target = event.target as HTMLElement
  const rect = target.getBoundingClientRect()
  const relativeY = event.clientY - rect.top
  const normalized = 1 - relativeY / rect.height // Invert: top = 1, bottom = 0
  const clamped = Math.max(0.3, Math.min(1, normalized)) // Clamp to 0.3-1 range
  return clamped
}
