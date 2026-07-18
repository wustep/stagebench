import { describe, expect, it } from 'vitest'
import { FakeAudioBackend, rms, windowEnergy } from '../audio/fake-backend'
import { renderGraph, type NoteEvent } from '../audio/render'
import { freshEffects, freshPerf } from '../test-helpers'
import { AMP_TYPES, MOD1_TYPES, MOD2_TYPES, REVERB_TYPES } from '../state/effects-state'

function corr(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let dot = 0, ea = 0, eb = 0
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; ea += a[i] * a[i]; eb += b[i] * b[i] }
  return dot / Math.max(1e-12, Math.sqrt(ea * eb))
}

function renderWith(effects: ReturnType<typeof freshEffects>, seconds = 0.7): Float32Array {
  const backend = new FakeAudioBackend()
  const params = backend.buildRenderParams({ effects, perf: freshPerf() }, seconds)
  params.layers[0].level = 0.9
  const notes = new Map<'pianoA' | 'pianoB', NoteEvent[]>([
    ['pianoA', [{ note: 60, velocity: 0.85, start: 0, release: null, stop: null }]],
  ])
  const frame = renderGraph(params, notes)
  const out = new Float32Array(frame.l.length)
  for (let i = 0; i < out.length; i++) out[i] = (frame.l[i] + frame.r[i]) / 2
  return out
}

/** Stereo render for pan/modulation effects that live mostly in the sides. */
function renderStereoWith(effects: ReturnType<typeof freshEffects>, seconds = 0.7): { l: Float32Array; r: Float32Array } {
  const backend = new FakeAudioBackend()
  const params = backend.buildRenderParams({ effects, perf: freshPerf() }, seconds)
  params.layers[0].level = 0.9
  const notes = new Map<'pianoA' | 'pianoB', NoteEvent[]>([
    ['pianoA', [{ note: 60, velocity: 0.85, start: 0, release: null, stop: null }]],
  ])
  return renderGraph(params, notes)
}

function zcr(buf: Float32Array): number {
  let c = 0
  for (let i = 1; i < buf.length; i++) if (Math.sign(buf[i]) !== Math.sign(buf[i - 1])) c++
  return c / buf.length
}

const DRY = () => renderWith(freshEffects())

