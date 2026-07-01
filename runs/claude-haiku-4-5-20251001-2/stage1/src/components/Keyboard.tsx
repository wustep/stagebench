import { Fragment, useState } from 'react'
import type { KeyModel } from '../types'
import './Keyboard.css'

interface KeyboardProps {
  model: KeyModel
}

// White key pattern: W = white, B = black key follows
// E F G A B C D pattern (repeats)
const getKeyPattern = (totalKeys: number): string => {
  const patterns: Record<number, string> = {
    73: 'WBWBWWBWBWBWWB', // 73 keys starting at E
  }
  return patterns[totalKeys] || 'W'.repeat(totalKeys)
}

export default function Keyboard({ model }: KeyboardProps) {
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

  const handleKeyDown = (index: number) => {
    setPressedKeys(prev => new Set(prev).add(index))
  }

  const handleKeyUp = (index: number) => {
    setPressedKeys(prev => {
      const next = new Set(prev)
      next.delete(index)
      return next
    })
  }

  return (
    <div className="keyboard-container" role="group" aria-label={`${model.totalKeys}-key piano keyboard`}>
      {keys.map(key => (
        <Fragment key={key.index}>
          <button
            className={`key white-key ${pressedKeys.has(key.index) ? 'pressed' : ''}`}
            onMouseDown={() => handleKeyDown(key.index)}
            onMouseUp={() => handleKeyUp(key.index)}
            onMouseLeave={() => handleKeyUp(key.index)}
            aria-label={`White key ${key.index}`}
            type="button"
          />
          {key.hasBlackAfter && (
            <button
              className={`key black-key ${pressedKeys.has(key.index + 0.5) ? 'pressed' : ''}`}
              onMouseDown={() => handleKeyDown(key.index + 0.5)}
              onMouseUp={() => handleKeyUp(key.index + 0.5)}
              onMouseLeave={() => handleKeyUp(key.index + 0.5)}
              aria-label={`Black key ${key.index}`}
              type="button"
            />
          )}
        </Fragment>
      ))}
    </div>
  )
}
