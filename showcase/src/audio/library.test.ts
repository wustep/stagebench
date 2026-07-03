// @vitest-environment node
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { getSynthSampleSet, INSTRUMENTS, instrumentsOfType, nearestSynthZone, nearestZones, PIANO_TYPES, SYNTH_SAMPLE_SETS, velocityLayerGains } from './library'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * piano.instrument-library — the bundled recorded library is truthfully
 * declared: six distinct sources (one per selectable type), real files on
 * disk, complete root/velocity/license provenance, offline (no remote URLs
 * anywhere).
 */
describe('piano.instrument-library — bundled provenance', () => {
  it('provides all six selectable types with at least one bundled model each', () => {
    expect(PIANO_TYPES).toEqual(['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'])
    for (const type of PIANO_TYPES) {
      expect(instrumentsOfType(type).length, type).toBeGreaterThanOrEqual(1)
    }
  })

  it('declares distinct sources and redistributable licenses per instrument', () => {
    const sources = new Set(INSTRUMENTS.map((i) => i.source))
    expect(sources.size).toBe(6)
    for (const instrument of INSTRUMENTS) {
      expect(instrument.license.length).toBeGreaterThan(5)
      expect(instrument.source.length).toBeGreaterThan(20)
      expect(instrument.source).toMatch(/npm/i) // registry-only acquisition
    }
    expect(INSTRUMENTS.find((i) => i.id === 'grand-salamander')!.license).toMatch(/CC BY 3\.0/)
    for (const id of ['upright-tack', 'electric-tine', 'clav-gm', 'digital-fm', 'misc-vibraphone']) {
      expect(INSTRUMENTS.find((i) => i.id === id)!.license, id).toMatch(/MIT/)
    }
  })

  it('bundles every declared sample file on disk (offline capable, no remote URLs)', () => {
    for (const instrument of INSTRUMENTS) {
      for (const zone of instrument.zones) {
        expect(zone.file.startsWith('samples/'), zone.file).toBe(true)
        expect(zone.file).not.toMatch(/^https?:/)
        const path = join(ROOT, 'public', zone.file)
        expect(existsSync(path), path).toBe(true)
        expect(statSync(path).size).toBeGreaterThan(2000)
      }
    }
  })

  it('matches the generated public/samples/manifest.json (root notes and velocity layers)', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'public', 'samples', 'manifest.json'), 'utf8')) as {
      instruments: Array<{ id: string; velocityLayers: number; zones: Array<{ file: string; rootMidi: number; velocityLayer: number }> }>
    }
    for (const instrument of INSTRUMENTS) {
      const manifested = manifest.instruments.find((m) => m.id === instrument.id)!
      expect(manifested, instrument.id).toBeTruthy()
      expect(manifested.velocityLayers).toBe(instrument.velocityLayers)
      const declared = new Map(instrument.zones.map((z) => [z.file.replace(/^samples\/[^/]+\//, ''), z]))
      expect(manifested.zones).toHaveLength(instrument.zones.length)
      for (const zone of manifested.zones) {
        const match = declared.get(zone.file)!
        expect(match, zone.file).toBeTruthy()
        expect(match.rootMidi).toBe(zone.rootMidi)
        expect(match.velocityLayer).toBe(zone.velocityLayer)
      }
    }
  })

  it('has enough root notes to avoid obvious uniform pitch shifting', () => {
    const grand = INSTRUMENTS.find((i) => i.id === 'grand-salamander')!
    const grandRoots = new Set(grand.zones.map((z) => z.rootMidi))
    expect(grandRoots.size).toBe(30) // minor-third spacing A0..C8
    expect(grand.velocityLayers).toBe(3)
    expect(grand.zones).toHaveLength(90)
    for (const id of ['upright-tack', 'electric-tine', 'clav-gm', 'digital-fm', 'misc-vibraphone']) {
      const instrument = INSTRUMENTS.find((i) => i.id === id)!
      expect(new Set(instrument.zones.map((z) => z.rootMidi)).size, id).toBe(19) // major-third spacing
    }
    // Max shift distance from any keybed note (28..100) to a grand root <= 2 semitones.
    for (let midi = 28; midi <= 100; midi++) {
      const zone = nearestZones(grand, midi)[0]!
      expect(Math.abs(midi - zone.rootMidi), `midi ${midi}`).toBeLessThanOrEqual(2)
    }
  })

  it('crossfades recorded velocity layers and falls back to declared shaping for single-layer sets', () => {
    expect(velocityLayerGains(1, 0.3)).toEqual([1])
    const soft = velocityLayerGains(3, 0)
    const mid = velocityLayerGains(3, 0.5)
    const hard = velocityLayerGains(3, 1)
    expect(soft[0]).toBe(1)
    expect(soft[2]).toBe(0)
    expect(mid[1]).toBe(1)
    expect(hard[2]).toBe(1)
    expect(hard[0]).toBe(0)
    // Adjacent layers crossfade smoothly (weights sum to ~1).
    const between = velocityLayerGains(3, 0.25)
    expect(between[0]! + between[1]!).toBeCloseTo(1, 5)
  })
})

