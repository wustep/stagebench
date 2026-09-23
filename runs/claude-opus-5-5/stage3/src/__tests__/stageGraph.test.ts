// piano.layers, piano.pedals, effects.graph and effects.routing — the real two-layer engine and
// effect graph rendered through the Web Audio simulator.
import { describe, expect, it } from 'vitest'
import { CHAIN_ORDER, type LayerChain } from '../audio/fx/chain'
import { attachComputerKeyboard } from '../input/computerKeyboard'
import { connectMidi } from '../input/midi'
import { LayeredEngine } from '../audio/layeredEngine'
import { PianoLibrary } from '../audio/library'
import { StageAudio } from '../audio/stageAudio'
import { activate, FUNCTIONAL } from '../model/panelBindings'
import { TapTempo } from '../audio/fx/delay'
import {
  defaultSound,
  editUnit,
  effectiveUnit,
  pressLayerButton,
  setGlobal,
  setGroup,
  updateLayer,
  type LayerId,
  type SoundState,
} from '../model/sound'
import { CountingTarget, FakeMidiAccess, FakeMidiInput, readPublicAsset } from '../testing/fakes'
import { difference, peak, rms, SimAudioContext, type SimNode } from '../testing/simAudio'
import { makeStageRig } from '../testing/stageRig'

const SR = 16000
const both = (s: SoundState) => updateLayer(updateLayer(s, 'A', { enabled: true }), 'B', { enabled: true, type: 'grand' })
const onlyB = (s: SoundState) => updateLayer(updateLayer(s, 'A', { enabled: false }), 'B', { enabled: true, type: 'grand' })
type Graph = { layers: Record<LayerId, { input: SimNode; chain: LayerChain; level: SimNode; direct: SimNode; toRotary: SimNode }>; master: SimNode; limiter: SimNode; ceiling: SimNode; rotary: { input: SimNode; output: SimNode } }
const graphOf = (stage: StageAudio) => stage as unknown as Graph
const bctx = { shift: false, nowMs: 0 }

