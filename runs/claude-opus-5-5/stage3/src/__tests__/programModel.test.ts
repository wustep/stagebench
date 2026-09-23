// Phase 3 program model: canonical state round-trips through the 32-program bank and the 8 Live
// slots (serialised through storage), zone/split/crossfade maths, morph interpolation and Layer
// Scenes — pure state, no audio.
import { describe, expect, it } from 'vitest'
import { factoryPrograms } from '../model/factory'
import { applyMorphs, assignMorph, clearMorph, MORPH_DESTS, morphEnd } from '../model/morph'
import { ORGAN_MODELS, VIB_TYPES } from '../model/organState'
import { deepEqual, isEdited, LIVE_SLOTS, MemoryStorage, normalizeSound, programPart, PROGRAM_SLOTS, ProgramBank, STORAGE_KEYS } from '../model/programs'
import {
  CHAINS,
  defaultSound,
  editUnit,
  enableMap,
  focusSlot,
  SLOTS,
  SPLIT_POSITIONS,
  switchScene,
  syncScene,
  updateLayer,
  updateOrganLayer,
  updateSlot,
  updateSynthLayer,
  type SoundState,
} from '../model/sound'
import { ARP_DIRECTIONS, FILTER_TYPES, LFO_DESTS, LFO_WAVES, SYNTH_WAVES, VOICE_MODES } from '../model/synthState'
import { setSplitPoint, stepSplitPoint, stepZone, zoneGain, zoneOfNote, ZONE_RANGES } from '../model/zones'

/** A state that differs from the default in every stored area, varied by `i`. */
function variant(i: number): SoundState {
  let s = defaultSound()
  s = updateLayer(s, 'A', { type: (['grand', 'upright', 'electric', 'clav', 'digital', 'misc'] as const)[i % 6], level: 20 + i, octave: (i % 3) - 1, unison: i % 4, softRelease: i % 2 === 0 })
  s = updateLayer(s, 'B', { enabled: i % 2 === 1, zone: [1 + (i % 4), 4] })
  s = updateOrganLayer(s, 'A', { model: ORGAN_MODELS[i % ORGAN_MODELS.length], drawbars: Array.from({ length: 9 }, (_, k) => (i + k) % 9), vibOn: i % 2 === 0, perc: { on: true, soft: i % 2 === 0, fast: i % 3 === 0, third: i % 2 === 1 } })
  s = updateOrganLayer(s, 'B', { enabled: i % 3 === 0, level: 127 - i })
  s = { ...s, organ: { ...s.organ, on: i % 2 === 0, vibType: VIB_TYPES[i % 6] }, synth: { ...s.synth, on: i % 3 !== 0, kbHold: i % 5 === 0 } }
  s = updateSynthLayer(s, 'A', {
    wave: i % SYNTH_WAVES.length,
    oscCtrl: (i * 7) % 128,
    pitch: { coarse: (i % 49) - 24, fine: (i % 101) - 50 },
    filter: { on: true, type: FILTER_TYPES[i % 4], freq: (i * 11) % 128, res: (i * 3) % 128, envAmt: i, track: i % 4, drive: (i + 1) % 4 },
    lfo: { wave: LFO_WAVES[i % 5], dest: LFO_DESTS[i % 4], rate: i * 2, amount: 100 - i, sync: i % 2 === 0 },
    voice: { mode: VOICE_MODES[i % 3], priority: (['last', 'low', 'high'] as const)[i % 3], glide: i },
    arp: { mode: (['poly', 'arp', 'gate'] as const)[i % 3], run: i % 2 === 0, rate: i * 3, range: i * 4, direction: ARP_DIRECTIONS[i % 4], sync: i % 3 === 0 },
  })
  s = updateSynthLayer(s, 'C', { enabled: true, level: i })
  s = focusSlot(s, SLOTS[i % SLOTS.length])
  s = editUnit(s, 'reverb', { on: true, dryWet: i * 3 })
  s = editUnit(s, 'delay', { on: i % 2 === 0, tempo: i * 2, sync: i % 2 === 1 })
  s = { ...s, fx: { ...s.fx, synthGroup: i % 4 === 0, global: { ...s.fx.global, comp: i % 3 === 1 } } }
  s = { ...s, rotary: { fast: i % 2 === 0, drive: i * 3, organ: i % 3 !== 1, stopMode: i % 4 === 0 } }
  s = { ...s, split: { on: i % 2 === 0, points: [{ pos: i % 3 === 0 ? null : 1, xfade: 6 }, { pos: 4 + (i % 3), xfade: [0, 6, 12][i % 3] }, { pos: 9, xfade: 12 }] } }
  s = assignMorph(s, 'wheel', 'synth.A.filterFreq', (i * 5) % 128)
  s = assignMorph(s, 'pedal', 'organ.A.level', i % 127)
  s = { ...s, clock: { bpm: 60 + i * 5, kbSync: i % 2 === 0 }, transpose: { on: i % 2 === 0, semitones: (i % 13) - 6 } }
  s = syncScene(s)
  s = switchScene(s, 'II')
  s = updateSlot(s, 'synthB', { enabled: true })
  s = syncScene(s)
  return s
}

