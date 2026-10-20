// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PIANO_TYPES, timbreStep, pianoTypeAt, KB_TOUCH_CURVES, dynCompGain } from './pianoModels'
import { selectZone, zonePitchDistance, type ManifestZone, type SampleSetManifest } from './sampleLibrary'

const PUBLIC = resolve(process.cwd(), 'public')
const DETAILS = JSON.parse(readFileSync(resolve(process.cwd(), 'IMPLEMENTATION_DETAILS.json'), 'utf8'))

function manifest(id: string): SampleSetManifest {
  return JSON.parse(readFileSync(resolve(PUBLIC, 'samples', id, 'manifest.json'), 'utf8')) as SampleSetManifest
}

const RECORDED = ['grand', 'upright', 'electric'] as const

describe('piano.instrument-library: six types with one model each', () => {
  it('offers six types in panel order, three recorded and three synthesized', () => {
    expect(PIANO_TYPES.map((type) => type.label)).toEqual(['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'])
    expect(PIANO_TYPES.filter((type) => type.source === 'recorded').map((type) => type.sampleSet)).toEqual([...RECORDED])
    expect(PIANO_TYPES.filter((type) => type.source === 'synthesis')).toHaveLength(3)
    for (const type of PIANO_TYPES) expect(type.model.length).toBeGreaterThan(0)
  })

  it('maps the type selector and timbre knob onto valid positions', () => {
    expect(pianoTypeAt(5).id).toBe('misc')
    expect(pianoTypeAt(99).id).toBe('misc')
    const electric = PIANO_TYPES[2]
    expect(timbreStep(electric, 0)).toBe(0)
    expect(timbreStep(electric, 1)).toBe(5)
    expect(electric.timbre).toContain('Dyno 2')
  })
})

describe('piano.instrument-library: bundled recorded sets and their provenance', () => {
  it.each(RECORDED)('ships a bundled manifest for %s whose every file exists offline', (id) => {
    const set = manifest(id)
    expect(set.id).toBe(id)
    expect(set.zones.length).toBeGreaterThan(0)
    for (const zone of set.zones) {
      expect(existsSync(resolve(PUBLIC, 'samples', zone.file)), zone.file).toBe(true)
    }
  })

  it.each(RECORDED)('covers velocity 1..127 across %s, and gives most roots a loud layer', (id) => {
    const set = manifest(id)
    const covered = new Set<number>()
    for (const zone of set.zones) {
      for (let v = zone.lovel; v <= zone.hivel; v += 1) covered.add(v)
    }
    expect(covered.size).toBe(127)
    const roots = [...new Set(set.zones.map((zone) => zone.root))]
    const withLoudLayer = roots.filter((root) => set.zones.some((zone) => zone.root === root && zone.hivel === 127))
    // Some roots carry only one layer (declared in IMPLEMENTATION_DETAILS.json); loud strokes there use the nearest layer.
    expect(withLoudLayer.length / roots.length).toBeGreaterThanOrEqual(0.7)
  })

  it('keeps every keybed note within a declared pitch distance of its nearest root', () => {
    // Electric roots are every fourth or fifth white key (jRhodes3d), so the nearest root is at most about 3 semitones away.
    const limits: Record<(typeof RECORDED)[number], number> = { grand: 1.5, upright: 2, electric: 4 }
    for (const id of RECORDED) {
      const set = manifest(id)
      let worst = 0
      for (let note = 28; note <= 100; note += 1) {
        const distance = Math.min(...set.zones.map((zone) => Math.abs(zonePitchDistance(zone, note))))
        worst = Math.max(worst, distance)
      }
      expect(worst, id).toBeLessThanOrEqual(limits[id])
    }
  })

  it('declares every bundled set, its license, and its file list in IMPLEMENTATION_DETAILS.json', () => {
    const declared = DETAILS.audio.sampleSources as { id: string; license: string; files: string[] }[]
    for (const id of RECORDED) {
      const set = manifest(id)
      const entry = declared.find((source) => source.id === id)
      expect(entry, id).toBeDefined()
      expect(entry!.license).toBe(set.license)
      expect([...entry!.files].sort()).toEqual(set.zones.map((zone) => `public/samples/${zone.file}`).sort())
    }
  })

  it('stores license texts beside the sets that need them', () => {
    for (const file of ['licenses/salamander-grand-README.txt', 'licenses/upright-cc0.txt', 'licenses/jrhodes3d-LICENSE.txt']) {
      expect(existsSync(resolve(PUBLIC, 'samples', file)), file).toBe(true)
    }
  })
})

describe('zone selection', () => {
  const zones: ManifestZone[] = [
    { file: 'a', root: 48, cents: 0, lovel: 1, hivel: 60, loopStart: null, loopEnd: null },
    { file: 'b', root: 48, cents: 0, lovel: 61, hivel: 127, loopStart: null, loopEnd: null },
    { file: 'c', root: 60, cents: 0, lovel: 1, hivel: 127, loopStart: null, loopEnd: null },
  ]

  it('prefers the nearest root, then the velocity layer that contains the stroke', () => {
    expect(selectZone(zones, 60, 100)?.file).toBe('c')
    expect(selectZone(zones, 49, 100)?.file).toBe('b')
    expect(selectZone(zones, 49, 20)?.file).toBe('a')
  })

  it('applies the pitch correction when measuring distance to a root', () => {
    expect(zonePitchDistance({ ...zones[0], cents: 50 }, 48)).toBeCloseTo(-0.5, 10)
  })
})

describe('touch and dynamics curves', () => {
  it('Heavy plays softer than Medium, and Light plays louder, for the same stroke', () => {
    const v = 0.5
    expect(KB_TOUCH_CURVES[0](v)).toBeLessThan(KB_TOUCH_CURVES[1](v))
    expect(KB_TOUCH_CURVES[2](v)).toBeGreaterThan(KB_TOUCH_CURVES[1](v))
  })

  it('Dyn Comp lifts the floor of soft strokes and leaves loud strokes alone', () => {
    expect(dynCompGain(0.1, 0)).toBeCloseTo(0.1, 10)
    expect(dynCompGain(0.1, 3)).toBeGreaterThan(dynCompGain(0.1, 1))
    expect(dynCompGain(1, 3)).toBeCloseTo(1, 10)
  })
})
