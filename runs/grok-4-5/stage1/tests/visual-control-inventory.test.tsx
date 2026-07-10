import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from '../src/App'
import { CONTROLS, PRIMARY_OLED_IDS, SECTION_LAYOUT } from '../src/model/hardware'
import { createMockContextFactory } from '../src/test/mock-audio'
import { PianoEngine } from '../src/audio/piano-engine'
import { Instrument } from '../src/components/Instrument'

describe('visual.control-inventory', () => {
  afterEach(() => cleanup())

  it('has stable control IDs and section landmarks', () => {
    const ids = CONTROLS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBeGreaterThan(80)

    // Performance landmarks
    expect(ids).toContain('perf-master-level')
    expect(ids).toContain('perf-pitch-stick')
    expect(ids).toContain('perf-mod-wheel')

    // Organ: nine drawbars
    for (let n = 1; n <= 9; n++) {
      expect(ids).toContain(`organ-drawbar-${n}`)
    }
    expect(ids).toContain('organ-model-b3')
    expect(ids).toContain('organ-perc-on')
    expect(ids).toContain('organ-rotary-speed')

    // Piano selectors
    expect(ids).toContain('piano-type-grand')
    expect(ids).toContain('piano-model')
    expect(ids).toContain('piano-timbre')

    // Program
    expect(ids).toContain('program-oled')
    expect(ids).toContain('program-dial')
    for (let n = 1; n <= 8; n++) expect(ids).toContain(`program-btn-${n}`)
    expect(ids).toContain('program-live')
    expect(ids).toContain('program-store')
    expect(ids).toContain('program-morph-wheel')

    // Synth dense groups
    expect(ids).toContain('synth-oled')
    expect(ids).toContain('synth-osc-ctrl')
    expect(ids).toContain('synth-filter-freq')
    expect(ids).toContain('synth-lfo-rate')
    expect(ids).toContain('synth-arp-on')

    // Effects matrix
    expect(ids).toContain('fx-mod1-on')
    expect(ids).toContain('fx-delay-on')
    expect(ids).toContain('fx-amp-on')
    expect(ids).toContain('fx-comp-on')
    expect(ids).toContain('fx-reverb-on')
  })

  it('declares Program and Synth as the only primary OLEDs', () => {
    const oleds = CONTROLS.filter((c) => c.kind === 'oled')
    expect(oleds.map((c) => c.id).sort()).toEqual([...PRIMARY_OLED_IDS].sort())
    expect(oleds.every((c) => c.section === 'program' || c.section === 'synth')).toBe(true)
  })

  it('renders all sections and primary OLEDs in the instrument', () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ createContext })
    render(<Instrument engine={engine} enableMidi={false} />)
    for (const s of SECTION_LAYOUT) {
      expect(screen.getByTestId(`section-${s.id}`)).toBeInTheDocument()
    }
    expect(document.querySelectorAll('[data-primary-oled="true"]')).toHaveLength(2)
    expect(screen.getByTestId('nord-branding')).toBeInTheDocument()
    expect(screen.getByTestId('drawbar-bank')).toBeInTheDocument()
  })

  it('renders App instrument surface without starter hero', () => {
    render(<App />)
    expect(screen.getByTestId('instrument')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /stagebench candidate starter/i })).not.toBeInTheDocument()
  })
})
