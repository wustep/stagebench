import { describe, expect, it } from 'vitest'
import { DECK_HEIGHT, SECTIONS, sectionGeometry, toSectionX } from '../src/hardware/geometry'
import { INVENTORY, buildInventory, sectionInventory } from '../src/hardware/inventory'
import type { ControlDef, SectionId } from '../src/hardware/types'
import { mountApp } from './support/app'
import { SPEC_LANDMARKS, SPEC_SECTIONS } from './support/spec'

/**
 * Feature: visual.control-inventory
 * Stable control IDs, per-section landmarks and density, Program/Synth as the only primary OLEDs.
 */

/**
 * The frozen control list. These IDs are the public contract later phases attach behaviour
 * to, so any rename, removal, or reorder must show up here as a deliberate change.
 */
const STABLE_IDS: Record<SectionId, string[]> = {
  performance: ['perf-pitch-stick', 'perf-mod-wheel', 'perf-master-level', 'rotary-drive', 'rotary-source', 'rotary-stop-mode', 'rotary-speed'],
  organ: [
    'organ-on', 'organ-layer-a-level', 'organ-layer-a', 'organ-layer-b-level', 'organ-layer-b', 'organ-preset',
    'organ-octave-down', 'organ-octave-up', 'organ-model', 'organ-vibrato-type', 'organ-vibrato-on',
    'organ-perc-volume-soft', 'organ-perc-decay-fast', 'organ-perc-harmonic-third', 'organ-perc-on',
    'organ-drawbar-1', 'organ-drawbar-2', 'organ-drawbar-3', 'organ-drawbar-4', 'organ-drawbar-5',
    'organ-drawbar-6', 'organ-drawbar-7', 'organ-drawbar-8', 'organ-drawbar-9',
  ],
  piano: [
    'piano-on', 'piano-layer-a-level', 'piano-layer-a', 'piano-layer-b-level', 'piano-layer-b', 'piano-timbre',
    'piano-octave-down', 'piano-octave-up', 'piano-acoustics', 'piano-unison', 'piano-kb-touch', 'piano-dyn-comp',
    'piano-type', 'piano-model',
  ],
  program: [
    'morph-wheel', 'morph-aftertouch', 'morph-control-pedal', 'split', 'mst-clk', 'transpose', 'prog-view', 'store',
    'preset-organ', 'preset-piano', 'preset-synth', 'program-dial', 'page-prev', 'page-next', 'live-mode',
    'layer-scene', 'program-1', 'program-2', 'program-3', 'program-4', 'program-5', 'program-6', 'program-7',
    'program-8', 'solo', 'section-edit', 'mon-copy', 'shift',
  ],
  synth: [
    'synth-on', 'synth-layer-a-level', 'synth-layer-a', 'synth-layer-b-level', 'synth-layer-b', 'synth-layer-c-level',
    'synth-layer-c', 'synth-kb-hold', 'synth-arp-run', 'synth-octave-down', 'synth-octave-up', 'synth-osc-dial-1',
    'synth-osc-dial-2', 'synth-osc-dial-3', 'synth-mode', 'synth-waveform', 'synth-lfo-waveform', 'synth-lfo-amount',
    'synth-lfo-rate', 'synth-lfo-dest', 'synth-osc-pitch', 'synth-osc-ctrl', 'synth-osc-envelope', 'synth-osc-env-amt',
    'synth-arp-rate', 'synth-arp-mode', 'synth-arp-range', 'synth-arp-menu', 'synth-voice-mode', 'synth-glide',
    'synth-vibrato-mode', 'synth-vibrato-menu', 'synth-filter-type', 'synth-filter-envelope', 'synth-filter-env-amt',
    'synth-filter-freq', 'synth-filter-res', 'synth-filter-on', 'synth-amp-envelope', 'synth-unison',
  ],
  effects: [
    'fx-on', 'fx-focus-organ', 'fx-focus-piano', 'fx-focus-synth', 'fx-shift', 'fx-mod1-rate', 'fx-mod1-amount',
    'fx-mod1-type', 'fx-mod1-on', 'fx-mod2-rate', 'fx-mod2-amount', 'fx-mod2-type', 'fx-mod2-on', 'fx-drive',
    'fx-eq-bass', 'fx-eq-mid-freq', 'fx-eq-mid', 'fx-eq-treble', 'fx-amp-type', 'fx-amp-on', 'fx-delay-tempo',
    'fx-delay-effects', 'fx-delay-tap', 'fx-delay-mix', 'fx-delay-feedback', 'fx-delay-filter', 'fx-delay-on',
    'fx-comp-amount', 'fx-comp-on', 'fx-reverb-tone', 'fx-reverb-type', 'fx-reverb-mix', 'fx-reverb-on',
  ],
}

