import { describe, expect, it } from 'vitest'
import { processEffect, processEffectChain, renderInstrumentNote, renderPianoNote, rms } from './dsp'
import { AMP_TYPES, MOD1_TYPES, MOD2_TYPES, PIANO_TYPES, REVERB_TYPES, SAMPLE_BANKS, createInitialInstrumentState, updateEffectUnit, type EffectChainState } from './instrument'

const signature = (signal: Float32Array) => {
  let sum = 0
  for (let index = 0; index < signal.length; index += 17) sum += signal[index] * (1 + index % 13)
  return sum.toFixed(5)
}

const testTone = () => Float32Array.from({ length: 4096 }, (_, index) => Math.sin(index * .071) * (.2 + .6 * (index % 101) / 100))

describe('rendered Phase 2 piano library', () => {
  it('contains honest multi-root, multi-velocity offline PCM plans and six distinct playable families', () => {
    for (const bank of Object.values(SAMPLE_BANKS)) {
      expect(bank.roots.length).toBeGreaterThanOrEqual(6)
      expect(bank.velocities.length).toBeGreaterThanOrEqual(3)
      expect(bank.source).toBe('generated-pcm')
    }
    const signatures = PIANO_TYPES.map((type) => signature(renderPianoNote(type)))
    expect(new Set(signatures).size).toBe(PIANO_TYPES.length)
    for (const type of PIANO_TYPES) expect(rms(renderPianoNote(type))).toBeGreaterThan(.005)
  })

  it('makes every piano performance control measurably audible', () => {
    const base = renderPianoNote('Grand', 60, .35)
    expect(rms(renderPianoNote('Grand', 60, .35, 1, 12000, { kbTouch: 'Light' }))).toBeGreaterThan(rms(renderPianoNote('Grand', 60, .35, 1, 12000, { kbTouch: 'Heavy' })))
    expect(rms(renderPianoNote('Grand', 60, .2, 1, 12000, { dynComp: 3 }))).toBeGreaterThan(rms(base) * .7)
    expect(signature(renderPianoNote('Grand', 60, .7, 1, 12000, { timbre: 'Bright' }))).not.toBe(signature(renderPianoNote('Grand', 60, .7, 1, 12000, { timbre: 'Soft' })))
    expect(signature(renderPianoNote('Grand', 60, .7, 1, 12000, { unison: 3 }))).not.toBe(signature(base))
    expect(signature(renderPianoNote('Grand', 60, .7, 1, 12000, { stringRes: true }))).not.toBe(signature(base))
    const normalTail = renderPianoNote('Grand', 60, .7, 2, 12000).slice(18000)
    const softTail = renderPianoNote('Grand', 60, .7, 2, 12000, { softRelease: true }).slice(18000)
    expect(rms(softTail)).toBeGreaterThan(rms(normalTail))
    expect(signature(renderPianoNote('Grand', 60, .7, 1, 12000, { octave: 12 }))).not.toBe(signature(base))
  })

  it('applies layer enable/level and Master Level across the rendered audio boundary', () => {
    const state = createInitialInstrumentState()
    const normal = renderInstrumentNote(state)
    const quiet = renderInstrumentNote({ ...state, masterLevel: .2 })
    expect(rms(quiet)).toBeLessThan(rms(normal) * .5)
    const layered = structuredClone(state)
    layered.layers.B.enabled = true
    expect(signature(renderInstrumentNote(layered))).not.toBe(signature(normal))
    layered.sectionOn = false
    expect(rms(renderInstrumentNote(layered))).toBe(0)
  })
})

describe('rendered ordered effects', () => {
  it.each([
    ['mod1', MOD1_TYPES], ['mod2', MOD2_TYPES], ['ampEq', AMP_TYPES], ['reverb', REVERB_TYPES],
  ] as const)('makes every %s type distinct', (unit, types) => {
    const signatures = types.map((type) => signature(processEffect(testTone(), unit, type, .72)))
    expect(new Set(signatures).size).toBe(types.length)
  })

  it('processes Delay feedback filters on repeats and Compressor dynamics', () => {
    const input = testTone()
    const filters = ['Off', 'LP', 'HP', 'BP'] as const
    expect(new Set(filters.map((filter) => signature(processEffect(input, 'delay', 'Digital', .78, 12000, filter)))).size).toBe(4)
    expect(rms(processEffect(input, 'compressor', 'Compressor', .9))).toBeLessThan(rms(input))
  })

  it('changes Delay output for tempo, feedback, dry/wet, and clock sync', () => {
    const input = testTone()
    const state = createInitialInstrumentState()
    const chain = state.effects.A
    chain.delay = { ...chain.delay, on: true, rate: .2, feedback: .2, mix: .25 }
    const base = signature(processEffectChain(input, chain))
    chain.delay = { ...chain.delay, rate: .8 }
    expect(signature(processEffectChain(input, chain))).not.toBe(base)
    chain.delay = { ...chain.delay, feedback: .78 }
    expect(signature(processEffectChain(input, chain))).not.toBe(base)
    chain.delay = { ...chain.delay, mix: .75, fast: true }
    expect(signature(processEffectChain(input, chain))).not.toBe(base)
  })

  it('honors bypass, dry/wet, order, and Reverb-before-Rotary routing', () => {
    const input = testTone()
    const state = createInitialInstrumentState()
    const chain = state.effects.A
    chain.mod1 = { ...chain.mod1, on: true, type: 'Ring Mod', amount: .68 }
    chain.delay = { ...chain.delay, on: true, mix: .45, feedback: .6, filter: 'LP' }
    chain.reverb = { ...chain.reverb, on: true, type: 'Hall', mix: .5 }
    const wet = processEffectChain(input, chain)
    expect(signature(wet)).not.toBe(signature(input))
    const bypassed: EffectChainState = { ...chain, allBypass: true }
    expect([...processEffectChain(input, bypassed)]).toEqual([...input])
    const reversed = processEffect(processEffect(processEffect(input, 'reverb', 'Hall', .5), 'delay', 'Digital', .45), 'mod1', 'Ring Mod', .68)
    expect(signature(wet)).not.toBe(signature(reversed))
    state.effects.A = chain
    chain.ampEq = { ...chain.ampEq, on: true, type: 'To Rotary' }
    expect(signature(renderInstrumentNote(state))).not.toBe(signature(processEffectChain(renderPianoNote('Grand'), chain)))
  })

  it('routes focused, grouped, and global unit edits to the canonical chains', () => {
    let state = createInitialInstrumentState()
    state = updateEffectUnit(state, 'delay', (unit) => ({ ...unit, on: true }))
    expect(state.effects.A.delay.on).toBe(true)
    expect(state.effects.B.delay.on).toBe(false)
    state = { ...state, group: true }
    state = updateEffectUnit(state, 'reverb', (unit) => ({ ...unit, mix: .81 }))
    expect(state.effects.A.reverb.mix).toBe(.81)
    expect(state.effects.B.reverb.mix).toBe(.81)
    state = { ...state, group: false, effects: { ...state.effects, A: { ...state.effects.A, compressor: { ...state.effects.A.compressor, global: true } } } }
    state = updateEffectUnit(state, 'compressor', (unit) => ({ ...unit, amount: .93 }))
    expect(state.effects.A.compressor.amount).toBe(.93)
    expect(state.effects.B.compressor.amount).toBe(.93)
  })
})
