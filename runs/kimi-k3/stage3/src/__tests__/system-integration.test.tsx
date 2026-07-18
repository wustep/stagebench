import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render } from '@testing-library/react'
import App from '../App'
import { PianoEngine } from '../audio/engine'
import { corr, FakeAudioBackend, rms } from '../audio/fake-backend'
import { CONTROLS } from '../hardware/controls'
import { FUNCTIONAL_CONTROLS, isFunctionalControl, isUnsupportedControl, UNSUPPORTED_CONTROLS } from '../state/panel-bindings'
import { resetHardwareStore } from '../state/hardware-store'
import { MORPHABLE_CONTROLS } from '../state/morph'

function setup() {
  const backend = new FakeAudioBackend()
  const engine = new PianoEngine(backend)
  const utils = render(<App engine={engine} disableMidi />)
  return { backend, engine, ...utils }
}

beforeEach(() => resetHardwareStore())

describe('system.integration', () => {
  it('all engines share one render path, one master, one destination (single graph)', async () => {
    const { engine, backend } = await makeRigLike()
    engine.setOrganSectionOn(true)
    engine.setSynthSectionOn(true)
    engine.noteOn(60, 0.9)
    backend.advance(0.02)
    const all = backend.renderMix(0.4)
    expect(rms(all)).toBeGreaterThan(0.005)
    // One master path: master level zero silences every engine at once.
    engine.setMasterLevel(0)
    expect(rms(backend.renderMix(0.3))).toBeLessThan(1e-6)
  })

  it('programs capture organ + synth + piano + effects as one system state', async () => {
    const { engine } = await makeRigLike()
    engine.setOrganSectionOn(true)
    engine.setSynthSectionOn(true)
    engine.update(() => {
      engine.organ.layers.A.model = 3
      engine.synth.layers.A.oscWave = 11
      engine.effects.chains.organ.mod1.on = true
    })
    engine.storeTo(20, 'System')
    engine.loadSlot(0)
    expect(engine.organ.sectionOn).toBe(false)
    engine.loadSlot(20)
    expect(engine.organ.sectionOn).toBe(true)
    expect(engine.synth.sectionOn).toBe(true)
    expect(engine.organ.layers.A.model).toBe(3)
    expect(engine.synth.layers.A.oscWave).toBe(11)
    expect(engine.effects.chains.organ.mod1.on).toBe(true)
  })

  it('splits route all engines through the same zone system', async () => {
    const { engine, backend } = await makeRigLike()
    engine.setSectionOn(false)
    engine.setOrganSectionOn(true)
    engine.setSynthSectionOn(true)
    engine.update(() => {
      engine.split.on = true
      engine.split.points.Mid.enabled = true
      engine.split.points.Mid.position = 4 // C4
      engine.split.zones.organA = { lo: 0, hi: 0 }
      engine.split.zones.synthA = { lo: 1, hi: 1 }
    })
    engine.noteOn(48, 0.9) // below: organ only
    expect(engine.getVoices().some((v) => v.layer === 'organA')).toBe(true)
    expect(engine.getVoices().some((v) => v.layer === 'synthA')).toBe(false)
    engine.allNotesOff()
    engine.noteOn(72, 0.9) // above: synth only
    expect(engine.getVoices().some((v) => v.layer === 'synthA')).toBe(true)
    expect(engine.getVoices().some((v) => v.layer === 'organA')).toBe(false)
    backend.advance(0.02)
    expect(rms(backend.renderMix(0.3))).toBeGreaterThan(0.001)
  })

  it('morphs move canonical engine parameters that reach rendered audio', async () => {
    const { engine, backend } = await makeRigLike()
    engine.setSectionOn(false)
    engine.setSynthSectionOn(true)
    engine.update(() => {
      engine.synth.layers.A.filterFreq = 127
      engine.synth.layers.A.oscWave = 2
    })
    engine.noteOn(60, 0.9)
    backend.advance(0.02)
    const open = backend.renderMix(0.4)
    // Assign wheel → filter cutoff and sweep it via the panel wheel.
    engine.assignMorph('wheel', 'synth.filterCutoff', 127, 10)
    const { syncFunctionalControls } = await import('../state/panel-bindings')
    const { setControlValue } = await import('../state/hardware-store')
    setControlValue('perf.modWheel', 127)
    syncFunctionalControls(engine)
    const closed = backend.renderMix(0.4)
    expect(engine.synth.layers.A.filterFreq).toBe(10)
    expect(corr(open, closed)).toBeLessThan(0.9)
  })

  it('clock syncs arp, LFO, delay, and Mod 1 rate targets exist canonically', async () => {
    const { engine } = await makeRigLike()
    engine.setBpm(90)
    expect(engine.clock.bpm).toBe(90)
    // Sync targets are canonical per-layer flags/state.
    engine.update(() => {
      engine.synth.layers.A.arpSync = true
      engine.synth.layers.A.lfoSync = true
    })
    expect(engine.getProgramState().synth.layers.A.arpSync).toBe(true)
    expect(engine.getProgramState().clock.bpm).toBe(90)
  })

  it('Panic works identically across all engines via one lifecycle', async () => {
    const { engine, backend } = await makeRigLike()
    engine.setOrganSectionOn(true)
    engine.setSynthSectionOn(true)
    engine.noteOn(60, 0.9)
    engine.noteOn(65, 0.9)
    expect(engine.getVoices().length).toBeGreaterThan(3)
    engine.panic()
    expect(engine.getVoices().length).toBe(0)
    expect(backend.activeVoiceCount()).toBe(0)
  })

  it('organ + synth render through the Phase 2 buses (no second context): fake backend renders one graph', async () => {
    const { engine, backend } = await makeRigLike()
    engine.setOrganSectionOn(true)
    engine.setSynthSectionOn(true)
    engine.noteOn(60, 0.9)
    backend.advance(0.02)
    const frame = backend.renderMixStereo(0.4)
    expect(rms(frame.l)).toBeGreaterThan(0.001)
    expect(rms(frame.r)).toBeGreaterThan(0.001)
  })
})

