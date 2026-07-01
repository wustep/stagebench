/**
 * piano.midi — Real-module tests for Web MIDI input handling.
 *
 * Imports the REAL InputHandler + NoteLifecycleService (via the tsx loader) and
 * drives the actual attachMIDI() code path: note-on velocity scaling, note-off
 * release, sustain CC64 handling, and the disconnected / permission-denied
 * branches (which must resolve to a no-op teardown without throwing).
 */

import { test } from 'node:test'
import { strictEqual, ok } from 'node:assert'

import { InputHandler } from '../src/audio/inputHandler.ts'
import { NoteLifecycleService } from '../src/audio/noteLifecycle.ts'

/** A single fake MIDI input port exposing add/removeEventListener + dispatch. */
function makeFakeInput() {
  const listeners = new Map()
  return {
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
}

/** A fake MIDIAccess with an iterable `inputs` map and statechange support. */
function makeFakeMidiAccess(inputs) {
  const accessListeners = new Map()
  const map = new Map(inputs.map((input, i) => [`in-${i}`, input]))
  return {
    inputs: {
      forEach(cb) {
        map.forEach((value) => cb(value))
      },
    },
    addEventListener(type, fn) {
      if (!accessListeners.has(type)) accessListeners.set(type, new Set())
      accessListeners.get(type).add(fn)
    },
    removeEventListener(type, fn) {
      accessListeners.get(type)?.delete(fn)
    },
  }
}

/** Build the { data: { data: Uint8Array } } shape the handler reads. */
function midiMessage(bytes) {
  return { data: { data: Uint8Array.from(bytes) } }
}

function withNavigator(navigatorImpl, run) {
  const previous = globalThis.navigator
  // navigator may be a non-configurable getter in some runtimes; define it.
  Object.defineProperty(globalThis, 'navigator', {
    value: navigatorImpl,
    configurable: true,
    writable: true,
  })
  return Promise.resolve()
    .then(run)
    .finally(() => {
      if (previous === undefined) {
        delete globalThis.navigator
      } else {
        Object.defineProperty(globalThis, 'navigator', {
          value: previous,
          configurable: true,
          writable: true,
        })
      }
    })
}

test('piano.midi: note-on message triggers a note with scaled velocity', async () => {
  const input = makeFakeInput()
  const midiAccess = makeFakeMidiAccess([input])
  await withNavigator({ requestMIDIAccess: () => Promise.resolve(midiAccess) }, async () => {
    const lifecycle = new NoteLifecycleService()
    const handler = new InputHandler(lifecycle)

    let captured = null
    lifecycle.subscribe({
      onNoteOn: (e) => {
        captured = e
      },
      onNoteOff: () => {},
      onAllNotesOff: () => {},
    })

    await handler.attachMIDI()

    // Note-on, channel 1 (status 0x90), note 60, velocity 100.
    input.dispatch('midimessage', midiMessage([0x90, 60, 100]))

    ok(captured, 'a note-on event should be emitted')
    strictEqual(captured.noteNumber, 60, 'note number should be 60')
    // Velocity is normalized 100/127.
    ok(Math.abs(captured.velocity - 100 / 127) < 1e-9, 'velocity should scale to 100/127')
    ok(lifecycle.isNoteActive('midi-1-60'), 'note should be tracked under midi-<channel>-<note>')
  })
})

test('piano.midi: note-off (0x80) releases the active note', async () => {
  const input = makeFakeInput()
  const midiAccess = makeFakeMidiAccess([input])
  await withNavigator({ requestMIDIAccess: () => Promise.resolve(midiAccess) }, async () => {
    const lifecycle = new NoteLifecycleService()
    const handler = new InputHandler(lifecycle)
    await handler.attachMIDI()

    input.dispatch('midimessage', midiMessage([0x90, 64, 90])) // note-on E4
    ok(lifecycle.isNoteActive('midi-1-64'), 'note active after note-on')

    input.dispatch('midimessage', midiMessage([0x80, 64, 0])) // note-off
    strictEqual(lifecycle.isNoteActive('midi-1-64'), false, 'note released after 0x80')
  })
})

test('piano.midi: note-on with velocity 0 is treated as note-off', async () => {
  const input = makeFakeInput()
  const midiAccess = makeFakeMidiAccess([input])
  await withNavigator({ requestMIDIAccess: () => Promise.resolve(midiAccess) }, async () => {
    const lifecycle = new NoteLifecycleService()
    const handler = new InputHandler(lifecycle)
    await handler.attachMIDI()

    input.dispatch('midimessage', midiMessage([0x90, 67, 80])) // note-on
    ok(lifecycle.isNoteActive('midi-1-67'), 'note active')
    input.dispatch('midimessage', midiMessage([0x90, 67, 0])) // running-status note-off
    strictEqual(lifecycle.isNoteActive('midi-1-67'), false, 'velocity-0 note-on releases the note')
  })
})

test('piano.midi: sustain CC64 >= 64 enables sustain, < 64 disables it', async () => {
  const input = makeFakeInput()
  const midiAccess = makeFakeMidiAccess([input])
  await withNavigator({ requestMIDIAccess: () => Promise.resolve(midiAccess) }, async () => {
    const lifecycle = new NoteLifecycleService()
    const handler = new InputHandler(lifecycle)
    await handler.attachMIDI()

    strictEqual(lifecycle.isSustainEnabled(), false, 'sustain starts off')

    input.dispatch('midimessage', midiMessage([0xb0, 64, 127])) // CC64 = 127 (pedal down)
    strictEqual(lifecycle.isSustainEnabled(), true, 'CC64 >= 64 enables sustain')

    input.dispatch('midimessage', midiMessage([0xb0, 64, 0])) // CC64 = 0 (pedal up)
    strictEqual(lifecycle.isSustainEnabled(), false, 'CC64 < 64 disables sustain')

    // Boundary: exactly 64 should be "down".
    input.dispatch('midimessage', midiMessage([0xb0, 64, 64]))
    strictEqual(lifecycle.isSustainEnabled(), true, 'CC64 == 64 counts as pedal down')
  })
})

test('piano.midi: permission-denied (rejected requestMIDIAccess) does not throw', async () => {
  await withNavigator(
    { requestMIDIAccess: () => Promise.reject(new Error('SecurityError: permission denied')) },
    async () => {
      const lifecycle = new NoteLifecycleService()
      const handler = new InputHandler(lifecycle)

      // Must resolve to a no-op teardown function, not throw.
      const detach = await handler.attachMIDI()
      strictEqual(typeof detach, 'function', 'returns a teardown function even when denied')
      detach() // should be safe to call
      ok(true, 'permission-denied path handled without throwing')
    }
  )
})

test('piano.midi: unavailable Web MIDI (no requestMIDIAccess) returns a safe no-op', async () => {
  await withNavigator({}, async () => {
    const lifecycle = new NoteLifecycleService()
    const handler = new InputHandler(lifecycle)

    const detach = await handler.attachMIDI()
    strictEqual(typeof detach, 'function', 'returns a teardown function when Web MIDI is absent')
    detach()
    ok(true, 'missing Web MIDI API handled without throwing')
  })
})

test('piano.midi: detach removes midimessage listeners from all inputs', async () => {
  const input = makeFakeInput()
  const midiAccess = makeFakeMidiAccess([input])
  await withNavigator({ requestMIDIAccess: () => Promise.resolve(midiAccess) }, async () => {
    const lifecycle = new NoteLifecycleService()
    const handler = new InputHandler(lifecycle)

    const detach = await handler.attachMIDI()
    strictEqual(input.listenerCount('midimessage'), 1, 'listener attached to input port')

    detach()
    strictEqual(input.listenerCount('midimessage'), 0, 'listener removed on detach')

    // A message after detach must not create a note.
    input.dispatch('midimessage', midiMessage([0x90, 72, 100]))
    strictEqual(lifecycle.isNoteActive('midi-1-72'), false, 'no note after detach')
  })
})
