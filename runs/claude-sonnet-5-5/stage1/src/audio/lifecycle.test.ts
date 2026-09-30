import { describe, expect, it } from 'vitest'
import { NoteLifecycle } from './lifecycle'
import type { VoiceSink } from './types'

/** records commands and ends voices only when told to */
class SpySink implements VoiceSink {
  onVoiceEnded: ((id: number) => void) | null = null
  log: string[] = []
  started = new Map<number, { note: number; velocity: number }>()
  start(id: number, note: number, velocity: number) {
    this.log.push(`start:${id}:${note}`)
    this.started.set(id, { note, velocity })
  }
  release(id: number) {
    this.log.push(`release:${id}`)
  }
  steal(id: number) {
    this.log.push(`steal:${id}`)
  }
  dispose() {
    this.log.push('dispose')
  }
  end(id: number) {
    this.onVoiceEnded?.(id)
  }
}

const setup = (max = 24) => {
  const sink = new SpySink()
  const lc = new NoteLifecycle(sink, max)
  return { sink, lc }
}

describe('piano.basic-note-lifecycle', () => {
  it('starts a voice on note on and releases it on note off', () => {
    const { sink, lc } = setup()
    const id = lc.noteOn('a', 60, 100)
    expect(id).toBe(1)
    expect(lc.getSnapshot().pressed.has(60)).toBe(true)
    lc.noteOff('a')
    expect(sink.log).toEqual(['start:1:60', 'release:1'])
    expect(lc.getSnapshot().pressed.has(60)).toBe(false)
    expect(lc.getVoices()[0].state).toBe('releasing')
    sink.end(1)
    expect(lc.getVoices()).toHaveLength(0)
  })

  it('re-striking a note releases the previous voice and starts a new one', () => {
    const { sink, lc } = setup()
    lc.noteOn('a', 60, 90)
    lc.noteOn('b', 60, 90)
    expect(sink.log).toEqual(['start:1:60', 'release:1', 'start:2:60'])
    // key still pressed by b after a lets go: the note keeps sounding
    lc.noteOff('a')
    expect(lc.getVoices().find((v) => v.id === 2)?.state).toBe('held')
    lc.noteOff('b')
    expect(sink.log.at(-1)).toBe('release:2')
  })

  it('a source that presses a second note releases the first', () => {
    const { sink, lc } = setup()
    lc.noteOn('p1', 60, 90)
    lc.noteOn('p1', 62, 90)
    expect(sink.log).toEqual(['start:1:60', 'release:1', 'start:2:62'])
  })

  it('overlapping different notes sound together', () => {
    const { lc } = setup()
    lc.noteOn('a', 60, 90)
    lc.noteOn('b', 64, 90)
    lc.noteOn('c', 67, 90)
    expect(lc.getVoices().map((v) => v.note)).toEqual([60, 64, 67])
    expect(lc.getSnapshot().voices).toBe(3)
  })

  it('ignores out-of-range notes and clamps velocity', () => {
    const { sink, lc } = setup()
    expect(lc.noteOn('a', 5, 100)).toBeNull()
    expect(lc.noteOn('a', 200, 100)).toBeNull()
    lc.noteOn('a', 60, 999)
    lc.noteOn('b', 61, -4)
    expect(sink.started.get(1)?.velocity).toBe(127)
    expect(sink.started.get(2)?.velocity).toBe(1)
  })

  it('allNotesOff hands every voice to the sink, clears holders and pedals', () => {
    const { sink, lc } = setup()
    lc.noteOn('a', 60, 90)
    lc.noteOn('b', 64, 90)
    lc.sustain('pedal', true)
    lc.allNotesOff()
    expect(sink.log.filter((l) => l.startsWith('steal'))).toHaveLength(2)
    expect(lc.getSnapshot().pressed.size).toBe(0)
    expect(lc.getSnapshot().sustain).toBe(false)
    expect(lc.getVoices()).toHaveLength(0)
  })

  it('dispose disposes the sink, stops notifications and refuses new notes', () => {
    const { sink, lc } = setup()
    let calls = 0
    lc.subscribe(() => calls++)
    lc.noteOn('a', 60, 90)
    const before = calls
    lc.dispose()
    expect(sink.log.at(-1)).toBe('dispose')
    expect(lc.listenerCount()).toBe(0)
    expect(lc.noteOn('a', 60, 90)).toBeNull()
    expect(calls).toBe(before)
    expect(sink.onVoiceEnded).toBeNull()
  })
})

