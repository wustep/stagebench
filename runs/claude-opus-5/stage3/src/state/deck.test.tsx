import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { DEFAULT_SETTINGS } from '../audio/settings'
import { peak, relativeDifference, rms } from '../audio/offline'
import { UNSUPPORTED_CONTROL_IDS, control } from '../model/controls'
import { createRig } from '../test/harness'
import {
  deckReducer,
  initialDeckState,
  tapTempoValue,
  type DeckState,
  type HardwareAction,
} from './hardware'
import { deriveSettings } from './settings'

function run(actions: HardwareAction[], from: DeckState = initialDeckState()): DeckState {
  return actions.reduce(deckReducer, from)
}

const press = (id: string, at?: number): HardwareAction => ({ type: 'activate', id, at })
const set = (id: string, value: number): HardwareAction => ({ type: 'set', id, value })

/** Feature: effects.routing */
describe('panel state maps to engine settings', () => {
  it('starts the engine from exactly the values the panel prints', () => {
    expect(deriveSettings(initialDeckState())).toEqual(DEFAULT_SETTINGS)
  })

  it('moves a knob into the derived settings', () => {
    const deck = run([set('fx.reverb.dry-wet', 9), press('fx.reverb.on'), set('perf.master-level', 3)])
    const settings = deriveSettings(deck)
    expect(settings.layers.a.chain.reverb.mix).toBeCloseTo(0.9, 6)
    expect(settings.layers.a.chain.reverb.on).toBe(true)
    expect(settings.masterLevel).toBeCloseTo(0.3, 6)
  })

  it('keeps a separate effect bank per piano layer, swapped by focus', () => {
    // Edit layer A, then move focus to B: B still holds its own values.
    const edited = run([press('fx.reverb.on'), set('fx.reverb.dry-wet', 10)])
    expect(deriveSettings(edited).layers.a.chain.reverb.on).toBe(true)
    expect(deriveSettings(edited).layers.b.chain.reverb.on).toBe(false)

    const focusedB = run([press('fx.focus.piano')], edited)
    expect(focusedB.focus).toBe('b')
    expect(focusedB.values['fx.reverb.on']).toBe(0)
    // Editing B leaves A alone.
    const editedB = run([press('fx.mod2.on')], focusedB)
    expect(deriveSettings(editedB).layers.b.chain.mod2.on).toBe(true)
    expect(deriveSettings(editedB).layers.a.chain.mod2.on).toBe(false)
    expect(deriveSettings(editedB).layers.a.chain.reverb.on).toBe(true)

    // Returning to A shows A's panel again.
    const backToA = run([press('fx.focus.piano')], editedB)
    expect(backToA.focus).toBe('a')
    expect(backToA.values['fx.reverb.on']).toBe(1)
    expect(backToA.values['fx.mod2.on']).toBe(0)
  })

  it('moves the effect focus when a layer is switched on', () => {
    const deck = run([press('piano.b.on')])
    expect(deck.focus).toBe('b')
    expect(deck.values['fx.focus.piano']).toBe(1)
    expect(deriveSettings(deck).layers.b.enabled).toBe(true)
  })

  it('shares one setting across both piano layers in Group mode', () => {
    const grouped = run([press('fx.shift'), press('fx.focus.piano')])
    expect(grouped.group).toBe(true)
    // Shift is a one-shot, exactly like the panel's SHIFT button.
    expect(grouped.values['fx.shift']).toBe(0)

    const edited = run([press('fx.mod1.on'), set('fx.mod1.rate', 8)], grouped)
    const settings = deriveSettings(edited)
    expect(settings.layers.a.chain.mod1.on).toBe(true)
    expect(settings.layers.b.chain.mod1.on).toBe(true)
    expect(settings.layers.b.chain.mod1.rate).toBeCloseTo(0.8, 6)
  })

  it('applies a global unit to every layer while the others stay per layer', () => {
    const global = run([press('fx.shift'), press('fx.delay.on')])
    expect(global.globals.delay).toBe(true)
    const edited = run([press('fx.delay.on'), set('fx.delay.dry-wet', 9), press('fx.reverb.on')], global)
    const settings = deriveSettings(edited)
    // Delay is global: both layers get it.
    expect(settings.layers.a.chain.delay.mix).toBeCloseTo(0.9, 6)
    expect(settings.layers.b.chain.delay.mix).toBeCloseTo(0.9, 6)
    expect(settings.layers.a.chain.delay.on).toBe(true)
    expect(settings.layers.b.chain.delay.on).toBe(true)
    // Reverb is not: only the focused layer changed.
    expect(settings.layers.a.chain.reverb.on).toBe(true)
    expect(settings.layers.b.chain.reverb.on).toBe(false)
  })

  it('offers the Dyno timbres only while an electric piano is selected', () => {
    const acoustic = initialDeckState()
    let deck = acoustic
    const seen: number[] = []
    for (let index = 0; index < 5; index += 1) {
      deck = run([press('piano.timbre')], deck)
      seen.push(deck.values['piano.timbre'])
    }
    // Grand: Off, Soft, Mid, Bright and back to Off — no Dyno positions.
    expect(seen).toEqual([1, 2, 3, 0, 1])

    // Electric piano: the button reaches the two Dyno settings.
    let electric = run([press('piano.type'), press('piano.type')])
    expect(electric.values['piano.type']).toBe(2)
    for (let index = 0; index < 5; index += 1) electric = run([press('piano.timbre')], electric)
    expect(electric.values['piano.timbre']).toBe(5)
    expect(deriveSettings(electric).layers.a.timbre).toBe('dyno2')

    // Switching back to an acoustic type drops the unavailable timbre instead of faking it.
    const backToGrand = run([press('piano.type'), press('piano.type'), press('piano.type'), press('piano.type')], electric)
    expect(backToGrand.values['piano.type']).toBe(0)
    expect(deriveSettings(backToGrand).layers.a.timbre).toBe('off')
  })

  it('stops the MODEL dial at the last model the selected type actually has', () => {
    // Grand ships two voicings; the dial's own range goes to 8, and it must not run past them.
    const spun = run([{ type: 'set', id: 'piano.model', value: 6 }])
    expect(spun.values['piano.model']).toBe(1)
    expect(deriveSettings(spun).layers.a.model).toBe(1)

    // Clav has one model, so selecting it pulls the dial back to it.
    const clav = run([press('piano.type'), press('piano.type'), press('piano.type')], spun)
    expect(clav.values['piano.type']).toBe(3)
    expect(clav.values['piano.model']).toBe(0)
  })

  it('shifts octaves on the focused layer only, within its travel', () => {
    const up = run([press('piano.octave-up')])
    expect(up.octaves).toEqual({ a: 12, b: 0 })
    expect(deriveSettings(up).layers.a.octave).toBe(12)

    const clamped = run([press('piano.octave-up'), press('piano.octave-up')], up)
    expect(clamped.octaves.a).toBe(12)

    const focusB = run([press('fx.focus.piano'), press('piano.octave-down')], up)
    expect(focusB.octaves).toEqual({ a: 12, b: -12 })
  })

  it('takes the delay tempo from two taps', () => {
    expect(tapTempoValue(null, 1000)).toBeNull()
    expect(tapTempoValue(1000, 1050)).toBeNull() // too fast to be a tempo
    expect(tapTempoValue(1000, 9000)).toBeNull() // too slow
    const deck = run([press('fx.delay.tap', 1000), press('fx.delay.tap', 1600)])
    const tempo = deck.values['fx.delay.tempo']
    expect(tempo).toBeGreaterThan(4)
    expect(deriveSettings(deck).layers.a.chain.delay.tempo).toBeCloseTo(tempo / 10, 6)
  })

  it('leaves the spec-excluded controls out of the engine settings entirely', () => {
    // Phase 3 replaces the Phase 2 list (which was every Organ/Synth/Program control) with the
    // controls that are still decorative because an assigned spec excludes them. The invariant
    // is the same: operating a decorative control cannot reach the engine.
    const base = deriveSettings(initialDeckState())
    const fiddled = run([...UNSUPPORTED_CONTROL_IDS.keys()].map((id) => press(id)))
    expect([...UNSUPPORTED_CONTROL_IDS.keys()]).toHaveLength(9)
    expect(deriveSettings(fiddled)).toEqual(base)
  })
})

