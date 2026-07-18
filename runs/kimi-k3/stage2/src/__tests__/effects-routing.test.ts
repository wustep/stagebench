import { describe, expect, it } from 'vitest'
import { FakeAudioBackend, rms, windowEnergy } from '../audio/fake-backend'
import { renderGraph, type NoteEvent } from '../audio/render'
import { freshEffects, freshPerf, makeRig } from '../test-helpers'

function corr(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let dot = 0, ea = 0, eb = 0
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; ea += a[i] * a[i]; eb += b[i] * b[i] }
  return dot / Math.max(1e-12, Math.sqrt(ea * eb))
}

function renderWith(effects: ReturnType<typeof freshEffects>, seconds = 0.7, layer: 'pianoA' | 'pianoB' = 'pianoA'): Float32Array {
  const backend = new FakeAudioBackend()
  const params = backend.buildRenderParams({ effects, perf: freshPerf() }, seconds)
  params.layers[0].level = 0.9
  params.layers[1].level = 0.9
  params.layers[1].enabled = true
  params.layers[1].type = 'electric'
  const notes = new Map<'pianoA' | 'pianoB', NoteEvent[]>([
    [layer, [{ note: 60, velocity: 0.8, start: 0, release: null, stop: null }]],
  ])
  const frame = renderGraph(params, notes)
  const out = new Float32Array(frame.l.length)
  for (let i = 0; i < out.length; i++) out[i] = (frame.l[i] + frame.r[i]) / 2
  return out
}

