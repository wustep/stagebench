import { describe, expect, it } from 'vitest'
import { bandEnergy, peak, relativeDifference, rms, sustainDuration } from './offline'
import { engineRig, failingSampleFetcher, loadedRig, renderNote, settingsWith } from '../test/engineRig'

const SAMPLE_RATE = 16000

/** Feature: piano.layers */
describe('two piano layers', () => {
  it('builds one voice per enabled layer and owns each one separately', () => {
    const rig = engineRig({ settings: settingsWith({ layers: { b: { enabled: true } } }) })
    rig.engine.noteOn('n1', 60, 0.8)
    expect(rig.engine.activeVoiceCount).toBe(2)
    rig.engine.noteOff('n1')
    expect(rig.engine.soundingVoiceCount).toBe(0)
    rig.scheduler.advance(2000)
    expect(rig.engine.activeVoiceCount).toBe(0)
    expect(rig.graph.liveNodeCount).toBe(rig.baseline)
  })

  it('plays only the enabled layers', () => {
    const single = engineRig()
    single.engine.noteOn('n', 60, 0.8)
    expect(single.engine.activeVoiceCount).toBe(1)

    const both = engineRig({ settings: settingsWith({ layers: { b: { enabled: true } } }) })
    both.engine.noteOn('n', 60, 0.8)
    expect(both.engine.activeVoiceCount).toBe(2)
    expect(rms(both.graph.render(0.6))).toBeGreaterThan(rms(single.graph.render(0.6)))
  })

  it('shifts a layer by octaves without moving the other one', () => {
    const flat = engineRig({ settings: settingsWith({ layers: { a: { octave: 0 } } }) })
    const up = engineRig({ settings: settingsWith({ layers: { a: { octave: 12 } } }) })
    const low = renderNote(flat, { midi: 48, seconds: 0.8 })
    const high = renderNote(up, { midi: 48, seconds: 0.8 })
    const lowBand = bandEnergy(low, SAMPLE_RATE, 110, 180)
    const highBand = bandEnergy(high, SAMPLE_RATE, 220, 360)
    expect(bandEnergy(high, SAMPLE_RATE, 110, 180)).toBeLessThan(lowBand)
    expect(highBand).toBeGreaterThan(bandEnergy(low, SAMPLE_RATE, 220, 360) * 0.9)
    expect(relativeDifference(low, high)).toBeGreaterThan(0.5)
  })

  it('sets each layer level from its own fader', () => {
    const loud = engineRig({ settings: settingsWith({ layers: { a: { level: 1 } } }) })
    const quiet = engineRig({ settings: settingsWith({ layers: { a: { level: 0.25 } } }) })
    const loudLevel = rms(renderNote(loud, { seconds: 0.6 }))
    const quietLevel = rms(renderNote(quiet, { seconds: 0.6 }))
    expect(loudLevel).toBeGreaterThan(quietLevel * 2.5)
  })

  it('silences a layer turned off after its settings are applied', () => {
    const rig = engineRig({ settings: settingsWith({ layers: { b: { enabled: true, level: 1 } } }) })
    rig.engine.applySettings(settingsWith({ layers: { a: { enabled: false }, b: { enabled: true, level: 1 } } }))
    rig.engine.noteOn('n', 60, 0.8)
    // Layer A is off, so it builds no voice at all.
    expect(rig.engine.activeVoiceCount).toBe(1)
  })

  it('lets the two layers play different pianos at once', async () => {
    const rig = await loadedRig({
      settings: settingsWith({
        layers: { a: { type: 'grand' }, b: { enabled: true, type: 'misc', level: 0.8 } },
      }),
    })
    await rig.library!.load('grand')
    rig.engine.applySettings(rig.engine.current)
    expect(rig.engine.layer('a').playsRecordedSamples).toBe(true)
    expect(rig.engine.layer('b').playsRecordedSamples).toBe(false)
    const both = renderNote(rig, { midi: 60, seconds: 1 })

    const grandOnly = await loadedRig()
    const single = renderNote(grandOnly, { midi: 60, seconds: 1 })
    expect(relativeDifference(both, single)).toBeGreaterThan(0.2)
  })
})

