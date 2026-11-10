import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VoiceState } from '../src/audio/dsp/kernel'
import type { SampleSetId } from '../src/audio/dsp/params'
import { decodeFlac, pcmFingerprint } from '../src/audio/library/flac'
import { SAMPLE_MANIFEST, SAMPLE_SET_IDS, samplePath } from '../src/audio/library/loader'
import { PIANO_MODELS, PIANO_TYPES, modelAt, modelsOf, type PianoTypeName } from '../src/piano/catalog'
import details from '../IMPLEMENTATION_DETAILS.json'
import { mountApp } from './support/app'
import { readBundledAsset } from './support/fakes'
import { down, kernelOf, keys, led, oled, press, render, start, step, up } from './support/panel'
import { SR, brightness, magnitudeAt, mono, peak, rms, rmsAt } from './support/signal'
import { correlation, difference, loadSet, makeStage, renderStage, selectType } from './support/stage'

/**
 * Feature: piano.instrument-library
 * Six selectable types; Grand/Upright/Electric are bundled recorded sample sets, audibly
 * distinct, offline, with truthful provenance.
 *
 * The audio assertions render the production kernel with the real bundled files.
 */

const RECORDED: PianoTypeName[] = ['Grand', 'Upright', 'Electric']
const SYNTHESIZED: PianoTypeName[] = ['Clav', 'Digital', 'Misc']

async function playType(type: PianoTypeName, note = 60, velocity = 0.8, model = 0, seconds = 1) {
  const kernel = await makeStage((sound) => selectType(sound.layers[0], type, model))
  kernel.noteOn(note, velocity)
  const out = mono(renderStage(kernel, seconds))
  return { kernel, out }
}

function frequency(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12)
}