describe('piano.layers — enable, focus, level, octave, ownership, cleanup', () => {
  it('each enabled layer owns its own voice for a key; disabled layers play nothing', async () => {
    const rig = await makeStageRig({ sound: both })
    rig.engine.noteOn(60, 100, 'k')
    expect(rig.engine.snapshot().perLayer).toEqual({ A: 1, B: 1 })
    expect(rig.ctx.liveSourceCount()).toBe(2)
    expect(rig.stage.liveVoices('A')).toBe(1)
    expect(rig.stage.liveVoices('B')).toBe(1)
    rig.engine.noteOff(60, 'k')
    const solo = await makeStageRig({ sound: onlyB })
    solo.engine.noteOn(60, 100, 'k')
    expect(solo.engine.snapshot().perLayer).toEqual({ A: 0, B: 1 })
    expect(rms(solo.render(0.2))).toBeGreaterThan(0.003)
  })

  it('disabling a layer frees only that layer’s voices; the other keeps sounding', async () => {
    const rig = await makeStageRig({ sound: both })
    rig.engine.noteOn(60, 100, 'k')
    rig.render(0.05)
    rig.set((s) => updateLayer(s, 'B', { enabled: false }))
    rig.render(0.2)
    expect(rig.stage.liveVoices('B')).toBe(0)
    expect(rig.stage.liveVoices('A')).toBe(1)
    expect(rms(rig.render(0.1))).toBeGreaterThan(0.003)
    rig.engine.noteOff(60, 'k')
    rig.render(1.2)
    expect(rig.ctx.liveSourceCount()).toBe(0)
  })

  it('octave shift transposes the layer by ±12 semitones and note-off still releases it', async () => {
    const rig = await makeStageRig({ sound: (s) => updateLayer(s, 'A', { octave: 1 }) })
    rig.engine.noteOn(60, 100, 'k')
    expect(rig.engine.snapshot().voices.map((v) => v.note)).toEqual([72])
    const up = rig.render(0.3)
    // Octave change while held: the held note still releases the voice it started.
    rig.set((s) => updateLayer(s, 'A', { octave: -1 }))
    rig.engine.noteOff(60, 'k')
    rig.render(1.2)
    expect(rig.ctx.liveSourceCount()).toBe(0)
    const flat = await makeStageRig()
    flat.engine.noteOn(60, 100, 'k')
    const mid = flat.render(0.3)
    expect(difference(up, mid)).toBeGreaterThan(0.3)
    // Key 60 an octave up renders exactly what key 72 renders unshifted.
    const ref = await makeStageRig()
    ref.engine.noteOn(72, 100, 'k')
    expect(difference(up, ref.render(0.3))).toBeLessThan(1e-6)
  })

  it('layer level faders scale each layer independently', async () => {
    const loud = await makeStageRig({ sound: (s) => updateLayer(onlyB(s), 'B', { level: 127 }) })
    const quiet = await makeStageRig({ sound: (s) => updateLayer(onlyB(s), 'B', { level: 40 }) })
    const off = await makeStageRig({ sound: (s) => updateLayer(onlyB(s), 'B', { level: 0 }) })
    expect(rms(loud.play(60))).toBeGreaterThan(rms(quiet.play(60)) * 3)
    expect(peak(off.play(60))).toBe(0)
  })

  it('layer buttons: off → on+focus, unfocused → focus, focused → off; effect focus follows', () => {
    let s = defaultSound()
    s = pressLayerButton(s, 'B')
    expect(s.piano.layers.B.enabled).toBe(true)
    expect(s.piano.focus).toBe('B')
    expect(s.fx.focus).toBe('B')
    s = pressLayerButton(s, 'A')
    expect(s.piano.focus).toBe('A')
    expect(s.fx.focus).toBe('A')
    expect(s.piano.layers.B.enabled).toBe(true)
    s = pressLayerButton(s, 'A')
    expect(s.piano.layers.A.enabled).toBe(false)
    // Turning off the focused layer hands focus (and FX focus) to the layer still playing.
    expect(s.piano.focus).toBe('B')
    expect(s.fx.focus).toBe('B')
  })

  it('piano section off stops both layers; all-notes-off and dispose return to baseline', async () => {
    const rig = await makeStageRig({ sound: both })
    rig.engine.noteOn(60, 100, 'k')
    rig.engine.noteOn(64, 100, 'k')
    rig.render(0.05)
    rig.set((s) => ({ ...s, piano: { ...s.piano, on: false } }))
    rig.render(0.3)
    expect(rig.ctx.liveSourceCount()).toBe(0)
    rig.engine.noteOn(67, 100, 'k2')
    expect(rig.engine.snapshot().perLayer).toEqual({ A: 0, B: 0 })
    rig.set((s) => ({ ...s, piano: { ...s.piano, on: true } }))
    rig.engine.noteOn(69, 100, 'k3')
    rig.engine.allNotesOff()
    rig.render(0.3)
    expect(rig.ctx.liveSourceCount()).toBe(0)
    rig.engine.dispose()
    rig.stage.dispose()
    expect(rig.ctx.closed).toBe(true)
    expect(rig.ctx.connectedNodeCount()).toBe(0)
    expect(rig.ctx.liveModulatorCount()).toBe(0)
  })
})