const ALL_SECTIONS = SPEC_SECTIONS.map((section) => section.id) as SectionId[]

function count(id: SectionId, predicate: (control: ControlDef) => boolean): number {
  return sectionInventory(id).controls.filter(predicate).length
}

/** A drawbar-like control per the spec's forbiddenDetection rules: at least 3× taller than wide. */
const isTall = (control: ControlDef) => control.h >= control.w * 3

describe('visual.control-inventory: stable IDs', () => {
  it('matches the frozen control list exactly, section by section, in order', () => {
    for (const id of ALL_SECTIONS) {
      expect(sectionInventory(id).controls.map((control) => control.id)).toEqual(STABLE_IDS[id])
    }
    expect(INVENTORY.controls).toHaveLength(146)
  })

  it('gives every control, LED, and OLED a unique, DOM-safe ID', () => {
    const ids = [
      ...INVENTORY.controls.map((control) => control.id),
      ...INVENTORY.leds.map((led) => led.id),
      ...INVENTORY.oleds.map((oled) => oled.id),
    ]
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/)
  })

  it('builds the same inventory every time', () => {
    const again = buildInventory()
    expect(again.controls.map((control) => [control.id, control.x, control.y])).toEqual(
      INVENTORY.controls.map((control) => [control.id, control.x, control.y]),
    )
  })

  it('binds every indicator LED to a real button and a valid position', () => {
    for (const led of INVENTORY.leds) {
      if (led.binding.type !== 'step') continue
      const owner = INVENTORY.controlById.get(led.binding.control)
      expect(owner?.kind).toBe('button')
      if (owner?.kind !== 'button') continue
      expect(owner.section).toBe(led.section)
      for (const step of led.binding.on) expect(step).toBeLessThan(owner.steps)
    }
    // Every selector position has a printed name.
    for (const control of INVENTORY.controls) {
      if (control.kind === 'button' && control.steps > 0) expect(control.stepLabels).toHaveLength(control.steps)
    }
  })

  it('renders every control in its own section under its stable ID', () => {
    const app = mountApp()
    for (const control of INVENTORY.controls) {
      const element = app.control(control.id)
      expect(element).toHaveAttribute('data-control-id', control.id)
      expect(element).toHaveAttribute('data-kind', control.kind)
      expect(element.closest('section')?.getAttribute('data-section')).toBe(control.section)
    }
    for (const led of INVENTORY.leds) {
      expect(app.control(led.id).closest('section')?.getAttribute('data-section')).toBe(led.section)
    }
    expect(app.container.querySelectorAll('[data-control-id]')).toHaveLength(146)
  })
})

