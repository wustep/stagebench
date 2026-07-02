import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HARDWARE_CONTROLS } from '../model/hardware'
import { SECTIONS } from '../model/variant'
import { renderApp } from '../test/renderApp'

describe('visual.section-layout — deck geometry', () => {
  it('renders the six sections in reference order with normalized widths', () => {
    renderApp()
    const deck = screen.getByTestId('control-deck')
    const sections = [...deck.querySelectorAll('[data-section]')]
    expect(sections.map((s) => s.getAttribute('data-section'))).toEqual([
      'performance',
      'organ',
      'piano',
      'program',
      'synth',
      'effects',
    ])
    for (const [i, section] of sections.entries()) {
      expect((section as HTMLElement).style.width).toBe(`${SECTIONS[i]!.fraction * 100}%`)
    }
  })

  it('splits the chassis 54% deck / 46% keybed', () => {
    renderApp()
    expect(screen.getByTestId('deck-block').style.height).toBe('54%')
    expect(screen.getByTestId('keys-block').style.height).toBe('46%')
  })

  it('keeps the deck, keybed and rails inside one continuous chassis element', () => {
    renderApp()
    const chassis = screen.getByTestId('chassis')
    expect(within(chassis).getByTestId('control-deck')).toBeInTheDocument()
    expect(within(chassis).getByTestId('keybed')).toBeInTheDocument()
    expect(chassis.querySelector('.top-rail')).toBeTruthy()
    expect(chassis.querySelector('.bottom-rail')).toBeTruthy()
    expect(chassis.querySelectorAll('.end-cheek')).toHaveLength(2)
  })

  it('labels the instrument with the assigned variant', () => {
    renderApp()
    const instrument = screen.getByTestId('instrument')
    expect(instrument.getAttribute('data-variant')).toBe('stage-4-73')
    expect(instrument.getAttribute('aria-label')).toMatch(/Nord Stage 4 73/)
  })
})

describe('visual.control-inventory — rendered surface', () => {
  it('renders every modeled hardware control exactly once with its stable id', () => {
    renderApp()
    for (const control of HARDWARE_CONTROLS) {
      const matches = document.querySelectorAll(`[data-control-id="${control.id}"]`)
      expect(matches, `control ${control.id}`).toHaveLength(1)
    }
  })

  it('renders each control inside its owning section', () => {
    renderApp()
    for (const control of HARDWARE_CONTROLS) {
      const element = document.querySelector(`[data-control-id="${control.id}"]`)!
      const section = element.closest('[data-section]')
      expect(section?.getAttribute('data-section'), `control ${control.id}`).toBe(control.section)
    }
  })

  it('renders exactly nine drawbars, all in the organ section', () => {
    renderApp()
    const drawbars = document.querySelectorAll('.drawbar')
    expect(drawbars).toHaveLength(9)
    for (const drawbar of drawbars) {
      expect(drawbar.closest('[data-section]')?.getAttribute('data-section')).toBe('organ')
    }
  })

  it('renders primary OLED displays only in Program and Synth', () => {
    renderApp()
    const oleds = document.querySelectorAll('.oled')
    expect(oleds).toHaveLength(2)
    expect(screen.getByTestId('oled-program').closest('[data-section]')?.getAttribute('data-section')).toBe('program')
    expect(screen.getByTestId('oled-synth').closest('[data-section]')?.getAttribute('data-section')).toBe('synth')
    for (const forbidden of ['performance', 'organ', 'piano', 'effects']) {
      const section = document.querySelector(`[data-section="${forbidden}"]`)!
      expect(section.querySelector('.oled'), `no OLED in ${forbidden}`).toBeNull()
    }
  })

  it('renders reference landmarks: wheels, program dial, eight program buttons, effect groups', () => {
    renderApp()
    expect(screen.getByRole('slider', { name: 'Pitch Stick' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Mod Wheel' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Master Level' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Program Dial' })).toBeInTheDocument()
    for (let i = 1; i <= 8; i++) {
      expect(screen.getByRole('button', { name: `Program ${i}` })).toBeInTheDocument()
    }
    for (const group of ['Mod 1', 'Mod 2', 'Amp Sim/EQ', 'Delay', 'Comp', 'Reverb', 'B3 Percussion', 'Piano Select', 'Arpeggiator/Gate']) {
      expect(screen.getByRole('group', { name: group })).toBeInTheDocument()
    }
  })

  it('renders the 73 keys inside the keybed', () => {
    renderApp()
    const keybed = screen.getByTestId('keybed')
    expect(keybed.querySelectorAll('.key')).toHaveLength(73)
    expect(keybed.querySelectorAll('.white-key')).toHaveLength(43)
    expect(keybed.querySelectorAll('.black-key')).toHaveLength(30)
  })
})
