import { describe, expect, it } from 'vitest'
import { peak } from '../audio/offline'
import { engineRig } from '../test/engineRig'
import { zoneGain } from '../audio/pianoEngine'
import {
  applySnapshot,
  bpmFromTaps,
  currentSnapshot,
  deckReducer,
  initialDeckState,
  isDirty,
  morphedValues,
  snapshotOf,
  storedProgram,
  zoneCount,
  type DeckState,
  type HardwareAction,
} from './hardware'
import { deriveSettings, zoneSettingsFor } from './settings'
import {
  LIVE_SLOTS,
  LIVE_STORAGE_KEY,
  PROGRAM_SLOTS,
  SPLIT_POSITIONS,
  readLiveSlots,
  slotLabel,
  snapshotsEqual,
  writeLiveSlots,
  type SnapshotStore,
} from './program'
import { FACTORY_PATCHES } from './factory'

/**
 * The program and performance system.
 *
 * Features: program.storage, program.dirty, program.live, program.split, program.scenes,
 * program.morph, program.clock, program.transpose, program.panic
 */

function run(actions: HardwareAction[], from: DeckState = initialDeckState()): DeckState {
  return actions.reduce(deckReducer, from)
}

const press = (id: string, at?: number): HardwareAction => ({ type: 'activate', id, at })
const set = (id: string, value: number): HardwareAction => ({ type: 'set', id, value })
const nudge = (id: string, steps: number): HardwareAction => ({ type: 'nudge', id, steps })
const shift = press('program.shift')

