import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { fakeAssetBoundary, fakeAudioBoundary, FakeGain } from '../test/fakes'
import { renderApp } from '../test/renderApp'
import {
  contiguousZoneRanges,
  InstrumentStore,
  zoneGainFor,
  type SplitState,
} from './instrument'
import { PianoEngine } from '../audio/engine'

/**
 * scenes.switching / splits.zones — Layer Scenes I/II swap enable
 * configurations without touching sound parameters; splits partition the
 * keybed into up to 4 zones with 3 editable points, 11 documented positions
 * and Off/±6/±12 crossfades that audibly route notes.
 */

function makeSystem() {
  const setup = fakeAudioBoundary()
  const store = new InstrumentStore()
  const engine = new PianoEngine(setup.boundary, { assets: fakeAssetBoundary() })
  engine.attachStore(store)
  return { ...setup, store, engine }
}

function split(points: Array<{ note: number; xf: 0 | 6 | 12 }>): SplitState {
  const template: SplitState['points'] = [
    { active: false, note: 48, xf: 0 },
    { active: false, note: 60, xf: 0 },
    { active: false, note: 72, xf: 0 },
  ]
  points.forEach((p, i) => (template[i] = { active: true, note: p.note, xf: p.xf }))
  return { on: true, points: template }
}

describe('scenes.switching — two enable configurations, shared parameters', () => {
  it('Scene II swaps layer enables and back without losing sound parameters', () => {
    const store = new InstrumentStore()
    // Scene I: piano A+B on; edit a sound parameter too.
    store.toggleLayerEnabled('B')
    store.cycleUnison()
    store.toggleLayerScene()
    let state = store.getState()
    expect(state.scenes.active).toBe('II')
    expect(state.layers.A.enabled).toBe(true) // default stored scene
    expect(state.layers.B.enabled).toBe(false)
    expect(state.piano.unison).toBe(1) // sound parameters are shared
    // Configure scene II differently, then toggle back and forth.
    store.setLayerEnabled('B', true)
    store.setLayerEnabled('A', false)
    store.toggleLayerScene() // back to scene I
    state = store.getState()
    expect(state.scenes.active).toBe('I')
    expect(state.layers.A.enabled).toBe(true)
    expect(state.layers.B.enabled).toBe(true)
    store.toggleLayerScene() // scene II remembers its own enables
    state = store.getState()
    expect(state.layers.A.enabled).toBe(false)
    expect(state.layers.B.enabled).toBe(true)
    expect(state.piano.unison).toBe(1)
  })

  it('the LAYER SCENE II button lights for the active scene and is program state', () => {
    renderApp()
    const button = screen.getByRole('button', { name: 'Layer Scene II' })
    expect(button.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(button)
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Layer Scene II/)
    expect(screen.getByTestId('oled-program-line').textContent).toMatch(/E/) // scene config is stored with the program
  })
})

