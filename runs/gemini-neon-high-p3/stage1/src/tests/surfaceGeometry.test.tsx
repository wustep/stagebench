import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from '../App'
import type { MidiProvider, PianoEngineStatusSnapshot, PianoVoiceBackend } from '../audio/boundaries'
import { ORGAN_DRAWBAR_SPECS, PANEL_CONTROLS } from '../model/controls'
import {
  STAGE_4_73_BLACK_KEYS,
  STAGE_4_73_KEYS,
  STAGE_4_73_VARIANT,
  STAGE_4_73_WHITE_KEYS,
} from '../model/variant'

function createSilentBackend(): PianoVoiceBackend {
  const status: PianoEngineStatusSnapshot = {
    status: 'ready',
    loadedSamples: 78,
    totalSamples: 78,
    usingFallback: false,
    message: 'Salamander Grand V3 ready (78/78 samples)',
    audioContextState: 'running',
  }
  return {
    unlock: async () => undefined,
    triggerNote: () => undefined,
    releaseNote: () => undefined,
    stopAllImmediate: () => undefined,
    getActiveNodeCount: () => 0,
    getStatus: () => status,
    subscribeStatus: () => () => undefined,
    dispose: () => undefined,
  }
}

const unsupportedMidi: MidiProvider = {
  isSupported: () => false,
  requestAccess: async () => {
    throw new Error('unsupported')
  },
}

afterEach(() => {
  cleanup()
})

describe('visual.key-count — Stage 4 73 keybed geometry', () => {
  it('models exactly 73 keys (43 white, 30 black) spanning E1 (MIDI 28) to E7 (MIDI 100)', () => {
    expect(STAGE_4_73_KEYS).toHaveLength(73)
    expect(STAGE_4_73_WHITE_KEYS).toHaveLength(43)
    expect(STAGE_4_73_BLACK_KEYS).toHaveLength(30)
    expect(STAGE_4_73_KEYS[0].midi).toBe(28)
    expect(STAGE_4_73_KEYS[0].noteName).toBe('E1')
    expect(STAGE_4_73_KEYS[STAGE_4_73_KEYS.length - 1].midi).toBe(100)
    expect(STAGE_4_73_KEYS[STAGE_4_73_KEYS.length - 1].noteName).toBe('E7')
    expect(STAGE_4_73_VARIANT.keyboard.blackKeyHeightFraction).toBeCloseTo(0.61, 4)

    // Verify monotonically increasing white key positions summing to 100%
    const totalWhiteWidth = STAGE_4_73_WHITE_KEYS.reduce((acc, k) => acc + k.widthPercent, 0)
    expect(totalWhiteWidth).toBeCloseTo(100, 4)
    for (let i = 1; i < STAGE_4_73_WHITE_KEYS.length; i++) {
      expect(STAGE_4_73_WHITE_KEYS[i].leftPercent).toBeGreaterThan(
        STAGE_4_73_WHITE_KEYS[i - 1].leftPercent,
      )
    }

    // Verify every black key sits cleanly inside 0..100%
    for (const bk of STAGE_4_73_BLACK_KEYS) {
      expect(bk.leftPercent).toBeGreaterThan(0)
      expect(bk.leftPercent + bk.widthPercent).toBeLessThan(100)
    }
  })

  it('renders all 73 playable keys with exact color counts and E1–E7 boundaries', () => {
    const { container } = render(
      <App pianoBackend={createSilentBackend()} midiProvider={unsupportedMidi} />,
    )
    const allKeys = container.querySelectorAll<HTMLButtonElement>('[data-key-midi]')
    const whiteKeys = container.querySelectorAll<HTMLButtonElement>('[data-key-color="white"]')
    const blackKeys = container.querySelectorAll<HTMLButtonElement>('[data-key-color="black"]')

    expect(allKeys).toHaveLength(73)
    expect(whiteKeys).toHaveLength(43)
    expect(blackKeys).toHaveLength(30)
    expect(container.querySelector('#key-28-E1')).not.toBeNull()
    expect(container.querySelector('#key-60-C4')).not.toBeNull()
    expect(container.querySelector('#key-100-E7')).not.toBeNull()
    expect(blackKeys[0].style.height).toBe('61%')
  })
})

