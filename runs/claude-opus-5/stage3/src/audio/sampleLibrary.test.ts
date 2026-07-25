import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { peak, relativeDifference, rms } from './offline'
import { PIANO_TYPES } from './pianoTypes'
import { SAMPLE_MANIFEST, SAMPLE_SET_IDS, pickSample, sampleSetSpec, type SampleSetId } from './sampleLibrary'
import type { PianoTypeId } from './settings'
import { decodeWav } from './wav'
import { diskSampleFetcher, loadedRig, renderNote, settingsWith } from '../test/engineRig'
import { VARIANT } from '../model/variant'

/**
 * Feature: piano.instrument-library
 *
 * These tests run against the files that actually ship in `public/samples/`, read through the
 * same loader boundary the browser uses. Nothing is mocked: the recordings are decoded, played
 * through the engine, and compared as rendered signals.
 */
describe('bundled recorded sample sets', () => {
  it('declares three recorded sets with complete, redistributable provenance', () => {
    expect(SAMPLE_MANIFEST.sets).toHaveLength(3)
    for (const id of SAMPLE_SET_IDS) {
      const spec = sampleSetSpec(id)
      expect(spec.recorded).toBe(true)
      expect(spec.license.length).toBeGreaterThan(0)
      expect(spec.licenseUrl).toMatch(/^https?:\/\//)
      expect(spec.attribution.length).toBeGreaterThan(20)
      expect(spec.source.length).toBeGreaterThan(10)
      expect(spec.files.length).toBeGreaterThan(10)
      for (const file of spec.files) {
        expect(file.sourceSample.length).toBeGreaterThan(0)
        expect(file.root).toBeGreaterThan(0)
        expect(file.seconds).toBeGreaterThan(0.5)
      }
    }
  })

  it('ships every declared file inside the build, so the sets work offline', () => {
    for (const id of SAMPLE_SET_IDS) {
      for (const file of sampleSetSpec(id).files) {
        const path = resolve(process.cwd(), 'public', 'samples', id, file.file)
        expect(existsSync(path), `${id}/${file.file}`).toBe(true)
        expect(statSync(path).size).toBeGreaterThan(2000)
      }
    }
  })

  it('covers the whole keybed with enough roots that no note is stretched far', () => {
    for (const id of SAMPLE_SET_IDS) {
      const spec = sampleSetSpec(id)
      const roots = [...new Set(spec.files.map((file) => file.root))].sort((a, b) => a - b)
      expect(roots.length).toBeGreaterThanOrEqual(12)
      // No note on the 73-key bed is more than a few semitones from a recorded root.
      for (let midi = VARIANT.lowestMidi; midi <= VARIANT.highestMidi; midi += 1) {
        const nearest = roots.reduce((best, root) =>
          Math.abs(root - midi) < Math.abs(best - midi) ? root : best,
        )
        expect(Math.abs(nearest - midi), `${id} at midi ${midi}`).toBeLessThanOrEqual(4)
      }
    }
  })

  it('decodes a shipped file into real, non-silent 24 kHz audio', async () => {
    const spec = sampleSetSpec('grand')
    const file = spec.files[Math.floor(spec.files.length / 2)]
    const decoded = decodeWav(await diskSampleFetcher(`samples/grand/${file.file}`))
    expect(decoded.sampleRate).toBe(SAMPLE_MANIFEST.sampleRate)
    expect(decoded.channels).toHaveLength(1)
    expect(decoded.channels[0].length).toBeGreaterThan(decoded.sampleRate * 0.5)
    expect(peak(decoded.channels[0])).toBeGreaterThan(0.1)
  })

  it('picks the nearest recorded root and the velocity layer that covers the stroke', async () => {
    const rig = await loadedRig()
    const set = rig.library!.get('grand')!
    const soft = pickSample(set, 60, 0.2)!
    const hard = pickSample(set, 60, 0.95)!
    expect(Math.abs(soft.shiftSemitones)).toBeLessThanOrEqual(3)
    expect(soft.sample.velocityHigh).toBeLessThan(hard.sample.velocityHigh)
    expect(hard.playbackRate).toBeCloseTo(Math.pow(2, hard.shiftSemitones / 12), 6)
  })

  it('plays the recordings rather than the fallback once they are loaded', async () => {
    const rig = await loadedRig()
    expect(rig.engine.sampleReport().sets.grand).toBe('ready')
    expect(rig.engine.sampleReport().fallbackActive).toBe(false)
    expect(rig.engine.layer('a').playsRecordedSamples).toBe(true)
    expect(peak(renderNote(rig, { midi: 60, seconds: 0.8 }))).toBeGreaterThan(0.05)
  })

  it('renders Grand, Upright and Electric as audibly different instruments', async () => {
    const rendered = new Map<PianoTypeId, Float32Array>()
    for (const type of ['grand', 'upright', 'electric'] as const) {
      const rig = await loadedRig({ settings: settingsWith({ layers: { a: { type } } }) })
      const audio = renderNote(rig, { midi: 55, velocity: 0.85, seconds: 1.2 })
      expect(rms(audio), type).toBeGreaterThan(0.005)
      rendered.set(type, audio)
    }
    const pairs: [PianoTypeId, PianoTypeId][] = [
      ['grand', 'upright'],
      ['grand', 'electric'],
      ['upright', 'electric'],
    ]
    for (const [left, right] of pairs) {
      expect(relativeDifference(rendered.get(left)!, rendered.get(right)!), `${left} vs ${right}`).toBeGreaterThan(
        0.5,
      )
    }
  })

  it('gives all six types a playable model and none of them render identically', async () => {
    const rendered: { id: PianoTypeId; audio: Float32Array }[] = []
    for (const type of PIANO_TYPES) {
      const rig = await loadedRig({ settings: settingsWith({ layers: { a: { type: type.id } } }) })
      const audio = renderNote(rig, { midi: 57, velocity: 0.8, seconds: 1 })
      expect(rms(audio), type.id).toBeGreaterThan(0.002)
      rendered.push({ id: type.id, audio })
    }
    for (let i = 0; i < rendered.length; i += 1) {
      for (let j = i + 1; j < rendered.length; j += 1) {
        expect(
          relativeDifference(rendered[i].audio, rendered[j].audio),
          `${rendered[i].id} vs ${rendered[j].id}`,
        ).toBeGreaterThan(0.25)
      }
    }
  })

  it('voices a second model of a recorded type differently from the first', async () => {
    const first = await loadedRig({ settings: settingsWith({ layers: { a: { type: 'grand', model: 0 } } }) })
    const second = await loadedRig({ settings: settingsWith({ layers: { a: { type: 'grand', model: 1 } } }) })
    const a = renderNote(first, { midi: 60, seconds: 1 })
    const b = renderNote(second, { midi: 60, seconds: 1 })
    expect(relativeDifference(a, b)).toBeGreaterThan(0.05)
  })

  it('never claims a set is ready before it has loaded', async () => {
    const rig = await loadedRig()
    const report = rig.engine.sampleReport()
    const unloaded: SampleSetId[] = ['upright', 'electric']
    for (const id of unloaded) expect(report.sets[id]).not.toBe('ready')
    expect(report.sets.grand).toBe('ready')
  })
})
