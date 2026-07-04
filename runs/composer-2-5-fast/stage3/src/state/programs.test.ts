import { describe, expect, it } from 'vitest'
import { defaultInstrumentState } from '../audio/types'
import {
  applySerializableToAudio,
  audioToSerializable,
  autoStoreLive,
  createProgramSystem,
  formatProgramLabel,
  loadCurrentSlot,
  markDirty,
  numericListPrograms,
  persistPrograms,
  programIndex,
  restorePrograms,
  saveToCurrentSlot,
  saveToSlotIndex,
  selectProgram,
} from './programs'

describe('programs.roundtrip', () => {
  it('round-trips supported state across 32 slots', () => {
    let system = createProgramSystem()
    const audio = defaultInstrumentState()
    audio.organ.layerA.model = 'Pipe'
    audio.synth.layerA.category = 'Super'
    audio.split.enabled = true
    const serial = audioToSerializable(audio)

    for (let i = 0; i < 32; i++) {
      system = saveToSlotIndex(system, i, {
        ...serial,
        organ: { ...serial.organ, layerA: { ...serial.organ.layerA, model: i % 2 === 0 ? 'B3' : 'Vox' } },
      }, `P${i}`)
    }

    system = selectProgram(system, 2, 3, true).system
    const loaded = loadCurrentSlot(system)
    const restored = applySerializableToAudio(defaultInstrumentState(), loaded.state)
    expect(restored.organ.layerA.model).toBe('Vox')
    expect(restored.masterLevel).toBe(100)
    expect(restored.split.enabled).toBe(true)
  })

  it('truthful dirty indicator', () => {
    let system = createProgramSystem()
    expect(system.dirty).toBe(false)
    system = markDirty(system)
    expect(system.dirty).toBe(true)
    system = saveToCurrentSlot(system, audioToSerializable(defaultInstrumentState()))
    expect(system.dirty).toBe(false)
  })
})

describe('programs.store-live', () => {
  it('supports Store and Store As naming', () => {
    let system = createProgramSystem()
    const serial = audioToSerializable(defaultInstrumentState())
    system = saveToCurrentSlot(system, serial, 'My Patch')
    expect(loadCurrentSlot(system).name).toBe('My Patch')
  })

  it('auto-stores edits in 8 live slots', () => {
    let system = { ...createProgramSystem(), liveMode: true, currentPage: 0, currentButton: 2 }
    const serial = audioToSerializable(defaultInstrumentState())
    serial.organ.layerA.model = 'Farf'
    system = autoStoreLive(system, serial)
    expect(system.liveSlots[2]!.state.organ.layerA.model).toBe('Farf')
    expect(system.dirty).toBe(false)
  })

  it('ships at least 8 factory programs', () => {
    const system = createProgramSystem()
    const names = system.slots.slice(0, 8).map((s) => s.name)
    expect(names.filter((n) => !n.startsWith('Init')).length).toBeGreaterThanOrEqual(8)
  })
})

describe('programs.undo-cancel', () => {
  it('discards edits on program change when dirty', () => {
    let system = createProgramSystem()
    system = markDirty(system)
    const { system: next, discarded } = selectProgram(system, 1, 0, true)
    expect(discarded).toBe(true)
    expect(next.dirty).toBe(false)
  })

  it('blocks program change without discard when dirty', () => {
    let system = createProgramSystem()
    system = markDirty(system)
    const { system: next, discarded } = selectProgram(system, 1, 0, false)
    expect(discarded).toBe(false)
    expect(next.currentPage).toBe(0)
  })
})

describe('programs.navigation', () => {
  it('selects programs via page and button index', () => {
    let system = createProgramSystem()
    system = selectProgram(system, 2, 5, true).system
    expect(programIndex(system.currentPage, system.currentButton)).toBe(21)
    expect(formatProgramLabel(2, 5, 'Test')).toBe('3.6 Test')
  })

  it('exposes numeric list view of all 32 programs', () => {
    const list = numericListPrograms(createProgramSystem())
    expect(list).toHaveLength(32)
    expect(list[0]).toMatch(/^1\.1/)
  })

  it('persists slots through storage boundary', () => {
    const storage = new Map<string, string>()
    const mockStorage = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => { storage.set(k, v) },
    } as Storage
    let system = createProgramSystem()
    system = saveToCurrentSlot(system, audioToSerializable(defaultInstrumentState()), 'Stored')
    persistPrograms(system, mockStorage)
    const restored = restorePrograms(createProgramSystem(), mockStorage)
    expect(restored.slots[0]!.name).toBe('Stored')
  })
})

describe('system.integration', () => {
  it('programs round-trip organ synth and effects together', () => {
    const audio = defaultInstrumentState()
    audio.effects.reverb.mix = 90
    audio.organ.layerB.model = 'Pipe'
    audio.synth.layerC.category = 'FM-H'
    const serial = audioToSerializable(audio)
    const round = applySerializableToAudio(defaultInstrumentState(), serial)
    expect(round.effects.reverb.mix).toBe(90)
    expect(round.organ.layerB.model).toBe('Pipe')
    expect(round.synth.layerC.category).toBe('FM-H')
  })
})
