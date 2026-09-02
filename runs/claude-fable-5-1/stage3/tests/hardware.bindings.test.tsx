import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CONTROLS, type ButtonControl } from '../src/hardware/controls'
import { programOf, serializeProgram } from '../src/state/programState'
import { click, el, mountApp, startAudio, type Mounted, type Processors } from './helpers'

let mounted: Mounted | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
})

interface Details {
  controls: { functional: string[]; unsupported: { id: string; reason: string; spec: string }[] }
  unsupported: string[]
}

const details = JSON.parse(readFileSync(path.resolve(__dirname, '../IMPLEMENTATION_DETAILS.json'), 'utf8')) as Details

/** Everything a functional control may legitimately change: the program, master level, morph sources, the display page,
 *  the bank position, latches, tap lists and the engine / processor parameters. */
function fingerprint(m: Mounted, procs: Processors): string {
  const s = m.services.state.get()
  const v = s.view
  const processors = [procs.A, procs.B, procs.organ, procs.organChain, procs.rotary, procs.master, ...Object.values(procs.synth), ...Object.values(procs.synthChains)]
  return JSON.stringify({
    program: serializeProgram(programOf(s)),
    master: s.master,
    sources: s.morphSources,
    armed: s.morphArmed,
    view: { mode: v.mode, page: v.synthPage, list: v.listIndex, naming: v.naming, store: v.store, splitRow: v.splitRow, splitPoint: v.splitPoint, setKey: v.setKeyArmed },
    bank: { slot: s.bank.slot, live: s.bank.liveSlot, liveMode: s.bank.liveMode, page: s.bank.page },
    taps: [s.clockTaps.length, s.delayTaps.length],
    shift: s.shiftArmed,
    engine: [m.services.engine.getOrgan().pitchBend, m.services.engine.getMasterGain()],
    processors: processors.map((p) => [p.paramUpdates, p.events.length]),
  })
}

/** Puts the instrument in a state where operating the control can have an effect (a page that is not already open,
 *  a page other than the first, a focus that is not already active). Runs before the fingerprint is taken. */
function prepare(id: string) {
  switch (id) {
    case 'program.button.1':
      click('program.button.2')
      return
    case 'program.page-prev':
      fireEvent.pointerDown(el('program.page-next'), { pointerId: 1, button: 0 })
      fireEvent.pointerUp(el('program.page-next'), { pointerId: 1 })
      return
    case 'effects.focus.piano':
      click('effects.focus.organ')
      return
    case 'synth.waveform':
      fireEvent.pointerDown(el('synth.osc.pitch'), { pointerId: 1, button: 0 })
      fireEvent.pointerUp(el('synth.osc.pitch'), { pointerId: 1 })
      return
    case 'piano.model': {
      // the dial steps within the focused layer's type: pick the Digital type, which has two models (the generated-only world has one model elsewhere)
      const focusedModel = () => {
        const p = mounted!.services.state.get().piano
        return p.layers[p.focus].modelId
      }
      for (let i = 0; i < 6 && !focusedModel().startsWith('digital'); i++) click('piano.type')
      return
    }
    case 'synth.dial-2':
    case 'synth.dial-3': {
      // the category / waveform dials act on the Analog type of the focused layer (FM-H has one category and one algorithm)
      fireEvent.pointerDown(el('synth.waveform'), { pointerId: 1, button: 0 })
      fireEvent.pointerUp(el('synth.waveform'), { pointerId: 1 })
      const y = mounted!.services.state.get().synth
      if (y.layers[y.focus].wave.type !== 0) fireEvent.keyDown(el('synth.dial-1'), { key: 'ArrowUp' })
      return
    }
    default:
      return
  }
}

/** Operates a control the way a player would: a knob / fader / drawbar to an extreme, a dial by one detent, a button by a press. */
function operate(id: string) {
  const spec = CONTROLS.find((c) => c.id === id)!
  if (spec.kind === 'dial') return fireEvent.keyDown(el(id), { key: 'ArrowUp' })
  if (spec.kind !== 'button') {
    const node = el(id)
    const atMax = Number(node.getAttribute('aria-valuenow')) >= spec.max
    return fireEvent.keyDown(node, { key: atMax ? 'Home' : 'End' })
  }
  if ((spec as ButtonControl).mode === 'momentary') {
    fireEvent.pointerDown(el(id), { pointerId: 1, button: 0 })
    fireEvent.pointerUp(el(id), { pointerId: 1 })
    return
  }
  click(id)
}

describe('hardware.bindings — every non-excluded control has meaningful canonical behavior; spec-excluded controls are listed as unsupported', () => {
  const unsupportedIds = new Set(details.controls.unsupported.map((u) => u.id))

  it('IMPLEMENTATION_DETAILS.json classifies every control of the inventory exactly once, with a spec citation for each unsupported one', () => {
    const ids = CONTROLS.map((c) => c.id)
    const functional = new Set(details.controls.functional)
    for (const id of ids) {
      expect(functional.has(id) !== unsupportedIds.has(id), `${id} must be listed as functional or unsupported (not both, not neither)`).toBe(true)
    }
    for (const id of [...functional, ...unsupportedIds]) expect(ids, `${id} is not a control`).toContain(id)
    for (const u of details.controls.unsupported) {
      expect(u.reason.length).toBeGreaterThan(10)
      expect(u.spec).toMatch(/specs\/nord-stage-4\.(programs|organ|synth|effects|piano)\.json/)
    }
    expect(details.controls.functional.length + details.controls.unsupported.length).toBe(ids.length)
    expect(details.unsupported.length).toBeGreaterThan(5)
  })

  it('every functional control changes canonical state, the display page, the bank position or an engine parameter when operated', async () => {
    mounted = await mountApp()
    const procs = await startAudio(mounted)
    const inert: string[] = []
    for (const spec of CONTROLS) {
      if (unsupportedIds.has(spec.id)) continue
      prepare(spec.id)
      const before = fingerprint(mounted, procs)
      operate(spec.id)
      if (fingerprint(mounted, procs) === before) inert.push(spec.id)
      // leave every page / latch so the next control starts from the program view
      if (mounted.services.state.get().view.mode !== 'program') click('program.shift')
      if (mounted.services.state.get().shiftArmed) click('program.shift')
    }
    expect(inert, 'functional controls that changed nothing').toEqual([])
  })

  it('every unsupported control moves or presses accessibly but leaves the program and every processor untouched', async () => {
    mounted = await mountApp()
    const procs = await startAudio(mounted)
    for (const u of details.controls.unsupported) {
      const spec = CONTROLS.find((c) => c.id === u.id)!
      const node = el(u.id)
      const program = serializeProgram(programOf(mounted.services.state.get()))
      const updates = fingerprint(mounted, procs)
      const value = node.getAttribute('aria-pressed') ?? node.dataset.value ?? node.getAttribute('aria-valuenow')
      prepare(u.id)
      operate(u.id)
      const after = node.getAttribute('aria-pressed') ?? node.dataset.value ?? node.getAttribute('aria-valuenow')
      if (spec.kind === 'button' && (spec as ButtonControl).mode === 'momentary') expect(node.dataset.value).toBe('0')
      else expect(after, `${u.id} should move or press`).not.toBe(value)
      expect(serializeProgram(programOf(mounted.services.state.get())), `${u.id} must not change the program`).toBe(program)
      // only the hint line may have changed: same program, processors, engine and pages
      expect(fingerprint(mounted, procs)).toBe(updates)
      expect(mounted.services.state.get().view.hint ?? '').toMatch(/excluded|unsupported|not implemented|optional/i)
    }
  })
})