describe('piano.instrument-library: six selectable types', () => {
  it('lists the six types of the piano spec, each with at least one model', () => {
    expect([...PIANO_TYPES]).toEqual(['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'])
    for (const type of PIANO_TYPES) expect(PIANO_MODELS[type].length, type).toBeGreaterThanOrEqual(1)
    for (const type of RECORDED) {
      for (const model of PIANO_MODELS[type]) expect(model.origin, model.name).toBe('recorded')
    }
    for (const type of SYNTHESIZED) {
      for (const model of PIANO_MODELS[type]) {
        expect(model.origin, model.name).toBe('synthesized')
        // A synthesized model says so in its own name and description, and is never called a recording.
        expect(model.name).toMatch(/Synth/)
        expect(model.about).toMatch(/Synthesized.*Not a recording/)
      }
    }
  })

  it('the Type button steps through all six; each plays, lights its LED, and is named on the display', async () => {
    const app = mountApp()
    await start(app)
    const slugs = ['grand', 'upright', 'electric', 'clav', 'digital', 'misc']
    const heard: Float32Array[] = []
    for (let type = 0; type < 6; type += 1) {
      await app.settle()
      expect(step(app, 'piano-type')).toBe(PIANO_TYPES[type])
      expect(slugs.map((slug) => led(app, `piano-type-${slug}`))).toEqual(slugs.map((_, index) => (index === type ? 'on' : 'off')))
      const model = modelAt(type, 0)
      expect(oled(app, 'model')).toBe(model.name)
      expect(oled(app, 'layers')).toContain(`A:${PIANO_TYPES[type].toUpperCase()}`)
      expect(oled(app, 'source')).toBe(model.origin === 'recorded' ? 'RECORDED SAMPLES' : 'SYNTHESIZED, NOT RECORDED')
      expect(app.getByTestId('audio-status')).toHaveTextContent('Ready')

      down(app, 60)
      const out = render(app, 0.4)
      expect(rms(out.left), model.name).toBeGreaterThan(0.004)
      // What actually sounds matches what the display claims.
      const voices = kernelOf(app).describeVoices()
      expect(voices).toHaveLength(1)
      expect(voices[0].sampled, model.name).toBe(model.origin === 'recorded')
      heard.push(mono(out))
      up(app, 60)
      render(app, 1.5)
      expect(kernelOf(app).voiceCount).toBe(0)
      press(app, 'piano-type')
    }
    // Round the corner back to Grand.
    expect(step(app, 'piano-type')).toBe('Grand')
    for (let a = 0; a < 6; a += 1) {
      for (let b = a + 1; b < 6; b += 1) {
        expect(difference(heard[a], heard[b]), `${PIANO_TYPES[a]} vs ${PIANO_TYPES[b]}`).toBeGreaterThan(0.3)
      }
    }
  })

  it('the Model dial selects within the type, stops at either end, and each type remembers its model', async () => {
    const app = mountApp()
    await start(app)
    for (let presses = 0; presses < 3; presses += 1) press(app, 'piano-type')
    expect(step(app, 'piano-type')).toBe('Clav')
    expect(modelsOf(3).length).toBeGreaterThan(1)
    expect(oled(app, 'model')).toBe('Synth Clav Neck PU')
    down(app, 60)
    const neck = mono(render(app, 0.3))
    up(app, 60)
    render(app, 1)

    keys(app, 'piano-model', 'ArrowUp')
    expect(oled(app, 'model')).toBe('Synth Clav Bridge PU')
    expect(app.control('piano-model')).toHaveAttribute('aria-description', 'Clav: Synth Clav Bridge PU')
    down(app, 60)
    const bridge = mono(render(app, 0.3))
    up(app, 60)
    render(app, 1)
    expect(difference(neck, bridge)).toBeGreaterThan(0.1)
    expect(brightness(bridge)).not.toBeCloseTo(brightness(neck), 3)

    // The dial is endless, the list is not: turning further stays on the last model.
    keys(app, 'piano-model', 'ArrowUp', 'ArrowUp')
    expect(oled(app, 'model')).toBe('Synth Clav Bridge PU')
    // Leave the type and come back: Clav still has the bridge pickup; Grand has its only model.
    for (let presses = 0; presses < 3; presses += 1) press(app, 'piano-type')
    expect(oled(app, 'model')).toBe('Salamander Grand')
    keys(app, 'piano-model', 'ArrowUp')
    expect(oled(app, 'model')).toBe('Salamander Grand')
    for (let presses = 0; presses < 3; presses += 1) press(app, 'piano-type')
    expect(oled(app, 'model')).toBe('Synth Clav Bridge PU')
    keys(app, 'piano-model', 'ArrowDown', 'ArrowDown')
    expect(oled(app, 'model')).toBe('Synth Clav Neck PU')
  })

  it('every model of every type renders a different sound', async () => {
    const outs: Array<{ name: string; out: Float32Array }> = []
    for (const type of PIANO_TYPES) {
      for (let model = 0; model < PIANO_MODELS[type].length; model += 1) {
        const { out } = await playType(type, 60, 0.8, model)
        expect(peak(out), PIANO_MODELS[type][model].name).toBeGreaterThan(0.02)
        outs.push({ name: PIANO_MODELS[type][model].name, out })
      }
    }
    expect(outs.length).toBeGreaterThanOrEqual(6)
    for (let a = 0; a < outs.length; a += 1) {
      for (let b = a + 1; b < outs.length; b += 1) {
        expect(difference(outs[a].out, outs[b].out), `${outs[a].name} vs ${outs[b].name}`).toBeGreaterThan(0.1)
        expect(Math.abs(correlation(outs[a].out, outs[b].out)), `${outs[a].name} vs ${outs[b].name}`).toBeLessThan(0.98)
      }
    }
  })
})