describe('program storage', () => {
  it('ships a factory bank of at least eight programs across the four pages of eight', () => {
    const deck = initialDeckState()
    expect(deck.programs).toHaveLength(PROGRAM_SLOTS)
    expect(deck.live).toHaveLength(LIVE_SLOTS)
    const stored = deck.programs.filter((program) => program !== null)
    expect(stored.length).toBeGreaterThanOrEqual(8)
    expect(stored.map((program) => program!.name)).toEqual(FACTORY_PATCHES.map((patch) => patch.name))
    expect(slotLabel(0)).toBe('1.1')
    expect(slotLabel(9)).toBe('2.2')
    expect(slotLabel(31)).toBe('4.8')
    // Slot 1.1 is exactly the panel's printed power-up state.
    expect(snapshotsEqual(deck.programs[0], snapshotOf(deck, deck.programs[0]!.name))).toBe(true)
  })

  it('round-trips every supported piece of state through store and recall', () => {
    const edited = run([
      press('organ.section-on'),
      press('organ.model'),
      set('organ.drawbar.4', 7),
      press('organ.perc.on'),
      press('synth.section-on'),
      set('synth.filter.freq', 8.4),
      press('synth.voice.mode'),
      press('piano.type'),
      set('piano.a.level', 3.3),
      press('fx.reverb.on'),
      set('fx.reverb.dry-wet', 9),
      press('program.split'),
      press('program.layer-scene'),
      press('program.transpose'),
      nudge('program.dial', 3),
    ])
    const before = deriveSettings(edited)
    const snapshot = snapshotOf(edited, 'Grand Piano')

    // Store into slot 2.1, move away to a factory program, then come back.
    // STORE keeps the current name; STORE AS is what renames (manual p. 13, 41). The page
    // buttons are used to navigate here because the dial is busy setting Transpose.
    const stored = run([press('program.store'), press('program.page-right'), press('program.store')], edited)
    expect(stored.slot).toBe(8)
    expect(stored.programs[8]?.name).toBe('Grand Piano')

    const elsewhere = run([press('program.page-left')], stored)
    expect(elsewhere.slot).toBe(0)
    const back = run([press('program.page-right')], elsewhere)
    expect(snapshotsEqual(snapshotOf(back, 'Grand Piano'), snapshot)).toBe(true)
    expect(deriveSettings(back)).toEqual(before)
  })

  it('reports a truthful dirty indicator and discards edits on program change', () => {
    const deck = initialDeckState()
    expect(isDirty(deck)).toBe(false)
    const edited = run([set('piano.a.level', 2)], deck)
    expect(isDirty(edited)).toBe(true)
    expect(edited.values['piano.a.level']).toBe(2)

    // Selecting another program and coming back discards the unstored edit (manual p. 13).
    const moved = run([nudge('program.dial', 1)], edited)
    expect(isDirty(moved)).toBe(false)
    const returned = run([nudge('program.dial', -1)], moved)
    expect(returned.values['piano.a.level']).toBe(8)
    expect(isDirty(returned)).toBe(false)
  })

  it('arms STORE, auditions the destination, confirms on the second press and cancels on SHIFT', () => {
    const edited = run([set('fx.reverb.dry-wet', 9.5)])
    const armed = run([press('program.store')], edited)
    expect(armed.storeStage).toBe('destination')
    expect(armed.storeDestination).toBe(0)

    // Browsing the destination auditions it: the panel takes on the destination's sound.
    const browsing = run([nudge('program.dial', 2)], armed)
    expect(browsing.storeDestination).toBe(2)
    expect(browsing.values['organ.section-on']).toBe(1)

    // SHIFT cancels without writing anything.
    const cancelled = run([shift, press('program.store')], browsing)
    expect(cancelled.storeStage).toBe('idle')
    expect(cancelled.programs[2]?.name).toBe('B3 Perc Fast')

    const confirmed = run([press('program.store')], browsing)
    expect(confirmed.storeStage).toBe('idle')
    expect(confirmed.slot).toBe(2)
    expect(confirmed.programs[2]?.values['fx.reverb.dry-wet']).toBe(9.5)
  })

  it('names a program with STORE AS before choosing the destination', () => {
    const naming = run([shift, press('program.store')])
    expect(naming.storeStage).toBe('naming')
    const typed = run(
      [
        nudge('program.dial', 20),
        press('program.page-right'),
        nudge('program.dial', 15),
        press('program.page-right'),
        nudge('program.dial', 40),
      ],
      { ...naming, nameDraft: '', nameCursor: 0 },
    )
    expect(typed.nameDraft.length).toBeGreaterThanOrEqual(3)
    const stored = run([press('program.store'), nudge('program.dial', 5), press('program.store')], typed)
    expect(stored.programs[5]?.name).toBe(typed.nameDraft.trim())
  })

  it('auto-stores every edit in Live mode and restores the slots from storage', () => {
    const live = run([press('program.live-mode')])
    expect(live.liveMode).toBe(true)
    const edited = run([set('piano.a.level', 4.2)], live)
    expect(edited.live[0]?.values['piano.a.level']).toBe(4.2)
    // A Live slot is never dirty: the edit is already stored.
    expect(isDirty(edited)).toBe(false)

    const moved = run([press('program.slot.3')], edited)
    expect(moved.liveSlot).toBe(2)
    const back = run([press('program.slot.1')], moved)
    expect(back.values['piano.a.level']).toBe(4.2)

    // Persistence round trip through the injectable storage boundary.
    const memory = new Map<string, string>()
    const store: SnapshotStore = {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => void memory.set(key, value),
    }
    writeLiveSlots(store, edited.live)
    expect(memory.has(LIVE_STORAGE_KEY)).toBe(true)
    const restored = readLiveSlots(store)
    expect(restored).toHaveLength(LIVE_SLOTS)
    expect(snapshotsEqual(restored[0], edited.live[0])).toBe(true)

    const reloaded = run([{ type: 'live-restore', slots: restored }, press('program.live-mode'), press('program.slot.1')])
    expect(reloaded.values['piano.a.level']).toBe(4.2)
    // Unreadable storage falls back to empty slots instead of inventing content.
    expect(readLiveSlots(null).every((slot) => slot === null)).toBe(true)
  })

  it('addresses all 32 slots with the page buttons and the eight program buttons', () => {
    const paged = run([press('program.page-right'), press('program.page-right'), press('program.slot.6')])
    expect(paged.slot).toBe(2 * 8 + 5)
    expect(slotLabel(paged.slot)).toBe('3.6')
    const wrapped = run([press('program.page-left'), press('program.page-left'), press('program.page-left')], paged)
    expect(wrapped.slot).toBe(5)
    // The dial browses programs one slot at a time, in both directions.
    const dialled = run([nudge('program.dial', 5)])
    expect(dialled.slot).toBe(5)
    expect(slotLabel(dialled.slot)).toBe('1.6')
    const backwards = run([nudge('program.dial', -3)], dialled)
    expect(backwards.slot).toBe(2)
    expect(backwards.values['organ.section-on']).toBe(1)

    // SHIFT + the dial opens and closes the numeric list view.
    const listed = run([shift, press('program.dial')])
    expect(listed.listView).toBe(true)
    // The printed PROG VIEW button reaches the same list and reports itself.
    const byButton = run([press('program.prog-view')])
    expect(byButton.listView).toBe(true)
    expect(byButton.values['program.prog-view']).toBe(1)
    const closed = run([shift, press('program.dial')], listed)
    expect(closed.listView).toBe(false)
    // Browsing still works while the list is open, which is what the list is for.
    const browsed = run([nudge('program.dial', 4)], listed)
    expect(browsed.listView).toBe(true)
    expect(slotLabel(browsed.slot)).toBe('1.5')
  })
})

