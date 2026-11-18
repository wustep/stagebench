import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  analyzeChord,
  analyzeRelease,
  analyzeSegment,
  analyzeSustain,
  analyzeTuning,
  detectClicks,
  findClicks,
  findCutsToSilence,
  noteHz,
  summarizeSegments,
  velocityResponse,
} from '../bench/lib/run/audio-analysis.mjs'
import { AUDIO_PLAN_ID, AUDIO_TEST_PLAN, INSTRUMENT_SOURCE, measureAudio, midiBytes } from '../bench/lib/run/audio-measure.mjs'
import { serveDirectory } from '../bench/lib/run/capture.mjs'

const SR = 48000
const FIXTURES = fileURLToPath(new URL('./fixtures/audio-app/', import.meta.url))

// A harmonic tone: amplitudes per harmonic, optional exponential decay (dB/s).
function tone(hz, seconds, { amplitude = 0.3, harmonics = [1, 0.5, 0.25, 0.12, 0.06], decayDbPerSecond = 0, phase = 0, sampleRate = SR } = {}) {
  const samples = new Float32Array(Math.round(seconds * sampleRate))
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate
    let value = 0
    for (let k = 0; k < harmonics.length; k++) value += harmonics[k] * Math.sin(2 * Math.PI * (k + 1) * hz * t + (k + 1) * phase)
    samples[i] = amplitude * value * 10 ** ((-decayDbPerSecond * t) / 20)
  }
  return samples
}

const tuningAt = (samples, note) => analyzeTuning(samples, SR, { onset: 0, off: samples.length, note })

test('the plan is the fixed stagebench-audio-1 sequence', () => {
  assert.equal(AUDIO_TEST_PLAN.id, AUDIO_PLAN_ID)
  assert.equal(AUDIO_TEST_PLAN.segments.length, 21)
  assert.deepEqual(
    AUDIO_TEST_PLAN.segments.filter((segment) => segment.kind === 'tuning' && segment.scored).map((segment) => segment.notes[0]),
    [45, 57, 60, 69, 81],
  )
  assert.deepEqual(midiBytes({ type: 'on', note: 60, velocity: 96 }), [0x90, 60, 96])
  assert.deepEqual(midiBytes({ type: 'off', note: 60 }), [0x80, 60, 64])
  assert.deepEqual(midiBytes({ type: 'cc', controller: 64, value: 127 }), [0xb0, 64, 127])
  assert.ok(Object.isFrozen(AUDIO_TEST_PLAN.segments[0].events[0]))
  assert.match(INSTRUMENT_SOURCE, /requestMIDIAccess/)
})

test('pitch: harmonic tones across the range, a weak fundamental, an octave and a resampling bug', () => {
  for (const note of [33, 45, 60, 81, 93]) {
    const result = tuningAt(tone(noteHz(note), 0.6), note)
    assert.ok(Math.abs(result.cents) < 1, `note ${note}: ${result.cents} cents`)
    assert.equal(result.octaveError, 0)
  }
  // A1 with a fundamental far weaker than its 2nd and 3rd harmonics is still A1.
  const weak = tuningAt(tone(noteHz(33), 0.6, { harmonics: [0.15, 1, 0.7, 0.4, 0.2] }), 33)
  assert.equal(weak.octaveError, 0)
  assert.ok(Math.abs(weak.foldedCents) < 2)
  // An octave error is reported as such, not as 1200 cents of mistuning.
  const octave = tuningAt(tone(noteHz(57), 0.6), 45)
  assert.equal(octave.octaveError, 1)
  assert.ok(Math.abs(octave.foldedCents) < 1)
  // 44.1 kHz samples played at 48 kHz: +147 cents.
  const resampled = tuningAt(tone(noteHz(60) * (48000 / 44100), 0.6), 60)
  assert.ok(Math.abs(resampled.foldedCents - 146.7) < 1, `${resampled.foldedCents}`)
})

test('release: an exponential release is timed and clean', () => {
  const held = tone(220, 1.5, { amplitude: 0.2 })
  const off = SR
  // About 0.2 s to fall 30 dB.
  const tau = 0.2 / Math.log(10 ** 1.5)
  for (let i = off; i < held.length; i++) held[i] *= Math.exp(-(i - off) / SR / tau)
  const clicks = detectClicks(held, SR, 0.05 * SR, held.length)
  const release = analyzeRelease(held, SR, { off, clicks })
  assert.equal(clicks.length, 0)
  assert.ok(Math.abs(release.seconds - 0.2) < 0.015, `${release.seconds}`)
  assert.equal(release.ended, true)
  assert.equal(release.clean, true)
})

