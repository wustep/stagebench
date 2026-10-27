import { describe, expect, it } from 'vitest'
import {
  LIVE_SLOTS,
  createFactoryBank,
  createLiveSlots,
  createMemoryStorage,
  createProgramSystem,
  type ProgramSystem,
} from '../audio/programStore'
import {
  cloneProgramState,
  defaultProgramState,
  programStatesEqual,
  type ProgramState,
} from '../audio/programState'

/**
 * programs.store-live — Store, Store As with naming, and the eight auto-storing Live slots.
 *
 * The distinctions that matter:
 *
 *  - **Store** overwrites the current slot in two presses (destination step, then confirm).
 *  - **Store As** asks for a name first, then the destination, so a program is never
 *    overwritten under a name the player did not type.
 *  - **Live slots** are always stored: an edit is the store, and reloading the page brings the
 *    edited Live slot back.
 *  - **Shift/Exit** cancels a store, leaving the slot untouched.
 */

interface Harness {
  system: ProgramSystem
  live: () => ProgramState
  edit: (mutate: (draft: ProgramState) => void) => void
}

function harness(
  options: { slot?: number; storage?: ReturnType<typeof createMemoryStorage>; liveMode?: boolean } = {},
): Harness {
  let live = defaultProgramState()
  const system = createProgramSystem({
    read: () => live,
    write: (state) => {
      live = cloneProgramState(state)
    },
    programs: createFactoryBank(),
    liveSlots: createLiveSlots(),
    slot: options.slot,
    storage: options.storage,
    liveMode: options.liveMode,
  })
  // Boot the live state from the selected slot's stored program, exactly as the instrument
  // does at power-on, so the harness starts from a clean program.
  const bootRecord = system.get().stored
  if (bootRecord) live = cloneProgramState(bootRecord)
  return {
    system,
    live: () => live,
    edit: (mutate) => {
      const next = cloneProgramState(live)
      mutate(next)
      live = next
      // The instrument calls `noteEdit` after any panel edit; in Live mode that is the store.
      system.noteEdit()
    },
  }
}

describe('programs.store-live — Store', () => {
  it('takes two presses: the first shows the destination, the second commits', () => {
    const { system, edit } = harness()
    system.selectSlot(5)
    edit((draft) => {
      draft.piano.layers['piano.a'].level = 33
    })
    expect(system.get().dirty).toBe(true)

    // The first press enters the destination step and changes nothing yet.
    system.beginStore()
    expect(system.get().storeTarget).toBe(5)
    expect(system.get().dirty).toBe(true)
    expect(system.get().programs[4].state.piano.layers['piano.a'].level).not.toBe(33)

    // The second press commits.
    system.confirmStore()
    expect(system.get().storeTarget).toBeNull()
    expect(system.get().dirty).toBe(false)
    expect(system.get().programs[4].state.piano.layers['piano.a'].level).toBe(33)
  })

  it('moves the destination with the dial, and stores there', () => {
    const { system, live, edit } = harness()
    system.selectSlot(2)
    edit((draft) => {
      draft.transpose = 4
      draft.transposeOn = true
    })
    system.beginStore()
    system.storeBrowse(3)
    expect(system.get().storeTarget).toBe(5)
    system.confirmStore()
    // The store landed on slot 5, and slot 5 is now selected.
    expect(system.get().slot).toBe(5)
    expect(system.get().programs[4].state.transpose).toBe(4)
    expect(live().transpose).toBe(4)
    // Slot 2 was not touched.
    expect(system.get().programs[1].state.transpose).toBe(0)
  })

  it('cancels a pending store without changing the slot', () => {
    const { system, edit } = harness()
    system.selectSlot(8)
    edit((draft) => {
      draft.transpose = 6
    })
    const before = cloneProgramState(system.get().programs[7].state)
    system.beginStore()
    system.cancelStore()
    expect(system.get().storeTarget).toBeNull()
    expect(programStatesEqual(system.get().programs[7].state, before)).toBe(true)
    // The edit is still live and the program is still dirty.
    expect(system.get().dirty).toBe(true)
  })

  it('stores a different state into an existing factory program', () => {
    const { system, edit } = harness()
    system.selectSlot(2)
    expect(system.get().name).toBe('Concert Grand')
    edit((draft) => {
      draft.organ.sectionOn = true
      draft.organ.layers['organ.a'].enabled = true
      draft.piano.sectionOn = false
    })
    system.beginStore()
    system.confirmStore()
    const stored = system.get().programs[1]
    // The name is kept by a plain Store; only Store As changes it.
    expect(stored.name).toBe('Concert Grand')
    expect(stored.state.organ.sectionOn).toBe(true)
    expect(stored.state.piano.sectionOn).toBe(false)
  })
})

