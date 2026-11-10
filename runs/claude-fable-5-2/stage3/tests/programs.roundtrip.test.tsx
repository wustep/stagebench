import { describe, expect, it } from 'vitest'
import { PROGRAM_STORAGE_KEY, ProgramBank } from '../src/programs/bank'
import { FACTORY_PROGRAM_COUNT, factoryLive, factoryPrograms } from '../src/programs/factory'
import {
  LIVE_COUNT,
  PROGRAM_COUNT,
  PROGRAM_KEYS,
  conformProgram,
  createInitialState,
  deriveSound,
  extractProgram,
  programSignature,
  type ProgramData,
} from '../src/state/model'
import { StageStore } from '../src/state/store'
import { mountApp } from './support/app'
import { FakeStorage } from './support/fakes'
import { keys, oled, press } from './support/panel'
import { makeRig, scramble } from './support/rig'
import { equal, rms } from './support/signal'

/**
 * Feature: programs.roundtrip
 * Save/load restores all supported state across the 32 slots; dirty indicator is truthful.
 */

/** Every leaf value of a program, by path. */
function leaves(value: unknown, path = '', out = new Map<string, unknown>()): Map<string, unknown> {
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) leaves(item, path ? `${path}.${key}` : key, out)
  } else out.set(path, value)
  return out
}

describe('programs.roundtrip: what a program holds', () => {
  it('is plain serialisable data covering every stored part of the instrument, and not Master Level', () => {
    expect([...PROGRAM_KEYS]).toEqual(['name', 'organ', 'piano', 'synth', 'fx', 'rotary', 'split', 'scene', 'morph', 'clock', 'transpose'])
    const program = extractProgram(createInitialState())
    expect(JSON.parse(JSON.stringify(program))).toEqual(program)
    expect(Object.keys(program)).not.toContain('master')
    expect(Object.keys(program)).not.toContain('ui')
    expect(Object.keys(program)).not.toContain('wheel')
    // Six effect chains, three synth layers, two organ and two piano layers, three split points.
    expect(program.fx.chains).toHaveLength(6)
    expect([program.organ.layers.length, program.piano.layers.length, program.synth.layers.length]).toEqual([2, 2, 3])
    expect(program.split.points).toHaveLength(3)
    expect(leaves(program).size).toBeGreaterThan(350)
  })

  it('the scramble used by these tests really moves every part of it', () => {
    const rig = makeRig()
    const before = leaves(extractProgram(rig.state()))
    scramble(rig, 7)
    const after = leaves(extractProgram(rig.state()))
    const changed = [...after.keys()].filter((path) => after.get(path) !== before.get(path))
    // Something changed under every top-level key…
    for (const key of PROGRAM_KEYS) {
      if (key === 'name') continue
      expect(changed.some((path) => path === key || path.startsWith(`${key}.`)), key).toBe(true)
    }
    // …in every section and layer, every effect unit, and each morph source.
    for (const prefix of [
      'organ.layers.0.drawbars', 'organ.layers.0.perc', 'organ.layers.1.level', 'organ.layers.1.model', 'organ.vibType', 'organ.sustPed',
      'piano.layers.0.level', 'piano.layers.1.type', 'piano.layers.1.timbre', 'piano.layers.1.kbTouch', 'piano.layers.1.octave', 'piano.pStick',
      'synth.layers.0.wave', 'synth.layers.0.filter', 'synth.layers.0.oscEnv', 'synth.layers.0.filterEnv', 'synth.layers.0.ampEnv',
      'synth.layers.0.lfo', 'synth.layers.0.voice', 'synth.layers.0.arp', 'synth.layers.0.coarse', 'synth.layers.1.level', 'synth.layers.2.filter.on', 'synth.hold',
      'fx.chains.5.mod1', 'fx.chains.5.mod2', 'fx.chains.5.delay', 'fx.chains.5.amp', 'fx.chains.5.comp', 'fx.chains.5.reverb',
      'fx.chains.2.reverb', 'fx.chains.0.mod2', 'fx.pianoGroup',
      'rotary.organ', 'rotary.fast', 'rotary.drive', 'split.on', 'split.points.0', 'split.points.2',
      'scene.other.organ.on', 'clock.bpm', 'transpose.semitones',
    ]) {
      expect(changed.some((path) => path.startsWith(prefix)), prefix).toBe(true)
    }
    expect(rig.state().morph.wheel.length).toBeGreaterThanOrEqual(2)
    expect(rig.state().morph.pedal.length).toBeGreaterThanOrEqual(2)
    expect(changed.length).toBeGreaterThan(110)
    rig.dispose()
  })
})

