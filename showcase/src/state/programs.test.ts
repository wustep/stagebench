import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PianoEngine } from '../audio/engine'
import { fakeAssetBoundary, fakeAudioBoundary, fakeStorageBoundary } from '../test/fakes'
import { renderApp } from '../test/renderApp'
import { InstrumentStore, programLabel } from './instrument'

/**
 * programs.roundtrip / programs.store-live / programs.undo-cancel /
 * programs.navigation — 32 bank slots (4 pages × 8) plus 8 auto-storing Live
 * slots, store flows with naming, truthful dirty state, persistence through
 * the injectable storage boundary.
 */

describe('programs.roundtrip — store and reload restores supported state', () => {
  it('ships at least 8 factory programs with distinct, honest content', () => {
    const store = new InstrumentStore()
    const { bank, live } = store.getState().programs
    expect(bank).toHaveLength(32)
    expect(live).toHaveLength(8)
    const names = new Set(bank.slice(0, 8).map((slot) => slot.name))
    expect(names.size).toBe(8)
    const distinct = new Set(bank.slice(0, 8).map((slot) => JSON.stringify(slot.snapshot)))
    expect(distinct.size).toBe(8)
    // Factory organ program actually enables the organ.
    const b3 = bank.find((slot) => slot.name === 'Full House B3')!
    expect(b3.snapshot.organ.sectionOn).toBe(true)
    expect(b3.snapshot.organ.toRotary).toBe(true)
  })

  it('edits round-trip through Store: dirty flag, store, reload', () => {
    const store = new InstrumentStore()
    expect(store.getState().programs.dirty).toBe(false)
    store.cycleUnison()
    store.setLayerLevel('A', 80)
    expect(store.getState().programs.dirty).toBe(true)
    store.storePress() // capture + destination = current (1.1)
    store.storePress() // confirm
    expect(store.getState().programs.dirty).toBe(false)
    // Leave and come back: the stored values load.
    store.selectProgram(5)
    expect(store.getState().layers.A.level).toBe(100)
    store.selectProgram(0)
    expect(store.getState().piano.unison).toBe(1)
    expect(store.getState().layers.A.level).toBe(80)
    expect(store.getState().programs.dirty).toBe(false)
  })

  it('system.integration — a program storing synth+organ+piano+splits+scenes+morphs round-trips completely', () => {
    const store = new InstrumentStore()
    // Piano: a non-default layer edit.
    store.setLayerLevel('A', 77)
    store.cycleUnison()
    // Organ: switched on with a registration.
    store.setOrganSectionOn(true)
    store.setOrganDrawbar(0, 6)
    // Split and scenes first: toggling the scene swaps every section's layer
    // enables to its stored configuration, so the synth-layer edits below
    // (which are shared sound parameters, not per-scene) must come after.
    store.toggleSplit()
    store.toggleLayerScene()
    // Synth: all three layers on, voice modes, per-layer chain, and the arp.
    store.setPianoSectionOn(true)
    store.setSynthSectionOn(true)
    store.toggleSynthLayerEnabled('B')
    store.toggleSynthLayerEnabled('C')
    store.setSynthFocusedLayer('B')
    store.cycleSynthVoiceMode() // Poly -> Mono (layer B)
    store.setSynthGlide(55)
    store.cycleSynthUnison() // Off -> 1
    store.cycleSynthVibratoMode() // Off -> On
    store.setSynthFxFocus('B')
    store.updateUnit('reverb', { on: true, mix: 90 }, 'test')
    store.setArpRate(100)
    store.cycleArpMode() // Arp -> Poly
    store.cycleArpDirection() // Up -> Down
    store.setArpRange(80)
    store.toggleArpRun()
    store.toggleKbHold()
    store.recordMorphEdit('wheel', 'delay-mix', 'A', 64, 100)

    const edited = store.getState()
    store.storePress()
    store.storePress() // confirm into the current slot

    // Leave and come back: every captured field survives the round-trip.
    store.selectProgram(edited.programs.current === 0 ? 1 : 0)
    store.selectProgram(edited.programs.current)
    const restored = store.getState()

    expect(restored.layers.A.level).toBe(77)
    expect(restored.piano.unison).toBe(1)
    expect(restored.organ.sectionOn).toBe(true)
    expect(restored.organ.layers.A.drawbars[0]).toBe(6)
    expect(restored.synth.sectionOn).toBe(true)
    expect(restored.synth.layers.B.enabled).toBe(true)
    expect(restored.synth.layers.C.enabled).toBe(true)
    expect(restored.synth.layers.B.voice.mode).toBe('Mono')
    expect(restored.synth.layers.B.voice.glide).toBe(55)
    expect(restored.synth.layers.B.voice.unison).toBe(1)
    expect(restored.synth.layers.B.voice.vibrato).toBe('On')
    expect(restored.synthChains.B.reverb.on).toBe(true)
    expect(restored.synthChains.B.reverb.mix).toBe(90)
    expect(restored.synth.arp.rate).toBe(100)
    expect(restored.synth.arp.mode).toBe('Poly')
    expect(restored.synth.arp.direction).toBe('Down')
    expect(restored.synth.arp.range).toBe(3)
    expect(restored.synth.arp.run).toBe(true)
    expect(restored.kbHold).toBe(true)
    expect(restored.split.on).toBe(true)
    expect(restored.scenes.active).toBe('II')
    expect(restored.morph.wheel).toEqual([{ control: 'delay-mix', layer: 'A', start: 64, end: 100 }])

    // The round-tripped state also drives a real note through the engine
    // without falling back — the system integrates, not just the JSON.
    expect(() => {
      const engine = new PianoEngine(fakeAudioBoundary().boundary, { assets: fakeAssetBoundary() })
      engine.attachStore(store)
      engine.ensureStarted()
      engine.noteOn(60, 0.8)
      engine.noteOff(60)
    }).not.toThrow()
  })

  it('tolerates an old-snapshot payload missing synth/synthChains keys and voice/arp subfields on every slot (SHOWCASE.md iteration 12)', () => {
    // Hand-construct a pre-synth persisted payload: serialize a real store's
    // programs (so every OTHER field stays realistic), then strip the fields
    // a pre-Part-3 snapshot would never have had — the whole `synth` and
    // `synthChains` keys, plus (defensively) any voice/arp subfields — from
    // every one of the 32 bank slots and 8 Live slots.
    const seed = new InstrumentStore()
    const rawBank = seed.getState().programs.bank.map((slot) => {
      const snapshot = JSON.parse(JSON.stringify(slot.snapshot)) as Record<string, unknown>
      delete snapshot.synth
      delete snapshot.synthChains
      return { name: slot.name, snapshot }
    })
    const rawLive = seed.getState().programs.live.map((slot) => {
      const snapshot = JSON.parse(JSON.stringify(slot.snapshot)) as Record<string, unknown>
      delete snapshot.synth
      delete snapshot.synthChains
      return { name: slot.name, snapshot }
    })
    const storage = fakeStorageBoundary({
      'stagebench.programs.v1': JSON.stringify({ version: 1, bank: rawBank, live: rawLive, liveMode: false, current: 5 }),
    })

    // Constructing a new store over that storage restores it immediately —
    // the missing synth/synthChains (and their voice/arp subfields) must be
    // backfilled with defaults (normalizeSynthState/normalizeSynthLayer/
    // cloneSnapshot), not throw or silently degrade.
    expect(() => new InstrumentStore(storage)).not.toThrow()
    const restored = new InstrumentStore(storage)
    expect(restored.getState().synth.layers.A.voice.mode).toBe('Poly')
    expect(restored.getState().synth.layers.A.voice.glide).toBe(0)
    expect(restored.getState().synth.arp.mode).toBe('Arp')
    expect(restored.getState().synth.arp.range).toBe(1)
    expect(restored.getState().synthChains.A.reverb).toBeDefined()
    restored.setPianoSectionOn(false)
    restored.setSynthSectionOn(true)

    const setup = fakeAudioBoundary()
    const engine = new PianoEngine(setup.boundary, { assets: fakeAssetBoundary() })
    engine.attachStore(restored)
    engine.ensureStarted()
    expect(engine.getStatus().status).not.toBe('fallback')
    expect(() => {
      engine.noteOn(60, 0.8)
      engine.noteOff(60)
    }).not.toThrow()
  })

  it('tolerates an old-snapshot payload with `synth` present but every layer missing the newer `mode` field (backfills to Analog)', () => {
    // A snapshot from before Samples mode existed (spec.scope.optional):
    // `synth` and every layer sub-object are present, but `mode` itself is
    // absent from each layer object — narrower than the whole-key-missing
    // case above, and the case normalizeSynthLayer's `...defaults, ...layer`
    // spread must backfill correctly (a present key with an explicit
    // `undefined` value would NOT be backfilled by that spread; deleting the
    // key entirely, as done here, is the actual old-payload shape and IS).
    const seed = new InstrumentStore()
    const strip = (slot: { name: string; snapshot: unknown }) => {
      const snapshot = JSON.parse(JSON.stringify(slot.snapshot)) as { synth: { layers: Record<string, Record<string, unknown>> } }
      for (const layer of Object.values(snapshot.synth.layers)) delete layer.mode
      return { name: slot.name, snapshot }
    }
    const rawBank = seed.getState().programs.bank.map(strip)
    const rawLive = seed.getState().programs.live.map(strip)
    const storage = fakeStorageBoundary({
      'stagebench.programs.v1': JSON.stringify({ version: 1, bank: rawBank, live: rawLive, liveMode: false, current: 2 }),
    })
    expect(() => new InstrumentStore(storage)).not.toThrow()
    const restored = new InstrumentStore(storage)
    expect(restored.getState().synth.layers.A.mode).toBe('Analog')
    expect(restored.getState().synth.layers.B.mode).toBe('Analog')
    expect(restored.getState().synth.layers.C.mode).toBe('Analog')
    expect(() => restored.selectProgram(10)).not.toThrow()
    expect(restored.getState().synth.layers.A.mode).toBe('Analog')
  })

  it('program state excludes Master Level', () => {
    const store = new InstrumentStore()
    store.setMasterVolume(30)
    expect(store.getState().programs.dirty).toBe(false) // not program-captured
    store.selectProgram(3)
    expect(store.getState().masterVolume).toBe(30) // survives program changes
  })

  it('selecting another program discards unsaved edits (manual p. 13)', () => {
    const store = new InstrumentStore()
    store.cycleKbTouch()
    expect(store.getState().piano.kbTouch).toBe(1)
    store.selectProgram(2)
    store.selectProgram(0)
    expect(store.getState().piano.kbTouch).toBe(0) // edit was discarded
  })
})

