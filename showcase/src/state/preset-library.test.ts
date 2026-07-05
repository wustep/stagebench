import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp } from '../test/renderApp'
import { fakeStorageBoundary } from '../test/fakes'
import { ORGAN_PRESETS, PIANO_PRESETS, SYNTH_PRESETS } from '../model/presets'
import { InstrumentStore, SYNTH_WAVEFORMS } from './instrument'

/**
 * programs.preset-library — PRESET LIBRARY (manual p. 41-43), the ORGAN,
 * PIANO and SYNTH banks: entering browse captures the current sound and
 * loads NOTHING until the dial turns; the dial then loads each preset live
 * as an ordinary dirty edit; Shift/Exit or the library button leaves
 * keeping the sound; PROG 1/2/3 are the manual's Num · Cat · Cancel soft
 * buttons (Num/Cat sort the list, Cancel restores the pre-browse sound).
 * SINGLE LAYER (Shift + button) loads only the focused Piano/Synth layer;
 * Organ presets are always whole-Section (manual p. 41 note: both Organ
 * layers share one chain). Section preset loads turn their Section off in
 * the non-active Layer Scene; Single Layer loads leave the other scene
 * untouched (manual p. 43). User presets store to the library via STORE
 * from the Preset screen (or a Preset Library button during a Store).
 */

const presetIndex = (name: string): number => SYNTH_PRESETS.findIndex((p) => p.name === name)
const organIndex = (name: string): number => ORGAN_PRESETS.findIndex((p) => p.name === name)
const pianoIndex = (name: string): number => PIANO_PRESETS.findIndex((p) => p.name === name)
const waveIndex = (name: string): number => SYNTH_WAVEFORMS.findIndex((w) => w.name === name)
const LAST = SYNTH_PRESETS.length - 1

