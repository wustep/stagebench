/**
 * piano.fallback — Real-module tests for the audio fallback path.
 *
 * Imports the REAL AudioContextProvider and PianoEngine (via the tsx loader)
 * and exercises the genuine degraded / fallback code:
 *   - When window.AudioContext is unavailable, create() still yields a usable
 *     provider object (does not crash) that reports a not-running fallback state.
 *   - When the AudioContext constructor throws, getContext() surfaces the
 *     LABELED "AudioContext not available in this environment" error.
 *   - An injected offline context is correctly labeled via isOffline().
 *   - The PianoEngine remains a valid, non-initialized object when audio is
 *     unavailable (still playable at the API level, no throw on construction).
 */

import { test } from 'node:test'
import { strictEqual, ok, throws } from 'node:assert'

import { AudioContextProvider } from '../src/audio/audioContext.ts'
import { PianoEngine } from '../src/audio/pianoEngine.ts'

/** Run `fn` with globalThis.window swapped, always restoring afterward. */
function withWindow(windowValue, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'window')
  const previous = globalThis.window
  if (windowValue === undefined) {
    delete globalThis.window
  } else {
    globalThis.window = windowValue
  }
  try {
    return fn()
  } finally {
    if (had) {
      globalThis.window = previous
    } else {
      delete globalThis.window
    }
  }
}

test('piano.fallback: create() without window.AudioContext yields a usable, not-running provider', () => {
  withWindow(undefined, () => {
    const provider = AudioContextProvider.create()
    ok(provider instanceof AudioContextProvider, 'a provider object is still returned (no crash)')
    // Fallback / degraded state: no live context, so it is not "running" and not offline-render.
    strictEqual(provider.isRunning(), false, 'fallback provider reports not-running')
    strictEqual(provider.isOffline(), false, 'fallback provider is labeled as non-offline (live-mode intent)')
  })
})

test('piano.fallback: getContext() throws a LABELED error when AudioContext is unavailable', () => {
  withWindow(undefined, () => {
    const provider = AudioContextProvider.create()
    // The labeled fallback signal used by callers to detect the unusable state.
    throws(
      () => provider.getContext(),
      /AudioContext not available in this environment/,
      'unavailable audio is reported via a clearly labeled error'
    )
  })
})

test('piano.fallback: a throwing AudioContext constructor is surfaced, not swallowed', () => {
  // Simulate a browser where AudioContext exists but construction fails
  // (e.g. blocked by autoplay policy / sandbox). create() attempts construction.
  const FailingAudioContext = function FailingAudioContext() {
    throw new Error('AudioContext construction blocked')
  }
  withWindow({ AudioContext: FailingAudioContext }, () => {
    throws(
      () => AudioContextProvider.create(),
      /AudioContext construction blocked/,
      'a failing constructor surfaces so the app can fall back'
    )
  })
})

test('piano.fallback: an injected offline context is labeled via isOffline()', () => {
  // OfflineAudioContext is available in this Node/undici runtime.
  if (typeof OfflineAudioContext === 'undefined') {
    ok(true, 'OfflineAudioContext unavailable in this runtime; skip labeling assertion')
    return
  }
  const offline = new OfflineAudioContext(2, 44100, 44100)
  const provider = new AudioContextProvider(offline)
  strictEqual(provider.isOffline(), true, 'offline context is labeled offline')
  strictEqual(provider.getContext(), offline, 'getContext() returns the injected offline context')
})

test('piano.fallback: an injected, constructed context that is not running reports a degraded state', () => {
  // The AudioContextProvider constructor tests `context instanceof OfflineAudioContext`,
  // so we can only inject a real context where that global exists (browser / undici).
  if (typeof OfflineAudioContext === 'undefined') {
    ok(true, 'OfflineAudioContext unavailable in this runtime; skip injected-context assertion')
    return
  }
  // A freshly-created offline context is "suspended" (not running) until rendering.
  const offline = new OfflineAudioContext(2, 44100, 44100)
  const provider = new AudioContextProvider(offline)
  strictEqual(provider.isRunning(), false, 'a suspended/not-yet-running context reports not-running')
  strictEqual(provider.getContext(), offline, 'the injected context is still usable/returned')
})

test('piano.fallback: PianoEngine constructs and stays uninitialized when audio is unavailable', () => {
  withWindow(undefined, () => {
    // Constructing the engine must never throw even with no Web Audio available.
    const engine = new PianoEngine({ maxVoices: 8, masterVolume: 0.8, reverbWet: 0.3 })
    ok(engine, 'engine constructed in fallback environment')
    strictEqual(engine.isInitialized(), false, 'engine reports not-initialized until a context is provided')

    // Note events are safely ignored (no throw) before initialization — the API
    // stays "playable" (callable) even in the degraded/fallback state.
    engine.noteOn(60, 0.8, 'fallback-1')
    engine.noteOff('fallback-1')
    engine.allNotesOff()
    // Control setters remain clamped and safe with no live graph.
    engine.setMasterVolume(2)
    engine.setReverb(-1)
    ok(true, 'engine API remains callable without throwing in fallback mode')

    engine.dispose()
  })
})

test('piano.fallback: initialize() rejects cleanly when the provider has no context', async () => {
  await withWindow(undefined, async () => {
    const engine = new PianoEngine({ maxVoices: 4 })
    const provider = AudioContextProvider.create() // lazy, no live context

    let threw = false
    try {
      await engine.initialize(provider) // getContext() will throw the labeled error
    } catch (err) {
      threw = true
      ok(/AudioContext not available/.test(String(err.message)), 'initialize surfaces the labeled fallback error')
    }
    strictEqual(threw, true, 'initialize does not silently succeed without audio')
    strictEqual(engine.isInitialized(), false, 'engine remains uninitialized after a failed init')
  })
})