test('clicks: hard cutoffs and steps are flagged, a 5 ms fade and an attack are not', () => {
  // Hard cutoff mid-waveform.
  const cut = tone(220, 0.4)
  const cutAt = Math.round(0.2 * SR) + 50
  cut.fill(0, cutAt)
  const cutClicks = detectClicks(cut, SR, 0.05 * SR, cut.length)
  assert.equal(cutClicks.length, 1)
  assert.ok(Math.abs(cutClicks[0].index - cutAt) < 0.002 * SR)

  // A step inside a sustained tone (a bad sample loop).
  const step = tone(220, 0.4)
  for (let i = Math.round(0.2 * SR); i < step.length; i++) step[i] += 0.05
  assert.equal(findClicks(step, SR, 0.05 * SR, step.length).length, 1)

  // A 5 ms linear fade into silence, at several phases: never a click.
  for (const phase of [0, 0.7, 1.4, 2.1, 2.8]) {
    const fade = tone(220, 0.4, { phase })
    const start = Math.round(0.2 * SR)
    for (let i = start; i < fade.length; i++) fade[i] *= Math.max(0, 1 - (i - start) / (0.005 * SR))
    assert.deepEqual(detectClicks(fade, SR, 0.05 * SR, fade.length), [], `phase ${phase}`)
  }

  // A bright high note cut at every phase: d2 alone misses some (the tone's own
  // d2 hides the step), the cut-to-silence rule catches every one.
  const period = Math.round(SR / noteHz(84))
  let d2Misses = 0
  for (let offset = 0; offset < period; offset++) {
    const bright = tone(noteHz(84), 0.3, { amplitude: 0.06 })
    bright.fill(0, Math.round(0.15 * SR) + offset)
    if (findClicks(bright, SR, 0.05 * SR, bright.length).length === 0) d2Misses++
    assert.equal(findCutsToSilence(bright, SR, 0.05 * SR, bright.length).length, 1, `offset ${offset}`)
  }
  assert.ok(d2Misses > 0)

  // A sharp attack (a sine starting at its peak) is excluded: analysis scans
  // from 30 ms after onset. Scanned from the start it would count.
  const attack = new Float32Array(Math.round(0.6 * SR))
  const on = Math.round(0.1 * SR)
  attack.set(tone(220, 0.4, { phase: Math.PI / 2 }), on)
  assert.ok(findClicks(attack, SR, 0, attack.length).length >= 1)
  const segment = analyzeSegment({ id: 'hold-57', kind: 'hold', notes: [57], velocity: 96 }, attack, SR, { start: on, on, off: on + 0.3 * SR })
  assert.equal(segment.sounding, true)
  assert.ok(segment.latencyMs >= 0 && segment.latencyMs <= 5)
  // The tone stops dead at on + 0.4 s: that, and only that, is a click.
  assert.deepEqual(
    segment.clicks.map((click) => click.where),
    ['tail'],
  )
})

test('clicks next to a gap in the tap timeline are the harness, not the app', () => {
  const signal = tone(220, 0.4)
  const gap = [Math.round(0.2 * SR), Math.round(0.2 * SR) + 128]
  signal.fill(0, gap[0], gap[1])
  assert.ok(detectClicks(signal, SR, 0.05 * SR, signal.length).length >= 1)
  assert.deepEqual(detectClicks(signal, SR, 0.05 * SR, signal.length, { gaps: [gap] }), [])
})

test('chord: a 10-tone cluster with one tone missing hears exactly nine', () => {
  const notes = AUDIO_TEST_PLAN.segments.find((segment) => segment.kind === 'chord').notes
  // 57 (A3) is the hard one to miss honestly: its octave sits 2 cents from
  // D3's 3rd harmonic.
  const missing = 57
  const length = Math.round(1.5 * SR)
  const mix = new Float32Array(length)
  for (const note of notes) {
    if (note === missing) continue
    const voice = tone(noteHz(note), 1.5, { amplitude: 0.05, harmonics: [1, 0.5, 0.33, 0.25, 0.2, 0.17, 0.14, 0.12], phase: note })
    for (let i = 0; i < length; i++) mix[i] += voice[i]
  }
  const chord = analyzeChord(mix, SR, { onset: 0, off: length, notes })
  assert.equal(chord.heard, 9)
  assert.equal(chord.notes.find((entry) => entry.note === missing).heard, false)
})