describe('splits, zones and crossfades', () => {
  it('turns on a single Mid split at C4 and edits point and crossfade from the panel', () => {
    const on = run([press('program.split')])
    expect(on.split.on).toBe(true)
    expect(on.split.points[1]).toEqual({ note: 60, crossfade: 0, enabled: true })
    expect(on.split.points.filter((point) => point.enabled)).toHaveLength(1)

    // SHIFT + SPLIT steps the editor through Low, Mid and High.
    const editing = run([shift, press('program.split'), shift, press('program.split')], on)
    expect(editing.splitEdit).toBe(2)
    const moved = run([nudge('program.dial', 2)], editing)
    expect(moved.split.points[1].note).toBe(SPLIT_POSITIONS[SPLIT_POSITIONS.indexOf(60) + 2])
    const faded = run([press('program.page-right')], moved)
    expect(faded.split.points[1].crossfade).toBe(6)
    const wider = run([press('program.page-right')], faded)
    expect(wider.split.points[1].crossfade).toBe(12)
  })

  it('assigns a layer to a zone with SHIFT and routes notes by keyboard position', () => {
    const split = run([press('program.split')])
    const assigned = run([shift, press('piano.a.on')], split)
    expect(assigned.zones['piano.a']).toEqual({ from: 0, to: 0 })
    const lower = zoneSettingsFor(assigned, 'piano.a')
    expect(lower.low).toBe(0)
    expect(lower.high).toBe(59)
    expect(zoneGain(lower, 48)).toBe(1)
    expect(zoneGain(lower, 72)).toBe(0)

    const upper = run([shift, press('piano.a.on')], assigned)
    expect(upper.zones['piano.a']).toEqual({ from: 1, to: 1 })
    const high = zoneSettingsFor(upper, 'piano.a')
    expect(zoneGain(high, 48)).toBe(0)
    expect(zoneGain(high, 72)).toBe(1)
  })

  it('fades across the split instead of switching when a crossfade is set', () => {
    const split = run([press('program.split'), shift, press('program.split'), shift, press('program.split')])
    const faded = run([press('program.page-right'), press('program.page-right')], split)
    expect(faded.split.points[1].crossfade).toBe(12)
    const assigned = run([shift, press('piano.a.on')], faded)
    const zone = zoneSettingsFor(assigned, 'piano.a')
    expect(zoneGain(zone, 40)).toBe(1)
    expect(zoneGain(zone, 59)).toBeGreaterThan(0)
    expect(zoneGain(zone, 59)).toBeLessThan(1)
    expect(zoneGain(zone, 80)).toBe(0)
  })

  it('offers exactly the eleven documented split positions and reaches every one of them', () => {
    expect(SPLIT_POSITIONS).toEqual([36, 41, 48, 53, 60, 65, 72, 77, 84, 89, 96])
    const editing = run([press('program.split'), shift, press('program.split'), shift, press('program.split')])
    expect(editing.splitEdit).toBe(2)
    // Walk the Mid point down to the bottom position and back up through all eleven.
    let deck = run([nudge('program.dial', -20)], editing)
    const visited: number[] = [deck.split.points[1].note]
    for (let step = 0; step < SPLIT_POSITIONS.length + 3; step += 1) {
      deck = run([nudge('program.dial', 1)], deck)
      visited.push(deck.split.points[1].note)
    }
    expect([...new Set(visited)].sort((a, b) => a - b)).toEqual([...SPLIT_POSITIONS])
    // The ends are stops, not wraps: the point cannot leave the documented list.
    expect(deck.split.points[1].note).toBe(96)
  })

  it('builds four zones from the three split points and routes a layer into each', () => {
    // SPLIT ON puts the Mid point at C4; the editor then sets the Low point to F2 and the High
    // point to F5. Setting a point's key is what puts it in play, so three points give four zones.
    const built = run([
      press('program.split'),
      shift,
      press('program.split'),
      nudge('program.dial', -1),
      shift,
      press('program.split'),
      shift,
      press('program.split'),
      nudge('program.dial', 1),
    ])
    const points = built.split.points
    expect(points.filter((point) => point.enabled)).toHaveLength(3)
    expect(points.map((point) => point.note)).toEqual([41, 60, 77])
    expect(zoneCount(built)).toBe(4)

    // The four layers of the four zones: SHIFT + a layer's ON button walks it up the zones.
    const boundaries = [[36, 40], [41, 59], [60, 76], [77, 96]]
    let deck = built
    for (let zone = 0; zone < 4; zone += 1) {
      deck = run([shift, press('piano.a.on')], deck)
      expect(deck.zones['piano.a']).toEqual({ from: zone, to: zone })
      const settings = zoneSettingsFor(deck, 'piano.a')
      const [low, high] = boundaries[zone]
      expect(zoneGain(settings, low)).toBe(1)
      expect(zoneGain(settings, high)).toBe(1)
      if (low > 36) expect(zoneGain(settings, low - 1)).toBe(0)
      if (high < 96) expect(zoneGain(settings, high + 1)).toBe(0)
    }
    // One more press returns the layer to the whole keyboard.
    const whole = run([shift, press('piano.a.on')], deck)
    expect(zoneGain(zoneSettingsFor(whole, 'piano.a'), 36)).toBe(1)
    expect(zoneGain(zoneSettingsFor(whole, 'piano.a'), 96)).toBe(1)
  })

  it('routes real audio by zone: a note outside the layer zone builds no voice', () => {
    const split = run([press('program.split'), shift, press('piano.a.on')])
    const rig = engineRig({ settings: deriveSettings(split) })
    rig.engine.noteOn('low', 48, 0.9)
    expect(rig.engine.activeVoiceCount).toBe(1)
    expect(peak(rig.graph.render(0.3))).toBeGreaterThan(0)

    const silent = engineRig({ settings: deriveSettings(split) })
    silent.engine.noteOn('high', 84, 0.9)
    expect(silent.engine.activeVoiceCount).toBe(0)
    expect(peak(silent.graph.render(0.3))).toBe(0)
  })
})

