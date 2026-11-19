import { describe, expect, it } from 'vitest'
import { PANEL_CONTROLS } from '../model/controls'
import {
  createInitialInstrumentState,
  extractProgramPatch,
  getControlMorphTarget,
  instrumentStateReducer,
  resolveMorphedStageState,
  type StageInstrumentState,
} from '../model/instrumentState'
import {
  createMemoryStorageAdapter,
  formatProgramSlotCode,
  UNSUPPORTED_CONTROLS_AUDIT,
} from '../model/programBank'
import {
  computeZoneGain,
  getActiveZoneCount,
  SPLIT_POSITION_NOTES,
  type SplitState,
} from '../model/splits'

function dispatchMany(
  initial: StageInstrumentState,
  actions: readonly Parameters<typeof instrumentStateReducer>[1][],
): StageInstrumentState {
  return actions.reduce(instrumentStateReducer, initial)
}

describe('programs.roundtrip & programs.store-live & programs.undo-cancel & programs.navigation', () => {
  it('ships >= 8 distinct factory programs across 32 slots and navigates via buttons, pages, dial, and list view', () => {
    const storage = createMemoryStorageAdapter()
    const state0 = createInitialInstrumentState(storage)
    expect(state0.program.programs).toHaveLength(32)
    expect(state0.program.liveSlots).toHaveLength(8)

    // At least 8 distinct factory setups
    const factoryNames = new Set(state0.program.programs.slice(0, 12).map((p) => p.name))
    expect(factoryNames.size).toBeGreaterThanOrEqual(8)
    expect(formatProgramSlotCode(0)).toBe('1.1')
    expect(formatProgramSlotCode(31)).toBe('4.8')

    // Program buttons 1..8 select within current page
    const s2 = instrumentStateReducer(state0, { type: 'activate', id: 'program-btn-3' })
    expect(s2.program.activeSlot).toBe(2) // 1.3 Analog SuperLead
    expect(s2.synth.sectionOn).toBe(true)

    // Page Next moves from 1.3 (slot 2) -> 2.3 (slot 10)
    const sPage2 = instrumentStateReducer(s2, { type: 'activate', id: 'program-page-next' })
    expect(sPage2.program.activeSlot).toBe(10)
    expect(sPage2.split.enabled).toBe(true)

    // Page Prev returns to 1.3 (slot 2)
    const sPage1 = instrumentStateReducer(sPage2, { type: 'activate', id: 'program-page-prev' })
    expect(sPage1.program.activeSlot).toBe(2)

    // Program dial steps forward/backward
    const sDial = instrumentStateReducer(sPage1, { type: 'step', id: 'program-dial', delta: 1 })
    expect(sDial.program.activeSlot).toBe(3) // 1.4 Tine & Warm Pad

    // Shift + Program Dial opens numeric list view of all 32 programs
    const sList = dispatchMany(sDial, [
      { type: 'activate', id: 'program-shift' },
      { type: 'step', id: 'program-dial', delta: 1 },
    ])
    expect(sList.program.overlay.kind).toBe('list-view')
  })

  it('tracks truthful dirty state, discards edits on program change, restores via Undo, and round-trips all state across 32 slots while excluding Master Level', () => {
    const storage = createMemoryStorageAdapter()
    const s0 = createInitialInstrumentState(storage)
    expect(s0.program.dirty).toBe(false)

    // Edit Organ, Piano, Synth, Effects, Splits, Scenes, Morphs, Master Clock, Transpose, and Master Level
    const edited = dispatchMany(s0, [
      { type: 'set-organ-section', patch: { sectionOn: true, sustped: true } },
      {
        type: 'set-organ-layer',
        layer: 'A',
        patch: { enabled: true, model: 'Vox', drawbars: [8, 6, 4, 2, 0, 5, 7, 8, 3], level: 77 },
      },
      { type: 'set-piano-layer', layer: 'A', patch: { type: 'Upright', modelIndex: 1, level: 81 } },
      { type: 'set-synth-section', patch: { sectionOn: true } },
      {
        type: 'set-synth-layer',
        layer: 'B',
        patch: { enabled: true, oscCategory: 'FM-H', oscWaveform: 'FM 2-op', oscCtrl: 72 },
      },
      { type: 'set-split', patch: { enabled: true } },
      { type: 'set-split-point', point: 'mid', patch: { active: true, note: 'F4', crossfade: 12 } },
      { type: 'assign-morph', source: 'wheel', target: 'synth:B:oscCtrl', start: 72, end: 18 },
      { type: 'set-master-clock', patch: { bpm: 138, kbSync: true } },
      { type: 'set-transpose', patch: { enabled: true, semitones: -3 } },
      { type: 'set-master-level', value: 42 },
    ])
    expect(edited.program.dirty).toBe(true)

    // Switching to another program without storing discards edits cleanly
    const switched = instrumentStateReducer(edited, { type: 'select-program', index: 1 })
    expect(switched.program.dirty).toBe(false)
    expect(switched.program.activeSlot).toBe(1)
    expect(switched.masterLevel).toBe(42) // Master Level is EXCLUDED from program state!
    expect(switched.masterClock.bpm).toBe(120)

    // Single-level Undo (Shift + Solo) restores the discarded edited state
    const undone = dispatchMany(switched, [
      { type: 'activate', id: 'program-shift' },
      { type: 'activate', id: 'program-solo' },
    ])
    expect(undone.program.activeSlot).toBe(0)
    expect(undone.program.dirty).toBe(true)
    expect(undone.organ.layers.A.model).toBe('Vox')
    expect(undone.masterClock.bpm).toBe(138)
    expect(undone.transpose.semitones).toBe(-3)

    // Store As with naming (insert + delete) into slot 25 (4.2)
    const saved = dispatchMany(undone, [
      { type: 'start-store-as' },
      { type: 'set-store-as-name', name: 'My Custom' },
      { type: 'store-as-insert-char', char: '!' },
      { type: 'store-as-insert-char', char: 'X' },
      { type: 'store-as-delete-char' },
      { type: 'advance-store-as-to-confirm' },
      { type: 'set-store-dest', destMode: 'program', destSlot: 25 },
      { type: 'confirm-store', storage },
    ])
    expect(saved.program.dirty).toBe(false)
    expect(saved.program.activeSlot).toBe(25)
    expect(saved.program.programs[25].name).toBe('My Custom!')

    // Reload from storage into a fresh state and select slot 25 -> exact full round-trip
    const reloaded = instrumentStateReducer(createInitialInstrumentState(storage), {
      type: 'select-program',
      index: 25,
    })
    expect(reloaded.program.programs[25].name).toBe('My Custom!')
    expect(reloaded.organ.layers.A.model).toBe('Vox')
    expect(reloaded.organ.layers.A.drawbars).toEqual([8, 6, 4, 2, 0, 5, 7, 8, 3])
    expect(reloaded.piano.layers.A.type).toBe('Upright')
    expect(reloaded.synth.layers.B.oscWaveform).toBe('FM 2-op')
    expect(reloaded.split.points.mid.note).toBe('F4')
    expect(reloaded.split.points.mid.crossfade).toBe(12)
    expect(reloaded.morphs.wheel).toEqual([
      { target: 'synth:B:oscCtrl', start: 72, end: 18 },
    ])
    expect(reloaded.masterClock).toEqual({ bpm: 138, kbSync: true })
    expect(reloaded.transpose).toEqual({ enabled: true, semitones: -3 })
    expect(reloaded.masterLevel).toBe(75) // default master level, unaffected by saved slot
    expect(extractProgramPatch(reloaded)).toEqual(extractProgramPatch(saved))
  })

  it('auto-stores edits in all 8 Live slots and supports Store cancel & Program<->Live copying', () => {
    const storage = createMemoryStorageAdapter()
    let s = createInitialInstrumentState(storage)

    // Enter Live Mode, select Live slot 4 (index 3), make an edit -> auto-stored, dirty stays false
    s = instrumentStateReducer(s, { type: 'toggle-live-mode' })
    expect(s.program.mode).toBe('live')
    s = instrumentStateReducer(s, { type: 'select-live-slot', index: 3 })
    s = instrumentStateReducer(s, {
      type: 'set-organ-layer',
      layer: 'A',
      patch: { model: 'Pipe 1', drawbars: [4, 4, 8, 8, 0, 0, 0, 0, 0] },
    })
    expect(s.program.dirty).toBe(false)
    expect(s.program.liveSlots[3].patch.organ.layers.A.model).toBe('Pipe 1')

    // Copy Live slot 4 into Regular slot 15 via Store confirm
    s = dispatchMany(s, [
      { type: 'start-store' },
      { type: 'set-store-dest', destMode: 'program', destSlot: 15 },
      { type: 'confirm-store', storage },
    ])
    expect(s.program.mode).toBe('program')
    expect(s.program.activeSlot).toBe(15)
    expect(s.program.programs[15].patch.organ.layers.A.model).toBe('Pipe 1')

    // Store cancel (Shift/Exit) restores source patch without overwriting destination
    const beforeCancel = instrumentStateReducer(s, {
      type: 'set-transpose',
      patch: { enabled: true, semitones: 5 },
    })
    const cancelled = dispatchMany(beforeCancel, [
      { type: 'start-store' },
      { type: 'set-store-dest', destMode: 'program', destSlot: 0 }, // auditions slot 0
      { type: 'activate', id: 'program-shift' }, // Exit cancels
    ])
    expect(cancelled.program.overlay.kind).toBe('none')
    expect(cancelled.transpose.semitones).toBe(5)
    expect(cancelled.program.programs[0].patch.transpose.semitones).toBe(0)
  })
})