describe('piano.instrument-library: Grand, Upright, and Electric are bundled recordings', () => {
  it('every file in the manifest is on disk, matches its hash, and decodes bit-exactly', () => {
    let files = 0
    for (const id of SAMPLE_SET_IDS) {
      const set = SAMPLE_MANIFEST.sets[id]
      const onDisk = readdirSync(join(process.cwd(), 'public', 'samples', id)).filter((name) => name.endsWith('.flac'))
      expect(onDisk.sort(), id).toEqual(set.files.map((file) => file.file.split('/')[1]).sort())
      for (const file of set.files) {
        const bytes = readFileSync(join(process.cwd(), 'public', samplePath(file.file)))
        expect(bytes.length, file.file).toBe(file.bytes)
        expect(createHash('sha256').update(bytes).digest('hex'), file.file).toBe(file.sha256)
        // The app's own decoder returns exactly the PCM the build script encoded.
        const decoded = decodeFlac(readBundledAsset(samplePath(file.file)))
        expect(decoded.sampleRate, file.file).toBe(SAMPLE_MANIFEST.sampleRate)
        expect(decoded.samples.length, file.file).toBe(file.frames)
        expect(pcmFingerprint(decoded.samples), file.file).toBe(file.pcmFnv1a)
        expect(file.seconds).toBeGreaterThan(0.3)
        files += 1
      }
    }
    expect(files).toBe(198)
    expect(() => decodeFlac(new Uint8Array(64))).toThrow(/Not a FLAC file/)
  })

  it('has enough root notes that no key on the keybed is pitch-shifted far', () => {
    const farthest = (id: SampleSetId, low = 28, high = 100) => {
      let worst = 0
      for (const layer of SAMPLE_MANIFEST.sets[id].layers) {
        for (let note = low; note <= high; note += 1) {
          const zone = layer.zones.find((candidate) => note >= candidate.lo && note <= candidate.hi)
          const distance = zone
            ? Math.abs(note - zone.root)
            : Math.min(...layer.zones.map((candidate) => Math.abs(note - candidate.root)))
          worst = Math.max(worst, distance)
        }
      }
      return worst
    }
    const roots = (id: SampleSetId) => new Set(SAMPLE_MANIFEST.sets[id].layers.flatMap((layer) => layer.zones.map((zone) => zone.root))).size
    // Acoustic pianos: a recording every minor third, so never more than one semitone of shift.
    expect(roots('grand')).toBe(30)
    expect(farthest('grand')).toBeLessThanOrEqual(1)
    // The upright follows its upstream mapping, which has a few three-semitone stretches.
    expect(roots('upright')).toBeGreaterThanOrEqual(30)
    expect(farthest('upright')).toBeLessThanOrEqual(3)
    // The EP200 itself spans A1–C7 (33–96); the upstream set has 21 recorded roots across it.
    // The nine keys of the 73-key bed outside that range borrow the nearest recording.
    expect(roots('electric')).toBeGreaterThanOrEqual(20)
    expect(farthest('electric', 33, 96)).toBeLessThanOrEqual(5)
    expect(farthest('electric')).toBeLessThanOrEqual(8)
  })

  it('has several velocity layers per instrument', () => {
    expect(SAMPLE_MANIFEST.sets.grand.layers.map((layer) => layer.name)).toEqual(['v4', 'v9', 'v14'])
    expect(SAMPLE_MANIFEST.sets.upright.layers).toHaveLength(2)
    expect(SAMPLE_MANIFEST.sets.electric.layers).toHaveLength(4)
    for (const id of SAMPLE_SET_IDS) {
      const layers = SAMPLE_MANIFEST.sets[id].layers
      expect(layers.at(-1)!.maxVelocity).toBe(1)
      for (let k = 1; k < layers.length; k += 1) expect(layers[k].maxVelocity).toBeGreaterThan(layers[k - 1].maxVelocity)
    }
  })

  it('plays the recordings themselves: the rendered note follows the file sample for sample', async () => {
    for (const [type, id] of [['Grand', 'grand'], ['Upright', 'upright'], ['Electric', 'electric']] as const) {
      const set = await loadSet(id)
      const layer = set.layers.at(-1)!
      const zone = layer.zones.find((candidate) => candidate.root >= 58 && candidate.root <= 62 && candidate.tune === 0) ?? layer.zones[10]
      const kernel = await makeStage((sound) => {
        selectType(sound.layers[0], type)
        sound.layers[0].stringRes = false
      })
      kernel.noteOn(zone.root, 1)
      const out = mono(renderStage(kernel, 0.4))
      // What the file says at the output rate (linear interpolation is close enough to compare shapes).
      const expected = new Float32Array(out.length)
      const ratio = (zone.rate / SR) * Math.pow(2, zone.tune / 1200)
      for (let i = 0; i < expected.length; i += 1) {
        const position = i * ratio
        const index = Math.floor(position)
        const t = position - index
        expected[i] = (zone.data[index] ?? 0) * (1 - t) + (zone.data[index + 1] ?? 0) * t
      }
      expect(correlation(out, expected), type).toBeGreaterThan(0.995)
      expect(kernel.describeVoices()[0]).toMatchObject({ sampled: true, state: VoiceState.Held })
    }
  })

  it('velocity layers are different recordings, not one recording turned up', async () => {
    for (const type of RECORDED) {
      const soft = (await playType(type, 60, 0.25, 0, 0.5)).out
      const firm = (await playType(type, 60, 0.85, 0, 0.5)).out
      const hard = (await playType(type, 60, 0.98, 0, 0.5)).out
      expect(rms(hard), type).toBeGreaterThan(rms(soft) * 4)
      // Two strikes inside the top layer are the same recording at two levels: the same shape.
      const sameLayer = correlation(firm, hard)
      expect(sameLayer, type).toBeGreaterThan(0.999)
      // A soft strike comes from another recording: a different shape, and a darker one.
      expect(correlation(soft, hard), type).toBeLessThan(sameLayer - 0.01)
      expect(brightness(hard), type).toBeGreaterThan(brightness(soft) * 1.3)
    }
  })

  it('neighbouring keys in different zones play different recordings', async () => {
    const kernel = await makeStage()
    const grand = await loadSet('grand')
    const zones = grand.layers[2].zones
    expect(zones[10].data).not.toBe(zones[11].data)
    // 61 and 62 sit either side of a zone boundary (roots 60 and 63).
    for (const note of [61, 62]) kernel.noteOn(note, 0.9)
    const voices = kernel.describeVoices()
    expect(voices.map((voice) => voice.note)).toEqual([61, 62])
  })

  it('is in tune across the whole keybed, for all three recorded instruments', async () => {
    for (const type of RECORDED) {
      for (const note of [28, 40, 52, 59, 60, 61, 64, 76, 88, 100]) {
        const { out } = await playType(type, note, 0.8, 0, 0.6)
        const strength = (semitones: number) => {
          let sum = 0
          for (let harmonic = 1; harmonic <= 4; harmonic += 1) {
            sum += magnitudeAt(out, frequency(note + semitones) * harmonic)
          }
          return sum
        }
        expect(rmsAt(out, 0, 0.3), `${type} ${note}`).toBeGreaterThan(0.003)
        expect(strength(0), `${type} ${note} vs a semitone up`).toBeGreaterThan(strength(1) * 1.5)
        expect(strength(0), `${type} ${note} vs a semitone down`).toBeGreaterThan(strength(-1) * 1.5)
      }
    }
  })

  it('the three recorded instruments are audibly distinct from each other', async () => {
    const [grand, upright, electric] = await Promise.all(RECORDED.map((type) => playType(type, 48, 0.8, 0, 1.5)))
    expect(difference(grand.out, upright.out)).toBeGreaterThan(0.6)
    expect(difference(grand.out, electric.out)).toBeGreaterThan(0.6)
    expect(difference(upright.out, electric.out)).toBeGreaterThan(0.6)
    expect(Math.abs(correlation(grand.out, upright.out))).toBeLessThan(0.6)
    expect(Math.abs(correlation(grand.out, electric.out))).toBeLessThan(0.6)
    // Loudness is comparable, so the difference is timbre and not just level.
    for (const other of [upright, electric]) {
      expect(rms(other.out) / rms(grand.out)).toBeGreaterThan(0.4)
      expect(rms(other.out) / rms(grand.out)).toBeLessThan(2.5)
    }
  })
})

