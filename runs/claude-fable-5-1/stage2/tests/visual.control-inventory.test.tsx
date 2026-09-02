import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CONTROLS, CONTROL_BY_ID, DISPLAYS, controlsInSection } from '../src/hardware/controls'
import { SECTIONS } from '../src/hardware/sections'
import { InstrumentContext } from '../src/ui/context'
import { Instrument } from '../src/ui/Instrument'
import { createServices } from '../src/ui/createServices'
import { engineOptions, makeWorld } from './helpers'

function mount() {
  const services = createServices(makeWorld().boundaries, engineOptions)
  return render(
    <InstrumentContext.Provider value={services}>
      <Instrument />
    </InstrumentContext.Provider>,
  )
}

describe('visual.control-inventory — stable ids, landmarks, density, displays', () => {
  it('every control has a unique stable id, section and accessible name', () => {
    const ids = CONTROLS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of CONTROLS) {
      expect(c.id).toMatch(/^(performance|organ|piano|program|synth|effects)\.[a-z0-9.-]+$/)
      expect(c.id.startsWith(`${c.section}.`)).toBe(true)
      expect(c.name.length).toBeGreaterThan(2)
    }
    expect(CONTROLS.length).toBeGreaterThanOrEqual(140)
  })

  it('renders each inventory control exactly once, and nothing that is not in the inventory', () => {
    const { container } = mount()
    const rendered = [...container.querySelectorAll('[data-control-kind]')] as HTMLElement[]
    const renderedIds = rendered.map((el) => el.id)
    expect(new Set(renderedIds).size).toBe(renderedIds.length)
    expect(renderedIds.sort()).toEqual(CONTROLS.map((c) => c.id).sort())
    for (const el of rendered) {
      const spec = CONTROL_BY_ID.get(el.id)!
      const section = el.closest('.section') as HTMLElement
      expect(section.dataset.section).toBe(spec.section)
      expect(el.dataset.controlKind).toBe(spec.kind)
    }
  })

  it('carries the reference landmarks of every section', () => {
    const { container } = mount()
    const has = (id: string) => container.querySelector(`[id="${id}"]`) !== null
    // performance: wheels, master level, rotary speaker block, branding
    expect(has('performance.master-level')).toBe(true)
    expect(has('performance.pitch-stick')).toBe(true)
    expect(has('performance.mod-wheel')).toBe(true)
    expect(has('performance.rotary.drive')).toBe(true)
    expect(has('performance.rotary.speed')).toBe(true)
    expect(container.querySelector('#section-performance .logo')?.textContent).toMatch(/nord\s*stage\s*4/i)
    expect(container.querySelector('#section-performance .logo')?.textContent).toMatch(/HAMMER ACTION 73/)
    // organ: nine drawbars with LED graphs, model / vibrato / percussion switches, level ladders
    const drawbars = container.querySelectorAll('#section-organ [data-control-kind="drawbar"]')
    expect(drawbars).toHaveLength(9)
    expect(container.querySelectorAll('#section-organ .drawbar-body .ladder')).toHaveLength(9)
    expect(container.querySelectorAll('#section-organ [data-control-kind="fader"]')).toHaveLength(2)
    expect(has('organ.model')).toBe(true)
    expect(has('organ.percussion.on')).toBe(true)
    expect(has('organ.vibrato.mode')).toBe(true)
    // piano: layer levels, type selector, model dial, timbre and detail switches
    expect(container.querySelectorAll('#section-piano [data-control-kind="fader"]')).toHaveLength(2)
    expect(has('piano.type')).toBe(true)
    expect(has('piano.model')).toBe(true)
    expect(has('piano.timbre')).toBe(true)
    expect(has('piano.kb-touch')).toBe(true)
    expect(has('piano.acoustics')).toBe(true)
    expect(container.querySelectorAll('#section-piano [data-control-kind="drawbar"]')).toHaveLength(0)
    // program: primary OLED, large dial, eight program buttons, page, live/scene, store/split, three morph
    expect(has('program.oled')).toBe(true)
    expect(has('program.dial')).toBe(true)
    for (let n = 1; n <= 8; n++) expect(has(`program.button.${n}`)).toBe(true)
    expect(has('program.page-prev') && has('program.page-next')).toBe(true)
    expect(has('program.live-mode') && has('program.layer-scene')).toBe(true)
    expect(has('program.store') && has('program.split')).toBe(true)
    expect(has('program.morph.wheel') && has('program.morph.aftertouch') && has('program.morph.control-pedal')).toBe(true)
    // synth: single OLED, three layer levels, oscillator / filter / envelope / LFO / arpeggiator groups
    expect(has('synth.oled')).toBe(true)
    expect(container.querySelectorAll('#section-synth [data-control-kind="fader"]')).toHaveLength(3)
    expect(has('synth.osc.ctrl') && has('synth.filter.freq') && has('synth.amp.envelope') && has('synth.lfo.rate') && has('synth.arp.rate')).toBe(true)
    // effects: two mod groups, amp sim / EQ, delay, compressor, reverb, focus controls
    expect(has('effects.mod1.type') && has('effects.mod2.type')).toBe(true)
    expect(has('effects.amp.drive') && has('effects.amp.bass')).toBe(true)
    expect(has('effects.delay.tempo') && has('effects.comp.amount') && has('effects.reverb.type')).toBe(true)
    expect(has('effects.focus.organ') && has('effects.focus.piano') && has('effects.focus.synth')).toBe(true)
  })

  it('places dense control counts per section (no empty or token sections)', () => {
    const counts = Object.fromEntries(SECTIONS.map((s) => [s.id, controlsInSection(s.id).length]))
    expect(counts.performance).toBeGreaterThanOrEqual(6)
    expect(counts.organ).toBeGreaterThanOrEqual(20)
    expect(counts.piano).toBeGreaterThanOrEqual(12)
    expect(counts.program).toBeGreaterThanOrEqual(24)
    expect(counts.synth).toBeGreaterThanOrEqual(35)
    expect(counts.effects).toBeGreaterThanOrEqual(28)
  })

  it('Program and Synth carry the only primary OLEDs; performance and effects carry none', () => {
    const { container } = mount()
    const displays = [...container.querySelectorAll('[data-display], [id*="oled"], [class*="display"], [class*="screen"]')] as HTMLElement[]
    expect(displays.map((d) => d.id).sort()).toEqual(['program.oled', 'synth.oled'])
    expect(DISPLAYS.map((d) => d.id).sort()).toEqual(['program.oled', 'synth.oled'])
    for (const d of displays) {
      const section = (d.closest('.section') as HTMLElement).dataset.section
      expect(['program', 'synth']).toContain(section)
      expect(d.getAttribute('role')).toBe('group')
      expect(d.getAttribute('aria-label')).toMatch(/display/i)
    }
    expect(container.querySelectorAll('#section-performance [data-display]')).toHaveLength(0)
    expect(container.querySelectorAll('#section-effects [data-display]')).toHaveLength(0)
    expect(container.querySelectorAll('#section-organ [data-display]')).toHaveLength(0)
    expect(container.querySelectorAll('#section-piano [data-display]')).toHaveLength(0)
  })

  it('displays are honest: no fake program names or unimplemented features shown as working', () => {
    const { container } = mount()
    const program = container.querySelector('[id="program.oled"]')!.textContent ?? ''
    // Without a sample library the only model is the generated additive piano, and the display says so.
    expect(program).toMatch(/Additive Piano \(generated\)/)
    expect(program).toMatch(/generated|gen/i)
    expect(program).not.toMatch(/White Grand|B3 Soulful|Vista Pad|A:11|Royal Grand|Velvet/)
    const synth = container.querySelector('[id="synth.oled"]')!.textContent ?? ''
    expect(synth).toMatch(/Decorative/)
    expect(synth).toMatch(/No synth engine/)
  })
})