describe('programs.undo-cancel — single-level undo and store abort', () => {
  it('SOLO UNDO restores the edited state a program change discarded', () => {
    const store = new InstrumentStore()
    store.cycleKbTouch()
    store.selectProgram(4) // discards the edit (kept for undo)
    expect(store.getState().piano.kbTouch).toBe(0)
    store.undoProgramChange()
    expect(store.getState().programs.current).toBe(0)
    expect(store.getState().piano.kbTouch).toBe(1)
    expect(store.getState().programs.dirty).toBe(true)
  })

  it('Shift aborts an ongoing store and restores the edited sound at the origin', () => {
    const store = new InstrumentStore()
    store.setLayerLevel('A', 71)
    store.storePress()
    store.selectProgram(9) // audition destination 2.2
    expect(store.getState().programs.storePending!.destination).toBe(9)
    expect(store.getState().layers.A.level).toBe(100) // hearing the destination
    expect(store.cancelStoreFlow()).toBe(true)
    const state = store.getState()
    expect(state.programs.storePending).toBeNull()
    expect(state.programs.current).toBe(0)
    expect(state.layers.A.level).toBe(71) // edits restored
    expect(state.programs.dirty).toBe(true)
  })

  it('Store As names the program via dial characters and cursor moves', () => {
    const store = new InstrumentStore()
    store.storeAsPress()
    expect(store.getState().programs.naming!.name).toBe('Royal Grand')
    store.dialProgram(2) // dial while naming = character entry at the cursor
    const changed = store.getState().programs.naming!.name
    expect(changed).not.toBe('Royal Grand')
    store.shiftProgramPage(1) // page buttons move the cursor while naming
    expect(store.getState().programs.naming!.cursor).toBe(1)
    store.storePress() // confirm name -> destination step
    const pending = store.getState().programs.storePending!
    expect(pending.captured.name).toBe(changed)
    store.selectProgram(12)
    store.storePress() // confirm
    expect(store.getState().programs.bank[12]!.name).toBe(changed)
    expect(store.getState().programs.current).toBe(12)
  })
})

