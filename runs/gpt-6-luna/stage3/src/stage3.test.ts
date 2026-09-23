import { describe, expect, it } from 'vitest'
import { defaultConfiguration } from './audio-graph'
import {
  activeRoutesForPatch,
  applyMorphAssignments,
  buildArpeggioSequence,
  createInitialStage3State,
  editPatch,
  getPatchPathNumber,
  morphValue,
  readStage3State,
  selectLive,
  selectProgram,
  setPatchPathNumber,
  splitCrossfadeGains,
  storeProgram,
  SYNTH_WAVEFORMS,
  zoneGainsForNote,
} from './stage3'

describe('Phase 3 patch storage and instrument routing', () => {
  it('round-trips supported engine, effect, scene, zone and morph state in all 32 program slots', () => {
    const initial = createInitialStage3State(defaultConfiguration())
    expect(initial.programs).toHaveLength(32)
    expect(initial.liveSlots).toHaveLength(8)
    const patch = structuredClone(initial.patch)
    patch.piano.layers.B.enabled = true
    patch.piano.effects.units.A.delay.feedback = 0.73
    patch.organ.layers.B.enabled = true
    patch.organ.layers.B.model = 'Farf'
    patch.organ.layers.B.drawbars[3] = 8
    patch.synth.layers.C.enabled = true
    patch.synth.layers.C.waveform = 'FM 2-op (algorithm A)'
    patch.splits.enabled = true
    patch.splits.zoneCount = 2
    patch.splits.points[0] = { note: 'C4', crossfade: 12, enabled: true }
    patch.scenes.enabled.II['synth-C'] = true
    patch.morph.assignments.Wheel = [{ path: 'synth.layers.C.cutoff', start: 0.2, end: 0.9, value: 0.5 }]
    patch.clockBpm = 137
    patch.transpose = -3

    const edited = editPatch(initial, patch)
    expect(edited.dirty).toBe(true)
    const stored = storeProgram(edited, 23, 'Layered Studio')
    const restored = readStage3State(JSON.stringify(stored), defaultConfiguration())
    expect(restored.programs).toHaveLength(32)
    expect(restored.programs[23]).toEqual({ name: 'Layered Studio', patch })
    expect(restored.patch).toEqual(patch)
    expect(selectProgram(restored, 23).patch).toEqual(patch)
  })

  it('discards unstored program edits and auto-saves all eight Live slots', () => {
    const initial = createInitialStage3State(defaultConfiguration())
    const editedPatch = structuredClone(initial.patch)
    editedPatch.synth.layers.A.enabled = true
    const edited = editPatch(initial, editedPatch)
    expect(edited.dirty).toBe(true)
    expect(selectProgram(edited, 1).patch).toEqual(initial.programs[1]!.patch)

    const live = selectLive(initial, 6)
    const livePatch = structuredClone(live.patch)
    livePatch.organ.layers.A.enabled = true
    livePatch.organ.layers.A.model = 'Pipe 1'
    const liveEdited = editPatch(live, livePatch)
    expect(liveEdited.dirty).toBe(false)
    expect(liveEdited.liveSlots).toHaveLength(8)
    expect(liveEdited.liveSlots[6]!.patch).toEqual(livePatch)
    expect(readStage3State(JSON.stringify(liveEdited), defaultConfiguration()).liveSlots[6]!.patch).toEqual(livePatch)
  })

  it('round-trips every regular and Live destination through saved storage', () => {
    let state = createInitialStage3State(defaultConfiguration())
    const expectedPrograms = [] as Array<{ name: string; patch: typeof state.patch }>
    for (let index = 0; index < 32; index += 1) {
      const patch = structuredClone(state.patch)
      patch.transpose = index - 16
      patch.clockBpm = 30 + index * 8
      patch.organ.layers.B.level = index / 31
      patch.synth.layers.C.cutoff = 1 - index / 31
      const name = `Saved ${index + 1}`
      state = storeProgram(editPatch(state, patch), index, name)
      expectedPrograms.push({ name, patch })
      expect(selectProgram(state, index).patch).toEqual(patch)
    }
    for (let index = 0; index < 8; index += 1) {
      state = selectLive(state, index)
      const patch = structuredClone(state.patch)
      patch.transpose = index - 4
      patch.clockSync = index % 2 === 1
      patch.synth.layers.B.arpRange = (index % 4 + 1) as 1 | 2 | 3 | 4
      state = editPatch(state, patch)
      expect(state.liveSlots[index]!.patch).toEqual(patch)
    }
    const restored = readStage3State(JSON.stringify(state), defaultConfiguration())
    expect(restored.programs).toEqual(expectedPrograms)
    expect(restored.liveSlots.every((slot, index) => slot.patch.transpose === index - 4)).toBe(true)
    for (let index = 0; index < 32; index += 1) expect(selectProgram(restored, index).patch).toEqual(expectedPrograms[index]!.patch)
    for (let index = 0; index < 8; index += 1) expect(selectLive(restored, index).patch).toEqual(restored.liveSlots[index]!.patch)
  })

  it('routes contiguous zones and gives split crossfades equal-power gains', () => {
    const patch = createInitialStage3State(defaultConfiguration()).patch
    patch.splits = {
      enabled: true,
      zoneCount: 2,
      points: [{ note: 'C4', crossfade: 12, enabled: true }, { note: 'F5', crossfade: 0, enabled: false }, { note: 'C6', crossfade: 0, enabled: false }],
    }
    const atSplit = splitCrossfadeGains(60, 60, 12)
    expect(atSplit.lower).toBeCloseTo(Math.SQRT1_2, 5)
    expect(atSplit.upper).toBeCloseTo(Math.SQRT1_2, 5)
    expect(zoneGainsForNote(60, patch.splits)).toEqual({ 0: atSplit.lower, 1: atSplit.upper })
    patch.piano.layers.B.enabled = true
    patch.pianoZones.A = { start: 0, end: 0 }
    patch.pianoZones.B = { start: 1, end: 1 }
    patch.organ.layers.A.enabled = true
    patch.organ.layers.A.zoneStart = 1
    patch.organ.layers.A.zoneEnd = 1
    expect(activeRoutesForPatch(patch, 60)).toEqual(['piano-A', 'piano-B', 'organ-A'])
    expect(activeRoutesForPatch(patch, 40)).toEqual(['piano-A'])
  })

  it('updates numeric morph destinations and builds deterministic synth sequences', () => {
    const patch = createInitialStage3State(defaultConfiguration()).patch
    const assignment = { path: 'synth.layers.A.cutoff', start: 0.2, end: 0.8, value: 0 }
    expect(morphValue(assignment, 0.5)).toBeCloseTo(0.5)
    setPatchPathNumber(patch, assignment.path, 0.35)
    expect(getPatchPathNumber(patch, assignment.path)).toBe(0.35)
    const morphed = applyMorphAssignments(patch, [assignment], 1, setPatchPathNumber)
    expect(getPatchPathNumber(morphed, assignment.path)).toBe(0.8)
    expect(SYNTH_WAVEFORMS.Pure).toEqual(['Sine', 'Triangle', 'Saw', 'Square', 'Pulse 33', 'Pulse 10', 'White Noise'])
    expect(buildArpeggioSequence([60, 64, 67], 2, 'Up')).toEqual([60, 64, 67, 72, 76, 79])
    expect(buildArpeggioSequence([60, 64, 67], 1, 'Down')).toEqual([67, 64, 60])
    expect(buildArpeggioSequence([60, 64, 67], 1, 'Random')).toEqual(buildArpeggioSequence([60, 64, 67], 1, 'Random'))
  })
})
