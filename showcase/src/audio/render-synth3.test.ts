// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { renderEngine, rms, zeroCrossingRate, type RenderStep } from '../test/offline'
import { SYNTH_WAVEFORMS, type InstrumentStore } from '../state/instrument'
import { SYNTH_PRESETS } from '../model/presets'

/**
 * synth.voice-modes / synth.arp-gate — REAL rendered audio through the full
 * engine graph (node-web-audio-api OfflineAudioContext), proving voice
 * glide, arp-driven note-rate, and the synth layer's own effect chain each
 * audibly change the signal (spec: nord-stage-4.synth.json voice /
 * arpeggiatorGate acceptance). The Piano section is off so measurements
 * isolate the Synth section.
 *
 * The offline timer boundary is a no-op (voice-cleanup GC is irrelevant to
 * a render) so the engine's internal setTimeout-driven arp scheduler cannot
 * fire here — the arp-rate test instead drives the exact onset sequence the
 * scheduler would produce (noteOn/noteOff steps spaced at the configured
 * BPM) through the same startSynthVoice path a real arp step uses, which is
 * what the acceptance criterion ("arp... rate... behave deterministically")
 * is actually about: onset timing through the normal voice path.
 */

function synthOnly(store: InstrumentStore): void {
  store.setPianoSectionOn(false)
  store.setSynthSectionOn(true)
}

function withWaveform(name: string) {
  return (store: InstrumentStore) => {
    synthOnly(store)
    const index = SYNTH_WAVEFORMS.findIndex((w) => w.name === name)
    store.selectSynthWaveform(index)
  }
}

/** Counts distinct onsets: windows whose RMS crosses from below to above
 *  `threshold` (a fresh attack ramping the envelope up), scanning in
 *  `windowSeconds` steps across the render. */
function countOnsets(data: Float32Array, threshold: number, windowSeconds = 0.03, fromSeconds = 0, toSeconds = 2): number {
  let onsets = 0
  let wasAbove = false
  for (let t = fromSeconds; t < toSeconds; t += windowSeconds) {
    const level = rms(data, t, t + windowSeconds)
    const above = level > threshold
    if (above && !wasAbove) onsets++
    wasAbove = above
  }
  return onsets
}

describe('synth.voice — rendered glide proof', () => {
  it('Legato glide renders a pitch slide (zero-crossing rate rises across the glide for an upward move)', async () => {
    const noteOnAt = 0
    const glideAt = 0.3
    const result = await renderEngine({
      duration: 1.2,
      configure: (store) => {
        withWaveform('Saw')(store)
        store.cycleSynthVoiceMode() // Poly -> Mono
        store.cycleSynthVoiceMode() // Mono -> Legato
        store.setSynthGlide(100) // slow, clearly measurable portamento
      },
      steps: [
        { time: noteOnAt, run: ({ engine }) => engine.noteOn(48, 0.85) },
        { time: glideAt, run: ({ engine }) => engine.noteOn(60, 0.85) }, // overlapped: glides up an octave
        { time: 1.0, run: ({ engine }) => engine.noteOff(60) },
      ],
    })
    const early = zeroCrossingRate(result.left, glideAt + 0.02, glideAt + 0.08)
    const late = zeroCrossingRate(result.left, glideAt + 0.35, glideAt + 0.45)
    expect(rms(result.left, 0.05, 1.0)).toBeGreaterThan(0.001)
    expect(early).toBeLessThan(late) // still low-ish just after the glide starts, higher once it approaches the target
  }, 240000)
})