describe('programs.preset-library — browse flow', () => {
  it('entering is not an edit and loads nothing; the dial loads live; leaving keeps the sound', () => {
    const store = new InstrumentStore()
    store.enterPresetBrowse('synth', false)
    expect(store.getState().presetBrowse).toMatchObject({ section: 'synth', index: 0, singleLayer: false, loaded: false })
    expect(store.getState().programs.dirty).toBe(false) // manual p. 41: not loaded until the dial turns
    expect(store.getState().synth.layers.A.waveform).toBe(waveIndex('Saw'))
    store.dialPreset(0) // loads Stacked Saw Wall
    const s = store.getState()
    expect(s.synth.sectionOn).toBe(true)
    expect(s.synth.layers.A.waveform).toBe(waveIndex('Super Saw'))
    expect(s.programs.dirty).toBe(true) // an ordinary dirty edit
    expect(s.presetBrowse).toMatchObject({ index: 0, loaded: true })
    store.exitPresetBrowse(true)
    expect(store.getState().presetBrowse).toBeNull()
    expect(store.getState().synth.layers.A.waveform).toBe(waveIndex('Super Saw')) // sound kept
    expect(store.getState().programs.dirty).toBe(true)
  })

  it('the dial spans the list; a Section preset configures its declared extra layers and the arp', () => {
    const store = new InstrumentStore()
    store.enterPresetBrowse('synth', false)
    store.dialPreset(0) // Stacked Saw Wall declares layer B
    let s = store.getState()
    expect(s.synth.layers.B.enabled).toBe(true)
    expect(s.synth.layers.B.waveform).toBe(waveIndex('Saw Sub'))
    expect(s.synth.layers.B.level).toBe(88)
    expect(s.synth.layers.C.enabled).toBe(false)
    expect(s.synthChains.A.mod2.on).toBe(true) // the preset's own effect config
    store.dialPreset(127) // last preset: Pulse Gate (arp declared)
    s = store.getState()
    expect(s.presetBrowse?.index).toBe(LAST)
    expect(s.synth.layers.A.waveform).toBe(waveIndex('Square'))
    expect(s.synth.layers.B.enabled).toBe(false) // undeclared layers reset off
    expect(s.synth.arp).toMatchObject({ run: true, mode: 'Gate', mstClk: true, range: 3 })
  })

  it('PAGE ◂ ▸ steps and loads the neighboring preset (manual p. 41 list navigation)', () => {
    const store = new InstrumentStore()
    store.enterPresetBrowse('synth', false)
    store.stepPreset(1)
    expect(store.getState().presetBrowse).toMatchObject({ index: 1, loaded: true })
    store.stepPreset(-1)
    expect(store.getState().presetBrowse?.index).toBe(0)
    store.stepPreset(-1) // clamped at the first preset
    expect(store.getState().presetBrowse?.index).toBe(0)
  })

  it('Cancel restores the pre-browse snapshot AND the pre-browse dirty flag', () => {
    const store = new InstrumentStore()
    store.setSynthSectionOn(true) // a pre-browse edit: dirty
    store.selectSynthWaveform(waveIndex('Triangle'))
    store.enterPresetBrowse('synth', false)
    store.dialPreset(64)
    expect(store.getState().synth.layers.A.waveform).not.toBe(waveIndex('Triangle'))
    store.exitPresetBrowse(false) // the PROGRAM 1 Cancel soft button
    const s = store.getState()
    expect(s.presetBrowse).toBeNull()
    expect(s.synth.layers.A.waveform).toBe(waveIndex('Triangle'))
    expect(s.synth.sectionOn).toBe(true)
    expect(s.programs.dirty).toBe(true) // was dirty before browsing

    const clean = new InstrumentStore()
    clean.enterPresetBrowse('synth', false)
    clean.dialPreset(127)
    expect(clean.getState().programs.dirty).toBe(true)
    clean.exitPresetBrowse(false)
    expect(clean.getState().programs.dirty).toBe(false) // was clean before browsing
    expect(clean.getState().synth.layers.A.waveform).toBe(waveIndex('Saw'))
  })

  it('SINGLE LAYER loads the preset sound into the focused layer only, keeping everything else', () => {
    const store = new InstrumentStore()
    store.toggleSynthLayerEnabled('B') // enables and focuses layer B
    store.setSynthLayerLevel('B', 77)
    const aBefore = JSON.stringify(store.getState().synth.layers.A)
    store.enterPresetBrowse('synth', true)
    store.loadSynthPreset(presetIndex('Cascade Arp'))
    const s = store.getState()
    expect(s.synth.layers.B.waveform).toBe(waveIndex('Pulse 33')) // the preset's primary (A) sound
    expect(s.synth.layers.B.enabled).toBe(true) // performance fields kept…
    expect(s.synth.layers.B.level).toBe(77)
    expect(JSON.stringify(s.synth.layers.A)).toBe(aBefore) // …other layers intact
    expect(s.synth.layers.C.enabled).toBe(false)
    expect(s.synthChains.B.delay.on).toBe(true) // the focused layer's own chain follows the preset
    expect(s.synthChains.A.delay.on).toBe(false)
    expect(s.synth.arp.run).toBe(false) // section-level arp untouched in single-layer mode
    expect(s.synth.sectionOn).toBe(false) // section on/off untouched too
  })

  it('is mutually exclusive with the other Program-OLED edit modes', () => {
    const store = new InstrumentStore()
    store.enterPresetBrowse('synth', false)
    store.setLayerInitEdit(true)
    expect(store.getState().presetBrowse).toBeNull()
    store.enterPresetBrowse('synth', false)
    expect(store.getState().layerInitEdit).toBe(false)
    store.setClockEdit(true)
    expect(store.getState().presetBrowse).toBeNull()
    store.enterPresetBrowse('synth', false)
    expect(store.getState().clockEdit).toBe(false)
    store.setSplitEdit(true)
    expect(store.getState().presetBrowse).toBeNull()
  })

  it('a loaded preset round-trips through Store like any edit', () => {
    const store = new InstrumentStore()
    store.enterPresetBrowse('synth', false)
    store.dialPreset(127) // Pulse Gate
    store.exitPresetBrowse(true)
    store.storePress()
    store.storePress() // confirm into 1.1
    expect(store.getState().programs.dirty).toBe(false)
    store.selectProgram(5)
    store.selectProgram(0)
    const s = store.getState()
    expect(s.synth.layers.A.waveform).toBe(waveIndex('Square'))
    expect(s.synth.arp.mode).toBe('Gate')
    expect(s.synthChains.A.comp.on).toBe(true)
  })

  it('all three banks browse: organ and piano open their own preset lists', () => {
    const store = new InstrumentStore()
    store.enterPresetBrowse('organ', false)
    expect(store.getState().presetBrowse).toMatchObject({ section: 'organ', index: 0, loaded: false })
    store.exitPresetBrowse(true)
    store.enterPresetBrowse('piano', false)
    expect(store.getState().presetBrowse).toMatchObject({ section: 'piano', index: 0, loaded: false })
  })
})

