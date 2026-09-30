import { describe, expect, it } from 'vitest'
import { ASPECT_RATIO, DECK_FRACTION, DECK_HEIGHT_U, HEIGHT_U, KEYS_LEFT_U, KEYS_RIGHT_U, SECTIONS } from './geometry'
import {
  BLACK_KEY_HEIGHT_FRACTION,
  BLACK_KEYS,
  HIGH_NOTE,
  KEY_BY_NOTE,
  KEY_COUNT,
  KEYS,
  LOW_NOTE,
  noteName,
  WHITE_KEYS,
} from './keybed'
import { CONTROLS, FRAMES, LEGENDS, OLEDS } from './layout'
import { createHardwareStore } from './store'
import type { SectionId } from './types'

describe('visual.key-count', () => {
  it('models exactly 73 keys, E to E, 43 white and 30 black', () => {
    expect(KEY_COUNT).toBe(73)
    expect(KEYS).toHaveLength(73)
    expect(WHITE_KEYS).toHaveLength(43)
    expect(BLACK_KEYS).toHaveLength(30)
    expect(noteName(LOW_NOTE)).toBe('E1')
    expect(noteName(HIGH_NOTE)).toBe('E7')
    expect(KEYS[0].name).toBe('E1')
    expect(KEYS.at(-1)!.name).toBe('E7')
  })

  it('has a continuous chromatic range with the real white/black pattern', () => {
    KEYS.forEach((k, i) => expect(k.note).toBe(LOW_NOTE + i))
    const pattern = KEYS.map((k) => (k.isBlack ? 'b' : 'w')).join('')
    // no two black keys are adjacent except never; every black sits between two white keys
    expect(pattern).not.toMatch(/bb/)
    expect(pattern.startsWith('w')).toBe(true)
    expect(pattern.endsWith('w')).toBe(true)
    // there are no black keys between E-F and B-C
    for (const k of BLACK_KEYS) expect(['C#', 'D#', 'F#', 'G#', 'A#']).toContain(k.name.replace(/\d/g, ''))
    expect(KEY_BY_NOTE.get(60)!.name).toBe('C4')
  })

  it('lays the white keys out edge to edge over the keybed span', () => {
    expect(WHITE_KEYS[0].x).toBeCloseTo(KEYS_LEFT_U, 1)
    for (let i = 1; i < WHITE_KEYS.length; i++) {
      expect(WHITE_KEYS[i].x).toBeCloseTo(WHITE_KEYS[i - 1].x + WHITE_KEYS[i - 1].w, 1)
    }
    const last = WHITE_KEYS.at(-1)!
    expect(last.x + last.w).toBeCloseTo(KEYS_RIGHT_U, 0)
  })

  it('places every black key across a white-key boundary and narrower than a white key', () => {
    for (const b of BLACK_KEYS) {
      const centre = b.x + b.w / 2
      const boundary = WHITE_KEYS.some((w) => Math.abs(w.x - centre) < w.w * 0.2)
      expect(boundary).toBe(true)
      expect(b.w).toBeLessThan(WHITE_KEYS[0].w)
    }
    expect(BLACK_KEY_HEIGHT_FRACTION).toBe(0.61)
  })

  it('has white keys with a realistic proportion (keys are ~6x taller than wide)', () => {
    const keyHeight = HEIGHT_U * (1 - DECK_FRACTION - 0.03)
    expect(keyHeight / WHITE_KEYS[0].w).toBeGreaterThan(5)
    expect(keyHeight / WHITE_KEYS[0].w).toBeLessThan(8)
  })
})

describe('visual.section-layout', () => {
  const expected: Record<SectionId, number> = { performance: 0.14, organ: 0.2, piano: 0.085, program: 0.125, synth: 0.25, effects: 0.2 }

  it('has six ordered sections with the documented fractions that tile the instrument', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(['performance', 'organ', 'piano', 'program', 'synth', 'effects'])
    for (const s of SECTIONS) {
      expect(s.fraction).toBe(expected[s.id])
      expect(s.width).toBeCloseTo(expected[s.id] * 1000, 6)
    }
    expect(SECTIONS.reduce((a, s) => a + s.fraction, 0)).toBeCloseTo(1, 9)
    for (let i = 1; i < SECTIONS.length; i++) expect(SECTIONS[i].left).toBeCloseTo(SECTIONS[i - 1].left + SECTIONS[i - 1].width, 6)
  })

  it('splits the height 54 / 46 between deck and keybed and matches the measured aspect ratio', () => {
    expect(DECK_FRACTION).toBe(0.54)
    expect(DECK_HEIGHT_U / HEIGHT_U).toBeCloseTo(0.54, 6)
    expect(ASPECT_RATIO).toBeCloseTo(3.0951, 3)
  })
})