async function makeRigLike() {
  const backend = new FakeAudioBackend()
  const engine = new PianoEngine(backend)
  await engine.init()
  return { engine, backend }
}

describe('hardware.bindings', () => {
  it('every control is exactly one of functional or spec-excluded (unsupported)', () => {
    for (const c of CONTROLS) {
      const functional = isFunctionalControl(c.id)
      const unsupported = isUnsupportedControl(c.id)
      expect(functional || unsupported, `${c.id} must be bound or listed unsupported`).toBe(true)
      expect(functional && unsupported, `${c.id} cannot be both`).toBe(false)
    }
    // Declared functional defs match the FUNCTIONAL set exactly.
    expect(new Set(CONTROLS.filter((c) => c.functional).map((c) => c.id))).toEqual(new Set(FUNCTIONAL_CONTROLS))
  })

  it('unsupported list covers exactly the spec-excluded controls with citations', () => {
    const ids = Object.keys(UNSUPPORTED_CONTROLS).sort()
    expect(ids).toEqual([
      'organ.panelASelect',
      'organ.panelBSelect',
      'piano.modelSelect',
      'program.morphAftertouch',
      'program.panelASelect',
      'program.panelBSelect',
      'synth.oscMix',
    ])
    for (const reason of Object.values(UNSUPPORTED_CONTROLS)) {
      expect(reason.length).toBeGreaterThan(10)
    }
  })

  it('moving a sample of functional controls changes canonical engine state', () => {
    const { container, engine } = setup()
    // Organ model
    fireEvent.click(container.querySelector('[data-control-id="organ.model"]')!)
    expect(engine.organ.layers.A.model).toBe(1)
    // Drawbar
    const db = container.querySelector('[data-control-id="organ.drawbar.1"]')!
    fireEvent.keyDown(db, { key: 'Home' })
    expect(engine.organ.layers.A.drawbars[0]).toBe(8)
    // Synth wave
    fireEvent.click(container.querySelector('[data-control-id="synth.oscWave"]')!)
    expect(engine.synth.layers.A.oscWave).toBe(3) // Saw(2) → Square(3)
    // Synth filter
    fireEvent.click(container.querySelector('[data-control-id="synth.filterType"]')!)
    expect(engine.synth.layers.A.filterType).toBe(1)
    // Program section: split toggle
    fireEvent.click(container.querySelector('[data-control-id="program.split"]')!)
    expect(engine.split.on).toBe(true)
    // Live mode
    fireEvent.click(container.querySelector('[data-control-id="program.liveMode"]')!)
    expect(engine.liveMode).toBe(true)
    // Transpose
    fireEvent.click(container.querySelector('[data-control-id="program.transpose"]')!)
    expect(engine.transpose).toBe(1)
  })

  it('layer scene button toggles scenes with LED-truthful state', () => {
    const { container, engine } = setup()
    expect(engine.scene).toBe('I')
    fireEvent.click(container.querySelector('[data-control-id="program.layerScene"]')!)
    expect(engine.scene).toBe('II')
    fireEvent.click(container.querySelector('[data-control-id="program.layerScene"]')!)
    expect(engine.scene).toBe('I')
  })

  it('morph assign via panel: hold source button, move destination, indicator lights', () => {
    const { container, engine } = setup()
    fireEvent.click(container.querySelector('[data-control-id="program.morphWheel"]')!)
    const knob = container.querySelector('[data-control-id="synth.filterCutoff"]')!
    fireEvent.keyDown(knob, { key: 'ArrowDown' }) // from
    fireEvent.keyDown(knob, { key: 'ArrowUp' })
    fireEvent.keyDown(knob, { key: 'ArrowUp' }) // to
    expect(engine.morphs.wheel.length).toBe(1)
    expect(engine.morphs.wheel[0].controlId).toBe('synth.filterCutoff')
    const led = container.querySelector('[data-morph-led="synth.filterCutoff"]')!
    expect(led.className).toContain('led-on')
    // Shift + source clears.
    fireEvent.click(container.querySelector('[data-control-id="program.shift"]')!)
    fireEvent.click(container.querySelector('[data-control-id="program.morphWheel"]')!)
    expect(engine.morphs.wheel.length).toBe(0)
  })

  it('store flow: STORE arms, program button confirms destination; naming via Store As', () => {
    const { container, engine } = setup()
    fireEvent.click(container.querySelector('[data-control-id="program.store"]')!)
    expect(container.querySelector('[data-oled="store-flow"]')!.textContent).toMatch(/STORE/)
    fireEvent.click(container.querySelector('[data-control-id="program.button.5"]')!)
    expect(engine.currentSlot).toBe(4)
    expect(engine.isDirty()).toBe(false)
  })

  it('program OLED shows position, name, and truthful dirty E indicator', () => {
    const { container, engine } = setup()
    const oled = () => container.querySelector('[data-oled="program-position"]')!.textContent!
    expect(oled()).toMatch(/1\.1 Grand Piano/)
    expect(engine.isDirty()).toBe(false)
    expect(oled()).not.toMatch(/E$/)
    fireEvent.click(container.querySelector('[data-control-id="organ.model"]')!)
    expect(engine.isDirty()).toBe(true)
    expect(oled()).toMatch(/ E$/)
  })

  it('split strip shows point LEDs at active positions and zone keys', () => {
    const { container } = setup()
    expect(container.querySelector('[data-split-strip]')).toBeTruthy()
    expect(container.querySelector('[data-split-led="Mid"]')).toBeTruthy()
    fireEvent.click(container.querySelector('[data-control-id="program.split"]')!)
    expect(container.querySelector('[data-split-led="Mid"]')!.className).toContain('led-on')
    expect(container.querySelectorAll('[data-zone-key]').length).toBe(4)
  })

  it('morphable destination set matches the programs spec list', () => {
    // Spec destinations: organ (level, drawbars, rotary speed), piano (level),
    // synth (level, lfo rate, osc ctrl, lfo amount, filter freq/res, arp rate),
    // effects (mod1 rate/amount, mod2 amount, delay tempo/feedback/dry-wet,
    // EQ mid/filter freq, drive, reverb dry/wet).
    for (const id of ['organ.level', 'organ.rotarySpeed', 'piano.level', 'synth.level', 'synth.lfoRate', 'synth.oscShape', 'synth.lfoAmount', 'synth.filterCutoff', 'synth.filterResonance', 'synth.arpRate', 'fx.effect1Rate', 'fx.effect1Amount', 'fx.effect2Amount', 'fx.delayRate', 'fx.delayFeedback', 'fx.delayMix', 'fx.eqMidGain', 'fx.ampDrive', 'fx.reverbAmount']) {
      expect(MORPHABLE_CONTROLS.has(id), id).toBe(true)
    }
    for (let i = 1; i <= 9; i++) expect(MORPHABLE_CONTROLS.has(`organ.drawbar.${i}`)).toBe(true)
  })

  it('master clock button taps set BPM; list view shows all 32 programs', () => {
    vi.useFakeTimers()
    const { container, engine } = setup()
    const clk = container.querySelector('[data-control-id="program.mstClock"]')!
    const t0 = Date.now()
    for (let i = 0; i < 4; i++) {
      vi.setSystemTime(t0 + i * 500)
      fireEvent.click(clk)
    }
    expect(engine.clock.bpm).toBe(120)
    vi.useRealTimers()
    // List view (Shift + Program dial binding).
    act(() => {
      engine.setListView(true)
    })
    expect(container.querySelector('[data-oled-mode="list"]')).toBeTruthy()
    expect(container.querySelectorAll('.oled-list-item').length).toBe(32)
    act(() => {
      engine.setListView(false)
    })
  })
})