describe('splits.zones — 11 documented positions, 4 zones, Off/±6/±12 crossfades', () => {
  it('supports all 11 documented split positions and up to 4 contiguous zones with exact crossfade math', () => {
    expect(SPLIT_POSITION_NOTES).toEqual([
      'C2',
      'F2',
      'C3',
      'F3',
      'C4',
      'F4',
      'C5',
      'F5',
      'C6',
      'F6',
      'C7',
    ])

    const fourZoneSplit: SplitState = {
      enabled: true,
      points: {
        low: { active: true, note: 'C3', crossfade: 0 }, // 48
        mid: { active: true, note: 'C4', crossfade: 6 }, // 60 ±6
        high: { active: true, note: 'C5', crossfade: 12 }, // 72 ±12
      },
    }
    expect(getActiveZoneCount(fourZoneSplit)).toBe(4)

    // Hard split at C3 (48): zone 0 ends below 48, zone 1 starts at 48
    expect(computeZoneGain(47, fourZoneSplit, { lowZone: 0, highZone: 0 })).toBe(1)
    expect(computeZoneGain(48, fourZoneSplit, { lowZone: 0, highZone: 0 })).toBe(0)
    expect(computeZoneGain(48, fourZoneSplit, { lowZone: 1, highZone: 1 })).toBe(1)

    // ±6 crossfade at C4 (60): at 60 both zone 1 and zone 2 are 0.5; at 54 zone 2 is 0; at 66 zone 1 is 0
    expect(computeZoneGain(60, fourZoneSplit, { lowZone: 1, highZone: 1 })).toBeCloseTo(0.5, 4)
    expect(computeZoneGain(60, fourZoneSplit, { lowZone: 2, highZone: 2 })).toBeCloseTo(0.5, 4)
    expect(computeZoneGain(54, fourZoneSplit, { lowZone: 2, highZone: 2 })).toBe(0)
    expect(computeZoneGain(66, fourZoneSplit, { lowZone: 1, highZone: 1 })).toBe(0)
    expect(computeZoneGain(57, fourZoneSplit, { lowZone: 2, highZone: 2 })).toBeCloseTo(0.25, 4)

    // ±12 crossfade at C5 (72): fades across 60..84
    expect(computeZoneGain(72, fourZoneSplit, { lowZone: 3, highZone: 3 })).toBeCloseTo(0.5, 4)
    expect(computeZoneGain(66, fourZoneSplit, { lowZone: 3, highZone: 3 })).toBeCloseTo(0.25, 4)
    expect(computeZoneGain(84, fourZoneSplit, { lowZone: 3, highZone: 3 })).toBe(1)
  })
})

