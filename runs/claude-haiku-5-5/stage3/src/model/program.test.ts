// programs.roundtrip, programs.store-live, programs.undo-cancel, programs.navigation: the bank of 32
// stored programs and 8 Live slots, the dirty indicator, Store and Store As, and the page and dial.
import { describe, expect, it } from 'vitest'
import { applyMorphs } from './morph'
import { createInstrumentState, instrumentReducer, programName, programEdited, type InstrumentAction, type InstrumentState } from './instrument'
import { applyProgram, browserProgramStorage, captureProgram, FACTORY_PROGRAMS, isDirty, loadStoredSlots, PROGRAM_SLOTS, programValues, saveSlots, slotLabel, type ProgramStorage } from './program'
import { derivedLeds, programDisplayLines } from './displays'
import { deriveAudioSettings } from './audioSettings'

function memoryStorage(): ProgramStorage & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    read: (key) => map.get(key) ?? null,
    write: (key, value) => map.set(key, value),
  }
}

const run = (state: InstrumentState, ...actions: InstrumentAction[]) => actions.reduce(instrumentReducer, state)
const press = (id: string, shiftKey = false): InstrumentAction => ({ type: 'toggle', id, shiftKey })

/** A state with edits in every program section: organ, piano, synth, effects, splits, scenes, morphs, clock, and transpose. */
function editedState(): InstrumentState {
  return run(
    createInstrumentState(),
    { type: 'set', id: 'organ.drawbar-16', value: 0.2 },
    { type: 'set', id: 'synth.osc-ctrl', value: 0.9 },
    { type: 'advance', id: 'synth.filter-type' },
    { type: 'toggle', id: 'effects.reverb-on' },
    { type: 'set', id: 'effects.reverb-level', value: 0.8 },
    press('program.split'),
    { type: 'set', id: 'program.split-low', value: 2 },
    { type: 'set', id: 'program.xfade-mid', value: 2 },
    press('program.layer-scene'),
    press('synth.layer-b-on'),
    press('program.layer-scene'),
    { type: 'set', id: 'program.transpose', value: 0.75 },
    { type: 'set', id: 'program.clock-bpm', value: 0.6 },
    { type: 'morph-source', source: 'wheel' },
    { type: 'set', id: 'effects.delay-time', value: 0.9 },
    { type: 'morph-source', source: 'wheel' },
    { type: 'set', id: 'performance.mod-wheel', value: 0.5 },
  )
}

describe('programs.roundtrip: save and load restores all supported state', () => {
  it('a stored program restores every program key and every morph assignment', () => {
    const edited = editedState()
    const stored = run(edited, press('program.store'), press('program.store'))
    expect(stored.bank.slots[stored.bank.selected]).toBeDefined()
    const reloaded = run(stored, { type: 'set', id: 'organ.drawbar-16', value: 1 }, press('program.button-2'), press('program.button-1'))
    // Selecting the stored program brings back the same values and morphs.
    const back = run(reloaded, { type: 'set', id: 'program.dial', value: stored.bank.selected / (PROGRAM_SLOTS - 1) })
    expect(programValues(back.values)).toEqual(programValues(edited.values))
    expect(back.morphs).toEqual(edited.morphs)
  })

  it('every one of the 32 slots and the 8 Live slots survives a save and a reload through storage', () => {
    const storage = memoryStorage()
    let state = createInstrumentState()
    for (let index = 0; index < PROGRAM_SLOTS; index += 1) {
      state = run(state, { type: 'set', id: 'program.dial', value: index / (PROGRAM_SLOTS - 1) }, { type: 'set', id: 'organ.drawbar-8', value: (index % 9) / 8 })
      state = run(state, press('program.store'), press('program.store'))
    }
    state = run(state, press('program.live-mode'))
    for (let slot = 0; slot < 8; slot += 1) {
      state = run(state, press(`program.button-${slot + 1}`), { type: 'set', id: 'organ.drawbar-4', value: slot / 8 })
    }
    saveSlots(storage, state.bank)
    const restored = createInstrumentState(loadStoredSlots(storage) ?? undefined)
    for (let index = 0; index < PROGRAM_SLOTS; index += 1) {
      expect(restored.bank.slots[index]?.values, `slot ${index}`).toEqual(state.bank.slots[index]?.values)
    }
    for (let slot = 0; slot < 8; slot += 1) {
      expect(restored.bank.live[slot]?.values['organ.drawbar-4@A'], `live ${slot}`).toBe(slot / 8)
    }
  })

  it('ships at least eight factory programs, and the first one is loaded at start', () => {
    expect(FACTORY_PROGRAMS.length).toBeGreaterThanOrEqual(8)
    const state = createInstrumentState()
    expect(programName(state)).toBe('Grand Piano')
    expect(slotLabel(17)).toBe('3.2')
  })

  it('applying a program leaves master level and the performance inputs alone', () => {
    const state = run(createInstrumentState(), { type: 'set', id: 'performance.master-level', value: 0.2 })
    const applied = applyProgram(state.values, state.bank.slots[4]!)
    expect(applied['performance.master-level']).toBe(0.2)
    expect(programValues(applied)).not.toHaveProperty('performance.master-level')
  })
})

