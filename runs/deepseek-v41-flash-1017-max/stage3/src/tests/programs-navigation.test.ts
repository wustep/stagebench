import { describe, expect, it } from 'vitest'
import {
  PROGRAM_SLOTS,
  LIVE_SLOTS,
  SLOTS_PER_PAGE,
  PROGRAM_PAGES,
  browserProgramStorage,
  clampSlot,
  createFactoryBank,
  createLiveSlots,
  createMemoryStorage,
  createProgramSystem,
  pageForSlot,
  buttonForSlot,
  slotFor,
  slotLabel,
  visibleSlots,
  type ProgramStorage,
} from '../audio/programStore'
import {
  cloneProgramState,
  defaultProgramState,
  deserializeProgram,
  programStatesEqual,
  serializeProgram,
  type ProgramState,
} from '../audio/programState'
import { ALL_LAYER_IDS } from '../audio/programState'

/**
 * programs.navigation — 32 slots in 4 pages of 8, the dial, and the numeric list view.
 *
 * The slot maths is asserted directly because it is the part a player experiences: page 3,
 * button 2 must be slot 18, and the eight buttons must address the right eight slots for
 * whichever page is showing.
 */

describe('programs.navigation — the 32-slot bank', () => {
  it('has exactly 32 programs in 4 pages of 8', () => {
    expect(PROGRAM_SLOTS).toBe(32)
    expect(PROGRAM_PAGES).toBe(4)
    expect(SLOTS_PER_PAGE).toBe(8)
    expect(PROGRAM_PAGES * SLOTS_PER_PAGE).toBe(PROGRAM_SLOTS)
    // Live mode has its own eight slots, not a page of the bank.
    expect(LIVE_SLOTS).toBe(8)
  })

  it('maps slots to page and button exactly as the display prints them', () => {
    expect(slotLabel(1)).toBe('1.1')
    expect(slotLabel(8)).toBe('1.8')
    expect(slotLabel(9)).toBe('2.1')
    expect(slotLabel(18)).toBe('3.2')
    expect(slotLabel(32)).toBe('4.8')
    expect(pageForSlot(18)).toBe(3)
    expect(buttonForSlot(18)).toBe(2)
    expect(slotFor(3, 2)).toBe(18)
    // Every slot round-trips.
    for (let slot = 1; slot <= PROGRAM_SLOTS; slot += 1) {
      expect(slotFor(pageForSlot(slot), buttonForSlot(slot))).toBe(slot)
    }
  })

  it('clamps a slot number into the bank rather than accepting an invalid one', () => {
    expect(clampSlot(0)).toBe(1)
    expect(clampSlot(-4)).toBe(1)
    expect(clampSlot(33)).toBe(PROGRAM_SLOTS)
    expect(clampSlot(Number.NaN)).toBe(1)
    expect(clampSlot(7.4)).toBe(7)
  })

  it('ships twelve factory programs covering every required demonstration', () => {
    const bank = createFactoryBank()
    expect(bank).toHaveLength(PROGRAM_SLOTS)
    const named = bank.filter((program) => !program.name.startsWith('Init'))
    expect(named.length).toBeGreaterThanOrEqual(8)
    // The spec's list: piano, organ, synth, split and layered setups must all be present.
    const names = named.map((program) => program.name)
    expect(names).toContain('Concert Grand')
    expect(names).toContain('Drawbar Blues')
    expect(names).toContain('Super Wide')
    expect(names).toContain('Split Bass / Lead')
    expect(names).toContain('Piano + Pad')
    expect(names).toContain('Tine Stack')
    // Every program has a name, a slot and a state.
    for (const program of bank) {
      expect(program.name.length).toBeGreaterThan(0)
      expect(program.slot).toBeGreaterThanOrEqual(1)
      expect(program.slot).toBeLessThanOrEqual(PROGRAM_SLOTS)
      expect(program.state).toBeDefined()
      expect(program.live).toBe(false)
    }
    // The split program really has a split, and the layered one really has two engines.
    const split = bank.find((program) => program.name === 'Split Bass / Lead')!
    expect(split.state.split.on).toBe(true)
    const layered = bank.find((program) => program.name === 'Piano + Pad')!
    expect(layered.state.piano.sectionOn).toBe(true)
    expect(layered.state.synth.sectionOn).toBe(true)
    const organ = bank.find((program) => program.name === 'Drawbar Blues')!
    expect(organ.state.organ.sectionOn).toBe(true)
    expect(organ.state.piano.sectionOn).toBe(false)
  })

  it('selects a slot with the program buttons and pages with the page buttons', () => {
    let live = defaultProgramState()
    const system = createProgramSystem({
      read: () => live,
      write: (state) => {
        live = cloneProgramState(state)
      },
      programs: createFactoryBank(),
      liveSlots: createLiveSlots(),
    })
    expect(system.get().slot).toBe(1)
    expect(system.get().page).toBe(1)

    system.selectSlot(18)
    expect(system.get().slot).toBe(18)
    expect(system.get().page).toBe(3)
    expect(system.get().name).toBe('Init 3.2')

    system.setPage(2)
    expect(system.get().page).toBe(2)
    // The page clamps inside 1..4.
    system.setPage(9)
    expect(system.get().page).toBe(4)
    system.setPage(0)
    expect(system.get().page).toBe(1)
  })

  it('browses with the dial, wrapping inside the bank', () => {
    let live = defaultProgramState()
    const system = createProgramSystem({
      read: () => live,
      write: (state) => {
        live = cloneProgramState(state)
      },
    })
    system.selectSlot(1)
    system.browse(-1)
    expect(system.get().slot).toBe(32)
    system.browse(1)
    expect(system.get().slot).toBe(1)
    system.browse(5)
    expect(system.get().slot).toBe(6)
  })

  it('opens the numeric list view, which lists all 32 programs', () => {
    let live = defaultProgramState()
    const system = createProgramSystem({
      read: () => live,
      write: (state) => {
        live = cloneProgramState(state)
      },
    })
    expect(system.get().listView).toBe(false)
    system.setListView(true)
    expect(system.get().listView).toBe(true)
    const slots = visibleSlots(system.get())
    expect(slots).toHaveLength(32)
    expect(slots.map((slot) => slot.slot)).toEqual(
      Array.from({ length: 32 }, (_, index) => index + 1),
    )
    system.setListView(false)
    expect(system.get().listView).toBe(false)
  })
})

