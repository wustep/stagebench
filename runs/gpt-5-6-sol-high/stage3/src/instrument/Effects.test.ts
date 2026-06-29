import { describe, expect, it } from 'vitest'
import { EFFECT_TYPES, EffectsRack } from './Effects'

describe('effects routing', () => {
  it('exposes every required effect and controls bypass, mix and targeting', () => {
    expect(EFFECT_TYPES).toEqual(expect.arrayContaining([
      'reverb', 'delay', 'chorus', 'ensemble', 'phaser', 'flanger', 'tremolo', 'ring-mod',
      'rotary', 'eq', 'compressor', 'drive', 'amp-sim', 'spin', 'pump', 'space-delay', 'flam-delay',
    ]))
    const rack = new EffectsRack()
    rack.add('piano-a', 'chorus', 0.4)
    rack.add('piano-a', 'space-delay', 0.7)
    rack.setBypass('piano-a', 0, true)
    rack.setMix('piano-a', 1, 4)
    expect(rack.chain('piano-a')).toMatchObject([
      { type: 'chorus', bypassed: true, mix: 0.4 },
      { type: 'space-delay', bypassed: false, mix: 1 },
    ])
  })

  it('reorders effects and shares the organ target chain', () => {
    const rack = new EffectsRack()
    rack.add('organ-a', 'drive', 0.2)
    rack.add('organ-b', 'rotary', 1)
    expect(rack.chain('organ-a').map((slot) => slot.type)).toEqual(['drive', 'rotary'])
    rack.move('organ-a', 1, 0)
    expect(rack.chain('organ-b').map((slot) => slot.type)).toEqual(['rotary', 'drive'])
  })
})