describe('programs.store-live: Store, Store As, the dirty indicator, and the 8 Live slots', () => {
  it('the dirty indicator is truthful: an edit shows E, and storing clears it', () => {
    const state = createInstrumentState()
    expect(programEdited(state)).toBe(false)
    const edited = run(state, { type: 'set', id: 'organ.drawbar-16', value: 0.1 })
    expect(programEdited(edited)).toBe(true)
    expect(programDisplayLines(edited)[0]).toContain(' E')
    const stored = run(edited, press('program.store'), press('program.store'))
    expect(programEdited(stored)).toBe(false)
  })

  it('Store is two presses: the first arms it, the next program picks the destination, and the second press confirms', () => {
    let state = run(createInstrumentState(), { type: 'set', id: 'organ.drawbar-16', value: 0.3 })
    state = run(state, press('program.store'))
    expect(state.bank.storeArmed).toBe(true)
    state = run(state, press('program.button-5'))
    expect(state.bank.selected).toBe(4)
    expect(state.bank.storeArmed).toBe(true)
    state = run(state, press('program.store'))
    expect(state.bank.storeArmed).toBe(false)
    expect(state.bank.slots[4]?.values['organ.drawbar-16@A']).toBe(0.3)
  })

  it('Store As names the program, and the name shows on the Program display', () => {
    let state = run(createInstrumentState(), { type: 'set', id: 'organ.drawbar-16', value: 0.4 })
    state = run(state, press('program.store', true))
    expect(state.storeAs).not.toBeNull()
    state = run(state, { type: 'store-as-name', name: 'My Pad' }, { type: 'store-as-confirm' })
    expect(state.storeAs).toBeNull()
    expect(state.bank.slots[0]?.name).toBe('My Pad')
    expect(programDisplayLines(state)[0]).toContain('My Pad')
  })

  it('Live Mode switches the program buttons to Live slots, and every edit is stored in the loaded Live slot', () => {
    let state = run(createInstrumentState(), press('program.live-mode'))
    expect(state.bank.liveMode).toBe(true)
    state = run(state, press('program.button-3'), { type: 'set', id: 'organ.drawbar-8', value: 0.25 })
    expect(state.bank.live[2]?.values['organ.drawbar-8@A']).toBe(0.25)
    // Live slots are never dirty: the E indicator belongs to regular programs.
    expect(programEdited(state)).toBe(false)
  })

  it('Live slots survive a reload from storage', () => {
    const storage = memoryStorage()
    let state = run(createInstrumentState(), press('program.live-mode'), press('program.button-1'), { type: 'set', id: 'synth.osc-ctrl', value: 0.66 })
    saveSlots(storage, state.bank)
    state = createInstrumentState(loadStoredSlots(storage) ?? undefined)
    expect(state.bank.live[0]?.values['synth.osc-ctrl@A']).toBeCloseTo(0.66, 10)
  })

  it('the Live Mode buttons show which Live slot is loaded', () => {
    const state = run(createInstrumentState(), press('program.live-mode'), press('program.button-4'))
    expect(derivedLeds(state)['program.button-4']).toBe(1)
    expect(derivedLeds(state)['program.button-1']).toBe(0)
  })
})

