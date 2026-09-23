// Surface model: variant keybed, section geometry and control inventory, checked against the
// numbers in nord-stage-4.variants.json (stage-4-73) and nord-stage-4.visual.json v1.4.0.
import { describe, expect, it } from 'vitest'
import {
  CHASSIS_TOP,
  DECK_CHEEK_WIDTH,
  DECK_FRACTION,
  DECK_HEIGHT,
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  KEY_LEFT,
  KEY_RIGHT,
  KEYBED_CHEEK_WIDTH,
  KEYBED_HEIGHT,
  MEASURED_ASPECT,
  SECTIONS,
} from '../model/geometry'
import {
  BLACK_KEY_HEIGHT_FRACTION,
  HIGHEST_NOTE,
  isBlackNote,
  KEY_COUNT,
  keyAt,
  KEYS,
  LOWEST_NOTE,
  noteName,
  VARIANT_ID,
  WHITE_KEY_COUNT,
  WHITE_KEY_WIDTH,
} from '../model/keys'
import { PANEL } from '../model/panel'
import type { ControlDef } from '../model/panelTypes'

// stage-4-73 entry of nord-stage-4.variants.json
const VARIANT = { id: 'stage-4-73', totalKeys: 73, whiteKeys: 43, blackKeys: 30, aspectRatio: 3.0951, blackKeyHeightFraction: 0.61 }
// horizontalSections of nord-stage-4.visual.json (photo-measured v1.4.0 values), in order.
const SPEC_SECTIONS: [string, number][] = [
  ['performance', 0.14],
  ['organ', 0.2],
  ['piano', 0.085],
  ['program', 0.125],
  ['synth', 0.25],
  ['effects', 0.2],
]

const controls = PANEL.controls
const inSection = (id: string) => controls.filter((c) => c.section === id)
const ids = (list: readonly ControlDef[]) => new Set(list.map((c) => c.id))

describe('visual.key-count — Stage 4 73 keybed', () => {
  it('models exactly 73 keys, E1 (MIDI 28) to E7 (MIDI 100), 43 white + 30 black', () => {
    expect(VARIANT_ID).toBe(VARIANT.id)
    expect(KEY_COUNT).toBe(VARIANT.totalKeys)
    expect(KEYS).toHaveLength(73)
    expect(KEYS.filter((k) => !k.isBlack)).toHaveLength(VARIANT.whiteKeys)
    expect(KEYS.filter((k) => k.isBlack)).toHaveLength(VARIANT.blackKeys)
    expect(WHITE_KEY_COUNT).toBe(43)
    expect(LOWEST_NOTE).toBe(28)
    expect(HIGHEST_NOTE).toBe(100)
    expect(noteName(KEYS[0].midi)).toBe('E1')
    expect(noteName(KEYS[72].midi)).toBe('E7')
    expect(KEYS.map((k) => k.midi)).toEqual(Array.from({ length: 73 }, (_, i) => 28 + i))
  })

  it('has unique stable key ids and the piano white/black pattern in every octave', () => {
    expect(new Set(KEYS.map((k) => k.id)).size).toBe(73)
    expect(KEYS[0].id).toBe('key-E1')
    expect(KEYS.find((k) => k.midi === 61)?.id).toBe('key-Cs4')
    const pattern = KEYS.slice(8, 20).map((k) => (k.isBlack ? 'b' : 'w')).join('') // C2…B2
    expect(noteName(KEYS[8].midi)).toBe('C2')
    expect(pattern).toBe('wbwbwwbwbwbw')
    for (const k of KEYS) expect(k.isBlack).toBe(isBlackNote(k.midi))
    // Both ends are white keys, and no two black keys are adjacent.
    expect(KEYS[0].isBlack || KEYS[72].isBlack).toBe(false)
    for (let i = 1; i < KEYS.length; i++) expect(KEYS[i].isBlack && KEYS[i - 1].isBlack).toBe(false)
  })

  it('white keys tile the key surface exactly with equal widths and no gaps', () => {
    const whites = KEYS.filter((k) => !k.isBlack)
    expect(whites[0].x).toBeCloseTo(KEY_LEFT)
    expect(whites[42].x + whites[42].w).toBeCloseTo(KEY_RIGHT)
    for (let i = 1; i < whites.length; i++) {
      expect(whites[i].x).toBeCloseTo(whites[i - 1].x + whites[i - 1].w)
      expect(whites[i].w).toBeCloseTo(WHITE_KEY_WIDTH)
      expect(whites[i].whiteIndex).toBe(i)
    }
    // Cheeks on both sides; the keybed is symmetric in the chassis.
    expect(KEY_LEFT).toBe(KEYBED_CHEEK_WIDTH)
    expect(DESIGN_WIDTH - KEY_RIGHT).toBe(KEYBED_CHEEK_WIDTH)
  })

  it('black keys are 61 % long, narrower than whites and straddle a white-key boundary', () => {
    expect(BLACK_KEY_HEIGHT_FRACTION).toBe(VARIANT.blackKeyHeightFraction)
    const whites = KEYS.filter((k) => !k.isBlack)
    for (const k of KEYS.filter((b) => b.isBlack)) {
      expect(k.h / whites[0].h).toBeCloseTo(0.61, 5)
      expect(k.w).toBeLessThan(WHITE_KEY_WIDTH * 0.7)
      const boundary = KEY_LEFT + (k.whiteIndex + 1) * WHITE_KEY_WIDTH
      expect(k.x).toBeLessThan(boundary)
      expect(k.x + k.w).toBeGreaterThan(boundary)
    }
  })

  it('hit-testing puts black keys on top and white keys below them', () => {
    const cs4 = KEYS.find((k) => k.midi === 61)!
    const c4 = KEYS.find((k) => k.midi === 60)!
    expect(keyAt(cs4.x + cs4.w / 2, cs4.y + 10)?.midi).toBe(61)
    // Below the black key's tip the same x is the white key.
    expect([60, 62]).toContain(keyAt(cs4.x + cs4.w / 2, cs4.y + cs4.h + 5)?.midi)
    expect(keyAt(c4.x + 3, c4.y + c4.h - 5)?.midi).toBe(60)
    expect(keyAt(KEY_LEFT - 5, c4.y + 10)).toBeNull()
  })
})

