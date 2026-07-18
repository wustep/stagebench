import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { PianoEngine } from '../audio/engine'
import { FakeAudioBackend } from '../audio/fake-backend'

function setup() {
  const backend = new FakeAudioBackend()
  const engine = new PianoEngine(backend)
  const utils = render(<App engine={engine} disableMidi />)
  return { backend, engine, ...utils }
}

describe('interaction.keys', () => {
  it('pointer down/up on a key drives note on/off through the lifecycle', () => {
    const { container, engine } = setup()
    const key = container.querySelector('[data-key-id="key.c4"]')!
    fireEvent.pointerDown(key, { pointerId: 1, clientY: 40 })
    expect(engine.getVoices().filter((v) => !v.stopped).length).toBe(1)
    fireEvent.pointerUp(key, { pointerId: 1 })
    const v = engine.getVoices()[0]
    expect(v.releasedAt).not.toBeNull()
  })

  it('pointer cancel releases the note (no stuck keys)', () => {
    const { container, engine } = setup()
    const key = container.querySelector('[data-key-id="key.e1"]')!
    fireEvent.pointerDown(key, { pointerId: 7, clientY: 40 })
    expect(engine.getVoices().length).toBe(1)
    fireEvent.pointerCancel(key, { pointerId: 7 })
    expect(engine.getVoices()[0].releasedAt).not.toBeNull()
  })

  it('keyboard-operated key (Enter) plays and releases', () => {
    const { container, engine } = setup()
    const key = container.querySelector('[data-key-id="key.g3"]')!
    fireEvent.keyDown(key, { key: 'Enter' })
    expect(engine.getVoices().filter((v) => !v.stopped).length).toBe(1)
    fireEvent.keyUp(key, { key: 'Enter' })
    expect(engine.getVoices()[0].releasedAt).not.toBeNull()
  })

  it('blur on the window releases every held note and calls all-notes-off', () => {
    const { container, engine } = setup()
    const k1 = container.querySelector('[data-key-id="key.c4"]')!
    const k2 = container.querySelector('[data-key-id="key.e4"]')!
    fireEvent.pointerDown(k1, { pointerId: 1, clientY: 40 })
    fireEvent.pointerDown(k2, { pointerId: 2, clientY: 40 })
    expect(engine.getVoices().length).toBe(2)
    fireEvent.blur(window)
    expect(engine.getVoices().length).toBe(0)
  })
})