test('velocity: rising steps, inversions and range', () => {
  const response = velocityResponse(
    [-40, -35, -30, -30.2, -31, -20, -19.8, -10].map((db, index) => ({ velocity: 16 * (index + 1), db })),
  )
  // Steps: +5 rise, +5 rise, -0.2 flat, -0.8 inversion, +11 rise, +0.2 flat, +9.8 rise.
  assert.equal(response.risingSteps, 4)
  assert.equal(response.inversions, 1)
  assert.equal(response.steps, 7)
  assert.equal(response.rangeDb, 30)
  assert.equal(velocityResponse([{ velocity: 16, db: null }, { velocity: 32, db: -20 }]).rangeDb, null)
})

test('sustain: a held note passes both checks, a damped one fails the hold', () => {
  const off = Math.round(0.7 * SR)
  const pedalUp = Math.round(2.2 * SR)
  const held = tone(330, 4.2, { amplitude: 0.2, decayDbPerSecond: 6 })
  for (let i = pedalUp; i < held.length; i++) held[i] *= Math.max(0, 1 - (i - pedalUp) / (0.15 * SR))
  const ok = analyzeSustain(held, SR, { off, pedalUp })
  assert.equal(ok.holds, true)
  assert.ok(ok.holdDropDb > 2 && ok.holdDropDb < 5, `${ok.holdDropDb}`)
  assert.equal(ok.releases, true)

  const damped = tone(330, 4.2, { amplitude: 0.2, decayDbPerSecond: 6 })
  for (let i = off; i < damped.length; i++) damped[i] *= Math.max(0, 1 - (i - off) / (0.15 * SR))
  const bad = analyzeSustain(damped, SR, { off, pedalUp })
  assert.equal(bad.holds, false)
  // Nothing left before pedal-up counts as released.
  assert.equal(bad.releases, true)

  // A note that rings on after pedal-up does not release.
  const ringing = analyzeSustain(tone(330, 4.2, { amplitude: 0.2, decayDbPerSecond: 3 }), SR, { off, pedalUp })
  assert.equal(ringing.releases, false)
})

test('summary: tuning error caps each note at 100 cents and only counts the scored notes', () => {
  const tuningSegment = (note, foldedCents, scored) => ({ id: `tuning-${note}`, kind: 'tuning', note, scored, sounding: true, foldedCents, latencyMs: 0, clicks: [] })
  const segments = [tuningSegment(33, 300, false), tuningSegment(45, 2, true), tuningSegment(57, -4, true), tuningSegment(60, 400, true), tuningSegment(69, null, true)]
  const { summary, scores } = summarizeSegments(segments, { sampleRate: SR, contextsWithSignal: 2, clippedFrames: 480 })
  // (2 + 4 + 100) / 3: the unmeasurable note is left out, not counted as 0.
  assert.equal(scores.tuningErrorCents, 35.3)
  assert.equal(summary.tuningNotesMeasured, 3)
  assert.equal(scores.extraAudioContexts, 1)
  assert.equal(scores.clippedMs, 10)
  assert.equal(scores.sustainChecksPassed, null)
})

