import { describe, expect, it } from 'vitest'
import {
  layerZoneGain,
  resolveZoneBounds,
  SPLIT_NOTE_MIDI,
  SPLIT_POSITIONS,
  zoneIndexForNote,
  type SplitState,
} from '../src/model/program-types'
import { PianoEngine } from '../src/audio/piano-engine'
import { createMockContextFactory } from '../src/test/mock-audio'

describe('splits.zones', () => {
  it('documents 11 split positions', () => {
    expect(SPLIT_POSITIONS).toHaveLength(11)
    expect(SPLIT_NOTE_MIDI.C4).toBe(60)
  })

  it('resolves up to 4 zones from split points', () => {
    const split: SplitState = {
      on: true,
      points: {
        Low: { enabled: true, note: 'C3', crossfade: 0 },
        Mid: { enabled: true, note: 'C4', crossfade: 0 },
        High: { enabled: true, note: 'C5', crossfade: 0 },
      },
    }
    const zones = resolveZoneBounds(split)
    expect(zones.length).toBe(4)
    expect(zoneIndexForNote(40, split)).toBe(0)
    expect(zoneIndexForNote(55, split)).toBe(1)
    expect(zoneIndexForNote(65, split)).toBe(2)
    expect(zoneIndexForNote(90, split)).toBe(3)
  })

  it('crossfade Off/±6/±12 affect gains', () => {
    const off: SplitState = {
      on: true,
      points: {
        Low: { enabled: false, note: 'C3', crossfade: 0 },
        Mid: { enabled: true, note: 'C4', crossfade: 0 },
        High: { enabled: false, note: 'C5', crossfade: 0 },
      },
    }
    const lowZones: [boolean, boolean, boolean, boolean] = [true, false, false, false]
    const highZones: [boolean, boolean, boolean, boolean] = [false, true, true, true]
    expect(layerZoneGain(48, off, lowZones)).toBe(1)
    expect(layerZoneGain(72, off, lowZones)).toBe(0)
    expect(layerZoneGain(72, off, highZones)).toBe(1)

    const xf: SplitState = {
      on: true,
      points: {
        Low: { enabled: false, note: 'C3', crossfade: 0 },
        Mid: { enabled: true, note: 'C4', crossfade: 6 },
        High: { enabled: false, note: 'C5', crossfade: 0 },
      },
    }
    // near split with crossfade — low zone still has presence left of split
    expect(layerZoneGain(55, xf, lowZones)).toBeGreaterThan(0)
  })

  it('routes notes audibly by zone assignment', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    engine.setPianoState({ sectionOn: true })
    engine.updateLayer('A', {
      enabled: true,
      zones: [true, false, false, false],
    })
    engine.setProgramExtras({
      split: {
        on: true,
        points: {
          Low: { enabled: false, note: 'C3', crossfade: 0 },
          Mid: { enabled: true, note: 'C4', crossfade: 0 },
          High: { enabled: false, note: 'C5', crossfade: 0 },
        },
      },
    })
    engine.noteOn(48, 0.8) // low zone
    expect(engine.getActiveVoiceCount()).toBe(1)
    engine.allNotesOff()
    engine.noteOn(72, 0.8) // high zone — layer A not assigned
    expect(engine.getActiveVoiceCount()).toBe(0)
    engine.dispose()
  })
})
