import { describe, expect, it } from 'vitest'
import {
  createFactoryBank,
  createLiveSlots,
  createMemoryStorage,
  createProgramSystem,
  PROGRAM_SLOTS,
  LIVE_SLOTS,
  type ProgramSystem,
} from '../audio/programStore'
import {
  cloneProgramState,
  defaultProgramState,
  programStatesEqual,
  serializeProgram,
  type ProgramState,
} from '../audio/programState'
import type { LayerId } from '../audio/types'

/**
 * programs.roundtrip — storing and re-loading any of the 32 slots restores **all** supported
 * state, and the dirty indicator is truthful.
 *
 * The test harness is deliberately the production one: a `live` state object stands in for
 * the instrument's stores, and the program system reads and writes it through the same
 * `read`/`write` pair the app injects. That means "round-trips" is measured on the state the
 * instrument would actually play, not on a copy kept for the test's convenience.
 */

interface Harness {
  system: ProgramSystem
  /** The instrument's live state. */
  live: () => ProgramState
  /** Applies an edit as the panel would. */
  edit: (mutate: (draft: ProgramState) => void) => void
}

function harness(options: { slot?: number; storage?: ReturnType<typeof createMemoryStorage> } = {}): Harness {
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
      system.refresh()
    },
  }
}

/** A distinctive edit in every area of the canonical state. */
function editEverything(draft: ProgramState): void {
  // Piano
  draft.piano.sectionOn = true
  draft.piano.focused = 'piano.b'
  draft.piano.layers['piano.b'].enabled = true
  draft.piano.layers['piano.b'].level = 37
  draft.piano.layers['piano.b'].octave = -12
  draft.piano.layers['piano.b'].type = 'electric'
  draft.piano.layers['piano.b'].model = 'electric.wurlitzer'
  draft.piano.timbre = 4
  draft.piano.kbTouch = 0
  draft.piano.dynComp = 2
  draft.piano.unison = 3
  draft.piano.softRelease = true
  draft.piano.stringRes = true
  // Organ
  draft.organ.sectionOn = true
  draft.organ.focused = 'organ.b'
  draft.organ.layers['organ.b'].enabled = true
  draft.organ.layers['organ.b'].level = 44
  draft.organ.layers['organ.b'].model = 'pipe2'
  draft.organ.layers['organ.b'].drawbars = [3, 1, 4, 1, 5, 9, 2, 6, 5]
  draft.organ.layers['organ.b'].percussion = { on: true, soft: true, fast: true, third: true, poly: true }
  draft.organ.layers['organ.b'].vibratoOn = true
  draft.organ.layers['organ.b'].vibratoType = 'V2'
  draft.organ.layers['organ.b'].octave = 12
  // Synth
  draft.synth.sectionOn = true
  draft.synth.focused = 'synth.c'
  draft.synth.layers['synth.c'].enabled = true
  draft.synth.layers['synth.c'].level = 61
  draft.synth.layers['synth.c'].waveform = 'FM 2-op (algorithm A)'
  draft.synth.layers['synth.c'].oscCtrl = 7.3
  draft.synth.layers['synth.c'].filterType = 'BP'
  draft.synth.layers['synth.c'].filterFreq = 2.2
  draft.synth.layers['synth.c'].filterRes = 8.1
  draft.synth.layers['synth.c'].voiceMode = 'Legato'
  draft.synth.layers['synth.c'].glide = 6
  draft.synth.layers['synth.c'].unison = 2
  draft.synth.layers['synth.c'].lfo.waveform = 'Sample & Hold'
  draft.synth.layers['synth.c'].lfo.destinations.filter = true
  draft.synth.layers['synth.c'].ampEnv = { attack: 2.5, decay: 8, release: 6.5, velocity: 0.4, amount: 0 }
  draft.synth.layers['synth.c'].arp = {
    mode: 'Arp',
    run: true,
    rate: 3.5,
    range: 7,
    direction: 'Up/Down',
    hold: true,
    clockSync: false,
  }
  // Effects: every chain gets something different, so a lost chain is caught.
  draft.effects.allOn = false
  draft.effects.focus = 'synth'
  draft.effects.focusedLayer = 'synth.c'
  draft.effects.pianoGroup = true
  draft.effects.chains['piano.a'].mod1 = { on: true, type: 'Ring Mod', rate: 7, amount: 9 }
  draft.effects.chains['piano.b'].mod2 = { on: true, type: 'Flanger', rate: 2, amount: 6 }
  draft.effects.chains.organ.delay = {
    on: true,
    tempo: 8,
    feedback: 4,
    dryWet: 5,
    filter: 'BP',
    pingPong: true,
    tapSeconds: 0.21,
    global: false,
  }
  draft.effects.chains['synth.a'].ampEq = {
    on: true,
    model: 'Twin',
    drive: 6,
    bass: -3,
    mid: 4,
    midFreq: 7,
    treble: -2,
  }
  draft.effects.chains['synth.b'].compressor = { on: true, amount: 8, fast: true, global: true }
  draft.effects.chains['synth.c'].reverb = { on: true, type: 'Cathedral', dryWet: 9, tone: 'Dark', global: false }
  draft.effects.rotary = { on: true, speed: 'Fast', drive: 8, organRouted: true }
  // Routing: a split with a crossfade and non-default zones.
  draft.split.on = true
  draft.split.points.Low = { position: 'F2', crossfade: 6 }
  draft.split.points.Mid = { position: 'C5', crossfade: 12 }
  draft.split.points.High = { position: 'F6', crossfade: 0 }
  for (const layer of Object.keys(draft.split.zones) as LayerId[]) {
    draft.split.zones[layer] = [true, false, true, false]
  }
  // Scenes: different enable states, deliberately.
  draft.scenes.second = true
  draft.scenes.sceneI['piano.a'] = true
  draft.scenes.sceneI['synth.a'] = false
  draft.scenes.sceneII['piano.a'] = false
  draft.scenes.sceneII['synth.a'] = true
  // Morphs: one increasing, one decreasing.
  draft.morph.wheel = [
    { controlId: 'piano.layer.a.level', start: 25, end: 95 },
    { controlId: 'synth.filter.freq', start: 8, end: 2 },
  ]
  draft.morph.pedal = [{ controlId: 'effects.reverb.dry-wet', start: 0, end: 7.5 }]
  draft.morph.wheelPosition = 0.4
  draft.morph.pedalPosition = 0.75
  // Clock and transpose.
  draft.clock.bpm = 97
  draft.clock.keyboardSync = false
  draft.clock.sync = { arp: false, lfo: true, delay: true, mod1: false }
  draft.transpose = -5
  draft.transposeOn = true
}

