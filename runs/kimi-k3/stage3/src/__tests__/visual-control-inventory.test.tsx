import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { PianoEngine } from '../audio/engine'
import { FakeAudioBackend } from '../audio/fake-backend'
import { CONTROLS, CONTROL_BY_ID, controlsForSection, OLED_SECTIONS } from '../hardware/controls'

function renderApp() {
  const engine = new PianoEngine(new FakeAudioBackend())
  return render(<App engine={engine} disableMidi />)
}

describe('visual.control-inventory', () => {
  it('every declared control has a unique stable ID and is rendered', () => {
    const ids = CONTROLS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    const { container } = renderApp()
    for (const c of CONTROLS) {
      expect(container.querySelector(`[data-control-id="${c.id}"]`), c.id).toBeTruthy()
    }
  })

  it('control density is non-trivial per section (no undifferentiated grid)', () => {
    expect(controlsForSection('performance').length).toBeGreaterThanOrEqual(3)
    expect(controlsForSection('organ').length).toBeGreaterThanOrEqual(15)
    expect(controlsForSection('piano').length).toBeGreaterThanOrEqual(10)
    expect(controlsForSection('program').length).toBeGreaterThanOrEqual(15)
    expect(controlsForSection('synth').length).toBeGreaterThanOrEqual(25)
    expect(controlsForSection('effects').length).toBeGreaterThanOrEqual(20)
  })

  it('organ has exactly nine drawbars plus model/percussion/rotary landmarks', () => {
    const drawbars = CONTROLS.filter((c) => c.kind === 'drawbar')
    expect(drawbars.length).toBe(9)
    for (const id of ['organ.model', 'organ.percussionOn', 'organ.rotarySpeed', 'organ.vibratoChorus']) {
      expect(CONTROL_BY_ID.has(id), id).toBe(true)
    }
  })

  it('performance has pitch stick, mod wheel, master level and branding; no OLED', () => {
    for (const id of ['perf.pitchStick', 'perf.modWheel', 'perf.masterLevel']) {
      expect(CONTROL_BY_ID.get(id)?.section).toBe('performance')
    }
    const { container } = renderApp()
    const perf = container.querySelector('[data-section="performance"]')!
    expect(perf.querySelector('.oled')).toBeNull()
    expect(perf.textContent).toMatch(/STAGE 4/)
    expect(perf.textContent?.toUpperCase()).toMatch(/NORD/)
  })

  it('Program and Synth are the only primary OLED locations', () => {
    expect([...OLED_SECTIONS].sort()).toEqual(['program', 'synth'])
    const { container } = renderApp()
    const oleds = container.querySelectorAll('.oled')
    expect(oleds.length).toBe(2)
    expect(container.querySelector('[data-section="program"] .oled')).toBeTruthy()
    expect(container.querySelector('[data-section="synth"] .oled')).toBeTruthy()
    // Phase 3: the Program OLED shows the live program position + name
    // (e.g. "1.1 Grand Piano") and the Synth OLED shows the live waveform.
    expect(container.querySelector('[data-section="program"] .oled')!.textContent).toMatch(/1\.1/)
    expect(container.querySelector('[data-section="synth"] .oled')!.textContent).toMatch(/Saw|Sine|Square/)
  })

  it('piano section has selectors and no drawbars or OLED', () => {
    for (const id of ['piano.type', 'piano.modelSelect', 'piano.kbTouch', 'piano.timbre']) {
      expect(CONTROL_BY_ID.get(id)?.section).toBe('piano')
    }
    expect(CONTROLS.filter((c) => c.section === 'piano' && c.kind === 'drawbar').length).toBe(0)
    const { container } = renderApp()
    expect(container.querySelector('[data-section="piano"] .oled')).toBeNull()
  })

  it('program section has dial, eight program buttons, pages, live/scene, store/split, three morph assigns', () => {
    for (const id of [
      'program.dial', 'program.pageLeft', 'program.pageRight', 'program.liveMode', 'program.layerScene',
      'program.store', 'program.split', 'program.morphWheel', 'program.morphAftertouch', 'program.morphCtrlPedal',
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `program.button.${n}`),
    ]) {
      expect(CONTROL_BY_ID.has(id), id).toBe(true)
    }
  })

  it('effects section has two effect groups, amp/EQ, delay, compressor, reverb, layer focus', () => {
    for (const id of [
      'fx.effect1On', 'fx.effect2On', 'fx.ampType', 'fx.eqMidGain', 'fx.delayOn', 'fx.compOn',
      'fx.reverbOn', 'fx.focusA', 'fx.focusB',
    ]) {
      expect(CONTROL_BY_ID.has(id), id).toBe(true)
    }
  })
})