describe('piano.pedals — sustain from every input, honouring SUSTPED per layer', () => {
  it('sustain keeps released notes ringing on SUSTPED layers only', async () => {
    // Full-length zones so the sustained voice outlives the other layer's release.
    const rig = await makeStageRig({ sound: (s) => updateLayer(both(s), 'B', { sustPed: false }), maxZoneSeconds: 3 })
    rig.engine.setSustain(true, 'ui')
    rig.engine.noteOn(60, 100, 'k')
    rig.render(0.1)
    rig.engine.noteOff(60, 'k')
    rig.render(1)
    expect(rig.stage.liveVoices('A')).toBe(1)
    expect(rig.stage.liveVoices('B')).toBe(0)
    rig.engine.setSustain(false, 'ui')
    rig.render(1.2)
    expect(rig.stage.liveVoices('A')).toBe(0)
  })

  it('sustain lengthens the rendered sound; turning SUSTPED off while the pedal is down releases', async () => {
    const tail = async (pedal: boolean) => {
      const rig = await makeStageRig()
      if (pedal) rig.engine.setSustain(true, 'ui')
      rig.play(60, 100, 0.1, 0)
      return rms(rig.render(0.3).subarray(Math.round(0.1 * SR)))
    }
    expect(await tail(true)).toBeGreaterThan((await tail(false)) * 4)
    const rig = await makeStageRig()
    rig.engine.setSustain(true, 'ui')
    rig.play(60, 100, 0.1, 0.05)
    expect(rig.stage.liveVoices('A')).toBe(1)
    rig.set((s) => updateLayer(s, 'A', { sustPed: false }))
    rig.render(1.2)
    expect(rig.stage.liveVoices('A')).toBe(0)
  })

  it('computer-keyboard Space and MIDI CC64 drive the layered sustain', async () => {
    const rig = await makeStageRig()
    const target = new CountingTarget()
    const kb = attachComputerKeyboard({ engine: () => rig.engine, target, visibility: target as never, onBaseChange: () => undefined, onUserGesture: () => undefined })
    target.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }))
    expect(rig.engine.sustain).toBe(true)
    target.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }))
    target.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA' }))
    rig.render(0.3)
    expect(rig.stage.liveVoices('A')).toBe(1)
    target.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }))
    rig.render(1.2)
    expect(rig.stage.liveVoices('A')).toBe(0)
    kb.detach()

    const access = new FakeMidiAccess()
    const input = new FakeMidiInput('m1', 'Keys')
    access.add(input)
    const conn = await connectMidi(() => Promise.resolve(access), () => rig.engine, () => undefined, () => undefined)
    input.send([0xb0, 64, 127])
    input.send([0x90, 62, 100])
    input.send([0x80, 62, 0])
    rig.render(0.3)
    expect(rig.stage.liveVoices('A')).toBe(1)
    input.send([0xb0, 64, 0])
    rig.render(1.2)
    expect(rig.stage.liveVoices('A')).toBe(0)
    conn?.detach()
  })

  it('String Res resonates more with the pedal down (simulated sympathetic resonance)', async () => {
    const res = async (pedal: boolean, stringRes: boolean) => {
      const rig = await makeStageRig({ sound: (s) => updateLayer(s, 'A', { stringRes }) })
      if (pedal) rig.engine.setSustain(true, 'ui')
      return rig.play(48, 100, 0.3, 0.05)
    }
    const dryPedal = await res(true, false)
    const resPedal = await res(true, true)
    const resNoPedal = await res(false, true)
    const dryNoPedal = await res(false, false)
    expect(difference(resPedal, dryPedal)).toBeGreaterThan(difference(resNoPedal, dryNoPedal))
  })

  it('no soft or sostenuto pedal behaviour is claimed', () => {
    expect(Object.values(FUNCTIONAL).join(' ')).not.toMatch(/sostenuto|soft pedal/i)
  })
})

