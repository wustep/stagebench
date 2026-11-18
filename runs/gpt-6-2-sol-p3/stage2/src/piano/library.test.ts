// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { OfflineAudioContext } from 'node-web-audio-api'
import { describe, expect, it, vi } from 'vitest'
import details from '../../IMPLEMENTATION_DETAILS.json'
import electricAssets from './electric-bank.json'
import grandAssets from './grand-bank.json'
import uprightAssets from './upright-bank.json'
import { NoteLifecycle, uiPedalChannel } from './notes'
import { initialSettings, isRecorded, pianoTypes } from './settings'
import type { PianoType, Settings } from './settings'
import { PianoAudio, PianoRack } from './sound'
import type { PianoSample } from './sound'

const sampleRate = 32000
const manifests = { Grand: grandAssets, Upright: uprightAssets, Electric: electricAssets }
const contextFor = (seconds: number) => new OfflineAudioContext(2, Math.round(seconds * sampleRate), sampleRate)
const asWebAudio = (context: OfflineAudioContext) => context as unknown as BaseAudioContext

function energy(signal: Float32Array, from = 0.065, to = 0.18) {
  const samples = signal.subarray(Math.round(from * sampleRate), Math.round(to * sampleRate))
  return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length)
}

function difference(a: Float32Array, b: Float32Array) {
  return energy(a.map((sample, i) => sample - b[i]))
}

function spectral(signal: Float32Array, hz: number, from = 0.08, to = 0.2) {
  const start = Math.round(from * sampleRate)
  const end = Math.round(to * sampleRate)
  let cos = 0
  let sin = 0
  for (let i = start; i < end; i++) {
    const angle = 2 * Math.PI * hz * i / sampleRate
    const sample = signal[i] * Math.sin(Math.PI * (i - start) / (end - start)) ** 2
    cos += sample * Math.cos(angle)
    sin += sample * Math.sin(angle)
  }
  return Math.hypot(cos, sin)
}

async function samplesFor(context: OfflineAudioContext, type: keyof typeof manifests, note: number) {
  const manifest = manifests[type]
  const nearest = new Map<string, number>()
  for (const { root, layer } of manifest) {
    nearest.set(layer, Math.min(nearest.get(layer) ?? Infinity, Math.abs(root - note)))
  }
  return Promise.all(manifest.filter(({ root, layer }) => Math.abs(root - note) === nearest.get(layer))
    .map(async (asset): Promise<PianoSample> => {
      const url = new URL(`../../public/samples/${type.toLowerCase()}/${asset.file}`, import.meta.url)
      const bytes = Uint8Array.from(await readFile(url)).buffer
      const buffer = await context.decodeAudioData(bytes)
      return { ...asset, buffer: buffer as unknown as AudioBuffer }
    }))
}

async function audition(type: PianoType, options: {
  velocity?: number
  notes?: number[]
  edit?: (settings: Settings) => void
  pedal?: boolean
  useRecording?: boolean
} = {}) {
  const context = contextFor(1)
  const settings = initialSettings()
  settings.layers.A.type = type
  options.edit?.(settings)
  let now = 0.018
  const rack = new PianoRack(asWebAudio(context), () => now)
  const notes = options.notes ?? [69]
  if (isRecorded(type) && options.useRecording !== false) {
    const bank = (await Promise.all(notes.map((note) => samplesFor(context, type, note)))).flat()
    rack.setBank(bank, type)
  }
  rack.configure(settings)
  const life = new NoteLifecycle(rack, () => {})
  if (options.pedal) life.sustain(uiPedalChannel, true)
  for (const note of notes) life.press(String(note), note, options.velocity ?? 95)
  now = 0.24
  for (const note of notes) life.release(String(note))
  now = 0.67
  life.sustain(uiPedalChannel, false)
  const buffer = await context.startRendering()
  life.allNotesOff()
  rack.dispose()
  return [Float32Array.from(buffer.getChannelData(0)), Float32Array.from(buffer.getChannelData(1))] as const
}