describe('programs.roundtrip: all 32 slots', () => {
  it('storing a different program in every slot and loading each back restores it exactly', () => {
    const storage = new FakeStorage()
    const rig = makeRig(storage)
    const stored: string[] = []
    const sounds: string[] = []
    for (let slot = 0; slot < PROGRAM_COUNT; slot += 1) {
      rig.stage.load({ live: false, slot: 0 })
      scramble(rig, slot)
      expect(rig.state().nav.dirty).toBe(true)
      // Store, choose the slot with the dial, Store.
      rig.press('store')
      rig.turn('program-dial', slot)
      rig.press('store')
      expect(rig.state().nav).toMatchObject({ live: false, slot, dirty: false })
      stored.push(programSignature(rig.state()))
      sounds.push(JSON.stringify(deriveSound(rig.state())))
    }
    // No two slots hold the same program.
    expect(new Set(stored).size).toBe(PROGRAM_COUNT)
    // Load every slot back, in a different order, and compare everything.
    for (let step = 0; step < PROGRAM_COUNT; step += 1) {
      const slot = (step * 13 + 5) % PROGRAM_COUNT
      rig.stage.load({ live: false, slot })
      expect(programSignature(rig.state()), `slot ${slot}`).toBe(stored[slot])
      expect(JSON.stringify(deriveSound(rig.state())), `slot ${slot}`).toBe(sounds[slot])
      expect(rig.state().nav.dirty).toBe(false)
    }
    // And they are still there after a reload: a new store reading the same storage.
    const reloaded = new StageStore({ storage })
    for (let slot = 0; slot < PROGRAM_COUNT; slot += 1) {
      reloaded.load({ live: false, slot })
      expect(programSignature(reloaded.getState()), `slot ${slot} after reload`).toBe(stored[slot])
    }
    rig.dispose()
  })

  it('a reloaded program sounds the same, sample for sample', () => {
    const play = (prepare: (rig: ReturnType<typeof makeRig>) => void) => {
      const storage = new FakeStorage()
      const rig = makeRig(storage)
      prepare(rig)
      for (const note of [43, 55, 62, 74]) rig.down(note)
      const out = rig.render(0.5)
      rig.dispose()
      return out
    }
    const edited = play((rig) => scramble(rig, 3))
    const restored = play((rig) => {
      scramble(rig, 3)
      rig.press('store')
      rig.turn('program-dial', 20)
      rig.press('store')
      rig.stage.load({ live: false, slot: 0 })
      rig.stage.load({ live: false, slot: 20 })
    })
    expect(rms(edited.left)).toBeGreaterThan(0.005)
    expect(equal(edited.left, restored.left)).toBe(true)
    expect(equal(edited.right, restored.right)).toBe(true)
  })

  it('Master Level is not part of a program: loading leaves it where it is', () => {
    const rig = makeRig()
    rig.set('perf-master-level', 3)
    rig.stage.load({ live: false, slot: 1 })
    expect(rig.state().master).toBe(3)
    expect(rig.value('perf-master-level')).toBe(3)
    expect(rig.sound().master).toBeCloseTo(0.3)
    rig.dispose()
  })

  it('the panel shows the loaded program: knobs, faders, drawbars, and LEDs all move to it', () => {
    const rig = makeRig()
    scramble(rig, 11)
    const snapshot = rig.hardware.snapshot()
    rig.press('store')
    rig.turn('program-dial', 9)
    rig.press('store')
    const stored = rig.hardware.snapshot()
    rig.stage.load({ live: false, slot: 0 })
    expect(rig.hardware.snapshot()).not.toEqual(stored)
    expect(rig.value('organ-drawbar-1')).toBe(8)
    rig.stage.load({ live: false, slot: 9 })
    expect(rig.hardware.snapshot()).toEqual(stored)
    void snapshot
    rig.dispose()
  })
})

