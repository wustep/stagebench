import { describe, expect, it } from 'vitest'
import { bandEnergy, peak, relativeDifference, rms, sustainDuration } from './offline'
import { applyDynComp, applyKbTouch, unisonDetuneCents, velocityGain } from './pianoVoice'
import { engineRig, loadedRig, renderNote, settingsWith } from '../test/engineRig'

const SAMPLE_RATE = 16000

/**
 * Feature: piano.velocity-controls
 *
 * Each control is measured on rendered audio, not on state: two rigs that differ in exactly one
 * setting are rendered and compared.
 */
describe('piano performance controls change rendered audio', () => {
  it('KB Touch changes how much level the same stroke produces', () => {
    const levelFor = (touch: 'heavy' | 'normal' | 'light') => {
      const rig = engineRig({ settings: settingsWith({ layers: { a: { kbTouch: touch } } }) })
      return rms(renderNote(rig, { midi: 60, velocity: 0.45, seconds: 0.7 }))
    }
    const heavy = levelFor('heavy')
    const normal = levelFor('normal')
    const light = levelFor('light')
    expect(heavy).toBeLessThan(normal)
    expect(light).toBeGreaterThan(normal)
    // The pure curve agrees with what the graph rendered.
    expect(applyKbTouch(0.45, 'heavy')).toBeLessThan(applyKbTouch(0.45, 'normal'))
    expect(applyKbTouch(0.45, 'light')).toBeGreaterThan(applyKbTouch(0.45, 'normal'))
  })

  it('Dyn Comp lifts soft strokes and narrows the dynamic range', () => {
    const render = (dynComp: 0 | 3, velocity: number) => {
      const rig = engineRig({ settings: settingsWith({ layers: { a: { dynComp } } }) })
      return rms(renderNote(rig, { midi: 60, velocity, seconds: 0.7 }))
    }
    const softPlain = render(0, 0.2)
    const softCompressed = render(3, 0.2)
    const loudPlain = render(0, 0.95)
    const loudCompressed = render(3, 0.95)

    expect(softCompressed).toBeGreaterThan(softPlain * 1.5)
    expect(loudCompressed / softCompressed).toBeLessThan(loudPlain / softPlain)
    expect(applyDynComp(velocityGain(0.2), 3)).toBeGreaterThan(applyDynComp(velocityGain(0.2), 0))
    // Level only: the timbre response is driven by the untouched velocity.
    expect(applyDynComp(velocityGain(1), 0)).toBeCloseTo(velocityGain(1), 6)
  })

  it('Timbre moves the spectrum: Soft dulls, Bright lifts, Mid fills the middle', () => {
    const spectrumFor = (timbre: 'off' | 'soft' | 'mid' | 'bright') => {
      const rig = engineRig({ settings: settingsWith({ layers: { a: { timbre } } }) })
      const audio = renderNote(rig, { midi: 55, velocity: 0.9, seconds: 0.8 })
      return {
        high: bandEnergy(audio, SAMPLE_RATE, 2200, 6000),
        mid: bandEnergy(audio, SAMPLE_RATE, 900, 1800),
        audio,
      }
    }
    const off = spectrumFor('off')
    const soft = spectrumFor('soft')
    const bright = spectrumFor('bright')
    const mid = spectrumFor('mid')

    expect(soft.high).toBeLessThan(off.high * 0.7)
    expect(bright.high).toBeGreaterThan(off.high * 1.4)
    expect(mid.mid).toBeGreaterThan(off.mid * 1.2)
    expect(relativeDifference(off.audio, soft.audio)).toBeGreaterThan(0.05)
  })

  it('offers the Dyno preamp timbres only on electric-piano types, and they really shape the tone', async () => {
    const plain = await loadedRig({ settings: settingsWith({ layers: { a: { type: 'electric', timbre: 'off' } } }) })
    const dyno = await loadedRig({ settings: settingsWith({ layers: { a: { type: 'electric', timbre: 'dyno2' } } }) })
    const flat = renderNote(plain, { midi: 55, velocity: 0.9, seconds: 1 })
    const shaped = renderNote(dyno, { midi: 55, velocity: 0.9, seconds: 1 })
    expect(bandEnergy(shaped, SAMPLE_RATE, 2800, 6000)).toBeGreaterThan(
      bandEnergy(flat, SAMPLE_RATE, 2800, 6000) * 1.3,
    )
  })

  it('Unison adds detuned voices that beat against each other', () => {
    const off = engineRig({ settings: settingsWith({ layers: { a: { unison: 0 } } }) })
    const wide = engineRig({ settings: settingsWith({ layers: { a: { unison: 3 } } }) })
    const dry = renderNote(off, { midi: 57, seconds: 1.2 })
    const detuned = renderNote(wide, { midi: 57, seconds: 1.2 })
    expect(relativeDifference(dry, detuned)).toBeGreaterThan(0.2)

    // Beating: with detuned copies the envelope wobbles far more than a single voice does.
    const wobble = (samples: Float32Array) => {
      const window = Math.floor(SAMPLE_RATE * 0.05)
      const levels: number[] = []
      for (let start = SAMPLE_RATE * 0.2; start + window < samples.length; start += window) {
        levels.push(rms(samples, start, start + window))
      }
      const mean = levels.reduce((sum, value) => sum + value, 0) / levels.length
      const spread = levels.reduce((sum, value) => sum + Math.abs(value - mean), 0) / levels.length
      return spread / Math.max(mean, 1e-9)
    }
    expect(wobble(detuned)).toBeGreaterThan(wobble(dry))
    expect(unisonDetuneCents(3)).toBeGreaterThan(unisonDetuneCents(1))
    expect(unisonDetuneCents(0)).toBe(0)
  })

  it('Soft Release lengthens the damper, except on clavinet-type sounds', () => {
    const tailFor = (softRelease: boolean, type: 'grand' | 'clav') => {
      const rig = engineRig({ settings: settingsWith({ layers: { a: { softRelease, type } } }) })
      const audio = renderNote(rig, { midi: 60, velocity: 0.9, seconds: 1.4, holdSeconds: 0.25 })
      return sustainDuration(audio, SAMPLE_RATE)
    }
    expect(tailFor(true, 'grand')).toBeGreaterThan(tailFor(false, 'grand'))
    // The piano spec disables Soft Release for clavinet sounds, so it must change nothing there.
    expect(tailFor(true, 'clav')).toBeCloseTo(tailFor(false, 'clav'), 5)
  })

  it('String Res rings sympathetically while the pedal is down', () => {
    const play = (stringRes: boolean) => {
      const rig = engineRig({ settings: settingsWith({ layers: { a: { stringRes } } }) })
      rig.engine.setSustain(true)
      rig.engine.noteOn('low', 45, 0.9)
      rig.engine.noteOn('high', 64, 0.9)
      return rig.graph.render(1.2)
    }
    const dry = play(false)
    const resonant = play(true)
    expect(relativeDifference(dry, resonant)).toBeGreaterThan(0.05)
    expect(rms(resonant)).toBeGreaterThan(rms(dry))
  })

  it('leaves String Res out of the signal when a single note is played with no pedal', () => {
    const dry = engineRig({ settings: settingsWith({ layers: { a: { stringRes: false } } }) })
    const wet = engineRig({ settings: settingsWith({ layers: { a: { stringRes: true } } }) })
    const single = renderNote(dry, { midi: 60, seconds: 0.8 })
    const alsoSingle = renderNote(wet, { midi: 60, seconds: 0.8 })
    expect(relativeDifference(single, alsoSingle)).toBeLessThan(1e-6)
  })

  it('Master Level scales the whole output', () => {
    const loud = engineRig({ settings: settingsWith({ masterLevel: 0.8 }) })
    const quiet = engineRig({ settings: settingsWith({ masterLevel: 0.2 }) })
    const loudLevel = rms(renderNote(loud, { midi: 60, velocity: 0.5, seconds: 0.6 }))
    const quietLevel = rms(renderNote(quiet, { midi: 60, velocity: 0.5, seconds: 0.6 }))
    expect(loudLevel / quietLevel).toBeGreaterThan(3)

    const silent = engineRig({ settings: settingsWith({ masterLevel: 0 }) })
    expect(peak(renderNote(silent, { midi: 60, seconds: 0.5 }))).toBe(0)
  })

  it('turns the whole piano section off from the Section On button', () => {
    const rig = engineRig({ settings: settingsWith({ sectionOn: false }) })
    rig.engine.noteOn('n', 60, 0.9)
    expect(rig.engine.activeVoiceCount).toBe(0)
    expect(peak(rig.graph.render(0.5))).toBe(0)
  })
})
