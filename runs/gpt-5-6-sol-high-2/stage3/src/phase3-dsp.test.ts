import { describe, expect, it } from 'vitest'
import { rms } from './dsp'
import { createInitialInstrumentState, createOrganLayer, createSynthLayer, SYNTH_WAVEFORMS } from './instrument'
import { renderCompleteInstrumentNote, renderOrganNote, renderSynthNote, voicePlan } from './phase3-dsp'

const signature = (signal: Float32Array) => {
  let sum = 0
  for (let index = 0; index < signal.length; index += 19) sum += signal[index] * (1 + index % 17)
  return sum.toFixed(5)
}

describe('rendered Organ engine', () => {
  it('renders B3, Vox, Farf, and Pipe as distinct spectral engines', () => {
    const models = ['B3', 'Vox', 'Farf', 'Pipe 1'] as const
    const rendered = models.map((model) => renderOrganNote(createOrganLayer(model, true)))
    expect(new Set(rendered.map(signature)).size).toBe(models.length)
    for (const signal of rendered) expect(rms(signal)).toBeGreaterThan(.005)
  })

  it('makes all drawbars, B3 percussion, key click, and vibrato/chorus audible', () => {
    const layer = createOrganLayer('B3', true)
    layer.keyClick = false; layer.percussion = false; layer.drawbars = Array(9).fill(0)
    const silence = renderOrganNote(layer)
    expect(rms(silence)).toBe(0)
    const signatures = Array.from({ length: 9 }, (_, index) => {
      const candidate = structuredClone(layer); candidate.drawbars[index] = 8
      return signature(renderOrganNote(candidate))
    })
    expect(new Set(signatures).size).toBe(9)
    const base = createOrganLayer('B3', true); base.keyClick = false; base.percussion = false
    const percussion = structuredClone(base); percussion.percussion = true
    const click = structuredClone(base); click.keyClick = true
    const vibrato = structuredClone(base); vibrato.vibratoOn = true; vibrato.vibrato = 'V3'
    const chorus = structuredClone(base); chorus.vibratoOn = true; chorus.vibrato = 'C1'
    expect(new Set([base, percussion, click, vibrato, chorus].map((item) => signature(renderOrganNote(item)))).size).toBe(5)
  })
})

