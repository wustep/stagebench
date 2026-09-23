import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HARDWARE_CONTROLS } from '../model/hardware'
import { SECTIONS } from '../model/variant'
import { renderApp } from '../test/renderApp'

describe('visual.control-inventory surface', () => {
  it('renders every hardware control once, with Program and Synth as the only OLEDs', () => {
    renderApp()
    for (const control of HARDWARE_CONTROLS) {
      const nodes = document.querySelectorAll(`[data-control-id="${control.id}"]`)
      expect(nodes, control.id).toHaveLength(1)
      expect(nodes[0]).toHaveAttribute('data-decorative', 'true')
    }
    const oleds = document.querySelectorAll('.oled')
    expect(oleds).toHaveLength(2)
    expect(document.querySelector('[data-oled="program"]')).toBeTruthy()
    expect(document.querySelector('[data-oled="synth"]')).toBeTruthy()
    expect(screen.getByRole('status', { name: 'Program OLED' })).toBeInTheDocument()
    expect(document.querySelector('.section-performance .oled')).toBeNull()
    expect(document.querySelector('.section-effects .oled')).toBeNull()
    expect(document.querySelector('.section-organ .oled')).toBeNull()
    expect(document.querySelector('.section-piano .oled')).toBeNull()
  })
})

describe('visual.section-layout surface', () => {
  it('renders one continuous chassis, six ordered sections, and the 54/46 split', () => {
    renderApp()
    expect(document.querySelectorAll('[data-testid="chassis"]')).toHaveLength(1)
    const sections = [...document.querySelectorAll<HTMLElement>('[data-section]')]
    expect(sections.map((section) => section.dataset.section)).toEqual(SECTIONS.map((section) => section.id))
    sections.forEach((section, index) => {
      expect(section.dataset.fraction).toBe(String(SECTIONS[index]!.fraction))
      expect(parseFloat(section.style.width)).toBeCloseTo(SECTIONS[index]!.fraction * 100, 4)
    })
    expect(document.querySelector('[data-testid="control-deck"]')).toHaveAttribute('data-split', '0.54')
    expect(document.querySelector('[data-testid="keybed-band"]')).toHaveAttribute('data-split', '0.46')
    expect(document.querySelector('.section-performance .plate')).toBeNull()
    expect(document.querySelector('.section-organ .plate')).toBeTruthy()
    expect(document.querySelectorAll('.drawbar')).toHaveLength(9)
  })
})