describe('programs.roundtrip — every supported area survives store/reload in all 32 + 8 slots', () => {
  it('32 programs and 8 Live slots round-trip through storage (a reloaded bank)', () => {
    const storage = new MemoryStorage()
    const bank = new ProgramBank(storage)
    expect(bank.programs).toHaveLength(PROGRAM_SLOTS)
    expect(bank.live).toHaveLength(LIVE_SLOTS)
    for (let i = 0; i < PROGRAM_SLOTS; i++) bank.store(false, i, { name: `Prog ${i}`, sound: variant(i) })
    for (let i = 0; i < LIVE_SLOTS; i++) bank.store(true, i, { name: `Live ${i}`, sound: variant(40 + i) })
    const reloaded = new ProgramBank(storage)
    for (let i = 0; i < PROGRAM_SLOTS; i++) {
      expect(reloaded.get(false, i).name).toBe(`Prog ${i}`)
      expect(deepEqual(programPart(reloaded.get(false, i).sound), programPart(variant(i))), `program ${i}`).toBe(true)
    }
    for (let i = 0; i < LIVE_SLOTS; i++) expect(deepEqual(programPart(reloaded.get(true, i).sound), programPart(variant(40 + i))), `live ${i}`).toBe(true)
  })

  it('the variants really touch every stored area (so the round-trip is meaningful)', () => {
    const d = defaultSound()
    const v = variant(5)
    for (const key of ['piano', 'organ', 'synth', 'fx', 'rotary', 'split', 'scenes', 'morph', 'clock', 'transpose'] as const) {
      expect(deepEqual(v[key], d[key]), key).toBe(false)
    }
    for (const c of CHAINS) expect(v.fx.chains[c].reverb.on).toBe(c === v.fx.focus || (v.fx.synthGroup && c.startsWith('synth') && v.fx.focus.startsWith('synth')))
  })

  it('Master Level and the pitch stick are performance state, not program state', () => {
    const a = { ...defaultSound(), master: 20, pitchStick: 50 }
    expect(isEdited(a, defaultSound())).toBe(false)
    expect(programPart(a)).not.toHaveProperty('master')
  })

  it('the dirty flag is truthful: an edit marks it, reverting the edit clears it', () => {
    const stored = defaultSound()
    const edited = updateLayer(stored, 'A', { level: 30 })
    expect(isEdited(edited, stored)).toBe(true)
    expect(isEdited(updateLayer(edited, 'A', { level: stored.piano.layers.A.level }), stored)).toBe(false)
  })

  it('corrupt or stale storage never breaks the bank: entries normalise to the schema', () => {
    const storage = new MemoryStorage()
    storage.setItem(STORAGE_KEYS.programs, JSON.stringify([{ name: 42, sound: { piano: { on: 'yes', layers: { A: { level: 'x', octave: 1 } } }, morph: { wheel: { bogus: 1, 'synth.A.oscCtrl': 20 } } } }, 'garbage']))
    storage.setItem(STORAGE_KEYS.live, '{not json')
    const bank = new ProgramBank(storage)
    const p = bank.get(false, 0)
    expect(p.name).toBe('Grand Piano')
    expect(p.sound.piano.on).toBe(true)
    expect(p.sound.piano.layers.A.level).toBe(110)
    expect(p.sound.piano.layers.A.octave).toBe(1)
    expect(p.sound.morph.wheel).toEqual({ 'synth.A.oscCtrl': 20 })
    expect(bank.get(false, 1).name).toBe('B3 Rock Rotary')
    expect(bank.get(true, 0).name).toBe('Grand Piano')
    expect(normalizeSound(null)).toEqual(defaultSound())
  })

  it('ships at least 8 factory programs covering piano, organ, synth, split and layered setups', () => {
    const f = factoryPrograms()
    expect(f.length).toBeGreaterThanOrEqual(8)
    expect(deepEqual(f[0].sound, defaultSound())).toBe(true)
    expect(f.some((p) => p.sound.organ.on && !p.sound.piano.on)).toBe(true)
    expect(f.some((p) => p.sound.synth.on && !p.sound.piano.on)).toBe(true)
    expect(f.some((p) => p.sound.split.on)).toBe(true)
    expect(f.some((p) => p.sound.piano.on && p.sound.synth.on && !p.sound.split.on)).toBe(true)
    expect(new Set(f.map((p) => p.name)).size).toBe(f.length)
  })
})

