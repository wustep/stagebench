import { describe, expect, it } from 'vitest'
import { FakeScheduler, MemoryStorage } from '../test-utils/fakes'
import { setBpm, setDrawbar, setSplitPoint, setTransposeSemitones, setVibOn } from './edits'
import { assignMorph } from './morph'
import {
  LIVE_COUNT,
  PROGRAM_COUNT,
  PROGRAM_STORAGE_KEY,
  canonical,
  createProgramSystem,
  programOf,
  sanitizeProgram,
  slotLabel,
} from './programs'
import { FACTORY_PROGRAMS } from './factory'
import { createEngineStore, defaultState, setMaster, type EngineState } from './state'

const rig = (storage: MemoryStorage | null = new MemoryStorage()) => {
  const engine = createEngineStore(defaultState())
  const scheduler = new FakeScheduler()
  const programs = createProgramSystem({ engine, storage, scheduler })
  return { engine, scheduler, programs, storage, get snap() { return programs.getSnapshot() }, edit: (fn: (s: EngineState) => EngineState) => engine.update(fn) }
}
const reload = (storage: MemoryStorage) => {
  const r = rig(storage)
  return r
}

describe('programs.navigation — 32 slots in 4 pages of 8, dial browsing, list view', () => {
  it('has 32 program slots and 8 Live slots, at least 8 factory programs, labelled page.button', () => {
    const r = rig()
    expect(PROGRAM_COUNT).toBe(32)
    expect(LIVE_COUNT).toBe(8)
    expect(r.snap.names).toHaveLength(32)
    expect(r.snap.liveNames).toHaveLength(8)
    const factory = FACTORY_PROGRAMS()
    expect(factory.length).toBeGreaterThanOrEqual(8)
    expect(factory.filter((p) => !p.name.startsWith('Init')).length).toBeGreaterThanOrEqual(8)
    expect(slotLabel('program', 0)).toBe('1.1')
    expect(slotLabel('program', 17)).toBe('3.2')
    expect(r.snap.names[17]).toBe('Tine Stack') // the example from the programs spec: 3.2 Tine Stack
    expect(slotLabel('live', 2)).toBe('L3')
  })

  it('the factory demonstrates piano, organ, synth, split, layered, scene and morph setups', () => {
    const list = FACTORY_PROGRAMS()
    const has = (test: (d: ReturnType<typeof programOf>) => boolean) => list.some((p) => test(p.data))
    expect(has((d) => d.layers.A.enabled && !d.organ.layers.A.enabled && !d.synth.A.enabled)).toBe(true)
    expect(has((d) => d.organOn && d.organ.layers.A.enabled)).toBe(true)
    expect(has((d) => d.synthOn && d.synth.A.enabled)).toBe(true)
    expect(has((d) => Object.values(d.split).some((p) => p.active))).toBe(true)
    expect(has((d) => d.layers.A.enabled && d.synth.C.enabled)).toBe(true)
    expect(has((d) => d.scenes[0].layers['piano.A'] !== d.scenes[1].layers['piano.A'])).toBe(true)
    expect(has((d) => d.morph.wheel.length > 0 && d.morph.pedal.length > 0)).toBe(true)
  })

  it('program change from the dial wraps around 32 and follows the page', () => {
    const r = rig()
    r.programs.step(-1)
    expect(r.snap.programIndex).toBe(31)
    expect(r.snap.page).toBe(3)
    r.programs.step(1)
    expect(r.snap.programIndex).toBe(0)
    r.programs.step(9)
    expect(r.snap.slotLabel).toBe('2.2')
    expect(r.snap.page).toBe(1)
  })

  it('page buttons change the page shown on the eight program buttons without changing the program', () => {
    const r = rig()
    r.programs.stepPage(1)
    expect(r.snap.page).toBe(1)
    expect(r.snap.programIndex).toBe(0)
    r.programs.stepPage(-2)
    expect(r.snap.page).toBe(3)
    r.programs.select(r.snap.page * 8 + 4)
    expect(r.snap.programIndex).toBe(28)
    expect(r.snap.name).toBe(r.snap.names[28])
  })

  it('the numeric list view opens on the dial, follows the selection and closes after 5 s', () => {
    const r = rig()
    r.programs.openList()
    expect(r.snap.listView).toBe(true)
    r.programs.step(3)
    expect(r.snap.listCursor).toBe(3)
    expect(r.snap.programIndex).toBe(3)
    r.scheduler.advance(4900)
    expect(r.snap.listView).toBe(true)
    r.scheduler.advance(200)
    expect(r.snap.listView).toBe(false)
    expect(r.programs.pendingTimerCount()).toBe(0)
  })
})

