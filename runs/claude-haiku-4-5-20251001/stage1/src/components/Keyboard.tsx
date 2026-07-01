import React, { useState, useCallback } from 'react'
import './Keyboard.css'

interface KeyState {
  [noteNumber: number]: boolean
}

/**
 * Generates the white key indices for 88-key A-C layout
 * 88 keys total: A0 (27) to C8 (108)
 * White keys: 52 (A, B, C, D, E, F, G pattern)
 * Black keys: 36 (C#, D#, F#, G#, A# pattern)
 */
function generateWhiteKeyIndices(): number[] {
  const whiteIndices: number[] = []
  // A to C means we start at A0 (MIDI 21) and end at C8 (MIDI 108)
  // But we're counting from 0, so we map MIDI 21-108 to indices 0-87
  // Within each octave: C(0), D(2), E(4), F(5), G(7), A(9), B(11)
  for (let i = 0; i < 88; i++) {
    const midiNote = 21 + i // 21 = A0
    const noteInOctave = midiNote % 12
    // A=9, B=11, C=0, D=2, E=4, F=5, G=7
    // For A-to-C layout: A(yes), B(yes), C(yes), D(yes), E(yes), F(yes), G(yes)
    if ([0, 2, 4, 5, 7, 9, 11].includes(noteInOctave)) {
      whiteIndices.push(i)
    }
  }
  return whiteIndices
}

/**
 * Generates the black key indices
 */
function generateBlackKeyIndices(): number[] {
  const blackIndices: number[] = []
  for (let i = 0; i < 88; i++) {
    const midiNote = 21 + i
    const noteInOctave = midiNote % 12
    // C#=1, D#=3, F#=6, G#=8, A#=10
    if ([1, 3, 6, 8, 10].includes(noteInOctave)) {
      blackIndices.push(i)
    }
  }
  return blackIndices
}

export const Keyboard: React.FC = () => {
  const [pressedKeys, setPressedKeys] = useState<KeyState>({})
  const whiteKeys = generateWhiteKeyIndices()
  const blackKeys = generateBlackKeyIndices()

  const handleKeyDown = useCallback((keyIndex: number) => {
    setPressedKeys((prev) => ({ ...prev, [keyIndex]: true }))
  }, [])

  const handleKeyUp = useCallback((keyIndex: number) => {
    setPressedKeys((prev) => ({ ...prev, [keyIndex]: false }))
  }, [])

  const handleMouseDown = (keyIndex: number) => (e: React.MouseEvent) => {
    e.preventDefault()
    handleKeyDown(keyIndex)
  }

  const handleMouseUp = (keyIndex: number) => (e: React.MouseEvent) => {
    e.preventDefault()
    handleKeyUp(keyIndex)
  }

  // Calculate dimensions
  const whiteKeyWidth = 100 / whiteKeys.length // percentage
  const blackKeyWidth = whiteKeyWidth * 0.6
  const blackKeyHeight = 61 // 61% of white key height

  return (
    <div className="keyboard">
      <div className="keyboard-white-keys">
        {whiteKeys.map((keyIndex, displayIndex) => (
          <button
            key={`white-${keyIndex}`}
            className={`keyboard-key keyboard-white-key ${
              pressedKeys[keyIndex] ? 'pressed' : ''
            }`}
            style={{
              width: `${whiteKeyWidth}%`,
              left: `${displayIndex * whiteKeyWidth}%`,
            }}
            onMouseDown={handleMouseDown(keyIndex)}
            onMouseUp={handleMouseUp(keyIndex)}
            onMouseLeave={() => handleKeyUp(keyIndex)}
            data-midi-note={21 + keyIndex}
            data-key-index={keyIndex}
            aria-label={`Key ${21 + keyIndex}`}
            aria-pressed={!!pressedKeys[keyIndex]}
          />
        ))}
      </div>

      <div className="keyboard-black-keys">
        {blackKeys.map((keyIndex) => {
          // Find the position of this black key relative to white keys
          // Black keys are positioned between white keys
          const whiteIndexBefore = whiteKeys.findIndex((w) => w > keyIndex)
          const whiteIndexAfter = whiteIndexBefore === -1 ? whiteKeys.length : whiteIndexBefore

          // Position black key between two white keys
          const leftPercentage = (whiteIndexAfter - 0.35) * whiteKeyWidth
          const positionStyle = {
            width: `${blackKeyWidth}%`,
            height: `${blackKeyHeight}%`,
            left: `${leftPercentage}%`,
          }

          return (
            <button
              key={`black-${keyIndex}`}
              className={`keyboard-key keyboard-black-key ${
                pressedKeys[keyIndex] ? 'pressed' : ''
              }`}
              style={positionStyle}
              onMouseDown={handleMouseDown(keyIndex)}
              onMouseUp={handleMouseUp(keyIndex)}
              onMouseLeave={() => handleKeyUp(keyIndex)}
              data-midi-note={21 + keyIndex}
              data-key-index={keyIndex}
              aria-label={`Key ${21 + keyIndex}`}
              aria-pressed={!!pressedKeys[keyIndex]}
            />
          )
        })}
      </div>
    </div>
  )
}

export default Keyboard
