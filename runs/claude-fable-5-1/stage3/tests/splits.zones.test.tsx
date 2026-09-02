import { fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { rms } from '../src/dsp/analysis'
import { renderEvents } from '../src/dsp/offline'
import { OrganUnit } from '../src/dsp/organ'
import { defaultOrganParams, type OrganEvent } from '../src/dsp/organTypes'
import { layerGainFor } from '../src/audio/performer'
import { SPLIT_POSITIONS, defaultSplit, defaultZones, layerNoteGain, lowerGainAt, stepZone, upperGainAt, type SplitState } from '../src/state/programState'
import { armShift, click, el, hold, mountApp, play, release, startAudio, turnDial, type Mounted } from './helpers'

let mounted: Mounted | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
})

const split = (mid: number | null, xfade = 0, low: number | null = null, high: number | null = null, on = true): SplitState => ({ on, points: { low: { note: low, xfade }, mid: { note: mid, xfade }, high: { note: high, xfade } } })

describe('splits.zones — editable split points at the 11 documented positions, up to 4 zones, note routing, Off/±6/±12 crossfade gains', () => {
  it('crossfade gains: Off switches at the split point; ±6 / ±12 fade the lower sound that many notes above it and the upper sound below it', () => {
    expect(SPLIT_POSITIONS).toEqual([36, 41, 48, 53, 60, 65, 72, 77, 84, 89, 96])
    // Off
    expect(lowerGainAt(59, 60, 0)).toBe(1)
    expect(lowerGainAt(60, 60, 0)).toBe(0)
    expect(upperGainAt(60, 60, 0)).toBe(1)
    expect(upperGainAt(59, 60, 0)).toBe(0)
    // ±6: the lower sound reaches 6 notes above the point, the upper sound 6 notes below it (manual p. 39)
    expect(lowerGainAt(60, 60, 6)).toBeCloseTo(1, 6)
    expect(lowerGainAt(63, 60, 6)).toBeCloseTo(0.5, 6)
    expect(lowerGainAt(66, 60, 6)).toBe(0)
    expect(upperGainAt(57, 60, 6)).toBeCloseTo(0.5, 6)
    expect(upperGainAt(54, 60, 6)).toBe(0)
    // ±12 is wider than ±6 at the same distance
    expect(lowerGainAt(63, 60, 12)).toBeGreaterThan(lowerGainAt(63, 60, 6))
    expect(upperGainAt(57, 60, 12)).toBeGreaterThan(upperGainAt(57, 60, 6))
    expect(lowerGainAt(72, 60, 12)).toBe(0)
    // a layer's gain from its zones: whole keyboard = 1 everywhere, lower zones vs upper zones around a Mid split at C4
    const zones = defaultZones()
    expect(layerNoteGain(split(60), zones.pianoA, 30)).toBe(1)
    expect(layerNoteGain(split(60), { from: 1, to: 2 }, 59)).toBe(1)
    expect(layerNoteGain(split(60), { from: 1, to: 2 }, 60)).toBe(0)
    expect(layerNoteGain(split(60), { from: 3, to: 4 }, 60)).toBe(1)
    expect(layerNoteGain(split(60), { from: 3, to: 4 }, 59)).toBe(0)
    expect(layerNoteGain(split(60, 12), { from: 1, to: 2 }, 66)).toBeCloseTo(0.5, 6)
    expect(layerNoteGain(split(60, 12), { from: 3, to: 4 }, 54)).toBeCloseTo(0.5, 6)
    // with the split off every layer plays everywhere; four zones with three points
    expect(layerNoteGain(split(60, 0, null, null, false), { from: 4, to: 4 }, 30)).toBe(1)
    const four = split(60, 0, 48, 72)
    expect(layerNoteGain(four, { from: 1, to: 1 }, 47)).toBe(1)
    expect(layerNoteGain(four, { from: 1, to: 1 }, 48)).toBe(0)
    expect(layerNoteGain(four, { from: 2, to: 2 }, 55)).toBe(1)
    expect(layerNoteGain(four, { from: 3, to: 3 }, 65)).toBe(1)
    expect(layerNoteGain(four, { from: 3, to: 3 }, 72)).toBe(0)
    expect(layerNoteGain(four, { from: 4, to: 4 }, 72)).toBe(1)
    // an inactive point merges its zones: zone 4 alone with High off still plays above Mid
    expect(layerNoteGain(split(60), { from: 4, to: 4 }, 61)).toBe(1)
    expect(layerNoteGain(split(60), { from: 4, to: 4 }, 59)).toBe(0)
  })

  it('KB ZONE steps move a contiguous zone range up and down and wrap back to the whole keyboard', () => {
    let z = { from: 1, to: 4 }
    z = stepZone(z, 1)
    expect(z).toEqual({ from: 2, to: 4 })
    z = stepZone(z, 1)
    expect(z).toEqual({ from: 3, to: 4 })
    z = stepZone(z, 1)
    expect(z).toEqual({ from: 4, to: 4 })
    z = stepZone(z, 1)
    expect(z).toEqual({ from: 1, to: 4 })
    expect(stepZone({ from: 1, to: 1 }, -1)).toEqual({ from: 1, to: 4 })
    expect(stepZone({ from: 2, to: 3 }, -1)).toEqual({ from: 1, to: 2 })
    expect(stepZone({ from: 2, to: 3 }, 1)).toEqual({ from: 3, to: 4 })
  })

  it('SPLIT ON/SET toggles a single Mid split at C4: the M LED and the LED above C4 light and notes route by zone', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    const procs = await startAudio(mounted)
    expect(state.get().split.on).toBe(false)
    expect(document.querySelector('.led-split-mid .led')?.className).not.toContain('lit')
    click('program.split')
    expect(state.get().split).toEqual({ on: true, points: { low: { note: null, xfade: 0 }, mid: { note: 60, xfade: 0 }, high: { note: null, xfade: 0 } } })
    expect(document.querySelector('.led-split-mid .led')?.className).toContain('lit')
    expect(document.querySelector('.led-split-low .led')?.className).not.toContain('lit')
    expect(document.querySelector('.split-strip .led-split-C4 .led')?.className).toContain('lit')
    expect(document.querySelectorAll('.split-strip .led.lit')).toHaveLength(1)
    // synth A to zones 1–2 (Shift + Octave ◀ twice from the whole keyboard → 1–4 → wrap... use ▶ then ◀)
    click('synth.on')
    armShift()
    fireEvent.pointerDown(el('synth.octave-down'), { pointerId: 1, button: 0 })
    fireEvent.pointerUp(el('synth.octave-down'), { pointerId: 1 })
    expect(state.get().zones.synthA).toEqual({ from: 1, to: 3 })
    armShift()
    fireEvent.pointerDown(el('synth.octave-down'), { pointerId: 1, button: 0 })
    fireEvent.pointerUp(el('synth.octave-down'), { pointerId: 1 })
    expect(state.get().zones.synthA).toEqual({ from: 1, to: 2 })
    expect([...document.querySelectorAll('#section-synth .zone-leds .led')].map((l) => l.className.includes('lit'))).toEqual([true, true, false, false])
    // piano A to zones 3–4
    armShift()
    fireEvent.pointerDown(el('piano.octave-up'), { pointerId: 1, button: 0 })
    fireEvent.pointerUp(el('piano.octave-up'), { pointerId: 1 })
    armShift()
    fireEvent.pointerDown(el('piano.octave-up'), { pointerId: 1, button: 0 })
    fireEvent.pointerUp(el('piano.octave-up'), { pointerId: 1 })
    expect(state.get().zones.pianoA).toEqual({ from: 3, to: 4 })
    expect([...document.querySelectorAll('#section-piano .zone-leds .led')].map((l) => l.className.includes('lit'))).toEqual([false, false, true, true])
    // below C4 only the synth plays, from C4 only the piano
    play(mounted, 55)
    expect(procs.synth.A.heldNotes()).toEqual([55])
    expect(mounted.services.engine.activeVoices()).toHaveLength(0)
    release(mounted, 55)
    play(mounted, 64)
    expect(procs.synth.A.heldNotes()).toEqual([])
    expect(mounted.services.engine.activeVoices().map((v) => [v.layer, v.midi, v.zoneGain])).toEqual([['A', 64, 1]])
    release(mounted, 64)
    // octave shift stays independent of the zone assignment
    fireEvent.pointerDown(el('piano.octave-up'), { pointerId: 1, button: 0 })
    fireEvent.pointerUp(el('piano.octave-up'), { pointerId: 1 })
    expect(state.get().piano.layers.A.octave).toBe(1)
    expect(state.get().zones.pianoA).toEqual({ from: 3, to: 4 })
    // split off → everything plays everywhere again
    click('program.split')
    play(mounted, 55)
    expect(procs.synth.A.heldNotes()).toEqual([55])
    expect(mounted.services.engine.activeVoices().filter((v) => !v.releasing)).toHaveLength(1)
    release(mounted, 55)
  })

  it('holding SPLIT opens the Keyboard Split page: soft buttons choose the row and the point, the dial steps through Off + the 11 positions and Off/±6/±12', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    click('program.split')
    hold(mounted, 'program.split')
    expect(state.get().view.mode).toBe('split')
    expect(state.get().split.on).toBe(true) // the hold did not toggle the split
    expect(el('program.oled').textContent).toMatch(/KEYBOARD SPLIT/)
    // Mid is selected; the dial moves it up the documented positions and down to Off
    turnDial('program.dial', 2)
    expect(state.get().split.points.mid.note).toBe(72)
    turnDial('program.dial', -6)
    expect(state.get().split.points.mid.note).toBe(36)
    turnDial('program.dial', -1)
    expect(state.get().split.points.mid.note).toBeNull()
    turnDial('program.dial', 5)
    expect(state.get().split.points.mid.note).toBe(60)
    // Low (soft button 2): pressing its button again toggles it Off/On; ordering Low ≤ Mid ≤ High is kept
    click('program.button.2')
    expect(state.get().view.splitPoint).toBe('low')
    click('program.button.2')
    expect(state.get().split.points.low.note).toBe(48)
    turnDial('program.dial', 5)
    expect(state.get().split.points.low.note).toBe(60) // clamped to Mid
    turnDial('program.dial', -2)
    expect(state.get().split.points.low.note).toBe(48)
    // High on at C5, xFade row: ±6 then ±12 for High
    click('program.button.4')
    click('program.button.4')
    expect(state.get().split.points.high.note).toBe(72)
    click('program.button.1')
    expect(state.get().view.splitRow).toBe('xfade')
    turnDial('program.dial', 1)
    expect(state.get().split.points.high.xfade).toBe(6)
    turnDial('program.dial', 1)
    expect(state.get().split.points.high.xfade).toBe(12)
    turnDial('program.dial', 5)
    expect(state.get().split.points.high.xfade).toBe(12)
    expect(document.querySelectorAll('.split-strip .led.lit')).toHaveLength(3)
    expect(document.querySelector('.led-split-high .led')?.className).toContain('lit')
    expect(el('program.oled').textContent).toMatch(/H C5 \(±12\)/)
    click('program.shift')
    expect(state.get().view.mode).toBe('program')
    // the crossfade is audible in the routing gains: a piano on zone 3 fades in over the 12 notes above C4… and below C5 for zone 4
    const p = state.get()
    expect(layerGainFor({ ...p, zones: { ...p.zones, pianoA: { from: 4, to: 4 } } }, 'pianoA', 66)).toBeCloseTo(0.5, 6)
    expect(layerGainFor({ ...p, zones: { ...p.zones, pianoA: { from: 3, to: 3 } } }, 'pianoA', 78)).toBeCloseTo(0.5, 6)
  })

  it('SET KEY (Shift + Split) sets the selected split point from the next played key; split state round-trips through Store', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    armShift()
    click('program.split')
    expect(state.get().view.setKeyArmed).toBe(true)
    play(mounted, 66) // F#4 → nearest documented position F4 (65)
    expect(state.get().split.on).toBe(true)
    expect(state.get().split.points.mid.note).toBe(65)
    expect(state.get().view.setKeyArmed).toBe(false)
    expect(mounted.services.engine.activeVoices()).toHaveLength(0) // the set-key stroke did not sound
    release(mounted, 66)
    click('program.store')
    click('program.store')
    click('program.button.2')
    click('program.button.1')
    expect(state.get().split.points.mid.note).toBe(65)
    expect(document.querySelector('.split-strip .led-split-F4 .led')?.className).toContain('lit')
  })

  it('the zone gain reaches the rendered audio: the organ engine plays a note at gain 0.5 half as loud as at gain 1', () => {
    const sr = 22050
    const render = (gain: number) => {
      const unit = new OrganUnit(sr)
      const params = defaultOrganParams()
      params.on = true
      unit.setParams(params)
      const events: { at: number; event: OrganEvent }[] = [{ at: 0, event: { type: 'on', layer: 'A', midi: 60, velocity: 100, gain } }]
      return renderEvents(unit, events, 0.3, sr).l
    }
    const full = rms(render(1), Math.round(sr * 0.1), Math.round(sr * 0.3))
    const half = rms(render(0.5), Math.round(sr * 0.1), Math.round(sr * 0.3))
    expect(full).toBeGreaterThan(0.01)
    expect(half / full).toBeGreaterThan(0.4)
    expect(half / full).toBeLessThan(0.6)
  })
})

describe('splits defaults', () => {
  it('a fresh program has the split off with a Mid point at C4 ready to be enabled', () => {
    expect(defaultSplit()).toEqual({ on: false, points: { low: { note: null, xfade: 0 }, mid: { note: 60, xfade: 0 }, high: { note: null, xfade: 0 } } })
  })
})
