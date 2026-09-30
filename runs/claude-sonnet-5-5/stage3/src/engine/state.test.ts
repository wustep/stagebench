import { describe, expect, it } from 'vitest'
import {
  cycleAcoustics,
  cycleTimbre,
  cycleType,
  defaultState,
  editFx,
  pressLayer,
  pressPianoFxFocus,
  setGlobal,
  setGroup,
  setModelFromDetent,
  setSoftRelease,
  setStringRes,
  setTimbre,
  setType,
  shiftOctave,
} from './state'

describe('piano.layers — layer gestures (manual p. 23)', () => {
  it('starts with layer A on and focused, layer B off', () => {
    const s = defaultState()
    expect(s.layers.A.enabled).toBe(true)
    expect(s.layers.B.enabled).toBe(false)
    expect(s.focus).toBe('A')
    expect(s.fxFocus).toBe('A')
  })

  it('tapping the other layer button switches from one layer to the other and moves the focus (and the effects focus)', () => {
    const s = pressLayer(defaultState(), 'B', 'tap')
    expect(s.layers.A.enabled).toBe(false)
    expect(s.layers.B.enabled).toBe(true)
    expect(s.focus).toBe('B')
    expect(s.fxFocus).toBe('B')
  })

  it('pressing both buttons (or Shift+press) adds the second layer; with both on a tap only moves the focus', () => {
    let s = pressLayer(defaultState(), 'B', 'both')
    expect(s.layers.A.enabled && s.layers.B.enabled).toBe(true)
    expect(s.focus).toBe('B')
    s = pressLayer(s, 'A', 'tap')
    expect(s.layers.A.enabled && s.layers.B.enabled).toBe(true)
    expect(s.focus).toBe('A')
    expect(pressLayer(defaultState(), 'B', 'shift').layers.B.enabled).toBe(true)
  })

  it('holding a button turns that layer off, but never the last one', () => {
    let s = pressLayer(defaultState(), 'B', 'both')
    s = pressLayer(s, 'B', 'hold')
    expect(s.layers.B.enabled).toBe(false)
    expect(s.focus).toBe('A')
    expect(pressLayer(s, 'A', 'hold').layers.A.enabled).toBe(true)
  })

  it('edits of the Piano section controls reach the focused layer only', () => {
    let s = pressLayer(defaultState(), 'B', 'both') // B focused
    s = setType(s, 'Clav')
    s = shiftOctave(s, 1)
    expect(s.layers.B.type).toBe('Clav')
    expect(s.layers.B.octave).toBe(1)
    expect(s.layers.A.type).toBe('Grand')
    expect(s.layers.A.octave).toBe(0)
    // octave shift is limited to ±12 semitones
    expect(shiftOctave(shiftOctave(s, 1), 1).layers.B.octave).toBe(1)
  })
})

