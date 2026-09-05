import { describe, expect, it, vi } from 'vitest'
import { EffectChain, InstrumentDSP } from './dsp'
import { chainDefaults, effectTypes, initialState, pianoTypes, type InstrumentState, type UnitId } from './phase2-state'
import { LayerAudio, LayeredPianoEngine, type LayerAudioBoundary } from './layer-audio'
import { PianoLibrary, type SampleEntry } from './library'
import { InputController } from './inputs'
const sr = 12000
const energy = (x: Float32Array) => x.reduce((a, b) => a + b * b, 0) / x.length
const difference = (x: Float32Array, y: Float32Array) => energy(x.map((v, i) => v - y[i]))
function render(patch: (state: InstrumentState) => void = () => {}, velocity = 85, release = true) {
  const dsp = new InstrumentDSP(sr), state = initialState(); patch(state); dsp.message({ kind: 'state', state })
  dsp.message({ kind: 'on', layer: 'A', midi: 60, velocity, id: 1 })
  const left = new Float32Array(sr), right = new Float32Array(sr)
  dsp.render(left.subarray(0, sr / 5), right.subarray(0, sr / 5))
  if (release) dsp.message({ kind: 'off', id: 1 })
  dsp.render(left.subarray(sr / 5), right.subarray(sr / 5))
  return { left, right, dsp }
}
function fx(unit: UnitId, type: number, patch = {}, on = true) {
  const settings = chainDefaults(); Object.assign(settings[unit], { on, type, amount: .85, wet: .7, rate: .12, feedback: .7, bass: 7, mid: 5, treble: -6 }, patch)
  const chain = new EffectChain(sr, settings), out = new Float32Array(sr)
  for (let i = 0; i < sr; i++) { const t = i / sr, x = t < .25 ? .5 * Math.sin(t * 2 * Math.PI * 233) + .3 * Math.sin(t * 2 * Math.PI * 2401) : 0; out[i] = chain.tick(x, 0, settings, true, 120) }
  return out
}
describe('Phase 2 rendered source and performance', () => {
  it('renders six distinct honest synthesized models; recordings remain explicitly unavailable', async () => {
    const library = new PianoLibrary(); await library.load(vi.fn())
    expect(library.status).toBe('fallback'); expect(library.samples).toHaveLength(0); expect(library.error).toContain('not supplied')
    const signals = pianoTypes.map(type => render(s => { s.layers.A.type = type }).left)
    for (let i = 0; i < signals.length; i++) { expect(energy(signals[i])).toBeGreaterThan(.00001); for (let j = 0; j < i; j++) expect(difference(signals[i], signals[j])).toBeGreaterThan(.000001) }
  })
  it('fails safely on an unavailable recording and never reports ready', async () => {
    const manifest: SampleEntry[] = (['Grand', 'Upright', 'Electric'] as const).map(type => ({ type, file: `/missing-${type}.wav`, model: 'Test', source: 'Injected test fixture; no actual recording claimed', license: 'Test only', root: 60, velocity: 90 }))
    const loader = new PianoLibrary(manifest, vi.fn().mockRejectedValue(new Error('asset unavailable')))
    await loader.load(vi.fn()); expect(loader.status).toBe('fallback'); expect(loader.error).toContain('asset unavailable')
    expect(energy(render().left)).toBeGreaterThan(0)
  })
  it('interpolates injected sample velocity layers and transposes nearest roots', () => {
    const dsp = new InstrumentDSP(sr)
    const sample = (root: number, velocity: number) => ({ file: 'test-only', source: 'Generated deterministic test signal', license: 'MIT', model: 'test', type: 'Grand' as const, root, velocity, data: Float32Array.from({ length: sr }, (_, i) => Math.sin(i * (root === 60 ? .08 : .2)) * velocity / 127), sampleRate: sr })
    dsp.message({ kind: 'samples', samples: [sample(60, 30), sample(60, 120), sample(72, 90)] }); dsp.message({ kind: 'on', id: 1, layer: 'A', midi: 61, velocity: 70 })
    expect(dsp.voices.get(1)?.sample?.root).toBe(60); expect(dsp.voices.get(1)?.sampleMix).toBeGreaterThan(0)
    const x = new Float32Array(sr / 10); dsp.render(x, new Float32Array(x.length)); expect(energy(x)).toBeGreaterThan(0)
  })
  it('velocity, touch, dynamic compression, layer level and master move output in the expected direction', () => {
    expect(energy(render(undefined, 110).left)).toBeGreaterThan(energy(render(undefined, 35).left) * 8)
    const controls: ((s: InstrumentState) => void)[] = [s => { s.layers.A.touch = 2 }, s => { s.layers.A.dynComp = 3 }]
    for (const patch of controls) expect(energy(render(patch, 35).left)).toBeGreaterThan(energy(render(undefined, 35).left) * 1.5)
    expect(energy(render(s => { s.layers.A.level = .2 }).left)).toBeLessThan(energy(render().left) / 4)
    expect(energy(render(s => { s.master = .2 }).left)).toBeLessThan(energy(render().left) / 4)
    expect(energy(render(s => { s.master = 0 }).left.subarray(sr / 5))).toBeLessThan(1e-12)
  })
  it('all timbre and unison settings alter rendered stereo audio', () => {
    const base = render().left
    for (let timbre = 1; timbre < 6; timbre++) expect(difference(base, render(s => { s.layers.A.type = 'Electric'; s.layers.A.timbre = timbre }).left)).toBeGreaterThan(1e-6)
    for (let unison = 1; unison <= 3; unison++) { const signal = render(s => { s.layers.A.unison = unison }); expect(difference(signal.left, signal.right)).toBeGreaterThan(1e-6); expect(difference(base, signal.left)).toBeGreaterThan(1e-6) }
  })
  it('soft release lengthens release except Clav, while pedal resonance changes held signal', () => {
    expect(energy(render().left.subarray(sr / 2))).toBe(0)
    expect(energy(render(s => { s.layers.A.softRelease = true }).left.subarray(sr / 2))).toBeGreaterThan(1e-7)
    expect(difference(render(s => { s.layers.A.type = 'Clav' }).left, render(s => { s.layers.A.type = 'Clav'; s.layers.A.softRelease = true }).left)).toBe(0)
    const dsp = new InstrumentDSP(sr); const state = initialState(); state.layers.A.stringRes = true; dsp.message({ kind: 'state', state }); dsp.message({ kind: 'pedal', layer: 'A', down: true }); dsp.message({ kind: 'on', layer: 'A', id: 1, midi: 60, velocity: 85 })
    const out = new Float32Array(sr); dsp.render(out, new Float32Array(sr)); expect(difference(out, render(undefined, 85, false).left)).toBeGreaterThan(1e-6)
  })
  it('pitch stick respects the per-layer routing toggle and all-off clears voices and effect tails', () => {
    const plain = render().left
    expect(difference(plain, render(s => { s.bend = 1 }).left)).toBeGreaterThan(.0001)
    expect(difference(plain, render(s => { s.bend = 1; s.layers.A.pstick = false }).left)).toBe(0)
    const { dsp } = render(s => { s.layers.A.effects.delay.on = true }, 95, false); dsp.message({ kind: 'clear' })
    const x = new Float32Array(sr); dsp.render(x, new Float32Array(sr)); expect(energy(x)).toBe(0); expect(dsp.voices.size).toBe(0)
  })
})
describe('ordered production effect processing', () => {
  for (const unit of ['mod1', 'mod2', 'delay', 'ampEq', 'compressor', 'reverb'] as UnitId[]) it(`${unit}: every listed type processes audio and is distinct`, () => {
    const bypass = fx(unit, 0, {}, false), signals = effectTypes[unit].map((_, type) => fx(unit, type))
    for (let i = 0; i < signals.length; i++) {
      // To Rotary leaves the EQ path unchanged; shared rotation is verified separately.
      if (!(unit === 'ampEq' && i === 6)) expect(difference(signals[i], bypass)).toBeGreaterThan(1e-8)
      for (let j = 0; j < i; j++) if (!(unit === 'ampEq' && i === 6 && j === 0)) expect(difference(signals[i], signals[j])).toBeGreaterThan(1e-8)
    }
  })
  it('wet=0 is dry, feedback extends repeats, and filtering changes the repeat spectrum without touching dry input', () => {
    expect(difference(fx('delay', 0, { wet: 0 }), fx('delay', 0, {}, false))).toBe(0)
    expect(difference(fx('reverb', 0, { wet: 0 }), fx('reverb', 0, {}, false))).toBe(0)
    expect(energy(fx('delay', 0, { feedback: .8 }).subarray(sr * .6))).toBeGreaterThan(energy(fx('delay', 0, { feedback: 0 }).subarray(sr * .6)) + 1e-6)
    for (let type = 1; type <= 3; type++) { const filtered = fx('delay', type); expect(difference(filtered.subarray(0, 2000), fx('delay', 0).subarray(0, 2000))).toBe(0); expect(difference(filtered, fx('delay', 0))).toBeGreaterThan(1e-5) }
  })
  it('rate, amount, tone, compressor recovery and EQ each change audio', () => {
    for (const unit of ['mod1', 'mod2', 'delay', 'ampEq'] as UnitId[]) expect(difference(fx(unit, 1, { rate: .1 }), fx(unit, 1, { rate: .8 }))).toBeGreaterThan(1e-7)
    for (const unit of ['mod1', 'mod2', 'ampEq', 'compressor'] as UnitId[]) expect(difference(fx(unit, 1, { amount: .1 }), fx(unit, 1, { amount: .9 }))).toBeGreaterThan(1e-7)
    expect(difference(fx('reverb', 4, { tone: 0 }), fx('reverb', 4, { tone: 1 }))).toBeGreaterThan(1e-8)
    expect(difference(fx('ampEq', 0, { bass: -15 }), fx('ampEq', 0, { bass: 15 }))).toBeGreaterThan(1e-6)
  })
  it('all bypass is dry and To Rotary is after reverb with smooth speed changes and bounded master output', () => {
    const dry = render().left
    const bypass = render(s => { s.effectsOn = false; for (const e of Object.values(s.layers.A.effects)) e.on = true }).left
    // Bypass state is smoothed during the initial 10ms; settled signal is identical.
    expect(difference(dry.subarray(sr / 10), bypass.subarray(sr / 10))).toBeLessThan(1e-8)
    const rotary = (fast: boolean) => render(s => { s.rotary = { on: true, fast, drive: .7 }; s.layers.A.effects.ampEq = { ...s.layers.A.effects.ampEq, on: true, type: 6 }; s.layers.A.effects.reverb = { ...s.layers.A.effects.reverb, on: true, wet: .8 } })
    expect(difference(rotary(false).left, rotary(true).left)).toBeGreaterThan(1e-7)
    expect(rotary(true).left.every(x => Number.isFinite(x) && Math.abs(x) <= 1)).toBe(true)
    expect(rotary(true).dsp.rotary.speed).toBeGreaterThan(1); expect(rotary(true).dsp.rotary.speed).toBeLessThan(6.5)
    const settings = chainDefaults(); settings.delay.on = true; settings.delay.wet = 1; settings.delay.rate = .1; settings.ampEq.on = true; settings.ampEq.type = 4
    const chain = new EffectChain(sr, settings)
    expect(chain.units[0].map(u => u.id)).toEqual(['mod1', 'mod2', 'delay', 'ampEq', 'compressor', 'reverb'])
  })
})
function fakeLayerAudio() {
  const events: { layer: string; midi: number; release: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; ended: () => void }[] = []
  const output: LayerAudioBoundary = { library: new PianoLibrary(), start: vi.fn(async () => {}), voice: (layer, midi, _velocity, ended) => { const voice = { layer, midi, release: vi.fn(), stop: vi.fn(), ended }; events.push(voice); return voice }, configure: vi.fn(), pedal: vi.fn(), clear: vi.fn(), close: vi.fn() }
  return { output, events }
}
describe('layer ownership, pedals and routing', () => {
  it('two layers own repeated notes independently; disable and octave preserve existing ownership', async () => {
    const { output, events } = fakeLayerAudio(), engine = new LayeredPianoEngine(output)
    engine.setLayer('B', { enabled: true, octave: 1 }); await engine.on('key', 60)
    expect(events.map(e => [e.layer, e.midi])).toEqual([['A', 60], ['B', 72]])
    engine.setLayer('B', { enabled: false }); expect(events[1].stop).toHaveBeenCalledOnce(); expect(events[0].stop).not.toHaveBeenCalled()
    engine.focus('B'); engine.off('key'); expect(events[0].release).toHaveBeenCalledOnce()
    engine.dispose(); expect(output.close).toHaveBeenCalledOnce(); expect(engine.notes.size).toBe(0)
  })
  it('UI, Space and MIDI CC64 sustain only SUSTPED layers and pedal-up releases their own voices', async () => {
    for (const source of ['ui', 'keyboard', 'midi']) {
      const { output, events } = fakeLayerAudio(), engine = new LayeredPianoEngine(output), input = new InputController(engine)
      engine.setLayer('B', { enabled: true, sustped: false }); await engine.on('note', 60)
      if (source === 'ui') engine.sustain('ui', true); else if (source === 'keyboard') input.keyDown('Space'); else input.midi('device', new Uint8Array([0xb0, 64, 127]))
      engine.off('note'); expect(events[0].release).not.toHaveBeenCalled(); expect(events[1].release).toHaveBeenCalledOnce()
      if (source === 'ui') engine.sustain('ui', false); else if (source === 'keyboard') input.keyUp('Space'); else input.midi('device', new Uint8Array([0xb0, 64, 0]))
      expect(events[0].release).toHaveBeenCalledOnce(); engine.dispose()
    }
  })
  it('focus, group, globals, tap and bypass configure the actual audio boundary', () => {
    const { output } = fakeLayerAudio(); let time = 1000; const engine = new LayeredPianoEngine(output, () => time)
    engine.focus('B'); expect(engine.state.fxFocus).toBe('B'); engine.effect('mod1', { on: true, type: 3 }); expect(engine.state.layers.A.effects.mod1.on).toBe(false)
    engine.group(true); expect(engine.state.layers.A.effects.mod1.type).toBe(3); engine.effect('mod1', { amount: .9 }); expect(engine.state.layers.A.effects.mod1.amount).toBe(.9)
    engine.group(false); engine.global('delay', true); engine.effect('delay', { on: true, feedback: .7 }); expect(engine.state.layers.A.effects.delay.feedback).toBe(.7)
    engine.focusEffects('Organ'); engine.effect('mod1', { type: 5 }); expect(engine.state.layers.B.effects.mod1.type).toBe(3)
    engine.focusEffects('Piano'); engine.tap(); time += 500; engine.tap(); expect(engine.state.bpm).toBe(120); expect(engine.state.layers.A.effects.delay.rate).toBeCloseTo((.5 - .06) / 1.44)
    engine.set({ effectsOn: false }); expect(output.configure).toHaveBeenLastCalledWith(engine.state); engine.dispose()
  })
  it('one context, one destination connection, no timers, and cleanup even after an asynchronous close', async () => {
    const port = { onmessage: null as null | ((event: { data: { ended: number[] } }) => void), postMessage: vi.fn(), close: vi.fn() }
    const node = { port, connect: vi.fn(), disconnect: vi.fn() }
    const ctx = { state: 'running', destination: {}, audioWorklet: { addModule: vi.fn(async () => {}) }, decodeAudioData: vi.fn(), close: vi.fn(async () => {}) }
    const factory = vi.fn(() => ctx as unknown as AudioContext)
    const output = new LayerAudio(new PianoLibrary(), factory, () => node as unknown as AudioWorkletNode)
    await Promise.all([output.start(), output.start()]); expect(factory).toHaveBeenCalledOnce(); expect(node.connect).toHaveBeenCalledExactlyOnceWith(ctx.destination)
    const ended = vi.fn(); output.voice('A', 60, 90, ended); output.voice('B', 60, 90, ended)
    expect(output.diagnostics).toEqual({ contexts: 1, nodes: 1, voices: 2, listeners: 1, timers: 0 })
    output.close(); expect(ended).toHaveBeenCalledTimes(2); expect(output.diagnostics).toEqual({ contexts: 0, nodes: 0, voices: 0, listeners: 0, timers: 0 }); expect(node.disconnect).toHaveBeenCalledOnce(); expect(port.onmessage).toBeNull()
  })
})