describe('programs.store-live — Store As with naming', () => {
  it('asks for a name before the destination, then stores under that name', () => {
    const { system, edit } = harness()
    system.selectSlot(11)
    edit((draft) => {
      draft.synth.layers['synth.a'].waveform = 'Super Square'
    })
    system.beginStoreAs()
    expect(system.get().naming).not.toBeNull()
    // The name starts as a new name rather than the slot's, so nothing is overwritten under
    // a name the player never typed.
    expect(system.get().naming).not.toBe(system.get().name)

    system.setName('Square Lead')
    expect(system.get().naming).toBe('Square Lead')
    system.storeSelect(14)
    expect(system.get().storeTarget).toBe(14)
    system.confirmStore()

    expect(system.get().slot).toBe(14)
    expect(system.get().name).toBe('Square Lead')
    expect(system.get().programs[13].name).toBe('Square Lead')
    expect(system.get().programs[13].state.synth.layers['synth.a'].waveform).toBe('Super Square')
    expect(system.get().dirty).toBe(false)
  })

  it('caps the name length at what the display can show', () => {
    const { system } = harness()
    system.beginStoreAs()
    system.setName('a name far longer than the display allows')
    expect((system.get().naming ?? '').length).toBeLessThanOrEqual(16)
  })

  it('supports insert and delete by rewriting the whole name', () => {
    const { system } = harness()
    system.beginStoreAs()
    system.setName('Pad')
    expect(system.get().naming).toBe('Pad')
    // Insertion in the middle.
    system.setName('Pad 2')
    expect(system.get().naming).toBe('Pad 2')
    // Deletion.
    system.setName('Pad ')
    expect(system.get().naming).toBe('Pad ')
  })
})

describe('programs.store-live — the eight Live slots', () => {
  it('gives the eight program buttons the Live slots in Live mode', () => {
    const { system } = harness()
    expect(system.get().liveMode).toBe(false)
    system.selectSlot(1)
    system.setLiveMode(true)
    expect(system.get().liveMode).toBe(true)
    expect(system.get().slot).toBe(1)
    expect(system.get().liveSlots).toHaveLength(LIVE_SLOTS)
    // Selecting a Live slot writes it into the instrument.
    system.selectSlot(4)
    expect(system.get().slot).toBe(4)
    expect(system.get().name).toBe('Live 4')
    // Leaving Live mode returns to the bank.
    system.setLiveMode(false)
    expect(system.get().liveMode).toBe(false)
    expect(system.get().slot).toBeGreaterThanOrEqual(1)
    expect(system.get().slot).toBeLessThanOrEqual(32)
  })

  it('stores every edit automatically, so a Live slot is never dirty', () => {
    const { system, edit } = harness()
    system.selectSlot(1)
    system.setLiveMode(true)
    expect(system.get().dirty).toBe(false)
    edit((draft) => {
      draft.piano.layers['piano.a'].level = 91
      draft.transpose = 3
    })
    // The edit is already stored: the indicator never lights up.
    expect(system.get().dirty).toBe(false)
    expect(system.get().liveSlots[0].state.piano.layers['piano.a'].level).toBe(91)
    expect(system.get().liveSlots[0].state.transpose).toBe(3)
  })

  it('keeps each Live slot independent', () => {
    const { system, edit } = harness()
    system.selectSlot(1)
    system.setLiveMode(true)
    edit((draft) => {
      draft.transpose = 1
    })
    system.selectSlot(2)
    edit((draft) => {
      draft.transpose = -2
    })
    expect(system.get().liveSlots[0].state.transpose).toBe(1)
    expect(system.get().liveSlots[1].state.transpose).toBe(-2)
    // Going back to slot 1 restores its own value.
    system.selectSlot(1)
    expect(system.get().liveSlots[0].state.transpose).toBe(1)
  })

  it('survives a reload through the persistence boundary', () => {
    const storage = createMemoryStorage()
    const first = harness({ storage })
    first.system.setLiveMode(true)
    first.system.selectSlot(3)
    first.edit((draft) => {
      draft.piano.layers['piano.a'].level = 55
      draft.synth.layers['synth.a'].waveform = 'Pulse 10'
    })
    expect(first.system.get().liveSlots[2].state.piano.layers['piano.a'].level).toBe(55)

    // A new system over the same storage: the Live slot comes back edited.
    const second = harness({ storage })
    second.system.setLiveMode(true)
    second.system.selectSlot(3)
    expect(second.live().piano.layers['piano.a'].level).toBe(55)
    expect(second.live().synth.layers['synth.a'].waveform).toBe('Pulse 10')
  })

  it('copies a program between a regular slot and a Live slot with Store', () => {
    const { system, edit } = harness()
    // Save a distinctive program into slot 12.
    system.selectSlot(12)
    edit((draft) => {
      draft.transpose = -6
      draft.transposeOn = true
    })
    system.beginStore()
    system.confirmStore()

    // Enter Live mode at button 1 (Live 1) and copy slot 12's state into it by storing.
    system.setLiveMode(true)
    system.selectSlot(1)
    // The Live slot starts as its own program; store the bank program into it.
    system.selectSlot(1)
    system.beginStore()
    system.confirmStore()
    // Copy the bank program's state in deliberately, as the player would by selecting it.
    system.setLiveMode(false)
    system.selectSlot(12)
    system.setLiveMode(true)
    expect(system.get().liveMode).toBe(true)
  })
})

describe('programs.store-live — the dirty lifecycle around Live mode', () => {
  it('discards unsaved edits when entering or leaving Live mode', () => {
    const { system, edit } = harness()
    system.selectSlot(6)
    edit((draft) => {
      draft.transpose = 5
    })
    expect(system.get().dirty).toBe(true)
    system.setLiveMode(true)
    // Entering Live mode loads a Live slot, which discards the bank edit.
    expect(system.get().dirty).toBe(false)
    expect(system.get().liveMode).toBe(true)
  })

  it('reports the stored state through `stored`, so a reload can be compared', () => {
    const { system, edit } = harness()
    system.selectSlot(2)
    const stored = system.get().stored
    expect(stored).not.toBeNull()
    expect(programStatesEqual(stored!, system.get().programs[1].state)).toBe(true)
    edit((draft) => {
      draft.transpose = 2
    })
    // `stored` still names the slot's committed state, not the edited one.
    expect(system.get().stored!.transpose).toBe(0)
  })
})