describe('splits.zones — zone math', () => {
  it('no split: every layer covers the whole keybed', () => {
    const store = new InstrumentStore()
    expect(zoneGainFor(store.getState().split, { from: 0, to: 3 }, 28)).toBe(1)
    expect(zoneGainFor(store.getState().split, { from: 1, to: 1 }, 100)).toBe(1) // clamped to the one zone
  })

  it('hard split at C4: the point note starts the upper zone', () => {
    const s = split([{ note: 60, xf: 0 }])
    expect(zoneGainFor(s, { from: 0, to: 0 }, 59)).toBe(1)
    expect(zoneGainFor(s, { from: 0, to: 0 }, 60)).toBe(0)
    expect(zoneGainFor(s, { from: 1, to: 1 }, 60)).toBe(1)
    expect(zoneGainFor(s, { from: 1, to: 1 }, 59)).toBe(0)
    expect(zoneGainFor(s, { from: 0, to: 1 }, 60)).toBe(1) // spans both zones
  })

  it('±6 crossfade: adjacent layers fade complementarily across the point', () => {
    const s = split([{ note: 60, xf: 6 }])
    const low = (midi: number) => zoneGainFor(s, { from: 0, to: 0 }, midi)
    const high = (midi: number) => zoneGainFor(s, { from: 1, to: 1 }, midi)
    expect(low(53)).toBe(1)
    expect(high(53)).toBe(0)
    expect(low(60)).toBeCloseTo(0.5, 5)
    expect(high(60)).toBeCloseTo(0.5, 5)
    expect(low(67)).toBe(0)
    expect(high(67)).toBe(1)
    for (const midi of [55, 58, 60, 63, 65]) {
      expect(low(midi) + high(midi), `midi ${midi}`).toBeCloseTo(1, 5)
    }
  })

  it('three active points make four zones with independent crossfades', () => {
    const s = split([
      { note: 48, xf: 0 },
      { note: 60, xf: 6 },
      { note: 72, xf: 12 },
    ])
    expect(zoneGainFor(s, { from: 0, to: 0 }, 40)).toBe(1)
    expect(zoneGainFor(s, { from: 1, to: 1 }, 50)).toBe(1)
    // Zone 3's upper ±12 fade spans 60..84, so midi 66 already tapers: 18/24.
    expect(zoneGainFor(s, { from: 2, to: 2 }, 66)).toBeCloseTo(0.75, 5)
    expect(zoneGainFor(s, { from: 3, to: 3 }, 90)).toBe(1)
    expect(zoneGainFor(s, { from: 3, to: 3 }, 72)).toBeCloseTo(0.5, 5) // ±12 fade center
    expect(contiguousZoneRanges(4)).toHaveLength(10)
  })
})

