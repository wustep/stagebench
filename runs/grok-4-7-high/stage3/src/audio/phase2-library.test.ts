import fs from 'node:fs'
import path from 'node:path'
import { OfflineAudioContext } from 'node-web-audio-api'
import { describe, expect, it } from 'vitest'
import { PIANO_TYPES } from './labels'
import { fetchEncodedLibrary, pickZone, type RecordedSet, type SampleZone } from './library'
import { meanAbsDiff, renderPiano, rms } from '../test/renderAudio'
import type { AudioBufferLike } from './boundaries'

const root = path.resolve(import.meta.dirname, '../..')

function tone(frequency: number, seconds = 0.4): SampleZone['buffer'] {
  const sampleRate = 44100
  const context = new OfflineAudioContext(1, 8, sampleRate)
  const length = Math.floor(sampleRate * seconds)
  const buffer = context.createBuffer(1, length, sampleRate)
  const data = buffer.getChannelData(0)
  for (let index = 0; index < length; index++) {
    data[index] = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.6
  }
  return buffer as unknown as SampleZone['buffer']
}

function setFrom(type: RecordedSet['type'], name: string, zones: SampleZone[]): RecordedSet {
  return { type, name, zones }
}

async function decodeFile(file: string): Promise<AudioBufferLike> {
  const bytes = fs.readFileSync(path.join(root, 'public/samples', file))
  const context = new OfflineAudioContext(1, 44100, 44100)
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return context.decodeAudioData(copy) as unknown as Promise<AudioBufferLike>
}

