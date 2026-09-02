import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { act, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizedDifference, rms, spectralCentroid } from '../src/dsp/analysis'
import { PIANO_MODELS, PIANO_TYPES, defaultModelFor, getModel, modelsOfType, stepModel } from '../src/audio/pianoModels'
import { mono, renderPiano } from '../src/audio/offlinePiano'
import { SampleLibrary, layerForVelocity, nearestRoot, pickSample, validateManifest, type SampleManifest } from '../src/audio/sampleLibrary'
import { STAGE_4_73 } from '../src/hardware/keybed'
import { SAMPLES_DIR, diskAssets, el, mountApp, nearRoots, waitUntil, type Mounted } from './helpers'

const REQUIRED_RECORDED: Record<string, string> = { Grand: 'grand-salamander', Upright: 'upright-kw', Electric: 'electric-wurlitzer-200' }
const manifestOf = (setId: string): SampleManifest => validateManifest(JSON.parse(readFileSync(path.join(SAMPLES_DIR, setId, 'manifest.json'), 'utf8')), setId)

let mounted: Mounted | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
})

describe('piano.instrument-library — six types, three recorded sets, truthful provenance, offline', () => {
  it('registers six selectable types with at least one model each, Grand / Upright / Electric recorded', () => {
    expect(PIANO_TYPES).toEqual(['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'])
    for (const type of PIANO_TYPES) expect(modelsOfType(type).length).toBeGreaterThanOrEqual(1)
    for (const [type, setId] of Object.entries(REQUIRED_RECORDED)) {
      const model = defaultModelFor(type as (typeof PIANO_TYPES)[number])
      expect(model.kind).toBe('recorded')
      expect(model.setId).toBe(setId)
    }
    // generated models are labelled generated, never as recordings
    for (const m of PIANO_MODELS) {
      if (m.kind === 'generated') expect(m.source).toMatch(/generated|not a recording/i)
      if (m.kind === 'recorded') expect(m.setId).toBeTruthy()
    }
  })

  it('bundles every recorded model as an offline set with a complete, redistributable manifest', () => {
    const index = JSON.parse(readFileSync(path.join(SAMPLES_DIR, 'index.json'), 'utf8')) as { sets: { id: string; license: string }[] }
    for (const model of PIANO_MODELS.filter((m) => m.kind === 'recorded')) {
      const m = manifestOf(model.setId!)
      expect(m.kind).toBe('recorded')
      expect(m.type).toBe(model.type)
      expect(m.source.license).toMatch(/^(CC0-1\.0|CC-BY-3\.0|CC-BY-4\.0)$/)
      expect(m.source.name).toBeTruthy()
      expect(m.source.url).toMatch(/^https?:\/\//)
      expect(m.format).toBe('ogg-vorbis')
      expect(index.sets.some((s) => s.id === m.id && s.license === m.source.license)).toBe(true)
      // velocity layers cover 1..127 contiguously
      const layers = [...m.layers].sort((a, b) => a.lovel - b.lovel)
      expect(layers[0].lovel).toBe(1)
      expect(layers[layers.length - 1].hivel).toBe(127)
      for (let i = 1; i < layers.length; i++) expect(layers[i].lovel).toBe(layers[i - 1].hivel + 1)
      // every listed file is on disk, non-empty, with a root and a layer
      for (const f of m.files) {
        const p = path.join(SAMPLES_DIR, m.id, f.file)
        expect(existsSync(p), `${m.id}/${f.file} missing`).toBe(true)
        expect(statSync(p).size).toBeGreaterThan(1000)
        expect(f.root).toBeGreaterThanOrEqual(m.range.lowestRoot)
        expect(f.root).toBeLessThanOrEqual(m.range.highestRoot)
        expect(m.layers.some((l) => l.index === f.layer)).toBe(true)
      }
    }
    // the required recorded sets: enough root notes that no key is shifted more than a minor third,
    // and at least two velocity layers so dynamics are not one uniformly scaled sample
    for (const setId of Object.values(REQUIRED_RECORDED)) {
      const m = manifestOf(setId)
      expect(m.layers.length).toBeGreaterThanOrEqual(2)
      const roots = [...new Set(m.files.map((f) => f.root))].sort((a, b) => a - b)
      // inside the instrument's recorded compass every key is within a minor third of a recorded root
      // (the Wurlitzer's own keyboard is A1–C7; keys outside a set's compass are pitch-shifted further)
      const lo = Math.max(STAGE_4_73.lowestMidi, m.range.lowestRoot)
      const hi = Math.min(STAGE_4_73.highestMidi, m.range.highestRoot)
      expect(hi - lo).toBeGreaterThanOrEqual(48)
      for (let midi = lo; midi <= hi; midi++) {
        const root = nearestRoot(roots, midi)!
        expect(Math.abs(root - midi), `${setId}: note ${midi} would be shifted ${Math.abs(root - midi)} semitones`).toBeLessThanOrEqual(3)
      }
    }
    const licenses = readFileSync(path.join(SAMPLES_DIR, 'LICENSES.md'), 'utf8')
    for (const name of ['Salamander', 'Upright Piano KW', 'Greg Sullivan', 'VCSL']) expect(licenses).toContain(name)
  })

  it('decodes the real bundled files offline (no network) and the three recorded sets render audibly distinct pianos', async () => {
    const fetched: string[] = []
    const library = new SampleLibrary({ assets: diskAssets({ log: fetched }), filter: nearRoots([60], 2) })
    const sets = await Promise.all(Object.values(REQUIRED_RECORDED).map((id) => library.load(id)))
    for (const p of fetched) expect(p).toMatch(/^[a-z0-9-]+\/[^/]+$/) // relative paths inside the bundled library only
    const sr = 22050
    const renders = sets.map((set) => {
      const pick = pickSample(set, 60, 100)!
      expect(pick.sample.data.length).toBeGreaterThan(sr * 0.5)
      expect(rms(pick.sample.data)).toBeGreaterThan(0.005)
      expect(Math.abs(Math.log2(pick.playbackRate) * 12)).toBeLessThanOrEqual(3)
      const out = mono(renderPiano([{ time: 0, type: 'on', midi: 60, velocity: 100 }], { sampleRate: sr, seconds: 1, set }))
      expect(rms(out)).toBeGreaterThan(0.005)
      return out
    })
    const centroids = renders.map((x) => spectralCentroid(x, sr))
    for (let i = 0; i < renders.length; i++) {
      for (let j = i + 1; j < renders.length; j++) {
        expect(normalizedDifference(renders[i], renders[j])).toBeGreaterThan(0.3)
        expect(Math.abs(centroids[i] - centroids[j]) / Math.max(centroids[i], centroids[j])).toBeGreaterThan(0.02)
      }
    }
    // velocity layers are different recordings, not one sample scaled
    const grand = sets[0]
    const soft = pickSample(grand, 60, 20)!
    const hard = pickSample(grand, 60, 120)!
    expect(soft.sample.file.layer).not.toBe(hard.sample.file.layer)
    expect(layerForVelocity(grand.manifest.layers, 20)).toBe(soft.layer)
    expect(rms(hard.sample.data, 0, sr)).toBeGreaterThan(rms(soft.sample.data, 0, sr))
    library.dispose()
  })

  it('plays the recorded set through the engine: nearest root, correct playback rate, velocity layers', async () => {
    mounted = await mountApp({ samples: true })
    const { engine, bus, state } = mounted.services
    expect(state.get().piano.layers.A.modelId).toBe('grand-salamander')
    await waitUntil(() => engine.getStatus().layers.A.state === 'ready')
    expect(engine.getStatus().layers.A.source).toBe('recorded-samples')
    const set = mounted.services.library!.get('grand-salamander')!
    await act(async () => {
      await engine.start()
      mounted!.world.timers.flush()
    })
    bus.noteOn(62, 100, 'test')
    const voice = engine.activeVoices().find((v) => v.midi === 62)!
    expect(voice.source).toBe('recorded-samples')
    const source = mounted.world.ctx.sources().at(-1)!
    const expected = pickSample(set, 62, 100)!
    expect(source.playbackRate.value).toBeCloseTo(expected.playbackRate, 6)
    expect(source.buffer!.length).toBe(expected.sample.data.length)
    bus.noteOff(62, 'test')
    // a soft stroke uses a different (softer) velocity layer file
    bus.noteOn(60, 15, 'test')
    const softSource = mounted.world.ctx.sources().at(-1)!
    bus.noteOff(60, 'test')
    bus.noteOn(60, 125, 'test')
    const hardSource = mounted.world.ctx.sources().at(-1)!
    bus.noteOff(60, 'test')
    expect(softSource.buffer).not.toBe(hardSource.buffer)
    expect(engine.getStatus().state).toBe('ready')
    expect(document.getElementById('audio-status')?.dataset.state).toBe('ready')
    expect(document.getElementById('library-message')?.textContent).toMatch(/Salamander C5 \(recorded samples\) ready/)
  })

  it('selects every type from the panel, shows the model name in the Program display and steps models with the dial', async () => {
    mounted = await mountApp({ samples: true })
    const { state } = mounted.services
    const typeButton = el('piano.type')
    const seen: string[] = []
    for (let i = 0; i < PIANO_TYPES.length; i++) {
      const layer = state.get().piano.layers.A
      const model = getModel(layer.modelId)
      seen.push(model.type)
      expect(document.getElementById('program.oled')?.textContent).toContain(model.name)
      expect(Number(typeButton.dataset.value)).toBe(PIANO_TYPES.indexOf(model.type))
      fireEvent.click(typeButton)
    }
    expect(seen).toEqual([...PIANO_TYPES])
    expect(getModel(state.get().piano.layers.A.modelId).type).toBe('Grand') // cycled all the way round
    // the MODEL dial steps within the type (Electric has three recorded models)
    fireEvent.click(typeButton)
    fireEvent.click(typeButton)
    expect(getModel(state.get().piano.layers.A.modelId).id).toBe('electric-wurlitzer-200')
    const dial = el('piano.model')
    fireEvent.keyDown(dial, { key: 'ArrowUp' })
    expect(getModel(state.get().piano.layers.A.modelId).id).toBe(stepModel('electric-wurlitzer-200', 1).id)
    fireEvent.keyDown(dial, { key: 'ArrowDown' })
    expect(getModel(state.get().piano.layers.A.modelId).id).toBe('electric-wurlitzer-200')
    fireEvent.keyDown(dial, { key: 'ArrowDown' })
    expect(getModel(state.get().piano.layers.A.modelId).id).toBe(stepModel('electric-wurlitzer-200', -1).id)
    expect(modelsOfType('Electric').length).toBe(3)
  })
})
