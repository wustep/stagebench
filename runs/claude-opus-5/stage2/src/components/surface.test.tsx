import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { CONTROLS } from '../model/controls'
import { SECTION_LAYOUT } from '../model/layout'
import { VARIANT } from '../model/variant'
import { absentAudioBoundaries } from '../test/harness'

function renderSurface() {
  return render(<App boundaries={absentAudioBoundaries()} />).container
}

/** Features: visual.section-layout, visual.control-inventory, visual.key-count */
describe('rendered surface', () => {
  it('draws one continuous chassis at the variant aspect ratio, split 54/46', () => {
    const container = renderSurface()
    const instrument = container.querySelector('.instrument')!
    expect(instrument).toBeInTheDocument()
    expect(instrument.getAttribute('data-variant')).toBe('stage-4-73')
    expect(Number(instrument.getAttribute('data-aspect-ratio'))).toBeCloseTo(VARIANT.aspectRatio, 4)
    expect(container.querySelectorAll('.chassis')).toHaveLength(1)
    expect(container.querySelector('.deck')?.getAttribute('data-deck-fraction')).toBe('0.54')
    expect(container.querySelector('.keybed-zone')?.getAttribute('data-keybed-fraction')).toBe('0.46')
  })

  it('renders the six sections in order at their documented widths', () => {
    const container = renderSurface()
    const sections = [...container.querySelectorAll('.section')]
    expect(sections).toHaveLength(6)
    sections.forEach((section, index) => {
      const spec = SECTION_LAYOUT[index]
      expect(section.getAttribute('data-section')).toBe(spec.id)
      expect(Number(section.getAttribute('data-fraction'))).toBeCloseTo(spec.fraction, 6)
      expect((section as HTMLElement).style.width).toBe(`${spec.fraction * 100}%`)
    })
    const total = sections.reduce((sum, section) => sum + Number(section.getAttribute('data-fraction')), 0)
    expect(total).toBeCloseTo(1, 6)
  })

  it('gives Program and Synth the only primary OLEDs', () => {
    const container = renderSurface()
    const displays = [...container.querySelectorAll('[data-oled]')]
    expect(displays.map((node) => node.getAttribute('data-oled')).sort()).toEqual(['program', 'synth'])
    for (const id of ['performance', 'organ', 'piano', 'effects']) {
      const section = container.querySelector(`[data-section="${id}"]`)!
      expect(section.querySelector('[data-oled]')).toBeNull()
    }
  })

  it('renders every control in the inventory exactly once, inside its own section', () => {
    const container = renderSurface()
    for (const spec of CONTROLS) {
      const nodes = container.querySelectorAll(`[data-control-id="${spec.id}"]`)
      expect(nodes, `control ${spec.id}`).toHaveLength(1)
      const section = nodes[0].closest('.section')
      expect(section?.getAttribute('data-section'), `control ${spec.id} section`).toBe(spec.section)
    }
  })

  it('renders the whole 73 key keybed with the right white/black split', () => {
    const container = renderSurface()
    const keys = [...container.querySelectorAll('.pkey')]
    expect(keys).toHaveLength(73)
    expect(keys.filter((key) => key.getAttribute('data-key-color') === 'white')).toHaveLength(43)
    expect(keys.filter((key) => key.getAttribute('data-key-color') === 'black')).toHaveLength(30)
    expect(screen.getByRole('button', { name: /^E1, MIDI note 28$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^E7, MIDI note 100$/ })).toBeInTheDocument()
  })

  it('draws the section landmarks the visual spec requires', () => {
    const container = renderSurface()
    const organ = container.querySelector('[data-section="organ"]')!
    expect(organ.querySelectorAll('.drawbar')).toHaveLength(9)
    expect(organ.querySelectorAll('.drawbar__ladder').length).toBe(9)
    expect(organ.querySelectorAll('.ladder').length).toBe(2)

    const performance = container.querySelector('[data-section="performance"]')!
    expect(performance.querySelector('.pitchstick')).not.toBeNull()
    expect(performance.querySelector('.modwheel')).not.toBeNull()
    expect(performance.querySelector('[data-control-id="perf.master-level"]')).not.toBeNull()
    expect(performance.textContent).toContain('nord stage 4')
    // Performance stays on exposed chassis: no inset plate.
    expect(performance.querySelector('.section__plate')).toBeNull()

    const piano = container.querySelector('[data-section="piano"]')!
    expect(piano.textContent).toContain('PIANO SELECT')
    expect(piano.querySelectorAll('.fader')).toHaveLength(2)

    const program = container.querySelector('[data-section="program"]')!
    expect(program.querySelectorAll('[data-control-id^="program.slot."]')).toHaveLength(8)
    expect(program.querySelector('[data-control-id="program.dial"]')).not.toBeNull()

    const effects = container.querySelector('[data-section="effects"]')!
    for (const group of ['MOD 1', 'MOD 2', 'AMP SIM/EQ', 'DELAY', 'COMP', 'REVERB']) {
      expect(effects.textContent).toContain(group)
    }
  })

  /** Feature: regression.chassis */
  it('has no marketing hero, no reference photo and no detached rail', () => {
    const container = renderSurface()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelectorAll('h1, h2')).toHaveLength(0)
    // The rail lives inside the deck, which lives inside the single chassis.
    const rail = container.querySelector('.rail')!
    expect(rail.closest('.deck')).not.toBeNull()
    expect(rail.closest('.chassis')).not.toBeNull()
    expect(container.querySelector('.keybed')?.closest('.chassis')).not.toBeNull()
  })

  it('states plainly which sections are live and which are still decorative', () => {
    renderSurface()
    expect(
      screen.getByText(/The Organ, Synth and Program controls still move, light and report their value but are connected to no audio/i),
    ).toBeInTheDocument()
  })
})