describe('input to rendered DSP boundary', () => {
  function rig() {
    const dsp = new InstrumentDSP(sr); const callbacks = new Map<number, () => void>(); let id = 0
    const output: LayerAudioBoundary = { library: new PianoLibrary(), start: async () => {}, configure: state => dsp.message({ kind: 'state', state: structuredClone(state) }), pedal: (layer, down) => dsp.message({ kind: 'pedal', layer, down }), clear: () => { dsp.message({ kind: 'clear' }); callbacks.forEach(cb => cb()); callbacks.clear() }, close() { this.clear() }, voice: (layer, midi, velocity, ended) => { const note = ++id; callbacks.set(note, ended); dsp.message({ kind: 'on', id: note, layer, midi, velocity }); return { release: () => dsp.message({ kind: 'off', id: note }), stop: () => { dsp.message({ kind: 'stop', id: note }); callbacks.delete(note); ended() } } } }
    const engine = new LayeredPianoEngine(output)
    const block = (seconds = 1) => { const left = new Float32Array(Math.round(sr * seconds)); dsp.render(left, new Float32Array(left.length)); for (const id of dsp.finished) { callbacks.get(id)?.(); callbacks.delete(id) }; dsp.finished = []; return left }
    return { engine, dsp, block }
  }
  it('SUSTPED controls rendered release duration for UI, keyboard and MIDI input', async () => {
    for (const source of ['ui', 'keyboard', 'midi']) {
      const energies: number[] = []
      for (const sustped of [false, true]) {
        const { engine, block } = rig(), input = new InputController(engine); engine.setLayer('A', { sustped })
        await engine.on('key', 60, 100); block(.1)
        if (source === 'ui') engine.sustain('ui', true); else if (source === 'keyboard') input.keyDown('Space'); else input.midi('test', new Uint8Array([0xb0, 64, 127]))
        engine.off('key'); energies.push(energy(block().subarray(sr / 2)))
        input.allOff(); expect(energy(block())).toBe(0); engine.dispose()
      }
      expect(energies[0]).toBe(0); expect(energies[1]).toBeGreaterThan(1e-5)
    }
  })
  it('layer disable, octave, group effects and master alter rendered output through the same boundary', async () => {
    const one = rig(); await one.engine.on('key', 60); const a = one.block()
    const two = rig(); two.engine.setLayer('B', { enabled: true, octave: 1, type: 'Digital' }); await two.engine.on('key', 60); const ab = two.block()
    expect(difference(a, ab)).toBeGreaterThan(1e-5)
    two.engine.setLayer('B', { enabled: false }); expect([...two.dsp.voices.values()].filter(v => v.layer === 'B').every(v => v.stopped)).toBe(true)
    two.engine.group(true); two.engine.effect('mod1', { on: true, type: 1, amount: 1 }); expect(two.dsp.state.layers.A.effects.mod1).toEqual(two.dsp.state.layers.B.effects.mod1)
    two.engine.set({ master: 0 }); expect(energy(two.block().subarray(sr / 4))).toBeLessThan(1e-12)
    one.engine.dispose(); two.engine.dispose(); expect(one.dsp.voices.size + two.dsp.voices.size).toBe(0)
  })
})
it('renders finite non-silent output at the browser 48kHz sample rate', () => {
  const dsp = new InstrumentDSP(48000)
  dsp.message({ kind: 'on', layer: 'A', id: 1, midi: 60, velocity: 95 })
  const out = new Float32Array(48000); dsp.render(out, new Float32Array(48000))
  expect(out.every(Number.isFinite)).toBe(true); expect(energy(out)).toBeGreaterThan(.0001)
})