describe('programs.roundtrip — save and load restore all supported state', () => {
  it('loading each of the 32 slots reproduces exactly the stored state', () => {
    const r = rig()
    for (let i = 0; i < PROGRAM_COUNT; i++) {
      r.programs.select(i)
      expect(canonical(programOf(r.engine.get())), `slot ${i}`).toBe(canonical(r.programs.slot('program', i).data))
      expect(r.snap.dirty).toBe(false)
    }
  })

  it('a program stores every supported area: piano, organ, synth, effects, routing, split, scenes, morph, clock, transpose', () => {
    const r = rig()
    r.edit((s) => ({ ...s, layers: { ...s.layers, A: { ...s.layers.A, type: 'Upright' as const, timbre: 'Soft' as const, unison: 2 as const } } }))
    r.edit((s) => setDrawbar({ ...s, organOn: true, organ: { ...s.organ, layers: { ...s.organ.layers, A: { ...s.organ.layers.A, enabled: true } } } }, 4, 3))
    r.edit((s) => setVibOn(s, true))
    r.edit((s) => ({ ...s, synthOn: true, synth: { ...s.synth, B: { ...s.synth.B, enabled: true, patch: { ...s.synth.B.patch, waveform: 11, oscCtrl: 0.77, filter: { ...s.synth.B.patch.filter, type: 'HP' as const, res: 0.9 } } } } }))
    r.edit((s) => ({ ...s, fx: { ...s.fx, A: { ...s.fx.A, reverb: { ...s.fx.A.reverb, on: true, type: 'Cathedral' as const } } }, organFx: { ...s.organFx, delay: { ...s.organFx.delay, on: true, sync: true, division: 5 } } }))
    r.edit((s) => setSplitPoint(s, 'high', { active: true, position: 7, crossfade: 12 }))
    r.edit((s) => ({ ...s, zones: { ...s.zones, 'synth.B': [1, 2] as [number, number] } }))
    r.edit((s) => ({ ...s, morph: assignMorph(s.morph, 'wheel', 'level.piano.A', 0.95, 0.2) }))
    r.edit((s) => setTransposeSemitones(setBpm(s, 143), -3))
    r.edit((s) => ({ ...s, rotary: { ...s.rotary, organ: true, fast: true, stopMode: true } }))
    const before = canonical(programOf(r.engine.get()))
    r.programs.pressStore(false)
    r.programs.storeDestination('program', 20)
    r.programs.pressStore(false) // confirm
    expect(r.snap.programIndex).toBe(20)
    r.programs.select(3) // load something else entirely
    expect(canonical(programOf(r.engine.get()))).not.toBe(before)
    r.programs.select(20)
    expect(canonical(programOf(r.engine.get()))).toBe(before)
    const s = r.engine.get()
    expect(s.layers.A.type).toBe('Upright')
    expect(s.organ.layers.A.drawbars[4]).toBe(3)
    expect(s.synth.B.patch.filter.type).toBe('HP')
    expect(s.morph.wheel).toEqual([{ dest: 'level.piano.A', to: 0.2 }])
    expect(s.clock.bpm).toBe(143)
    expect(s.transpose.semitones).toBe(-3)
    expect(s.split.high).toMatchObject({ active: true, position: 7, crossfade: 12 })
  })

  it('programs survive a reload through storage; Master Level and live performance inputs are not part of a program', () => {
    const r = rig()
    r.edit((s) => setMaster({ ...s, modWheel: 0.4, pitchBend: 0.5 }, 0.31))
    r.edit((s) => setBpm(s, 99))
    r.programs.pressStore(false)
    r.programs.storeDestination('program', 9)
    r.programs.pressStore(false)
    const again = reload(r.storage!)
    again.programs.select(9)
    expect(again.engine.get().clock.bpm).toBe(99)
    expect(again.engine.get().master).toBe(defaultState().master)
    expect(again.engine.get().modWheel).toBe(0)
    expect('master' in programOf(again.engine.get())).toBe(false)
  })

  it('untrusted or older storage is sanitised: unknown keys dropped, wrong types replaced, missing fields defaulted', () => {
    const storage = new MemoryStorage()
    const good = programOf(defaultState())
    const broken = { ...good, clock: { bpm: 'fast' }, layers: 7, extra: 1, organ: { vibMode: 'C3' } }
    storage.setItem(PROGRAM_STORAGE_KEY, JSON.stringify({ v: 1, programs: { 4: { name: 'Broken', data: broken } }, live: [], current: { mode: 'program', programIndex: 4, liveIndex: 0 } }))
    const r = rig(storage)
    expect(r.snap.name).toBe('Broken')
    expect(r.engine.get().clock.bpm).toBe(120)
    expect(r.engine.get().layers.A.enabled).toBe(true)
    expect(r.engine.get().organ.vibMode).toBe('C3')
    expect('extra' in r.engine.get()).toBe(false)
    expect(sanitizeProgram(null)).toEqual(programOf(defaultState()))
    const garbage = new MemoryStorage()
    garbage.setItem(PROGRAM_STORAGE_KEY, '{not json')
    expect(rig(garbage).snap.message).toMatch(/could not be read/)
  })
})

