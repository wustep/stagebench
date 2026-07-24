import { beforeEach, describe, expect, it } from 'vitest'
import { ManualScheduler } from './graph'
import { OfflineAudioGraph, peak, rms, sustainDuration } from './offline'
import { PianoEngine, noteId } from './pianoEngine'
import { fundamentalDecay, toneCutoff, velocityGain } from './pianoVoice'

const SAMPLE_RATE = 16000
/** master + piano bus; every voice node is created and destroyed on top of this. */
const BASELINE_NODES = 2

function build(maxVoices = 32) {
  const graph = new OfflineAudioGraph(SAMPLE_RATE)
  const scheduler = new ManualScheduler()
  const engine = new PianoEngine(graph, { scheduler, maxVoices })
  return { graph, scheduler, engine }
}

describe('piano engine', () => {
  let rig: ReturnType<typeof build>

  beforeEach(() => {
    rig = build()
  })

  /** Feature: piano.basic-note-lifecycle */
  describe('note lifecycle', () => {
    it('produces real audio at the destination, clearly above silence', () => {
      rig.engine.noteOn(noteId('pointer', 1), 60, 0.9)
      const rendered = rig.graph.render(0.5)
      expect(peak(rendered)).toBeGreaterThan(0.05)
      expect(rms(rendered)).toBeGreaterThan(0.01)
    })

    it('renders silence before any note is played', () => {
      expect(peak(rig.graph.render(0.2))).toBe(0)
    })

    it('routes every voice through the piano bus and the master gain', () => {
      rig.engine.noteOn(noteId('pointer', 1), 64, 0.9)
      const loud = peak(rig.graph.render(0.4))
      rig.engine.master.gain.value = 0
      expect(peak(rig.graph.render(0.4))).toBe(0)
      rig.engine.master.gain.value = 0.7
      rig.engine.pianoBus.gain.value = 0
      expect(peak(rig.graph.render(0.4))).toBe(0)
      expect(loud).toBeGreaterThan(0.05)
    })

    it('keeps overlapping notes from different sources independent', () => {
      rig.engine.noteOn(noteId('pointer', 1), 60, 0.8)
      rig.engine.noteOn(noteId('keyboard', 'KeyA'), 60, 0.8)
      expect(rig.engine.activeVoiceCount).toBe(2)
      rig.engine.noteOff(noteId('pointer', 1))
      expect(rig.engine.soundingVoiceCount).toBe(1)
      expect(rig.engine.soundingNotes()).toEqual([60])
    })

    it('retriggers rather than stacking when the same note instance replays', () => {
      rig.engine.noteOn(noteId('keyboard', 'KeyA'), 60, 0.8)
      rig.engine.noteOn(noteId('keyboard', 'KeyA'), 60, 0.8)
      expect(rig.engine.activeVoiceCount).toBe(1)
    })

    it('shortens the audible tail when a key is released', () => {
      const held = build()
      held.engine.noteOn('a', 60, 0.9)
      const heldTail = sustainDuration(held.graph.render(1.2), SAMPLE_RATE)

      const released = build()
      released.engine.noteOn('a', 60, 0.9)
      released.graph.advanceClock(0.2)
      released.engine.noteOff('a')
      const releasedTail = sustainDuration(released.graph.render(1.2), SAMPLE_RATE)

      expect(releasedTail).toBeLessThan(heldTail)
      expect(releasedTail).toBeLessThan(0.5)
      expect(heldTail).toBeGreaterThan(1)
    })

    it('reaps every node once the release has run, back to the baseline graph', () => {
      expect(rig.graph.liveNodeCount).toBe(BASELINE_NODES)
      rig.engine.noteOn('a', 60, 0.8)
      rig.engine.noteOn('b', 64, 0.8)
      expect(rig.graph.liveNodeCount).toBeGreaterThan(BASELINE_NODES + 10)
      rig.engine.noteOff('a')
      rig.engine.noteOff('b')
      rig.scheduler.advance(500)
      expect(rig.engine.activeVoiceCount).toBe(0)
      expect(rig.graph.liveNodeCount).toBe(BASELINE_NODES)
      expect(rig.scheduler.pendingCount).toBe(0)
    })

    it('reaps a held voice once its partials have decayed, without a note off', () => {
      rig.engine.noteOn('a', 96, 0.8)
      rig.scheduler.advance(60_000)
      expect(rig.engine.activeVoiceCount).toBe(0)
      expect(rig.graph.liveNodeCount).toBe(BASELINE_NODES)
    })

    it('stops every owned voice on allNotesOff and leaves nothing scheduled after cleanup', () => {
      for (let index = 0; index < 6; index += 1) rig.engine.noteOn(`n${index}`, 60 + index, 0.8)
      expect(rig.engine.soundingVoiceCount).toBe(6)
      rig.engine.allNotesOff()
      expect(rig.engine.soundingVoiceCount).toBe(0)
      rig.scheduler.advance(1000)
      expect(rig.engine.activeVoiceCount).toBe(0)
      expect(rig.graph.liveNodeCount).toBe(BASELINE_NODES)
    })

    it('tears the whole graph down on dispose and ignores later notes', () => {
      rig.engine.noteOn('a', 60, 0.8)
      rig.engine.dispose()
      expect(rig.engine.activeVoiceCount).toBe(0)
      expect(rig.graph.liveNodeCount).toBe(0)
      rig.engine.noteOn('b', 62, 0.8)
      expect(rig.engine.activeVoiceCount).toBe(0)
    })

    it('ignores a note off for a note it does not own', () => {
      expect(() => rig.engine.noteOff('never-played')).not.toThrow()
      expect(rig.engine.activeVoiceCount).toBe(0)
    })
  })

  /** Feature: piano.basic-sustain-polyphony */
  describe('velocity, sustain and polyphony', () => {
    it('renders a harder strike louder than a soft one', () => {
      const soft = build()
      soft.engine.noteOn('a', 60, 0.25)
      const softPeak = peak(soft.graph.render(0.4))

      const hard = build()
      hard.engine.noteOn('a', 60, 0.95)
      const hardPeak = peak(hard.graph.render(0.4))

      expect(hardPeak).toBeGreaterThan(softPeak * 2)
      expect(velocityGain(0.95)).toBeGreaterThan(velocityGain(0.25))
    })

    it('opens the tone filter further for harder strikes', () => {
      expect(toneCutoff(60, 0.9)).toBeGreaterThan(toneCutoff(60, 0.2))
      expect(toneCutoff(84, 0.5)).toBeGreaterThan(toneCutoff(48, 0.5))
    })

    it('lets low notes ring longer than high notes', () => {
      expect(fundamentalDecay(65)).toBeGreaterThan(fundamentalDecay(1046))
      const low = build()
      low.engine.noteOn('a', 36, 0.8)
      const high = build()
      high.engine.noteOn('a', 96, 0.8)
      expect(sustainDuration(low.graph.render(4), SAMPLE_RATE)).toBeGreaterThan(
        sustainDuration(high.graph.render(4), SAMPLE_RATE),
      )
    })

    it('holds a released note while the sustain pedal is down and drops it on pedal up', () => {
      rig.engine.setSustain(true)
      rig.engine.noteOn('a', 60, 0.9)
      rig.graph.advanceClock(0.2)
      rig.engine.noteOff('a')
      expect(rig.engine.sustainedVoiceCount).toBe(1)
      expect(rig.engine.soundingVoiceCount).toBe(1)

      const sustained = sustainDuration(rig.graph.render(1.2), SAMPLE_RATE)
      rig.engine.setSustain(false)
      expect(rig.engine.sustainedVoiceCount).toBe(0)
      const damped = sustainDuration(rig.graph.render(1.2), SAMPLE_RATE)

      expect(sustained).toBeGreaterThan(1)
      expect(damped).toBeLessThan(sustained)
    })

    it('reports the pedal state it was actually given', () => {
      expect(rig.engine.sustainEngaged).toBe(false)
      rig.engine.setSustain(true)
      expect(rig.engine.sustainEngaged).toBe(true)
      rig.engine.setSustain(true)
      expect(rig.engine.sustainEngaged).toBe(true)
      rig.engine.setSustain(false)
      expect(rig.engine.sustainEngaged).toBe(false)
    })

    it('renders a chord louder than a single note of the same velocity', () => {
      const single = build()
      single.engine.noteOn('a', 60, 0.8)
      const one = rms(single.graph.render(0.5))

      const chord = build()
      chord.engine.noteOn('a', 60, 0.8)
      chord.engine.noteOn('b', 64, 0.8)
      chord.engine.noteOn('c', 67, 0.8)
      const three = rms(chord.graph.render(0.5))

      expect(chord.engine.soundingVoiceCount).toBe(3)
      expect(three).toBeGreaterThan(one)
    })

    it('steals deterministically: releasing voices first, then the oldest', () => {
      const small = build(3)
      small.engine.noteOn('a', 60, 0.8)
      small.engine.noteOn('b', 62, 0.8)
      small.engine.noteOn('c', 64, 0.8)
      small.engine.noteOff('b') // b is now releasing, so it is the first candidate
      small.engine.noteOn('d', 65, 0.8)
      expect(small.engine.activeVoiceCount).toBe(3)
      expect(small.engine.soundingNotes()).toEqual([60, 64, 65])

      small.engine.noteOn('e', 67, 0.8) // nothing is releasing: the oldest (a/60) goes
      expect(small.engine.activeVoiceCount).toBe(3)
      expect(small.engine.soundingNotes()).toEqual([64, 65, 67])
    })

    it('never exceeds its polyphony limit however many notes arrive', () => {
      const small = build(8)
      for (let index = 0; index < 40; index += 1) small.engine.noteOn(`n${index}`, 40 + index, 0.7)
      expect(small.engine.activeVoiceCount).toBe(8)
      small.engine.allNotesOff()
      small.scheduler.advance(1000)
      expect(small.graph.liveNodeCount).toBe(BASELINE_NODES)
    })
  })
})
