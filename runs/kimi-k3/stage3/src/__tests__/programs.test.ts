import { describe, expect, it } from 'vitest'
import { makeRig } from '../test-helpers'
import { PROGRAM_SLOTS, LIVE_SLOTS, factoryPrograms } from '../state/program-store'
import { serializeProgramState } from '../state/program-state'

function memStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    map,
  }
}

describe('programs.roundtrip', () => {
  it('store + recall round-trips all supported state families across the 32 slots', async () => {
    const { engine } = await makeRig()
    // Mutate every state family.
    engine.setLayerType('pianoA', 'electric')
    engine.setLayerEnabled('pianoB', true)
    engine.update(() => {
      engine.perf.kbTouch = 2
      engine.perf.unison = 2
      engine.organ.sectionOn = true
      engine.organ.layers.A.model = 3 // Farf
      engine.organ.layers.A.drawbars = [8, 0, 8, 0, 8, 0, 8, 0, 8]
      engine.organ.layers.A.percussion.on = true
      engine.organ.layers.B.enabled = true
      engine.organ.layers.B.model = 4
      engine.synth.sectionOn = true
      engine.synth.layers.A.oscWave = 13
      engine.synth.layers.A.oscCtrl = 90
      engine.synth.layers.A.filterFreq = 55
      engine.synth.layers.A.voiceMode = 1
      engine.synth.layers.B.enabled = true
      engine.synth.layers.B.arpRun = true
      engine.effects.chains.synthA.mod1.on = true
      engine.effects.chains.organ.reverb.on = true
      engine.effects.rotary.on = true
      engine.effects.rotary.organRouted = true
      engine.split.on = true
      engine.split.points.Low.enabled = true
      engine.split.points.Low.position = 2
      engine.split.points.Low.xfade = 1
      engine.split.zones.organA = { lo: 0, hi: 0 }
    })
    engine.assignMorph('wheel', 'synth.filterCutoff', 20, 120)
    engine.setBpm(97)
    engine.setTranspose(-3)
    const before = serializeProgramState(engine.getProgramState())

    // Store into the last slot and recall it.
    engine.storeTo(PROGRAM_SLOTS - 1, 'Round Trip')
    expect(engine.isDirty()).toBe(false)
    // Change everything away, then recall.
    engine.loadSlot(0)
    expect(serializeProgramState(engine.getProgramState())).not.toBe(before)
    engine.loadSlot(PROGRAM_SLOTS - 1)
    expect(serializeProgramState(engine.getProgramState())).toBe(before)
    // Spot-check deep fields survived.
    expect(engine.organ.layers.A.model).toBe(3)
    expect(engine.organ.layers.A.drawbars[4]).toBe(8)
    expect(engine.synth.layers.A.oscWave).toBe(13)
    expect(engine.effects.chains.organ.reverb.on).toBe(true)
    expect(engine.split.points.Low.position).toBe(2)
    expect(engine.morphs.wheel[0]).toEqual({ controlId: 'synth.filterCutoff', from: 20, to: 120 })
    expect(engine.clock.bpm).toBe(97)
    expect(engine.transpose).toBe(-3)
  })

  it('dirty indicator is truthful: clean after load, dirty after edit, clean after store', async () => {
    const { engine } = await makeRig()
    expect(engine.isDirty()).toBe(false)
    engine.setLayerLevel('pianoA', 0.5)
    expect(engine.isDirty()).toBe(true)
    engine.storeTo(3)
    expect(engine.isDirty()).toBe(false)
    engine.loadSlot(3)
    expect(engine.isDirty()).toBe(false)
    engine.setBpm(140)
    expect(engine.isDirty()).toBe(true)
  })

  it('Master Level is excluded from program state', async () => {
    const { engine } = await makeRig()
    engine.setMasterLevel(0.3)
    const a = serializeProgramState(engine.getProgramState())
    engine.setMasterLevel(0.9)
    const b = serializeProgramState(engine.getProgramState())
    expect(a).toBe(b)
  })

  it('at least 8 factory programs ship, demonstrating piano, organ, synth, split, layered setups', () => {
    const factory = factoryPrograms()
    expect(factory.length).toBeGreaterThanOrEqual(8)
    const names = factory.map((p) => p.name)
    expect(new Set(names).size).toBe(factory.length)
    expect(factory.some((p) => p.state.organ.sectionOn)).toBe(true)
    expect(factory.some((p) => p.state.synth.sectionOn)).toBe(true)
    expect(factory.some((p) => p.state.split.on)).toBe(true)
    expect(factory.some((p) => p.state.piano.layers.pianoB.enabled)).toBe(true)
  })
})