describe('piano.instrument-library', () => {
  it('ships three offline recorded sets with provenance and plays them as distinct instruments', async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/samples/manifest.json'), 'utf8')) as {
      sets: {
        type: 'Grand' | 'Upright' | 'Electric'
        name: string
        license: string
        source: string
        kind: string
        zones: { file: string; rootMidi: number; velocityLayer: number }[]
      }[]
    }
    expect(manifest.sets.map((set) => set.type)).toEqual(['Grand', 'Upright', 'Electric'])
    for (const set of manifest.sets) {
      expect(set.kind).toBe('recorded')
      expect(set.license.length).toBeGreaterThan(3)
      expect(set.source).toMatch(/Alexander Holm|Versilian|Jeff Learman/)
      expect(set.zones.length).toBeGreaterThanOrEqual(26)
      const roots = new Set(set.zones.map((zone) => zone.rootMidi))
      expect(roots.size).toBeGreaterThanOrEqual(13)
      const layers = new Set(set.zones.map((zone) => zone.velocityLayer))
      expect(layers.size).toBeGreaterThanOrEqual(2)
      for (const zone of set.zones) {
        const file = path.join(root, 'public/samples', zone.file)
        expect(fs.existsSync(file), zone.file).toBe(true)
        expect(fs.statSync(file).size).toBeGreaterThan(400)
        expect(zone.file.startsWith('http')).toBe(false)
      }
    }

    const grandSoft = await decodeFile('grand/c4-l1.mp3')
    const grandHard = await decodeFile('grand/c4-l2.mp3')
    const upright = await decodeFile('upright/c4-l2.mp3')
    const electric = await decodeFile('electric/d4-l2.mp3')
    expect(grandSoft.getChannelData(0).length).toBeGreaterThan(20000)
    expect(meanAbsDiff(grandSoft.getChannelData(0), grandHard.getChannelData(0))).toBeGreaterThan(0.02)

    const soft = await renderPiano((engine) => {
      engine.installRecordedSets([
        setFrom('Grand', 'Salamander Grand', [
          { rootMidi: 60, velocityLayer: 1, buffer: grandSoft },
          { rootMidi: 60, velocityLayer: 2, buffer: grandHard },
        ]),
      ])
      engine.noteOn(60, 0.2)
    }, 0.6)
    const hard = await renderPiano((engine) => {
      engine.installRecordedSets([
        setFrom('Grand', 'Salamander Grand', [
          { rootMidi: 60, velocityLayer: 1, buffer: grandSoft },
          { rootMidi: 60, velocityLayer: 2, buffer: grandHard },
        ]),
      ])
      engine.noteOn(60, 0.95)
    }, 0.6)
    expect(soft.engine.getStatus()).toBe('ready')
    expect(soft.engine.getDetail()).toBe('Salamander Grand')
    expect(meanAbsDiff(soft.channel, hard.channel)).toBeGreaterThan(0.01)

    const uprightRender = await renderPiano((engine) => {
      engine.installRecordedSets([
        setFrom('Grand', 'Salamander Grand', [{ rootMidi: 60, velocityLayer: 1, buffer: grandHard }]),
        setFrom('Upright', 'VS Upright', [{ rootMidi: 60, velocityLayer: 1, buffer: upright }]),
        setFrom('Electric', 'Rhodes Mk I', [{ rootMidi: 62, velocityLayer: 1, buffer: electric }]),
      ])
      engine.setFocusedType('Upright')
      engine.noteOn(60, 0.9)
    }, 0.5)
    const electricRender = await renderPiano((engine) => {
      engine.installRecordedSets([
        setFrom('Grand', 'Salamander Grand', [{ rootMidi: 60, velocityLayer: 1, buffer: grandHard }]),
        setFrom('Upright', 'VS Upright', [{ rootMidi: 60, velocityLayer: 1, buffer: upright }]),
        setFrom('Electric', 'Rhodes Mk I', [{ rootMidi: 62, velocityLayer: 1, buffer: electric }]),
      ])
      engine.setFocusedType('Electric')
      engine.noteOn(62, 0.9)
    }, 0.5)
    expect(meanAbsDiff(hard.channel.subarray(0, uprightRender.channel.length), uprightRender.channel)).toBeGreaterThan(0.02)
    expect(meanAbsDiff(uprightRender.channel, electricRender.channel)).toBeGreaterThan(0.02)
    expect(rms(uprightRender.channel, 400, 8000)).toBeGreaterThan(0.002)
    expect(rms(electricRender.channel, 400, 8000)).toBeGreaterThan(0.002)
  })

  it('selects six types and keeps Clav, Digital, and Misc as distinct synthesis', async () => {
    const renders = []
    for (const type of PIANO_TYPES) {
      const rendered = await renderPiano((engine) => {
        engine.setFocusedType(type)
        engine.noteOn(60, 0.8)
      }, 0.35)
      expect(rendered.engine.getLayer('A').type).toBe(type)
      expect(rms(rendered.channel, 200, 4000)).toBeGreaterThan(0.002)
      renders.push(rendered.channel)
    }
    for (let left = 0; left < renders.length; left++) {
      for (let right = left + 1; right < renders.length; right++) {
        expect(meanAbsDiff(renders[left]!, renders[right]!), `${PIANO_TYPES[left]} vs ${PIANO_TYPES[right]}`).toBeGreaterThan(0.008)
      }
    }
  })

  it('picks the nearest root and the velocity layer inside that root', () => {
    const zones: SampleZone[] = [
      { rootMidi: 60, velocityLayer: 1, buffer: tone(220, 0.05) },
      { rootMidi: 60, velocityLayer: 2, buffer: tone(220, 0.05) },
      { rootMidi: 72, velocityLayer: 1, buffer: tone(440, 0.05) },
    ]
    expect(pickZone(zones, 62, 0.1)?.velocityLayer).toBe(1)
    expect(pickZone(zones, 62, 0.9)?.velocityLayer).toBe(2)
    expect(pickZone(zones, 70, 0.2)?.rootMidi).toBe(72)
    expect(pickZone([], 60, 1)).toBeNull()
  })

  it('loads a manifest through the injectable fetch boundary', async () => {
    const bytes = new Uint8Array(fs.readFileSync(path.join(root, 'public/samples/grand/c4-l1.mp3')))
    const manifest = {
      version: 1,
      sets: [
        {
          type: 'Grand',
          name: 'Stub Grand',
          zones: [{ file: 'grand/c4-l1.mp3', rootMidi: 60, velocityLayer: 1 }],
        },
      ],
    }
    const fetched = await fetchEncodedLibrary('http://instrument.local/', async (input) => {
      const url = String(input)
      if (url.endsWith('manifest.json')) return new Response(JSON.stringify(manifest), { status: 200 })
      return new Response(bytes, { status: 200 })
    })
    expect(fetched[0]?.name).toBe('Stub Grand')
    expect(fetched[0]?.zones[0]?.bytes.byteLength).toBe(bytes.byteLength)
    await expect(fetchEncodedLibrary('http://instrument.local/', async () => new Response('missing', { status: 404 }))).rejects.toThrow(/manifest/)
  })
})

describe('piano.fallback', () => {
  it('stays playable and does not report the library ready when samples fail', async () => {
    const rendered = await renderPiano((engine) => {
      engine.failSampleLibrary()
      engine.setFocusedType('Grand')
      engine.noteOn(64, 0.8)
    }, 0.4)
    expect(rendered.engine.libraryState()).toBe('failed')
    expect(rendered.engine.getStatus()).toBe('fallback')
    expect(rendered.engine.getStatus()).not.toBe('ready')
    expect(rendered.engine.getDetail()).toMatch(/fallback/i)
    expect(rms(rendered.channel, 300, 5000)).toBeGreaterThan(0.01)

    const clav = await renderPiano((engine) => {
      engine.failSampleLibrary()
      engine.setFocusedType('Clav')
      engine.noteOn(64, 0.8)
    }, 0.3)
    expect(clav.engine.getStatus()).toBe('ready')
    expect(clav.engine.getDetail()).toMatch(/Clavinet/)
    expect(meanAbsDiff(rendered.channel.subarray(0, clav.channel.length), clav.channel)).toBeGreaterThan(0.01)
  })
})
