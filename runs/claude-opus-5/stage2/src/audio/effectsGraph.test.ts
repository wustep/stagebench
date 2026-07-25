import { describe, expect, it } from 'vitest'
import { LayerChain } from './layer'
import { difference, peak, relativeDifference, rms, sustainDuration } from './offline'
import { engineRig, renderNote, settingsWith } from '../test/engineRig'
import type { ChainSettings } from './settings'

const SAMPLE_RATE = 16000

const ALL_ON: Partial<ChainSettings> = {
  mod1: { on: true, type: 'tremolo', rate: 0.5, amount: 0.8 },
  mod2: { on: true, type: 'chorus', rate: 0.5, amount: 0.7 },
  delay: { on: true, tempo: 0.3, feedback: 0.6, mix: 0.4, filter: 'lp' },
  amp: { on: true, type: 'twin', drive: 0.5, bass: 4, mid: 3, treble: 4, midFrequency: 1000 },
  compressor: { on: true, amount: 0.6 },
  reverb: { on: true, type: 'hall', mix: 0.5, tone: 'normal' },
}

/** Feature: effects.graph */
describe('one audio graph, ordered and terminated', () => {
  it('keeps the documented signal order in the chain itself', () => {
    expect(LayerChain.ORDER).toEqual(['mod1', 'mod2', 'delay', 'ampEq', 'compressor', 'reverb'])
  })

  it('feeds exactly one destination connection through the master limiter', () => {
    const rig = engineRig({ settings: settingsWith({ layers: { a: { chain: ALL_ON }, b: { enabled: true } } }) })
    rig.engine.noteOn('n', 60, 0.9)
    // The destination has a single input: the limiter that follows the master gain.
    expect(rig.graph.destination.inputs.size).toBe(1)
    expect([...rig.graph.destination.inputs][0]).toBe(rig.engine.limiter)
    expect(rig.engine.context).toBe(rig.graph)
  })

  it('lets the master gain silence every configuration, including To Rotary', () => {
    const configurations = [
      settingsWith({ layers: { a: { chain: ALL_ON } } }),
      settingsWith({
        layers: {
          a: { chain: { ...ALL_ON, amp: { on: true, type: 'rotary', drive: 0.3, bass: 0, mid: 0, treble: 0, midFrequency: 1000 } } },
          b: { enabled: true },
        },
      }),
      settingsWith({ effectsOn: false }),
    ]
    for (const settings of configurations) {
      const rig = engineRig({ settings })
      rig.engine.noteOn('n', 60, 0.9)
      expect(peak(rig.graph.render(0.6))).toBeGreaterThan(0)
      rig.engine.applySettings(settingsWith({ masterLevel: 0 }, settings))
      // Measured after the short click-free ramp the master gain uses.
      expect(peak(rig.graph.render(0.6), Math.floor(0.08 * SAMPLE_RATE))).toBe(0)
    }
  })

  it('routes a To Rotary layer out of the piano bus and into the shared rotary', () => {
    const rotarySettings = settingsWith({
      layers: {
        a: {
          chain: { amp: { on: true, type: 'rotary', drive: 0.3, bass: 0, mid: 0, treble: 0, midFrequency: 1000 } },
        },
      },
    })
    const rig = engineRig({ settings: rotarySettings })
    rig.engine.noteOn('n', 60, 0.9)
    const throughRotary = rig.graph.render(0.8)
    expect(peak(throughRotary)).toBeGreaterThan(0)

    // Muting the piano bus does not silence it: the layer left that bus for the rotary.
    rig.engine.pianoBus.gain.value = 0
    expect(peak(rig.graph.render(0.8))).toBeGreaterThan(0)
    // Muting the master does, because the rotary still feeds the same master path.
    rig.engine.master.gain.value = 0
    expect(peak(rig.graph.render(0.8))).toBe(0)
    expect(peak(throughRotary)).toBeGreaterThan(0)
  })

  it('places Reverb before the Rotary for a routed layer', () => {
    const base = {
      amp: { on: true, type: 'rotary' as const, drive: 0.2, bass: 0, mid: 0, treble: 0, midFrequency: 1000 },
    }
    const dry = engineRig({ settings: settingsWith({ layers: { a: { chain: base } } }) })
    const wet = engineRig({
      settings: settingsWith({
        layers: { a: { chain: { ...base, reverb: { on: true, type: 'cathedral', mix: 0.9, tone: 'normal' } } } },
      }),
    })
    const dryTail = sustainDuration(renderNote(dry, { midi: 60, seconds: 3, holdSeconds: 0.2 }), SAMPLE_RATE)
    const wetTail = sustainDuration(renderNote(wet, { midi: 60, seconds: 3, holdSeconds: 0.2 }), SAMPLE_RATE)
    // The reverb tail reaches the destination through the rotary, so it must be in front of it.
    expect(wetTail).toBeGreaterThan(dryTail + 0.3)
  })

  it('bypasses every effect at once from the Layer Effects On button', () => {
    const loud = engineRig({ settings: settingsWith({ layers: { a: { chain: ALL_ON } } }) })
    const bypassed = engineRig({ settings: settingsWith({ effectsOn: false, layers: { a: { chain: ALL_ON } } }) })
    const clean = engineRig()
    const withEffects = renderNote(loud, { midi: 60, velocity: 0.9, seconds: 1.2 })
    const withoutEffects = renderNote(bypassed, { midi: 60, velocity: 0.9, seconds: 1.2 })
    const noUnits = renderNote(clean, { midi: 60, velocity: 0.9, seconds: 1.2 })

    expect(relativeDifference(withEffects, withoutEffects)).toBeGreaterThan(0.3)
    // All-effects bypass is identical to having no unit switched on at all.
    expect(difference(withoutEffects, noUnits)).toBeLessThan(1e-6)
  })

  it('returns every node it created once the voices are reaped', () => {
    const rig = engineRig({ settings: settingsWith({ layers: { a: { chain: ALL_ON }, b: { enabled: true } } }) })
    const baseline = rig.graph.liveNodeCount
    for (let index = 0; index < 6; index += 1) rig.engine.noteOn(`n${index}`, 55 + index, 0.8)
    expect(rig.graph.liveNodeCount).toBeGreaterThan(baseline + 20)
    rig.engine.allNotesOff()
    rig.scheduler.advance(5000)
    expect(rig.engine.activeVoiceCount).toBe(0)
    expect(rig.graph.liveNodeCount).toBe(baseline)
    expect(rig.scheduler.pendingCount).toBe(0)
  })

  it('tears down the whole graph on dispose, effects included', () => {
    const rig = engineRig({ settings: settingsWith({ layers: { a: { chain: ALL_ON }, b: { enabled: true } } }) })
    rig.engine.noteOn('n', 60, 0.9)
    rig.engine.dispose()
    expect(rig.graph.liveNodeCount).toBe(0)
    expect(peak(rig.graph.render(0.4))).toBe(0)
  })

  it('changes a unit type without leaking the old wet path', () => {
    const rig = engineRig()
    const baseline = rig.graph.liveNodeCount
    for (const type of ['tremolo', 'ringmod', 'awah', 'wah', 'pump', 'apan'] as const) {
      rig.engine.applySettings(settingsWith({ layers: { a: { chain: { mod1: { on: true, type, rate: 0.4, amount: 0.6 } } } } }))
    }
    rig.engine.applySettings(settingsWith({ layers: { a: { chain: { mod1: { on: false, type: 'apan', rate: 0.36, amount: 0.65 } } } } }))
    // Back to the same unit type as the start: the node count must be back where it started.
    expect(rig.graph.liveNodeCount).toBe(baseline)
  })

  it('starts and stays silent until a note is played', () => {
    const rig = engineRig({ settings: settingsWith({ layers: { a: { chain: ALL_ON }, b: { enabled: true } } }) })
    expect(peak(rig.graph.render(0.5))).toBe(0)
    expect(rms(rig.graph.render(0.5))).toBe(0)
  })
})