describe('effects.graph — one context, layer buses, ordered chain, master/limiter, cleanup', () => {
  it('creates exactly one AudioContext for every layer, voice and effect', async () => {
    const lib = new PianoLibrary({ fetchAsset: (p) => Promise.resolve(readPublicAsset(p)), lowNote: 28, highNote: 100, yieldToEventLoop: () => Promise.resolve(), toneOptions: { sampleRate: 8000, durationScale: 0.1 }, maxZoneSeconds: 0.3 })
    await lib.load()
    const made: SimAudioContext[] = []
    const stage = new StageAudio({ createContext: () => (made.push(new SimAudioContext(SR)), made[made.length - 1]), library: lib, irScale: 0.1 })
    let s = both(defaultSound())
    s = editUnit(s, 'reverb', { on: true })
    stage.apply(s)
    const engine = new LayeredEngine({ A: stage.voices('A'), B: stage.voices('B') }, s)
    for (const n of [48, 52, 55, 60]) engine.noteOn(n, 100, 'k')
    stage.apply(editUnit(s, 'amp', { on: true, type: 'rotary' }))
    expect(made).toHaveLength(1)
    engine.dispose()
    stage.dispose()
  })

  it('layer bus → chain in documented order → level → master → limiter → the single destination', async () => {
    const rig = await makeStageRig()
    const g = graphOf(rig.stage)
    const dest = rig.ctx.destination as unknown as SimNode
    expect([...dest.inputs]).toEqual([g.ceiling])
    expect([...g.limiter.outputs]).toEqual([g.ceiling])
    expect([...g.master.outputs]).toEqual([g.limiter])
    expect([...g.rotary.output.outputs]).toEqual([g.master])
    for (const id of ['A', 'B'] as const) {
      const L = g.layers[id]
      const units = CHAIN_ORDER.map((k) => L.chain.units[k] as unknown as { input: SimNode; output: SimNode })
      for (let i = 0; i < units.length - 1; i++) expect(units[i].output.outputs.has(units[i + 1].input), `${CHAIN_ORDER[i]}→${CHAIN_ORDER[i + 1]}`).toBe(true)
      expect(units[units.length - 1].output.outputs.has(L.level)).toBe(true)
      // Reverb (last unit) precedes the Rotary send; the send feeds the shared rotary, never the destination.
      expect(L.level.outputs.has(L.toRotary)).toBe(true)
      expect(L.toRotary.outputs.has(g.rotary.input)).toBe(true)
      expect(L.direct.outputs.has(g.master)).toBe(true)
    }
    expect(CHAIN_ORDER).toEqual(['mod1', 'mod2', 'delay', 'amp', 'comp', 'reverb'])
  })

  it('nothing bypasses the master path: Master Level 0 silences voices, effects and rotary', async () => {
    let s = both(defaultSound())
    for (const u of ['mod1', 'mod2', 'delay', 'amp', 'comp', 'reverb'] as const) s = editUnit(s, u, { on: true })
    s = editUnit(s, 'amp', { type: 'rotary' })
    const rig = await makeStageRig({ sound: () => ({ ...s, master: 0 }) })
    for (const n of [48, 60, 64]) rig.engine.noteOn(n, 127, 'k')
    rig.render(0.1)
    expect(peak(rig.render(0.4))).toBe(0)
  })

  it('the limiter keeps a loud two-layer chord bounded', async () => {
    const rig = await makeStageRig({ sound: (s) => ({ ...both(s), master: 127 }) })
    for (const n of [36, 40, 43, 48, 52, 55, 60, 64, 67, 72]) rig.engine.noteOn(n, 127, 'k')
    const out = rig.render(0.4)
    expect(rms(out)).toBeGreaterThan(0.05)
    expect(peak(out)).toBeLessThanOrEqual(1)
  })

  it('parameter changes are ramped: switching effects mid-note causes no click', async () => {
    const rig = await makeStageRig()
    rig.engine.noteOn(60, 100, 'k')
    const before = rig.render(0.3)
    rig.set((s) => editUnit(editUnit(s, 'reverb', { on: true, dryWet: 127 }), 'mod1', { on: true, type: 'trem' }))
    const after = rig.render(0.1)
    const jump = (x: Float32Array, a: number, b: number) => {
      let m = 0
      for (let i = Math.max(1, a); i < b; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1]))
      return m
    }
    const typical = jump(before, 2000, before.length)
    expect(jump(after, 0, 400)).toBeLessThan(typical * 3 + 1e-3)
  })

  it('dispose disconnects every node, stops every LFO and closes the context', async () => {
    const rig = await makeStageRig({ sound: both })
    rig.set((s) => editUnit(s, 'mod2', { on: true }))
    rig.engine.noteOn(60, 100, 'k')
    rig.render(0.1)
    expect(rig.ctx.liveModulatorCount()).toBeGreaterThan(0)
    rig.engine.dispose()
    rig.stage.dispose()
    expect(rig.ctx.liveSourceCount()).toBe(0)
    expect(rig.ctx.liveModulatorCount()).toBe(0)
    expect(rig.ctx.connectedNodeCount()).toBe(0)
    expect(rig.ctx.closed).toBe(true)
  })
})