describe('programs.preset-library — ORGAN bank', () => {
  it('an Organ preset writes both layers, the shared settings and the SHARED chain', () => {
    const store = new InstrumentStore()
    store.enterPresetBrowse('organ', false)
    store.loadOrganPreset(organIndex('Manuals & Bass')) // declares layer B (B3 Bass)
    const s = store.getState()
    expect(s.organ.sectionOn).toBe(true)
    expect(s.organ.layers.A.model).toBe('B3')
    expect(s.organ.layers.A.drawbars).toEqual([8, 8, 8, 0, 0, 0, 0, 0, 0])
    expect(s.organ.layers.B.enabled).toBe(true)
    expect(s.organ.layers.B.model).toBe('B3Bass')
    expect(s.organ.layers.B.drawbars).toEqual([8, 0, 8, 0, 0, 0, 0, 0, 0])
    expect(s.organ.layers.B.level).toBe(110)
    expect(s.organ.percussion.on).toBe(true)
    expect(s.organChain.comp.on).toBe(true) // ONE chain for both layers (manual p. 41 note)
    expect(s.programs.dirty).toBe(true)

    store.loadOrganPreset(organIndex('Jazz Trio')) // no declared B: resets off
    const t = store.getState()
    expect(t.organ.layers.B.enabled).toBe(false)
    expect(t.organ.toRotary).toBe(true)
    expect(t.organ.percussion).toMatchObject({ on: true, third: true })
    expect(t.organChain.comp.on).toBe(false) // chain resets between presets
  })

  it('Organ presets are ALWAYS whole-Section: single-layer browse is forced off (manual p. 41 note)', () => {
    const store = new InstrumentStore()
    store.enterPresetBrowse('organ', true) // a Shift press falls through to the plain whole-Section browse
    expect(store.getState().presetBrowse).toMatchObject({ section: 'organ', singleLayer: false })
  })
})

describe('programs.preset-library — PIANO bank', () => {
  it('a Section preset configures layer A (+ declared B), per-layer chains and the shared Piano params', () => {
    const store = new InstrumentStore()
    store.enterPresetBrowse('piano', false)
    store.loadPianoPreset(pianoIndex('Grand & Tine')) // declares layer B (Electric)
    const s = store.getState()
    expect(s.piano.sectionOn).toBe(true)
    expect(s.layers.A.type).toBe('Grand')
    expect(s.layers.B.enabled).toBe(true)
    expect(s.layers.B.type).toBe('Electric')
    expect(s.layers.B.level).toBe(86)
    expect(s.chains.A.reverb.on).toBe(true) // per-layer chains, unlike Organ
    expect(s.chains.B.mod1.on).toBe(true)
    expect(s.chains.B.reverb.on).toBe(false)

    store.loadPianoPreset(pianoIndex('Suitcase Tine')) // no declared B: resets off; timbre Dyno 1
    const t = store.getState()
    expect(t.layers.A.type).toBe('Electric')
    expect(t.layers.B.enabled).toBe(false)
    expect(t.piano.timbre).toBe(4)
    expect(t.chains.A.mod1).toMatchObject({ on: true, type: 'A-Pan' })
  })

  it('SINGLE LAYER loads into the focused piano layer only, keeping layer B and its chain', () => {
    const store = new InstrumentStore()
    store.toggleLayerEnabled('B') // enable + focus B, then customize it
    store.selectPianoModel(0)
    store.setLayerLevel('B', 71)
    store.setFocusedLayer('A')
    const bBefore = JSON.stringify(store.getState().layers.B)
    const bChainBefore = JSON.stringify(store.getState().chains.B)
    store.enterPresetBrowse('piano', true)
    store.loadPianoPreset(pianoIndex('Court Harpsichord'))
    const s = store.getState()
    expect(s.layers.A.type).toBe('Clav')
    expect(s.layers.A.model).toBe(1) // the bundled Harpsichord model
    expect(s.layers.A.level).toBe(100) // performance fields kept (default level)
    expect(s.chains.A.reverb.on).toBe(true) // the focused layer's own chain follows the preset
    expect(JSON.stringify(s.layers.B)).toBe(bBefore) // the other layer intact…
    expect(JSON.stringify(s.chains.B)).toBe(bChainBefore) // …and its chain too
    expect(s.piano.sectionOn).toBe(true) // section on/off untouched
  })
})

