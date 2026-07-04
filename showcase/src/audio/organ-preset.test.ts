import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { fakeAssetBoundary, fakeAudioBoundary, FakeGain, fakeStorageBoundary } from '../test/fakes'
import { renderApp } from '../test/renderApp'
import { InstrumentStore } from '../state/instrument'
import { DRAWBAR_INITIAL } from '../model/hardware'
import { PianoEngine } from './engine'

/**
 * organ.preset-drawbar-live — PRESET On/Off ("Drawbar Live") and SYNC
 * (manual p. 19/21): Preset On sounds the Program's stored registration and
 * lights the LED graphs; Preset Off sounds the ONE physical drawbar pose
 * with the LED graphs dark; SYNC (Shift + Preset) copies the pose into the
 * Program. Morphs are not applicable in Drawbar Live mode (manual p. 39).
 * Rendered-audio proof lives in render-organ.test.ts.
 */
function makeSystem() {
  const setup = fakeAudioBoundary()
  const store = new InstrumentStore()
  const engine = new PianoEngine(setup.boundary, { assets: fakeAssetBoundary() })
  engine.attachStore(store)
  store.setPianoSectionOn(false)
  store.setOrganSectionOn(true)
  return { ...setup, store, engine }
}

describe('organ.preset-drawbar-live — state and engine', () => {
  it('PRESET toggles Preset On/Off for the focused layer only', () => {
    const store = new InstrumentStore()
    store.setOrganSectionOn(true)
    expect(store.getState().organ.layers.A.presetOn).toBe(true)
    expect(store.getState().organ.layers.B.presetOn).toBe(true)
    store.toggleOrganPreset()
    expect(store.getState().organ.layers.A.presetOn).toBe(false)
    expect(store.getState().organ.layers.B.presetOn).toBe(true)
    store.setOrganFocusedLayer('B')
    store.toggleOrganPreset()
    expect(store.getState().organ.layers.A.presetOn).toBe(false)
    expect(store.getState().organ.layers.B.presetOn).toBe(false)
    store.toggleOrganPreset()
    expect(store.getState().organ.layers.A.presetOn).toBe(false)
    expect(store.getState().organ.layers.B.presetOn).toBe(true)
  })

  it('a Drawbar Live layer sounds from the physical pose; the stored registration and dirty flag stay untouched', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const registration = [8, 0, 0, 0, 0, 0, 0, 0, 0]
    // Preset mode drags write pose AND registration, so both start equal.
    registration.forEach((value, index) => store.setOrganDrawbar(index, value))
    store.toggleOrganPreset() // layer A -> Drawbar Live
    store.storePress()
    store.storePress() // store so the program is clean
    expect(store.getState().programs.dirty).toBe(false)

    const context = getContext()!
    const before = context.nodes.length
    engine.noteOn(60, 0.8)
    const partialGains = context.nodes.slice(before).filter((n): n is FakeGain => n instanceof FakeGain)
    const values = () => partialGains.map((g) => +g.gain.value.toFixed(6))
    const initial = values()
    store.setOrganDrawbar(5, 8) // physical 2' pull mid-note (pose only)
    const pulled = values()
    expect(pulled).not.toEqual(initial)
    expect(store.getState().organDrawbarPose[5]).toBe(8)
    // The Program heard nothing: registration untouched, no dirty edit.
    expect(store.getState().organ.layers.A.drawbars).toEqual(registration)
    expect(store.getState().programs.dirty).toBe(false)
    // Back in Preset mode the stored registration sounds again.
    store.toggleOrganPreset()
    expect(values()).toEqual(initial)
  })

  it('SYNC copies the physical pose into the stored registration as one ordinary dirty edit, leaving Preset state untouched', () => {
    const store = new InstrumentStore()
    store.setOrganSectionOn(true)
    store.toggleOrganPreset() // Drawbar Live
    store.setOrganDrawbar(4, 7) // pose-only move
    store.storePress()
    store.storePress()
    expect(store.getState().programs.dirty).toBe(false)
    expect(store.getState().organ.layers.A.drawbars[4]).not.toBe(7)
    store.syncOrganDrawbars()
    expect(store.getState().organ.layers.A.drawbars).toEqual(store.getState().organDrawbarPose)
    expect(store.getState().organ.layers.A.drawbars[4]).toBe(7)
    expect(store.getState().programs.dirty).toBe(true)
    // p. 21 specifies only the copy: the layer stays in Drawbar Live.
    expect(store.getState().organ.layers.A.presetOn).toBe(false)
  })

  it('drawbar morph writes are inapplicable for a Live layer (manual p. 39)', () => {
    const store = new InstrumentStore()
    store.setOrganSectionOn(true)
    store.recordMorphEdit('wheel', 'organ-drawbar-9', 'A', 0, 8) // assigned in Preset mode
    store.toggleOrganPreset() // layer A -> Drawbar Live
    store.setMorphSource('wheel', 127)
    expect(store.getState().organ.layers.A.drawbars[8]).toBe(DRAWBAR_INITIAL[8]) // gated: unchanged
    store.toggleOrganPreset() // back to Preset mode: the morph applies again
    store.setMorphSource('wheel', 0)
    expect(store.getState().organ.layers.A.drawbars[8]).toBe(0)
    store.setMorphSource('wheel', 127)
    expect(store.getState().organ.layers.A.drawbars[8]).toBe(8)
  })

  it('presetOn round-trips through Store and program load', () => {
    const store = new InstrumentStore()
    store.toggleOrganPreset()
    store.storePress()
    store.storePress()
    store.selectProgram(5)
    expect(store.getState().organ.layers.A.presetOn).toBe(true)
    store.selectProgram(0)
    expect(store.getState().organ.layers.A.presetOn).toBe(false)
    expect(store.getState().organ.layers.B.presetOn).toBe(true)
  })

  it('old persisted snapshots without presetOn backfill to Preset On (hardware default), and the pose boots from the restored program', () => {
    const seed = new InstrumentStore()
    const strip = (slot: { name: string; snapshot: unknown }) => {
      const snapshot = JSON.parse(JSON.stringify(slot.snapshot)) as {
        organ: { layers: Record<string, Record<string, unknown>> }
      }
      for (const layer of Object.values(snapshot.organ.layers)) delete layer.presetOn
      return { name: slot.name, snapshot }
    }
    const rawBank = seed.getState().programs.bank.map(strip)
    const rawLive = seed.getState().programs.live.map(strip)
    const storage = fakeStorageBoundary({
      'stagebench.programs.v1': JSON.stringify({ version: 1, bank: rawBank, live: rawLive, liveMode: false, current: 2 }),
    })
    expect(() => new InstrumentStore(storage)).not.toThrow()
    const restored = new InstrumentStore(storage)
    expect(restored.getState().organ.layers.A.presetOn).toBe(true)
    expect(restored.getState().organ.layers.B.presetOn).toBe(true)
    // The never-persisted physical pose boots from the restored program's
    // focused organ layer so nothing jumps.
    expect(restored.getState().organDrawbarPose).toEqual(restored.getState().organ.layers.A.drawbars)
    expect(() => restored.selectProgram(10)).not.toThrow()
    expect(restored.getState().organ.layers.A.presetOn).toBe(true)
  })
})