describe('layer scenes', () => {
  it('keeps two enable configurations and shares every sound parameter', () => {
    const edited = run([set('piano.a.level', 6.5), press('piano.b.on')])
    expect(edited.values['piano.b.on']).toBe(1)

    // Scene II still holds the enable state it was captured with, so B is off over there.
    const sceneTwo = run([press('program.layer-scene')], edited)
    expect(sceneTwo.scene).toBe('II')
    expect(sceneTwo.values['piano.b.on']).toBe(0)
    // Sound parameters are shared, only the enable state differs.
    expect(sceneTwo.values['piano.a.level']).toBe(6.5)

    const organOn = run([press('organ.a.on'), press('organ.a.on')], sceneTwo)
    expect(organOn.values['organ.a.on']).toBe(1)

    const backToOne = run([press('program.layer-scene')], organOn)
    expect(backToOne.scene).toBe('I')
    expect(backToOne.values['piano.b.on']).toBe(1)
    expect(backToOne.values['piano.a.level']).toBe(6.5)

    // And scene II is unchanged when we come back to it.
    const againTwo = run([press('program.layer-scene')], backToOne)
    expect(againTwo.values['piano.b.on']).toBe(0)
  })
})

describe('morphs', () => {
  it('assigns, interpolates, indicates and clears per source', () => {
    const armed = run([press('program.morph.wheel')])
    expect(armed.morphArm).toBe('wheel')
    const assigned = run([set('piano.a.level', 2), set('fx.reverb.dry-wet', 9)], armed)
    expect(assigned.morphs.wheel['piano.a.level']).toEqual({ from: 8, to: 2 })
    expect(assigned.morphs.wheel['fx.reverb.dry-wet']).toEqual({ from: 6.4, to: 9 })

    const done = run([press('program.morph.wheel')], assigned)
    expect(done.morphArm).toBeNull()

    // Halfway up the wheel is halfway between the two ends, for every destination at once.
    const half = run([set('perf.mod-wheel', 0.5)], done)
    const morphed = morphedValues(half)
    expect(morphed['piano.a.level']).toBeCloseTo(5, 6)
    expect(morphed['fx.reverb.dry-wet']).toBeCloseTo(7.7, 6)
    expect(deriveSettings(half).layers.a.level).toBeCloseTo(0.5, 6)

    // One destination can rise while another falls.
    expect(morphed['piano.a.level']).toBeLessThan(8)
    expect(morphed['fx.reverb.dry-wet']).toBeGreaterThan(6.4)

    // SHIFT + the source button clears that source only.
    const pedalArmed = run([press('program.morph.ctrl-pedal'), set('synth.filter.freq', 9)], done)
    expect(Object.keys(pedalArmed.morphs.pedal)).toHaveLength(1)
    const cleared = run([shift, press('program.morph.wheel')], pedalArmed)
    expect(Object.keys(cleared.morphs.wheel)).toHaveLength(0)
    expect(Object.keys(cleared.morphs.pedal)).toHaveLength(1)
  })

  it('drives the Control Pedal source from the virtual pedal', () => {
    const assigned = run([
      press('program.morph.ctrl-pedal'),
      set('synth.filter.freq', 10),
      press('program.morph.ctrl-pedal'),
    ])
    const down = run([{ type: 'pedal', value: 1 }], assigned)
    expect(morphedValues(down)['synth.filter.freq']).toBeCloseTo(10, 6)
    const up = run([{ type: 'pedal', value: 0 }], assigned)
    expect(morphedValues(up)['synth.filter.freq']).toBeCloseTo(6.4, 6)
  })

  it('morphs the rotary speed, which is what the Morph speed position is for', () => {
    const deck = run([press('perf.rotary.speed'), press('perf.rotary.speed'), set('perf.mod-wheel', 1)])
    expect(deck.values['perf.rotary.speed']).toBe(2)
    expect(deriveSettings(deck).rotary.morph).toBe(1)
  })
})

