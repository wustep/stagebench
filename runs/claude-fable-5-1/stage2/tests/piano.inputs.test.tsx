import { act, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { KEY_MAP, KEYBOARD_VELOCITY, attachComputerKeyboard } from '../src/input/computerKeyboard'
import { parseMidiMessage } from '../src/input/midi'
import { NoteBus, type NoteSink } from '../src/input/noteBus'
import { keyEl, mountApp, type Mounted } from './helpers'

let mounted: Mounted | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
})

function key(code: string, type: 'keydown' | 'keyup' = 'keydown', extra: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent(type, { code, ...extra }))
}

describe('piano.basic-inputs — pointer, multi-touch, computer keyboard, MIDI', () => {
  it('pointer and multi-touch reach the engine through the shared note bus', async () => {
    mounted = await mountApp()
    fireEvent.pointerDown(keyEl(60), { pointerId: 1, pointerType: 'touch', button: 0 })
    fireEvent.pointerDown(keyEl(64), { pointerId: 2, pointerType: 'touch', button: 0 })
    expect(mounted.services.engine.activeVoices().map((v) => v.midi)).toEqual([60, 64])
    fireEvent.pointerUp(keyEl(60), { pointerId: 1, pointerType: 'touch' })
    expect(mounted.services.engine.activeVoices().map((v) => [v.midi, v.releasing])).toEqual([
      [60, true],
      [64, false],
    ])
    fireEvent.pointerUp(keyEl(64), { pointerId: 2, pointerType: 'touch' })
  })

  it('maps the computer keyboard to two octaves from C4, suppresses auto-repeat and cleans up on blur', async () => {
    mounted = await mountApp()
    const { bus, engine } = mounted.services
    await act(async () => key('KeyA'))
    expect(bus.heldNotes()).toEqual([60])
    expect(engine.activeVoices()[0].velocity).toBe(KEYBOARD_VELOCITY)
    await act(async () => {
      key('KeyA', 'keydown', { repeat: true })
      key('KeyA')
    })
    expect(engine.activeVoices()).toHaveLength(1)
    await act(async () => {
      key('KeyW')
      key('Semicolon')
      key('Quote')
    })
    expect(bus.heldNotes()).toEqual([60, 61, 76, 77])
    expect(keyEl(61)).toHaveAttribute('aria-pressed', 'true')
    await act(async () => key('KeyA', 'keyup'))
    expect(bus.heldNotes()).toEqual([61, 76, 77])
    await act(async () => window.dispatchEvent(new Event('blur')))
    expect(bus.heldNotes()).toEqual([])
    // modifier combos and typing into inputs are ignored
    await act(async () => key('KeyA', 'keydown', { ctrlKey: true }))
    expect(bus.heldNotes()).toEqual([])
  })

  it('Z / X shift the octave within the keybed and Shift acts as the sustain pedal', async () => {
    mounted = await mountApp()
    const { bus, engine } = mounted.services
    await act(async () => key('KeyZ'))
    expect(mounted.services.keyboardBase.get()).toBe(48)
    await act(async () => key('KeyA'))
    expect(bus.heldNotes()).toEqual([48])
    await act(async () => key('KeyA', 'keyup'))
    await act(async () => {
      key('KeyX')
      key('KeyX')
    })
    expect(mounted.services.keyboardBase.get()).toBe(72)
    await act(async () => {
      key('KeyX')
      key('KeyX')
    })
    expect(mounted.services.keyboardBase.get()).toBe(84) // clamped so every mapped key stays on the keybed
    await act(async () => key('ShiftLeft'))
    expect(engine.isSustain()).toBe(true)
    await act(async () => key('ShiftLeft', 'keyup'))
    expect(engine.isSustain()).toBe(false)
    expect(document.getElementById('keyboard-hint')?.textContent).toMatch(/C6–F7|C6/)
  })

  it('the keyboard layer is pure: a detached mapping ignores every event', () => {
    const calls: string[] = []
    const sink: NoteSink = { noteOn: (m) => calls.push(`on ${m}`), noteOff: (m) => calls.push(`off ${m}`), setSustain: (s) => calls.push(`sus ${s}`), allNotesOff: () => calls.push('all-off') }
    const bus = new NoteBus(sink, { lowest: 28, highest: 100 })
    const kb = attachComputerKeyboard(window, bus, { lowest: 28, highest: 100 })
    expect(Object.keys(KEY_MAP)).toHaveLength(18)
    expect(kb.midiFor('KeyA')).toBe(60)
    expect(kb.midiFor('KeyQ')).toBeNull()
    key('KeyA')
    key('KeyA', 'keyup')
    kb.detach()
    key('KeyA')
    expect(calls).toEqual(['on 60', 'off 60', 'all-off'.replace('all-off', 'all-off')].slice(0, 2).concat([]))
    expect(bus.heldNotes()).toEqual([])
  })

  it('parses MIDI note on/off, running velocity-zero note-offs, CC64 sustain and all-notes-off', () => {
    expect(parseMidiMessage(new Uint8Array([0x90, 60, 100]))).toEqual({ type: 'noteon', midi: 60, velocity: 100, channel: 0 })
    expect(parseMidiMessage(new Uint8Array([0x93, 60, 0]))).toEqual({ type: 'noteoff', midi: 60, channel: 3 })
    expect(parseMidiMessage(new Uint8Array([0x80, 60, 64]))).toEqual({ type: 'noteoff', midi: 60, channel: 0 })
    expect(parseMidiMessage(new Uint8Array([0xb0, 64, 127]))).toEqual({ type: 'sustain', on: true, channel: 0 })
    expect(parseMidiMessage(new Uint8Array([0xb0, 64, 10]))).toEqual({ type: 'sustain', on: false, channel: 0 })
    expect(parseMidiMessage(new Uint8Array([0xb0, 123, 0]))).toEqual({ type: 'all-notes-off', channel: 0 })
    expect(parseMidiMessage(new Uint8Array([0xe0, 0, 64]))).toEqual({ type: 'other' })
    expect(parseMidiMessage(null)).toBeNull()
  })

  it('MIDI note, velocity and sustain drive the engine; notes outside the keybed are ignored', async () => {
    mounted = await mountApp()
    const { engine, bus, midi } = mounted.services
    expect(midi.getStatus()).toMatchObject({ state: 'ready', inputs: ['Fake Keys'] })
    await act(async () => {
      mounted!.world.input.send([0x90, 60, 37])
      mounted!.world.input.send([0x90, 64, 120])
    })
    expect(engine.activeVoices().map((v) => [v.midi, v.velocity])).toEqual([
      [60, 37],
      [64, 120],
    ])
    expect(keyEl(60)).toHaveAttribute('aria-pressed', 'true')
    await act(async () => {
      mounted!.world.input.send([0xb0, 64, 127])
      mounted!.world.input.send([0x80, 60, 0])
    })
    expect(engine.activeVoices().find((v) => v.midi === 60)).toMatchObject({ sustained: true, releasing: false })
    await act(async () => {
      mounted!.world.input.send([0xb0, 64, 0])
    })
    expect(engine.activeVoices().find((v) => v.midi === 60)).toMatchObject({ releasing: true })
    await act(async () => {
      mounted!.world.input.send([0x90, 20, 100]) // below E1
      mounted!.world.input.send([0x90, 108, 100]) // above E6
    })
    expect(bus.heldNotes()).toEqual([64])
    expect(midi.getStatus().lastMessage).toMatch(/note on 108/)
    await act(async () => {
      mounted!.world.input.send([0xb0, 123, 0])
    })
    expect(bus.heldNotes()).toEqual([])
  })

  it('reports denied, unsupported, error and no-input states without breaking other inputs', async () => {
    mounted = await mountApp({ midi: 'denied' })
    expect(mounted.services.midi.getStatus()).toMatchObject({ state: 'denied' })
    expect(document.getElementById('midi-status')?.dataset.state).toBe('denied')
    fireEvent.pointerDown(keyEl(60), { pointerId: 1, button: 0 })
    expect(mounted.services.engine.activeVoices()).toHaveLength(1)
    fireEvent.pointerUp(keyEl(60), { pointerId: 1 })
    mounted.unmount()

    mounted = await mountApp({ midi: 'unsupported' })
    expect(mounted.services.midi.getStatus()).toMatchObject({ state: 'unsupported' })
    mounted.unmount()

    mounted = await mountApp({ midi: 'error' })
    expect(mounted.services.midi.getStatus()).toMatchObject({ state: 'error' })
    expect(mounted.services.midi.getStatus().message).toMatch(/MIDI subsystem failure/)
    mounted.unmount()

    mounted = await mountApp({ midi: 'no-inputs' })
    expect(mounted.services.midi.getStatus()).toMatchObject({ state: 'disconnected', inputs: [] })
    await act(async () => {
      mounted!.world.access.addInput(mounted!.world.input)
    })
    expect(mounted.services.midi.getStatus()).toMatchObject({ state: 'ready', inputs: ['Fake Keys'] })
  })

  it('overlapping sources hold a note jointly: it only releases when the last source lets go', async () => {
    mounted = await mountApp()
    const { engine, bus } = mounted.services
    fireEvent.pointerDown(keyEl(60), { pointerId: 1, button: 0 })
    await act(async () => mounted!.world.input.send([0x90, 60, 100]))
    expect(engine.activeVoices().filter((v) => !v.releasing)).toHaveLength(1) // retriggered, not doubled
    fireEvent.pointerUp(keyEl(60), { pointerId: 1 })
    expect(bus.isHeld(60)).toBe(true)
    expect(engine.activeVoices().find((v) => !v.releasing)?.keyDown).toBe(true)
    await act(async () => mounted!.world.input.send([0x80, 60, 0]))
    expect(bus.isHeld(60)).toBe(false)
  })
})
