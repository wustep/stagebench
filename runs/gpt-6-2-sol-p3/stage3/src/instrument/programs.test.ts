import { describe, expect, it } from 'vitest'
import { boundControlIds, panelLamp, panelUpdate, panelValue, tapDelay } from '../hardware/bindings'
import { actionControlIds, unsupportedControls } from '../hardware/panelActions'
import { panelControls } from '../hardware/panels'
import { effectiveUnit, initialSettings } from '../piano/settings'
import { assignMorph, clearMorph, effectiveSettings, isMorphed } from './morph'
import { layerKeys, splitNotes, splitPoints, zoneGain } from './parameters'
import {
  address, capture, edited, editLayer, editSplit, layerAt, libraryKey, loadLibrary, recall, saveSlot, switchScene, toggleSplit,
} from './programs'
import type { Bank, ProgramStorage } from './programs'

describe('canonical program library', () => {
  it('round-trips all slots, both scenes, all engines, targeting, splits and performance settings', () => {
    let library = loadLibrary()
    const initial = initialSettings()
    const slots = ['programs', 'live'] as const
    for (const bank of slots) {
      for (let index = 0; index < library[bank].length; index++) {
        const sound = initialSettings()
        sound.layers.A.type = 'Electric'
        sound.layers.B.chain.delay.sync = true
        sound.synth.layers.C.voice.priority = 'High'
        sound.synth.layers.C.amp.release = index % 11
        sound.synth.layers.B.chain.reverb.type = 'Cathedral'
        sound.organ.layers.A.drawbars[4] = index % 9
        sound.organ.layers.B.model = 'Vox'
        sound.organ.chain.mod1.type = 'Pump'
        sound.effects.focus = 'Synth'
        sound.effects.rotary.stop = true
        sound.effects.global.compressor = { fast: true, amount: 3, on: true }
        sound.effects.clockBpm = 40 + index * 4
        sound.effects.synthLayer = 'C'
        sound.otherScene.pianoB = true
        sound.splits.Low = { note: 48, fade: 12 }
        sound.splits.High = { note: 72, fade: 6 }
        sound.organ.layers.B.zone = [1, 2]
        sound.transpose = { enabled: true, semitones: index % 7 - 3 }
        sound.morph.pedal['synth.layers.C.filter.frequency'] = index % 11
        library = saveSlot(library, { bank, index }, { name: `${bank} ${index}`, sound: capture(sound) })
      }
    }
    const saved = JSON.stringify(library)
    const storage: ProgramStorage = { getItem: (key) => key === libraryKey ? saved : null, setItem: () => {} }
    const refreshed = loadLibrary(storage)
    for (const bank of slots) for (const [index, slot] of refreshed[bank].entries()) {
      expect(slot).toEqual(JSON.parse(saved)[bank][index])
      const recalled = recall(slot.sound, { ...initial, master: 8, pitch: -5, performance: { wheel: 0.7, pedal: 0.43 } })
      expect(recalled.master).toBe(8)
      expect(recalled.pitch).toBe(-5)
      expect(recalled.performance).toEqual({ wheel: 0.7, pedal: 0.43 })
      expect(edited(recalled, slot)).toBe(false)
      expect(edited({ ...recalled, splits: { ...recalled.splits, Mid: { note: 60, fade: 6 } } }, slot)).toBe(true)
      expect(recalled.synth.layers.C.voice.priority).toBe('High')
      expect(recalled.effects.clockBpm).toBe(40 + index * 4)
    }
    expect(refreshed.programs).toHaveLength(32)
    expect(refreshed.live).toHaveLength(8)
    expect(loadLibrary().programs.filter((slot) => !slot.name.startsWith('Init'))).toHaveLength(9)
  })

  it('addresses every page and keeps changes independent across storage locations', () => {
    const library = loadLibrary()
    const renamed = { name: 'Saved Piano', sound: capture(initialSettings()) }
    expect(Array.from({ length: 32 }, (_, index) => address({ bank: 'programs', index }))).toEqual(
      [1, 2, 3, 4].flatMap((page) => Array.from({ length: 8 }, (_, index) => `${page}.${index + 1}`)),
    )
    for (const bank of ['programs', 'live'] as const satisfies readonly Bank[]) {
      const after = saveSlot(library, { bank, index: 3 }, renamed)
      expect(after[bank][3].name).toBe('Saved Piano')
      expect(after[bank][2]).toBe(library[bank][2])
      expect(after[bank === 'programs' ? 'live' : 'programs']).toBe(library[bank === 'programs' ? 'live' : 'programs'])
    }
    expect(loadLibrary({ getItem: () => '{', setItem: () => {} })).toEqual(library)
  })
})

