import { act, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { keyEl, mountApp, type Mounted } from './helpers'

let mounted: Mounted | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
})

describe('interaction.keys — pointer, touch, keyboard press / release / cancel / blur', () => {
  it('pointer down depresses a key and starts a voice; pointer up releases it', async () => {
    mounted = await mountApp()
    const key = keyEl(60)
    fireEvent.pointerDown(key, { pointerId: 1, button: 0, clientY: 10 })
    expect(key).toHaveAttribute('aria-pressed', 'true')
    expect(key.className).toContain('is-down')
    expect(mounted.services.bus.heldNotes()).toEqual([60])
    expect(mounted.services.engine.activeVoices().map((v) => v.midi)).toEqual([60])
    fireEvent.pointerUp(key, { pointerId: 1 })
    expect(key).toHaveAttribute('aria-pressed', 'false')
    expect(mounted.services.bus.heldNotes()).toEqual([])
    expect(mounted.services.engine.activeVoices()[0]?.releasing).toBe(true)
  })

  it('pointer cancel and releases outside the key both end the note', async () => {
    mounted = await mountApp()
    const key = keyEl(62)
    fireEvent.pointerDown(key, { pointerId: 7, button: 0 })
    expect(mounted.services.bus.isHeld(62)).toBe(true)
    fireEvent.pointerCancel(key, { pointerId: 7 })
    expect(mounted.services.bus.isHeld(62)).toBe(false)
    fireEvent.pointerDown(key, { pointerId: 8, button: 0 })
    expect(mounted.services.bus.isHeld(62)).toBe(true)
    fireEvent.pointerUp(window, { pointerId: 8 })
    expect(mounted.services.bus.isHeld(62)).toBe(false)
  })

  it('independent multi-touch: two fingers hold two keys and release independently', async () => {
    mounted = await mountApp()
    const a = keyEl(64)
    const b = keyEl(67)
    fireEvent.pointerDown(a, { pointerId: 11, pointerType: 'touch', button: 0 })
    fireEvent.pointerDown(b, { pointerId: 12, pointerType: 'touch', button: 0 })
    expect(mounted.services.bus.heldNotes()).toEqual([64, 67])
    expect(a).toHaveAttribute('aria-pressed', 'true')
    expect(b).toHaveAttribute('aria-pressed', 'true')
    fireEvent.pointerUp(a, { pointerId: 11, pointerType: 'touch' })
    expect(mounted.services.bus.heldNotes()).toEqual([67])
    expect(a).toHaveAttribute('aria-pressed', 'false')
    expect(b).toHaveAttribute('aria-pressed', 'true')
    fireEvent.pointerUp(b, { pointerId: 12, pointerType: 'touch' })
    expect(mounted.services.bus.heldNotes()).toEqual([])
  })

  it('a pointer sliding onto another key glides: the old note releases and the new one starts', async () => {
    mounted = await mountApp()
    fireEvent.pointerDown(keyEl(60), { pointerId: 3, button: 0 })
    fireEvent.pointerOver(keyEl(62), { pointerId: 3 })
    expect(mounted.services.bus.heldNotes()).toEqual([62])
    fireEvent.pointerUp(keyEl(62), { pointerId: 3 })
    expect(mounted.services.bus.heldNotes()).toEqual([])
  })

  it('a focused key plays with Space/Enter, ignores auto-repeat and releases on blur', async () => {
    mounted = await mountApp()
    const key = keyEl(65)
    key.focus()
    fireEvent.keyDown(key, { key: ' ' })
    expect(mounted.services.bus.heldNotes()).toEqual([65])
    const voicesAfterFirst = mounted.services.engine.activeVoices().length
    fireEvent.keyDown(key, { key: ' ', repeat: true })
    fireEvent.keyDown(key, { key: ' ' })
    expect(mounted.services.engine.activeVoices().length).toBe(voicesAfterFirst)
    fireEvent.keyUp(key, { key: ' ' })
    expect(mounted.services.bus.heldNotes()).toEqual([])
    fireEvent.keyDown(key, { key: 'Enter' })
    expect(mounted.services.bus.heldNotes()).toEqual([65])
    fireEvent.blur(key)
    expect(mounted.services.bus.heldNotes()).toEqual([])
  })

  it('velocity follows the pointer position on the key (lower = harder)', async () => {
    mounted = await mountApp()
    const key = keyEl(60)
    key.getBoundingClientRect = () => ({ top: 0, height: 100, left: 0, width: 10, bottom: 100, right: 10, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    fireEvent.pointerDown(key, { pointerId: 1, button: 0, clientY: 10 })
    const soft = mounted.services.engine.activeVoices().at(-1)!.velocity
    fireEvent.pointerUp(key, { pointerId: 1 })
    fireEvent.pointerDown(key, { pointerId: 2, button: 0, clientY: 95 })
    const hard = mounted.services.engine.activeVoices().at(-1)!.velocity
    fireEvent.pointerUp(key, { pointerId: 2 })
    expect(hard).toBeGreaterThan(soft)
  })

  it('window blur releases every held key and voice', async () => {
    mounted = await mountApp()
    fireEvent.pointerDown(keyEl(60), { pointerId: 1, button: 0 })
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }))
    })
    expect(mounted.services.bus.heldNotes()).toEqual([60, 64])
    await act(async () => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(mounted.services.bus.heldNotes()).toContain(60) // pointer is still physically down
    fireEvent.pointerUp(window, { pointerId: 1 })
    expect(mounted.services.bus.heldNotes()).toEqual([])
    const allOff = mounted.services.engine.activeVoices().every((v) => v.releasing)
    expect(allOff).toBe(true)
  })
})
