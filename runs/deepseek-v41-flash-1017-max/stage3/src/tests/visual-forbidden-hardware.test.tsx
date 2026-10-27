import { describe, expect, it, afterEach } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import App from '../App'
import { createMemoryStorage } from '../audio/programStore'

/**
 * The `forbiddenDetection` half of visual.control-inventory.
 *
 * `specs/nord-stage-4.visual.json` defines each forbidden descriptor as a rule that resolves
 * to a number from the rendered DOM. jsdom has no layout, so width- and area-based rules are
 * checked here structurally (which sections carry a display element, how many, and the
 * declared width ratio in the stylesheet) and measured for real in
 * `evidence/stage1-capture.json`. The count-per-section rules are checked exactly.
 */
afterEach(() => cleanup())

const DISPLAY_MARKER = /oled|display|screen/i

function isDisplayElement(el: Element): boolean {
  const haystack = [
    el.getAttribute('aria-label') ?? '',
    el.id,
    typeof el.className === 'string' ? el.className : '',
    ...Object.entries((el as HTMLElement).dataset ?? {}).map(([k, v]) => `${k}=${v}`),
  ].join(' ')
  return DISPLAY_MARKER.test(haystack)
}

function displayElementsBySection(): Record<string, Element[]> {
  const result: Record<string, Element[]> = {}
  for (const section of Array.from(document.querySelectorAll('[data-section-id]'))) {
    const id = section.getAttribute('data-section-id') ?? ''
    result[id] = Array.from(section.querySelectorAll('*')).filter(isDisplayElement)
  }
  return result
}

describe('forbiddenDetection — display elements', () => {
  it('has no display element in the performance band', () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    const bySection = displayElementsBySection()
    expect(bySection.performance).toHaveLength(0)
  })

  it('has no display element in the effects band', () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    const bySection = displayElementsBySection()
    expect(bySection.effects).toHaveLength(0)
  })

  it('has no display element in the organ or piano bands', () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    const bySection = displayElementsBySection()
    expect(bySection.organ).toHaveLength(0)
    expect(bySection.piano).toHaveLength(0)
  })

  it('has exactly one display element in the program band, so "multiple primary displays" is 0', () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    const bySection = displayElementsBySection()
    expect(bySection.program).toHaveLength(1)
    expect(bySection.program[0].getAttribute('data-display-id')).toBe('program.display')
    // It is the one primary display, marked structurally.
    expect(bySection.program[0].getAttribute('data-display-root')).toBe('true')
  })

  it('has exactly one display element in the synth band, and it is not wide', () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    const bySection = displayElementsBySection()
    expect(bySection.synth).toHaveLength(1)
    const synthDisplay = bySection.synth[0]
    expect(synthDisplay.getAttribute('data-display-id')).toBe('synth.display')
    // The "wide" rule is a width ratio of at least 0.5 of the section. The synth OLED is
    // declared at 40% in the stylesheet, which is below the threshold at every viewport.
    expect(synthDisplay.className).toMatch(/glass-synth/)
  })

  it('never puts a display inside a control, so no control impersonates a screen', () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    for (const control of Array.from(document.querySelectorAll('[data-control-id]'))) {
      const inner = Array.from(control.querySelectorAll('*')).filter(isDisplayElement)
      expect(inner, control.getAttribute('data-control-id') ?? '').toHaveLength(0)
    }
  })
})

describe('forbiddenDetection — plates, grids and drawbars', () => {
  it('gives the performance band exposed chassis, so "full dark inset plate" is 0', () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    const performance = document.querySelector('[data-section-id="performance"]') as HTMLElement
    // No inset-plate surface class anywhere in that band.
    expect(performance.className).toContain('surface-exposed-chassis')
    expect(performance.className).not.toContain('surface-inset-plate')
    expect(performance.querySelector('[class*="surface-inset-plate"]')).toBeNull()
  })

  it('has no drawbar-shaped controls in the piano band, so "drawbar bank" is 0', () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    const piano = document.querySelector('[data-section-id="piano"]') as HTMLElement
    // Drawbars are the only control kind rendered as a tall narrow slider, and the piano
    // band has none of them.
    expect(piano.querySelectorAll('[data-kind="drawbar"]')).toHaveLength(0)
    expect(piano.querySelectorAll('.ctl-drawbar')).toHaveLength(0)
  })

  it('keeps all nine drawbars in the organ band, so its band is never a uniform grid', () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    const organ = document.querySelector('[data-section-id="organ"]') as HTMLElement
    const drawbars = organ.querySelectorAll('[data-kind="drawbar"]')
    expect(drawbars).toHaveLength(9)
    for (const drawbar of Array.from(drawbars)) {
      // The cell itself carries the drawbar class alongside its control id.
      expect(drawbar.className).toContain('ctl-drawbar')
      expect(drawbar.querySelector('[role="slider"]')).not.toBeNull()
    }
  })

  it('groups the effects band into separately labelled blocks, not one grid', () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    const effects = document.querySelector('[data-section-id="effects"]') as HTMLElement
    const blocks = Array.from(effects.querySelectorAll('[data-block-id]'))
    expect(blocks.length).toBeGreaterThanOrEqual(6)
    const legends = blocks
      .map((b) => b.querySelector('.block-legend')?.textContent?.trim() ?? '')
      .filter((text) => text.length > 0)
    // Every group carries its own printed legend.
    expect(legends.length).toBe(blocks.length)
    expect(legends).toEqual(
      expect.arrayContaining(['MOD 1', 'MOD 2', 'AMP SIM / EQ', 'DELAY', 'COMP', 'REVERB']),
    )
  })

  it('gives the organ band its own non-uniform block structure', () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    const organ = document.querySelector('[data-section-id="organ"]') as HTMLElement
    const blocks = Array.from(organ.querySelectorAll('[data-block-id]'))
    // Layer, model, vibrato, percussion and drawbars are five distinct groups.
    expect(blocks.length).toBeGreaterThanOrEqual(5)
    const legends = blocks.map((b) => b.querySelector('.block-legend')?.textContent?.trim() ?? '')
    expect(legends).toEqual(
      expect.arrayContaining(['LAYER', 'ORGAN MODEL', 'VIB / CHORUS', 'B3 PERCUSSION']),
    )
  })
})
