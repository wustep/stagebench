import { describe, expect, it } from 'vitest'
import { PianoEngine } from '../src/audio/engine'
import { SAMPLE_LOAD_TIMEOUT_MS, SampleLibrary } from '../src/audio/library/loader'
import { FALLBACK_VOICE_NAME } from '../src/piano/catalog'
import { mountApp } from './support/app'
import { createFakePlatform, flush, readBundledAsset, type FakePlatform } from './support/fakes'
import { down, kernelOf, led, oled, press, render, start, step, up } from './support/panel'
import { mono, rms } from './support/signal'
import { difference, makeStage, renderStage } from './support/stage'

/**
 * Feature: piano.fallback
 * Asset failure enters a labeled playable fallback without reporting the primary library ready.
 */

function engineWith(configure: (fake: FakePlatform) => void) {
  const fake = createFakePlatform()
  configure(fake)
  const engine = new PianoEngine(fake.platform.audio, fake.platform.timing)
  const seen: string[] = []
  engine.subscribe(() => seen.push(engine.getSnapshot().status))
  return { fake, engine, seen }
}

describe('piano.fallback: the engine', () => {
  for (const [mode, reason] of [
    ['missing', /HTTP 404/],
    ['corrupt', /Not a FLAC file/],
    ['truncated', /FLAC/],
  ] as const) {
    it(`sample files ${mode}: goes loading → fallback, never ready, and says why`, async () => {
      const { fake, engine, seen } = engineWith((f) => void (f.audio.assets = mode))
      await engine.start()
      const snapshot = engine.getSnapshot()
      expect(seen).toEqual(['loading', 'fallback'])
      expect(snapshot.status).toBe('fallback')
      expect(snapshot.backend).toBe('worklet')
      expect(snapshot.library.grand).toBe('failed')
      expect(snapshot.libraryErrors.grand).toMatch(reason)
      expect(snapshot.detail).toMatch(/Fallback: the Grand samples could not be loaded/)
      expect(snapshot.detail).toMatch(/synthesized stand-in voice, which is not a recording/)
      expect(snapshot.detail).not.toMatch(/ready/i)

      // Playable: the stand-in voice is synthesized, and it sounds.
      const kernel = fake.audio.node.host.kernel
      expect(kernel.hasSampleSet('grand')).toBe(false)
      expect(kernel.layerSource(0)).toBe('fallback')
      engine.noteOn(60, 0.8)
      expect(rms(fake.audio.node.render(0.3).left)).toBeGreaterThan(0.005)
      expect(kernel.describeVoices()[0].sampled).toBe(false)
      engine.noteOff(60)
      fake.audio.node.render(1.5)
      expect(kernel.voiceCount).toBe(0)
      engine.dispose()
      expect(fake.timing.pendingTimers).toBe(0)
    })
  }

  it('a build with no sample loader at all is a fallback too', async () => {
    const { fake, engine } = engineWith((f) => {
      ;(f.audio as { loadAsset?: unknown }).loadAsset = undefined
    })
    await engine.start()
    expect(engine.getSnapshot().status).toBe('fallback')
    expect(engine.getSnapshot().libraryErrors.grand).toMatch(/no way to load sample files/)
    engine.noteOn(60, 0.8)
    expect(rms(fake.audio.node.render(0.2).left)).toBeGreaterThan(0.005)
  })

  it('files that never arrive time out into the fallback instead of hanging', async () => {
    const { fake, engine } = engineWith((f) => void (f.audio.assets = 'pending'))
    const started = engine.start()
    await flush()
    expect(engine.getSnapshot().status).toBe('loading')
    fake.timing.advance(SAMPLE_LOAD_TIMEOUT_MS - 1)
    await flush()
    expect(engine.getSnapshot().status).toBe('loading')
    fake.timing.advance(1)
    await started
    expect(engine.getSnapshot().status).toBe('fallback')
    expect(engine.getSnapshot().libraryErrors.grand).toMatch(/did not arrive within 20 s/)
    expect(fake.timing.pendingTimers).toBe(0)
    engine.noteOn(60, 0.8)
    expect(rms(fake.audio.node.render(0.2).left)).toBeGreaterThan(0.005)
  })

  it('one bad file fails the whole set: no half-loaded piano', async () => {
    const { fake, engine } = engineWith((f) => {
      f.audio.assets = 'missing'
      f.audio.failingAssets = 'samples/grand/C4v9.flac'
    })
    await engine.start()
    expect(engine.getSnapshot().library.grand).toBe('failed')
    expect(engine.getSnapshot().libraryErrors.grand).toMatch(/C4v9\.flac: HTTP 404/)
    expect(fake.audio.node.host.kernel.hasSampleSet('grand')).toBe(false)
  })

  it('both stand-ins at once are both reported: missing samples and a main-thread engine', async () => {
    const { engine } = engineWith((f) => {
      f.audio.assets = 'missing'
      f.audio.worklet = 'reject'
    })
    await engine.start()
    const { status, detail, backend } = engine.getSnapshot()
    expect(status).toBe('fallback')
    expect(backend).toBe('script-processor')
    expect(detail).toMatch(/Grand samples could not be loaded/)
    expect(detail).toMatch(/running on the main thread/)
  })

  it('the stand-in is the Phase 1 synthesized piano, not a quieter copy of the recording', async () => {
    const real = await makeStage()
    real.noteOn(60, 0.8)
    const recorded = mono(renderStage(real, 0.5))
    const { fake, engine } = engineWith((f) => void (f.audio.assets = 'missing'))
    await engine.start()
    engine.noteOn(60, 0.8)
    const standIn = mono(fake.audio.node.render(0.5))
    expect(difference(recorded, standIn)).toBeGreaterThan(0.5)
  })

  it('the loader rejects a file of the wrong length rather than play a damaged recording', async () => {
    const library = new SampleLibrary((path) => {
      const good = readBundledAsset(path)
      // Swap one file for another valid FLAC of a different length.
      return Promise.resolve(path.endsWith('upright/C8vH.flac') ? readBundledAsset('samples/upright/C4vL-lp2200.flac') : good)
    })
    expect(await library.load('upright')).toBeNull()
    expect(library.status('upright')).toBe('failed')
    expect(library.error('upright')).toMatch(/C8vH\.flac: \d+ frames, expected \d+/)
  })
})