describe('visual.control-inventory', () => {
  const bySection = (id: SectionId) => CONTROLS.filter((c) => c.section === id)
  const kinds = (id: SectionId, kind: string) => bySection(id).filter((c) => c.kind === kind)

  it('gives every control a stable, unique, kebab-case id and a name', () => {
    const ids = CONTROLS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of CONTROLS) {
      expect(c.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(c.label.trim().length).toBeGreaterThan(2)
    }
    expect(CONTROLS.length).toBeGreaterThan(170)
  })

  it('has exactly two primary OLEDs: Program and Synth', () => {
    expect(OLEDS.map((o) => [o.id, o.section])).toEqual([
      ['program-oled', 'program'],
      ['synth-oled', 'synth'],
    ])
    const program = SECTIONS.find((s) => s.id === 'program')!
    const synth = SECTIONS.find((s) => s.id === 'synth')!
    expect(OLEDS[0].w / program.width).toBeLessThan(0.5)
    expect(OLEDS[1].w / synth.width).toBeLessThan(0.5)
    expect(CONTROLS.some((c) => /oled|display|screen/i.test(`${c.id} ${c.label}`))).toBe(false)
  })

  it('performance: master level, wheels, rotary speaker and branding on bare chassis', () => {
    const ids = bySection('performance').map((c) => c.id)
    expect(ids).toEqual(expect.arrayContaining(['master-level', 'mod-wheel', 'pitch-stick', 'rotary-drive', 'rotary-speed']))
    expect(LEGENDS.some((l) => l.section === 'performance' && l.text === 'nord stage 4')).toBe(true)
    // rotary block sits inside 0.10-0.13 of the instrument width
    const rotary = bySection('performance').find((c) => c.id === 'rotary-drive')!
    expect(rotary.x / 1000).toBeGreaterThan(0.1)
    expect(rotary.x / 1000).toBeLessThan(0.14)
    // no full dark plate covering the performance band
    const plateArea = FRAMES.filter((f) => f.section === 'performance' && f.tone === 'plate').reduce((a, f) => a + f.w * f.h, 0)
    expect(plateArea).toBe(0)
  })

  it('organ: nine drawbars with LED ladders, faders, model, vibrato/chorus and percussion', () => {
    expect(kinds('organ', 'drawbar')).toHaveLength(9)
    expect(kinds('organ', 'fader')).toHaveLength(2)
    const ids = bySection('organ').map((c) => c.id)
    expect(ids).toEqual(expect.arrayContaining(['organ-model', 'organ-vib-chorus-mode', 'organ-perc-volume', 'organ-perc-decay', 'organ-perc-harmonic']))
    const xs = kinds('organ', 'drawbar').map((c) => c.x)
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1])
  })

  it('piano: layer levels, six-type selector, model dial, timbre, detail switches, no drawbars', () => {
    expect(kinds('piano', 'drawbar')).toHaveLength(0)
    expect(kinds('piano', 'fader')).toHaveLength(2)
    const piano = bySection('piano').find((c) => c.id === 'piano-select')
    expect(piano?.kind === 'button' && piano.options).toEqual(['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'])
    const ids = bySection('piano').map((c) => c.id)
    expect(ids).toEqual(expect.arrayContaining(['piano-model-dial', 'piano-timbre', 'piano-kb-touch', 'piano-dyn-comp', 'piano-unison', 'piano-string-res', 'piano-soft-release']))
  })

  it('program: dial, eight program buttons, page nav, live mode, layer scene, store, split, three morph buttons', () => {
    const ids = bySection('program').map((c) => c.id)
    for (let i = 1; i <= 8; i++) expect(ids).toContain(`program-button-${i}`)
    expect(ids).toEqual(
      expect.arrayContaining(['program-dial', 'program-page-prev', 'program-page-next', 'program-live-mode', 'program-layer-scene', 'program-store', 'program-split', 'program-morph-wheel', 'program-morph-at', 'program-morph-ctrlped']),
    )
  })

  it('synth: dense groups — oscillator, filter, envelope/amp, LFO and arpeggiator controls', () => {
    expect(bySection('synth').length).toBeGreaterThanOrEqual(50)
    expect(kinds('synth', 'knob').length).toBeGreaterThanOrEqual(9)
    expect(kinds('synth', 'fader')).toHaveLength(3)
    const ids = bySection('synth').map((c) => c.id)
    expect(ids).toEqual(expect.arrayContaining(['synth-osc-control', 'synth-filter-frequency', 'synth-filter-resonance', 'synth-amp-envelope', 'synth-lfo-rate', 'synth-arp-rate', 'synth-arp-run', 'synth-glide']))
  })

  it('effects: two effect groups plus amp/EQ, delay, compressor, reverb, and layer focus controls', () => {
    const ids = bySection('effects').map((c) => c.id)
    expect(ids).toEqual(
      expect.arrayContaining(['fx-mod1-rate', 'fx-mod2-rate', 'fx-amp-drive', 'fx-eq-bass', 'fx-eq-mid', 'fx-eq-treble', 'fx-delay-tempo', 'fx-delay-feedback', 'fx-comp-amount', 'fx-reverb-type', 'effects-focus-organ', 'effects-focus-piano', 'effects-focus-synth']),
    )
    const titles = FRAMES.filter((f) => f.section === 'effects' && f.title).map((f) => f.title)
    expect(titles).toEqual(expect.arrayContaining(['MOD 1', 'MOD 2', 'AMP SIM/EQ', 'DELAY', 'COMP', 'REVERB']))
  })

  it('keeps every control inside its section box and the deck', () => {
    for (const c of CONTROLS) {
      const s = SECTIONS.find((x) => x.id === c.section)!
      expect(c.x, c.id).toBeGreaterThan(0)
      expect(c.x, c.id).toBeLessThan(s.width)
      expect(c.y, c.id).toBeGreaterThan(8)
      expect(c.y, c.id).toBeLessThan(DECK_HEIGHT_U)
    }
  })

  it('does not lay out knob or button matrices as uniform grids', () => {
    for (const id of ['synth', 'effects', 'organ'] as SectionId[]) {
      const knobs = kinds(id, 'knob')
      const distinctRows = new Set(knobs.map((k) => Math.round(k.y / 3)))
      const distinctCols = new Set(knobs.map((k) => Math.round(k.x / 3)))
      if (knobs.length >= 8) {
        expect(distinctRows.size).toBeGreaterThan(3)
        expect(distinctCols.size).toBeGreaterThan(4)
      }
    }
  })
})