describe('organ.preset-drawbar-live — panel', () => {
  it('Drawbar Live darkens every drawbar LED graph while the caps follow the physical pose; SYNC writes the pose back', () => {
    renderApp()
    const litCount = () => document.querySelectorAll('.drawbar-ladder .led[data-on="true"]').length
    expect(litCount()).toBeGreaterThan(0) // Preset On: stored registration lights the graphs
    const preset = screen.getByRole('button', { name: 'Organ Preset' })
    fireEvent.click(preset)
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Organ A Preset Off — Drawbar Live/)
    expect(litCount()).toBe(0) // manual p. 19/21: "the drawbar LEDs are all unlit"
    // The cap did not jump: the pose boots matching the loaded registration.
    const drawbar1 = screen.getByRole('slider', { name: 'Drawbar 1 (16′)' })
    expect(drawbar1.getAttribute('aria-valuenow')).toBe(String(DRAWBAR_INITIAL[0]))
    // A Live drag moves the cap and the sound source, never the Program.
    fireEvent.keyDown(drawbar1, { key: 'End' })
    expect(drawbar1.getAttribute('aria-valuenow')).toBe('8')
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Drawbar 1: 8 \(Live\)/)
    expect(litCount()).toBe(0)
    // SYNC = Shift + Preset copies the pose into the Program.
    const shift = screen.getByRole('button', { name: 'Shift/Exit' })
    fireEvent.click(shift)
    fireEvent.click(preset)
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Organ A SYNC/)
    fireEvent.click(shift)
    // Back to Preset On: the synced registration lights up and holds the cap.
    fireEvent.click(preset)
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Organ A Preset On/)
    expect(drawbar1.getAttribute('aria-valuenow')).toBe('8')
    expect(litCount()).toBeGreaterThan(0)
  })

  it('an armed morph source captures nothing from a Live drawbar drag (manual p. 39)', () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Organ Preset' })) // Drawbar Live
    fireEvent.click(screen.getByRole('button', { name: 'Morph Assign Wheel' })) // arm
    const drawbar9 = screen.getByRole('slider', { name: 'Drawbar 9 (1′)' })
    fireEvent.keyDown(drawbar9, { key: 'End' })
    // The OLED shows the Live drag itself, not a morph capture, and the
    // control carries no morph tag.
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Drawbar 9: 8 \(Live\)/)
    expect(drawbar9.dataset.morphed).toBeUndefined()
  })
})