describe('piano.fallback: what the user is told', () => {
  it('display, type LED, and status all say fallback, and the keybed still plays', async () => {
    const app = mountApp((fake) => void (fake.audio.assets = 'missing'))
    // Before any audio exists nothing has been claimed.
    expect(oled(app, 'source')).toBe('RECORDED SAMPLES - STANDBY')
    await start(app)
    expect(app.getByTestId('audio-status')).toHaveTextContent('Fallback')
    expect(app.getByTestId('audio-status')).not.toHaveTextContent('Ready')
    expect(app.control('program-oled')).toHaveTextContent('AUDIO FALLBACK')
    expect(oled(app, 'model')).toBe(FALLBACK_VOICE_NAME)
    expect(oled(app, 'source')).toBe('PIANO NOT FOUND - FALLBACK')
    expect(app.control('program-oled')).toHaveAttribute('data-voice-kind', 'fallback')
    // "The type LED will flash" (manual p. 24).
    expect(led(app, 'piano-type-grand')).toBe('blink')
    expect(app.getByTestId('piano-status')).toHaveTextContent('Fallback')
    expect(app.getByTestId('piano-detail')).toHaveTextContent(/Salamander Grand could not be loaded \(.*HTTP 404\)/)
    expect(app.getByTestId('piano-detail')).toHaveTextContent(/it is not a recording/)

    down(app, 60)
    expect(rms(render(app, 0.3).left)).toBeGreaterThan(0.004)
    expect(kernelOf(app).describeVoices()[0].sampled).toBe(false)
    up(app, 60)
  })

  it('only the piano that failed falls back; the others are themselves', async () => {
    const app = mountApp((fake) => {
      fake.audio.assets = 'missing'
      fake.audio.failingAssets = 'samples/upright/'
    })
    await start(app)
    expect(app.getByTestId('audio-status')).toHaveTextContent('Ready')
    expect(oled(app, 'source')).toBe('RECORDED SAMPLES')
    expect(led(app, 'piano-type-grand')).toBe('on')

    press(app, 'piano-type')
    await app.settle()
    expect(step(app, 'piano-type')).toBe('Upright')
    expect(app.getByTestId('audio-status')).toHaveTextContent('Fallback')
    expect(oled(app, 'model')).toBe(FALLBACK_VOICE_NAME)
    expect(led(app, 'piano-type-upright')).toBe('blink')
    expect(kernelOf(app).layerSource(0)).toBe('fallback')
    down(app, 60)
    expect(rms(render(app, 0.2).left)).toBeGreaterThan(0.004)
    up(app, 60)
    render(app, 1.5)

    // Electric loads fine: Ready again, steady LED, real samples.
    press(app, 'piano-type')
    await app.settle()
    expect(app.getByTestId('audio-status')).toHaveTextContent('Ready')
    expect(oled(app, 'model')).toBe('EP200 Reed Piano')
    expect(led(app, 'piano-type-electric')).toBe('on')
    expect(kernelOf(app).layerSource(0)).toBe('samples')

    // Synthesized types need no files and are never a fallback.
    press(app, 'piano-type')
    await app.settle()
    expect(app.getByTestId('audio-status')).toHaveTextContent('Ready')
    expect(oled(app, 'source')).toBe('SYNTHESIZED, NOT RECORDED')
    expect(kernelOf(app).layerSource(0)).toBe('synthesis')
  })

  it('with every sample missing, the synthesized types are still Ready', async () => {
    const app = mountApp((fake) => void (fake.audio.assets = 'missing'))
    await start(app)
    for (let presses = 0; presses < 3; presses += 1) press(app, 'piano-type')
    await app.settle()
    expect(step(app, 'piano-type')).toBe('Clav')
    expect(app.getByTestId('audio-status')).toHaveTextContent('Ready')
    expect(led(app, 'piano-type-clav')).toBe('on')
    expect(oled(app, 'model')).toBe('Synth Clav Neck PU')
  })

  it('a failed layer that is switched off no longer counts against the status', async () => {
    const app = mountApp((fake) => {
      fake.audio.assets = 'missing'
      fake.audio.failingAssets = 'samples/upright/'
    })
    await start(app)
    press(app, 'piano-layer-b')
    press(app, 'piano-type')
    await app.settle()
    expect(oled(app, 'layers')).toBe('PIANO A:GRAND  B:UPRIGHT<')
    expect(app.getByTestId('audio-status')).toHaveTextContent('Fallback')
    // Layer A is still the real grand; only Layer B is the stand-in.
    expect([kernelOf(app).layerSource(0), kernelOf(app).layerSource(1)]).toEqual(['samples', 'fallback'])
    down(app, 60)
    render(app, 0.1)
    expect(kernelOf(app).describeVoices().map((voice) => voice.sampled)).toEqual([true, false])
    up(app, 60)
    press(app, 'piano-layer-b')
    await app.settle()
    expect(oled(app, 'layers')).toBe('PIANO A:GRAND<  B:OFF')
    expect(app.getByTestId('audio-status')).toHaveTextContent('Ready')
  })

  it('the panel controls keep working on the stand-in voice', async () => {
    const app = mountApp((fake) => void (fake.audio.assets = 'missing'))
    await start(app)
    press(app, 'piano-unison')
    press(app, 'piano-unison')
    press(app, 'piano-unison')
    down(app, 60)
    render(app, 0.1)
    expect(kernelOf(app).describeVoices()).toHaveLength(3)
    up(app, 60)
  })
})
