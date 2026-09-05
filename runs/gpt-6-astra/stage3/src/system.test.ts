import { describe, expect, it, vi } from 'vitest'
import { SystemEngine, type StorageBoundary } from './system-engine'
import { PianoLibrary } from './library'
import type { LayerAudioBoundary } from './layer-audio'
import { allIds, effectiveState, factories, fullState, positions, snapshot, sound, zoneGain } from './system-state'
import { InputController } from './inputs'
export function fixture() {
  const values = new Map<string, string>(), storage: StorageBoundary = { getItem: key => values.get(key) ?? null, setItem: (key, v) => { values.set(key, v) } }
  const voice = vi.fn(() => ({ release: vi.fn(), stop: vi.fn() }))
  const output: LayerAudioBoundary = { library: new PianoLibrary(), start: vi.fn(async () => {}), configure: vi.fn(), voice, extraVoice: voice, clear: vi.fn(), close: vi.fn(), pedal: vi.fn() }
  let time = 0
  return { engine: new SystemEngine(output, storage, () => time), output, storage, setTime: (v: number) => { time = v } }
}
describe('Serializable Stage 4 programs', () => {
  it('round-trips all supported state through every slot, excluding Master Level and transient morph inputs', () => {
    const { engine: e } = fixture()
    for (let i = 0; i < 32; i++) {
      e.select(i); e.setLayer('B', { enabled: true, octave: 1, type: 'Electric' }); e.extraLayer('Ob', { enabled: true, model: 3, drawbars: [1, 2, 3, 4, 5, 6, 7, 8, 8] }); e.extraLayer('Sc', { enabled: true, wave: 13, ctrl: .71, lfoSync: true }); e.focusExtra('Sc'); e.effect('delay', { on: true, feedback: .7 }); e.edit(s => { s.split = true; s.points[0].enabled = true; s.points[0].width = 12; s.zones.Ob = [0, 1]; s.transpose = 3 }); e.assign('Wheel', 'system.synth.Sc.ctrl', .9); e.set({ bpm: 155 })
      expect(e.dirty).toBe(true); const expected = snapshot(e.state); e.store(); e.store(); expect(e.dirty).toBe(false)
      e.select((i + 1) % 32); e.set({ master: .2 }); e.select(i); expect(snapshot(e.state)).toEqual(expected); expect(e.state.master).toBe(.2)
    }
  })
  it('Store As names, auditions destinations, confirms original edit and cancel restores pending edit', () => {
    const { engine: e } = fixture(); e.extraLayer('Sa', { enabled: true, wave: 12 }); const edited = snapshot(e.state)
    e.store(true); e.nameDraft = '  Wide square  '; e.finishName(); e.select(4); expect(e.system.organ.Oa.model).toBe(4); e.store(); expect(e.slots[4].name).toBe('Wide square'); expect(snapshot(e.state)).toEqual(edited)
    e.extraLayer('Sa', { ctrl: .9 }); const before = snapshot(e.state); e.store(); e.select(2); e.cancel(); expect(snapshot(e.state)).toEqual(before)
  })
  it('persists all eight Live slots across reload and copies from Live to regular slots', () => {
    const { engine: e, output, storage } = fixture(); e.toggleLive()
    for (let i = 0; i < 8; i++) { e.select(i); e.extraLayer('Sa', { wave: i }); expect(e.dirty).toBe(false) }
    const restored = new SystemEngine(output, storage); restored.toggleLive()
    for (let i = 0; i < 8; i++) { restored.select(i); expect(restored.system.synth.Sa.wave).toBe(i) }
    restored.store(); restored.toggleLive(); restored.select(30); restored.store(); expect(restored.slots[30].state.system!.synth.Sa.wave).toBe(7)
  })
  it('discards unsaved edits, supports a single discarded-edit undo and four-page navigation', () => {
    const { engine: e } = fixture(); e.setLayer('A', { level: .12 }); e.select(1); e.undo(); expect(e.state.layers.A.level).toBe(.12); e.select(0); expect(e.state.layers.A.level).toBe(.75)
    e.browsePage(1); expect(e.selected).toBe(8); e.browsePage(-1); expect(e.selected).toBe(0); e.browsePage(-1); expect(e.selected).toBe(24)
    expect(new Set(factories().slice(0, 8).map(p => JSON.stringify(p.state))).size).toBe(8)
  })
  it('reports storage failures without losing playable state', () => {
    const { output } = fixture(); const e = new SystemEngine(output, { getItem: () => '{bad', setItem: () => { throw new Error('quota') } }); expect(e.storageError).toContain('Storage'); e.toggleLive(); e.extraLayer('Sa', { enabled: true }); expect(e.system.synth.Sa.enabled).toBe(true)
  })
})
describe('Shared performance system', () => {
  it('routes all seven layers with transpose/octave, zones, focus and shared/group/global effects', async () => {
    const { engine: e, output } = fixture()
    for (const id of allIds) sound(e.state, id).enabled = true
    e.edit(s => { s.transpose = 2; s.synth.Sc.octave = 1 }); await e.on('chord', 60, 100)
    expect(output.voice).toHaveBeenCalledTimes(7); expect(output.voice).toHaveBeenCalledWith('Sc', 74, 100, expect.any(Function)); expect(e.notes.size).toBe(7)
    e.focusExtra('Sc'); e.effect('reverb', { on: true, wet: .8 }); expect(e.system.synth.Sc.effects.reverb.wet).toBe(.8); expect(e.system.synth.Sa.effects.reverb.wet).toBe(.3)
    e.group(true); e.effect('delay', { on: true }); expect(Object.values(e.system.synth).every(p => p.effects.delay.on)).toBe(true)
    e.focusExtra('Ob'); e.effect('mod1', { on: true }); expect(e.system.organEffects.mod1.on).toBe(true)
    e.global('reverb', true); e.effect('reverb', { wet: .9 }); expect(e.state.layers.A.effects.reverb.wet).toBe(.9); expect(e.system.synth.Sc.effects.reverb.wet).toBe(.9)
    e.allOff(); expect(e.notes.size).toBe(0); e.dispose(); expect(output.close).toHaveBeenCalled()
  })
  it('gives exact hard boundaries and complementary ±6/±12 gains at all eleven positions', () => {
    const s = fullState().system!; s.split = true; s.zones.A = [0, 0]; s.zones.Sa = [1, 3]
    for (const note of positions) for (const width of [0, 6, 12]) { s.points[1] = { enabled: true, note, width }; expect(zoneGain(s, 'A', note - width - 1)).toBe(1); expect(zoneGain(s, 'Sa', note + width + 1)).toBe(1); for (let n = note - 13; n < note + 14; n++) expect(zoneGain(s, 'A', n) + zoneGain(s, 'Sa', n)).toBeCloseTo(1); expect(zoneGain(s, 'A', note)).toBe(width ? .5 : 0) }
    s.points.forEach(p => { p.enabled = true }); s.points[0].note = 48; s.points[1].note = 60; s.points[2].note = 72; s.points.forEach(p => { p.width = 0 }); s.zones.Ob = [1, 2]; expect(zoneGain(s, 'Ob', 50)).toBe(1); expect(zoneGain(s, 'Ob', 74)).toBe(0)
  })
  it('switches enable-only scenes while retaining sound parameters and independent edits', () => {
    const { engine: e } = fixture(); e.extraLayer('Sa', { wave: 13 }); e.setLayer('B', { enabled: true }); e.scene(1); expect(e.state.layers.A.enabled).toBe(false); expect(e.system.synth.Sa.enabled).toBe(true); expect(e.system.synth.Sa.wave).toBe(13); e.extraLayer('Ob', { enabled: true }); e.scene(0); expect(e.state.layers.B.enabled).toBe(true); expect(e.system.organ.Ob.enabled).toBe(false); e.scene(1); expect(e.system.organ.Ob.enabled).toBe(true)
  })
  it('interpolates increasing/decreasing morphs without dirtying base state, and clears destinations', () => {
    const { engine: e } = fixture(); e.assign('Wheel', 'layers.A.level', .1); e.assign('Wheel', 'system.synth.Sa.cutoff', 1); e.store(); e.store(); e.morph('Wheel', .5)
    const rendered = effectiveState(e.state); expect(rendered.layers.A.level).toBeCloseTo(.425); expect(rendered.system!.synth.Sa.cutoff).toBeCloseTo(.9); expect(e.state.layers.A.level).toBe(.75); expect(e.dirty).toBe(false)
    e.assign('Wheel', 'layers.A.level', .75); expect(e.system.morphs).toHaveLength(1); e.clearMorph('Wheel'); expect(e.system.morphs).toHaveLength(0)
  })
  it('accepts MIDI wheel/pedal, four clock taps, sustain, Panic and release-during-start cancellation', async () => {
    const { engine: e, setTime } = fixture(), input = new InputController(e)
    input.midi('port', new Uint8Array([0xb0, 11, 127])); expect(e.system.pedal).toBe(1); input.midi('port', new Uint8Array([0xb0, 1, 64])); expect(e.system.wheel).toBeCloseTo(64 / 127)
    for (const time of [0, 600, 1200, 1800]) { setTime(time); e.masterTap() }; expect(e.state.bpm).toBe(100)
    e.extraLayer('Sa', { enabled: true }); await e.on('test', 60); e.sustain('pedal', true); e.off('test'); expect(e.extra.Sa.notes.size).toBe(1); input.allOff(); expect(e.notes.size).toBe(0); expect(e.pedals.size).toBe(0); expect(e.system.wheel).toBe(0); expect(e.system.pedal).toBe(0)
    const pending = e.on('cancel', 60); e.allOff(); await pending; expect(e.notes.size).toBe(0)
  })
})