describe('programs.roundtrip — every slot restores all supported state', () => {
  it('round-trips a fully edited state through a store and a re-load', () => {
    const { system, live, edit } = harness()
    // Select the destination first: a program change deliberately discards unsaved edits,
    // so editing before selecting would be testing the discard rule instead of the store.
    system.selectSlot(7)
    edit(editEverything)
    const intended = cloneProgramState(live())
    expect(system.get().dirty).toBe(true)

    system.beginStore()
    system.confirmStore()
    expect(system.get().slot).toBe(7)
    expect(system.get().dirty).toBe(false)

    system.selectSlot(19)
    expect(programStatesEqual(live(), intended)).toBe(false)

    // Read it back.
    system.selectSlot(7)
    expect(programStatesEqual(live(), intended)).toBe(true)

    // And assert field by field, so a silently dropped area cannot hide behind an
    // equality helper that was itself wrong.
    const restored = live()
    expect(restored.piano.layers['piano.b'].model).toBe('electric.wurlitzer')
    expect(restored.piano.layers['piano.b'].level).toBe(37)
    expect(restored.piano.layers['piano.b'].octave).toBe(-12)
    expect(restored.piano.unison).toBe(3)
    expect(restored.piano.timbre).toBe(4)
    expect(restored.organ.layers['organ.b'].drawbars).toEqual([3, 1, 4, 1, 5, 9, 2, 6, 5])
    expect(restored.organ.layers['organ.b'].model).toBe('pipe2')
    expect(restored.organ.layers['organ.b'].percussion.poly).toBe(true)
    expect(restored.organ.layers['organ.b'].vibratoType).toBe('V2')
    expect(restored.synth.layers['synth.c'].waveform).toBe('FM 2-op (algorithm A)')
    expect(restored.synth.layers['synth.c'].filterType).toBe('BP')
    expect(restored.synth.layers['synth.c'].voiceMode).toBe('Legato')
    expect(restored.synth.layers['synth.c'].lfo.waveform).toBe('Sample & Hold')
    expect(restored.synth.layers['synth.c'].arp.direction).toBe('Up/Down')
    expect(restored.synth.layers['synth.c'].arp.hold).toBe(true)
    expect(restored.effects.chains['piano.a'].mod1.type).toBe('Ring Mod')
    expect(restored.effects.chains['piano.b'].mod2.type).toBe('Flanger')
    expect(restored.effects.chains.organ.delay.pingPong).toBe(true)
    expect(restored.effects.chains['synth.a'].ampEq.model).toBe('Twin')
    expect(restored.effects.chains['synth.b'].compressor.global).toBe(true)
    expect(restored.effects.chains['synth.c'].reverb.type).toBe('Cathedral')
    expect(restored.effects.rotary.speed).toBe('Fast')
    expect(restored.effects.allOn).toBe(false)
    expect(restored.split.points.Mid).toEqual({ position: 'C5', crossfade: 12 })
    expect(restored.split.zones['synth.b']).toEqual([true, false, true, false])
    expect(restored.scenes.sceneII['synth.a']).toBe(true)
    expect(restored.scenes.sceneI['piano.a']).toBe(true)
    expect(restored.morph.wheel).toHaveLength(2)
    expect(restored.morph.pedal).toHaveLength(1)
    expect(restored.morph.wheelPosition).toBeCloseTo(0.4, 5)
    expect(restored.clock.bpm).toBe(97)
    expect(restored.clock.sync.lfo).toBe(true)
    expect(restored.transpose).toBe(-5)
    expect(restored.transposeOn).toBe(true)
  })

  it('round-trips through all 32 slots independently', () => {
    const { system, live, edit } = harness()
    // Give each slot a different, recognisable transpose and a different piano level.
    for (let slot = 1; slot <= PROGRAM_SLOTS; slot += 1) {
      system.selectSlot(slot)
      edit((draft) => {
        draft.transpose = (slot % 13) - 6
        draft.piano.layers['piano.a'].level = 10 + slot
        draft.synth.layers['synth.a'].waveform = slot % 2 === 0 ? 'Super Saw' : 'Multi Saw'
      })
      system.beginStore()
      system.confirmStore()
      expect(system.get().dirty).toBe(false)
    }
    // Now read every slot back and check it carries its own values.
    for (let slot = 1; slot <= PROGRAM_SLOTS; slot += 1) {
      system.selectSlot(slot)
      const state = live()
      expect(state.transpose, `slot ${slot} transpose`).toBe((slot % 13) - 6)
      expect(state.piano.layers['piano.a'].level, `slot ${slot} level`).toBe(10 + slot)
      expect(state.synth.layers['synth.a'].waveform, `slot ${slot} waveform`).toBe(
        slot % 2 === 0 ? 'Super Saw' : 'Multi Saw',
      )
      expect(system.get().dirty, `slot ${slot} dirty`).toBe(false)
    }
  })

  it('does not store Master Level, which is a performance control', () => {
    const { system, live, edit } = harness()
    system.selectSlot(3)
    // Master Level is not part of a program, so changing it must not make the program dirty.
    edit((draft) => {
      draft.piano.masterLevel = 12
    })
    expect(system.get().dirty).toBe(false)
    // Storing and re-loading leaves the live master level alone: the knob is not a program
    // value, so the program change neither stores nor restores it.
    system.beginStore()
    system.confirmStore()
    expect(system.get().dirty).toBe(false)
    system.selectSlot(9)
    edit((draft) => {
      draft.piano.masterLevel = 99
    })
    expect(live().piano.masterLevel).toBe(99)
    system.selectSlot(3)
    // The program load writes the program, which has no master level, so the live knob keeps
    // whatever the player left it at rather than jumping to a value the program never held.
    expect(live().piano.masterLevel).toBe(12)
  })

  it('survives a serialize/restore cycle of the whole bank', () => {
    const { system, live, edit } = harness()
    system.selectSlot(5)
    edit(editEverything)
    system.beginStore()
    system.confirmStore()
    const text = system.serialize()
    expect(text.length).toBeGreaterThan(1000)

    // A fresh system restored from the text plays the same program.
    let live2 = defaultProgramState()
    const second = createProgramSystem({
      read: () => live2,
      write: (state) => {
        live2 = cloneProgramState(state)
      },
    })
    second.selectSlot(28)
    second.restore(text)
    second.selectSlot(5)
    expect(programStatesEqual(live2, live())).toBe(true)
  })
})