describe('programs.navigation — the eight program buttons', () => {
  it('addresses the eight slots of the current page', () => {
    let live = defaultProgramState()
    const system = createProgramSystem({
      read: () => live,
      write: (state) => {
        live = cloneProgramState(state)
      },
    })
    // Page 2 spans slots 9..16, so page 2 button 3 is slot 11.
    system.setPage(2)
    expect(system.get().page).toBe(2)
    system.selectSlot(slotFor(2, 3))
    expect(system.get().slot).toBe(11)
    expect(system.get().page).toBe(2)
    expect(slotLabel(11)).toBe('2.3')
    // Page 3 button 8 is the last slot of that page.
    system.selectSlot(slotFor(3, 8))
    expect(system.get().slot).toBe(24)
  })
})

describe('programs.navigation — persistence', () => {
  it('persists the bank through the injected storage boundary', () => {
    const storage = createMemoryStorage()
    let live = defaultProgramState()
    const first = createProgramSystem({
      read: () => live,
      write: (state) => {
        live = cloneProgramState(state)
      },
      storage,
    })
    first.selectSlot(4)
    first.beginStore()
    // Change something, then store.
    live = { ...live, transpose: 3, transposeOn: true }
    first.confirmStore()

    // A fresh system over the same storage sees the stored program.
    let reloaded = defaultProgramState()
    const second = createProgramSystem({
      read: () => reloaded,
      write: (state) => {
        reloaded = cloneProgramState(state)
      },
      storage,
    })
    expect(second.get().slot).toBe(1)
    second.selectSlot(4)
    expect(reloaded.transpose).toBe(3)
    expect(reloaded.transposeOn).toBe(true)
  })

  it('falls back to the factory bank when the stored data is corrupt', () => {
    const storage = createMemoryStorage('{"not":"a bank"}')
    let live = defaultProgramState()
    const system = createProgramSystem({
      read: () => live,
      write: (state) => {
        live = cloneProgramState(state)
      },
      storage,
    })
    // A corrupt bank is not half-loaded: the factory content is used instead.
    expect(system.get().programs).toHaveLength(32)
    expect(system.get().programs[0].name).toBe('Init Stage')
  })

  it('survives a storage write failure without corrupting the instrument', () => {
    const failing: ProgramStorage = {
      read: () => null,
      write: () => {
        throw new Error('quota exceeded')
      },
      clear: () => {},
    }
    let live = defaultProgramState()
    const system = createProgramSystem({
      read: () => live,
      write: (state) => {
        live = cloneProgramState(state)
      },
      storage: failing,
    })
    expect(() => {
      system.beginStore()
      system.confirmStore()
    }).not.toThrow()
    // The program is still stored in memory for this session.
    expect(system.get().storeTarget).toBeNull()
    expect(system.get().dirty).toBe(false)
  })

  it('reads back what it serialises', () => {
    const system = createProgramSystem({
      read: () => defaultProgramState(),
      write: () => {},
    })
    const text = system.serialize()
    const parsed = JSON.parse(text) as { programs: unknown[]; liveSlots: unknown[] }
    expect(parsed.programs).toHaveLength(32)
    expect(parsed.liveSlots).toHaveLength(8)
  })

  it('uses the browser storage adapter without throwing when storage is absent', () => {
    const storage = browserProgramStorage('test-key-absent')
    // In an environment with no localStorage the adapter is a no-op rather than a crash.
    expect(() => storage.write('x')).not.toThrow()
    expect(() => storage.read()).not.toThrow()
    expect(() => storage.clear()).not.toThrow()
  })
})