describe('programs.roundtrip: the factory content', () => {
  it('ships 32 programs, at least 8 of them hand-made, covering piano, organ, synth, split, and layers', () => {
    const programs = factoryPrograms()
    expect(programs).toHaveLength(PROGRAM_COUNT)
    expect(FACTORY_PROGRAM_COUNT).toBeGreaterThanOrEqual(8)
    const made = programs.slice(0, FACTORY_PROGRAM_COUNT)
    expect(new Set(made.map((program) => program.name)).size).toBe(FACTORY_PROGRAM_COUNT)
    expect(new Set(made.map(programSignature)).size).toBe(FACTORY_PROGRAM_COUNT)
    const sections = (program: ProgramData) => [program.organ.on, program.piano.on, program.synth.on]
    expect(made.some((program) => sections(program).join() === 'false,true,false')).toBe(true)
    expect(made.some((program) => sections(program).join() === 'true,false,false')).toBe(true)
    expect(made.some((program) => sections(program).join() === 'false,false,true')).toBe(true)
    expect(made.some((program) => program.split.on)).toBe(true)
    expect(made.some((program) => sections(program).filter(Boolean).length >= 2 && !program.split.on)).toBe(true)
    expect(made.some((program) => program.morph.wheel.length > 0)).toBe(true)
    expect(made.some((program) => JSON.stringify(program.scene.other) !== JSON.stringify({ organ: { on: program.organ.on, layers: program.organ.layers.map((l) => l.on) }, piano: { on: program.piano.on, layers: program.piano.layers.map((l) => l.on) }, synth: { on: program.synth.on, layers: program.synth.layers.map((l) => l.on) } }))).toBe(true)
    // The rest are plainly named Init programs, and every one of the 32 survives the validator unchanged.
    for (const program of programs.slice(FACTORY_PROGRAM_COUNT)) expect(program.name).toMatch(/^Init \d\.\d$/)
    for (const program of programs) expect(programSignature(conformProgram(program))).toBe(programSignature(program))
    expect(factoryLive()).toHaveLength(LIVE_COUNT)
  })

  it('program 1.1 is the start-up state, and every factory program makes sound', () => {
    expect(programSignature(factoryPrograms()[0])).toBe(programSignature(extractProgram(createInitialState())))
    for (let slot = 0; slot < FACTORY_PROGRAM_COUNT; slot += 1) {
      const rig = makeRig()
      rig.stage.load({ live: false, slot })
      for (const note of [43, 60, 76]) rig.down(note)
      expect(rms(rig.render(0.4).left), rig.state().name).toBeGreaterThan(0.002)
      rig.dispose()
    }
  })

  it('damaged or foreign data in storage can never put the instrument in a state it cannot show', () => {
    const template = extractProgram(createInitialState())
    const junk = conformProgram({ name: 42, piano: 'nope', organ: { layers: [{ drawbars: 'x', level: 'loud' }] }, fx: { chains: [null, 7] }, morph: { wheel: [{ path: 3 }, { path: 'piano.layers.0.level', to: 20 }], pedal: 'no' }, extra: true })
    expect(Object.keys(junk).sort()).toEqual([...PROGRAM_KEYS].sort())
    expect(junk.piano).toEqual(template.piano)
    expect(junk.organ.layers[0].drawbars).toEqual(template.organ.layers[0].drawbars)
    expect(junk.organ.layers[0].level).toBe(template.organ.layers[0].level)
    expect(junk.fx.chains).toHaveLength(6)
    expect(junk.morph.wheel).toEqual([{ path: 'piano.layers.0.level', to: 20 }])
    expect(junk.morph.pedal).toEqual([])
    const storage = new FakeStorage()
    storage.setItem(PROGRAM_STORAGE_KEY, '{not json')
    expect(new ProgramBank(storage).name({ live: false, slot: 0 })).toBe('Grand Piano')
    storage.setItem(PROGRAM_STORAGE_KEY, JSON.stringify({ version: 1, programs: { 3: { name: 'Kept', clock: { bpm: 99 } }, 99: {}, x: 1 }, live: [] }))
    const bank = new ProgramBank(storage)
    expect(bank.name({ live: false, slot: 3 })).toBe('Kept')
    expect(bank.get({ live: false, slot: 3 }).clock.bpm).toBe(99)
    expect(bank.get({ live: false, slot: 3 }).fx.chains).toHaveLength(6)
  })
})