describe('piano.basic-sustain-polyphony', () => {
  it('sustain keeps released notes sounding until the pedal lifts', () => {
    const { sink, lc } = setup()
    lc.noteOn('a', 60, 90)
    lc.sustain('pedal', true)
    lc.noteOff('a')
    expect(sink.log).toEqual(['start:1:60'])
    expect(lc.getVoices()[0].state).toBe('sustained')
    lc.sustain('pedal', false)
    expect(sink.log).toEqual(['start:1:60', 'release:1'])
  })

  it('a note played while the pedal is down and released later is sustained too', () => {
    const { sink, lc } = setup()
    lc.sustain('pedal', true)
    lc.noteOn('a', 60, 90)
    lc.noteOff('a')
    lc.sustain('pedal', false)
    expect(sink.log).toEqual(['start:1:60', 'release:1'])
  })

  it('multiple pedal sources: the pedal stays down until all of them lift', () => {
    const { sink, lc } = setup()
    lc.noteOn('a', 60, 90)
    lc.sustain('key', true)
    lc.sustain('midi', true)
    lc.noteOff('a')
    lc.sustain('key', false)
    expect(sink.log).toEqual(['start:1:60'])
    lc.sustain('midi', false)
    expect(sink.log.at(-1)).toBe('release:1')
  })

  it('pedal up does not release notes that are still held', () => {
    const { sink, lc } = setup()
    lc.sustain('pedal', true)
    lc.noteOn('a', 60, 90)
    lc.sustain('pedal', false)
    expect(sink.log).toEqual(['start:1:60'])
    lc.noteOff('a')
    expect(sink.log.at(-1)).toBe('release:1')
  })

  it('allows many concurrent voices up to the limit', () => {
    const { lc } = setup(8)
    for (let n = 0; n < 8; n++) lc.noteOn(`s${n}`, 40 + n, 90)
    expect(lc.getSnapshot().voices).toBe(8)
  })

  it('steals releasing voices first, then sustained, then the oldest held', () => {
    const { sink, lc } = setup(3)
    lc.noteOn('a', 60, 90) // id 1
    lc.noteOn('b', 62, 90) // id 2
    lc.noteOn('c', 64, 90) // id 3
    lc.noteOff('b') // 2 releasing
    lc.noteOn('d', 65, 90) // steals 2
    expect(sink.log.filter((l) => l.startsWith('steal'))).toEqual(['steal:2'])

    lc.sustain('p', true)
    lc.noteOff('c') // 3 sustained
    lc.noteOn('e', 67, 90) // steals sustained 3 (a and d are still held)
    expect(sink.log.filter((l) => l.startsWith('steal'))).toEqual(['steal:2', 'steal:3'])

    lc.noteOn('f', 69, 90) // all held: steals the oldest (1)
    expect(sink.log.filter((l) => l.startsWith('steal'))).toEqual(['steal:2', 'steal:3', 'steal:1'])
    expect(lc.getSnapshot().voices).toBe(3)
  })

  it('stealing is deterministic: the same input always steals the same voices', () => {
    const run = () => {
      const { sink, lc } = setup(4)
      for (let i = 0; i < 12; i++) {
        lc.noteOn(`s${i}`, 40 + (i % 7), 60 + i)
        if (i % 3 === 0) lc.noteOff(`s${i}`)
      }
      return sink.log.join('|')
    }
    expect(run()).toBe(run())
  })

  it('records velocity per voice so it can shape the response', () => {
    const { sink, lc } = setup()
    lc.noteOn('a', 60, 20)
    lc.noteOn('b', 61, 120)
    expect(sink.started.get(1)?.velocity).toBe(20)
    expect(sink.started.get(2)?.velocity).toBe(120)
  })
})
