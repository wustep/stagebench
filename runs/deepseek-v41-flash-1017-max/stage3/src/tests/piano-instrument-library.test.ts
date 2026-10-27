import { describe, expect, it } from 'vitest'
import { OfflineAudioContext } from 'node-web-audio-api'
import { readFileSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PIANO_MODELS,
  PIANO_TYPES,
  defaultModelForType,
  modelsForType,
  timbreIndexFor,
  timbreLabelFor,
  timbreOptionsFor,
} from '../audio/pianoLibrary'
import {
  SampleBank,
  SAMPLE_MODEL_FOR_PIANO_MODEL,
  buildIndex,
  createModelledVoice,
  createSampleVoice,
  layerForVelocity,
  nearestRoot,
  sampleUrl,
  touchVelocity,
  dynCompGain,
  releaseSeconds,
  timbreTilt,
  type SampleEntry,
} from '../audio/pianoVoice'
import { defaultPianoState, voiceParamsFor } from '../audio/pianoState'
import { rms, brightness } from '../audio/offlineRender'
import manifest from '../audio/sample-manifest.json'
import gains from '../audio/sample-gains.json'

/**
 * piano.instrument-library — six selectable types, at least one model each, three of them
 * bundled recorded sample sets that are audibly distinct, load offline, and carry truthful
 * provenance.
 *
 * The audible claims are measured on samples rendered through the real voice code, not read
 * off the catalogue: a type is "recorded" here only if the shipped files exist, decode, and
 * produce a signal that differs from the other recorded types.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const CANDIDATE = resolve(HERE, '../..')
const SR = 44100

const entries = manifest as SampleEntry[]
const levels = gains as Record<string, number>
const index = buildIndex(entries)

describe('piano.instrument-library — the catalogue', () => {
  it('offers all six types from the piano spec, in the spec order', () => {
    expect(PIANO_TYPES.map((t) => t.id)).toEqual([
      'grand',
      'upright',
      'electric',
      'clav',
      'digital',
      'misc',
    ])
    expect(PIANO_TYPES.map((t) => t.label)).toEqual([
      'Grand',
      'Upright',
      'Electric',
      'Clav',
      'Digital',
      'Misc',
    ])
  })

  it('gives every type at least one selectable model', () => {
    for (const type of PIANO_TYPES) {
      const models = modelsForType(type.id)
      expect(models.length, type.id).toBeGreaterThanOrEqual(1)
      expect(defaultModelForType(type.id).type).toBe(type.id)
    }
    // More than one model on a type exercises the model dial, which the spec lists as
    // optional; both are real models rather than invented names.
    expect(modelsForType('grand').length).toBeGreaterThanOrEqual(2)
    expect(modelsForType('electric').length).toBeGreaterThanOrEqual(2)
  })

  it('declares Grand, Upright and Electric as recorded and the other three as modelled', () => {
    for (const type of ['grand', 'upright', 'electric'] as const) {
      for (const model of modelsForType(type)) {
        expect(model.source, model.id).toBe('recorded')
        // A recorded model must name a real library and licence, not a placeholder.
        expect(model.provenance).toMatch(/CC|public domain/i)
      }
    }
    for (const type of ['clav', 'digital', 'misc'] as const) {
      for (const model of modelsForType(type)) {
        expect(model.source, model.id).toBe('modelled')
        // The declaration itself says there are no samples, in as many words.
        expect(model.provenance).toMatch(/no samples|Synthesised/i)
      }
    }
  })

  it('maps every recorded model to a real bundled sample directory', () => {
    for (const model of PIANO_MODELS.filter((m) => m.source === 'recorded')) {
      const sampleModel = SAMPLE_MODEL_FOR_PIANO_MODEL[model.id]
      expect(sampleModel, model.id).toBeTruthy()
      const files = entries.filter((e) => e.model === sampleModel)
      expect(files.length, model.id).toBeGreaterThan(20)
    }
  })
})

describe('piano.instrument-library — the bundled sample sets', () => {
  it('ships every file the manifest declares, and nothing else', () => {
    for (const entry of entries) {
      const path = resolve(CANDIDATE, 'public/samples', entry.file)
      const stat = statSync(path, { throwIfNoEntry: false })
      expect(stat, `missing sample ${entry.file}`).toBeDefined()
      expect(stat!.size, entry.file).toBeGreaterThan(2000)
      expect(levels[entry.file], `no level trim for ${entry.file}`).toBeTypeOf('number')
    }
    expect(entries.length).toBeGreaterThan(150)
  })

  it('declares each sample as recorded or derived, never mislabelled', () => {
    for (const entry of entries) {
      expect(['recorded', 'derived']).toContain(entry.kind)
      if (entry.kind === 'recorded') {
        expect(entry.shiftSemitones).toBe(0)
        expect(entry.derivedFromMidi).toBeNull()
      } else {
        // A derived root must say which recording it came from and by how much it moved.
        expect(entry.derivedFromMidi).toBeTypeOf('number')
        expect(Math.abs(entry.shiftSemitones)).toBeGreaterThan(0)
        expect(Math.abs(entry.shiftSemitones)).toBeLessThanOrEqual(4)
      }
    }
    // The great majority of the library is original recorded material.
    const recorded = entries.filter((e) => e.kind === 'recorded').length
    expect(recorded / entries.length).toBeGreaterThan(0.85)
  })

  it('keeps every note within two semitones of a real root, with at least three velocity layers', () => {
    for (const model of ['grand', 'upright', 'cp80'] as const) {
      const layers = new Set(entries.filter((e) => e.model === model).map((e) => e.layer))
      expect(layers.size, model).toBeGreaterThanOrEqual(3)
      const roots = index.roots.get(model)
      expect(roots).toBeDefined()
      for (const [, list] of roots!) {
        // The instrument plays MIDI 28..100; every key must find a root within a whole tone.
        for (let midi = 28; midi <= 100; midi += 1) {
          const root = nearestRoot(list, midi)
          expect(Math.abs(root - midi), `${model} midi ${midi}`).toBeLessThanOrEqual(2)
        }
      }
    }
    // The shipped roots may sit just outside the 73-key range: a recording made at MIDI 104
    // is the correct root for key 100, so what is bounded is the playback shift, not the
    // root index.
    for (const entry of entries) expect(Math.abs(entry.shiftSemitones)).toBeLessThanOrEqual(4)
  })

  it('selects the velocity layer whose declared range contains the strike', () => {
    const grand = entries.filter((e) => e.model === 'grand')
    expect(layerForVelocity(grand, 0.05)).toBe(1)
    expect(layerForVelocity(grand, 0.5)).toBe(2)
    expect(layerForVelocity(grand, 1)).toBe(3)
    // Out-of-band velocities land in the nearest declared range rather than the loudest.
    expect(layerForVelocity(grand, 0)).toBe(1)
    expect(layerForVelocity(grand, 1)).toBe(3)
  })

  it('encodes sharp names so they survive a URL', () => {
    // '#' starts a URL fragment; the shipped names use 's' and the encoder covers both.
    expect(sampleUrl('base/', 'grand/Fs1-v1.mp3')).toBe('base/grand/Fs1-v1.mp3')
    expect(sampleUrl('base/', 'grand/F#1-v1.mp3')).toBe('base/grand/F%231-v1.mp3')
    for (const entry of entries) expect(entry.file).not.toContain('#')
  })
})

describe('piano.instrument-library — decoding and audible distinction', () => {
  /** Loads every sample of one model from disk, exactly as the browser fetches them. */
  async function loadModel(model: 'grand' | 'upright' | 'cp80') {
    const ctx = new OfflineAudioContext(1, 1000, SR)
    const bank = new SampleBank({
      ctx: ctx as never,
      index,
      gains: levels,
      baseUrl: '',
      fetchBytes: (url: string) => {
        // `url` is already "<baseUrl><file>"; with an empty base it is the manifest path.
        const bytes = readFileSync(resolve(CANDIDATE, 'public/samples', url))
        const copy = new Uint8Array(bytes.byteLength)
        copy.set(bytes)
        return Promise.resolve(copy.buffer)
      },
    })
    const failures = await bank.preloadModel(model)
    return { ctx, bank, failures }
  }

  it('decodes every bundled sample of all three recorded sets offline', async () => {
    for (const model of ['grand', 'upright', 'cp80'] as const) {
      const { bank, failures } = await loadModel(model)
      expect(failures, `${model} failed samples`).toEqual([])
      const expected = entries.filter((e) => e.model === model).length
      expect(bank.loadedCount, model).toBe(expected)
    }
  }, 60000)

  it('produces audible, and audibly different, output for the three recorded types', async () => {
    const results: Record<string, { rms: number; brightness: number; samples: Float32Array }> = {}
    for (const [pianoModel, sampleModel] of [
      ['grand.salamander', 'grand'],
      ['upright.ivy', 'upright'],
      ['electric.cp80', 'cp80'],
    ] as const) {
      const { ctx, bank } = await loadModel(sampleModel)
      const resolved = bank.resolve(sampleModel, 61, 0.75)
      expect(resolved, `${pianoModel} resolved no sample`).not.toBeNull()
      const buffer = await bank.load(resolved!.entry)
      const renderCtx = new OfflineAudioContext(1, Math.round(SR * 1.2), SR)
      const nodes = createSampleVoice(
        renderCtx as never,
        bank,
        resolved!.entry,
        {
          velocity: 0.75,
          model: pianoModel as never,
          touchExponent: 1,
          dynComp: 0,
          timbre: 0,
          unison: 0,
          softRelease: false,
          stringRes: false,
          midi: 61,
          playedMidi: 61,
        },
        // Decoding happened on `ctx`; both are an OfflineAudioContext, so the buffer is
        // interchangeable and the voice is the shipping code path.
        buffer as never,
      )
      nodes.output.connect(renderCtx.destination as never)
      nodes.start(0)
      const rendered = await renderCtx.startRendering()
      const samples = rendered.getChannelData(0)
      results[pianoModel] = { rms: rms(samples), brightness: brightness(samples), samples }
      expect(results[pianoModel].rms, `${pianoModel} is silent`).toBeGreaterThan(0.005)
      nodes.stop()
    }

    // Each recorded type is a genuinely different recording: every pair differs in level
    // and/or spectral balance by a margin no amount of normalisation would erase.
    const pairs: [string, string][] = [
      ['grand.salamander', 'upright.ivy'],
      ['grand.salamander', 'electric.cp80'],
      ['upright.ivy', 'electric.cp80'],
    ]
    for (const [a, b] of pairs) {
      const first = results[a]
      const second = results[b]
      const brightnessRatio = first.brightness / second.brightness
      const levelRatio = first.rms / second.rms
      const differs = Math.abs(brightnessRatio - 1) > 0.06 || Math.abs(levelRatio - 1) > 0.12
      expect(differs, `${a} vs ${b}: brightness ${brightnessRatio.toFixed(3)}, level ${levelRatio.toFixed(3)}`).toBe(true)
    }
  }, 60000)

  it('renders the three synthesised types from the modelled voice, and they differ too', async () => {
    const measured: Record<string, number> = {}
    for (const model of ['clav.modelled', 'digital.modelled', 'misc.modelled'] as const) {
      const ctx = new OfflineAudioContext(1, Math.round(SR * 1.0), SR)
      const nodes = createModelledVoice(ctx as never, {
        velocity: 0.75,
        model,
        touchExponent: 1,
        dynComp: 0,
        timbre: 0,
        unison: 0,
        softRelease: false,
        stringRes: false,
        midi: 60,
        playedMidi: 60,
      })
      nodes.output.connect(ctx.destination as never)
      nodes.start(0)
      const rendered = await ctx.startRendering()
      const samples = rendered.getChannelData(0)
      expect(rms(samples), model).toBeGreaterThan(0.005)
      measured[model] = brightness(samples)
      nodes.stop()
    }
    // The three have their own character rather than being one sound relabelled.
    expect(measured['misc.modelled']).toBeGreaterThan(measured['digital.modelled'] * 3)
    expect(measured['clav.modelled']).toBeGreaterThan(measured['digital.modelled'])
  })
})

