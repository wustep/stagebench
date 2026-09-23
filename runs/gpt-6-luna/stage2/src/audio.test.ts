import { describe, expect, it } from 'vitest'
import { effectiveReleaseSeconds, NoteLifecycle, renderPianoWave, velocityAmplitude, type PianoOutput } from './audio'

class RecordingOutput implements PianoOutput {
  events: string[] = []
  layerEvents: Array<{ kind: 'on' | 'off' | 'sustain'; id?: string; down?: boolean; layers: string[] }> = []
  active = new Map<string, { midi: number; velocity: number }>()
  disposed = false

  noteOn(id: string, midi: number, velocity: number, layers: ('A' | 'B')[] = ['A']) {
    this.events.push(`on:${id}:${midi}:${velocity}`)
    this.layerEvents.push({ kind: 'on', id, layers: [...layers] })
    this.active.set(id, { midi, velocity })
  }

  noteOff(id: string, releaseSeconds = 0.24, layers: ('A' | 'B')[] = ['A', 'B']) {
    this.events.push(`off:${id}:${releaseSeconds}`)
    this.layerEvents.push({ kind: 'off', id, layers: [...layers] })
    this.active.delete(id)
  }

  setSustain(down: boolean, layers: ('A' | 'B')[]) {
    this.layerEvents.push({ kind: 'sustain', down, layers: [...layers] })
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

  it('renders a longer release tail with Soft Release while leaving Clav release unchanged', () => {
    const sampleRate = 48_000
    const heldSeconds = 0.12
    const baseRelease = effectiveReleaseSeconds(0.24, false, 'Grand')
    const softRelease = effectiveReleaseSeconds(0.24, true, 'Grand')
    expect(softRelease).toBeGreaterThan(baseRelease)
    expect(effectiveReleaseSeconds(0.24, true, 'Clav')).toBe(baseRelease)
    const renderGate = (release: number) => Float32Array.from({ length: Math.round((heldSeconds + release) * sampleRate) }, (_, frame) => {
      const time = frame / sampleRate
      const envelope = time <= heldSeconds ? 1 : Math.exp(-9.21 * (time - heldSeconds) / release)
      return Math.sin(2 * Math.PI * 440 * time) * envelope
    })
    const normal = renderGate(baseRelease)
    const soft = renderGate(softRelease)
    expect(soft.length).toBeGreaterThan(normal.length)
    expect(rms(soft.slice(Math.round(0.3 * sampleRate)))).toBeGreaterThan(rms(normal.slice(Math.round(0.3 * sampleRate))))
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
    expect(notes.snapshot()).toEqual({ sustain: false, sustainLayers: [], notes: [] })
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

  it('keeps per-layer voice ownership when only one layer receives sustain', () => {
    const output = new RecordingOutput()
    const notes = new NoteLifecycle(output)
    notes.noteOn('stacked-c', 60, 96, ['A', 'B'])
    notes.setSustain(true, ['A'])
    notes.noteOff('stacked-c')
    expect(notes.snapshot().notes[0]).toMatchObject({ id: 'stacked-c', state: 'sustained', layers: ['A'] })
    expect(output.layerEvents).toEqual([
      { kind: 'on', id: 'stacked-c', layers: ['A', 'B'] },
      { kind: 'sustain', down: true, layers: ['A'] },
      { kind: 'off', id: 'stacked-c', layers: ['B'] },
    ])
    notes.setSustain(false, ['A'])
    expect(notes.snapshot().notes).toEqual([])
    expect(output.layerEvents.at(-1)).toEqual({ kind: 'off', id: 'stacked-c', layers: ['A'] })
  })
})