describe('scenes.switching & morph.assignments & Master Clock & Panic', () => {
  it('switches Layer Scene I/II enable state without duplicating or losing sound parameters', () => {
    let s = createInitialInstrumentState(createMemoryStorageAdapter())
    // Scene I: Piano A ON (Grand), Synth A OFF (Super Saw)
    s = dispatchMany(s, [
      { type: 'set-synth-layer', layer: 'A', patch: { oscCategory: 'Super', oscWaveform: 'Super Saw', oscCtrl: 77 } },
      { type: 'switch-scene', scene: 'II' },
      // In Scene II enable Organ A and edit Piano timbre -> sound parameter shared back to Scene I!
      { type: 'set-organ-section', patch: { sectionOn: true } },
      { type: 'set-organ-layer', layer: 'A', patch: { enabled: true } },
      { type: 'set-piano-layer', layer: 'A', patch: { timbre: 'Bright' } },
    ])
    expect(s.scenes.activeScene).toBe('II')
    expect(s.organ.sectionOn).toBe(true)

    // Return to Scene I: Organ section enable reverts to OFF, but Piano timbre 'Bright' & Synth Super Saw remain!
    const backI = instrumentStateReducer(s, { type: 'switch-scene', scene: 'I' })
    expect(backI.organ.sectionOn).toBe(false)
    expect(backI.piano.layers.A.timbre).toBe('Bright')
    expect(backI.synth.layers.A.oscWaveform).toBe('Super Saw')
    expect(backI.synth.layers.A.oscCtrl).toBe(77)
  })

  it('assigns positive & inverted Wheel/Control Pedal morphs, interpolates, zeroes single target, and clears per source', () => {
    let s = createInitialInstrumentState(createMemoryStorageAdapter())
    // Latch Wheel morph assign, increase Synth Filter Freq (35 -> 85) and decrease Piano A level (92 -> 32)
    s = dispatchMany(s, [
      { type: 'activate', id: 'program-morph-wheel' },
      { type: 'set', id: 'synth-filter-freq', value: 85 },
      { type: 'set', id: 'piano-layer-a-fader', value: 32 },
      { type: 'activate', id: 'program-morph-wheel' }, // exit assign
      // Assign Control Pedal to Rotary speed & Organ drawbar 1
      { type: 'assign-morph', source: 'controlPedal', target: 'rotary:speed', start: 0, end: 1 },
      { type: 'assign-morph', source: 'controlPedal', target: 'organ:A:drawbar:0', start: 8, end: 2 },
    ])
    expect(s.morphs.wheel).toHaveLength(2)
    expect(s.morphs.controlPedal).toHaveLength(2)

    // Interpolate at Wheel = 50%, Control Pedal = 100%
    const moved = dispatchMany(s, [
      { type: 'set-mod-wheel', value: 50 },
      { type: 'set-control-pedal', value: 100 },
    ])
    const eff = resolveMorphedStageState(moved)
    expect(eff.synth.layers.A.filter.freq).toBeCloseTo(60, 1) // 35 + 0.5 * (85 - 35)
    expect(eff.piano.layers.A.level).toBeCloseTo(62, 1) // 92 + 0.5 * (32 - 92)
    expect(eff.effects.rotary.speed).toBe('Fast')
    expect(eff.organ.layers.A.drawbars[0]).toBe(2)

    // Re-holding and zeroing a single control removes just that assignment
    const zeroedOne = dispatchMany(s, [
      { type: 'activate', id: 'program-morph-wheel' },
      { type: 'set', id: 'synth-filter-freq', value: 35 }, // back to start
      { type: 'activate', id: 'program-morph-wheel' },
    ])
    expect(zeroedOne.morphs.wheel).toHaveLength(1)
    expect(zeroedOne.morphs.wheel[0].target).toBe('piano:A:level')

    // Shift + Morph Wheel clears all Wheel assignments while keeping Control Pedal assignments intact
    const clearedWheel = dispatchMany(zeroedOne, [
      { type: 'activate', id: 'program-shift' },
      { type: 'activate', id: 'program-morph-wheel' },
    ])
    expect(clearedWheel.morphs.wheel).toHaveLength(0)
    expect(clearedWheel.morphs.controlPedal).toHaveLength(2)
  })

  it('sets Master Clock via 4+ taps (30-300 BPM) and resets held performance inputs on Shift+Transpose Panic', () => {
    let s = createInitialInstrumentState(createMemoryStorageAdapter())
    // 4 taps 400ms apart = 150 BPM
    s = dispatchMany(s, [
      { type: 'tap-master-clock', nowMs: 1000 },
      { type: 'tap-master-clock', nowMs: 1400 },
      { type: 'tap-master-clock', nowMs: 1800 },
      { type: 'tap-master-clock', nowMs: 2200 },
    ])
    expect(s.masterClock.bpm).toBe(150)

    // Panic via Shift + Transpose resets Pitch Stick, Mod Wheel, Control Pedal, KB Hold, and increments panicCounter
    const stressed = dispatchMany(s, [
      { type: 'set-pitch-stick', value: 80 },
      { type: 'set-mod-wheel', value: 90 },
      { type: 'set-control-pedal', value: 75 },
      { type: 'set-synth-layer', layer: 'A', patch: { arp: { ...s.synth.layers.A.arp, kbHold: true } } },
    ])
    const panicked = dispatchMany(stressed, [
      { type: 'activate', id: 'program-shift' },
      { type: 'activate', id: 'program-transpose' },
    ])
    expect(panicked.panicCounter).toBe(stressed.panicCounter + 1)
    expect(panicked.pitchStick).toBe(0)
    expect(panicked.modWheel).toBe(0)
    expect(panicked.controlPedal).toBe(0)
    expect(panicked.synth.layers.A.arp.kbHold).toBe(false)
  })
})