describe('visual.section-layout — 6 ordered sections & 54/46 vertical allocation', () => {
  it('declares exact photo-measured section widths summing to 1.0 and 54/46 vertical split', () => {
    const sectionOrder = STAGE_4_73_VARIANT.sections.map((s) => s.id)
    expect(sectionOrder).toEqual(['performance', 'organ', 'piano', 'program', 'synth', 'effects'])
    const sum = STAGE_4_73_VARIANT.sections.reduce((acc, s) => acc + s.fraction, 0)
    expect(sum).toBeCloseTo(1.0, 5)
    expect(STAGE_4_73_VARIANT.verticalAllocation.controlDeckIncludingTopRail).toBe(0.54)
    expect(STAGE_4_73_VARIANT.verticalAllocation.keybedIncludingBottomRail).toBe(0.46)
    expect(STAGE_4_73_VARIANT.aspectRatio).toBeCloseTo(3.0951, 4)
  })

  it('renders the 6 ordered sections inside one continuous chassis above the keybed', () => {
    const { container } = render(
      <App pianoBackend={createSilentBackend()} midiProvider={unsupportedMidi} />,
    )
    const chassis = container.querySelector('[data-component="instrument-chassis"]')
    expect(chassis).not.toBeNull()

    const deckSections = Array.from(
      container.querySelectorAll<HTMLElement>('[data-component="deck-sections"] > [data-section]'),
    ).map((el) => el.dataset.section)
    expect(deckSections).toEqual(['performance', 'organ', 'piano', 'program', 'synth', 'effects'])
  })
})

