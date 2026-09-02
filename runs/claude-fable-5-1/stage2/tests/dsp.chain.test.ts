/**
 * LayerChain structure: documented order, accessors, Layer Effects ON semantics, block-size independence and reset.
 */
import { describe, expect, it } from 'vitest'
import { AmpEqUnit } from '../src/dsp/ampEq'
import { maxAbsDifference, normalizedDifference, rms } from '../src/dsp/analysis'
import { CHAIN_ORDER, LayerChain } from '../src/dsp/chain'
import { CompressorUnit } from '../src/dsp/compressor'
import { DelayUnit } from '../src/dsp/delay'
import { Mod1Unit } from '../src/dsp/mod1'
import { Mod2Unit } from '../src/dsp/mod2'
import { harmonicTone, makeChain, noiseBurst, renderThrough, type ChainOverrides } from '../src/dsp/offline'
import { ReverbUnit } from '../src/dsp/reverb'
import { StringResUnit } from '../src/dsp/stringRes'
import { TimbreUnit } from '../src/dsp/timbre'
import { defaultChainParams } from '../src/dsp/types'

const SR = 22050

const BUSY: ChainOverrides = {
  timbre: { family: 'acoustic', setting: 1 },
  stringRes: { on: true, strings: [60, 67], pedal: false },
  mod1: { on: true, type: 1, rate: 6, amount: 6 },
  mod2: { on: true, type: 0, rate: 4, amount: 7 },
  delay: { on: true, seconds: 0.09, feedback: 6, dryWet: 5, filter: 3 },
  ampEq: { on: true, model: 3, drive: 4, bass: 3, mid: 2, midFreq: 6, treble: -2 },
  compressor: { on: true, amount: 6, fast: false },
  reverb: { on: true, type: 3, dryWet: 5, tone: 1 },
}

describe('dsp.chain — LayerChain', () => {
  it('processes in the documented order and exposes every unit', () => {
    expect(CHAIN_ORDER).toEqual(['timbre', 'stringRes', 'mod1', 'mod2', 'delay', 'ampEq', 'compressor', 'reverb'])
    const chain = new LayerChain(SR)
    expect(chain.order).toBe(CHAIN_ORDER)
    expect(chain.unit('timbre')).toBeInstanceOf(TimbreUnit)
    expect(chain.unit('stringRes')).toBeInstanceOf(StringResUnit)
    expect(chain.unit('mod1')).toBeInstanceOf(Mod1Unit)
    expect(chain.unit('mod2')).toBeInstanceOf(Mod2Unit)
    expect(chain.unit('delay')).toBeInstanceOf(DelayUnit)
    expect(chain.unit('ampEq')).toBeInstanceOf(AmpEqUnit)
    expect(chain.unit('compressor')).toBeInstanceOf(CompressorUnit)
    expect(chain.unit('reverb')).toBeInstanceOf(ReverbUnit)
    expect(chain.sampleRate).toBe(SR)
    expect(chain.current).toEqual(defaultChainParams())
  })

  it('Layer Effects ON = false makes Mod 1 … Reverb transparent while Timbre / String Res still apply', () => {
    const white = noiseBurst(0.5, SR, 11, { amplitude: 0.3 })
    const off = makeChain(SR, { ...BUSY, effectsOn: false, timbre: { setting: 0 }, stringRes: { on: false, strings: [] } })
    const out = renderThrough(off.chain, white)
    expect(maxAbsDifference(white, out.l)).toBe(0)
    expect(off.chain.transparent).toBe(true)
    for (const name of ['mod1', 'mod2', 'delay', 'ampEq', 'compressor', 'reverb'] as const) expect(off.chain.bypassGain(name)).toBe(0)
    const timbreOnly = renderThrough(makeChain(SR, { ...BUSY, effectsOn: false, stringRes: { on: false, strings: [] } }).chain, white)
    expect(normalizedDifference(white, timbreOnly.l)).toBeGreaterThan(0.05)
    const resOnly = renderThrough(makeChain(SR, { ...BUSY, effectsOn: false, timbre: { setting: 0 } }).chain, harmonicTone(55, 0.2, SR, { length: 1 }))
    expect(rms(resOnly.l, Math.round(0.5 * SR), SR)).toBeGreaterThan(1e-5)
  })

  it('renders identically whatever the block size (128, 1000, 4096)', () => {
    const input = harmonicTone(60, 1, SR)
    const ref = renderThrough(makeChain(SR, BUSY).chain, input, input, 128)
    for (const block of [1000, 4096, 17]) {
      const out = renderThrough(makeChain(SR, BUSY).chain, input, input, block)
      expect(maxAbsDifference(ref.l, out.l), `block ${block}`).toBeLessThanOrEqual(1e-6)
      expect(maxAbsDifference(ref.r, out.r), `block ${block}`).toBeLessThanOrEqual(1e-6)
    }
    expect(rms(ref.l)).toBeGreaterThan(0.01)
  })

  it('reset() clears every tail so silence stays silent', () => {
    const { chain } = makeChain(SR, BUSY)
    renderThrough(chain, harmonicTone(60, 0.5, SR))
    const silence = new Float32Array(Math.round(0.5 * SR))
    const ringing = renderThrough(chain, silence)
    expect(rms(ringing.l)).toBeGreaterThan(1e-5) // delay / reverb tails are still sounding
    chain.reset()
    const after = renderThrough(chain, silence)
    expect(rms(after.l)).toBeLessThan(1e-7)
    expect(rms(after.r)).toBeLessThan(1e-7)
  })

  it('runs at 44.1 kHz and 48 kHz with every unit engaged, producing finite audio in well under real time', () => {
    for (const sr of [44100, 48000]) {
      const input = harmonicTone(60, 2, sr)
      const { chain } = makeChain(sr, BUSY)
      const started = performance.now()
      const out = renderThrough(chain, input)
      const elapsed = performance.now() - started
      expect(elapsed, `sr ${sr}`).toBeLessThan(2000)
      expect(rms(out.l), `sr ${sr}`).toBeGreaterThan(0.01)
      let finite = true
      for (let i = 0; i < out.l.length; i++) if (!Number.isFinite(out.l[i]) || !Number.isFinite(out.r[i])) finite = false
      expect(finite, `sr ${sr}`).toBe(true)
    }
  })

  it('setParams keeps units running while bypass targets update from the params object', () => {
    const { chain, params } = makeChain(SR, BUSY)
    expect(chain.bypassGain('reverb')).toBe(1)
    chain.setParams({ ...params, reverb: { ...params.reverb, on: false } })
    renderThrough(chain, new Float32Array(Math.round(0.05 * SR)))
    expect(chain.bypassGain('reverb')).toBe(0)
    chain.setParams({ ...params })
    renderThrough(chain, new Float32Array(Math.round(0.05 * SR)))
    expect(chain.bypassGain('reverb')).toBe(1)
  })
})