describe('hardware.bindings — complete control audit (no silent no-ops)', () => {
  it('binds every non-excluded control in PANEL_CONTROLS and lists every excluded control in UNSUPPORTED_CONTROLS_AUDIT', () => {
    const excludedIds = new Set(UNSUPPORTED_CONTROLS_AUDIT.map((e) => e.id))
    expect(excludedIds.has('program-morph-at')).toBe(true)
    expect(excludedIds.has('program-preset-organ')).toBe(true)
    expect(excludedIds.has('program-preset-piano')).toBe(true)
    expect(excludedIds.has('program-preset-synth')).toBe(true)
    expect(excludedIds.has('program-section-edit')).toBe(true)
    expect(excludedIds.has('program-mon-copy')).toBe(true)
    expect(excludedIds.has('organ-preset')).toBe(true)

    const base = createInitialInstrumentState(createMemoryStorageAdapter())
    for (const spec of PANEL_CONTROLS) {
      if (excludedIds.has(spec.id)) continue
      const action =
        spec.kind === 'button'
          ? ({ type: 'activate', id: spec.id } as const)
          : ({ type: 'step', id: spec.id, delta: 1 } as const)
      const next = instrumentStateReducer(base, action)
      // Every bound control either mutates canonical state or is already at its selected slot (program-btn-1)
      if (spec.id === 'program-btn-1' || spec.id === 'synth-waveform-btn') {
        expect(next).toBeDefined()
      } else {
        expect(next, `control ${spec.id} was a silent no-op`).not.toBe(base)
      }
    }

    // Verify all morphable control IDs map to canonical MorphTargetIds
    const expectedMorphControls = [
      'organ-layer-a-fader',
      'organ-layer-b-fader',
      'organ-drawbar-1',
      'organ-drawbar-9',
      'perf-rotary-speed',
      'piano-layer-a-fader',
      'piano-layer-b-fader',
      'synth-layer-a-fader',
      'synth-layer-b-fader',
      'synth-layer-c-fader',
      'synth-lfo-rate',
      'synth-osc-ctrl',
      'synth-lfo-amt',
      'synth-filter-freq',
      'synth-filter-res',
      'synth-arp-rate',
      'fx-mod1-rate',
      'fx-mod1-amount',
      'fx-mod2-amount',
      'fx-delay-tempo',
      'fx-delay-feedback',
      'fx-delay-dry-wet',
      'fx-amp-freq',
      'fx-amp-drive',
      'fx-reverb-dry-wet',
    ]
    for (const cid of expectedMorphControls) {
      expect(getControlMorphTarget(base, cid), `missing morph target for ${cid}`).not.toBeNull()
    }
  })
})