describe('visual.control-inventory: landmarks', () => {
  it('provides every required landmark from the visual spec, in the right section', () => {
    for (const id of ALL_SECTIONS) {
      const inventory = sectionInventory(id)
      expect(Object.keys(inventory.landmarks).sort()).toEqual([...SPEC_LANDMARKS[id].required].sort())
      const known = new Set([
        ...inventory.controls.map((control) => control.id),
        ...inventory.oleds.map((oled) => oled.id),
        ...inventory.labels.flatMap((label) => (label.id ? [label.id] : [])),
      ])
      for (const [landmark, ids] of Object.entries(inventory.landmarks)) {
        expect(ids.length, landmark).toBeGreaterThan(0)
        for (const hardwareId of ids) expect(known.has(hardwareId), `${landmark}: ${hardwareId}`).toBe(true)
      }
    }
  })

  it('has the hardware the landmark names promise', () => {
    expect(count('organ', (control) => control.kind === 'drawbar')).toBe(9)
    expect(count('organ', (control) => control.kind === 'fader')).toBe(2)
    expect(count('piano', (control) => control.kind === 'fader')).toBe(2)
    expect(count('synth', (control) => control.kind === 'fader')).toBe(3)
    expect(sectionInventory('program').landmarks['eight program buttons']).toHaveLength(8)
    expect(sectionInventory('program').landmarks['three morph assign buttons']).toHaveLength(3)
    expect(count('performance', (control) => control.kind === 'wheel')).toBe(1)
    expect(count('performance', (control) => control.kind === 'stick')).toBe(1)
    expect(INVENTORY.controlById.get('perf-master-level')?.kind).toBe('knob')
    expect(INVENTORY.controlById.get('program-dial')?.kind).toBe('encoder')
    expect(INVENTORY.controlById.get('piano-model')?.kind).toBe('encoder')
    // Piano type selector steps through the six types in the piano spec.
    const type = INVENTORY.controlById.get('piano-type')
    expect(type?.kind === 'button' && type.stepLabels).toEqual(['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'])
    // The logotype is rendered and names the instrument.
    const logo = sectionInventory('performance').labels.find((label) => label.id === 'brand-logo')
    expect(logo?.text.toLowerCase()).toBe('nord stage 4')
  })

  it('has reference-like density: sparse performance band, dense synth and effects', () => {
    const controls = Object.fromEntries(ALL_SECTIONS.map((id) => [id, sectionInventory(id).controls.length]))
    expect(controls).toEqual({ performance: 7, organ: 24, piano: 14, program: 28, synth: 40, effects: 33 })
    // Controls per unit of section width: the synth and effects bands are the densest.
    const density = (id: SectionId) => controls[id] / sectionGeometry(id).fraction
    expect(density('performance')).toBeLessThan(density('organ'))
    expect(density('synth')).toBeGreaterThan(density('organ'))
    expect(density('effects')).toBeGreaterThan(density('organ'))
    const knobs = (id: SectionId) => count(id, (control) => control.kind === 'knob')
    expect(knobs('synth')).toBe(10)
    expect(knobs('effects')).toBe(14)
    expect(knobs('organ')).toBe(0)
    expect(INVENTORY.leds.length).toBeGreaterThan(200)
  })

  it('keeps every piece of hardware inside its section and on the deck', () => {
    for (const section of SECTIONS) {
      const inventory = sectionInventory(section.id)
      for (const control of inventory.controls) {
        expect(control.x - control.w / 2, control.id).toBeGreaterThanOrEqual(0)
        expect(control.x + control.w / 2, control.id).toBeLessThanOrEqual(section.width)
        expect(control.y - control.h / 2, control.id).toBeGreaterThan(0)
        expect(control.y + control.h / 2, control.id).toBeLessThan(DECK_HEIGHT)
      }
      for (const led of inventory.leds) {
        expect(led.x, led.id).toBeGreaterThan(0)
        expect(led.x, led.id).toBeLessThan(section.width)
        expect(led.y, led.id).toBeLessThan(DECK_HEIGHT)
      }
      for (const plate of inventory.plates) {
        expect(plate.x).toBeGreaterThanOrEqual(0)
        expect(plate.x + plate.w).toBeLessThanOrEqual(section.width)
        expect(plate.y + plate.h).toBeLessThan(DECK_HEIGHT)
      }
    }
  })

  it('does not overlap one control with another', () => {
    for (const id of ALL_SECTIONS) {
      const controls = sectionInventory(id).controls
      for (let a = 0; a < controls.length; a += 1) {
        for (let b = a + 1; b < controls.length; b += 1) {
          const first = controls[a]
          const second = controls[b]
          const apartX = Math.abs(first.x - second.x) >= (first.w + second.w) / 2 - 1
          const apartY = Math.abs(first.y - second.y) >= (first.h + second.h) / 2 - 1
          expect(apartX || apartY, `${first.id} overlaps ${second.id}`).toBe(true)
        }
      }
    }
  })
})

