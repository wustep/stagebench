/**
 * piano.keyboard-map — Real-module tests for computer-keyboard input.
 *
 * These tests import the REAL InputHandler and NoteLifecycleService from the
 * TypeScript source (loaded via the tsx loader configured in the test script)
 * and exercise the actual QWERTY->MIDI mapping, auto-repeat suppression, and
 * blur / all-notes-off cleanup paths.
 */

import { test } from 'node:test'
import { strictEqual, ok } from 'node:assert'

import { InputHandler } from '../src/audio/inputHandler.ts'
import { NoteLifecycleService } from '../src/audio/noteLifecycle.ts'

/**
 * Minimal fake `window` that supports addEventListener/removeEventListener and
 * a dispatch() helper so we can drive the real keyboard handlers without a DOM.
 */
function installFakeWindow() {
  const listeners = new Map() // type -> Set<fn>
  const fakeWindow = {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(fn)
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn)
    },
    dispatch(type, event) {
      for (const fn of listeners.get(type) ?? []) fn(event)
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0
    },
  }
  const previous = globalThis.window
  globalThis.window = fakeWindow
  return {
    fakeWindow,
    restore() {
      globalThis.window = previous
    },
  }
}

/** Build a KeyboardEvent-like object the handler understands. */
function keyEvent(key) {
  return { key, preventDefault() {} }
}

test('piano.keyboard-map: QWERTY keys map to the correct MIDI notes', () => {
  const { fakeWindow, restore } = installFakeWindow()
  try {
    const lifecycle = new NoteLifecycleService()
    const handler = new InputHandler(lifecycle)
    const detach = handler.attachKeyboard()

    // Canonical mapping from the source: q=C4(60), w=D4(62), a=C#4(61), p=E5(76)
    fakeWindow.dispatch('keydown', keyEvent('q'))
    strictEqual(lifecycle.getActiveNote('keyboard-q'), 60, 'q should map to MIDI 60 (C4)')

    fakeWindow.dispatch('keydown', keyEvent('w'))
    strictEqual(lifecycle.getActiveNote('keyboard-w'), 62, 'w should map to MIDI 62 (D4)')

    fakeWindow.dispatch('keydown', keyEvent('a'))
    strictEqual(lifecycle.getActiveNote('keyboard-a'), 61, 'a should map to MIDI 61 (C#4)')

    fakeWindow.dispatch('keydown', keyEvent('p'))
    strictEqual(lifecycle.getActiveNote('keyboard-p'), 76, 'p should map to MIDI 76 (E5)')

    detach()
    restore()
  } catch (err) {
    restore()
    throw err
  }
})

test('piano.keyboard-map: keyup releases the mapped note', () => {
  const { fakeWindow, restore } = installFakeWindow()
  try {
    const lifecycle = new NoteLifecycleService()
    const handler = new InputHandler(lifecycle)
    handler.attachKeyboard()

    fakeWindow.dispatch('keydown', keyEvent('t')) // G4 = 67
    ok(lifecycle.isNoteActive('keyboard-t'), 'note should be active after keydown')

    fakeWindow.dispatch('keyup', keyEvent('t'))
    strictEqual(lifecycle.isNoteActive('keyboard-t'), false, 'note should release on keyup')

    restore()
  } catch (err) {
    restore()
    throw err
  }
})

test('piano.keyboard-map: auto-repeat keydown does not retrigger a held note', () => {
  const { fakeWindow, restore } = installFakeWindow()
  try {
    const lifecycle = new NoteLifecycleService()
    const handler = new InputHandler(lifecycle)
    handler.attachKeyboard()

    // Count note-on events reaching the lifecycle listeners.
    let noteOnCount = 0
    lifecycle.subscribe({
      onNoteOn: () => {
        noteOnCount += 1
      },
      onNoteOff: () => {},
      onAllNotesOff: () => {},
    })

    // Held key fires keydown repeatedly (OS auto-repeat) with no keyup between.
    fakeWindow.dispatch('keydown', keyEvent('e')) // E4 = 64
    fakeWindow.dispatch('keydown', keyEvent('e'))
    fakeWindow.dispatch('keydown', keyEvent('e'))

    strictEqual(noteOnCount, 1, 'auto-repeat must not produce additional note-on events')
    ok(lifecycle.isNoteActive('keyboard-e'), 'the note stays active while held')

    // After release, pressing again should retrigger exactly once more.
    fakeWindow.dispatch('keyup', keyEvent('e'))
    fakeWindow.dispatch('keydown', keyEvent('e'))
    strictEqual(noteOnCount, 2, 'a fresh press after release retriggers the note')

    restore()
  } catch (err) {
    restore()
    throw err
  }
})

test('piano.keyboard-map: spacebar toggles the sustain pedal', () => {
  const { fakeWindow, restore } = installFakeWindow()
  try {
    const lifecycle = new NoteLifecycleService()
    const handler = new InputHandler(lifecycle)
    handler.attachKeyboard()

    strictEqual(lifecycle.isSustainEnabled(), false, 'sustain starts disabled')
    fakeWindow.dispatch('keydown', keyEvent(' '))
    strictEqual(lifecycle.isSustainEnabled(), true, 'space press enables sustain (pedal down)')
    fakeWindow.dispatch('keyup', keyEvent(' '))
    strictEqual(lifecycle.isSustainEnabled(), false, 'space release disables sustain (pedal up)')

    restore()
  } catch (err) {
    restore()
    throw err
  }
})

test('piano.keyboard-map: Escape / all-notes-off clears every active note', () => {
  const { fakeWindow, restore } = installFakeWindow()
  try {
    const lifecycle = new NoteLifecycleService()
    const handler = new InputHandler(lifecycle)
    handler.attachKeyboard()

    fakeWindow.dispatch('keydown', keyEvent('q')) // 60
    fakeWindow.dispatch('keydown', keyEvent('w')) // 62
    fakeWindow.dispatch('keydown', keyEvent('e')) // 64
    ok(lifecycle.isNoteActive('keyboard-q') && lifecycle.isNoteActive('keyboard-w'), 'notes held')

    // Escape triggers the real allNotesOff() path.
    fakeWindow.dispatch('keydown', keyEvent('Escape'))
    strictEqual(lifecycle.isNoteActive('keyboard-q'), false, 'q cleared by all-notes-off')
    strictEqual(lifecycle.isNoteActive('keyboard-w'), false, 'w cleared by all-notes-off')
    strictEqual(lifecycle.isNoteActive('keyboard-e'), false, 'e cleared by all-notes-off')

    restore()
  } catch (err) {
    restore()
    throw err
  }
})

test('piano.keyboard-map: detach removes the window listeners (blur cleanup safety)', () => {
  const { fakeWindow, restore } = installFakeWindow()
  try {
    const lifecycle = new NoteLifecycleService()
    const handler = new InputHandler(lifecycle)
    const detach = handler.attachKeyboard()

    strictEqual(fakeWindow.listenerCount('keydown'), 1, 'keydown listener attached')
    strictEqual(fakeWindow.listenerCount('keyup'), 1, 'keyup listener attached')

    detach()
    strictEqual(fakeWindow.listenerCount('keydown'), 0, 'keydown listener removed on detach')
    strictEqual(fakeWindow.listenerCount('keyup'), 0, 'keyup listener removed on detach')

    // After detach, dispatching should not create notes (handlers gone).
    fakeWindow.dispatch('keydown', keyEvent('q'))
    strictEqual(lifecycle.isNoteActive('keyboard-q'), false, 'no note after detach')

    restore()
  } catch (err) {
    restore()
    throw err
  }
})