describe('piano types and per-type availability', () => {
  it('cycles the six types in panel order and remembers a model per type', () => {
    let s = defaultState()
    const seen: string[] = []
    for (let i = 0; i < 6; i++) {
      seen.push(s.layers.A.type)
      s = cycleType(s)
    }
    expect(seen).toEqual(['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'])
    expect(s.layers.A.type).toBe('Grand')
    s = setModelFromDetent(setType(s, 'Electric'), 1)
    expect(s.layers.A.models.Electric).toBe(1)
    s = setType(setType(s, 'Grand'), 'Electric')
    expect(s.layers.A.models.Electric).toBe(1)
    // the endless 32-detent dial wraps consistently: 32 detents is a whole number of turns of every model list
    expect(setModelFromDetent(setType(defaultState(), 'Clav'), 31).layers.A.models.Clav).toBe(3)
    expect(setModelFromDetent(setType(defaultState(), 'Clav'), 0).layers.A.models.Clav).toBe(0)
  })

  it('Timbre offers Dyno 1/2 for Electric only, and leaving Electric drops a Dyno choice', () => {
    let s = setType(defaultState(), 'Electric')
    for (let i = 0; i < 5; i++) s = cycleTimbre(s)
    expect(s.layers.A.timbre).toBe('Dyno 2')
    expect(setTimbre(setType(defaultState(), 'Grand'), 'Dyno 1').layers.A.timbre).toBe('Off')
    expect(setType(s, 'Grand').layers.A.timbre).toBe('Off')
    let g = defaultState()
    const seen = []
    for (let i = 0; i < 5; i++) {
      g = cycleTimbre(g)
      seen.push(g.layers.A.timbre)
    }
    expect(seen).toEqual(['Soft', 'Mid', 'Bright', 'Off', 'Soft'])
  })

  it('Soft Release is disabled for Clav; String Res only exists for Grand and Upright; the ACOUSTICS button steps through what the type supports', () => {
    const clav = setType(defaultState(), 'Clav')
    expect(setSoftRelease(clav, true).layers.A.softRelease).toBe(false)
    expect(setStringRes(clav, true).layers.A.stringRes).toBe(false)
    let s = defaultState()
    const seen: string[] = []
    for (let i = 0; i < 5; i++) {
      s = cycleAcoustics(s)
      seen.push(`${s.layers.A.softRelease ? 'S' : '-'}${s.layers.A.stringRes ? 'R' : '-'}`)
    }
    expect(seen).toEqual(['S-', '-R', 'SR', '--', 'S-'])
    let e = setType(defaultState(), 'Electric')
    e = cycleAcoustics(e)
    expect(e.layers.A.softRelease).toBe(true)
    e = cycleAcoustics(e)
    expect(e.layers.A.softRelease).toBe(false)
    expect(e.layers.A.stringRes).toBe(false)
    // switching to Clav switches an active Soft Release off instead of silently keeping it
    expect(setType(setSoftRelease(defaultState(), true), 'Clav').layers.A.softRelease).toBe(false)
  })
})

describe('effects.routing — focus, group, global (manual p. 48)', () => {
  it('unit edits go to the focused effects chain only', () => {
    const s = editFx(defaultState(), 'reverb', { on: true })
    expect(s.fx.A.reverb.on).toBe(true)
    expect(s.fx.B.reverb.on).toBe(false)
  })

  it('the Piano FX FOCUS button swaps between layer A and B chains; group mode keeps both in step', () => {
    let s = pressPianoFxFocus(defaultState())
    expect(s.fxFocus).toBe('B')
    expect(editFx(s, 'delay', { on: true }).fx.B.delay.on).toBe(true)
    expect(editFx(s, 'delay', { on: true }).fx.A.delay.on).toBe(false)
    s = editFx(defaultState(), 'mod1', { on: true, amount: 0.9 })
    s = setGroup(s, true)
    expect(s.fx.B.mod1).toEqual(s.fx.A.mod1) // entering group mode copies the focused chain
    s = editFx(s, 'reverb', { on: true })
    expect(s.fx.B.reverb.on).toBe(true)
    expect(pressPianoFxFocus(s).fxFocus).toBe('A') // no per-layer focus in group mode
    s = setGroup(s, false)
    expect(editFx(s, 'reverb', { on: false }).fx.B.reverb.on).toBe(true) // layers stay as they were, now independent
  })

  it('global mode applies Delay, Compressor and Reverb to every layer; other units stay per layer', () => {
    let s = editFx(defaultState(), 'reverb', { on: true, type: 'Cathedral' })
    s = setGlobal(s, 'reverb', true)
    expect(s.fx.B.reverb).toEqual(s.fx.A.reverb)
    s = editFx(s, 'reverb', { dryWet: 0.9 })
    expect(s.fx.B.reverb.dryWet).toBe(0.9)
    s = editFx(s, 'mod1', { on: true })
    expect(s.fx.B.mod1.on).toBe(false)
    s = setGlobal(s, 'reverb', false)
    expect(editFx(s, 'reverb', { dryWet: 0.1 }).fx.B.reverb.dryWet).toBe(0.9)
  })

  it('reducers return the same object when nothing changes (no needless audio updates)', () => {
    const s = defaultState()
    expect(editFx(s, 'delay', { tempo: s.fx.A.delay.tempo })).toBe(s)
    expect(setType(s, 'Grand')).toBe(s)
  })
})