describe('splits.zones — 11 positions, up to 4 zones, Off/±6/±12 crossfades', () => {
  const split = (points: [number | null, number | null, number | null], xf: [number, number, number] = [0, 0, 0]) => ({
    on: true,
    points: points.map((pos, i) => ({ pos, xfade: xf[i] })) as SoundState['split']['points'],
  })

  it('the 11 documented positions C2…C7', () => {
    expect(SPLIT_POSITIONS).toEqual([36, 41, 48, 53, 60, 65, 72, 77, 84, 89, 96])
  })

  it('three points make four zones; an Off point merges its neighbours', () => {
    const s = split([2, 4, 8])
    expect([47, 48, 59, 60, 83, 84].map((n) => zoneOfNote(s, n))).toEqual([1, 2, 2, 3, 3, 4])
    const merged = split([null, 4, null])
    expect(zoneGain(merged, [1, 1], 40)).toBe(1)
    expect(zoneGain(merged, [2, 2], 40)).toBe(1)
    expect(zoneGain(merged, [2, 2], 70)).toBe(0)
    expect(zoneGain(merged, [3, 4], 70)).toBe(1)
    expect(zoneGain({ ...merged, on: false }, [1, 1], 90)).toBe(1)
  })

  it('crossfade Off switches at the point; ±6 and ±12 fade equal-power across that many semitones each side', () => {
    for (const w of [0, 6, 12]) {
      const s = split([null, 4, null], [0, w, 0])
      const low = (n: number) => zoneGain(s, [1, 2], n)
      const high = (n: number) => zoneGain(s, [3, 4], n)
      if (w === 0) {
        expect([low(59), high(59), low(60), high(60)]).toEqual([1, 0, 0, 1])
        continue
      }
      expect(low(60 - w)).toBeCloseTo(1, 6)
      expect(high(60 - w)).toBe(0)
      expect(low(60 + w)).toBe(0)
      expect(high(60 + w)).toBeCloseTo(1, 6)
      expect(low(60)).toBeCloseTo(Math.SQRT1_2, 6)
      expect(low(60) ** 2 + high(60) ** 2).toBeCloseTo(1, 6)
      expect(high(60 - w + 1)).toBeGreaterThan(0)
    }
  })

  it('split points stay ordered Low < Mid < High; the dial steps through Off and the free positions', () => {
    const s = split([2, 4, 8])
    expect(setSplitPoint(s, 0, 5)).toBe(s)
    expect(setSplitPoint(s, 2, 3)).toBe(s)
    expect(setSplitPoint(s, 1, 7).points[1].pos).toBe(7)
    let m = split([null, 0, null])
    const seen: (number | null)[] = []
    for (let i = 0; i < 12; i++) {
      seen.push(m.points[1].pos)
      m = stepSplitPoint(m, 1, 1)
    }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10])
    expect(stepSplitPoint(split([null, 0, null]), 1, -1).points[1].pos).toBeNull()
  })

  it('KB zones step through every contiguous range', () => {
    expect(ZONE_RANGES).toHaveLength(10)
    let z = ZONE_RANGES[0]
    const seen = new Set<string>()
    for (let i = 0; i < 10; i++) {
      seen.add(z.join('-'))
      z = stepZone(z, 1)
    }
    expect(seen.size).toBe(10)
    expect(stepZone([1, 4], -1)).toEqual([4, 4])
  })
})

