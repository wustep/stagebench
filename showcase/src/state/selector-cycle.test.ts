import { describe, expect, it } from 'vitest'
import {
  AMP_TYPES,
  InstrumentStore,
  MOD1_TYPES,
  MOD2_TYPES,
  ORGAN_MODELS,
  PIANO_TYPE_CYCLE,
  REVERB_TYPES,
  VIBRATO_TYPES,
} from './instrument'

describe('triangle selector press order', () => {
  it('Organ Model follows the LED grid (FARF/PIPE1, VOX/PIPE2, B3/B3 BASS)', () => {
    const store = new InstrumentStore()
    expect(store.getState().organ.layers.A.model).toBe('B3')
    const trail = [store.getState().organ.layers.A.model]
    for (let i = 0; i < ORGAN_MODELS.length; i++) {
      store.cycleOrganModel()
      trail.push(store.getState().organ.layers.A.model)
    }
    expect(trail).toEqual(['B3', 'B3Bass', 'Farf', 'Pipe1', 'Vox', 'Pipe2', 'B3'])
  })

  it('Piano Select follows the LED grid (ELECTRIC/CLAV, UPRIGHT/DIGITAL, GRAND/MISC)', () => {
    const store = new InstrumentStore()
    expect(store.getState().layers.A.type).toBe('Grand')
    const trail = [store.getState().layers.A.type]
    for (let i = 0; i < PIANO_TYPE_CYCLE.length; i++) {
      store.cyclePianoType()
      trail.push(store.getState().layers.A.type)
    }
    expect(trail).toEqual(['Grand', 'Misc', 'Electric', 'Clav', 'Upright', 'Digital', 'Grand'])
  })

  it('Mod 1, Mod 2, Reverb, and Amp Sim cycles match their triangle grids', () => {
    const store = new InstrumentStore()
    const chain = () => store.getState().chains.A

    const mod1 = [chain().mod1.type]
    for (let i = 0; i < MOD1_TYPES.length; i++) {
      store.cycleMod1Type()
      mod1.push(chain().mod1.type)
    }
    expect(mod1).toEqual(['Tremolo', 'Wah', 'A-Pan', 'Pump', 'Ring Mod', 'A-Wah', 'Tremolo'])

    const mod2 = [chain().mod2.type]
    for (let i = 0; i < MOD2_TYPES.length; i++) {
      store.cycleMod2Type()
      mod2.push(chain().mod2.type)
    }
    expect(mod2).toEqual(['Chorus', 'Vibe', 'Flanger', 'Ensemble', 'Phaser', 'Spin', 'Chorus'])

    store.updateUnit('reverb', { type: 'Hall' }, 'test')
    const reverb = [chain().reverb.type]
    for (let i = 0; i < REVERB_TYPES.length; i++) {
      store.cycleReverbType()
      reverb.push(chain().reverb.type)
    }
    expect(reverb).toEqual(['Hall', 'Spring', 'Cathedral', 'Room', 'Stage', 'Booth', 'Hall'])

    const amp = [chain().ampEq.type]
    for (let i = 0; i < AMP_TYPES.length; i++) {
      store.cycleAmpType()
      amp.push(chain().ampEq.type)
    }
    expect(amp).toEqual([
      'Neutral EQ',
      'Small',
      'To Rotary',
      'JC',
      'LP24 Filter',
      'Twin',
      'HP24 Filter',
      'Neutral EQ',
    ])
  })

  it('Vib/Chorus keeps the manual C1 V1 C2 V2 C3 V3 order from the C3 default', () => {
    const store = new InstrumentStore()
    expect(store.getState().organ.vibratoType).toBe('C3')
    const trail = [store.getState().organ.vibratoType]
    for (let i = 0; i < VIBRATO_TYPES.length; i++) {
      store.cycleOrganVibratoType()
      trail.push(store.getState().organ.vibratoType)
    }
    expect(trail).toEqual(['C3', 'V3', 'C1', 'V1', 'C2', 'V2', 'C3'])
  })
})