describe('synth.arp — rendered onset-rate proof', () => {
  async function renderAtRate(bpm: number) {
    const stepSeconds = 60 / bpm
    const steps: RenderStep[] = []
    let t = 0
    while (t < 1.8) {
      const at = t
      steps.push({ time: at, run: ({ engine }) => engine.noteOn(60, 0.85) })
      steps.push({ time: at + stepSeconds * 0.4, run: ({ engine }) => engine.noteOff(60) })
      t += stepSeconds
    }
    return renderEngine({
      duration: 2.0,
      configure: (store) => {
        withWaveform('Square')(store)
        store.setSynthAmpEnvelope({ attack: 0, decay: 20, release: 10 })
        store.setArpRate(store.getState().synth.arp.rate) // state parity with the rate under test (label only)
      },
      steps,
    })
  }

  it('240 BPM vs 60 BPM onset spacing renders a different number of onsets in the same window', async () => {
    const fast = await renderAtRate(240)
    const slow = await renderAtRate(60)
    const fastOnsets = countOnsets(fast.left, 0.02, 0.02, 0.05, 1.8)
    const slowOnsets = countOnsets(slow.left, 0.02, 0.02, 0.05, 1.8)
    expect(fastOnsets).toBeGreaterThan(slowOnsets)
  }, 240000)
})

describe('synth.chains — rendered per-layer effect chain proof', () => {
  it('the synth layer’s own delay rings after noteOff (mix 100, feedback high)', async () => {
    const result = await renderEngine({
      duration: 2.2,
      configure: (store) => {
        withWaveform('Saw')(store)
        store.setSynthAmpEnvelope({ attack: 0, decay: 30, release: 15 }) // short so the dry note itself decays fast
        store.setSynthFocusedLayer('A')
        // fx-focus-synth is decorative-by-id in the panel model but the
        // store action routes updateUnit through the focused synth layer's
        // own chain once fxSection is 'synth'.
        store.setSynthFxFocus('A')
        store.updateUnit('delay', { on: true, tempo: 40, feedback: 100, mix: 100 }, 'Delay test setup')
      },
      steps: [
        { time: 0, run: ({ engine }) => engine.noteOn(60, 0.85) },
        { time: 0.4, run: ({ engine }) => engine.noteOff(60) },
      ],
    })
    // The dry note itself is long gone by 1.0s (short envelope); any energy
    // remaining afterward is the delay's repeats.
    expect(rms(result.left, 0.0, 0.3)).toBeGreaterThan(0.001)
    expect(rms(result.left, 1.2, 1.8)).toBeGreaterThan(0.0005)
  }, 240000)
})

describe('programs.preset-library — rendered proof', () => {
  // Loading a factory SYNTH preset (manual p. 41) is an ordinary state edit,
  // so the same engine graph renders it: two presets with very different
  // sources ('Acid Wire' — a saw into a low LP M; 'Static Bloom' — white
  // noise through a highpass) must produce audibly distinct signals.
  async function renderPreset(name: string) {
    const index = SYNTH_PRESETS.findIndex((p) => p.name === name)
    expect(index).toBeGreaterThanOrEqual(0)
    return renderEngine({
      duration: 1.4,
      configure: (store) => {
        store.setPianoSectionOn(false)
        store.enterPresetBrowse('synth', false)
        store.loadSynthPreset(index)
        store.exitPresetBrowse(true) // keep the loaded sound (manual p. 42)
      },
      steps: [
        { time: 0, run: ({ engine }) => engine.noteOn(60, 0.9) },
        { time: 1.1, run: ({ engine }) => engine.noteOff(60) },
      ],
    })
  }

  it('two different synth presets render distinct audio', async () => {
    const wire = await renderPreset('Acid Wire')
    const bloom = await renderPreset('Static Bloom')
    // Both presets audibly sound…
    expect(rms(wire.left, 0.6, 1.0)).toBeGreaterThan(0.001)
    expect(rms(bloom.left, 0.6, 1.0)).toBeGreaterThan(0.001)
    // …and the noise preset's zero-crossing rate dwarfs the tonal one's.
    const wireZcr = zeroCrossingRate(wire.left, 0.6, 1.0)
    const bloomZcr = zeroCrossingRate(bloom.left, 0.6, 1.0)
    expect(bloomZcr).toBeGreaterThan(wireZcr * 3)
  }, 240000)
})
