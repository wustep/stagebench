import { describe, expect, it } from 'vitest'
import { NoteLifecycle, renderPianoWave, velocityAmplitude, type PianoOutput } from './audio'

class RecordingOutput implements PianoOutput {
  events: string[] = []
  active = new Map<string, { midi: number; velocity: number }>()
  disposed = false

  noteOn(id: string, midi: number, velocity: number) {
    this.events.push(`on:${id}:${midi}:${velocity}`)
    this.active.set(id, { midi, velocity })
  }

  noteOff(id: string, releaseSeconds = 0.24) {
    this.events.push(`off:${id}:${releaseSeconds}`)
    this.active.delete(id)
  }

  allNotesOff() {
    this.events.push('all-off')
    this.active.clear()
  }

  dispose() { this.disposed = true }
}

const rms = (samples: Float32Array): number => Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length)

describe('basic piano signal and deterministic lifecycle', () => {
  it('renders a non-silent additive piano waveform and increases output level with velocity', () => {
    const samples = renderPianoWave(60, 24_000, 48_000)
    expect(rms(samples)).toBeGreaterThan(0.01)
    expect(samples.some((sample) => sample !== 0)).toBe(true)
    expect(velocityAmplitude(112)).toBeGreaterThan(velocityAmplitude(24))
  })

  it('renders distinct pitches and a naturally decaying release tail', () => {
    const low = renderPianoWave(48, 12_000, 48_000)
    const high = renderPianoWave(72, 12_000, 48_000)
    expect(Array.from(low)).not.toEqual(Array.from(high))
    const firstQuarter = rms(low.slice(0, 3_000))
    const finalQuarter = rms(low.slice(9_000))
    expect(firstQuarter).toBeGreaterThan(finalQuarter)
  })

  it('releases repeated identities and supports overlapping note ownership', () => {
    const output = new RecordingOutput()
    const notes = new NoteLifecycle(output)
    notes.noteOn('left-hand-c', 60, 72)
    notes.noteOn('right-hand-c', 60, 101)
    expect(notes.snapshot().notes).toHaveLength(2)
    notes.noteOn('left-hand-c', 60, 92)
    expect(output.events.slice(0, 3)).toEqual([
      'on:left-hand-c:60:72',
      'on:right-hand-c:60:101',
      'off:left-hand-c:0.012',
    ])
    expect(notes.snapshot().notes.map((note) => note.id)).toEqual(['right-hand-c', 'left-hand-c'])
    notes.noteOff('right-hand-c')
    expect(output.events.at(-1)).toBe('off:right-hand-c:0.24')
  })

  it('holds released notes under sustain and releases them when CC64 or the pedal rises', () => {
    const output = new RecordingOutput()
    const notes = new NoteLifecycle(output)
    notes.noteOn('midi:60:1', 60, 110)
    notes.setSustain(true)
    notes.noteOff('midi:60:1')
    expect(notes.snapshot().notes[0]?.state).toBe('sustained')
    expect(output.events).toEqual(['on:midi:60:1:60:110'])
    notes.setSustain(false)
    expect(notes.snapshot().notes).toEqual([])
    expect(output.events.at(-1)).toBe('off:midi:60:1:0.24')
  })

  it('steals the oldest held voice deterministically and clears every remaining voice', () => {
    const output = new RecordingOutput()
    const notes = new NoteLifecycle(output, 2)
    notes.noteOn('first', 48, 70)
    notes.noteOn('second', 52, 80)
    notes.noteOn('third', 55, 90)
    expect(output.events).toEqual([
      'on:first:48:70',
      'on:second:52:80',
      'off:first:0.012',
      'on:third:55:90',
    ])
    expect(notes.snapshot().notes.map((note) => note.id)).toEqual(['second', 'third'])
    notes.allNotesOff()
    expect(notes.snapshot()).toEqual({ sustain: false, notes: [] })
    expect(output.active.size).toBe(0)
    expect(output.events.at(-1)).toBe('all-off')
  })

  it('preserves velocity response in the shared note path and owns disposal explicitly', () => {
    const output = new RecordingOutput()
    const notes = new NoteLifecycle(output)
    notes.noteOn('soft', 64, 28)
    notes.noteOn('loud', 67, 119)
    expect(output.active.get('loud')?.velocity).toBeGreaterThan(output.active.get('soft')?.velocity ?? 0)
    notes.allNotesOff()
    output.dispose()
    expect(output.disposed).toBe(true)
  })
})