describe('visual.control-inventory — landmarks, stable IDs, and OLED exclusivity', () => {
  it('renders every normalized panel control with a unique stable ID', () => {
    const ids = PANEL_CONTROLS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ORGAN_DRAWBAR_SPECS).toHaveLength(9)

    const { container } = render(
      <App pianoBackend={createSilentBackend()} midiProvider={unsupportedMidi} />,
    )
    for (const control of PANEL_CONTROLS) {
      const el = container.querySelector(`[data-control-id="${control.id}"]`)
      expect(el, `missing rendered control ${control.id}`).not.toBeNull()
      expect(el?.id).toBe(control.id)
    }
  })

  it('renders OLED displays ONLY in Program and Synth sections, never in Performance, Organ, Piano, or Effects', () => {
    const { container } = render(
      <App pianoBackend={createSilentBackend()} midiProvider={unsupportedMidi} />,
    )
    const oledQuery = '[id*="oled"], [class*="oled"], [id*="display"], [class*="display"], [id*="screen"], [class*="screen"]'
    const sectionCounts: Record<string, number> = {}
    for (const sectionId of ['performance', 'organ', 'piano', 'program', 'synth', 'effects']) {
      const sectionEl = container.querySelector(`[data-section="${sectionId}"]`)!
      sectionCounts[sectionId] = sectionEl.querySelectorAll(oledQuery).length
    }

    expect(sectionCounts.performance).toBe(0)
    expect(sectionCounts.organ).toBe(0)
    expect(sectionCounts.piano).toBe(0)
    expect(sectionCounts.effects).toBe(0)
    expect(sectionCounts.program).toBeGreaterThanOrEqual(1)
    expect(sectionCounts.synth).toBeGreaterThanOrEqual(1)
    expect(container.querySelectorAll('#program-oled')).toHaveLength(1)
    expect(container.querySelectorAll('#synth-oled')).toHaveLength(1)
  })

  it('includes every section-specific landmark required by visual spec', () => {
    const { container } = render(
      <App pianoBackend={createSilentBackend()} midiProvider={unsupportedMidi} />,
    )
    // Performance: exposed red chassis (no .ns4-plate), pitch stick, mod wheel, master level, rotary, branding
    const perf = container.querySelector('[data-section="performance"]')!
    expect(perf.querySelector('.ns4-plate')).toBeNull()
    expect(perf.querySelector('#perf-pitch-stick')).not.toBeNull()
    expect(perf.querySelector('#perf-mod-wheel')).not.toBeNull()
    expect(perf.querySelector('#perf-master-level')).not.toBeNull()
    expect(perf.querySelector('#perf-rotary-drive')).not.toBeNull()
    expect(perf.textContent).toMatch(/nord stage 4/i)

    // Organ: 9 physical drawbars + LED ladders + model/percussion
    const organ = container.querySelector('[data-section="organ"]')!
    expect(organ.querySelectorAll('[data-control-kind="drawbar"]')).toHaveLength(9)
    expect(organ.querySelector('#organ-model-select')).not.toBeNull()
    expect(organ.querySelector('#organ-perc-on')).not.toBeNull()

    // Piano: layer faders, type selector, model dial, timbre, details
    const piano = container.querySelector('[data-section="piano"]')!
    expect(piano.querySelector('#piano-type-select')).not.toBeNull()
    expect(piano.querySelector('#piano-model-dial')).not.toBeNull()
    expect(piano.querySelector('#piano-timbre')).not.toBeNull()

    // Program: OLED, dial, 8 program buttons, page nav, Live Mode, Layer Scene II, Store, Split, 3 morph buttons
    const program = container.querySelector('[data-section="program"]')!
    expect(program.querySelector('#program-oled')).not.toBeNull()
    expect(program.querySelector('#program-dial')).not.toBeNull()
    for (let i = 1; i <= 8; i++) {
      expect(program.querySelector(`#program-btn-${i}`)).not.toBeNull()
    }
    expect(program.querySelector('#program-live-mode')).not.toBeNull()
    expect(program.querySelector('#program-layer-scene')).not.toBeNull()
    expect(program.querySelector('#program-morph-wheel')).not.toBeNull()
    expect(program.querySelector('#program-morph-at')).not.toBeNull()
    expect(program.querySelector('#program-morph-ctrlped')).not.toBeNull()

    // Synth: single OLED, 3 layer faders, osc, filter, LFO, arp
    const synth = container.querySelector('[data-section="synth"]')!
    expect(synth.querySelector('#synth-oled')).not.toBeNull()
    expect(synth.querySelectorAll('[data-control-kind="fader"]')).toHaveLength(3)
    expect(synth.querySelector('#synth-filter-freq')).not.toBeNull()
    expect(synth.querySelector('#synth-arp-rate')).not.toBeNull()

    // Effects: 2 separated effect groups + FX Focus + amp/EQ, delay, comp, reverb
    const effects = container.querySelector('[data-section="effects"]')!
    expect(effects.querySelector('.ns4-fx-col-left')).not.toBeNull()
    expect(effects.querySelector('.ns4-fx-col-right')).not.toBeNull()
    expect(effects.querySelector('#fx-amp-drive')).not.toBeNull()
    expect(effects.querySelector('#fx-delay-tempo')).not.toBeNull()
    expect(effects.querySelector('#fx-comp-amount')).not.toBeNull()
    expect(effects.querySelector('#fx-reverb-dry-wet')).not.toBeNull()
  })
})

describe('regression.chassis — no marketing hero, no detached rails, honest Phase 1 status', () => {
  it('renders no marketing hero heading above the instrument and keeps one continuous chassis', () => {
    const { container } = render(
      <App pianoBackend={createSilentBackend()} midiProvider={unsupportedMidi} />,
    )
    expect(container.querySelector('h1')).toBeNull()
    const main = container.querySelector('main.ns4-studio')!
    const firstChild = main.firstElementChild!
    expect(firstChild.classList.contains('ns4-stage-scroller')).toBe(true)
    expect(firstChild.querySelector('[data-component="instrument-chassis"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-component="instrument-chassis"]')).toHaveLength(1)
    expect(container.querySelector('#program-oled')?.textContent).toMatch(/PANEL: DECORATIVE/i)
    expect(container.querySelector('#synth-oled')?.textContent).toMatch(/Decorative/i)
  })
})