describe('programs.roundtrip — the dirty ("E") indicator is truthful', () => {
  it('editing marks the program edited; undoing the edit by hand clears it; performance inputs never do', () => {
    const r = rig()
    expect(r.snap.dirty).toBe(false)
    r.edit((s) => setBpm(s, 90))
    expect(r.snap.dirty).toBe(true)
    r.edit((s) => setBpm(s, 120))
    expect(r.snap.dirty).toBe(false)
    r.edit((s) => setMaster(s, 0.2))
    r.edit((s) => ({ ...s, modWheel: 1, pedalPos: 0.5, pitchBend: -1 }))
    expect(r.snap.dirty).toBe(false)
  })

  it('a scene change is an edit of the enable state and a change of the active scene', () => {
    const r = rig()
    r.edit((s) => ({ ...s, scene: 1 as const }))
    expect(r.snap.dirty).toBe(true)
  })
})

describe('programs.undo-cancel — edits are discarded on program change; undo restores them once', () => {
  it('selecting another program discards edits and clears the E; the discarded state is what undo restores', () => {
    const r = rig()
    r.edit((s) => setBpm(s, 77))
    r.programs.select(5)
    expect(r.snap.dirty).toBe(false)
    expect(r.engine.get().clock.bpm).toBe(120) // the edit is gone from the sound
    expect(r.snap.undoAvailable).toBe(true)
    r.programs.undo()
    expect(r.snap.programIndex).toBe(0)
    expect(r.engine.get().clock.bpm).toBe(77)
    expect(r.snap.dirty).toBe(true) // still edited, not stored
    expect(r.snap.undoAvailable).toBe(false)
  })

  it('undo is single level and a new edit ends it; a clean program change offers no undo', () => {
    const r = rig()
    r.programs.select(1)
    expect(r.snap.undoAvailable).toBe(false)
    r.edit((s) => setBpm(s, 60))
    r.programs.select(2)
    expect(r.snap.undoAvailable).toBe(true)
    r.edit((s) => setBpm(s, 61))
    expect(r.snap.undoAvailable).toBe(false)
    r.programs.undo() // nothing to undo
    expect(r.engine.get().clock.bpm).toBe(61)
  })

  it('choosing the current, edited program again reloads it (discarding the edits)', () => {
    const r = rig()
    r.edit((s) => setBpm(s, 200))
    r.programs.select(0)
    expect(r.engine.get().clock.bpm).toBe(120)
    expect(r.snap.dirty).toBe(false)
  })
})