describe('rendered Synth engine', () => {
  it('contains the exact required waveform list and distinct category behavior with category-correct Osc Ctrl', () => {
    expect(Object.values(SYNTH_WAVEFORMS).flat()).toEqual([
      'Sine', 'Triangle', 'Saw', 'Square', 'Pulse 33', 'Pulse 10', 'White Noise',
      'Sync Saw', 'Sync Square', 'Multi Saw', 'Multi Saw 8ve', 'Super Saw', 'Super Square', 'FM 2-op (algorithm A)',
    ])
    const plans = [
      createSynthLayer('Saw', 'Pure', true), createSynthLayer('Sync Saw', 'Sync', true),
      createSynthLayer('Multi Saw', 'Multi', true), createSynthLayer('Super Saw', 'Super', true),
      createSynthLayer('FM 2-op (algorithm A)', 'FM-H', true),
    ]
    expect(new Set(plans.map((layer) => signature(renderSynthNote(layer)))).size).toBe(5)
    const pureA = createSynthLayer('Saw', 'Pure', true); pureA.oscCtrl = .1
    const pureB = structuredClone(pureA); pureB.oscCtrl = .9
    expect(signature(renderSynthNote(pureA))).toBe(signature(renderSynthNote(pureB)))
    for (const plan of plans.slice(1)) {
      const low = structuredClone(plan); low.oscCtrl = .05
      const high = structuredClone(plan); high.oscCtrl = .9
      expect(signature(renderSynthNote(low))).not.toBe(signature(renderSynthNote(high)))
    }
  })

  it('makes filters, tracking, resonance, drive, all envelopes, LFO, unison, and clock sync observable', () => {
    const base = createSynthLayer('Super Saw', 'Super', true)
    const variants = [
      { filterType: 'HP' as const }, { filterType: 'BP' as const }, { filterFreq: .18 },
      { filterResonance: .9 }, { filterDrive: 3 as const },
      { ampEnvelope: { ...base.ampEnvelope, attack: .8 } },
      { filterEnvelope: { ...base.filterEnvelope, amount: .95, decay: .08 } },
      { oscEnvelope: { ...base.oscEnvelope, amount: .9, attack: .4 } },
      { lfoDestination: 'Filter Freq' as const, lfoAmount: .8, lfoWaveform: 'Square' as const },
      { unison: 3 as const }, { vibratoMode: 'On' as const, vibratoAmount: .9, vibratoRate: 7.4 },
      { arpRun: true, arpMode: 'Arp' as const, arpRange: 3 as const, arpDirection: 'Down' as const, arpRate: .8 },
      { arpRun: true, arpMode: 'Gate' as const, arpRate: .2 },
    ]
    const original = signature(renderSynthNote(base))
    for (const patch of variants) expect(signature(renderSynthNote({ ...base, ...patch }))).not.toBe(original)
    const noTracking = { ...base, filterTracking: 'Off' as const }
    const fullTracking = { ...base, filterTracking: '1' as const }
    expect(signature(renderSynthNote(noTracking, 84))).not.toBe(signature(renderSynthNote(fullTracking, 84)))
    const synced = { ...base, lfoDestination: 'Osc Pitch' as const, lfoAmount: .7, lfoSync: true }
    expect(signature(renderSynthNote(synced, 60, .8, 1, 12000, 90))).not.toBe(signature(renderSynthNote(synced, 60, .8, 1, 12000, 180)))
  })

  it('plans poly/mono/legato priority and glide-capable ownership deterministically', () => {
    const layer = createSynthLayer('Saw', 'Pure', true)
    expect(voicePlan(layer, [67, 60, 64])).toEqual([60, 64, 67])
    layer.voiceMode = 'Mono'; layer.priority = 'Low'
    expect(voicePlan(layer, [67, 60, 64])).toEqual([60])
    layer.priority = 'High'
    expect(voicePlan(layer, [67, 60, 64])).toEqual([67])
    layer.voiceMode = 'Legato'; layer.priority = 'Off'; layer.glide = .7
    expect(voicePlan(layer, [60, 64], 60)).toEqual([60])
    expect(signature(renderSynthNote(layer, 72, .8, 1, 12000, 120, 60))).not.toBe(signature(renderSynthNote({ ...layer, glide: 0 }, 72, .8, 1, 12000, 120, 60)))
  })
})

describe('complete rendered integration', () => {
  it('routes Piano, Organ, and Synth through splits, morphs, effects, rotary, transpose, and one master path', () => {
    const state = createInitialInstrumentState()
    state.organ.layers.A.enabled = true
    state.synth.layers.A.enabled = true
    state.synth.layers.A.category = 'FM-H'; state.synth.layers.A.waveform = 'FM 2-op (algorithm A)'
    state.effects.A.delay = { ...state.effects.A.delay, on: true, mix: .5 }
    state.organ.effects.reverb = { ...state.organ.effects.reverb, on: true, mix: .5 }
    state.synth.effects.A.mod1 = { ...state.synth.effects.A.mod1, on: true, type: 'Ring Mod' }
    const complete = renderCompleteInstrumentNote(state)
    expect(rms(complete)).toBeGreaterThan(.005)
    const changed = structuredClone(state)
    changed.transpose = 5; changed.masterLevel = .2; changed.rotaryFast = true
    expect(signature(renderCompleteInstrumentNote(changed))).not.toBe(signature(complete))
    expect(rms(renderCompleteInstrumentNote(changed))).toBeLessThan(rms(complete))
  })
})