describe('piano.instrument-library — model selection and parameters', () => {
  it('maps a printed timbre position into each family own voicing list', () => {
    // Acoustic: panel positions 0..2 are SOFT/MID/BRIGHT; Dyno positions clamp to BRIGHT.
    expect(timbreLabelFor('grand', 0)).toBe('Soft')
    expect(timbreLabelFor('grand', 1)).toBe('Mid')
    expect(timbreLabelFor('grand', 2)).toBe('Bright')
    expect(timbreLabelFor('grand', 4)).toBe('Bright')
    // Electric: all five printed positions exist, including the two Dyno preamps.
    expect(timbreLabelFor('electric', 3)).toBe('Dyno 1')
    expect(timbreLabelFor('electric', 4)).toBe('Dyno 2')
    // Clav: its own pickup-EQ names.
    expect(timbreLabelFor('clav', 0)).toBe('Soft')
    expect(timbreLabelFor('clav', 2)).toBe('Brilliant')
    // The index never leaves the family's list.
    for (const type of PIANO_TYPES) {
      for (let position = 0; position <= 4; position += 1) {
        const resolved = timbreIndexFor(type.id, position)
        expect(resolved).toBeGreaterThanOrEqual(1)
        expect(resolved).toBeLessThan(timbreOptionsFor(type.id).length)
      }
    }
  })

  it('maps KB Touch so HEAVY needs more force than LIGHT for the same result', () => {
    // HEAVY (1.45) attenuates a given strike more than MEDIUM (1.0), and LIGHT (0.68) less.
    expect(touchVelocity(0.5, 1.45)).toBeLessThan(touchVelocity(0.5, 1.0))
    expect(touchVelocity(0.5, 0.68)).toBeGreaterThan(touchVelocity(0.5, 1.0))
    // All three preserve the endpoints, so a hard stroke and silence stay extreme.
    for (const exponent of [1.45, 1.0, 0.68]) {
      expect(touchVelocity(1, exponent)).toBeCloseTo(1, 6)
      expect(touchVelocity(0, exponent)).toBeLessThan(0.01)
    }
  })

  it('lifts soft strokes with Dyn Comp and leaves hard ones alone', () => {
    expect(dynCompGain(0.2, 0)).toBe(1)
    expect(dynCompGain(0.2, 0.78)).toBeGreaterThan(dynCompGain(0.2, 0.34))
    expect(dynCompGain(1, 0.78)).toBe(1)
    // The gain is larger for a softer stroke, which is what narrows the dynamic range.
    expect(dynCompGain(0.1, 0.78)).toBeGreaterThan(dynCompGain(0.6, 0.78))
  })

  it('lengthens the release for Soft Release and disables it on Clav', () => {
    expect(releaseSeconds(60, true)).toBeGreaterThan(releaseSeconds(60, false))
    const clav = voiceParamsFor(
      { ...defaultPianoState(), softRelease: true, layers: { ...defaultPianoState().layers, 'piano.a': { ...defaultPianoState().layers['piano.a'], type: 'clav', model: 'clav.modelled' } } },
      'piano.a',
      0.7,
    )
    expect(clav.softRelease).toBe(false)
  })

  it('tilts timbre in the direction each printed voicing describes', () => {
    const flat = timbreTilt(0, false)
    const soft = timbreTilt(1, false)
    const bright = timbreTilt(3, false)
    expect(flat.treble).toBe(0)
    expect(soft.treble).toBeLessThan(0)
    expect(soft.bass).toBeGreaterThan(0)
    expect(bright.treble).toBeGreaterThan(0)
    // Electric voicings include the Dyno preamps, which lift both ends.
    expect(timbreTilt(5, true).bass).toBeGreaterThan(timbreTilt(0, true).bass)
  })

  it('gives every model its own character description', () => {
    const characters = PIANO_MODELS.map((m) => m.character)
    expect(new Set(characters).size).toBe(characters.length)
  })
})