describe('hardware store (presentation state only)', () => {
  it('clamps, quantizes and notifies per control', () => {
    const store = createHardwareStore(CONTROLS)
    let hits = 0
    store.subscribe('synth-glide', () => hits++)
    store.set('synth-glide', 4)
    expect(store.get('synth-glide').value).toBe(1)
    store.set('synth-glide', -2)
    expect(store.get('synth-glide').value).toBe(0)
    store.step('synth-glide', 1)
    expect(store.get('synth-glide').value).toBeCloseTo(0.05)
    expect(hits).toBe(3)
    store.set('organ-drawbar-1', 11)
    expect(store.get('organ-drawbar-1').value).toBe(8)
    store.set('program-dial', 33)
    expect(store.get('program-dial').value).toBe(1)
  })

  it('latches, cycles and holds buttons', () => {
    const store = createHardwareStore(CONTROLS)
    store.press('organ-on')
    expect(store.get('organ-on')).toEqual({ value: 1, held: true })
    store.release('organ-on')
    expect(store.get('organ-on')).toEqual({ value: 1, held: false })
    store.press('organ-on')
    store.release('organ-on')
    expect(store.get('organ-on').value).toBe(0)

    for (let i = 0; i < 7; i++) {
      store.press('piano-select')
      store.release('piano-select')
    }
    expect(store.get('piano-select').value).toBe(1)

    store.press('program-store')
    expect(store.get('program-store')).toEqual({ value: 1, held: true })
    store.release('program-store')
    expect(store.get('program-store')).toEqual({ value: 0, held: false })
  })

  it('springs the pitch stick back but not the modulation wheel', () => {
    const store = createHardwareStore(CONTROLS)
    store.set('pitch-stick', 1)
    store.set('mod-wheel', 0.8)
    store.release('pitch-stick')
    store.release('mod-wheel')
    expect(store.get('pitch-stick').value).toBe(0.5)
    expect(store.get('mod-wheel').value).toBe(0.8)
  })
})
