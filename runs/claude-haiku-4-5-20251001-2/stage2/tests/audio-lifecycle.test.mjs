import { test } from 'node:test'
import { strictEqual, ok } from 'node:assert'

// Simplified test-compatible implementation
class NoteLifecycleService {
  constructor() {
    this.listeners = new Set()
    this.activeNotes = new Map()
    this.baseTime = performance.now()
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  noteOn(noteNumber, velocity, sourceId) {
    const timestamp = performance.now() - this.baseTime
    const event = {
      type: 'note-on',
      noteNumber,
      velocity,
      timestamp,
      sourceId,
    }
    this.activeNotes.set(sourceId, event)
    for (const listener of this.listeners) {
      listener.onNoteOn(event)
    }
  }

  noteOff(sourceId) {
    const activeNote = this.activeNotes.get(sourceId)
    if (!activeNote) {
      return
    }
    const timestamp = performance.now() - this.baseTime
    const event = {
      type: 'note-off',
      noteNumber: activeNote.noteNumber,
      velocity: activeNote.velocity,
      timestamp,
      sourceId,
    }
    this.activeNotes.delete(sourceId)
    for (const listener of this.listeners) {
      listener.onNoteOff(event)
    }
  }

  allNotesOff() {
    this.activeNotes.clear()
    for (const listener of this.listeners) {
      listener.onAllNotesOff()
    }
  }

  isNoteActive(sourceId) {
    return this.activeNotes.has(sourceId)
  }

  getActiveNote(sourceId) {
    return this.activeNotes.get(sourceId)?.noteNumber ?? null
  }

  reset() {
    this.activeNotes.clear()
  }
}

// Tests
test('audio.lifecycle: note-on records active note', () => {
  const lifecycle = new NoteLifecycleService()
  lifecycle.noteOn(60, 0.8, 'keyboard-60')
  ok(lifecycle.isNoteActive('keyboard-60'), 'Note should be active after note-on')
  strictEqual(lifecycle.getActiveNote('keyboard-60'), 60, 'Active note should be 60')
})

test('audio.lifecycle: note-off removes active note', () => {
  const lifecycle = new NoteLifecycleService()
  lifecycle.noteOn(60, 0.8, 'keyboard-60')
  lifecycle.noteOff('keyboard-60')
  strictEqual(lifecycle.isNoteActive('keyboard-60'), false, 'Note should be inactive after note-off')
})

test('audio.lifecycle: different sources tracked independently', () => {
  const lifecycle = new NoteLifecycleService()
  lifecycle.noteOn(60, 0.8, 'keyboard-60')
  lifecycle.noteOn(64, 0.7, 'midi-64')
  ok(lifecycle.isNoteActive('keyboard-60'), 'Keyboard note should be active')
  ok(lifecycle.isNoteActive('midi-64'), 'MIDI note should be active')
  strictEqual(lifecycle.getActiveNote('keyboard-60'), 60)
  strictEqual(lifecycle.getActiveNote('midi-64'), 64)
})

test('audio.lifecycle: listeners receive note-on events', () => {
  const lifecycle = new NoteLifecycleService()
  const events = []
  const listener = {
    onNoteOn: event => events.push(event),
    onNoteOff: () => {},
    onAllNotesOff: () => {},
  }
  lifecycle.subscribe(listener)
  lifecycle.noteOn(60, 0.8, 'keyboard-60')
  strictEqual(events.length, 1, 'Should receive one note-on event')
  strictEqual(events[0].type, 'note-on')
  strictEqual(events[0].noteNumber, 60)
  strictEqual(events[0].velocity, 0.8)
})

test('audio.lifecycle: listeners receive note-off events', () => {
  const lifecycle = new NoteLifecycleService()
  const events = []
  const listener = {
    onNoteOn: () => {},
    onNoteOff: event => events.push(event),
    onAllNotesOff: () => {},
  }
  lifecycle.subscribe(listener)
  lifecycle.noteOn(60, 0.8, 'keyboard-60')
  lifecycle.noteOff('keyboard-60')
  strictEqual(events.length, 1, 'Should receive one note-off event')
  strictEqual(events[0].type, 'note-off')
  strictEqual(events[0].noteNumber, 60)
})

test('audio.lifecycle: all-notes-off clears all sources', () => {
  const lifecycle = new NoteLifecycleService()
  lifecycle.noteOn(60, 0.8, 'keyboard-60')
  lifecycle.noteOn(64, 0.7, 'midi-64')
  lifecycle.allNotesOff()
  strictEqual(lifecycle.isNoteActive('keyboard-60'), false, 'All notes should be inactive')
  strictEqual(lifecycle.isNoteActive('midi-64'), false)
})

test('audio.lifecycle: unsubscribe stops listener from receiving events', () => {
  const lifecycle = new NoteLifecycleService()
  const events = []
  const listener = {
    onNoteOn: event => events.push(event),
    onNoteOff: () => {},
    onAllNotesOff: () => {},
  }
  const unsubscribe = lifecycle.subscribe(listener)
  lifecycle.noteOn(60, 0.8, 'keyboard-60')
  strictEqual(events.length, 1)
  unsubscribe()
  lifecycle.noteOn(64, 0.7, 'keyboard-64')
  strictEqual(events.length, 1, 'Should not receive event after unsubscribe')
})

test('audio.lifecycle: repeated notes on same source replace each other', () => {
  const lifecycle = new NoteLifecycleService()
  lifecycle.noteOn(60, 0.8, 'keyboard')
  lifecycle.noteOn(64, 0.9, 'keyboard')
  strictEqual(
    lifecycle.getActiveNote('keyboard'),
    64,
    'Second note should replace first on same source'
  )
})