/** Feature: piano.pedals */
describe('sustain and SUSTPED routing', () => {
  it('holds a released note only while the pedal is down', () => {
    const held = engineRig()
    held.engine.setSustain(true)
    held.engine.noteOn('n', 60, 0.9)
    held.graph.advanceClock(0.2)
    held.engine.noteOff('n')
    expect(held.engine.sustainedVoiceCount).toBe(1)
    const sustained = sustainDuration(held.graph.render(1.4), SAMPLE_RATE)

    const damped = engineRig()
    damped.engine.noteOn('n', 60, 0.9)
    damped.graph.advanceClock(0.2)
    damped.engine.noteOff('n')
    const short = sustainDuration(damped.graph.render(1.4), SAMPLE_RATE)
    expect(short).toBeLessThan(sustained)
  })

  it('routes the pedal only to layers whose SUSTPED is on', () => {
    const rig = engineRig({
      settings: settingsWith({
        layers: {
          a: { sustainPedal: true },
          b: { enabled: true, sustainPedal: false, level: 0.8 },
        },
      }),
    })
    rig.engine.setSustain(true)
    rig.engine.noteOn('n', 60, 0.9)
    expect(rig.engine.activeVoiceCount).toBe(2)
    rig.engine.noteOff('n')
    // Only the SUSTPED layer is held by the pedal; the other one releases immediately.
    expect(rig.engine.sustainedVoiceCount).toBe(1)
    expect(rig.engine.soundingVoiceCount).toBe(1)
  })

  it('drops sustained notes when the pedal comes up', () => {
    const rig = engineRig()
    rig.engine.setSustain(true)
    rig.engine.noteOn('n', 60, 0.9)
    rig.engine.noteOff('n')
    expect(rig.engine.sustainedVoiceCount).toBe(1)
    rig.engine.setSustain(false)
    expect(rig.engine.sustainedVoiceCount).toBe(0)
    rig.scheduler.advance(3000)
    expect(rig.engine.activeVoiceCount).toBe(0)
  })
})

/** Feature: piano.fallback */
describe('labelled fallback when the recordings cannot load', () => {
  it('reports the failure, stays playable, and never claims the library is ready', async () => {
    const rig = engineRig({ fetcher: failingSampleFetcher })
    await rig.library!.load('grand').catch(() => undefined)
    const report = rig.engine.sampleReport()
    expect(report.sets.grand).toBe('failed')
    expect(report.fallbackActive).toBe(true)
    expect(report.message).toMatch(/failed to load/i)
    expect(report.message).toMatch(/fallback/i)
    expect(rig.engine.layer('a').playsRecordedSamples).toBe(false)
    // The keybed still makes sound: the fallback is a real voice, not silence.
    expect(peak(renderNote(rig, { midi: 60, seconds: 0.6 }))).toBeGreaterThan(0.05)
  })

  it('says so honestly when there are no sample assets at all', () => {
    const rig = engineRig({ fetcher: null })
    const report = rig.engine.sampleReport()
    expect(report.sets.grand).toBe('unavailable')
    expect(report.fallbackActive).toBe(true)
    expect(report.message).toMatch(/fallback/i)
    expect(report.message).not.toMatch(/ready/i)
  })

  it('reports no fallback for the synthesised types, which are not recordings', () => {
    const rig = engineRig({ fetcher: null, settings: settingsWith({ layers: { a: { type: 'clav' } } }) })
    expect(rig.engine.sampleReport().fallbackActive).toBe(false)
    expect(peak(renderNote(rig, { midi: 60, seconds: 0.6 }))).toBeGreaterThan(0.05)
  })
})