describe('morph.assignments — interpolation, several destinations, opposite directions, clearing', () => {
  it('every destination in the programs spec is morphable', () => {
    const keys = [...MORPH_DESTS.keys()]
    for (const k of ['organ.A.level', 'organ.A.drawbar1', 'organ.B.drawbar9', 'rotary.speed', 'piano.A.level', 'synth.C.level', 'synth.A.lfoRate', 'synth.A.oscCtrl', 'synth.A.lfoAmount', 'synth.A.filterFreq', 'synth.A.filterRes', 'synth.A.arpRate'])
      expect(keys).toContain(k)
    for (const u of ['mod1.rate', 'mod1.amount', 'mod2.amount', 'delay.tempo', 'delay.feedback', 'delay.dryWet', 'amp.freq', 'amp.drive', 'reverb.dryWet']) for (const c of CHAINS) expect(keys).toContain(`fx.${c}.${u}`)
  })

  it('a source interpolates each assigned destination linearly; one can rise while another falls', () => {
    let s = defaultSound()
    s = assignMorph(s, 'wheel', 'piano.A.level', 10)
    s = assignMorph(s, 'wheel', 'synth.A.filterFreq', 127)
    const base = s.synth.layers.A.filter.freq
    expect(applyMorphs(s, 0, 0)).toBe(s)
    const half = applyMorphs(s, 63.5, 0)
    expect(half.piano.layers.A.level).toBeCloseTo((110 + 10) / 2, 6)
    expect(half.synth.layers.A.filter.freq).toBeCloseTo((base + 127) / 2, 6)
    const full = applyMorphs(s, 127, 0)
    expect(full.piano.layers.A.level).toBe(10)
    expect(full.synth.layers.A.filter.freq).toBe(127)
    // The stored (base) values are untouched: morphs never write the program's sound.
    expect(s.piano.layers.A.level).toBe(110)
  })

  it('Wheel and Control Pedal are independent sources; drawbars morph in whole steps', () => {
    let s = updateOrganLayer(defaultSound(), 'A', { drawbars: [0, 0, 0, 0, 0, 0, 0, 0, 0] })
    s = assignMorph(s, 'pedal', 'organ.A.drawbar1', 8)
    s = assignMorph(s, 'wheel', 'organ.A.level', 0)
    expect(applyMorphs(s, 0, 127).organ.layers.A.drawbars[0]).toBe(8)
    expect(applyMorphs(s, 0, 64).organ.layers.A.drawbars[0]).toBe(4)
    expect(applyMorphs(s, 127, 0).organ.layers.A.level).toBe(0)
    expect(applyMorphs(s, 127, 0).organ.layers.A.drawbars[0]).toBe(0)
    expect(morphEnd(s, 'pedal', 'organ.A.drawbar1')).toBe(8)
  })

  it('returning a destination to its start removes that assignment; Shift+source clears a source', () => {
    let s = assignMorph(defaultSound(), 'wheel', 'piano.A.level', 50)
    s = assignMorph(s, 'wheel', 'synth.A.oscCtrl', 90)
    s = assignMorph(s, 'pedal', 'piano.B.level', 0)
    s = assignMorph(s, 'wheel', 'piano.A.level', 110)
    expect(Object.keys(s.morph.wheel)).toEqual(['synth.A.oscCtrl'])
    s = clearMorph(s, 'wheel')
    expect(s.morph.wheel).toEqual({})
    expect(Object.keys(s.morph.pedal)).toEqual(['piano.B.level'])
  })
})

describe('scenes.switching — Scene I/II toggle only layer enables', () => {
  it('each scene keeps its own layer enables; sound parameters are shared, never duplicated', () => {
    let s = syncScene(defaultSound())
    expect(s.scenes.enabled.I).toEqual(enableMap(s))
    s = switchScene(s, 'II')
    s = syncScene(updateSlot(updateSlot(s, 'A', { enabled: false }), 'organA', { enabled: true }))
    s = syncScene(updateLayer(s, 'A', { type: 'clav' })) // a sound edit made in Scene II
    expect(s.scenes.enabled.II.A).toBe(false)
    s = switchScene(s, 'I')
    expect(enableMap(s).A).toBe(true)
    expect(enableMap(s).organA).toBe(true) // organ A was already enabled in the default
    expect(s.piano.layers.A.type).toBe('clav') // shared, not duplicated per scene
    s = switchScene(s, 'II')
    expect(enableMap(s).A).toBe(false)
    expect(s.scenes.active).toBe('II')
    expect(Object.keys(s.scenes.enabled.I).sort()).toEqual([...SLOTS].sort())
  })
})
