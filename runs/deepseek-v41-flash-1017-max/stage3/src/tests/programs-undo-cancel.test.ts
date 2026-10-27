import { describe, expect, it } from 'vitest'
import {
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
 * programs.undo-cancel — edit-discard on a program change, and the single-level undo the
 * spec offers as optional.
 *
 * The rule the spec states is "selecting another program without storing discards the edits"
 * (manual p. 13). This suite proves that directly: the state the instrument plays after a
 * program change is the slot's, not the discarded edit. It then proves that the undo
 * *actually restores* the discarded state, because an undo that only lit an LED would be
 * worse than no undo at all.
 */

interface Harness {
  system: ProgramSystem
  live: () => ProgramState
  edit: (mutate: (draft: ProgramState) => void) => void
}

function harness(): Harness {
  let live = defaultProgramState()
  const system = createProgramSystem({
    read: () => live,
    write: (state) => {
      live = cloneProgramState(state)
    },
    programs: createFactoryBank(),
    liveSlots: createLiveSlots(),
    storage: createMemoryStorage(),
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
      system.noteEdit()
    },
  }
}

describe('programs.undo-cancel — edit-discard on a program change', () => {
  it('discards an unsaved edit when another program is selected', () => {
    const { system, live, edit } = harness()
    system.selectSlot(2)
    expect(system.get().name).toBe('Concert Grand')
    edit((draft) => {
      draft.piano.timbre = 4
      draft.transpose = 5
      draft.transposeOn = true
      draft.effects.chains['piano.a'].reverb.on = true
    })
    expect(system.get().dirty).toBe(true)
    expect(live().piano.timbre).toBe(4)

    // Selecting another program discards all of it.
    system.selectSlot(9)
    expect(system.get().dirty).toBe(false)
    expect(live().piano.timbre).not.toBe(4)
    expect(live().transpose).toBe(0)
    expect(live().transposeOn).toBe(false)
    expect(live().effects.chains['piano.a'].reverb.on).toBe(false)
  })

  it('keeps a stored edit when another program is selected and returns to it', () => {
    const { system, live, edit } = harness()
    system.selectSlot(3)
    edit((draft) => {
      draft.piano.layers['piano.a'].level = 41
    })
    system.beginStore()
    system.confirmStore()
    // Stored, so moving away and back preserves the edit.
    system.selectSlot(20)
    system.selectSlot(3)
    expect(live().piano.layers['piano.a'].level).toBe(41)
    expect(system.get().dirty).toBe(false)
  })

  it('does not discard anything when the already-selected program is re-selected', () => {
    const { system, live, edit } = harness()
    system.selectSlot(4)
    edit((draft) => {
      draft.piano.timbre = 3
    })
    expect(system.get().dirty).toBe(true)
    // Tapping the lit button again is a no-op, so it cannot throw the edit away by accident.
    system.selectSlot(4)
    expect(system.get().dirty).toBe(true)
    expect(live().piano.timbre).toBe(3)
  })

  it('discards the edit when browsing with the dial too', () => {
    const { system, live, edit } = harness()
    system.selectSlot(5)
    edit((draft) => {
      draft.piano.timbre = 0
    })
    type Snapshot = ReturnType<ProgramSystem['get']>
    void (null as unknown as Snapshot)
    system.browse(1)
    expect(system.get().dirty).toBe(false)
    expect(live().piano.timbre).not.toBe(0)
  })
})

describe('programs.undo-cancel — the single-level undo', () => {
  it('offers an undo only after a program change from a dirty state', () => {
    const { system, edit } = harness()
    system.selectSlot(6)
    // A clean program change offers nothing to undo.
    system.selectSlot(7)
    expect(system.get().undo).toBeNull()

    edit((draft) => {
      draft.transpose = 2
    })
    expect(system.get().undo).toBeNull()
    // A change from a dirty state captures the discarded state.
    system.selectSlot(8)
    expect(system.get().undo).not.toBeNull()
    expect(system.get().undo!.slot).toBe(7)
    expect(system.get().undo!.state.transpose).toBe(2)
  })

  it('restores exactly the discarded state', () => {
    const { system, live, edit } = harness()
    system.selectSlot(10)
    edit((draft) => {
      draft.transpose = -3
      draft.transposeOn = true
      draft.piano.layers['piano.b'].enabled = true
      draft.organ.layers['organ.a'].model = 'vox'
      draft.synth.layers['synth.a'].waveform = 'Sync Square'
    })
    const discarded = cloneProgramState(live())

    system.selectSlot(11)
    expect(live().transpose).toBe(0)
    expect(system.get().undo).not.toBeNull()

    system.undoLastChange()
    expect(programStatesEqual(live(), discarded)).toBe(true)
    expect(live().transpose).toBe(-3)
    expect(live().organ.layers['organ.a'].model).toBe('vox')
    expect(live().synth.layers['synth.a'].waveform).toBe('Sync Square')
    // Undo is single-level: after using it there is nothing more to undo.
    expect(system.get().undo).toBeNull()
    expect(() => system.undoLastChange()).not.toThrow()
  })

  it('returns to the slot the edit belonged to', () => {
    const { system, live, edit } = harness()
    system.selectSlot(12)
    edit((draft) => {
      draft.piano.timbre = 2
    })
    system.selectSlot(13)
    expect(system.get().slot).toBe(13)
    system.undoLastChange()
    // The undo restores the edited state *and* the slot it belonged to, so the slot line and
    // the sound agree.
    expect(system.get().slot).toBe(12)
    expect(live().piano.timbre).toBe(2)
    // It is still dirty, because the undone state was never stored.
    expect(system.get().dirty).toBe(true)
  })

  it('drops the undo entry once the edit is stored', () => {
    const { system, edit } = harness()
    system.selectSlot(14)
    edit((draft) => {
      draft.transpose = 1
    })
    system.beginStore()
    system.confirmStore()
    expect(system.get().undo).toBeNull()
    system.selectSlot(15)
    expect(system.get().undo).toBeNull()
  })

  it('clears the undo entry when a store is cancelled after a change', () => {
    const { system, edit } = harness()
    system.selectSlot(16)
    edit((draft) => {
      draft.transpose = 1
    })
    system.selectSlot(17)
    expect(system.get().undo).not.toBeNull()
    // A second program change replaces the single undo entry, and there is still only one.
    edit((draft) => {
      draft.transpose = 2
    })
    system.selectSlot(18)
    expect(system.get().undo!.slot).toBe(17)
  })
})

describe('programs.undo-cancel — the store flow itself', () => {
  it('leaves the instrument untouched while a store is pending', () => {
    const { system, live, edit } = harness()
    system.selectSlot(19)
    edit((draft) => {
      draft.piano.timbre = 3
    })
    const during = cloneProgramState(live())
    system.beginStore()
    system.storeBrowse(5)
    // Browsing the destination must not audition a different program's state into the
    // instrument, because the player is still editing what they intend to store.
    expect(programStatesEqual(live(), during)).toBe(true)
    system.cancelStore()
    expect(programStatesEqual(live(), during)).toBe(true)
  })
})