describe('visual.section-layout — six sections, 54/46 split, one chassis', () => {
  it('instrument aspect ratio matches the measured variant bounds', () => {
    expect(MEASURED_ASPECT).toBe(VARIANT.aspectRatio)
    expect(Math.abs(DESIGN_WIDTH / DESIGN_HEIGHT - VARIANT.aspectRatio) / VARIANT.aspectRatio).toBeLessThan(0.002)
  })

  it('splits deck/keybed 54/46 within the spec tolerance', () => {
    expect(DECK_FRACTION).toBe(0.54)
    expect(Math.abs(DECK_HEIGHT / DESIGN_HEIGHT - 0.54)).toBeLessThan(0.025)
    expect(Math.abs(KEYBED_HEIGHT / DESIGN_HEIGHT - 0.46)).toBeLessThan(0.025)
    expect(DECK_HEIGHT + KEYBED_HEIGHT).toBe(DESIGN_HEIGHT)
  })

  it('orders the six sections at their documented widths and tiles the full width', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(SPEC_SECTIONS.map(([id]) => id))
    let left = 0
    SECTIONS.forEach((s, i) => {
      expect(s.fraction).toBe(SPEC_SECTIONS[i][1])
      expect(s.left).toBe(left)
      expect(Math.abs(s.width / DESIGN_WIDTH - s.fraction)).toBeLessThan(0.001)
      left += s.width
    })
    expect(left).toBe(DESIGN_WIDTH)
    expect(SPEC_SECTIONS.reduce((sum, [, f]) => sum + f, 0)).toBeCloseTo(1)
  })

  it('keeps the chassis continuous: the cheeks, deck and keybed share one outline', () => {
    expect(CHASSIS_TOP).toBeGreaterThan(0)
    expect(CHASSIS_TOP).toBeLessThan(DECK_HEIGHT * 0.1)
    expect(DECK_CHEEK_WIDTH).toBeGreaterThan(0)
    expect(KEYBED_CHEEK_WIDTH).toBeGreaterThanOrEqual(DECK_CHEEK_WIDTH)
    // The key surface starts right under the deck and ends above the bottom edge (front rail).
    const top = Math.min(...KEYS.map((k) => k.y))
    const bottom = Math.max(...KEYS.map((k) => k.y + k.h))
    expect(top - DECK_HEIGHT).toBeGreaterThanOrEqual(0)
    expect(top - DECK_HEIGHT).toBeLessThan(10)
    expect(bottom).toBeLessThan(DESIGN_HEIGHT)
    expect(DESIGN_HEIGHT - bottom).toBeLessThan(30)
  })
})