describe('programs.store-live — Store, Store As with naming, and the 8 auto-storing Live slots', () => {
  it('STORE shows the destination, the destination sounds while choosing, STORE again writes it', () => {
    const r = rig()
    r.edit((s) => setBpm(s, 88))
    r.programs.pressStore(false)
    expect(r.snap.store).toMatchObject({ step: 'dest', dest: { mode: 'program', index: 0 } })
    r.programs.stepDestination(5)
    expect(r.snap.store?.dest.index).toBe(5)
    expect(r.engine.get().clock.bpm).toBe(FACTORY_PROGRAMS()[5].data.clock.bpm) // auditioning slot 6
    r.programs.pressStore(false)
    expect(r.snap.store).toBeNull()
    expect(r.snap.programIndex).toBe(5)
    expect(r.engine.get().clock.bpm).toBe(88)
    expect(r.snap.dirty).toBe(false)
    expect(r.snap.names[5]).toBe(FACTORY_PROGRAMS()[0].name) // the name of the program that was stored travels with it
    expect(r.snap.message).toMatch(/Stored 1\.6/)
  })

  it('cancelling the store flow restores the edited sound and stores nothing', () => {
    const r = rig()
    r.edit((s) => setBpm(s, 91))
    r.programs.pressStore(false)
    r.programs.stepDestination(7)
    r.programs.cancelStore()
    expect(r.snap.store).toBeNull()
    expect(r.engine.get().clock.bpm).toBe(91)
    expect(r.snap.dirty).toBe(true)
    expect(r.programs.slot('program', 7).data.clock.bpm).toBe(FACTORY_PROGRAMS()[7].data.clock.bpm)
  })

  it('STORE AS opens naming first: characters, insert, delete, cursor, whole text; the name is stored with the program', () => {
    const r = rig()
    r.programs.pressStore(true)
    expect(r.snap.store).toMatchObject({ as: true, step: 'name' })
    r.programs.nameSet('')
    r.programs.nameChar(1) // first character: an empty name gets an "A"
    expect(r.snap.store?.name).toBe('A')
    r.programs.nameChar(1)
    expect(r.snap.store?.name).toBe('B')
    r.programs.nameCursor(1)
    r.programs.nameChar(1)
    expect(r.snap.store?.name).toBe('BA')
    r.programs.nameInsert()
    expect(r.snap.store?.name).toBe('B A')
    r.programs.nameDelete()
    expect(r.snap.store?.name).toBe('BA')
    r.programs.nameSet('Tine Stack 2 é<script>') // characters outside the character set are dropped, 16 at most
    expect(r.snap.store?.name).toBe('Tine Stack 2 scr')
    r.programs.nameSet('My Patch')
    r.programs.pressStore(true) // accept the name
    expect(r.snap.store?.step).toBe('dest')
    r.programs.storeDestination('program', 30)
    r.programs.pressStore(true)
    expect(r.snap.names[30]).toBe('My Patch')
    expect(r.snap.name).toBe('My Patch')
    const again = reload(r.storage!)
    expect(again.snap.names[30]).toBe('My Patch')
  })

  it('Live mode switches the program buttons to 8 Live slots and stores every edit automatically', () => {
    const r = rig()
    r.programs.setMode('live')
    expect(r.snap.mode).toBe('live')
    expect(r.snap.slotLabel).toBe('L1')
    r.edit((s) => setBpm(s, 133))
    expect(r.snap.dirty).toBe(false) // nothing to save: it is already stored
    r.programs.select(4)
    expect(r.snap.slotLabel).toBe('L5')
    r.edit((s) => setDrawbar(s, 0, 2))
    r.programs.select(0)
    expect(r.engine.get().clock.bpm).toBe(133)
    r.programs.select(4)
    expect(r.engine.get().organ.layers.A.drawbars[0]).toBe(2)
    r.programs.flush()
    // survives a reload, including which slot was active
    const again = reload(r.storage!)
    expect(again.snap.mode).toBe('live')
    expect(again.snap.liveIndex).toBe(4)
    expect(again.engine.get().organ.layers.A.drawbars[0]).toBe(2)
    again.programs.select(0)
    expect(again.engine.get().clock.bpm).toBe(133)
  })

  it('edits reach storage on their own after the debounce, and dispose flushes them', () => {
    const r = rig()
    r.programs.setMode('live')
    r.edit((s) => setBpm(s, 101))
    expect(r.programs.pendingTimerCount()).toBeGreaterThan(0)
    r.scheduler.advance(400)
    expect(JSON.parse(r.storage!.getItem(PROGRAM_STORAGE_KEY)!).live[0].data.clock.bpm).toBe(101)
    r.edit((s) => setBpm(s, 102))
    r.programs.dispose()
    expect(JSON.parse(r.storage!.getItem(PROGRAM_STORAGE_KEY)!).live[0].data.clock.bpm).toBe(102)
    expect(r.programs.pendingTimerCount()).toBe(0)
    expect(r.programs.listenerCount()).toBe(0)
    expect(r.engine.listenerCount()).toBe(0)
  })

  it('programs and Live slots copy to each other through STORE', () => {
    const r = rig()
    r.edit((s) => setBpm(s, 66))
    r.programs.pressStore(false)
    r.programs.toggleDestinationBank() // Live
    expect(r.snap.store?.dest.mode).toBe('live')
    r.programs.storeDestination('live', 6)
    r.programs.pressStore(false)
    expect(r.snap.mode).toBe('live')
    expect(r.snap.slotLabel).toBe('L7')
    r.programs.setMode('program')
    r.programs.setMode('live')
    expect(r.engine.get().clock.bpm).toBe(66)
    // and back: store a Live slot into a program slot
    r.programs.pressStore(false)
    r.programs.toggleDestinationBank()
    r.programs.storeDestination('program', 12)
    r.programs.pressStore(false)
    r.programs.select(12)
    expect(r.engine.get().clock.bpm).toBe(66)
  })

  it('a storage that refuses writes keeps the session working and says so', () => {
    const storage = new MemoryStorage()
    const r = rig(storage)
    storage.failWrites = true
    r.programs.setMode('live')
    r.edit((s) => setBpm(s, 50))
    r.scheduler.advance(400)
    expect(r.snap.storageOk).toBe(false)
    expect(r.snap.message).toMatch(/Storage is full or blocked/)
    expect(r.engine.get().clock.bpm).toBe(50)
    const none = rig(null)
    none.programs.setMode('live')
    none.edit((s) => setBpm(s, 51))
    expect(none.engine.get().clock.bpm).toBe(51)
  })

  it('the message line clears itself and leaves no timer behind', () => {
    const r = rig()
    r.programs.message('hello')
    expect(r.snap.message).toBe('hello')
    r.scheduler.advance(3000)
    expect(r.snap.message).toBeNull()
    expect(r.programs.pendingTimerCount()).toBe(0)
  })
})