describe('piano.instrument-library: offline and on demand', () => {
  it('asks only for bundled files by relative path, and only for the set in use', async () => {
    const app = mountApp()
    await start(app)
    const requests = app.fake.audio.assetRequests
    expect(new Set(requests).size).toBe(90)
    for (const path of requests) expect(path).toMatch(/^samples\/grand\/[A-Za-z0-9_-]+\.flac$/)
    for (const path of requests) expect(existsSync(join(process.cwd(), 'public', path)), path).toBe(true)

    press(app, 'piano-type')
    await app.settle()
    expect(app.fake.audio.assetRequests.some((path) => path.startsWith('samples/upright/'))).toBe(true)
    expect(app.fake.audio.assetRequests.some((path) => path.startsWith('samples/electric/'))).toBe(false)
    expect(app.getByTestId('audio-status')).toHaveTextContent('Ready')
    expect(kernelOf(app).layerSource(0)).toBe('samples')
    // Synthesized types need no files at all.
    const before = app.fake.audio.assetRequests.length
    press(app, 'piano-type')
    press(app, 'piano-type')
    await app.settle()
    expect(step(app, 'piano-type')).toBe('Clav')
    expect(app.fake.audio.assetRequests.filter((path) => path.startsWith('samples/electric/')).length).toBeGreaterThan(0)
    const afterElectric = app.fake.audio.assetRequests.length
    expect(afterElectric).toBeGreaterThan(before)
    press(app, 'piano-type')
    await app.settle()
    expect(app.fake.audio.assetRequests).toHaveLength(afterElectric)
    expect(kernelOf(app).layerSource(0)).toBe('synthesis')
  })

  it('never reaches for the network: no absolute URL anywhere in the application source', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? walk(join(dir, entry.name)) : /\.(tsx?|css|html)$/.test(entry.name) ? [join(dir, entry.name)] : [],
      )
    const files = [...walk(join(process.cwd(), 'src')), join(process.cwd(), 'index.html')]
    expect(files.length).toBeGreaterThan(30)
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      const urls = source.match(/https?:\/\/[^\s'"`)]+/g) ?? []
      // Comments may cite a licence or the manual; nothing may be fetched from a URL.
      for (const url of urls) expect(url, file).toMatch(/creativecommons\.org|w3\.org|stagebench\.local|rfc-editor\.org/)
      if (!file.endsWith('browser.ts')) expect(source, file).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|importScripts/)
    }
  })

  it('preloads the samples for the first key press without creating an audio context', async () => {
    const app = mountApp()
    await app.settle()
    expect(app.fake.audio.assetRequests.length).toBe(90)
    expect(app.fake.audio.contexts).toHaveLength(0)
    expect(app.getByTestId('audio-status')).toHaveTextContent('Idle')
  })
})

