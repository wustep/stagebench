import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import { CONTROLS, INTERACTIVE_CONTROLS, OLED_CONTROLS } from './model/controls'
import { BLACK_KEYS, KEYBED, WHITE_KEYS } from './model/keys'
import { PRIMARY_OLED_IDS, SECTION_FRACTIONS, SECTION_ORDER, VARIANT } from './model/variant'

function renderStage() {
  return render(<App deps={{ autoMidi: false }} />)
}

describe('visual.key-count', () => {
  it('models the Stage 4 73 keybed exactly', () => {
    expect(KEYBED).toHaveLength(73)
    expect(WHITE_KEYS).toHaveLength(43)
    expect(BLACK_KEYS).toHaveLength(30)
    expect(KEYBED[0]?.name).toBe('E1')
    expect(KEYBED[KEYBED.length - 1]?.name).toBe('E7')
    expect(KEYBED[0]?.midi).toBe(VARIANT.midiMin)
    expect(KEYBED[KEYBED.length - 1]?.midi).toBe(VARIANT.midiMax)
  })

  it('renders every key with the white/black pattern', () => {
    renderStage()
    const whites = document.querySelectorAll('[data-key-color="white"]')
    const blacks = document.querySelectorAll('[data-key-color="black"]')
    expect(whites).toHaveLength(43)
    expect(blacks).toHaveLength(30)
    expect(document.querySelectorAll('[data-key]')).toHaveLength(73)
    expect(screen.getByLabelText('E1')).toBeInTheDocument()
    expect(screen.getByLabelText('E7')).toBeInTheDocument()
    expect(screen.getByLabelText('C4')).toBeInTheDocument()
    expect(screen.getByLabelText('C#4')).toHaveAttribute('data-key-color', 'black')
  })
})

describe('visual.section-layout', () => {
  it('keeps the 54/46 split and six ordered sections at spec fractions', () => {
    renderStage()
    const stage = screen.getByTestId('instrument')
    expect(stage).toHaveAttribute('data-deck-fraction', '0.54')
    expect(stage).toHaveAttribute('data-keybed-fraction', '0.46')
    expect(screen.getByTestId('deck')).toHaveAttribute('data-sections', SECTION_ORDER.join(','))
    for (const id of SECTION_ORDER) {
      const section = document.querySelector(`[data-section="${id}"]`)
      expect(section).not.toBeNull()
      expect(section).toHaveAttribute('data-section', id)
    }
    expect(SECTION_FRACTIONS.performance + SECTION_FRACTIONS.organ + SECTION_FRACTIONS.piano + SECTION_FRACTIONS.program + SECTION_FRACTIONS.synth + SECTION_FRACTIONS.effects).toBeCloseTo(1, 5)
    expect(screen.getByTestId('deck').className).toContain('deck')
    expect(screen.getByTestId('keybed-shell').className).toContain('keybed-shell')
  })
})

describe('visual.control-inventory', () => {
  it('exposes stable IDs and only Program/Synth primary OLEDs', () => {
    renderStage()
    expect(OLED_CONTROLS.map((c) => c.id)).toEqual([...PRIMARY_OLED_IDS])
    expect(screen.getByTestId('instrument')).toHaveAttribute('data-oled-count', '2')
    expect(document.querySelectorAll('.oled')).toHaveLength(2)
    expect(document.getElementById('program-oled')).toBeTruthy()
    expect(document.getElementById('synth-oled')).toBeTruthy()
    expect(document.querySelector('[data-section="performance"] .oled')).toBeNull()
    expect(document.querySelector('[data-section="organ"] .oled')).toBeNull()
    expect(document.querySelector('[data-section="piano"] .oled')).toBeNull()
    expect(document.querySelector('[data-section="effects"] .oled')).toBeNull()
    for (const control of CONTROLS) {
      expect(document.getElementById(control.id)).toBeTruthy()
    }
    expect(INTERACTIVE_CONTROLS.length).toBeGreaterThan(80)
    const organ = document.querySelector('[data-section="organ"]')
    expect(organ?.querySelectorAll('[id^="organ-drawbar-"]')).toHaveLength(9)
    const program = document.querySelector('[data-section="program"]')
    expect(program).not.toBeNull()
    expect(within(program as HTMLElement).getByLabelText('Program dial')).toBeInTheDocument()
  })
})
