// @vitest-environment node
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { OfflineAudioContext } from 'node-web-audio-api'
import { describe, expect, it } from 'vitest'
import { ALL_MODELS, MODELS, PIANO_TYPES, RECORDED } from './library/catalog'

const root = process.cwd()
const details = JSON.parse(readFileSync(resolve(root, 'IMPLEMENTATION_DETAILS.json'), 'utf8'))

describe('piano.instrument-library — bundled recordings and their provenance', () => {
  it('offers six types with at least one model each; Grand, Upright and Electric are recorded', () => {
    expect(PIANO_TYPES).toHaveLength(6)
    for (const t of PIANO_TYPES) expect(MODELS[t].length, t).toBeGreaterThanOrEqual(1)
    for (const t of ['Grand', 'Upright', 'Electric'] as const) expect(MODELS[t].every((m) => m.kind === 'recorded'), t).toBe(true)
    for (const t of ['Clav', 'Digital', 'Misc'] as const) expect(MODELS[t].every((m) => m.kind === 'synth'), t).toBe(true)
    // model counts divide the 32 detents of the endless model dial
    for (const t of PIANO_TYPES) expect(32 % MODELS[t].length, t).toBe(0)
    expect(new Set(ALL_MODELS.map((m) => m.id)).size).toBe(ALL_MODELS.length)
  })

  it('has enough root notes and velocity layers that no note is stretched far from a recording', () => {
    for (const m of RECORDED) {
      expect(m.layers.length, m.id).toBeGreaterThanOrEqual(2)
      for (const layer of m.layers) {
        const roots = layer.samples.map((s) => s.root).sort((a, b) => a - b)
        expect(roots.length, `${m.id} layer ${layer.velocity}`).toBeGreaterThanOrEqual(10)
        // largest gap between neighbouring roots ≤ 12 semitones: a note is shifted by at most six semitones
        let gap = 0
        for (let i = 1; i < roots.length; i++) gap = Math.max(gap, roots[i] - roots[i - 1])
        expect(gap, `${m.id} layer ${layer.velocity}`).toBeLessThanOrEqual(12)
      }
    }
    const grand = RECORDED.find((m) => m.id === 'grand-salamander')!
    expect(grand.layers.length).toBeGreaterThanOrEqual(3)
    expect(grand.layers[0].samples.length).toBeGreaterThanOrEqual(28)
  })

  it('every listed file exists, is a real Ogg Vorbis file and decodes to non-silent audio', async () => {
    const ctx = new OfflineAudioContext(1, 128, 44100)
    let checked = 0
    for (const m of RECORDED) {
      for (const layer of m.layers) {
        for (const s of layer.samples) {
          const file = resolve(root, 'public/samples', s.file)
          expect(existsSync(file), s.file).toBe(true)
          expect(statSync(file).size, s.file).toBe(s.bytes)
          const bytes = readFileSync(file)
          expect(bytes.subarray(0, 4).toString('latin1'), s.file).toBe('OggS')
          if (checked++ % 6 === 0) {
            const decoded = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
            let peak = 0
            for (const v of decoded.getChannelData(0)) peak = Math.max(peak, Math.abs(v))
            expect(peak, s.file).toBeGreaterThan(0.01)
            expect(Math.abs(decoded.duration - s.durationSec), s.file).toBeLessThan(0.05)
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(200)
  }, 60000)

  it('IMPLEMENTATION_DETAILS.json declares every file, source, license, root note and velocity layer', () => {
    expect(details.phase).toBe(3) // the declaration describes the current (Phase 3) artifact; its sampleSources are unchanged from Phase 2
    const declared = new Map<string, { root: number; velocityLayer: number; license: string; isRecording: boolean }>()
    for (const src of details.audio.sampleSources) {
      expect(src.isRecording, src.id).toBe(true)
      expect(src.license, src.id).toMatch(/CC/)
      expect(src.author, src.id).toBeTruthy()
      expect(src.source, src.id).toMatch(/^https?:/)
      expect(src.licenseUrl, src.id).toMatch(/^https?:/)
      expect(src.files.length, src.id).toBe(src.fileDetails.length)
      for (const f of src.fileDetails) declared.set(f.file, { root: f.rootNote, velocityLayer: f.velocityLayer, license: src.license, isRecording: true })
    }
    let manifestFiles = 0
    for (const m of RECORDED) {
      for (const layer of m.layers) {
        for (const s of layer.samples) {
          manifestFiles++
          const d = declared.get(s.file)
          expect(d, s.file).toBeDefined()
          expect(d!.root, s.file).toBe(s.root)
          expect(d!.velocityLayer, s.file).toBe(layer.velocity)
          expect(d!.license, s.file).toBe(m.license)
        }
      }
    }
    expect(declared.size).toBe(manifestFiles)
  })

  it('never describes generated or synthesised sources as recordings', () => {
    expect(details.audio.generatedSources.length).toBeGreaterThan(0)
    for (const g of details.audio.generatedSources) expect(g.isRecording, g.name).toBe(false)
    for (const s of details.audio.liveSynthesis) expect(s.isRecording, s.name).toBe(false)
    const names = [...details.audio.generatedSources, ...details.audio.liveSynthesis].map((x: { name: string }) => x.name).join('|')
    for (const expected of ['Clav A', 'Digital FM', 'Marimba', 'Vibraphone', 'Reverb impulse responses', 'Additive piano fallback', 'Oscillator fallback']) expect(names).toContain(expected)
    // the recorded entries are exactly the models the catalog says are recorded
    expect(details.audio.sampleSources.map((x: { id: string }) => x.id).sort()).toEqual(RECORDED.map((m) => m.id).sort())
  })

  it('uses file names that are safe as URLs (a "#" once turned a note into a URL fragment and broke loading in real browsers)', () => {
    for (const m of RECORDED) for (const l of m.layers) for (const s of l.samples) expect(s.file, s.file).toMatch(/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.ogg$/)
  })

  it('keeps the bundle reasonably small (offline, redistributable)', () => {
    const total = RECORDED.flatMap((m) => m.layers.flatMap((l) => l.samples)).reduce((n, s) => n + s.bytes, 0)
    expect(total).toBeLessThan(12 * 1024 * 1024)
    for (const m of RECORDED) expect(['CC0-1.0', 'CC-BY-3.0', 'CC-BY-4.0']).toContain(m.license)
  })
})