describe('programs.preset-library — Layer Scene rule (manual p. 43)', () => {
  it('a Section preset load turns that Section off in the non-active scene only', () => {
    const store = new InstrumentStore()
    const before = store.getState().scenes.stored
    expect(before).toMatchObject({ organA: true, pianoA: true, synthA: true })
    store.enterPresetBrowse('organ', false)
    store.loadOrganPreset(0)
    const afterOrgan = store.getState().scenes.stored
    expect(afterOrgan.organA).toBe(false)
    expect(afterOrgan.organB).toBe(false)
    expect(afterOrgan.pianoA).toBe(true) // other sections untouched
    expect(afterOrgan.synthA).toBe(true)
    store.exitPresetBrowse(true)
    store.enterPresetBrowse('synth', false)
    store.loadSynthPreset(0)
    const afterSynth = store.getState().scenes.stored
    expect(afterSynth.synthA).toBe(false)
    expect(afterSynth.synthB).toBe(false)
    expect(afterSynth.synthC).toBe(false)
    expect(afterSynth.pianoA).toBe(true)
  })

  it('a Single Layer load does NOT alter the non-active scene', () => {
    const store = new InstrumentStore()
    store.enterPresetBrowse('piano', true)
    store.loadPianoPreset(0)
    expect(store.getState().scenes.stored.pianoA).toBe(true)
    store.exitPresetBrowse(true)
    store.enterPresetBrowse('synth', true)
    store.loadSynthPreset(0)
    expect(store.getState().scenes.stored.synthA).toBe(true)
  })
})

describe('programs.preset-library — panel', () => {
  it('the SYNTH button opens browse (OLED rows, E coupling); PROG 3 cancels; a second press keeps', () => {
    renderApp()
    const button = screen.getByRole('button', { name: 'Preset Library Synth' })
    fireEvent.click(button)
    expect(screen.getByTestId('oled-preset-line').textContent).toMatch(/SYNTH PRESET/)
    // Focused, not-yet-loaded preset carries the manual's E coupling.
    expect(screen.getByTestId('oled-preset-list-0').textContent).toMatch(/▸ 1\/\d+ .* E$/)
    fireEvent.click(screen.getByRole('button', { name: 'Program 3' })) // Cancel soft button
    expect(screen.queryByTestId('oled-preset-line')).toBeNull()
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Preset cancelled/)
    fireEvent.click(button)
    expect(screen.getByTestId('oled-preset-line')).toBeTruthy()
    fireEvent.click(button) // the same library button leaves, keeping the sound
    expect(screen.queryByTestId('oled-preset-line')).toBeNull()
  })

  it('PROG 1/2 switch the Num/Cat sort; Cat shows the current category (manual p. 42, audit E6)', () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Preset Library Synth' }))
    fireEvent.click(screen.getByRole('button', { name: 'Program 2' })) // Cat
    expect(screen.getByTestId('oled-preset-line').textContent).toContain('CAT:')
    fireEvent.click(screen.getByRole('button', { name: 'Program 1' })) // Num
    expect(screen.getByTestId('oled-preset-line').textContent).not.toContain('CAT:')
    fireEvent.click(screen.getByRole('button', { name: 'Program 3' })) // Cancel leaves
    expect(screen.queryByTestId('oled-preset-line')).toBeNull()
  })

  it('panel: STORE from the Preset screen stores a user preset (Store Preset To, manual p. 43)', () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Preset Library Synth' }))
    fireEvent.click(screen.getByRole('button', { name: 'Store' }))
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Store Synth Preset .* to U1 \(new\)\? STORE confirms/)
    expect(screen.queryByTestId('oled-preset-line')).toBeNull() // browse closed for the store step
    fireEvent.click(screen.getByRole('button', { name: 'Store' })) // confirm
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Stored Synth Preset U1/)
  })

  it('Shift + SYNTH opens SINGLE LAYER browse; Shift/Exit leaves it', () => {
    renderApp()
    const shift = screen.getByRole('button', { name: 'Shift/Exit' })
    fireEvent.click(shift)
    fireEvent.click(screen.getByRole('button', { name: 'Preset Library Synth' }))
    expect(screen.getByTestId('oled-preset-line').textContent).toMatch(/SYNTH PRESET — LAYER A/)
    fireEvent.click(shift) // Shift/Exit leaves the Preset screen (manual p. 42)
    expect(screen.queryByTestId('oled-preset-line')).toBeNull()
  })

  it('the ORGAN and PIANO buttons open their banks and light their library LEDs while browsing', () => {
    renderApp()
    const leds = () =>
      Array.from(document.querySelectorAll('.preset-legend-row .led')).map((led) => led.getAttribute('data-on'))
    expect(leds()).toEqual(['false', 'false', 'false'])
    fireEvent.click(screen.getByRole('button', { name: 'Preset Library Organ' }))
    expect(screen.getByTestId('oled-preset-line').textContent).toMatch(/ORGAN PRESET/)
    expect(leds()).toEqual(['true', 'false', 'false'])
    // A different section's button switches banks directly.
    fireEvent.click(screen.getByRole('button', { name: 'Preset Library Piano' }))
    expect(screen.getByTestId('oled-preset-line').textContent).toMatch(/PIANO PRESET/)
    expect(leds()).toEqual(['false', 'true', 'false'])
    // The section's own button leaves, keeping the sound.
    fireEvent.click(screen.getByRole('button', { name: 'Preset Library Piano' }))
    expect(screen.queryByTestId('oled-preset-line')).toBeNull()
    expect(leds()).toEqual(['false', 'false', 'false'])
  })

  it('Shift + PIANO opens SINGLE LAYER browse; Shift + ORGAN stays whole-Section (manual p. 41-42)', () => {
    renderApp()
    const shift = screen.getByRole('button', { name: 'Shift/Exit' })
    fireEvent.click(shift)
    fireEvent.click(screen.getByRole('button', { name: 'Preset Library Piano' }))
    expect(screen.getByTestId('oled-preset-line').textContent).toMatch(/PIANO PRESET — LAYER A/)
    fireEvent.click(shift) // Shift/Exit leaves the Preset screen
    expect(screen.queryByTestId('oled-preset-line')).toBeNull()
    // Organ presets have no single-layer variant: Shift falls through to the
    // plain whole-Section browse (manual p. 41 note).
    fireEvent.click(shift)
    fireEvent.click(screen.getByRole('button', { name: 'Preset Library Organ' }))
    const line = screen.getByTestId('oled-preset-line').textContent
    expect(line).toMatch(/ORGAN PRESET/)
    expect(line).not.toMatch(/LAYER/)
  })
})