describe('splits, scenes and morphs', () => {
  it('accepts the 11 positions and combines overlapping crossfades without a level bump', () => {
    const initial = initialSettings()
    for (const note of splitNotes) expect(editSplit(initial, 'Mid', { note }).splits.Mid.note).toBe(note)
    expect(editSplit(initial, 'Mid', { note: 62 })).toBe(initial)
    const split = toggleSplit(initial)
    expect(split.splits.Mid.note).toBe(60)
    expect(editSplit(split, 'Low', { note: 60 })).toBe(split)
    expect(zoneGain(splitPoints(split.splits), [0, 0], 59)).toBe(1)
    expect(zoneGain(splitPoints(split.splits), [0, 0], 60)).toBe(0)
    const fourZones = editSplit(editSplit(editSplit(split, 'Low', { note: 53, fade: 12 }), 'Mid', { fade: 6 }),
      'High', { note: 65, fade: 12 })
    const points = splitPoints(fourZones.splits)
    expect(points).toHaveLength(3)
    expect(zoneGain(splitPoints(editSplit(split, 'Mid', { fade: 6 }).splits), [1, 3], 57)).toBe(0.25)
    expect(zoneGain(splitPoints(editSplit(split, 'Mid', { fade: 12 }).splits), [1, 3], 57)).toBe(0.375)
    for (let note = 28; note <= 100; note++) {
      const levels = [0, 1, 2, 3].map((zone) => zoneGain(points, [zone, zone], note))
      expect(levels.reduce((sum, level) => sum + level, 0)).toBeCloseTo(1)
      expect(zoneGain(points, [1, 2], note)).toBeCloseTo(levels[1] + levels[2])
    }
    expect(zoneGain(splitPoints(toggleSplit(fourZones).splits), [1, 3], 48)).toBe(1)
  })

  it('switches only layer enables and uses the same sound edits in either scene', () => {
    let before = initialSettings()
    for (const key of layerKeys) before = editLayer(before, key, { on: false, level: 2, octave: -1 })
    const second = switchScene(before)
    expect(second.scene).toBe('II')
    expect(layerAt(second, 'synthA')).toMatchObject({ on: true, level: 2, octave: -1 })
    const change = editLayer(second, 'organB', { level: 9, on: true })
    const first = switchScene(change)
    expect(layerAt(first, 'organB')).toMatchObject({ on: false, level: 9 })
    expect(layerAt(switchScene(first), 'organB')).toMatchObject({ on: true, level: 9 })
  })

  it('interpolates increasing, decreasing, rotary and grouped effects destinations and clears them separately', () => {
    let state = initialSettings()
    const assign = (source: 'wheel' | 'pedal', id: string, value: number | boolean) => {
      state = assignMorph(state, source, id, panelUpdate(state, id, value, false)!)!
    }
    assign('wheel', 'piano-layer-a-level', 2)
    assign('wheel', 'organ-drawbar-2', 8)
    assign('wheel', 'rotary-speed', true)
    assign('pedal', 'synth-filter-frequency', 10)
    state = panelUpdate(state, 'effects-focus-synth', true, true)!
    assign('pedal', 'effects-delay-mix', 9)
    state = { ...state, performance: { wheel: 0.5, pedal: 0.25 } }
    const sound = effectiveSettings(state)
    expect(isMorphed(state, 'piano-layer-a-level')).toBe(true)
    expect(sound.layers.A.level).toBe(7)
    expect(sound.organ.layers.A.drawbars[1]).toBe(6.5)
    expect(sound.effects.rotary.speed).toBe(0.5)
    expect(sound.synth.layers.A.filter.frequency).toBe(7)
    expect(effectiveUnit(sound, 'Synth C', 'delay').mix).toBe(4.5)
    expect(effectiveUnit(sound, 'Organ', 'delay').mix).toBe(3)
    const clearOne = clearMorph(state, 'wheel', 'layers.A.level')
    expect(isMorphed(clearOne, 'piano-layer-a-level')).toBe(false)
    expect(effectiveSettings(clearMorph(clearOne, 'wheel')).organ.layers.A.drawbars[1]).toBe(5)
    expect(effectiveSettings(clearMorph(clearOne, 'wheel')).synth.layers.A.filter.frequency).toBe(7)
    expect(edited(state, { name: 'Saved', sound: capture({ ...state, performance: initialSettings().performance }) })).toBe(false)
  })
})

describe('panel bindings', () => {
  it('accounts for every panel control with a binding, action or named unsupported feature', () => {
    const unclassified = panelControls.filter(({ id }) => !boundControlIds.has(id) && !actionControlIds.has(id) && !unsupportedControls[id])
    expect(unclassified).toEqual([])
    expect(Object.keys(unsupportedControls).every((id) => panelControls.some((control) => control.id === id))).toBe(true)
  })

  it('routes focus and effects for all seven layers with local, grouped, and global targets', () => {
    let state = initialSettings()
    for (const key of layerKeys) {
      const id = `${key.slice(0, -1)}-layer-${key.slice(-1).toLowerCase()}`
      state = panelUpdate(state, `${id}-focus`, true, false)!
      expect(panelValue(state, `${id}-focus`)?.value).toBe(true)
      const focused = key[0].toUpperCase() + key.slice(1, -1)
      expect(panelLamp(state, `fx-focus:${focused}`)).toBe(true)
      state = panelUpdate(state, `${id}-level`, 4, false)!
      state = panelUpdate(state, `${key.slice(0, -1)}-octave-up`, true, false)!
      expect(layerAt(state, key)).toMatchObject({ level: 4, octave: 1 })
    }
    state = panelUpdate(state, 'effects-mod-1-amount', 10, false)!
    expect(effectiveUnit(state, 'Synth C', 'mod1').amount).toBe(10)
    expect(effectiveUnit(state, 'Synth A', 'mod1').amount).toBe(6)
    state = panelUpdate(state, 'effects-focus-synth', true, true)!
    expect(effectiveUnit(state, 'Synth A', 'mod1').amount).toBe(10)
    state = panelUpdate(state, 'effects-focus-organ', true, false)!
    state = panelUpdate(state, 'effects-delay-on', true, true)!
    state = tapDelay(state, 179)
    expect(state.effects.clockBpm).toBe(179)
    expect(effectiveUnit(state, 'Organ', 'delay').bpm).toBe(179)
    expect(effectiveUnit(state, 'A', 'delay').bpm).toBe(179)
    expect(effectiveUnit(state, 'Synth B', 'delay').bpm).toBe(179)
  })
})