describe('effects.processing', () => {
  it('Mod 1: every listed type is audibly distinct from dry and from each other', () => {
    expect(MOD1_TYPES).toEqual(['A-Pan', 'Tremolo', 'Ring Mod', 'A-Wah', 'Wah', 'Pump'])
    const dryF = renderStereoWith(freshEffects())
    const drySide = new Float32Array(dryF.l.length)
    for (let i = 0; i < drySide.length; i++) drySide[i] = (dryF.l[i] - dryF.r[i]) / 2
    const dry = DRY()
    const outs: Float32Array[] = []
    for (let t = 0; t < MOD1_TYPES.length; t++) {
      const fx = freshEffects()
      fx.chains.pianoA.mod1.on = true
      fx.chains.pianoA.mod1.type = t
      fx.chains.pianoA.mod1.rate = 90
      fx.chains.pianoA.mod1.amount = 110
      const out = renderWith(fx)
      expect(rms(out), MOD1_TYPES[t]).toBeGreaterThan(0.0005)
      if (t === 0) {
        // A-Pan: dry is mono (no side energy); processed has a moving image.
        const f = renderStereoWith(fx)
        const side = new Float32Array(f.l.length)
        for (let i = 0; i < side.length; i++) side[i] = (f.l[i] - f.r[i]) / 2
        expect(rms(side)).toBeGreaterThan(rms(drySide) + 0.005)
        expect(rms(side)).toBeGreaterThan(0.002)
      } else {
        expect(corr(out, dry), MOD1_TYPES[t]).toBeLessThan(0.97)
      }
      outs.push(out)
    }
    for (let i = 0; i < outs.length; i++) {
      for (let j = i + 1; j < outs.length; j++) {
        expect(corr(outs[i], outs[j]), `${MOD1_TYPES[i]} vs ${MOD1_TYPES[j]}`).toBeLessThan(0.97)
      }
    }
  })

  it('Mod 1 rate and amount measurably change the processed signal', () => {
    const mk = (rate: number, amount: number) => {
      const fx = freshEffects()
      fx.chains.pianoA.mod1.on = true
      fx.chains.pianoA.mod1.type = 1
      fx.chains.pianoA.mod1.rate = rate
      fx.chains.pianoA.mod1.amount = amount
      return renderWith(fx)
    }
    expect(corr(mk(20, 110), mk(120, 110))).toBeLessThan(0.98)
    expect(corr(mk(90, 20), mk(90, 120))).toBeLessThan(0.98)
  })

  it('Mod 2: every listed type is audibly distinct from dry and from each other', () => {
    expect(MOD2_TYPES).toEqual(['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin'])
    const dry = DRY()
    const outs: Float32Array[] = []
    for (let t = 0; t < MOD2_TYPES.length; t++) {
      const fx = freshEffects()
      fx.chains.pianoA.mod2.on = true
      fx.chains.pianoA.mod2.type = t
      fx.chains.pianoA.mod2.rate = 80
      fx.chains.pianoA.mod2.amount = 100
      const out = renderWith(fx)
      expect(rms(out), MOD2_TYPES[t]).toBeGreaterThan(0.0005)
      expect(corr(out, dry), MOD2_TYPES[t]).toBeLessThan(0.99)
      outs.push(out)
    }
    for (let i = 0; i < outs.length; i++) {
      for (let j = i + 1; j < outs.length; j++) {
        expect(corr(outs[i], outs[j]), `${MOD2_TYPES[i]} vs ${MOD2_TYPES[j]}`).toBeLessThan(0.99)
      }
    }
  })

  it('Delay: tempo changes repeat spacing; feedback changes repeat count', () => {
    const mk = (tempoMs: number, feedback: number) => {
      const fx = freshEffects()
      fx.chains.pianoA.delay.on = true
      fx.chains.pianoA.delay.tempoMs = tempoMs
      fx.chains.pianoA.delay.feedback = feedback
      fx.chains.pianoA.delay.mix = 100
      return renderWith(fx, 1.0)
    }
    const fast = mk(120, 90)
    const slow = mk(600, 90)
    expect(corr(fast, slow)).toBeLessThan(0.9)
    const sr = 8000
    const lowFb = mk(300, 20)
    const highFb = mk(300, 115)
    expect(windowEnergy(highFb, sr * 0.7, sr)).toBeGreaterThan(windowEnergy(lowFb, sr * 0.7, sr) * 1.3)
  })

  it('Amp Sim/EQ: the three amps are distinct tone shapings; drive changes the signal', () => {
    const mkAmp = (type: number, drive = 90) => {
      const fx = freshEffects()
      fx.chains.pianoA.amp.on = true
      fx.chains.pianoA.amp.type = type
      fx.chains.pianoA.amp.drive = drive
      return renderWith(fx)
    }
    const twin = mkAmp(1)
    const jc = mkAmp(2)
    const small = mkAmp(3)
    expect(corr(twin, jc)).toBeLessThan(0.98)
    expect(corr(twin, small)).toBeLessThan(0.99)
    expect(corr(jc, small)).toBeLessThan(0.98)
    expect(corr(mkAmp(1, 0), mkAmp(1, 127))).toBeLessThan(0.98)
    // EQ bands: bass boost audibly changes low content.
    const fx = freshEffects()
    fx.chains.pianoA.amp.on = true
    fx.chains.pianoA.amp.type = 0
    fx.chains.pianoA.amp.bass = 127
    const bassy = renderWith(fx)
    expect(corr(bassy, DRY())).toBeLessThan(0.98)
  })

  it('LP24/HP24 filters reshape spectrum in opposite directions', () => {
    const mk = (type: number) => {
      const fx = freshEffects()
      fx.chains.pianoA.amp.on = true
      fx.chains.pianoA.amp.type = type
      fx.chains.pianoA.amp.midFreq = 80
      fx.chains.pianoA.amp.midGain = 100
      return renderWith(fx)
    }
    const lp = mk(4)
    const hp = mk(5)
    const dry = DRY()
    expect(rms(lp)).toBeGreaterThan(0.001)
    expect(rms(hp)).toBeGreaterThan(0.0002)
    expect(zcr(hp)).toBeGreaterThan(zcr(lp) * 1.2)
    expect(corr(lp, dry)).toBeLessThan(0.9995)
    expect(corr(hp, dry)).toBeLessThan(0.98)
  })

  it('Compressor: higher amount narrows dynamic range; fast mode recovers quicker', () => {
    const mk = (amount: number, fast: boolean) => {
      const fx = freshEffects()
      fx.chains.pianoA.comp.on = true
      fx.chains.pianoA.comp.amount = amount
      fx.chains.pianoA.comp.fast = fast
      return renderWith(fx, 1.2)
    }
    const sr = 8000
    const dynRange = (buf: Float32Array) => {
      const attack = rms(buf.slice(0, sr * 0.08))
      const tail = rms(buf.slice(sr * 0.5, sr * 0.9))
      return attack / Math.max(1e-9, tail)
    }
    const off = renderWith(freshEffects(), 1.2)
    const heavy = mk(127, false)
    expect(dynRange(heavy)).toBeLessThan(dynRange(off) * 0.85)
    const slow = mk(127, false)
    const fast = mk(127, true)
    // Fast mode: more level recovered in the mid-tail after the attack.
    const tailSlow = rms(slow.slice(sr * 0.25, sr * 0.45))
    const tailFast = rms(fast.slice(sr * 0.25, sr * 0.45))
    expect(tailFast).toBeGreaterThan(tailSlow * 1.05)
  })

  it('Reverb: decay grows Booth → Cathedral; Spring is distinct; bright/dark differ', () => {
    expect(REVERB_TYPES).toEqual(['Room', 'Booth', 'Spring', 'Stage', 'Hall', 'Cathedral'])
    const mk = (type: number, bright = false) => {
      const fx = freshEffects()
      fx.chains.pianoA.reverb.on = true
      fx.chains.pianoA.reverb.type = type
      fx.chains.pianoA.reverb.amount = 100
      fx.chains.pianoA.reverb.bright = bright
      return renderWith(fx, 1.6)
    }
    const sr = 8000
    const tail = (buf: Float32Array) => windowEnergy(buf, sr * 1.2, sr * 1.6)
    expect(tail(mk(5))).toBeGreaterThan(tail(mk(1)) * 2) // Cathedral >> Booth
    expect(tail(mk(4))).toBeGreaterThan(tail(mk(0))) // Hall > Room
    expect(corr(mk(2), mk(3))).toBeLessThan(0.98) // Spring ≠ Stage
    // Bright/dark: the reverb tails differ and bright carries more energy
    // (undamped tail) with a different spectral shape.
    const dark = mk(4, false)
    const bright = mk(4, true)
    const tailOf = (b: Float32Array) => b.slice(sr)
    expect(corr(tailOf(dark), tailOf(bright))).toBeLessThan(0.995)
    expect(rms(tailOf(bright))).toBeGreaterThan(rms(tailOf(dark)) * 1.15)
    expect(zcr(tailOf(bright))).not.toBeCloseTo(zcr(tailOf(dark)), 2)
    // Fully wet at max amount: dry component vanishes early.
    const wet = (() => {
      const fx = freshEffects()
      fx.chains.pianoA.reverb.on = true
      fx.chains.pianoA.reverb.type = 4
      fx.chains.pianoA.reverb.amount = 127
      return renderWith(fx, 1.2)
    })()
    expect(corr(wet.slice(0, sr * 0.05), DRY().slice(0, sr * 0.05))).toBeLessThan(0.5)
  })

  it('Rotary: slow and fast speeds both process and differ; drive adds grit', () => {
    const mk = (fast: boolean, drive = 64) => {
      const fx = freshEffects()
      fx.chains.pianoA.amp.on = true
      fx.chains.pianoA.amp.type = 6
      fx.rotary.on = true
      fx.rotary.fast = fast
      fx.rotary.drive = drive
      return renderWith(fx, 1.0)
    }
    const slow = mk(false)
    const fast = mk(true)
    expect(rms(slow)).toBeGreaterThan(0.0005)
    expect(corr(slow, fast)).toBeLessThan(0.9)
    expect(corr(mk(true, 0), mk(true, 127))).toBeLessThan(0.98)
  })

  it('every effect type constant matches the panel option labels', () => {
    expect(AMP_TYPES.length).toBe(7)
    expect(AMP_TYPES[6]).toBe('To Rotary')
  })
})
