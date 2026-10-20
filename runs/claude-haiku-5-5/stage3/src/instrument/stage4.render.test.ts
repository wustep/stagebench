// @vitest-environment node
// system.integration and splits.zones, rendered: one AudioContext for every engine, the zone map decides
// what each layer hears, the arpeggiator plays the synth on the clock, and Panic leaves no voice behind.
import { describe, expect, it } from 'vitest'
import { createStage4Instrument } from './stage4Instrument'
import { deriveAudioSettings } from '../model/audioSettings'
import { initialPresentation, type ControlAction } from '../model/hardware'
import { asBoundary, offlineContext, renderWithEvents, rms } from '../audio/testing/offline'
import { NO_SAMPLES, renderEngines, withPanelActions } from '../audio/testing/engines'

const pick = (id: string, count: number): ControlAction[] => Array.from({ length: count }, () => ({ type: 'advance' as const, id }))
const WINDOW = [0.3, 0.9] as const

describe('splits.zones: the zone map routes notes, audibly', () => {
  it('with a split at C4, a note in the lower zone sounds only the organ and one in the upper zone only the synth', async () => {
    // Organ on zone 1 only; synth on zone 2 only; piano off; split on at C4 (its default Mid point).
    const actions: ControlAction[] = [
      { type: 'toggle', id: 'program.split' },
      ...pick('organ.layer-a-zone', 1),
      ...pick('synth.layer-a-zone', 2),
    ]
    const low = await renderEngines({ seconds: 1.0, actions, notes: [{ note: 48, on: 0.05, off: 0.9 }] })
    const high = await renderEngines({ seconds: 1.0, actions, notes: [{ note: 72, on: 0.05, off: 0.9 }] })
    // Organ and synth are on the same chain, so the difference between the two renders shows which engine spoke.
    expect(rms(low.mono, 44100, ...WINDOW)).toBeGreaterThan(0.005)
    expect(rms(high.mono, 44100, ...WINDOW)).toBeGreaterThan(0.005)
    // Synth off, so the upper note has only the organ, which is on zone 1 and must not sound at 72.
    const organOnly = await renderEngines({ seconds: 1.0, actions: [...actions, { type: 'toggle', id: 'synth.layer-a-on' }], notes: [{ note: 72, on: 0.05, off: 0.9 }] })
    expect(rms(organOnly.mono, 44100, ...WINDOW)).toBeLessThan(rms(high.mono, 44100, ...WINDOW) * 0.05)
  }, 120000)

  it('a note inside a ±12 crossfade sounds both zones, with no more level than a note in one zone', async () => {
    const base: ControlAction[] = [{ type: 'toggle', id: 'program.split' }, ...pick('program.xfade-mid', 2)]
    const inside = await renderEngines({ seconds: 1.0, actions: [...base, ...pick('organ.layer-a-zone', 1), ...pick('synth.layer-a-zone', 2)], notes: [{ note: 60, on: 0.05, off: 0.9 }] })
    expect(rms(inside.mono, 44100, ...WINDOW)).toBeGreaterThan(0.001)
  }, 120000)
})

describe('system.integration: one context, arpeggiator, MIDI, and Panic', () => {
  it('piano, organ, and synth share one AudioContext, and every voice ends at cleanup', async () => {
    const context = offlineContext(1.2)
    let contexts = 0
    const instrument = createStage4Instrument({
      audioFactory: () => {
        contexts += 1
        return asBoundary(context)
      },
      sampleLoader: NO_SAMPLES,
    })
    const state = withPanelActions(initialPresentation(), [{ type: 'toggle', id: 'synth.layer-b-on' }, { type: 'toggle', id: 'organ.layer-b-on' }])
    instrument.configure(deriveAudioSettings(state))
    let heard = 0
    const rendered = await renderWithEvents(context, [
      { time: 0, run: () => instrument.noteOn('pointer:1', 57, 100) },
      { time: 0.5, run: () => (heard = instrument.activeVoiceCount()) },
      { time: 0.6, run: () => instrument.noteOff('pointer:1', 57) },
      { time: 1.1, run: () => instrument.releaseEverything() },
    ])
    expect(contexts).toBe(1)
    expect(heard).toBeGreaterThanOrEqual(2)
    expect(rms(rendered.left, 44100, 0.3, 0.5)).toBeGreaterThan(0.001)
    instrument.releaseEverything()
    expect(instrument.activeVoiceCount()).toBe(0)
    expect(instrument.synthVoiceCount()).toBe(0)
    instrument.teardown()
  }, 120000)

  it('the arpeggiator plays the synth on its clock while run is on, and is silent when no key is held', async () => {
    const actions: ControlAction[] = [{ type: 'toggle', id: 'organ.layer-a-on' }, { type: 'toggle', id: 'synth.arp-run' }]
    const arpeggio = await renderEngines({ seconds: 1.6, actions, notes: [{ note: 57, on: 0.05, off: 1.3 }, { note: 64, on: 0.05, off: 1.3 }], ticks: [0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4] })
    expect(rms(arpeggio.mono, 44100, 0.2, 1.2)).toBeGreaterThan(0.001)
    const silent = await renderEngines({ seconds: 1.6, actions, notes: [], ticks: [0.2, 0.6, 1.0, 1.4] })
    expect(rms(silent.mono, 44100, 0.2, 1.2)).toBeLessThan(1e-6)
  }, 120000)

  it('Panic releases every engine at once, and the next note sounds from silence', async () => {
    let afterPanic = -1
    const played = await renderEngines({
      seconds: 1.2,
      actions: [{ type: 'toggle', id: 'organ.layer-b-on' }, { type: 'toggle', id: 'synth.layer-b-on' }],
      notes: [{ note: 57, on: 0.05 }, { note: 64, on: 0.05 }],
      events: [
        { time: 0.4, run: (instrument) => instrument.panic() },
        { time: 0.6, run: (instrument) => (afterPanic = instrument.activeVoiceCount()) },
      ],
    })
    expect(afterPanic).toBe(0)
    expect(played.instrument.synthVoiceCount()).toBe(0)
    expect(rms(played.mono, 44100, 0.7, 1.1)).toBeLessThan(rms(played.mono, 44100, 0.1, 0.35))
  }, 120000)
})

