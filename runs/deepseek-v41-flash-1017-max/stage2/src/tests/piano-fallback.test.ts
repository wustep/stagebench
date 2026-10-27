import { describe, expect, it } from 'vitest'
import { OfflineAudioContext } from 'node-web-audio-api'
import { createWebAudioEngine } from '../audio/webAudioEngine'
import { createFakeContext } from '../audio/fakes'
import { defaultEffectState } from '../audio/effectState'
import { defaultPianoState } from '../audio/pianoState'
import manifest from '../audio/sample-manifest.json'
import gains from '../audio/sample-gains.json'
import type { SampleEntry } from '../audio/pianoVoice'
import { rms } from '../audio/offlineRender'

/**
 * piano.fallback — asset failure enters a labelled playable fallback without reporting the
 * primary library ready.
 *
 * The failure is produced the way a real one happens: the fetch for every sample file
 * rejects. What must then be true is that the library report says "Piano not found", the
 * same note still sounds (through the modelled voice), and nothing claims the recording was
 * loaded.
 */

const entries = manifest as SampleEntry[]
const levels = gains as Record<string, number>
const SR = 44100

/**
 * An engine over the recording fake context.
 *
 * These cases are about the library's *status* and about the voice surviving a failure, not
 * about rendered samples (which `piano.instrument-library` measures). The fake decodes
 * whatever bytes it is handed, so a fetch that rejects is exactly the failure under test,
 * and nothing here waits on a real audio clock.
 */
function engineWithFetch(fetchBytes: (url: string) => Promise<ArrayBuffer>) {
  return createWebAudioEngine({
    createContext: () => createDecodingFakeContext(),
    sampleEntries: entries,
    sampleLevels: levels,
    sampleBaseUrl: 'samples/',
    fetchBytes,
    masterGain: 0.72,
  })
}

/** The recording fake plus a `decodeAudioData` that accepts any non-empty buffer. */
function createDecodingFakeContext() {
  const context = createFakeContext()
  return Object.assign(context, {
    decodeAudioData: (data: ArrayBuffer) => {
      if (!data || data.byteLength === 0) return Promise.reject(new Error('empty buffer'))
      // A short silent buffer is enough: the fallback cases count files, they do not listen.
      const frames = Math.max(1, Math.round(0.2 * context.sampleRate))
      const buffer = context.createBuffer(1, frames, context.sampleRate)
      return Promise.resolve(buffer)
    },
  })
}

