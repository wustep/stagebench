import { fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createFactoryBank } from '../src/state/factoryPrograms'
import { isDirty } from '../src/state/instrumentState'
import { PROGRAM_KEYS, parseProgram, programOf, programsEqual, scenesExplicit, serializeProgram, slotLabel } from '../src/state/programState'
import { click, el, hold, mountApp, setSlider, turnDial, type Mounted } from './helpers'

let mounted: Mounted | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
})

/** Edits something in every section and every program key so a round trip has to carry all of it. */
function editEverything(m: Mounted) {
  const { state } = m.services
  click('piano.layer-b.on')
  setSlider('piano.layer-b.level', 33)
  click('piano.unison') // B: unison 1
  click('organ.on')
  click('organ.model') // A: Vox
  setSlider('organ.drawbar.8', 2)
  click('organ.percussion.on')
  click('synth.on')
  turnDial('synth.dial-2', 1) // waveform page: category Sync
  setSlider('synth.filter.freq', 8.5)
  click('synth.voice.mode') // Mono
  fireEvent.keyDown(el('effects.reverb.dry-wet'), { key: 'End' })
  click('performance.rotary.organ')
  click('performance.rotary.speed')
  click('program.split')
  hold(m, 'program.transpose')
  turnDial('program.dial', -3)
  click('program.shift') // exit the transpose page
  hold(m, 'program.master-clock')
  turnDial('program.dial', 12)
  click('program.shift')
  click('program.layer-scene')
  const p = programOf(state.get())
  // Layer Scene II (captured before Piano B was enabled) is now live: Piano B is on in scene I, off in scene II.
  expect(scenesExplicit(p).I.layers.pianoB).toBe(true)
  expect(p.piano.layers.B.on).toBe(false)
  expect(p.piano.layers.B.level).toBe(33)
  expect(scenesExplicit(p).I.sections.organ && p.organ.layers.A.model === 1 && p.organ.percussion.on).toBe(true)
  expect(scenesExplicit(p).I.sections.synth && p.synth.layers.A.wave.category === 1 && p.synth.layers.A.voice.mode === 1).toBe(true)
  expect(p.effects.chains.pianoB.reverb.dryWet).toBe(10)
  expect(p.rotary.organ && p.rotary.speed === 1).toBe(true)
  expect(p.split.on).toBe(true)
  expect(p.transpose).toEqual({ on: true, semitones: -3 })
  expect(p.clock.bpm).toBe(132)
  expect(p.scenes.active).toBe('II')
  return p
}

describe('programs.roundtrip — save/load restores all supported state across the 32 slots; the E indicator is truthful', () => {
  it('serialises every factory program with explicit scenes and parses it back identically', () => {
    const { programs, live } = createFactoryBank(true)
    expect(programs).toHaveLength(32)
    expect(live).toHaveLength(8)
    expect(new Set(programs.slice(0, 16).map((p) => p.name)).size).toBe(16)
    for (const p of [...programs, ...live]) {
      const json = serializeProgram(p)
      const parsed = JSON.parse(json)
      expect(Object.keys(parsed).sort()).toEqual([...PROGRAM_KEYS].sort())
      expect(parsed.scenes).toMatchObject({ active: p.scenes.active, I: scenesExplicit(p).I, II: scenesExplicit(p).II })
      const back = parseProgram(parsed, programs[0])!
      expect(back).not.toBeNull()
      expect(programsEqual(back, p)).toBe(true)
      expect(serializeProgram(back)).toBe(json)
    }
    // Master Level is not part of a program (programs spec `programState.excludes`).
    expect(serializeProgram(programs[0])).not.toMatch(/master/i)
  })

  it('a fresh instrument shows program 1.1 not edited; any panel edit shows E; Store clears it; loading discards it', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    const oled = el('program.oled')
    expect(oled.dataset.slot).toBe('1.1')
    expect(oled.dataset.dirty).toBe('false')
    expect(oled.textContent).toMatch(/1\.1 Init Grand/)
    fireEvent.keyDown(el('effects.reverb.dry-wet'), { key: 'End' })
    expect(isDirty(state.get())).toBe(true)
    expect(oled.dataset.dirty).toBe('true')
    expect(oled.textContent).toMatch(/1\.1 E Init Grand/)
    click('program.store')
    click('program.store')
    expect(oled.dataset.dirty).toBe('false')
    expect(state.get().bank.programs[0].effects.chains.pianoA.reverb.dryWet).toBe(10)
    fireEvent.keyDown(el('effects.reverb.dry-wet'), { key: 'Home' })
    expect(oled.dataset.dirty).toBe('true')
    click('program.button.2')
    expect(oled.dataset.dirty).toBe('false')
    click('program.button.1')
    expect(state.get().effects.chains.pianoA.reverb.dryWet).toBe(10) // the stored version, not the discarded edit
  })

  it('stores an edited program into every one of the 32 slots and reloads it with every supported key intact', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    const edited = editEverything(mounted)
    const json = serializeProgram(edited)
    for (let slot = 0; slot < 32; slot++) {
      // the edited program is still the live one (it was never stored until now)
      expect(serializeProgram(programOf(state.get()))).toBe(json)
      click('program.store')
      expect(state.get().view.mode).toBe('store')
      turnDial('program.dial', slot - state.get().view.store!.slot)
      expect(state.get().view.store).toEqual({ live: false, slot })
      click('program.store')
      expect(state.get().view.mode).toBe('program')
      expect(state.get().bank.slot).toBe(slot)
      expect(serializeProgram(state.get().bank.programs[slot])).toBe(json)
      expect(el('program.oled').dataset.slot).toBe(slotLabel(slot))
      expect(el('program.oled').dataset.dirty).toBe('false')
    }
    // load something else, then reload every slot and compare every program key
    click('program.button.1')
    for (let slot = 31; slot >= 0; slot--) {
      turnDial('program.dial', slot - state.get().bank.slot)
      expect(state.get().bank.slot).toBe(slot)
      const loaded = programOf(state.get())
      for (const key of PROGRAM_KEYS) expect(JSON.stringify(loaded[key]), `${key} of slot ${slot}`).toBe(JSON.stringify(edited[key]))
      expect(isDirty(state.get())).toBe(false)
    }
  })

  it('Master Level never enters a program', async () => {
    mounted = await mountApp()
    const { state, engine } = mounted.services
    fireEvent.keyDown(el('performance.master-level'), { key: 'Home' })
    expect(state.get().master.level).toBe(0)
    click('program.store')
    click('program.store')
    click('program.button.4')
    click('program.button.1')
    expect(state.get().master.level).toBe(0)
    expect(engine.getMasterGain()).toBe(0)
    expect(serializeProgram(programOf(state.get()))).not.toMatch(/"level":0,/)
  })
})