test('measureAudio drives fixture apps in Chromium', { timeout: 240_000 }, async (t) => {
  let chromium
  try {
    ;({ chromium } = await import('playwright'))
    const probe = await chromium.launch({ headless: true })
    await probe.close()
  } catch {
    t.skip('no Chromium')
    return
  }
  const server = await serveDirectory(FIXTURES)
  try {
    const options = { chromium, phase: 1, timeScale: 0.4, midiWaitMs: 3000 }
    const [good, bad, silent] = await Promise.all([
      measureAudio({ ...options, url: `${server.url}good.html` }),
      measureAudio({ ...options, url: `${server.url}bad.html` }),
      measureAudio({ ...options, url: `${server.url}silent.html` }),
    ])

    await t.test('a well-behaved instrument measures clean', () => {
      assert.equal(good.status, 'measured', JSON.stringify(good.failure))
      assert.equal(good.environment.tap, 'audio-worklet')
      assert.equal(good.environment.midi.listeners, 1)
      const scores = good.scores
      assert.equal(scores.notesSounding, scores.notesTotal)
      assert.ok(scores.tuningErrorCents < 5, `${scores.tuningErrorCents}`)
      assert.equal(scores.velocityRisingSteps, 7)
      assert.ok(scores.velocityRangeDb >= 15, `${scores.velocityRangeDb}`)
      assert.equal(scores.releasesClean, 3)
      assert.equal(scores.clicks, 0, JSON.stringify(good.summary.clicks))
      assert.equal(scores.sustainChecksPassed, 2)
      assert.ok(scores.chordTonesHeard >= 9)
      assert.ok(scores.latencyMs < 30)
      assert.equal(scores.extraAudioContexts, 0)
    })

    await t.test('a faulty instrument shows each fault', () => {
      assert.equal(bad.status, 'measured', JSON.stringify(bad.failure))
      const scores = bad.scores
      assert.ok(scores.tuningErrorCents > 50)
      assert.ok(bad.summary.tuning.filter((entry) => entry.scored).every((entry) => Math.abs(entry.foldedCents - 146.7) < 3))
      assert.ok(scores.velocityRangeDb < 3)
      // Every release is a hard stop. A stop that lands where a low note's
      // waveform and slope are both near zero is physically almost silent
      // and can escape both click rules (about 1% for note 40), so allow one.
      assert.ok(scores.releasesClean <= 1, JSON.stringify(bad.summary.release))
      assert.ok(bad.summary.release.filter((entry) => entry.note !== 40).every((entry) => !entry.clean))
      assert.ok(scores.clicks >= 1)
      assert.equal(bad.summary.sustain.holds, false)
    })

    await t.test('an app that never asks for MIDI fails as no-midi', () => {
      assert.equal(silent.status, 'failed')
      assert.equal(silent.failure.kind, 'no-midi')
      assert.equal(silent.scores, null)
      assert.equal(silent.environment.midi.requested, 0)
    })

    await t.test('the tap mirrors connect and every disconnect form', async () => {
      const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
      try {
        const context = await browser.newContext()
        await context.addInitScript(INSTRUMENT_SOURCE)
        const page = await context.newPage()
        await page.goto(`${server.url}silent.html`)
        const levels = await page.evaluate(async () => {
          const audio = window.__stagebenchAudio
          const ctx = new AudioContext()
          const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
          const osc = new OscillatorNode(ctx, { frequency: 440 })
          const gain = new GainNode(ctx, { gain: 0.25 })
          osc.connect(gain)
          osc.start()
          // The page made its own context first; find this one's tap and wait
          // for its worklet to load.
          const tap = audio.taps.find((entry) => entry.context === ctx)
          while (!tap.kind) await wait(20)
          const level = async () => {
            await wait(250)
            const now = Math.round(ctx.currentTime * ctx.sampleRate)
            await audio.waitForFrames([now], 1000)
            const stats = audio.windowStats(tap.index, now - 4800, now)
            return Math.sqrt(stats.energy / 4800)
          }
          const out = {}
          out.unconnected = await level()
          gain.connect(ctx.destination)
          out.connected = await level()
          gain.disconnect(ctx.destination)
          out.afterDisconnectDestination = await level()
          gain.connect(ctx.destination)
          gain.disconnect()
          out.afterDisconnectAll = await level()
          gain.connect(ctx.destination)
          gain.disconnect(0)
          out.afterDisconnectOutput = await level()
          const stream = ctx.createMediaStreamDestination()
          gain.connect(ctx.destination)
          gain.connect(stream)
          gain.disconnect(ctx.destination, 0, 0)
          out.stillToStream = await level()
          gain.disconnect(stream)
          out.afterDisconnectStream = await level()
          out.destinationIsReal = ctx.destination instanceof AudioDestinationNode
          out.kind = tap.kind
          return out
        })
        assert.equal(levels.kind, 'audio-worklet')
        assert.ok(levels.connected > 0.1, JSON.stringify(levels))
        assert.ok(levels.stillToStream > 0.1, JSON.stringify(levels))
        for (const key of ['unconnected', 'afterDisconnectDestination', 'afterDisconnectAll', 'afterDisconnectOutput', 'afterDisconnectStream']) {
          assert.ok(levels[key] < 1e-3, `${key}: ${JSON.stringify(levels)}`)
        }
        assert.equal(levels.destinationIsReal, true)
      } finally {
        await browser.close()
      }
    })
  } finally {
    await server.close()
  }
})