describe('master clock, transpose and panic', () => {
  it('takes a tempo from four or more taps and from the dial', () => {
    expect(bpmFromTaps([0, 500])).toBeNull()
    expect(bpmFromTaps([0, 500, 1000, 1500])).toBe(120)
    expect(bpmFromTaps([0, 250, 500, 750])).toBe(240)
    expect(bpmFromTaps([0, 5000, 10000, 15000])).toBeNull()

    const tapped = run([
      press('program.mst-clk', 0),
      press('program.mst-clk', 500),
      press('program.mst-clk', 1000),
      press('program.mst-clk', 1500),
    ])
    expect(tapped.clock.bpm).toBe(120)
    expect(deriveSettings(tapped).clock.bpm).toBe(120)

    const dialled = run([shift, press('program.mst-clk'), nudge('program.dial', 10)])
    expect(dialled.clockSet).toBe(true)
    expect(dialled.clock.bpm).toBe(130)
  })

  it('transposes within ±6 semitones and only while Transpose is on', () => {
    const off = run([nudge('program.dial', 3)])
    expect(deriveSettings(off).transpose).toBe(0)

    const on = run([press('program.transpose'), nudge('program.dial', 4)])
    expect(on.values['program.transpose']).toBe(1)
    expect(on.transpose).toBe(4)
    expect(deriveSettings(on).transpose).toBe(4)
    const clamped = run([nudge('program.dial', 9)], on)
    expect(clamped.transpose).toBe(6)
    const down = run([nudge('program.dial', -20)], clamped)
    expect(down.transpose).toBe(-6)

    const rig = engineRig({ settings: deriveSettings(on) })
    rig.engine.noteOn('test', 60, 0.9)
    expect(rig.engine.soundingNotes()).toEqual([64])
  })

  it('stops everything on Panic without waiting for a release tail', () => {
    const panicked = run([shift, press('program.transpose')])
    expect(panicked.panicCount).toBe(1)

    const rig = engineRig()
    rig.engine.noteOn('one', 60, 0.9)
    rig.engine.noteOn('two', 64, 0.9)
    rig.engine.setSustain(true)
    expect(rig.engine.activeVoiceCount).toBe(2)
    rig.engine.panic()
    expect(rig.engine.activeVoiceCount).toBe(0)
    expect(rig.engine.sustainEngaged).toBe(false)
    expect(peak(rig.graph.render(0.3))).toBe(0)
  })
})

describe('the snapshot itself', () => {
  it('stores every control except Master Level', () => {
    const snapshot = currentSnapshot(initialDeckState())
    expect(snapshot.values['perf.master-level']).toBeUndefined()
    expect(snapshot.values['piano.a.level']).toBe(8)
    expect(Object.keys(snapshot.banks)).toHaveLength(7)
  })

  it('leaves Master Level alone across a program change', () => {
    const loud = run([set('perf.master-level', 10)])
    const changed = run([nudge('program.dial', 2)], loud)
    expect(changed.values['perf.master-level']).toBe(10)
    expect(deriveSettings(changed).masterLevel).toBe(1)
  })

  it('applies a snapshot back onto a deck without leaking the previous edit', () => {
    const base = initialDeckState()
    const edited = run([set('organ.drawbar.1', 2), press('organ.section-on')], base)
    const restored = applySnapshot(edited, base.programs[0]!)
    expect(restored.values['organ.drawbar.1']).toBe(8)
    expect(restored.values['organ.section-on']).toBe(0)
    expect(storedProgram(restored)?.name).toBe('Grand Piano')
  })
})