describe('visual.control-inventory: OLEDs and forbidden hardware', () => {
  it('has exactly two OLEDs: one in Program, one in Synth', () => {
    expect(INVENTORY.oleds.map((oled) => [oled.section, oled.id])).toEqual([
      ['program', 'program-oled'],
      ['synth', 'synth-oled'],
    ])
    for (const id of ['performance', 'organ', 'piano', 'effects'] as const) {
      expect(sectionInventory(id).oleds).toHaveLength(0)
    }
  })

  it('keeps the Synth OLED narrow and the Program OLED the only one in its section', () => {
    const synth = sectionInventory('synth').oleds[0]
    expect(synth.w / sectionGeometry('synth').width).toBeLessThan(0.5)
    expect(synth.w / sectionGeometry('synth').width).toBeLessThan(0.3)
    const program = sectionInventory('program').oleds[0]
    expect(program.w / sectionGeometry('program').width).toBeLessThan(0.5)
  })

  it('renders nothing display-like outside those two windows', () => {
    const app = mountApp()
    // The spec's displayElement rule: accessible name, id, class, or data attribute
    // containing "oled", "display", or "screen".
    const pattern = /oled|display|screen/i
    const matches = [...app.container.querySelectorAll<HTMLElement>('section[data-section] *')].filter((element) => {
      const haystack = [
        element.id,
        element.getAttribute('class') ?? '',
        element.getAttribute('aria-label') ?? '',
        ...[...element.attributes].filter((attribute) => attribute.name.startsWith('data-')).flatMap((a) => [a.name, a.value]),
      ]
      return haystack.some((value) => pattern.test(value))
    })
    expect(matches.map((element) => element.id)).toEqual(['program-oled', 'synth-oled'])
    expect(matches.map((element) => element.closest('section')?.getAttribute('data-section'))).toEqual(['program', 'synth'])
    // No child of an OLED is as large as the OLED, so there is one display per window.
    for (const oled of matches) expect(oled.querySelector('.oled')).toBeNull()
  })

  it('performance band: exposed chassis, no full dark plate', () => {
    const section = sectionGeometry('performance')
    const dark = sectionInventory('performance').plates.filter((plate) => plate.style === 'dark')
    const darkArea = dark.reduce((sum, plate) => sum + plate.w * plate.h, 0)
    expect(darkArea / (section.width * DECK_HEIGHT)).toBeLessThan(0.8)
    expect(dark).toHaveLength(0)
  })

  it('organ: drawbars present, so it is not a generic equal-width grid', () => {
    const tall = sectionInventory('organ').controls.filter(isTall)
    expect(tall.filter((control) => control.kind === 'drawbar')).toHaveLength(9)
    // The nine drawbars share one row at an even pitch.
    const bars = sectionInventory('organ').controls.filter((control) => control.kind === 'drawbar')
    const pitches = bars.slice(1).map((bar, index) => bar.x - bars[index].x)
    for (const pitch of pitches) expect(pitch).toBeCloseTo(pitches[0], -1)
    expect(new Set(bars.map((bar) => bar.y)).size).toBe(1)
  })

  it('piano: no drawbar bank', () => {
    expect(sectionInventory('piano').controls.filter(isTall).length).toBeLessThan(6)
    expect(count('piano', (control) => control.kind === 'drawbar')).toBe(0)
  })

  it('synth: knobs are not a uniform repeated matrix', () => {
    const knobs = sectionInventory('synth').controls.filter((control) => control.kind === 'knob')
    const rows = new Set(knobs.map((knob) => Math.round(knob.y / 20)))
    const columns = new Set(knobs.map((knob) => Math.round(knob.x / 20)))
    // A regular grid of 10 knobs would need rows × columns = 10 with shared coordinates.
    expect(rows.size * columns.size).toBeGreaterThan(knobs.length * 2)
  })

  it('effects: two visibly separate effect groups, each in framed units', () => {
    const inventory = sectionInventory('effects')
    const frames = inventory.plates.filter((plate) => plate.style === 'frame')
    expect(frames).toHaveLength(6) // Mod 1, Mod 2, Amp Sim/EQ | Delay, Comp, Reverb
    // On the photo the two groups meet at x ≈ 9200.
    const divide = toSectionX('effects', 9200)
    const leftGroup = frames.filter((frame) => frame.x + frame.w / 2 < divide)
    const rightGroup = frames.filter((frame) => frame.x + frame.w / 2 >= divide)
    expect(leftGroup).toHaveLength(3)
    expect(rightGroup).toHaveLength(3)
    // The groups do not interleave: every left frame ends before every right frame begins.
    const leftEdge = Math.max(...leftGroup.map((frame) => frame.x + frame.w))
    const rightStart = Math.min(...rightGroup.map((frame) => frame.x))
    expect(leftEdge).toBeLessThanOrEqual(rightStart + 6)
  })
})