describe('splits.zones — engine routing and panel editing', () => {
  it('zones audibly route notes: each layer only voices inside its range', () => {
    const { engine, store } = makeSystem()
    store.setPianoSectionOn(true)
    store.toggleLayerEnabled('B') // both piano layers on
    store.toggleSplit() // Mid split at C4, hard
    // A takes the lower zone, B the upper.
    store.setSplitEdit(true)
    store.setSplitEdit(false)
    const layers = store.getState().layers
    store.getState() // A default zone [0,3] clamps to both zones; assign explicitly:
    store.cycleLayerZone('piano', 'A', -1) // step A toward [0,0]
    while (store.getState().layers.A.zone.from !== 0 || store.getState().layers.A.zone.to !== 0) {
      store.cycleLayerZone('piano', 'A', -1)
    }
    store.setFocusedLayer('B')
    while (store.getState().layers.B.zone.from !== 1 || store.getState().layers.B.zone.to !== 1) {
      store.cycleLayerZone('piano', 'B', 1)
    }
    void layers
    engine.ensureStarted()
    engine.noteOn(48, 0.8) // below the split: layer A only
    expect(engine.layerVoiceCount('A')).toBe(1)
    expect(engine.layerVoiceCount('B')).toBe(0)
    engine.noteOn(72, 0.8) // above the split: layer B only
    expect(engine.layerVoiceCount('A')).toBe(1)
    expect(engine.layerVoiceCount('B')).toBe(1)
  })

  it('crossfaded notes start voices in both layers with complementary levels', () => {
    const { engine, store, getContext } = makeSystem()
    store.toggleLayerEnabled('B')
    store.toggleSplit()
    store.setSplitEdit(true)
    store.cycleSplitXf() // Mid: ±6
    store.setSplitEdit(false)
    while (store.getState().layers.A.zone.to !== 0) store.cycleLayerZone('piano', 'A', -1)
    while (store.getState().layers.B.zone.from !== 1 || store.getState().layers.B.zone.to !== 1) {
      store.cycleLayerZone('piano', 'B', 1)
    }
    engine.ensureStarted()
    const context = getContext()!
    const peaksFor = (midi: number): number[] => {
      const before = context.nodes.length
      engine.noteOn(midi, 0.8)
      const gains = context.nodes.slice(before).filter((n): n is FakeGain => n instanceof FakeGain)
      engine.noteOff(midi)
      return gains.map((g) => g.gain.maxScheduled()).filter((v) => v > 0.0001)
    }
    // Dead center: both layers voice at reduced level.
    const centerPeaks = peaksFor(60)
    expect(engine.layerVoiceCount('A')).toBe(0) // released
    expect(centerPeaks.length).toBeGreaterThanOrEqual(2)
    // Far below: one layer only, at full level (higher peak than the faded center voices).
    const lowPeaks = peaksFor(50)
    expect(Math.max(...lowPeaks)).toBeGreaterThan(Math.max(...centerPeaks) * 1.5)
  })

  it('a synth layer zoned to the upper zone does not voice below the split', () => {
    const { engine, store } = makeSystem()
    store.setPianoSectionOn(false)
    store.setSynthSectionOn(true)
    store.toggleSplit() // Mid split at C4, hard
    store.setSplitEdit(true)
    store.setSplitEdit(false)
    store.setSynthFocusedLayer('A')
    while (store.getState().synth.layers.A.zone.from !== 1 || store.getState().synth.layers.A.zone.to !== 1) {
      store.cycleLayerZone('synth', 'A', 1) // step A toward [1,1], the upper zone
    }
    engine.ensureStarted()
    engine.noteOn(48, 0.8) // below the split: layer A is zoned out
    expect(engine.layerVoiceCount('A', 'synth')).toBe(0)
    engine.noteOn(72, 0.8) // above the split: inside A's zone
    expect(engine.layerVoiceCount('A', 'synth')).toBe(1)
  })

  it('toggleLayerScene swaps synth layer enables too, and scene II remembers its own configuration', () => {
    const store = new InstrumentStore()
    store.setSynthSectionOn(true)
    expect(store.getState().synth.layers.A.enabled).toBe(true)
    expect(store.getState().synth.layers.B.enabled).toBe(false)
    store.toggleLayerScene() // Scene I -> II
    expect(store.getState().scenes.active).toBe('II')
    // Scene II starts from the same default synth enables (a fresh stored copy).
    expect(store.getState().synth.layers.A.enabled).toBe(true)
    expect(store.getState().synth.layers.B.enabled).toBe(false)
    // Configure scene II's synth layers differently.
    store.toggleSynthLayerEnabled('B')
    store.toggleSynthLayerEnabled('A')
    expect(store.getState().synth.layers.A.enabled).toBe(false)
    expect(store.getState().synth.layers.B.enabled).toBe(true)
    store.toggleLayerScene() // back to scene I: untouched synth enables
    expect(store.getState().scenes.active).toBe('I')
    expect(store.getState().synth.layers.A.enabled).toBe(true)
    expect(store.getState().synth.layers.B.enabled).toBe(false)
    store.toggleLayerScene() // scene II remembers what we configured
    expect(store.getState().synth.layers.A.enabled).toBe(false)
    expect(store.getState().synth.layers.B.enabled).toBe(true)
  })

  it('the split editor drives points from the panel: position, active, crossfade', async () => {
    renderApp()
    const splitButton = screen.getByRole('button', { name: 'Split On/Set' })
    fireEvent.click(splitButton)
    expect(splitButton.getAttribute('aria-pressed')).toBe('true')
    // Press-and-hold opens the editor on the MID point (the manual's own ⑥
    // hold gesture, p. 39); the trailing click is suppressed by the hold.
    const shift = screen.getByRole('button', { name: 'Shift/Exit' })
    fireEvent.pointerDown(splitButton, { pointerId: 1 })
    await new Promise((resolve) => setTimeout(resolve, 600))
    fireEvent.pointerUp(splitButton, { pointerId: 1 })
    fireEvent.click(splitButton)
    expect(screen.getByTestId('oled-split-line').textContent).toMatch(/SPLIT ON — MID ● C4/)
    // Dial chooses among the 11 documented positions.
    const dial = screen.getByRole('slider', { name: 'Program Dial' })
    fireEvent.keyDown(dial, { key: 'End' })
    expect(screen.getByTestId('oled-split-line').textContent).toMatch(/MID ● C7/)
    // PROG 2 cycles the crossfade; PAGE moves to another point; PROG 1 activates it.
    fireEvent.click(screen.getByRole('button', { name: 'Program 2' }))
    expect(screen.getByTestId('oled-split-line').textContent).toMatch(/XF ±6/)
    fireEvent.click(screen.getByRole('button', { name: 'Page/Cat Left' }))
    expect(screen.getByTestId('oled-split-line').textContent).toMatch(/LOW ○/)
    fireEvent.click(screen.getByRole('button', { name: 'Program 1' }))
    expect(screen.getByTestId('oled-split-line').textContent).toMatch(/LOW ●/)
    // Shift exits the editor; split markers sit above the keybed at active points.
    fireEvent.click(shift)
    expect(screen.queryByTestId('oled-split-line')).toBeNull()
    const markers = document.querySelectorAll('.split-marker')
    expect(markers).toHaveLength(2) // LOW (C3 default) + MID (C7 now)
    expect(document.querySelector('[data-split-note="96"]')).toBeTruthy()
  })

  it('SET KEY (Shift + Split, manual p. 39) nudges the selected split point to the next position', () => {
    renderApp()
    const splitButton = screen.getByRole('button', { name: 'Split On/Set' })
    fireEvent.click(splitButton) // split on (MID at C4)
    const shift = screen.getByRole('button', { name: 'Shift/Exit' })
    fireEvent.click(shift)
    fireEvent.click(splitButton) // SET KEY: C4 -> F4
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Set Key — Split MID: F4/)
    fireEvent.click(splitButton)
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Set Key — Split MID: C5/)
    // The split marker above the keybed follows the nudged point.
    expect(document.querySelector('[data-split-note="72"]')).toBeTruthy() // C5 = midi 72
  })

  it('SET KEY moves the split editor\'s selected point while the editor is open', () => {
    const store = new InstrumentStore()
    store.toggleSplit()
    store.setSplitEdit(true)
    store.selectSplitPoint(-1) // LOW selected
    const before = store.getState().split.points[0].note
    store.nudgeSplitPoint()
    expect(store.getState().split.points[0].note).not.toBe(before)
    expect(store.getState().split.points[1].note).toBe(60) // MID untouched
    expect(store.getState().lastEdit).toMatch(/Set Key — Split LOW/)
  })

  it('KB ZONE (Shift + Octave) steps the focused layer through zone ranges with LEDs', () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Split On/Set' })) // 2 zones now
    const shift = screen.getByRole('button', { name: 'Shift/Exit' })
    fireEvent.click(shift)
    fireEvent.click(screen.getByRole('button', { name: 'Piano Octave Shift Down' }))
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Piano A KB Zone/)
    fireEvent.click(shift)
    // Plain octave press still shifts the octave, not the zone.
    fireEvent.click(screen.getByRole('button', { name: 'Piano Octave Shift Up' }))
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Piano A Octave/)
  })

  it('splits and scenes are part of the program snapshot (roundtrip + factory demo)', () => {
    const store = new InstrumentStore()
    store.toggleSplit()
    store.toggleLayerScene()
    expect(store.getState().programs.dirty).toBe(true)
    store.storePress()
    store.storePress() // store into 1.1
    store.selectProgram(3)
    expect(store.getState().split.on).toBe(false)
    store.selectProgram(0)
    expect(store.getState().split.on).toBe(true)
    expect(store.getState().scenes.active).toBe('II')
    // Factory split demo program routes organ low / EP high.
    store.selectProgram(8)
    const state = store.getState()
    expect(state.programs.bank[8]!.name).toBe('Bass & Tines')
    expect(state.split.on).toBe(true)
    expect(state.organ.layers.A.zone).toEqual({ from: 0, to: 0 })
    expect(state.layers.A.zone).toEqual({ from: 1, to: 1 })
  })
})