/** Features: piano.velocity-controls, effects.routing — through the rendered panel. */
describe('the rendered panel drives the audio graph', () => {
  it('changes the rendered signal when a functional control is operated', async () => {
    const rig = createRig()
    const { container } = render(<App boundaries={rig.boundaries} />)
    const key = container.querySelector('#key-60')! as HTMLElement

    fireEvent.pointerDown(key, { pointerId: 1, button: 0, pointerType: 'mouse', clientX: 0, clientY: 0 })
    const before = rig.graph.render(0.8)
    expect(peak(before)).toBeGreaterThan(0)

    // Turn the reverb on from the panel and play the same note again.
    const reverb = container.querySelector('[data-control-id="fx.reverb.on"]')! as HTMLElement
    fireEvent.click(reverb)
    await waitFor(() => expect(reverb).toHaveAttribute('aria-pressed', 'true'))
    const after = rig.graph.render(0.8)
    expect(relativeDifference(before, after)).toBeGreaterThan(0.02)
  })

  it('takes the master level knob down to silence', async () => {
    const rig = createRig()
    const { container } = render(<App boundaries={rig.boundaries} />)
    const key = container.querySelector('#key-64')! as HTMLElement
    fireEvent.pointerDown(key, { pointerId: 2, button: 0, pointerType: 'mouse', clientX: 0, clientY: 0 })
    expect(rms(rig.graph.render(0.5))).toBeGreaterThan(0)

    const knob = container.querySelector('[data-control-id="perf.master-level"]')! as HTMLElement
    fireEvent.keyDown(knob, { key: 'Home' })
    await waitFor(() => expect(Number(knob.getAttribute('aria-valuenow'))).toBe(control('perf.master-level').min))
    // Rendered after the click-free ramp has settled.
    expect(peak(rig.graph.render(0.6), 8000)).toBe(0)
  })

  it('shows the focused layer, its model and where the sound comes from', async () => {
    const { container } = render(<App boundaries={createRig().boundaries} />)
    const display = container.querySelector('[data-oled="program"]')!
    expect(display.textContent).toMatch(/PIANO A · GRAND/i)
    expect(display.textContent).toMatch(/CONCERT GRAND YDP/i)
    // No sample assets in the test rig, so it says so rather than claiming recordings.
    expect(display.textContent).toMatch(/FALLBACK VOICE/i)
    expect(screen.getByText(/labelled synthesised fallback voice/i)).toBeInTheDocument()

    fireEvent.click(container.querySelector('[data-control-id="fx.focus.piano"]')! as HTMLElement)
    await waitFor(() => expect(display.textContent).toMatch(/PIANO B/i))
  })

  it('reports a synthesised type as synthesised, never as a recording', async () => {
    const { container } = render(<App boundaries={createRig().boundaries} />)
    const display = container.querySelector('[data-oled="program"]')!
    const type = container.querySelector('[data-control-id="piano.type"]')! as HTMLElement
    for (let index = 0; index < 3; index += 1) fireEvent.click(type)
    await waitFor(() => expect(display.textContent).toMatch(/CLAV/i))
    expect(display.textContent).toMatch(/SYNTHESISED/i)
    expect(display.textContent).not.toMatch(/RECORDED/i)
  })
})
