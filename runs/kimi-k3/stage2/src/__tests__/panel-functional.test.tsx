import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { PianoEngine } from '../audio/engine'
import { FakeAudioBackend, rms } from '../audio/fake-backend'
import { CONTROLS } from '../hardware/controls'
import { FUNCTIONAL_CONTROLS, isFunctionalControl } from '../state/panel-bindings'
import { resetHardwareStore } from '../state/hardware-store'

function setup() {
  const backend = new FakeAudioBackend()
  const engine = new PianoEngine(backend)
  const utils = render(<App engine={engine} disableMidi />)
  return { backend, engine, ...utils }
}

beforeEach(() => resetHardwareStore())

describe('panel bindings (Phase 2 honesty contract)', () => {
  it('the functional control set matches exactly the declared functional defs', () => {
    const declared = new Set(CONTROLS.filter((c) => c.functional).map((c) => c.id))
    expect(declared).toEqual(new Set(FUNCTIONAL_CONTROLS))
    // Organ/Synth/Program controls (except Panic) stay decorative.
    for (const c of CONTROLS) {
      if (c.section === 'organ' || c.section === 'synth') expect(isFunctionalControl(c.id), c.id).toBe(false)
      if (c.section === 'program' && c.id !== 'program.panic') expect(isFunctionalControl(c.id), c.id).toBe(false)
    }
  })

  it('Master Level knob drives the engine master level', () => {
    const { container, engine } = setup()
    const knob = container.querySelector('[data-control-id="perf.masterLevel"]')!
    fireEvent.keyDown(knob, { key: 'End' })
    expect(engine.getMasterLevel()).toBe(0)
    fireEvent.keyDown(knob, { key: 'Home' })
    expect(engine.getMasterLevel()).toBe(1)
  })

  it('piano type selector switches the focused layer type (panel feedback agrees)', () => {
    const { container, engine } = setup()
    const sel = container.querySelector('[data-control-id="piano.type"]')!
    expect(engine.layers.pianoA.type).toBe('grand')
    fireEvent.click(sel)
    expect(engine.layers.pianoA.type).toBe('upright')
    expect(sel.getAttribute('data-option')).toBe('Upright')
    // Program display shows the live model name.
    const oled = container.querySelector('[data-oled="piano-model"]')!
    expect(oled.textContent).toMatch(/Grand Upright/)
  })

  it('layer A/B buttons enable layers and set note focus', () => {
    const { container, engine } = setup()
    fireEvent.click(container.querySelector('[data-control-id="piano.layerB"]')!)
    expect(engine.layers.pianoB.enabled).toBe(true)
    expect(engine.getFocusedLayer()).toBe('pianoB')
    engine.noteOn(60, 0.8)
    expect(engine.getVoices()[0].layer).toBe('pianoB')
    fireEvent.click(container.querySelector('[data-control-id="piano.layerA"]')!)
    expect(engine.getFocusedLayer()).toBe('pianoA')
  })

  it('KB Touch button cycles curves into engine perf state', () => {
    const { container, engine } = setup()
    expect(engine.perf.kbTouch).toBe(1) // Medium default
    fireEvent.click(container.querySelector('[data-control-id="piano.kbTouch"]')!)
    expect(engine.perf.kbTouch).toBe(2) // Light
    fireEvent.click(container.querySelector('[data-control-id="piano.kbTouch"]')!)
    expect(engine.perf.kbTouch).toBe(0) // Heavy
  })

  it('sustain pedal routing toggle drives SUSTPED on the focused layer', () => {
    const { container, engine } = setup()
    expect(engine.layers.pianoA.sustainPedal).toBe(true)
    fireEvent.click(container.querySelector('[data-control-id="piano.sustainPedal"]')!)
    expect(engine.layers.pianoA.sustainPedal).toBe(false)
  })

  it('effect unit controls edit the focused chain; focus B switches chains', () => {
    const { container, engine } = setup()
    // The panel edits the focused chain; A is focused by default.
    fireEvent.click(container.querySelector('[data-control-id="fx.effect1On"]')!)
    expect(engine.effects.chains.pianoA.mod1.on).toBe(true)
    expect(engine.effects.chains.pianoB.mod1.on).toBe(false)
    // Focus B: further unit edits land on chain B only.
    fireEvent.click(container.querySelector('[data-control-id="fx.focusB"]')!)
    expect(engine.effects.focusLayer).toBe('B')
    fireEvent.click(container.querySelector('[data-control-id="fx.effect2On"]')!)
    expect(engine.effects.chains.pianoB.mod2.on).toBe(true)
    expect(engine.effects.chains.pianoA.mod2.on).toBe(false)
    // Focus back to A: edits land on A again, B untouched.
    fireEvent.click(container.querySelector('[data-control-id="fx.focusA"]')!)
    fireEvent.click(container.querySelector('[data-control-id="fx.compOn"]')!)
    expect(engine.effects.chains.pianoA.comp.on).toBe(true)
    expect(engine.effects.chains.pianoB.comp.on).toBe(false)
  })

  it('all-effects bypass button flips effects.allOn', () => {
    const { container, engine } = setup()
    expect(engine.effects.allOn).toBe(true)
    fireEvent.click(container.querySelector('[data-control-id="fx.on"]')!)
    expect(engine.effects.allOn).toBe(false)
  })

  it('group and global buttons drive routing state', () => {
    const { container, engine } = setup()
    fireEvent.click(container.querySelector('[data-control-id="fx.groupPiano"]')!)
    expect(engine.effects.pianoGroup).toBe(true)
    fireEvent.click(container.querySelector('[data-control-id="fx.reverbGlobal"]')!)
    expect(engine.effects.chains.pianoA.reverb.global).toBe(true)
    fireEvent.click(container.querySelector('[data-control-id="fx.delayGlobal"]')!)
    expect(engine.effects.chains.pianoA.delay.global).toBe(true)
  })

  it('To Rotary and rotary controls drive rotary state', () => {
    const { container, engine } = setup()
    const ampType = container.querySelector('[data-control-id="fx.ampType"]')!
    for (let i = 0; i < 6; i++) fireEvent.click(ampType)
    expect(engine.effects.chains.pianoA.amp.type).toBe(6)
    fireEvent.click(container.querySelector('[data-control-id="fx.ampOn"]')!)
    fireEvent.click(container.querySelector('[data-control-id="fx.rotaryOn"]')!)
    expect(engine.effects.rotary.on).toBe(true)
    fireEvent.click(container.querySelector('[data-control-id="fx.rotarySpeed"]')!)
    expect(engine.effects.rotary.fast).toBe(true)
  })

  it('Panic stops every owned voice immediately', () => {
    const { container, backend, engine } = setup()
    engine.noteOn(60, 0.9)
    engine.noteOn(64, 0.9)
    expect(backend.activeVoiceCount()).toBe(2)
    fireEvent.click(container.querySelector('[data-control-id="program.panic"]')!)
    expect(backend.activeVoiceCount()).toBe(0)
    expect(engine.getVoices().length).toBe(0)
  })

  it('panel changes measurably alter rendered audio (control → signal)', () => {
    const { container, backend, engine } = setup()
    engine.noteOn(60, 0.9)
    backend.advance(0.05)
    const before = backend.renderMix(0.5)
    // Drive the change through the actual panel control.
    fireEvent.click(container.querySelector('[data-control-id="fx.reverbOn"]')!)
    const knob = container.querySelector('[data-control-id="fx.reverbAmount"]')!
    fireEvent.keyDown(knob, { key: 'Home' })
    expect(engine.effects.chains.pianoA.reverb.on).toBe(true)
    expect(engine.effects.chains.pianoA.reverb.amount).toBe(127)
    const after = backend.renderMix(0.5)
    expect(rms(after)).toBeGreaterThan(0.001)
    let dot = 0, ea = 0, eb = 0
    for (let i = 0; i < before.length; i++) { dot += before[i] * after[i]; ea += before[i] ** 2; eb += after[i] ** 2 }
    expect(dot / Math.max(1e-12, Math.sqrt(ea * eb))).toBeLessThan(0.999)
  })

  it('decorative organ/synth/program controls still touch nothing', () => {
    const { container, backend, engine } = setup()
    for (const id of ['organ.model', 'organ.drawbar.3', 'synth.filterCutoff', 'program.dial', 'program.split', 'synth.on']) {
      const el = container.querySelector(`[data-control-id="${id}"]`)!
      fireEvent.click(el)
      fireEvent.keyDown(el, { key: 'ArrowUp' })
    }
    expect(backend.startCount).toBe(0)
    expect(engine.getStatus().status).not.toBe('error')
  })
})