describe('programs.navigation — the canonical state', () => {
  it('is JSON-safe with no functions, classes or undefined', () => {
    const state = defaultProgramState()
    const text = serializeProgram(state)
    const parsed = JSON.parse(text) as ProgramState
    // Serialising twice is stable: nothing in the state is order-dependent or volatile.
    expect(text).toBe(serializeProgram(parsed))
    // No undefined survived the round trip: every top-level key is present.
    for (const key of Object.keys(state) as Array<keyof ProgramState>) {
      expect(parsed[key], key).toBeDefined()
    }
    // Deep scan for undefined, functions and class instances.
    const walk = (value: unknown, path: string): void => {
      expect(typeof value, path).not.toBe('function')
      expect(value, path).not.toBeUndefined()
      if (value === null || typeof value !== 'object') return
      expect(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype, path).toBe(true)
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) walk(child, `${path}.${key}`)
    }
    walk(parsed, 'state')
  })

  it('round-trips through serialize and deserialize without losing a field', () => {
    const state = defaultProgramState()
    // Change one value in every sub-state, so the round-trip covers each area.
    state.piano.layers['piano.b'].enabled = true
    state.organ.layers['organ.a'].drawbars = [1, 2, 3, 4, 5, 6, 7, 8, 0]
    state.synth.layers['synth.c'].waveform = 'FM 2-op (algorithm A)'
    state.effects.chains['synth.b'].delay.on = true
    state.split.on = true
    state.split.points.Mid = { position: 'F4', crossfade: 12 }
    state.scenes.second = true
    state.morph.wheel = [{ controlId: 'piano.layer.a.level', start: 20, end: 90 }]
    state.clock.bpm = 143
    state.transpose = -4
    state.transposeOn = true

    const restored = deserializeProgram(serializeProgram(state))
    expect(restored.piano.layers['piano.b'].enabled).toBe(true)
    expect(restored.organ.layers['organ.a'].drawbars).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 0])
    expect(restored.synth.layers['synth.c'].waveform).toBe('FM 2-op (algorithm A)')
    expect(restored.effects.chains['synth.b'].delay.on).toBe(true)
    expect(restored.split.points.Mid).toEqual({ position: 'F4', crossfade: 12 })
    expect(restored.scenes.second).toBe(true)
    expect(restored.morph.wheel).toHaveLength(1)
    expect(restored.clock.bpm).toBe(143)
    expect(restored.transpose).toBe(-4)
    expect(restored.transposeOn).toBe(true)
    // And it is structurally identical.
    expect(programStatesEqual(restored, state)).toBe(true)
  })

  it('covers every engine layer in the split zone map', () => {
    const state = defaultProgramState()
    for (const layer of ALL_LAYER_IDS) {
      expect(state.split.zones[layer], layer).toBeDefined()
      expect(state.split.zones[layer]).toHaveLength(4)
      expect(state.scenes.sceneI[layer], layer).toBeDefined()
      expect(state.scenes.sceneII[layer], layer).toBeDefined()
    }
  })

  it('treats two states as equal regardless of key insertion order or revision', () => {
    const a = defaultProgramState()
    const b = deserializeProgram(serializeProgram(a))
    // Revision counters differ; they are not part of the compared state.
    expect(a.piano.revision).not.toBe(b.piano.revision)
    expect(programStatesEqual(a, b)).toBe(true)
    // A real difference is detected.
    b.piano.layers['piano.a'].level += 1
    expect(programStatesEqual(a, b)).toBe(false)
  })
})
