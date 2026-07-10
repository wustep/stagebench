import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PianoEngine } from '../src/audio/piano-engine'
import { Instrument } from '../src/components/Instrument'
import { createMockContextFactory } from '../src/test/mock-audio'
import { hardwareStore } from '../src/state/hardware-store'
import { attachKeyboardInput } from '../src/input/keyboard'

describe('interaction.keys', () => {
  afterEach(() => {
    cleanup()
    hardwareStore.reset()
    vi.restoreAllMocks()
  })

  it('presses and releases keys via pointer with visual state', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    render(<Instrument engine={engine} enableMidi={false} />)

    const key = document.querySelector('[data-key-midi="60"]') as HTMLElement
    expect(key).toBeTruthy()
    fireEvent.pointerDown(key, { pointerId: 1, clientY: 10 })
    expect(key).toHaveClass('is-pressed')
    expect(engine.getActiveVoiceCount()).toBeGreaterThan(0)
    fireEvent.pointerUp(key, { pointerId: 1 })
    // voice may still be releasing
    expect(hardwareStore.isKeyPressed(60)).toBe(false)
  })

  it('handles pointer cancel', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    render(<Instrument engine={engine} enableMidi={false} />)
    const key = document.querySelector('[data-key-midi="64"]') as HTMLElement
    fireEvent.pointerDown(key, { pointerId: 2, clientY: 20 })
    expect(hardwareStore.isKeyPressed(64)).toBe(true)
    fireEvent.pointerCancel(key, { pointerId: 2 })
    expect(hardwareStore.isKeyPressed(64)).toBe(false)
  })

  it('supports independent multi-touch on two keys', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    render(<Instrument engine={engine} enableMidi={false} />)
    const k1 = document.querySelector('[data-key-midi="60"]') as HTMLElement
    const k2 = document.querySelector('[data-key-midi="64"]') as HTMLElement
    fireEvent.pointerDown(k1, { pointerId: 10, clientY: 10 })
    fireEvent.pointerDown(k2, { pointerId: 11, clientY: 10 })
    expect(hardwareStore.isKeyPressed(60)).toBe(true)
    expect(hardwareStore.isKeyPressed(64)).toBe(true)
    expect(engine.getActiveVoiceCount()).toBe(2)
    fireEvent.pointerUp(k1, { pointerId: 10 })
    expect(hardwareStore.isKeyPressed(60)).toBe(false)
    expect(hardwareStore.isKeyPressed(64)).toBe(true)
  })

  it('maps computer keys with repeat suppression and blur cleanup', () => {
    const onNoteOn = vi.fn()
    const onNoteOff = vi.fn()
    const onSustain = vi.fn()
    const detach = attachKeyboardInput({ onNoteOn, onNoteOff, onSustain })

    fireEvent.keyDown(window, { code: 'KeyA', repeat: false })
    fireEvent.keyDown(window, { code: 'KeyA', repeat: true })
    expect(onNoteOn).toHaveBeenCalledTimes(1)

    fireEvent.keyUp(window, { code: 'KeyA' })
    expect(onNoteOff).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(window, { code: 'KeyA', repeat: false })
    fireEvent.blur(window)
    expect(onNoteOff.mock.calls.length).toBeGreaterThanOrEqual(2)
    detach()
  })
})