describe('programs.store-live', () => {
  it('Store writes the current state to a slot and clears dirty', async () => {
    const { engine } = await makeRig()
    engine.setLayerType('pianoA', 'clav')
    engine.storeTo(10, 'Clavinet')
    expect(engine.bank.get(10).name).toBe('Clavinet')
    expect(engine.bank.get(10).state.piano.layers.pianoA.type).toBe('clav')
    expect(engine.isDirty()).toBe(false)
  })

  it('Store As stores under a new name at a new destination', async () => {
    const { engine } = await makeRig()
    engine.setBpm(88)
    engine.storeTo(27, 'My Sound')
    expect(engine.bank.get(27).name).toBe('My Sound')
    expect(engine.bank.get(27).state.clock.bpm).toBe(88)
    expect(engine.currentSlot).toBe(27)
    expect(engine.currentName).toBe('My Sound')
  })

  it('Live slots auto-store edits and survive a bank reload (storage seam)', async () => {
    const storage = memStorage()
    const { PianoEngine } = await import('../audio/engine')
    const { FakeAudioBackend } = await import('../audio/fake-backend')
    const engine = new PianoEngine(new FakeAudioBackend(), {}, storage)
    engine.setLiveMode(true)
    expect(engine.liveMode).toBe(true)
    engine.selectProgramButton(3) // Live slot 3 (index 2)
    engine.setLayerType('pianoA', 'misc')
    engine.setBpm(66)
    // Auto-stored: a fresh engine over the same storage sees the edit.
    const engine2 = new PianoEngine(new FakeAudioBackend(), {}, storage)
    engine2.setLiveMode(true)
    engine2.selectProgramButton(3)
    expect(engine2.layers.pianoA.type).toBe('misc')
    expect(engine2.clock.bpm).toBe(66)
    // Live slots are never dirty (auto-stored).
    engine2.setLayerLevel('pianoA', 0.4)
    expect(engine2.isDirty()).toBe(false)
  })

  it('programs copy between Live and regular slots via Store', async () => {
    const { engine } = await makeRig()
    engine.setBpm(77)
    engine.storeTo(5, 'ToLive')
    // Copy the loaded regular program into Live slot 1 (manual p. 13/44).
    engine.copyCurrentTo({ live: 0 }, 'ToLive')
    expect(engine.bank.getLive(0).state.clock.bpm).toBe(77)
    expect(engine.bank.getLive(0).name).toBe('ToLive')
    // And back: load the live slot, copy into a regular slot.
    engine.setLiveMode(true)
    engine.selectProgramButton(1)
    engine.setBpm(66) // auto-stored in live
    engine.copyCurrentTo({ slot: 6 }, 'BackAgain')
    expect(engine.bank.get(6).state.clock.bpm).toBe(66)
  })

  it('live bank has 8 slots', () => {
    expect(LIVE_SLOTS).toBe(8)
  })
})

describe('programs.undo-cancel', () => {
  it('program change from an edited state discards the edit', async () => {
    const { engine } = await makeRig()
    const clean = serializeProgramState(engine.getProgramState())
    engine.setLayerType('pianoA', 'electric')
    expect(engine.isDirty()).toBe(true)
    engine.loadSlot(1)
    engine.loadSlot(0)
    // Edits were discarded: state equals the stored slot, not the edit.
    expect(engine.layers.pianoA.type).toBe('grand')
    expect(serializeProgramState(engine.getProgramState())).toBe(clean)
  })

  it('single-level undo restores the edited state after a program change', async () => {
    const { engine } = await makeRig()
    engine.setLayerType('pianoA', 'electric')
    engine.setBpm(133)
    engine.loadSlot(2)
    expect(engine.hasUndo()).toBe(true)
    expect(engine.undoProgramChange()).toBe(true)
    expect(engine.layers.pianoA.type).toBe('electric')
    expect(engine.clock.bpm).toBe(133)
    expect(engine.hasUndo()).toBe(false)
  })

  it('no undo when the change was not from an edited state', async () => {
    const { engine } = await makeRig()
    engine.loadSlot(1)
    expect(engine.hasUndo()).toBe(false)
  })
})

describe('programs.navigation', () => {
  it('program buttons select slots within the current page', async () => {
    const { engine } = await makeRig()
    engine.setPage(2) // page 3 → slots 16..23
    engine.selectProgramButton(4)
    expect(engine.currentSlot).toBe(2 * 8 + 3)
    expect(engine.getProgramLabel()).toBe('3.4')
  })

  it('page buttons move through 4 pages of 8', async () => {
    const { engine } = await makeRig()
    expect(engine.page).toBe(0)
    engine.setPage(1)
    expect(engine.page).toBe(1)
    engine.setPage(-1) // wraps
    expect(engine.page).toBe(3)
  })

  it('dial browsing steps through all 32 slots and wraps', async () => {
    const { engine } = await makeRig()
    for (let i = 0; i < 31; i++) engine.browse(1)
    expect(engine.currentSlot).toBe(31)
    engine.browse(1)
    expect(engine.currentSlot).toBe(0)
    engine.browse(-1)
    expect(engine.currentSlot).toBe(31)
  })

  it('numeric list view toggles and exposes all 32 program names', async () => {
    const { engine } = await makeRig()
    engine.setListView(true)
    expect(engine.listView).toBe(true)
    const names = Array.from({ length: PROGRAM_SLOTS }, (_, i) => engine.bank.get(i).name)
    expect(names.length).toBe(32)
    expect(names[0]).toBe('Grand Piano')
    engine.setListView(false)
    expect(engine.listView).toBe(false)
  })

  it('live mode buttons address the 8 live slots', async () => {
    const { engine } = await makeRig()
    engine.setLiveMode(true)
    engine.selectProgramButton(8)
    expect(engine.currentLiveSlot).toBe(7)
    expect(engine.getProgramLabel()).toBe('Live 8')
  })
})