describe('programs.snapshot-hygiene — loads are complete and latch-free (audit C3/C4/C5)', () => {
  it('a snapshot missing ANY top-level key falls back to power-on defaults, never the previous program', () => {
    // Persist a payload whose slot 1 lacks masterClock/split/morph — the
    // shape of a payload saved before those keys existed.
    const seed = new InstrumentStore()
    const rawBank = seed.getState().programs.bank.map((slot, i) => {
      const snapshot = JSON.parse(JSON.stringify(slot.snapshot)) as Record<string, unknown>
      if (i === 1) {
        delete snapshot.masterClock
        delete snapshot.split
        delete snapshot.morph
      }
      // Slot 2: a masterClock persisted before KBS / Pedal Tap existed.
      if (i === 2) snapshot.masterClock = { bpm: 98 }
      return { name: slot.name, snapshot }
    })
    const rawLive = seed.getState().programs.live.map((slot) => ({ name: slot.name, snapshot: slot.snapshot }))
    const storage = fakeStorageBoundary({
      'stagebench.programs.v1': JSON.stringify({ version: 1, bank: rawBank, live: rawLive, liveMode: false, current: 0 }),
    })
    const store = new InstrumentStore(storage)
    // Make the CURRENT program's values distinctive, then load the stripped slot.
    store.setMasterClockBpm(207)
    store.toggleSplit()
    store.selectProgram(1)
    expect(store.getState().masterClock.bpm).toBe(120) // default, not 207 leaked
    expect(store.getState().split.on).toBe(false) // default, not the previous program's
    expect(store.getState().morph.wheel).toEqual([])
    // A { bpm }-only masterClock (pre-KBS payload) backfills the new fields.
    store.selectProgram(2)
    expect(store.getState().masterClock).toEqual({ bpm: 98, kbs: 'Off', pedalTap: false })
  })

  it('edits between the two STORE presses are captured, not silently dropped', () => {
    const store = new InstrumentStore()
    store.storePress() // capture + destination selection
    store.updateUnit('delay', { mix: 111 }, 'Delay Dry/Wet 111') // audible tweak while pending
    store.storePress() // confirm
    expect(store.getState().chains.A.delay.mix).toBe(111)
    store.selectProgram(4)
    store.selectProgram(0)
    expect(store.getState().chains.A.delay.mix).toBe(111) // what was heard is what was stored
  })

  it('a program change drops the transient edit latches', () => {
    const store = new InstrumentStore()
    store.toggleMorphArming('wheel')
    store.setLayerInitEdit(true)
    store.selectProgram(3)
    expect(store.getState().morphArming).toBeNull()
    expect(store.getState().layerInitEdit).toBe(false)
    store.setClockEdit(true)
    store.toggleLiveMode()
    expect(store.getState().clockEdit).toBe(false)
  })

  it('Section Edit and Layer Init (one physical button) are mutually exclusive', () => {
    const store = new InstrumentStore()
    store.setSectionEdit(true)
    store.setLayerInitEdit(true)
    expect(store.getState().sectionEdit).toBe(false)
    expect(store.getState().layerInitEdit).toBe(true)
    store.setSectionEdit(true)
    expect(store.getState().layerInitEdit).toBe(false)
    expect(store.getState().sectionEdit).toBe(true)
  })
})

