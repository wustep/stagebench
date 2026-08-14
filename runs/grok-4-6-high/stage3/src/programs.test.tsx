import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import { applyHardwareControl } from './model/apply-control'
import {
  defaultInstrumentState,
  extractPatch,
  patchesEqual,
  programLabel,
} from './model/instrument-state'
import { beginStore, markDirty, selectProgram, undoProgram } from './model/programs'

describe('programs.roundtrip', () => {
  it('stores and reloads all supported patch fields across 32 slots with a truthful dirty flag', () => {
    const state = defaultInstrumentState()
    expect(state.slots).toHaveLength(32)
    expect(state.liveSlots).toHaveLength(8)
    state.layers.A.type = 'electric'
    state.organOn = true
    state.organ.A.model = 'Vox'
    state.organ.A.drawbars = [1, 2, 3, 4, 5, 6, 7, 8, 0]
    state.synthOn = true
    state.synth.A.enable = true
    state.synth.A.wave = 'Super Saw'
    state.synth.A.filterType = 'HP'
    state.split.on = true
    state.split.mid.enabled = true
    state.split.mid.midi = 65
    state.split.mid.xfade = 12
    state.morphs.push({ source: 'wheel', dest: 'piano-layer-a-level', start: 0.2, end: 0.9 })
    state.clockBpm = 96
    state.transpose = 3
    const snapshot = extractPatch(state)
    state.storeName = 'Roundtrip'
    state.storeDest = 20
    state.storeMode = 'dest'
    beginStore(state, false)
    expect(state.slots[20]?.name).toBe('Roundtrip')
    expect(patchesEqual(state.slots[20]!.patch, snapshot)).toBe(true)
    selectProgram(state, 0)
    expect(state.layers.A.type).toBe('grand')
    selectProgram(state, 20)
    expect(patchesEqual(extractPatch(state), snapshot)).toBe(true)
    expect(state.dirty).toBe(false)
    state.layers.A.level = 0.11
    expect(patchesEqual(extractPatch(state), state.loadedPatch)).toBe(false)
  })
})

describe('programs.store-live', () => {
  it('Store As names a slot and Live slots auto-store edits', () => {
    const state = defaultInstrumentState()
    state.storeMode = 'off'
    beginStore(state, true)
    expect(state.storeMode).toBe('name')
    state.storeName = 'Named Pad'
    beginStore(state, false)
    expect(state.storeMode).toBe('dest')
    state.storeDest = 4
    beginStore(state, false)
    expect(state.slots[4]?.name).toBe('Named Pad')

    const live = defaultInstrumentState()
    live.liveMode = true
    live.synthOn = true
    live.synth.A.enable = true
    markDirty(live)
    expect(live.dirty).toBe(false)
    expect(live.liveSlots[0]?.patch.synthOn).toBe(true)
  })
})

describe('programs.undo-cancel', () => {
  it('discards edits on program change and undo restores them', () => {
    const state = defaultInstrumentState()
    state.layers.A.type = 'clav'
    state.dirty = true
    const edited = extractPatch(state)
    selectProgram(state, 2)
    expect(state.layers.A.type).toBe('electric')
    expect(undoProgram(state)).toBe(true)
    expect(patchesEqual(extractPatch(state), edited)).toBe(true)
  })
})

describe('programs.navigation', () => {
  it('pages, program buttons, dial, and list view move the slot', () => {
    let state = defaultInstrumentState()
    state = applyHardwareControl(state, 'program-2', 1)
    expect(state.programIndex).toBe(1)
    expect(programLabel(state.programIndex)).toBe('1.2')
    state = applyHardwareControl(state, 'program-page-up', 1)
    expect(state.page).toBe(1)
    expect(state.programIndex).toBe(9)
    state = applyHardwareControl(state, 'program-dial', 0.02, { 'program-dial': 0, 'program-shift': 1 })
    expect(state.listView).toBe(true)
    render(<App deps={{ autoMidi: false }} />)
    fireEvent.click(screen.getByLabelText('Program 3'))
    expect(screen.getByLabelText('Program display').textContent).toMatch(/1\.3|Upright|Tine|LIVE|Concert/i)
  })
})