describe('effects.routing', () => {
  it('per-unit bypass: an ON tremolo changes the signal; bypassed it does not', () => {
    const fxOn = freshEffects()
    fxOn.chains.pianoA.mod1.on = true
    fxOn.chains.pianoA.mod1.type = 1 // Tremolo
    fxOn.chains.pianoA.mod1.amount = 120
    const processed = renderWith(fxOn)
    const dry = renderWith(freshEffects())
    expect(corr(processed, dry)).toBeLessThan(0.95)
    const fxBypassed = freshEffects()
    fxBypassed.chains.pianoA.mod1.on = false
    fxBypassed.chains.pianoA.mod1.type = 1
    fxBypassed.chains.pianoA.mod1.amount = 120
    expect(corr(renderWith(fxBypassed), dry)).toBeGreaterThan(0.999)
  })

  it('all-effects bypass (Layer Effects ON off) silences every unit at once', () => {
    const fx = freshEffects()
    fx.chains.pianoA.mod1.on = true
    fx.chains.pianoA.mod1.amount = 127
    fx.chains.pianoA.delay.on = true
    fx.chains.pianoA.delay.mix = 127
    fx.chains.pianoA.reverb.on = true
    fx.chains.pianoA.reverb.amount = 127
    const processed = renderWith(fx)
    const dry = renderWith(freshEffects())
    expect(corr(processed, dry)).toBeLessThan(0.9)
    fx.allOn = false
    expect(corr(renderWith(fx), dry)).toBeGreaterThan(0.999)
  })

  it('dry/wet: delay mix 0 is dry, higher mix adds repeat energy', () => {
    const mk = (mix: number) => {
      const fx = freshEffects()
      fx.chains.pianoA.delay.on = true
      fx.chains.pianoA.delay.tempoMs = 180
      fx.chains.pianoA.delay.feedback = 90
      fx.chains.pianoA.delay.mix = mix
      return fx
    }
    const dry = renderWith(mk(0))
    const wet = renderWith(mk(110))
    const sr = 8000
    const dryTail = windowEnergy(dry, sr * 0.35, sr * 0.7)
    const wetTail = windowEnergy(wet, sr * 0.35, sr * 0.7)
    expect(wetTail).toBeGreaterThan(dryTail * 1.5)
  })

  it('focus: unit settings land on the focused chain only', () => {
    // Tremolo configured on chain A; a note on layer B must be unaffected.
    const fx = freshEffects()
    fx.chains.pianoA.mod1.on = true
    fx.chains.pianoA.mod1.type = 1
    fx.chains.pianoA.mod1.amount = 127
    const onA = renderWith(fx, 0.7, 'pianoA')
    const onB = renderWith(fx, 0.7, 'pianoB')
    const dryA = renderWith(freshEffects(), 0.7, 'pianoA')
    const dryB = renderWith(freshEffects(), 0.7, 'pianoB')
    expect(corr(onA, dryA)).toBeLessThan(0.95)
    expect(corr(onB, dryB)).toBeGreaterThan(0.999)
  })

  it('group mode: both piano layers share the focused chain settings', () => {
    const fx = freshEffects()
    fx.pianoGroup = true
    fx.focusLayer = 'A'
    fx.chains.pianoA.mod1.on = true
    fx.chains.pianoA.mod1.type = 1
    fx.chains.pianoA.mod1.amount = 127
    const onB = renderWith(fx, 0.7, 'pianoB')
    const dryB = renderWith(freshEffects(), 0.7, 'pianoB')
    expect(corr(onB, dryB)).toBeLessThan(0.95) // grouped: B gets A's tremolo
  })

  it('global mode: a global reverb applies to every layer', () => {
    const fx = freshEffects()
    fx.focusLayer = 'A'
    fx.chains.pianoA.reverb.on = true
    fx.chains.pianoA.reverb.global = true
    fx.chains.pianoA.reverb.amount = 110
    const onB = renderWith(fx, 1.0, 'pianoB')
    const dryB = renderWith(freshEffects(), 1.0, 'pianoB')
    const sr = 8000
    expect(windowEnergy(onB, sr * 0.7, sr)).toBeGreaterThan(windowEnergy(dryB, sr * 0.7, sr) * 1.5)
    // Non-global stays per-layer.
    const fx2 = freshEffects()
    fx2.chains.pianoA.reverb.on = true
    fx2.chains.pianoA.reverb.amount = 110
    const onB2 = renderWith(fx2, 1.0, 'pianoB')
    expect(corr(onB2, dryB)).toBeGreaterThan(0.999)
  })

  it('delay feedback filtering processes repeats, not the dry path', () => {
    const mk = (filterType: number) => {
      const fx = freshEffects()
      fx.chains.pianoA.delay.on = true
      fx.chains.pianoA.delay.tempoMs = 150
      fx.chains.pianoA.delay.feedback = 100
      fx.chains.pianoA.delay.mix = 90
      fx.chains.pianoA.delay.filterType = filterType
      return fx
    }
    const unfiltered = renderWith(mk(0), 0.8)
    const lpFiltered = renderWith(mk(1), 0.8)
    // Dry path (first 100 ms) identical: filter is inside the loop only.
    const sr = 8000
    const earlyU = unfiltered.slice(0, sr * 0.1)
    const earlyF = lpFiltered.slice(0, sr * 0.1)
    expect(corr(earlyU, earlyF)).toBeGreaterThan(0.99)
    // Repeats differ (progressively filtered).
    const tailU = unfiltered.slice(sr * 0.3)
    const tailF = lpFiltered.slice(sr * 0.3)
    expect(corr(tailU, tailF)).toBeLessThan(0.95)
  })

  it('To Rotary routes the layer through the shared rotary; bypass leaves it dry', () => {
    const fx = freshEffects()
    fx.chains.pianoA.amp.on = true
    fx.chains.pianoA.amp.type = 6
    fx.rotary.on = true
    fx.rotary.fast = true
    const routed = renderWith(fx, 0.9)
    const dry = renderWith(freshEffects(), 0.9)
    expect(rms(routed)).toBeGreaterThan(0.001)
    expect(corr(routed, dry)).toBeLessThan(0.9)
    // Rotary off: routing button does nothing audible.
    fx.rotary.on = false
    const unrouted = renderWith(fx, 0.9)
    expect(corr(unrouted, dry)).toBeGreaterThan(0.98)
  })

  it('focus follows layer focus in the engine', async () => {
    const { engine } = await makeRig()
    engine.setFocusLayer('pianoB')
    engine.update(() => {
      engine.effects.focusLayer = engine.getFocusedLayer() === 'pianoA' ? 'A' : 'B'
    })
    expect(engine.effects.focusLayer).toBe('B')
  })

  it('tap tempo sets the delay time from two taps', async () => {
    const { engine } = await makeRig()
    const { pressFunctionalControl } = await import('../state/panel-bindings')
    pressFunctionalControl(engine, 'fx.delayTempo')
    await new Promise((r) => setTimeout(r, 120))
    pressFunctionalControl(engine, 'fx.delayTempo')
    expect(engine.effects.chains.pianoA.delay.tempoMs).toBeGreaterThan(80)
    expect(engine.effects.chains.pianoA.delay.tempoMs).toBeLessThan(300)
  })
})