/**
 * SOLO (manual p. 18): "Press the On button for roughly half a second to
 * perform a SOLO operation, which activates only [that section]" — either by
 * holding a section's ON button (PanelButton's holdAction) or, for
 * keyboards that can't long-press, Shift + click on the same button.
 */
describe('solo — activates only the pressed section', () => {
  it('soloSection round-trips through the program snapshot and sets exactly one section on', () => {
    const store = new InstrumentStore()
    store.setOrganSectionOn(true)
    store.setSynthSectionOn(true)
    expect(store.getState().piano.sectionOn).toBe(true) // default on
    store.soloSection('organ')
    let state = store.getState()
    expect(state.piano.sectionOn).toBe(false)
    expect(state.organ.sectionOn).toBe(true)
    expect(state.synth.sectionOn).toBe(false)
    expect(state.lastEdit).toBe('Solo Organ')
    expect(state.programs.dirty).toBe(true) // sectionOn fields are snapshot state

    store.soloSection('synth')
    state = store.getState()
    expect(state.piano.sectionOn).toBe(false)
    expect(state.organ.sectionOn).toBe(false)
    expect(state.synth.sectionOn).toBe(true)

    // Round-trips through Store/recall like any other snapshot field.
    store.storePress()
    store.storePress() // store into 1.1
    store.setPianoSectionOn(true) // dirty the live state away from the stored solo
    store.selectProgram(1)
    store.selectProgram(0)
    expect(store.getState().synth.sectionOn).toBe(true)
    expect(store.getState().piano.sectionOn).toBe(false)
  })

  it('Shift + click on a section ON button SOLOs it (keyboard-accessible path)', () => {
    renderApp()
    const shift = screen.getByRole('button', { name: 'Shift/Exit' })
    const organOn = screen.getByRole('button', { name: 'Organ Section On' })
    fireEvent.click(organOn) // Organ on (Piano already on by default)
    fireEvent.click(shift)
    fireEvent.click(organOn) // Shift + click SOLOs Organ
    fireEvent.click(shift)
    expect(screen.getByTestId('oled-edit-line').textContent).toBe('Solo Organ')
    // A plain click still performs the normal on/off toggle.
    fireEvent.click(organOn)
    expect(screen.getByTestId('oled-edit-line').textContent).toBe('Organ Section Off')
  })

  it('holding the ON button ~500ms SOLOs; a quick click keeps the normal toggle', async () => {
    renderApp()
    const pianoOn = screen.getByRole('button', { name: 'Piano Section On' })
    const organOn = screen.getByRole('button', { name: 'Organ Section On' })
    fireEvent.click(organOn) // Organ on too, so solo has something to turn off

    // A quick click (well under the hold threshold) keeps the normal toggle.
    fireEvent.pointerDown(pianoOn, { pointerId: 1 })
    fireEvent.pointerUp(pianoOn, { pointerId: 1 })
    fireEvent.click(pianoOn)
    expect(screen.getByTestId('oled-edit-line').textContent).toBe('Piano Section Off')
    fireEvent.click(pianoOn) // back on

    // A held press (>= 500ms) fires SOLO instead, and suppresses the trailing click's toggle.
    fireEvent.pointerDown(pianoOn, { pointerId: 1 })
    await new Promise((resolve) => setTimeout(resolve, 600))
    fireEvent.pointerUp(pianoOn, { pointerId: 1 })
    fireEvent.click(pianoOn)
    expect(screen.getByTestId('oled-edit-line').textContent).toBe('Solo Piano')
    expect(screen.getByRole('button', { name: 'Organ Section On' })).not.toHaveAttribute('data-lit')
  }, 10000)
})