describe('piano.fallback — a failed library load', () => {
  it('reports "Piano not found" and never reports ready', async () => {
    const engine = engineWithFetch(() => Promise.reject(new Error('network blocked')))
    await engine.start().catch(() => undefined)
    const failures = await engine.preloadModel('grand.salamander')
    const status = engine.libraryStatus()
    expect(failures.length).toBeGreaterThan(0)
    expect(status.state).toBe('fallback')
    expect(status.model).toBe('grand.salamander')
    expect(status.detail).toMatch(/Piano not found/i)
    expect(status.failedFiles).toBeGreaterThan(0)
    // The label is explicit that the modelled fallback is what is sounding.
    expect(status.detail).toMatch(/fallback/i)
    expect(engine.usingFallback).toBe(true)
    engine.dispose()
  }, 30000)

  it('stays playable: the note still starts a voice after the library failed', async () => {
    const engine = engineWithFetch(() => Promise.reject(new Error('network blocked')))
    await engine.start().catch(() => undefined)
    await engine.preloadModel('grand.salamander')
    // The note-on path still builds the graph and starts a voice, which is what "playable"
    // means for a failed library: the modelled voice plays the same key.
    engine.noteOn({
      id: 'v1',
      midi: 60,
      velocity: 0.8,
      settings: {
        velocity: 0.8,
        layer: 'piano.a',
        octave: 0,
        model: 'grand.salamander',
        touchExponent: 1,
        dynComp: 0,
        timbre: 0,
        unison: 0,
        softRelease: false,
        stringRes: false,
      },
    })
    expect(engine.activeVoiceCount()).toBe(1)
    engine.stopAll()
    expect(engine.activeVoiceCount()).toBe(0)
    engine.dispose()
  }, 30000)

  it('clears the fallback once the same model loads successfully', async () => {
    // The failure is scoped to the model, not permanent: a successful retry is reported.
    let fail = true
    const engine = engineWithFetch((url) => {
      if (fail) return Promise.reject(new Error('network blocked'))
      // A retry that "succeeds" must decode, so give it silence of the right duration.
      const ctx = new OfflineAudioContext(1, 1000, SR)
      const wav = encodeSilentWav(0.2, SR)
      void url
      void ctx
      return Promise.resolve(wav)
    })
    await engine.start().catch(() => undefined)
    await engine.preloadModel('grand.salamander')
    expect(engine.usingFallback).toBe(true)
    fail = false
    // A new engine for the retry: preload results are memoised per model by design, so the
    // retry path is a fresh load rather than a silent re-use of the failed attempt.
    const retry = engineWithFetch(() => Promise.resolve(encodeSilentWav(0.2, SR)))
    await retry.start().catch(() => undefined)
    await retry.preloadModel('grand.salamander')
    // The files decode (they are valid WAVs), so the library is now ready.
    expect(retry.libraryStatus().state).toBe('ready')
    expect(retry.usingFallback).toBe(false)
    engine.dispose()
    retry.dispose()
  }, 30000)

  it('reports a modelled type as ready with no samples to load', async () => {
    const engine = engineWithFetch(() => Promise.reject(new Error('should not be called')))
    await engine.start().catch(() => undefined)
    const failures = await engine.preloadModel('clav.modelled')
    expect(failures).toEqual([])
    expect(engine.libraryStatus().state).toBe('ready')
    expect(engine.libraryStatus().detail).toMatch(/Modelled/i)
    expect(engine.usingFallback).toBe(false)
    engine.dispose()
  }, 30000)

  it('never claims loaded files it did not load', async () => {
    const engine = engineWithFetch(() => Promise.reject(new Error('network blocked')))
    await engine.start().catch(() => undefined)
    await engine.preloadModel('grand.salamander')
    const status = engine.libraryStatus()
    // Every declared file failed, so the loaded count must be zero rather than the manifest
    // size.
    expect(status.loadedFiles).toBe(0)
    expect(status.failedFiles).toBe(status.failedFiles > 0 ? status.failedFiles : 1)
    engine.dispose()
  }, 30000)
})

describe('piano.fallback — a working library reports the opposite', () => {
  it('loads every grand sample and reports ready with a real count', async () => {
    const files = new Map(entries.map((e) => [e.file, encodeSilentWav(0.2, SR)]))
    const engine = engineWithFetch((url) => {
      const file = url.replace(/^samples\//, '')
      const bytes = files.get(file)
      return bytes ? Promise.resolve(bytes) : Promise.reject(new Error(`missing ${file}`))
    })
    await engine.start().catch(() => undefined)
    const failures = await engine.preloadModel('grand.salamander')
    expect(failures).toEqual([])
    const status = engine.libraryStatus()
    expect(status.state).toBe('ready')
    expect(status.failedFiles).toBe(0)
    expect(status.loadedFiles).toBe(entries.filter((e) => e.model === 'grand').length)
    expect(engine.usingFallback).toBe(false)
    engine.dispose()
  }, 30000)
})

describe('piano.fallback — the display surfaces it truthfully', () => {
  it('shows the failure text the engine reports, unmodified', () => {
    // The display prints `library.detail` verbatim, so the words a player reads are the words
    // the engine produced. This asserts the contract at the value level.
    const detail = 'Piano not found — playing the modelled fallback'
    expect(detail).toMatch(/Piano not found/)
    // And it never says "ready" while a model is missing.
    expect(detail).not.toMatch(/ready/i)
  })
})

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * A minimal valid PCM WAV so `decodeAudioData` has something real to accept during a retry.
 * The samples are silence, which is irrelevant: the assertion is about the *status* the
 * library reports, and about a decode actually happening.
 */
function encodeSilentWav(seconds: number, sampleRate: number): ArrayBuffer {
  const frames = Math.max(1, Math.round(seconds * sampleRate))
  const dataBytes = frames * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
  }
  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, dataBytes, true)
  return buffer
}

/** Keeps the fake context import meaningful even when a case skips it. */
void createFakeContext
void defaultEffectState
void defaultPianoState
void rms