describe('programs.preset-library — Num/Cat sorting (manual p. 42, audit E6)', () => {
  it('Cat sort groups by category and PAGE jumps to the neighboring category', () => {
    const store = new InstrumentStore()
    store.enterPresetBrowse('synth', false)
    store.setPresetSort('cat')
    const cats = [...new Set(SYNTH_PRESETS.map((p) => p.category))].sort((a, b) => a.localeCompare(b))
    store.dialPreset(0) // the first preset of the alphabetically first category
    const first = store.getState().presetBrowse!.index
    expect(SYNTH_PRESETS[first]!.category).toBe(cats[0])
    expect(first).toBe(SYNTH_PRESETS.findIndex((p) => p.category === cats[0]))
    // PAGE ▸ jumps to the FIRST preset of the NEXT category, not the neighbor.
    store.stepPreset(1)
    const second = store.getState().presetBrowse!.index
    expect(SYNTH_PRESETS[second]!.category).toBe(cats[1])
    expect(second).toBe(SYNTH_PRESETS.findIndex((p) => p.category === cats[1]))
    // Back in Num sort the PAGE buttons step the bank order again.
    store.setPresetSort('num')
    store.stepPreset(1)
    expect(store.getState().presetBrowse!.index).toBe(second + 1)
  })
})