describe('effects.routing — focus, group, global, bypass, dry/wet, order, To Rotary', () => {
  /** Render one note on layer B only (A disabled) with the given sound transform. */
  const renderB = async (f: (s: SoundState) => SoundState) => {
    const rig = await makeStageRig({ sound: (s) => f(onlyB(s)) })
    return rig.play(60, 100, 0.3, 0.2)
  }
  const reverbOn = { on: true, dryWet: 110 }

  it('edits go to the focused chain only; focus follows the layer button', async () => {
    // Focus A (default) and turn reverb on: layer B is unaffected.
    const aOnly = await renderB((s) => editUnit(s, 'reverb', reverbOn))
    const plain = await renderB((s) => s)
    expect(difference(aOnly, plain)).toBeLessThan(1e-6)
    // Pressing layer B focuses B's effects; the same edit now changes B.
    const bFocus = await renderB((s) => editUnit(pressLayerButton(s, 'B'), 'reverb', reverbOn))
    expect(difference(bFocus, plain)).toBeGreaterThan(0.05)
  })

  it('manual focus button switches the effect focus without changing the piano focus', () => {
    const s = defaultSound()
    const next = activate(s, 'effects-focus-piano', bctx, new TapTempo())!
    expect(next.fx.focus).toBe('B')
    expect(next.piano.focus).toBe('A')
  })

  it('group mode shares one setting across both piano chains', async () => {
    const grouped = await renderB((s) => editUnit(setGroup(s, true), 'reverb', reverbOn))
    const plain = await renderB((s) => s)
    expect(difference(grouped, plain)).toBeGreaterThan(0.05)
    const s = editUnit(setGroup(defaultSound(), true), 'delay', { on: true })
    expect(s.fx.chains.A.delay.on && s.fx.chains.B.delay.on).toBe(true)
    // Shift + Piano focus toggles group.
    expect(activate(defaultSound(), 'effects-focus-piano', { ...bctx, shift: true }, new TapTempo())!.fx.group).toBe(true)
  })

  it('global mode (Delay/Comp/Reverb) applies one unit to every layer', async () => {
    const global = await renderB((s) => editUnit(setGlobal(s, 'reverb', true), 'reverb', reverbOn))
    const plain = await renderB((s) => s)
    expect(difference(global, plain)).toBeGreaterThan(0.05)
    const s = editUnit(setGlobal(defaultSound(), 'comp', true), 'comp', { on: true, amount: 100 })
    expect(effectiveUnit(s, 'B', 'comp')).toEqual(effectiveUnit(s, 'A', 'comp'))
    expect(s.fx.chains.B.comp.on).toBe(false)
    const shifted = activate(defaultSound(), 'effects-delay-on', { ...bctx, shift: true }, new TapTempo())!
    expect(shifted.fx.global.delay).toBe(true)
  })

  it('per-unit bypass and the all-effects bypass change the actual signal path', async () => {
    const plain = await renderB((s) => s)
    const focusB = (s: SoundState) => pressLayerButton(s, 'B')
    for (const unit of ['mod1', 'mod2', 'delay', 'amp', 'comp', 'reverb'] as const) {
      const patch = unit === 'amp' ? { on: true, type: 'twin' as const, drive: 100 } : unit === 'comp' ? { on: true, amount: 127 } : { on: true }
      const on = await renderB((s) => editUnit(focusB(s), unit, patch as never))
      expect(difference(on, plain), unit).toBeGreaterThan(0.02)
      const allOff = await renderB((s) => ({ ...editUnit(focusB(s), unit, patch as never), fx: { ...editUnit(focusB(s), unit, patch as never).fx, on: false } }))
      expect(difference(allOff, plain), `${unit} all-bypass`).toBeLessThan(0.02)
    }
  })

  it('dry/wet moves the balance of the processed signal', async () => {
    const focusB = (s: SoundState) => pressLayerButton(s, 'B')
    const lo = await renderB((s) => editUnit(focusB(s), 'reverb', { on: true, dryWet: 10 }))
    const hi = await renderB((s) => editUnit(focusB(s), 'reverb', { on: true, dryWet: 127 }))
    expect(difference(lo, hi)).toBeGreaterThan(0.1)
  })

  it('delay repeats continue after the key is released (feedback path in the layer)', async () => {
    const focusB = (s: SoundState) => pressLayerButton(s, 'B')
    const rig = await makeStageRig({ sound: (s) => editUnit(focusB(onlyB(s)), 'delay', { on: true, tempo: 70, feedback: 100, dryWet: 100 }) })
    const plain = await makeStageRig({ sound: onlyB })
    rig.play(60, 100, 0.15, 0)
    plain.play(60, 100, 0.15, 0)
    expect(rms(rig.render(0.5))).toBeGreaterThan(rms(plain.render(0.5)) * 2)
  })

  it('To Rotary routes the layer (after its reverb) into the shared Rotary', async () => {
    const focusB = (s: SoundState) => pressLayerButton(s, 'B')
    const rig = await makeStageRig({ sound: (s) => editUnit(focusB(onlyB(s)), 'amp', { on: true, type: 'rotary' }) })
    const g = graphOf(rig.stage)
    rig.engine.noteOn(60, 100, 'k')
    const { left, right } = rig.ctx.renderStereo(0.6)
    expect(g.layers.B.toRotary as unknown as { gain: { valueAt(t: number): number } }).toBeDefined()
    expect((g.layers.B.toRotary as unknown as { gain: { valueAt(t: number): number } }).gain.valueAt(rig.ctx.currentTime)).toBeCloseTo(1)
    expect((g.layers.B.direct as unknown as { gain: { valueAt(t: number): number } }).gain.valueAt(rig.ctx.currentTime)).toBeCloseTo(0)
    expect(difference(left, right)).toBeGreaterThan(0.05)
    // Rotary speed is shared performance state.
    const slow = rig.render(0.3)
    rig.set((s) => ({ ...s, rotary: { ...s.rotary, fast: true } }))
    rig.render(1)
    expect(difference(slow, rig.render(0.3))).toBeGreaterThan(0.05)
  })
})