describe('programs.undo-cancel: edit discard on program change, and cancelling Store', () => {
  it('selecting another program without storing discards the edits (manual p. 13)', () => {
    const edited = run(createInstrumentState(), { type: 'set', id: 'organ.drawbar-16', value: 0.05 })
    expect(programEdited(edited)).toBe(true)
    const moved = run(edited, press('program.button-2'))
    expect(programEdited(moved)).toBe(false)
    expect(moved.values['organ.drawbar-16@A']).toBe(FACTORY_PROGRAMS[1].values['organ.drawbar-16@A'])
  })

  it('Store As and Store can both be cancelled, and leave the stored program as it was', () => {
    const state = run(createInstrumentState(), { type: 'set', id: 'organ.drawbar-16', value: 0.7 })
    const before = state.bank.slots[0]
    const cancelledStoreAs = run(state, press('program.store', true), { type: 'store-as-cancel' })
    expect(cancelledStoreAs.storeAs).toBeNull()
    expect(cancelledStoreAs.bank.slots[0]).toBe(before)
    const cancelledStore = run(state, press('program.store'), { type: 'store-cancel' })
    expect(cancelledStore.bank.storeArmed).toBe(false)
    expect(cancelledStore.bank.slots[0]).toBe(before)
  })

  it('a program that was loaded clean is not dirty until something changes', () => {
    const state = createInstrumentState()
    expect(isDirty(state.values, state.morphs, state.bank)).toBe(false)
    expect(isDirty(applyProgram(state.values, captureProgram(state.values, state.morphs, 'x')), state.morphs, state.bank)).toBe(false)
  })
})

describe('programs.navigation: program buttons, pages, the dial, and the list view', () => {
  it('pages of eight: page up moves the displayed page, and a button picks a program on that page', () => {
    let state = run(createInstrumentState(), press('program.page-up'))
    expect(state.bank.page).toBe(1)
    state = run(state, press('program.button-2'))
    expect(state.bank.selected).toBe(9)
    expect(slotLabel(state.bank.selected)).toBe('2.2')
  })

  it('the dial selects one of the 32 programs, and the page follows the selection', () => {
    const state = run(createInstrumentState(), { type: 'set', id: 'program.dial', value: 1 })
    expect(state.bank.selected).toBe(31)
    expect(state.bank.page).toBe(3)
  })

  it('the page buttons stop at the first and last page', () => {
    let state = run(createInstrumentState(), press('program.page-down'))
    expect(state.bank.page).toBe(0)
    for (let i = 0; i < 6; i += 1) state = run(state, press('program.page-up'))
    expect(state.bank.page).toBe(3)
  })

  it('the numeric list view is a listing of all 32 programs, and the dial reads the loaded one', () => {
    const state = run(createInstrumentState(), { type: 'set', id: 'program.dial', value: 16 / 31 })
    expect(state.bank.selected).toBe(16)
    expect(derivedLeds(state)['program.dial']).toBeCloseTo(16 / 31, 10)
  })

  it('the Program display reports the loaded program with its page and number', () => {
    const state = run(createInstrumentState(), { type: 'set', id: 'program.dial', value: 9 / 31 })
    expect(programDisplayLines(state)[0].startsWith('2.2 ')).toBe(true)
  })
})

describe('programs: storage and the audio path', () => {
  it('works without storage: a browser with no localStorage gives an empty bank and nothing throws', () => {
    const storage = browserProgramStorage()
    expect(storage.read('anything')).toBeNull()
    expect(() => storage.write('anything', 'value')).not.toThrow()
    expect(loadStoredSlots(storage)).toBeUndefined()
  })

  it('malformed stored data is ignored rather than loaded', () => {
    const storage = memoryStorage()
    storage.write('stagebench.stage4.programs.v1', '{"slots":"nope"')
    expect(loadStoredSlots(storage)).toBeUndefined()
  })

  it('a loaded program is what the audio path hears', () => {
    const state = run(createInstrumentState(), press('program.button-4'))
    const settings = deriveAudioSettings(applyMorphs(state.values, state.morphs))
    expect(settings.organ.A.on).toBe(true)
    expect(settings.graph.layers.O.on).toBe(true)
  })
})