describe('programs.roundtrip: the edited indicator', () => {
  it('is off for a freshly loaded program, on after any edit, and off again when the edit is undone by hand', () => {
    const rig = makeRig()
    expect(rig.state().nav.dirty).toBe(false)
    rig.set('fx-reverb-mix', 9)
    expect(rig.state().nav.dirty).toBe(true)
    // Turning the knob back to where it was stored makes the program clean again: the flag is a comparison, not a latch.
    rig.set('fx-reverb-mix', 6.5)
    expect(rig.state().nav.dirty).toBe(false)
    rig.press('piano-type')
    expect(rig.state().nav.dirty).toBe(true)
    for (let presses = 0; presses < 5; presses += 1) rig.press('piano-type')
    expect(rig.state().nav.dirty).toBe(false)
    rig.dispose()
  })

  it('performance controls and editing pages do not count as edits', () => {
    const rig = makeRig()
    rig.set('perf-master-level', 2)
    rig.set('perf-mod-wheel', 100)
    rig.set('perf-pitch-stick', 50)
    rig.stage.setPedal(0.6)
    rig.shiftTurn('program-dial', 0)
    rig.shiftPress('split')
    rig.exit()
    rig.press('mst-clk')
    rig.exit()
    rig.press('synth-filter-type')
    rig.stage.setNotice('hello')
    expect(rig.state().nav.dirty).toBe(false)
    // An unsupported control cannot make it dirty either.
    rig.press('solo')
    rig.press('preset-piano')
    expect(rig.state().nav.dirty).toBe(false)
    rig.dispose()
  })

  it('every kind of program edit sets it, and storing clears it', () => {
    const edits: Array<[string, (rig: ReturnType<typeof makeRig>) => void]> = [
      ['organ', (rig) => rig.set('organ-drawbar-5', 7)],
      ['synth', (rig) => rig.set('synth-filter-freq', 9)],
      ['effects', (rig) => rig.press('fx-delay-on')],
      ['rotary', (rig) => rig.press('rotary-speed')],
      ['split', (rig) => rig.press('split')],
      ['scene', (rig) => rig.press('layer-scene')],
      ['clock', (rig) => rig.stage.setBpm(133)],
      ['transpose', (rig) => rig.press('transpose')],
      ['section on', (rig) => rig.press('synth-on')],
      ['focus', (rig) => rig.press('fx-focus-synth')],
    ]
    for (const [name, edit] of edits) {
      const rig = makeRig()
      edit(rig)
      expect(rig.state().nav.dirty, name).toBe(true)
      if (rig.stage.editing) rig.exit()
      rig.press('store')
      rig.press('store')
      expect(rig.state().nav.dirty, name).toBe(false)
      rig.dispose()
    }
    // A morph assignment is an edit too.
    const rig = makeRig()
    rig.press('morph-wheel')
    rig.set('piano-layer-a-level', 40)
    rig.press('morph-wheel')
    expect(rig.state().nav.dirty).toBe(true)
    rig.dispose()
  })

  it('shows as an E next to the program number on the display, and in the status line', () => {
    const app = mountApp()
    const display = app.control('program-oled')
    expect(display.querySelector('[data-line="program-name"]')).toHaveTextContent('1.1 Grand Piano')
    expect(display.querySelector('[data-line="edited"]')).toBeNull()
    expect(app.getByTestId('program-edited')).toHaveTextContent('As stored.')
    keys(app, 'fx-reverb-mix', 'End')
    expect(display.querySelector('[data-line="edited"]')).toHaveTextContent('E')
    expect(display.getAttribute('aria-label')).toMatch(/Program 1\.1 Grand Piano, edited, not stored/)
    expect(app.getByTestId('program-edited')).toHaveTextContent('Edited (E): not stored yet.')
    press(app, 'store')
    press(app, 'store')
    expect(app.control('program-oled').querySelector('[data-line="edited"]')).toBeNull()
    expect(oled(app, 'notice')).toBe('> STORED TO 1.1 GRAND PIANO')
  })
})