describe('piano.instrument-library: truthful provenance', () => {
  it('declares every bundled file, its source, licence, root note, and velocity layer', () => {
    // Phase 3 regenerated the file; the sample declarations are the same and are checked just the same.
    expect(details.phase).toBe(3)
    const sources = details.audio.sampleSources
    expect(sources.map((source) => source.set).sort()).toEqual(['electric', 'grand', 'upright'])
    for (const source of sources) {
      const set = SAMPLE_MANIFEST.sets[source.set as SampleSetId]
      expect(source.license).toBe(set.source.license)
      expect(source.source).toContain(set.source.repo)
      expect(source.source).toContain(set.source.commit)
      expect(source.isRecording).toBe(true)
      expect(source.files.slice().sort()).toEqual(set.files.map((file) => `public/samples/${file.file}`).sort())
      // Every file is listed with its root note and the velocity layers that use it.
      expect(source.fileDetails).toHaveLength(set.files.length)
      for (const file of source.fileDetails) {
        expect(file.rootNote).toMatch(/^[A-G]#?-?\d$/)
        expect(file.velocityLayers.length).toBeGreaterThan(0)
        expect(file.upstreamFile.length).toBeGreaterThan(3)
      }
      expect(existsSync(join(process.cwd(), 'public', 'samples', source.set, 'LICENSE.txt'))).toBe(true)
    }
    expect(readFileSync(join(process.cwd(), 'public', 'samples', 'grand', 'LICENSE.txt'), 'utf8')).toMatch(/Attribution 3\.0 Unported/)
    expect(readFileSync(join(process.cwd(), 'public', 'samples', 'upright', 'LICENSE.txt'), 'utf8')).toMatch(/CC0 1\.0 Universal/)
    expect(readFileSync(join(process.cwd(), 'public', 'samples', 'electric', 'LICENSE.txt'), 'utf8')).toMatch(/Attribution 3\.0 Unported/)
  })

  it('never describes a generated source as a recording', () => {
    const generated = details.audio.generatedSources
    const recipes = ['basic', 'clav-neck', 'clav-bridge', 'fm-piano', 'vibraphone', 'marimba']
    for (const recipe of recipes) {
      const entry = generated.find((source) => source.recipe === recipe)
      expect(entry, recipe).toBeDefined()
      expect(entry!.isRecording).toBe(false)
      expect(entry!.kind).toBe('live-synthesis')
    }
    for (const source of generated) expect(source.isRecording).toBe(false)
    // And the catalog agrees with the declaration, model by model.
    for (const type of PIANO_TYPES) {
      for (const model of PIANO_MODELS[type]) {
        if (model.source.kind === 'samples') {
          expect(details.audio.sampleSources.some((source) => source.set === (model.source as { set: string }).set)).toBe(true)
        } else {
          expect(recipes).toContain(model.source.recipe)
        }
      }
    }
  })

  it('credits the recordings where the user can see them', async () => {
    const app = mountApp()
    await start(app)
    expect(app.getByTestId('piano-status')).toHaveTextContent('Recorded samples')
    expect(app.getByTestId('piano-detail')).toHaveTextContent(/Salamander Grand Piano V3, Alexander Holm, CC BY 3\.0/)
    // The Sample credits panel names every recorded set, its author, and its licence.
    const credits = app.getByTestId('sample-credits')
    expect(credits).toHaveTextContent(/Salamander Grand Piano V3 — Yamaha C5 grand piano, by Alexander Holm\. Licence: CC BY 3\.0/)
    expect(credits).toHaveTextContent(/Upright Piano KW.*FreePats.*Licence: CC0 1\.0/)
    expect(credits).toHaveTextContent(/Wurlitzer EP200 Electric Piano.*by Greg Sullivan\. Licence: CC BY 3\.0/)
    expect(credits).toHaveTextContent(/synthesized by this app; they are not recordings/)
    for (let presses = 0; presses < 3; presses += 1) press(app, 'piano-type')
    expect(app.getByTestId('piano-status')).toHaveTextContent('Synthesis')
    expect(app.getByTestId('piano-detail')).toHaveTextContent(/Not a recording/)
  })
})