describe('programs.preset-library — user presets (manual p. 42-43, audit E6)', () => {
  it('STORE from the Preset screen captures the section; the preset browses after the factory bank', () => {
    const store = new InstrumentStore()
    store.setSynthSectionOn(true)
    store.selectSynthWaveform(waveIndex('Triangle'))
    store.enterPresetBrowse('synth', false)
    store.storePress() // "Store Preset To" — destination U1 (new)
    expect(store.getState().presetStore).toMatchObject({ section: 'synth', destination: 0 })
    expect(store.getState().presetBrowse).toBeNull()
    store.storePress() // confirm
    expect(store.getState().presetStore).toBeNull()
    expect(store.getState().presetUser.synth).toHaveLength(1)
    expect(store.getState().presetUser.synth[0]!.category).toBe('User')
    expect(store.getState().lastEdit).toMatch(/Stored Synth Preset U1/)
    // The stored preset loads back — it browses after the factory bank.
    store.layerInitAll()
    store.enterPresetBrowse('synth', false)
    store.dialPreset(127) // the last list entry = the user preset
    expect(store.getState().presetBrowse!.index).toBe(SYNTH_PRESETS.length)
    expect(store.getState().synth.layers.A.waveform).toBe(waveIndex('Triangle'))
    expect(store.getState().synth.sectionOn).toBe(true)
    expect(store.getState().programs.dirty).toBe(true) // an ordinary edit, like factory loads
  })

  it('a STORE AS naming step names the preset; the library persists through storage', () => {
    const storage = fakeStorageBoundary()
    const store = new InstrumentStore(storage)
    store.storeAsPress() // naming opens with the program name
    store.beginPresetStore('piano') // the Preset Library button during naming (manual p. 43)
    expect(store.getState().programs.naming).toBeNull()
    store.storePress() // confirm into U1
    expect(store.getState().presetUser.piano[0]!.name).toBe('Royal Grand')
    const second = new InstrumentStore(storage)
    expect(second.getState().presetUser.piano).toHaveLength(1)
    expect(second.getState().presetUser.piano[0]!.name).toBe('Royal Grand')
  })

  it('a Preset Library press during a program Store re-targets it to Store Preset To', () => {
    const store = new InstrumentStore()
    store.setLayerLevel('A', 71) // the edit the capture must hold
    store.storePress() // program store: destination step
    store.selectProgram(9) // audition another slot (level 100)
    store.beginPresetStore('piano') // the ORGAN/PIANO/SYNTH press re-targets
    expect(store.getState().programs.storePending).toBeNull()
    expect(store.getState().layers.A.level).toBe(71) // the origin sound is restored
    store.storePress()
    expect(store.getState().presetUser.piano[0]!.payload.layers!.A.level).toBe(71) // origin captured, not the audition
  })

  it('EXIT cancels the store step; overwrite picks a slot; Memory Protect refuses', () => {
    const store = new InstrumentStore()
    store.enterPresetBrowse('organ', false)
    store.storePress()
    expect(store.cancelStoreFlow()).toBe(true) // Shift/Exit
    expect(store.getState().presetStore).toBeNull()
    expect(store.getState().presetUser.organ).toHaveLength(0)
    store.enterPresetBrowse('organ', false)
    store.storePress()
    store.storePress() // U1 written
    expect(store.getState().presetUser.organ).toHaveLength(1)
    store.enterPresetBrowse('organ', false)
    store.storePress() // destination defaults to U2 (new)
    store.dialPresetStore(0) // pick U1 instead: overwrite
    expect(store.getState().lastEdit).toContain('U1')
    store.storePress()
    expect(store.getState().presetUser.organ).toHaveLength(1) // overwrote, did not grow
    store.setMemoryProtect(true)
    store.enterPresetBrowse('organ', false)
    store.storePress()
    expect(store.getState().presetStore).toBeNull()
    expect(store.getState().lastEdit).toContain('Memory Protect')
  })

  it('a user preset loads Single Layer style too: its A layer into the focused layer', () => {
    const store = new InstrumentStore()
    store.setSynthSectionOn(true)
    store.selectSynthWaveform(waveIndex('Triangle'))
    store.enterPresetBrowse('synth', false)
    store.storePress()
    store.storePress() // U1 captured with layer A = Triangle
    store.layerInitAll()
    store.toggleSynthLayerEnabled('B') // enable + focus B
    store.setSynthLayerLevel('B', 77)
    store.enterPresetBrowse('synth', true) // SINGLE LAYER browse
    store.dialPreset(127) // the user preset at the end of the list
    const s = store.getState()
    expect(s.synth.layers.B.waveform).toBe(waveIndex('Triangle'))
    expect(s.synth.layers.B.level).toBe(77) // performance fields kept
    expect(s.synth.layers.A.waveform).toBe(waveIndex('Saw')) // other layers intact
  })
})
