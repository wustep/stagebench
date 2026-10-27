import { describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import App from '../App'
import { createMemoryStorage } from '../audio/programStore'
import { VARIANT } from '../hardware/variant'
import { buildKeybed } from '../hardware/keybed'
import { createRecordingEngine } from '../audio/fakes'

/**
 * interaction.keys — pointer/touch/keyboard key press, release, and cancel/blur
 * behaviour, exercised through the real App with an injected recording engine.
 *
 * jsdom has no layout, so `getBoundingClientRect` is stubbed to a fixed keybed box. That
 * is the only geometry the keybed needs: which key a coordinate falls on.
 */

const KEYBED = { left: 0, top: 0, width: 730, height: 200 }

function stubKeybedGeometry() {
  const original = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function rect(this: Element) {
    if (this.classList?.contains('keybed')) {
      return {
        x: KEYBED.left,
        y: KEYBED.top,
        left: KEYBED.left,
        top: KEYBED.top,
        width: KEYBED.width,
        height: KEYBED.height,
        right: KEYBED.left + KEYBED.width,
        bottom: KEYBED.top + KEYBED.height,
        toJSON: () => ({}),
      } as DOMRect
    }
    return original.call(this)
  }
  return () => {
    Element.prototype.getBoundingClientRect = original
  }
}

/** Client coordinates for the centre of a key, in the stubbed keybed box. */
function pointFor(midi: number): { clientX: number; clientY: number } {
  const keys = buildKeybed(VARIANT)
  const key = keys.find((k) => k.midi === midi)
  if (!key) throw new Error(`no key for midi ${midi}`)
  const x = KEYBED.left + (key.left + key.width / 2) * KEYBED.width
  // White keys are struck low on the key; black keys need a shallower y.
  const y = KEYBED.top + (key.color === 'black' ? key.height * 0.5 : 0.75) * KEYBED.height
  return { clientX: x, clientY: y }
}

function pointerDown(el: Element, pointerId: number, midi: number) {
  const { clientX, clientY } = pointFor(midi)
  fireEvent.pointerDown(el, { pointerId, clientX, clientY, button: 0, pointerType: 'touch', bubbles: true })
}

function pointerUp(el: Element, pointerId: number, midi: number) {
  const { clientX, clientY } = pointFor(midi)
  fireEvent.pointerUp(el, { pointerId, clientX, clientY, button: 0, pointerType: 'touch', bubbles: true })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('interaction.keys — pointer', () => {
  it('renders exactly the 73 keys of the variant', () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    const keys = document.querySelectorAll('.piano-key')
    expect(keys).toHaveLength(VARIANT.totalKeys)
    expect(document.querySelectorAll('.key-white')).toHaveLength(VARIANT.whiteKeys)
    expect(document.querySelectorAll('.key-black')).toHaveLength(VARIANT.blackKeys)
  })

  it('starts and stops a voice from pointer down and up', () => {
    const restore = stubKeybedGeometry()
    try {
      const engine = createRecordingEngine()
      render(<App deps={{ engine, programStorage: createMemoryStorage() }} />)
      const keybed = screen.getByTestId('keybed')
      pointerDown(keybed, 1, 60)
      expect(engine.startedVoices.map((v) => v.midi)).toContain(60)
      expect(document.querySelector('[data-midi="60"]')?.classList.contains('is-held')).toBe(true)
      pointerUp(keybed, 1, 60)
      expect(engine.activeVoiceCount()).toBe(0)
      expect(document.querySelector('[data-midi="60"]')?.classList.contains('is-held')).toBe(false)
    } finally {
      restore()
    }
  })

  it('holds two notes from two independent pointers at once', () => {
    const restore = stubKeybedGeometry()
    try {
      const engine = createRecordingEngine()
      render(<App deps={{ engine, programStorage: createMemoryStorage() }} />)
      const keybed = screen.getByTestId('keybed')
      pointerDown(keybed, 1, 52)
      pointerDown(keybed, 2, 76)
      expect(engine.startedVoices.map((v) => v.midi)).toEqual([52, 76])
      expect(engine.activeVoiceCount()).toBe(2)
      // Lifting one finger keeps the other note.
      pointerUp(keybed, 1, 52)
      expect(engine.activeVoiceCount()).toBe(1)
      expect(document.querySelector('[data-midi="76"]')?.classList.contains('is-held')).toBe(true)
      pointerUp(keybed, 2, 76)
      expect(engine.activeVoiceCount()).toBe(0)
    } finally {
      restore()
    }
  })

  it('releases a note on pointer cancel', () => {
    const restore = stubKeybedGeometry()
    try {
      const engine = createRecordingEngine()
      render(<App deps={{ engine, programStorage: createMemoryStorage() }} />)
      const keybed = screen.getByTestId('keybed')
      pointerDown(keybed, 5, 64)
      expect(engine.activeVoiceCount()).toBe(1)
      fireEvent.pointerCancel(keybed, { pointerId: 5, bubbles: true })
      expect(engine.activeVoiceCount()).toBe(0)
    } finally {
      restore()
    }
  })

  it('releases a mouse note when the pointer leaves the keybed', () => {
    const restore = stubKeybedGeometry()
    try {
      const engine = createRecordingEngine()
      render(<App deps={{ engine, programStorage: createMemoryStorage() }} />)
      const keybed = screen.getByTestId('keybed')
      const { clientX, clientY } = pointFor(55)
      fireEvent.pointerDown(keybed, { pointerId: 9, clientX, clientY, button: 0, pointerType: 'mouse', bubbles: true })
      expect(engine.activeVoiceCount()).toBe(1)
      fireEvent.pointerLeave(keybed, { pointerId: 9, pointerType: 'mouse', bubbles: true })
      expect(engine.activeVoiceCount()).toBe(0)
    } finally {
      restore()
    }
  })

  it('glides to the next key without stranding the first note', () => {
    const restore = stubKeybedGeometry()
    try {
      const engine = createRecordingEngine()
      render(<App deps={{ engine, programStorage: createMemoryStorage() }} />)
      const keybed = screen.getByTestId('keybed')
      pointerDown(keybed, 1, 60)
      const next = pointFor(62)
      fireEvent.pointerMove(keybed, { pointerId: 1, clientX: next.clientX, clientY: next.clientY, bubbles: true })
      expect(engine.startedVoices.map((v) => v.midi)).toEqual([60, 62])
      expect(engine.activeVoiceCount()).toBe(1)
    } finally {
      restore()
    }
  })
})

describe('interaction.keys — computer keyboard', () => {
  it('plays a mapped key and stops it on key up', () => {
    const engine = createRecordingEngine()
    render(<App deps={{ engine, programStorage: createMemoryStorage() }} />)
    fireEvent.keyDown(window, { code: 'KeyZ', key: 'z' })
    expect(engine.startedVoices.map((v) => v.midi)).toEqual([48])
    expect(document.querySelector('[data-midi="48"]')?.classList.contains('is-held')).toBe(true)
    fireEvent.keyUp(window, { code: 'KeyZ', key: 'z' })
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('suppresses auto-repeat on a held key', () => {
    const engine = createRecordingEngine()
    render(<App deps={{ engine, programStorage: createMemoryStorage() }} />)
    fireEvent.keyDown(window, { code: 'KeyX', key: 'x' })
    fireEvent.keyDown(window, { code: 'KeyX', key: 'x', repeat: true })
    fireEvent.keyDown(window, { code: 'KeyX', key: 'x', repeat: true })
    expect(engine.startedVoices).toHaveLength(1)
  })

  it('ignores keys while the user is typing in a field', () => {
    const engine = createRecordingEngine()
    render(
      <>
        <App deps={{ engine, programStorage: createMemoryStorage() }} />
        <input aria-label="notes" />
      </>,
    )
    const field = screen.getByLabelText('notes')
    fireEvent.keyDown(field, { code: 'KeyZ', key: 'z', bubbles: true })
    expect(engine.startedVoices).toHaveLength(0)
  })

  it('clears every note and the pedal on window blur', () => {
    const engine = createRecordingEngine()
    render(<App deps={{ engine, programStorage: createMemoryStorage() }} />)
    fireEvent.keyDown(window, { code: 'KeyZ', key: 'z' })
    fireEvent.keyDown(window, { code: 'KeyG', key: 'g' })
    fireEvent.keyDown(window, { code: 'Space', key: ' ' })
    expect(engine.activeVoiceCount()).toBe(2)
    fireEvent.blur(window)
    expect(engine.activeVoiceCount()).toBe(0)
    expect(document.querySelectorAll('.is-held')).toHaveLength(0)
  })

  it('holds the sustain pedal from the space bar', () => {
    const engine = createRecordingEngine()
    render(<App deps={{ engine, programStorage: createMemoryStorage() }} />)
    fireEvent.keyDown(window, { code: 'Space', key: ' ' })
    fireEvent.keyDown(window, { code: 'KeyZ', key: 'z' })
    fireEvent.keyUp(window, { code: 'KeyZ', key: 'z' })
    // Space is still down, so the note is sustained rather than stopped.
    expect(engine.activeVoiceCount()).toBe(1)
    expect(document.querySelector('[data-midi="48"]')?.classList.contains('is-sustained')).toBe(true)
    fireEvent.keyUp(window, { code: 'Space', key: ' ' })
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('ignores shortcuts that include a modifier', () => {
    const engine = createRecordingEngine()
    render(<App deps={{ engine, programStorage: createMemoryStorage() }} />)
    fireEvent.keyDown(window, { code: 'KeyZ', key: 'z', metaKey: true })
    fireEvent.keyDown(window, { code: 'KeyX', key: 'x', ctrlKey: true })
    expect(engine.startedVoices).toHaveLength(0)
  })

  it('stops every voice when the instrument unmounts', () => {
    const engine = createRecordingEngine()
    const view = render(<App deps={{ engine, programStorage: createMemoryStorage() }} />)
    fireEvent.keyDown(window, { code: 'KeyZ', key: 'z' })
    expect(engine.activeVoiceCount()).toBe(1)
    view.unmount()
    expect(engine.activeVoiceCount()).toBe(0)
    expect(engine.liveNodeCount()).toBe(0)
  })

  it('removes its listeners after unmount', () => {
    const engine = createRecordingEngine()
    const view = render(<App deps={{ engine, programStorage: createMemoryStorage() }} />)
    view.unmount()
    fireEvent.keyDown(window, { code: 'KeyZ', key: 'z' })
    expect(engine.startedVoices).toHaveLength(0)
  })
})

describe('interaction.keys — sustain pedal control', () => {
  it('holds and releases sustain from the on-screen pedal', () => {
    const engine = createRecordingEngine()
    render(<App deps={{ engine, programStorage: createMemoryStorage() }} />)
    const pedal = screen.getByTestId('sustain-pedal')
    fireEvent.pointerDown(pedal, { pointerId: 1, button: 0, pointerType: 'mouse' })
    expect(pedal.getAttribute('aria-pressed')).toBe('true')
    fireEvent.keyDown(window, { code: 'KeyZ', key: 'z' })
    fireEvent.keyUp(window, { code: 'KeyZ', key: 'z' })
    // The on-screen pedal is down, so the note sustains after key-up.
    expect(engine.activeVoiceCount()).toBe(1)
    fireEvent.pointerUp(pedal, { pointerId: 1, button: 0, pointerType: 'mouse' })
    expect(pedal.getAttribute('aria-pressed')).toBe('false')
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('stops everything from the panic control', () => {
    const engine = createRecordingEngine()
    render(<App deps={{ engine, programStorage: createMemoryStorage() }} />)
    fireEvent.keyDown(window, { code: 'KeyZ', key: 'z' })
    fireEvent.keyDown(window, { code: 'KeyC', key: 'c' })
    expect(engine.activeVoiceCount()).toBe(2)
    fireEvent.click(document.querySelector('.pedal-panic') ?? document.body)
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('reports status truthfully in the program display when audio is unavailable', () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    const display = screen.getByTestId('program-display')
    expect(display.textContent).toMatch(/NO AUDIO OUTPUT|AUDIO IDLE/i)
    expect(display.textContent).not.toMatch(/AUDIO READY/)
  })
})

describe('interaction.keys — accessibility of the keybed', () => {
  it('exposes every key with a stable id for tests and tooling', () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    const keybed = screen.getByTestId('keybed')
    expect(keybed.getAttribute('data-key-count')).toBe(String(VARIANT.totalKeys))
    const first = document.querySelector('[data-key-id="key.e1"]')
    const last = document.querySelector('[data-key-id="key.e7"]')
    expect(first).not.toBeNull()
    expect(last).not.toBeNull()
    expect(first?.getAttribute('data-color')).toBe('white')
    expect(document.querySelector('[data-key-id="key.c#4"]')?.getAttribute('data-color')).toBe('black')
  })

  it('prints an octave marker on every C', () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    const labels = within(screen.getByTestId('keybed').parentElement as HTMLElement)
      .queryAllByText(/^C\d$/)
      .map((el) => el.textContent)
    expect(labels).toEqual(['C2', 'C3', 'C4', 'C5', 'C6', 'C7'])
  })
})

describe('interaction.keys — panic and re-press', () => {
  it('lets a still-held key strike again after panic', () => {
    const engine = createRecordingEngine()
    render(<App deps={{ engine, programStorage: createMemoryStorage() }} />)
    fireEvent.keyDown(window, { code: 'KeyZ', key: 'z' })
    expect(engine.activeVoiceCount()).toBe(1)
    fireEvent.click(screen.getByTestId('panic'))
    expect(engine.activeVoiceCount()).toBe(0)
    // The key was never released, so the next auto-repeat keydown is a fresh stroke rather
    // than being swallowed by a stale held-key set.
    fireEvent.keyDown(window, { code: 'KeyZ', key: 'z', repeat: true })
    expect(engine.activeVoiceCount()).toBe(1)
  })
})