describe('rendered instrument library', () => {
  it('plays six distinct tuned sounds and verifies the three recorded manifests', async () => {
    const rendered = await Promise.all(pianoTypes.map(async (type) => {
      const [signal] = await audition(type)
      expect(energy(signal), type).toBeGreaterThan(0.006)
      expect(spectral(signal, 440), type).toBeGreaterThan(spectral(signal, 420) * 2)
      return signal
    }))
    for (let i = 0; i < rendered.length; i++) {
      for (let j = 0; j < i; j++) {
        expect(difference(rendered[i], rendered[j]), `${pianoTypes[i]} versus ${pianoTypes[j]}`)
          .toBeGreaterThan(0.005)
      }
    }
    for (const [type, manifest] of Object.entries(manifests)) {
      const roots = [...new Set(manifest.map(({ root }) => root))].sort((a, b) => a - b)
      expect(roots.length).toBeGreaterThanOrEqual(15)
      expect(Math.max(...roots.slice(1).map((root, i) => root - roots[i]))).toBeLessThanOrEqual(6)
      for (const asset of manifest) {
        const path = `public/samples/${type.toLowerCase()}/${asset.file}`
        expect(details.audio.files.find((entry) => entry.path === path)).toMatchObject({
          origin: 'pack', rootNote: asset.root, velocityLayer: asset.layer,
        })
      }
    }
    expect(details.audio.sampleSources.map(({ license }) => license).sort()).toEqual(['CC-BY-3.0', 'CC0-1.0', 'CC0-1.0'])
    expect(new Set(grandAssets.map(({ layer }) => layer)).size).toBe(5)
    expect(new Set(uprightAssets.map(({ layer }) => layer)).size).toBe(2)
    expect(electricAssets.every(({ loop }) => loop[1] > loop[0])).toBe(true)
  })

  it('renders strike curves in order and raises soft strokes with dynamic compression', async () => {
    const [heavy, medium, light, compressed, firm, firmCompressed] = await Promise.all([
      audition('Electric', { velocity: 38, edit: (s) => { s.layers.A.touch = 'Heavy' } }),
      audition('Electric', { velocity: 38 }),
      audition('Electric', { velocity: 38, edit: (s) => { s.layers.A.touch = 'Light' } }),
      audition('Electric', { velocity: 38, edit: (s) => { s.layers.A.dynamics = 3 } }),
      audition('Electric', { velocity: 123 }),
      audition('Electric', { velocity: 123, edit: (s) => { s.layers.A.dynamics = 3 } }),
    ])
    expect(energy(heavy[0])).toBeLessThan(energy(medium[0]) * 0.8)
    expect(energy(light[0])).toBeGreaterThan(energy(medium[0]) * 1.35)
    expect(energy(compressed[0])).toBeGreaterThan(energy(medium[0]) * 1.5)
    expect(energy(firm[0])).toBeGreaterThan(energy(medium[0]) * 2)
    expect(energy(firmCompressed[0])).toBeLessThan(energy(firm[0]) * 1.12)
  })

  it('keeps default note level increasing across the MIDI velocity range', async () => {
    const levels = []
    for (const velocity of [16, 32, 48, 64, 80, 96, 112, 127]) {
      const [signal] = await audition('Upright', { notes: [60], velocity })
      levels.push(energy(signal))
    }
    expect(levels[0]).toBeGreaterThan(0.0005)
    expect(levels.at(-1)!).toBeGreaterThan(levels[0] * 6)
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThan(levels[i - 1] * 1.04)
  })

  it('renders different timbres, electric Dyno colors, and wide detuned unison', async () => {
    const [dry, soft, mid, bright, detuned, electric, dyno1, dyno2] = await Promise.all([
      audition('Grand'),
      audition('Grand', { edit: (s) => { s.layers.A.timbre = 'Soft' } }),
      audition('Grand', { edit: (s) => { s.layers.A.timbre = 'Mid' } }),
      audition('Grand', { edit: (s) => { s.layers.A.timbre = 'Bright' } }),
      audition('Grand', { edit: (s) => { s.layers.A.unison = 3 } }),
      audition('Electric'),
      audition('Electric', { edit: (s) => { s.layers.A.timbre = 'Dyno 1' } }),
      audition('Electric', { edit: (s) => { s.layers.A.timbre = 'Dyno 2' } }),
    ])
    expect(spectral(soft[0], 2640)).toBeLessThan(spectral(dry[0], 2640) * 0.8)
    expect(spectral(bright[0], 2640)).toBeGreaterThan(spectral(dry[0], 2640) * 1.3)
    expect(difference(mid[0], dry[0])).toBeGreaterThan(0.003)
    expect(difference(detuned[0], dry[0])).toBeGreaterThan(0.004)
    expect(difference(detuned[0], detuned[1])).toBeGreaterThan(0.003)
    expect(difference(dyno1[0], electric[0])).toBeGreaterThan(0.001)
    expect(difference(dyno2[0], electric[0])).toBeGreaterThan(0.001)
    expect(difference(dyno2[0], dyno1[0])).toBeGreaterThan(0.001)
  })

  it('renders soft release, sympathetic modes, and master gain through the final limiter', async () => {
    const [plain, soft, clav, clavSoft, muted, loud, resonant, damped] = await Promise.all([
      audition('Upright'),
      audition('Upright', { edit: (s) => { s.layers.A.softRelease = true } }),
      audition('Clav'),
      audition('Clav', { edit: (s) => { s.layers.A.softRelease = true } }),
      audition('Upright', { edit: (s) => { s.master = 0 } }),
      audition('Upright', { edit: (s) => { s.master = 6 } }),
      audition('Grand', { pedal: true, notes: [69, 76] }),
      audition('Grand', { pedal: true, notes: [69, 76], edit: (s) => { s.layers.A.resonance = false } }),
    ])
    expect(energy(soft[0], 0.415, 0.49)).toBeGreaterThan(0.00005)
    expect(energy(plain[0], 0.415, 0.51)).toBeLessThan(0.000001)
    expect(energy(clavSoft[0], 0.27, 0.31)).toBeCloseTo(energy(clav[0], 0.27, 0.31), 6)
    expect(energy(muted[0], 0.145, 0.21)).toBeLessThan(0.000001)
    expect(energy(loud[0])).toBeGreaterThan(energy(plain[0]) * 1.6)
    expect(loud[0].reduce((peak, n) => Math.max(peak, Math.abs(n)), 0)).toBeLessThan(0.97)
    expect(difference(resonant[0], damped[0])).toBeGreaterThan(0.003)
  })

  it('holds only the routed layer, releases on pedal up, and bends only PSTICK layers', async () => {
    const context = contextFor(1.3)
    let now = 0.016
    const rack = new PianoRack(asWebAudio(context), () => now)
    const settings = initialSettings()
    Object.assign(settings.layers.A, { type: 'Misc', sustain: false, pitch: true })
    Object.assign(settings.layers.B, { type: 'Digital', sustain: true, on: true, octave: -1, level: 12 })
    settings.pitch = 10
    rack.configure(settings)
    const keys = vi.fn()
    const life = new NoteLifecycle(rack, keys)
    life.sustain(uiPedalChannel, true)
    life.press('midi', 69, 105, 'midi:1')
    now = 0.22
    life.release('midi')
    expect(keys).toHaveBeenLastCalledWith({ held: new Set(), sustained: new Set([69]) })
    now = 0.68
    life.sustain(uiPedalChannel, false)
    expect(keys).toHaveBeenLastCalledWith({ held: new Set(), sustained: new Set() })
    const rendered = await context.startRendering()
    const signal = rendered.getChannelData(0)
    expect(spectral(signal, 493.88)).toBeGreaterThan(spectral(signal, 440) * 3)
    expect(spectral(signal, 220, 0.45, 0.62)).toBeGreaterThan(spectral(signal, 493.88, 0.45, 0.62) * 10)
    expect(energy(signal, 0.48, 0.6)).toBeGreaterThan(0.002)
    expect(energy(signal, 0.91, 1.2)).toBeLessThan(0.000001)
    life.allNotesOff()
    rack.dispose()
  })

  it('ends a disabled layer without migrating its note or ending the other layer', async () => {
    const context = contextFor(1.1)
    let now = 0.018
    const rack = new PianoRack(asWebAudio(context), () => now)
    const state = initialSettings()
    Object.assign(state.layers.A, { type: 'Misc' })
    Object.assign(state.layers.B, { on: true, type: 'Digital', octave: -1, level: 12 })
    rack.configure(state)
    const ended = vi.fn()
    const voice = rack.play(69, 110, ended)
    const disable = context.suspend(0.30)
    const release = context.suspend(0.58)
    const rendering = context.startRendering()
    await disable
    now = context.currentTime
    rack.configure({ ...state, focus: 'A', layers: { ...state.layers, B: { ...state.layers.B, on: false } } })
    await context.resume()
    await release
    now = context.currentTime
    voice?.release()
    await context.resume()
    const buffer = await rendering
    const signal = buffer.getChannelData(0)
    expect(spectral(signal, 220, 0.12, 0.24)).toBeGreaterThan(0.5)
    expect(spectral(signal, 220, 0.38, 0.52)).toBeLessThan(0.005)
    expect(spectral(signal, 440, 0.38, 0.52)).toBeGreaterThan(0.5)
    await vi.waitFor(() => expect(ended).toHaveBeenCalledOnce())
    rack.stopAll()
    rack.dispose()
    expect(ended).toHaveBeenCalledOnce()
  })

  it('reports a failed bank as fallback and renders a playable replacement', async () => {
    const status = vi.fn()
    const createContext = vi.fn()
    const loadBank = vi.fn(async () => { throw new Error('Unavailable sample') })
    const engine = new PianoAudio(status, { createContext, loadBank })
    engine.prepare()
    await vi.waitFor(() => expect(status).toHaveBeenLastCalledWith('fallback'))
    expect(status).not.toHaveBeenCalledWith('ready')
    expect(createContext).not.toHaveBeenCalled()
    expect(loadBank).toHaveBeenCalledWith(expect.any(AbortSignal), 'Upright')
    const [fallback] = await audition('Upright', { useRecording: false })
    expect(energy(fallback)).toBeGreaterThan(0.008)
    engine.dispose()
  })
})