describe('programs.store-live — Live slots auto-store and persist', () => {
  it('Live mode edits store instantly, without a dirty flag', () => {
    const store = new InstrumentStore()
    store.toggleLiveMode()
    expect(store.getState().programs.liveMode).toBe(true)
    store.cycleUnison()
    expect(store.getState().programs.dirty).toBe(false)
    expect(store.getState().programs.live[0]!.snapshot.piano.unison).toBe(1)
    // Leaving and re-entering Live keeps the edit.
    store.toggleLiveMode()
    store.toggleLiveMode()
    expect(store.getState().piano.unison).toBe(1)
  })

  it('Live edits survive a reload through the storage boundary', () => {
    const storage = fakeStorageBoundary()
    const first = new InstrumentStore(storage)
    first.toggleLiveMode()
    first.selectProgram(2)
    first.cycleDynComp()
    expect(first.getState().programs.live[2]!.snapshot.piano.dynComp).toBe(1)
    // Live auto-store serialization is debounced (performance: it writes all
    // 40 slots); the app flushes on pagehide/visibilitychange, so a "reload"
    // is flush + fresh store over the same storage.
    first.flushPersist()
    const second = new InstrumentStore(storage)
    const programs = second.getState().programs
    expect(programs.liveMode).toBe(true)
    expect(programs.current).toBe(2)
    expect(second.getState().piano.dynComp).toBe(1)
  })

  it('Live-mode edit bursts debounce the storage writes (one trailing save, not one per tick)', () => {
    vi.useFakeTimers()
    try {
      const storage = fakeStorageBoundary()
      let saves = 0
      const counting = { ...storage, save: (key: string, value: string) => (saves++, storage.save(key, value)) }
      const store = new InstrumentStore(counting)
      store.toggleLiveMode()
      saves = 0
      // A knob drag: ~60 snapshot-key edits well inside the debounce window.
      for (let i = 0; i < 60; i++) store.setLayerLevel('A', i)
      expect(saves).toBe(0) // in-memory Live slot is current, storage untouched
      expect(store.getState().programs.live[0]!.snapshot.layers.A.level).toBe(59)
      vi.advanceTimersByTime(350)
      expect(saves).toBe(1) // single trailing write carrying the latest state
      const persisted = JSON.parse(storage.data.get('stagebench.programs.v1')!) as {
        live: Array<{ snapshot: { layers: { A: { level: number } } } }>
      }
      expect(persisted.live[0]!.snapshot.layers.A.level).toBe(59)
      // flushPersist with nothing pending is a no-op.
      store.flushPersist()
      expect(saves).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('Store copies a Live slot into a bank slot (manual p. 44)', () => {
    const store = new InstrumentStore()
    store.toggleLiveMode()
    store.cycleUnison() // auto-stored into L1
    store.storePress() // capture L1 content
    store.toggleLiveMode() // destination bank switches with Live Mode
    store.selectProgram(20)
    store.storePress() // confirm into 3.5
    const state = store.getState()
    expect(state.programs.liveMode).toBe(false)
    expect(state.programs.current).toBe(20)
    expect(state.programs.bank[20]!.snapshot.piano.unison).toBe(1)
  })
})

describe('programs.navigation — buttons, pages, dial, list view', () => {
  it('program buttons select within the page; page buttons move between the four pages', () => {
    const store = new InstrumentStore()
    store.selectProgramButton(4)
    expect(store.getState().programs.current).toBe(4)
    store.shiftProgramPage(1)
    expect(store.getState().programs.current).toBe(12) // page 2, same button
    expect(store.currentProgramLabel()).toBe('A:25')
    store.shiftProgramPage(1)
    store.shiftProgramPage(1)
    store.shiftProgramPage(1) // clamped at page 4
    expect(store.currentProgramLabel()).toBe('A:45')
    store.selectProgramButton(0)
    expect(store.currentProgramLabel()).toBe('A:41')
    expect(programLabel(31, false)).toBe('A:48')
    expect(programLabel(3, true)).toBe('L4')
  })

  it('the dial browses all 32 slots', () => {
    const store = new InstrumentStore()
    store.dialProgram(127)
    expect(store.getState().programs.current).toBe(31)
    store.dialProgram(0)
    expect(store.getState().programs.current).toBe(0)
    expect(store.programDialValue()).toBe(0)
  })

  it('the panel shows program number, name, E flag and the Shift list view', () => {
    renderApp()
    expect(screen.getByTestId('oled-program-line').textContent).toBe('A:11')
    expect(screen.getByTestId('oled-name-line').textContent).toBe('Royal Grand')
    // An edit raises the truthful E flag…
    fireEvent.click(screen.getByRole('button', { name: 'Unison Select' }))
    expect(screen.getByTestId('oled-program-line').textContent).toBe('A:11 E')
    // …and a program change clears it and loads the neighbor.
    fireEvent.click(screen.getByRole('button', { name: 'Program 2' }))
    expect(screen.getByTestId('oled-program-line').textContent).toBe('A:12')
    expect(screen.getByTestId('oled-name-line').textContent).toBe('Tine Stack')
    // Shift + dial opens the numeric list view; dropping Shift closes it.
    fireEvent.click(screen.getByRole('button', { name: 'Shift/Exit' }))
    const dial = screen.getByRole('slider', { name: 'Program Dial' })
    fireEvent.keyDown(dial, { key: 'ArrowUp' })
    expect(screen.getByTestId('oled-list-2').textContent).toContain('Full House B3')
    fireEvent.click(screen.getByRole('button', { name: 'Shift/Exit' }))
    expect(screen.queryByTestId('oled-list-2')).toBeNull()
    expect(screen.getByTestId('oled-piano-line')).toBeInTheDocument()
  })

  it('Live Mode lights its LED and renames the readout to L-slots', () => {
    renderApp()
    const liveButton = screen.getByRole('button', { name: 'Live Mode' })
    fireEvent.click(liveButton)
    expect(liveButton.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('oled-program-line').textContent).toBe('L1')
    fireEvent.click(screen.getByRole('button', { name: 'Program 3' }))
    expect(screen.getByTestId('oled-program-line').textContent).toBe('L3')
    fireEvent.click(liveButton)
    expect(screen.getByTestId('oled-program-line').textContent).toBe('A:11')
  })
})

describe('programs.numpad — Shift + Live Mode two-digit selection (manual p. 44)', () => {
  it('selects page.slot with two presses: first the page digit, then the slot', () => {
    const store = new InstrumentStore()
    store.toggleNumPad()
    expect(store.getState().programs.numPad).toBe(true)
    store.selectProgramButton(1) // digit 2 = page, held pending
    expect(store.getState().programs.numPadPending).toBe(2)
    expect(store.getState().programs.current).toBe(0) // nothing selected yet
    store.selectProgramButton(4) // digit 5 = slot -> 2.5
    expect(store.getState().programs.numPadPending).toBeNull()
    expect(store.currentProgramLabel()).toBe('A:25')
  })

  it('ignores an invalid first digit — this bank has 4 pages, so 5-8 name no page', () => {
    const store = new InstrumentStore()
    store.toggleNumPad()
    store.selectProgramButton(6) // digit 7: no page 7 in a 4-page bank
    expect(store.getState().programs.numPadPending).toBeNull()
    expect(store.getState().programs.current).toBe(0)
    store.selectProgramButton(3) // digit 4 is the last valid page
    expect(store.getState().programs.numPadPending).toBe(4)
  })

  it('clears the pending digit on Shift/Exit and on mode exit', () => {
    const store = new InstrumentStore()
    store.toggleNumPad()
    store.selectProgramButton(0)
    expect(store.getState().programs.numPadPending).toBe(1)
    expect(store.clearNumPadPending()).toBe(true) // Shift/Exit path
    expect(store.getState().programs.numPadPending).toBeNull()
    expect(store.clearNumPadPending()).toBe(false) // nothing pending: no-op
    store.selectProgramButton(2)
    store.toggleNumPad() // leaving the mode drops the half-entered digit
    expect(store.getState().programs.numPad).toBe(false)
    expect(store.getState().programs.numPadPending).toBeNull()
  })

  it('Live programs stay directly selected with 1-8 regardless of Num Pad (manual p. 44)', () => {
    const store = new InstrumentStore()
    store.toggleNumPad()
    store.toggleLiveMode()
    store.selectProgramButton(5)
    expect(store.currentProgramLabel()).toBe('L6')
    expect(store.getState().programs.numPadPending).toBeNull()
  })

  it('panel: Shift + Live Mode toggles Num Pad and the readout shows the pending digit', () => {
    renderApp()
    const liveButton = screen.getByRole('button', { name: 'Live Mode' })
    fireEvent.click(screen.getByRole('button', { name: 'Shift/Exit' }))
    fireEvent.click(liveButton) // NUM PAD on — Live Mode itself must not toggle
    expect(liveButton.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Shift/Exit' })) // drop Shift
    fireEvent.click(screen.getByRole('button', { name: 'Program 3' }))
    expect(screen.getByTestId('oled-program-line').textContent).toBe('A:3–')
    fireEvent.click(screen.getByRole('button', { name: 'Program 2' }))
    expect(screen.getByTestId('oled-program-line').textContent).toBe('A:32')
    // Shift/Exit clears a fresh pending digit instead of latching Shift.
    fireEvent.click(screen.getByRole('button', { name: 'Program 1' }))
    expect(screen.getByTestId('oled-program-line').textContent).toBe('A:1–')
    fireEvent.click(screen.getByRole('button', { name: 'Shift/Exit' }))
    expect(screen.getByTestId('oled-program-line').textContent).toBe('A:32')
    // Plain Live Mode clicks keep working exactly as before.
    fireEvent.click(liveButton)
    expect(liveButton.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('oled-program-line').textContent).toBe('L1')
  })
})

describe('programs.progview — display view modes and Preset Name (manual p. 42)', () => {
  it('cycles the four view modes from the store', () => {
    const store = new InstrumentStore()
    expect(store.getState().programs.progView).toBe(0)
    store.cycleProgView()
    expect(store.getState().programs.progView).toBe(1)
    store.cycleProgView()
    store.cycleProgView()
    expect(store.getState().programs.progView).toBe(3)
    store.cycleProgView()
    expect(store.getState().programs.progView).toBe(0)
  })

  it('Preset Name toggles and resets when a program is loaded (manual p. 42)', () => {
    const store = new InstrumentStore()
    store.togglePresetName()
    expect(store.getState().programs.presetName).toBe(true)
    store.selectProgram(3)
    expect(store.getState().programs.presetName).toBe(false)
    store.togglePresetName()
    store.toggleLiveMode() // switching banks loads a program too
    expect(store.getState().programs.presetName).toBe(false)
  })

  it('panel: Prog View swaps the OLED lower rows per mode', () => {
    renderApp()
    const progViewButton = screen.getByRole('button', { name: 'Prog View' })
    expect(screen.getByTestId('oled-piano-line')).toBeInTheDocument()
    fireEvent.click(progViewButton) // mode 1: large name/number only
    expect(screen.queryByTestId('oled-piano-line')).toBeNull()
    expect(screen.getByTestId('oled-name-line').textContent).toBe('Royal Grand')
    fireEvent.click(progViewButton) // mode 2: full configuration listing
    expect(screen.getByTestId('oled-config-piano').textContent).toContain('A● Salamander Grand')
    expect(screen.getByTestId('oled-config-organ').textContent).toContain('B3')
    expect(screen.getByTestId('oled-config-synth').textContent).toContain('Saw')
    fireEvent.click(progViewButton) // mode 3: the current page's 8 programs
    expect(screen.getByTestId('oled-page-list-0').textContent).toContain('▸ A:11 Royal Grand')
    expect(screen.getByTestId('oled-page-list-7').textContent).toContain('A:18')
    fireEvent.click(progViewButton) // back to mode 0
    expect(screen.getByTestId('oled-piano-line')).toBeInTheDocument()
  })

  it('panel: PRESET NAME (Shift + Prog View) shows source names and resets on program load', () => {
    renderApp()
    expect(screen.getByTestId('oled-piano-line').textContent).toContain('A: Salamander Grand')
    fireEvent.click(screen.getByRole('button', { name: 'Shift/Exit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Prog View' }))
    fireEvent.click(screen.getByRole('button', { name: 'Shift/Exit' })) // drop Shift
    expect(screen.getByTestId('oled-piano-line').textContent).toContain('A: Grand / Salamander Grand')
    // Loading a program resets the Preset Name state (manual p. 42).
    fireEvent.click(screen.getByRole('button', { name: 'Program 2' }))
    expect(screen.getByTestId('oled-piano-line').textContent).not.toContain('Electric / ')
  })
})