describe('visual.control-inventory — stable ids, landmarks, density, OLEDs', () => {
  it('every control has a unique stable id prefixed by its section and a non-empty label', () => {
    expect(controls.length).toBeGreaterThanOrEqual(140)
    expect(ids(controls).size).toBe(controls.length)
    for (const c of controls) {
      expect(c.id).toMatch(new RegExp(`^${c.section}-[a-z0-9-]+$`))
      expect(c.label.trim().length).toBeGreaterThan(2)
    }
    // A few ids the later phases depend on must never change.
    for (const id of ['performance-master-level', 'organ-drawbar-1', 'piano-type', 'program-dial', 'synth-filter-freq', 'effects-reverb-dry-wet'])
      expect(ids(controls).has(id)).toBe(true)
  })

  it('every control sits inside its own section on the deck', () => {
    for (const c of controls) {
      const s = SECTIONS.find((x) => x.id === c.section)!
      expect(c.x - c.w / 2).toBeGreaterThanOrEqual(s.left - 0.5)
      expect(c.x + c.w / 2).toBeLessThanOrEqual(s.left + s.width + 0.5)
      expect(c.y - c.h / 2).toBeGreaterThanOrEqual(CHASSIS_TOP)
      expect(c.y + c.h / 2).toBeLessThanOrEqual(DECK_HEIGHT)
    }
  })

  it('performance: master level, rotary block, pitch stick, mod wheel — on red chassis', () => {
    const p = ids(inSection('performance'))
    for (const id of ['performance-master-level', 'performance-pitch-stick', 'performance-mod-wheel', 'performance-rotary-speed', 'performance-rotary-drive'])
      expect(p.has(id)).toBe(true)
    expect(inSection('performance').find((c) => c.id === 'performance-mod-wheel')?.kind).toBe('mod-wheel')
    expect(inSection('performance').find((c) => c.id === 'performance-pitch-stick')?.kind).toBe('pitch-stick')
    expect(PANEL.plates.filter((pl) => pl.section === 'performance')).toHaveLength(0)
    expect(PANEL.legends.some((l) => l.section === 'performance' && /nord/i.test(l.text))).toBe(true)
  })

  it('organ: nine drawbars with LED graphs, level ladders, model and percussion switches', () => {
    const organ = inSection('organ')
    const drawbars = organ.filter((c) => c.kind === 'drawbar')
    expect(drawbars).toHaveLength(9)
    for (const d of drawbars) {
      expect(d.h / d.w).toBeGreaterThanOrEqual(3)
      expect(PANEL.graphs.some((g) => g.kind === 'drawbar' && g.owner === d.id)).toBe(true)
    }
    expect(PANEL.graphs.filter((g) => g.kind === 'ladder' && g.section === 'organ')).toHaveLength(2)
    const o = ids(organ)
    for (const id of ['organ-model', 'organ-perc-on', 'organ-perc-volume', 'organ-perc-decay', 'organ-perc-harmonic', 'organ-vibchorus-on', 'organ-level-a', 'organ-level-b'])
      expect(o.has(id)).toBe(true)
    // Drawbars exist nowhere else (no drawbar bank in the piano band).
    expect(controls.filter((c) => c.kind === 'drawbar' && c.section !== 'organ')).toHaveLength(0)
  })

  it('piano: layer levels, type selector, model dial, timbre and detail switches — no tall-control bank', () => {
    const p = ids(inSection('piano'))
    for (const id of ['piano-level-a', 'piano-level-b', 'piano-type', 'piano-model', 'piano-timbre', 'piano-kb-touch', 'piano-dyn-comp', 'piano-unison', 'piano-acoustics'])
      expect(p.has(id)).toBe(true)
    const tall = inSection('piano').filter((c) => c.h >= 3 * c.w)
    expect(tall.length).toBeLessThan(6)
  })

  it('program: one primary OLED, large dial, eight slots, page, live/scene, store/split, three morph buttons', () => {
    const p = ids(inSection('program'))
    for (let i = 1; i <= 8; i++) expect(p.has(`program-slot-${i}`)).toBe(true)
    for (const id of ['program-dial', 'program-page-left', 'program-page-right', 'program-live-mode', 'program-layer-scene', 'program-store', 'program-split', 'program-morph-wheel', 'program-morph-at', 'program-morph-ctrlped'])
      expect(p.has(id)).toBe(true)
    const dial = inSection('program').find((c) => c.id === 'program-dial')!
    expect(dial.kind).toBe('encoder')
    // A round dial with the largest footprint of any program-section control.
    expect(dial.w).toBe(dial.h)
    for (const c of inSection('program')) expect(dial.w * dial.h).toBeGreaterThanOrEqual(c.w * c.h)
  })

  it('synth: OLED, three layer levels, oscillator, filter, envelope, LFO and arpeggiator groups — mixed control types', () => {
    const synth = inSection('synth')
    const s = ids(synth)
    for (const id of ['synth-level-a', 'synth-level-b', 'synth-level-c', 'synth-osc-pitch', 'synth-osc-ctrl', 'synth-filter-freq', 'synth-filter-res', 'synth-amp-envelope', 'synth-filter-envelope', 'synth-lfo-rate', 'synth-arp-rate', 'synth-arp-run'])
      expect(s.has(id)).toBe(true)
    expect(new Set(synth.map((c) => c.kind)).size).toBeGreaterThanOrEqual(4)
    // Not one uniform knob matrix: knob sizes differ.
    const knobSizes = new Set(synth.filter((c) => c.kind === 'knob').map((c) => Math.round(c.w)))
    expect(knobSizes.size).toBeGreaterThan(1)
  })

  it('effects: two mod groups, amp/EQ, delay, compressor, reverb and focus controls, no OLED', () => {
    const e = ids(inSection('effects'))
    for (const id of ['effects-mod1-on', 'effects-mod2-on', 'effects-amp-on', 'effects-eq-bass', 'effects-eq-mid', 'effects-eq-treble', 'effects-delay-on', 'effects-delay-feedback', 'effects-comp-on', 'effects-reverb-on', 'effects-focus-organ', 'effects-focus-piano', 'effects-focus-synth'])
      expect(e.has(id)).toBe(true)
  })

  it('density follows the reference: every section is populated, synth and program are densest', () => {
    const count = Object.fromEntries(SECTIONS.map((s) => [s.id, inSection(s.id).length]))
    expect(count.performance).toBeGreaterThanOrEqual(5)
    expect(count.organ).toBeGreaterThanOrEqual(20)
    expect(count.piano).toBeGreaterThanOrEqual(12)
    expect(count.program).toBeGreaterThanOrEqual(25)
    expect(count.synth).toBeGreaterThanOrEqual(35)
    expect(count.effects).toBeGreaterThanOrEqual(30)
    expect(PANEL.leds.length).toBeGreaterThan(150)
  })

  it('Program and Synth carry the only primary OLEDs; the synth OLED is narrow', () => {
    expect(PANEL.oleds.map((o) => o.section).sort()).toEqual(['program', 'synth'])
    for (const o of PANEL.oleds) {
      const s = SECTIONS.find((x) => x.id === o.section)!
      expect(o.x1).toBeGreaterThanOrEqual(s.left)
      expect(o.x2).toBeLessThanOrEqual(s.left + s.width)
      expect((o.x2 - o.x1) / s.width).toBeLessThan(0.5)
    }
  })

  it('every LED and graph belongs to an existing control or is an unlit indicator', () => {
    const all = ids(controls)
    expect(new Set(PANEL.leds.map((l) => l.id)).size).toBe(PANEL.leds.length)
    for (const led of PANEL.leds) if (led.owner) expect(all.has(led.owner)).toBe(true)
    for (const g of PANEL.graphs) expect(all.has(g.owner)).toBe(true)
    for (const c of controls) if (c.kind === 'button') for (const state of c.states) for (const led of state) expect(PANEL.leds.some((l) => l.id === led)).toBe(true)
  })
})
