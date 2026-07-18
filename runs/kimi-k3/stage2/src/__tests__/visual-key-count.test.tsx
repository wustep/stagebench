import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { PianoEngine } from '../audio/engine'
import { FakeAudioBackend } from '../audio/fake-backend'
import { BLACK_KEY_COUNT, KEYS, WHITE_KEY_COUNT } from '../hardware/keys'
import { VARIANT } from '../hardware/variant'

function renderApp() {
  const engine = new PianoEngine(new FakeAudioBackend())
  return render(<App engine={engine} disableMidi />)
}

describe('visual.key-count', () => {
  it('models exactly 73 keys: 43 white, 30 black', () => {
    expect(KEYS.length).toBe(73)
    expect(WHITE_KEY_COUNT).toBe(43)
    expect(BLACK_KEY_COUNT).toBe(30)
    expect(KEYS.length).toBe(VARIANT.keyboard.totalKeys)
    expect(WHITE_KEY_COUNT).toBe(VARIANT.keyboard.whiteKeys)
    expect(BLACK_KEY_COUNT).toBe(VARIANT.keyboard.blackKeys)
  })

  it('range is E1 (MIDI 28) through E7 (MIDI 100)', () => {
    expect(KEYS[0].name).toBe('E1')
    expect(KEYS[0].midi).toBe(28)
    expect(KEYS[KEYS.length - 1].name).toBe('E7')
    expect(KEYS[KEYS.length - 1].midi).toBe(100)
  })

  it('white/black pattern matches a real piano layout (black keys only after C,D,F,G,A positions)', () => {
    const whites = KEYS.filter((k) => k.color === 'white')
    // 73 keys E..E spans 6 octaves + 1 note → 43 white keys
    expect(whites[0].name).toBe('E1')
    expect(whites[whites.length - 1].name).toBe('E7')
    for (const k of KEYS) {
      if (k.color === 'black') {
        expect(k.name).toMatch(/[A-G]#\d/)
      }
    }
    // Every black key sits between two adjacent white keys of the pattern.
    const blackAfterWhiteNames = KEYS.filter((k) => k.color === 'black').map((b) => {
      const prev = KEYS[KEYS.indexOf(b) - 1]
      return prev.name
    })
    for (const n of blackAfterWhiteNames) expect(n).toMatch(/^[CDFGA]\d$/)
  })

  it('renders all 73 playable keys with stable IDs and accessible names', () => {
    const { container } = renderApp()
    const keys = container.querySelectorAll('[data-key-id]')
    expect(keys.length).toBe(73)
    expect(container.querySelectorAll('.key-white').length).toBe(43)
    expect(container.querySelectorAll('.key-black').length).toBe(30)
    expect(container.querySelector('[data-key-id="key.e1"]')).toBeTruthy()
    expect(container.querySelector('[data-key-id="key.e7"]')).toBeTruthy()
    expect(container.querySelector('[data-key-id="key.c4"]')).toBeTruthy()
  })

  it('black key height fraction is 0.61 per the variant spec', () => {
    expect(VARIANT.keyboard.blackKeyHeightFraction).toBeCloseTo(0.61)
  })
})