describe('programs.roundtrip — the dirty indicator is truthful', () => {
  it('is clean on load and dirty after exactly one edit', () => {
    const { system, edit } = harness()
    system.selectSlot(2)
    expect(system.get().dirty).toBe(false)

    edit((draft) => {
      draft.piano.layers['piano.a'].level += 1
    })
    expect(system.get().dirty).toBe(true)

    // Undoing the edit by hand makes it clean again, because dirty is a comparison.
    edit((draft) => {
      draft.piano.layers['piano.a'].level -= 1
    })
    expect(system.get().dirty).toBe(false)
  })

  it('notices an edit in every area of the state', () => {
    const cases: Array<[string, (draft: ProgramState) => void]> = [
      ['piano layer level', (draft) => { draft.piano.layers['piano.a'].level = 11 }],
      ['piano type', (draft) => { draft.piano.layers['piano.a'].type = 'clav' }],
      ['organ drawbar', (draft) => { draft.organ.layers['organ.a'].drawbars[0] = 1 }],
      ['organ model', (draft) => { draft.organ.layers['organ.a'].model = 'vox' }],
      ['synth waveform', (draft) => { draft.synth.layers['synth.a'].waveform = 'Saw' }],
      ['synth filter', (draft) => { draft.synth.layers['synth.a'].filterFreq = 1.1 }],
      ['effect chain', (draft) => { draft.effects.chains['piano.a'].reverb.on = true }],
      ['rotary', (draft) => { draft.effects.rotary.drive = 9.9 }],
      ['split point', (draft) => { draft.split.points.High.position = 'C7' }],
      ['zone', (draft) => { draft.split.zones['organ.a'] = [false, true, false, true] }],
      ['scene', (draft) => {
        // A scene only stores enable state, so toggling the *active* scene changes which
        // configuration applies — a real program edit.
        draft.scenes.second = !draft.scenes.second
      }],
      ['morph', (draft) => { draft.morph.wheel = [{ controlId: 'piano.layer.a.level', start: 1, end: 2 }] }],
      ['clock', (draft) => { draft.clock.bpm = 121 }],
      ['transpose', (draft) => { draft.transpose = 1 }],
    ]
    for (const [label, mutate] of cases) {
      const { system, edit } = harness()
      system.selectSlot(3)
      expect(system.get().dirty, `${label}: clean before`).toBe(false)
      edit(mutate)
      expect(system.get().dirty, `${label}: dirty after`).toBe(true)
    }
  })

  it('stays clean for an edit that changes nothing', () => {
    const { system, edit } = harness()
    system.selectSlot(2)
    edit((draft) => {
      // A write of the value the program already holds, which is what a knob that is moved
      // and put back does. Reading it into a local first keeps the intent explicit.
      const current = draft.piano.layers['piano.a'].level
      draft.piano.layers['piano.a'].level = current
    })
    expect(system.get().dirty).toBe(false)
  })

  it('ignores revision counters, which change without any value changing', () => {
    const { system, live, edit } = harness()
    system.selectSlot(2)
    const before = live()
    edit(() => {})
    // `writeProgramState` in the app bumps revisions on every clone; the comparison must
    // not treat that as an edit.
    expect(live().piano.revision).toBeGreaterThan(before.piano.revision)
    expect(system.get().dirty).toBe(false)
  })
})