/**
 * synth.sample-sets — the Synth section's optional Samples mode bundles two
 * recorded sets (spec.scope.optional), following the exact same provenance
 * pattern as the Piano library's GM-derived sets above but kept as a
 * SEPARATE export (SYNTH_SAMPLE_SETS, not INSTRUMENTS) so this coverage
 * never touches PIANO_TYPES/instrumentsOfType filtering.
 */
describe('synth.sample-sets — bundled provenance (optional Samples mode)', () => {
  it('bundles exactly two sample sets with distinct sources and MIT licenses', () => {
    expect(SYNTH_SAMPLE_SETS).toHaveLength(2)
    const sources = new Set(SYNTH_SAMPLE_SETS.map((s) => s.source))
    expect(sources.size).toBe(2)
    for (const set of SYNTH_SAMPLE_SETS) {
      expect(set.license).toMatch(/MIT/)
      expect(set.source).toMatch(/npm/i) // registry-only acquisition
    }
    expect(getSynthSampleSet('synth-strings').name).toBe('Strings')
    expect(getSynthSampleSet('synth-choir').name).toBe('Choir')
    expect(() => getSynthSampleSet('nope')).toThrow(/Unknown synth sample set/)
  })

  it('bundles every declared sample file on disk (offline capable, no remote URLs)', () => {
    for (const set of SYNTH_SAMPLE_SETS) {
      for (const zone of set.zones) {
        expect(zone.file.startsWith('samples/'), zone.file).toBe(true)
        expect(zone.file).not.toMatch(/^https?:/)
        const path = join(ROOT, 'public', zone.file)
        expect(existsSync(path), path).toBe(true)
        expect(statSync(path).size).toBeGreaterThan(2000)
      }
    }
  })

  it('matches the generated public/samples/manifest.json (root notes, 19 roots x 1 layer each)', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'public', 'samples', 'manifest.json'), 'utf8')) as {
      instruments: Array<{ id: string; velocityLayers: number; zones: Array<{ file: string; rootMidi: number; velocityLayer: number }> }>
    }
    for (const set of SYNTH_SAMPLE_SETS) {
      const manifested = manifest.instruments.find((m) => m.id === set.id)!
      expect(manifested, set.id).toBeTruthy()
      expect(manifested.velocityLayers).toBe(1)
      expect(new Set(set.zones.map((z) => z.rootMidi)).size).toBe(19) // major-third spacing, same as the GM piano sets
      const declared = new Map(set.zones.map((z) => [z.file.replace(/^samples\/[^/]+\//, ''), z]))
      expect(manifested.zones).toHaveLength(set.zones.length)
      for (const zone of manifested.zones) {
        const match = declared.get(zone.file)!
        expect(match, zone.file).toBeTruthy()
        expect(match.rootMidi).toBe(zone.rootMidi)
      }
    }
  })

  it('nearestSynthZone picks the closest recorded root for a target note', () => {
    const strings = getSynthSampleSet('synth-strings')
    for (let midi = 24; midi <= 96; midi++) {
      const zone = nearestSynthZone(strings, midi)
      expect(Math.abs(midi - zone.rootMidi), `midi ${midi}`).toBeLessThanOrEqual(2)
    }
  })
})
