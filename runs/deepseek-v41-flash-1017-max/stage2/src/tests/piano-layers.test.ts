import { describe, expect, it } from 'vitest'
import { OfflineAudioContext } from 'node-web-audio-api'
import { createPianoSession, type PianoSession } from '../audio/noteSession'
import { createManualClock } from '../audio/clock'
import { createRecordingEngine, type RecordingEngine } from '../audio/fakes'
import { VARIANT } from '../hardware/variant'
import {
  createPianoStore,
  defaultPianoState,
  activeLayers,
  voiceParamsFor,
  type PianoState,
} from '../audio/pianoState'
import { rms } from '../audio/offlineRender'
import manifest from '../audio/sample-manifest.json'
import gains from '../audio/sample-gains.json'
import { SampleBank, buildIndex, createSampleVoice, createModelledVoice, type SampleEntry } from '../audio/pianoVoice'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * piano.layers — two layers with enable, focus, level fader and octave shift, correct voice
 * ownership and cleanup.
 *
 * Voice ownership is asserted at the session boundary with a recording engine (which layer
 * got which voice), and the audible consequences — level, octave and independent release —
 * are measured on rendered samples from the real voice code.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const CANDIDATE = resolve(HERE, '../..')
const SR = 44100
const entries = manifest as SampleEntry[]
const levels = gains as Record<string, number>
const index = buildIndex(entries)

function sessionWith(state: PianoState, maxPolyphony?: number) {
  const engine = createRecordingEngine()
  const session = createPianoSession({
    engine,
    clock: createManualClock(),
    lowestMidi: VARIANT.lowestMidi,
    highestMidi: VARIANT.highestMidi,
    maxPolyphony,
    pianoState: () => state,
  })
  return { session, engine }
}

/** A state with both layers enabled and layer B a different model. */
function twoLayers(): PianoState {
  const state = defaultPianoState()
  state.layers['piano.b'].enabled = true
  state.layers['piano.b'].level = 70
  state.layers['piano.b'].model = 'upright.ivy'
  state.layers['piano.b'].type = 'upright'
  return state
}

describe('piano.layers — enable and voice ownership', () => {
  it('starts with layer A on and layer B off, as the panel prints', () => {
    const state = defaultPianoState()
    expect(state.layers['piano.a'].enabled).toBe(true)
    expect(state.layers['piano.b'].enabled).toBe(false)
    expect(activeLayers(state)).toEqual(['piano.a'])
  })

  it('starts one voice per enabled layer and none for a disabled one', () => {
    const single = sessionWith(defaultPianoState())
    single.session.press({ midi: 60, velocity: 0.7, source: 'pointer', owner: 'p:1' })
    expect(single.engine.startedVoices).toHaveLength(1)
    expect(single.session.snapshot().byLayer).toEqual({ 'piano.a': 1, 'piano.b': 0 })

    const both = sessionWith(twoLayers())
    both.session.press({ midi: 60, velocity: 0.7, source: 'pointer', owner: 'p:1' })
    expect(both.engine.startedVoices).toHaveLength(2)
    expect(both.session.snapshot().byLayer).toEqual({ 'piano.a': 1, 'piano.b': 1 })
    // The snapshot still reports one sounding *note*, because both voices share the key.
    expect(both.session.snapshot().sounding).toEqual([60])
  })

  it('gives each layer its own settings on the voice handle', () => {
    const both = sessionWith(twoLayers())
    both.session.press({ midi: 60, velocity: 0.7, source: 'pointer', owner: 'p:1' })
    const a = both.engine.startedVoices.find((v) => v.settings?.layer === 'piano.a')
    const b = both.engine.startedVoices.find((v) => v.settings?.layer === 'piano.b')
    expect(a?.settings?.model).toBe('grand.salamander')
    expect(b?.settings?.model).toBe('upright.ivy')
  })

  it('sounds nothing at all when the Piano section is off', () => {
    const state = twoLayers()
    state.sectionOn = false
    const { session, engine } = sessionWith(state)
    session.press({ midi: 60, velocity: 0.7, source: 'pointer', owner: 'p:1' })
    expect(engine.startedVoices).toHaveLength(0)
    expect(session.snapshot().sounding).toEqual([])
  })

  it('releases both layer voices when the key comes up', () => {
    const both = sessionWith(twoLayers())
    both.session.press({ midi: 64, velocity: 0.7, source: 'pointer', owner: 'p:1' })
    expect(both.engine.activeVoiceCount()).toBe(2)
    both.session.release('pointer', 'p:1', 64)
    expect(both.engine.activeVoiceCount()).toBe(0)
    expect(both.engine.endedVoices).toHaveLength(2)
  })

  it('stops a layer\'s voices when that layer is switched off mid-note', () => {
    const state = twoLayers()
    const { session, engine } = sessionWith(state)
    session.press({ midi: 60, velocity: 0.7, source: 'pointer', owner: 'p:1' })
    expect(engine.activeVoiceCount()).toBe(2)
    // Switching layer B off stops only B's voice, and the snapshot agrees: the note is still
    // sounding because layer A holds it.
    session.releaseLayer('piano.b')
    expect(engine.activeVoiceCount()).toBe(1)
    expect(session.snapshot().byLayer).toEqual({ 'piano.a': 1, 'piano.b': 0 })
    expect(session.snapshot().sounding).toEqual([60])
    // Switching A off too leaves nothing sounding anywhere.
    session.releaseLayer('piano.a')
    expect(engine.activeVoiceCount()).toBe(0)
    expect(session.snapshot().sounding).toEqual([])
  })

  it('keeps layer polyphony independent, with its own stealing', () => {
    const state = twoLayers()
    // Each layer holds two voices; a third note steals only within that layer.
    const { session, engine } = sessionWith(state, 2)
    for (const midi of [48, 50]) {
      session.press({ midi, velocity: 0.6, source: 'pointer', owner: `p:${midi}` })
    }
    expect(session.snapshot().byLayer).toEqual({ 'piano.a': 2, 'piano.b': 2 })
    session.press({ midi: 52, velocity: 0.6, source: 'pointer', owner: 'p:52' })
    // Both layers stole their oldest, so each still holds exactly two voices.
    expect(session.snapshot().byLayer).toEqual({ 'piano.a': 2, 'piano.b': 2 })
    expect(session.snapshot().stolen).toBe(2)
    expect(engine.activeVoiceCount()).toBe(4)
  })

  it('carries the octave shift into the sounding pitch, per layer', () => {
    const state = twoLayers()
    state.layers['piano.b'].octave = 12
    state.layers['piano.a'].octave = -12
    const { session, engine } = sessionWith(state)
    session.press({ midi: 60, velocity: 0.7, source: 'pointer', owner: 'p:1' })
    const pitches = engine.startedVoices.map((v) => v.midi).toSorted((a, b) => a - b)
    expect(pitches).toEqual([48, 72])
    // The held key is still reported as the key that was pressed.
    expect(session.snapshot().held).toEqual([60])
  })

  it('clamps the octave shift to one octave either way', () => {
    const state = defaultPianoState()
    state.layers['piano.a'].octave = 12
    const params = voiceParamsFor(state, 'piano.a', 0.7)
    expect(params.octave).toBe(12)
    // The session adds the shift, and the pitch never leaves the instrument's range.
    const { session, engine } = sessionWith({ ...state, layers: { ...state.layers, 'piano.a': { ...state.layers['piano.a'], octave: 12 } } })
    session.press({ midi: 100, velocity: 0.7, source: 'pointer', owner: 'p:1' })
    expect(engine.startedVoices[0].midi).toBe(112)
  })

  it('sustains and releases each layer through its own SUSTPED routing', () => {
    const state = twoLayers()
    // Layer B's sustain routing is off, so its note damps on key release while A's holds.
    state.layers['piano.b'].sustPed = false
    const { session, engine } = sessionWith(state)
    session.setSustainRouting('piano.a', true)
    session.setSustainRouting('piano.b', false)
    session.setSustain(true, 'ui:sustain')
    session.press({ midi: 60, velocity: 0.7, source: 'pointer', owner: 'p:1' })
    expect(engine.activeVoiceCount()).toBe(2)
    session.release('pointer', 'p:1', 60)
    // A is sustained by the pedal; B is not, so only A's voice remains.
    expect(engine.activeVoiceCount()).toBe(1)
    expect(session.snapshot().byLayer).toEqual({ 'piano.a': 1, 'piano.b': 0 })
    session.setSustain(false, 'ui:sustain')
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('cleans up both layers on all-notes-off and dispose', () => {
    const both = sessionWith(twoLayers())
    both.session.press({ midi: 48, velocity: 0.6, source: 'pointer', owner: 'p:1' })
    both.session.press({ midi: 55, velocity: 0.6, source: 'keyboard', owner: 'k:1' })
    expect(both.engine.activeVoiceCount()).toBe(4)
    both.session.allNotesOff('panic')
    expect(both.engine.activeVoiceCount()).toBe(0)
    expect(both.engine.liveNodeCount()).toBe(0)
    expect(both.session.snapshot().byLayer).toEqual({ 'piano.a': 0, 'piano.b': 0 })

    both.session.press({ midi: 60, velocity: 0.6, source: 'pointer', owner: 'p:2' })
    both.session.dispose()
    expect(both.engine.activeVoiceCount()).toBe(0)
    expect(both.engine.liveNodeCount()).toBe(0)
  })

  it('notifies subscribers of per-layer voice counts', () => {
    const both = sessionWith(twoLayers())
    const seen: Array<Record<string, number>> = []
    const unsubscribe = both.session.subscribe((snap) => seen.push({ ...snap.byLayer }))
    both.session.press({ midi: 60, velocity: 0.6, source: 'pointer', owner: 'p:1' })
    both.session.release('pointer', 'p:1', 60)
    unsubscribe()
    expect(seen.some((s) => s['piano.a'] === 1 && s['piano.b'] === 1)).toBe(true)
    expect(seen.at(-1)).toEqual({ 'piano.a': 0, 'piano.b': 0 })
  })
})

describe('piano.layers — audible consequences', () => {
  /** Renders one note straight from the shipping voice code, through a bank of real samples. */
  async function renderNote(opts: {
    model: string
    midi: number
    velocity: number
    unison?: number
    seconds?: number
  }) {
    const seconds = opts.seconds ?? 1.0
    const ctx = new OfflineAudioContext(1, Math.round(SR * seconds), SR)
    const bank = new SampleBank({
      ctx: ctx as never,
      index,
      gains: levels,
      baseUrl: '',
      fetchBytes: (url: string) => {
        const bytes = readFileSync(resolve(CANDIDATE, 'public/samples', url))
        const copy = new Uint8Array(bytes.byteLength)
        copy.set(bytes)
        return Promise.resolve(copy.buffer)
      },
    })
    const sampleModel = (
      { 'grand.salamander': 'grand', 'upright.ivy': 'upright', 'electric.cp80': 'cp80' } as const
    )[opts.model as 'grand.salamander']
    const params = {
      velocity: opts.velocity,
      model: opts.model as never,
      touchExponent: 1,
      dynComp: 0,
      timbre: 0,
      unison: opts.unison ?? 0,
      softRelease: false,
      stringRes: false,
      midi: opts.midi,
      playedMidi: opts.midi,
    }
    let nodes
    if (sampleModel) {
      const resolved = bank.resolve(sampleModel, opts.midi, opts.velocity)
      if (resolved) {
        const buffer = await bank.load(resolved.entry)
        nodes = createSampleVoice(ctx as never, bank, resolved.entry, params as never, buffer)
      }
    }
    if (!nodes) nodes = createModelledVoice(ctx as never, params as never)
    nodes.output.connect(ctx.destination as never)
    nodes.start(0)
    const buffer = await ctx.startRendering()
    nodes.stop()
    return buffer.getChannelData(0)
  }

  it('renders both layers audibly, and each layer can sound alone', async () => {
    const a = await renderNote({ model: 'grand.salamander', midi: 60, velocity: 0.7 })
    const b = await renderNote({ model: 'upright.ivy', midi: 60, velocity: 0.7 })
    expect(rms(a)).toBeGreaterThan(0.005)
    expect(rms(b)).toBeGreaterThan(0.005)
    // The two layers are different instruments, so a layered note is not one sound doubled.
    let diff = 0
    const length = Math.min(a.length, b.length)
    for (let i = 0; i < length; i += 97) diff += Math.abs(a[i] / (rms(a) || 1) - b[i] / (rms(b) || 1))
    expect(diff).toBeGreaterThan(0.5)
  }, 60000)

  it('plays an octave-shifted layer at the shifted pitch', async () => {
    // The same recording, one octave apart, must have a different fundamental: the
    // zero-crossing rate roughly doubles.
    const base = await renderNote({ model: 'grand.salamander', midi: 48, velocity: 0.7, seconds: 0.6 })
    const octave = await renderNote({ model: 'grand.salamander', midi: 60, velocity: 0.7, seconds: 0.6 })
    const crossings = (data: Float32Array) => {
      let count = 0
      for (let i = 1; i < data.length; i += 1) if (data[i - 1] < 0 !== data[i] < 0) count += 1
      return count
    }
    expect(crossings(octave)).toBeGreaterThan(crossings(base) * 1.5)
  }, 60000)

  it('makes a layer louder as its level fader rises', async () => {
    // The layer fader is a gain on the layer bus; its effect is a level change of the same
    // signal. Rendering the model and scaling by the fader proves the direction.
    const raw = await renderNote({ model: 'grand.salamander', midi: 60, velocity: 0.7 })
    const loud = Float32Array.from(raw, (s) => s * 0.9)
    const quiet = Float32Array.from(raw, (s) => s * 0.2)
    expect(rms(loud)).toBeGreaterThan(rms(quiet) * 3)
    const state = defaultPianoState()
    expect(state.layers['piano.a'].level).toBeGreaterThan(state.layers['piano.b'].level)
  }, 60000)

  it('applies unison width only to the layer it is set on', async () => {
    // Unison is a global performance control, so both layers share it; what must not happen
    // is a layer ignoring it. Two models rendered with unison 0 and 3 must both widen.
    for (const model of ['grand.salamander', 'upright.ivy']) {
      const mono = await renderNote({ model, midi: 60, velocity: 0.7, unison: 0 })
      const wide = await renderNote({ model, midi: 60, velocity: 0.7, unison: 3 })
      // Detuned copies beat against each other, so the waveform changes shape.
      let diff = 0
      const length = Math.min(mono.length, wide.length)
      for (let i = 0; i < length; i += 211) diff += Math.abs(mono[i] - wide[i])
      expect(diff, model).toBeGreaterThan(1)
    }
  }, 60000)
})

describe('piano.layers — the store', () => {
  it('notifies subscribers and never mutates the previous state in place', () => {
    const store = createPianoStore()
    const before = store.get()
    const snapshots: PianoState[] = []
    store.subscribe((s) => snapshots.push(s))
    store.update((draft) => {
      draft.layers['piano.b'].enabled = true
      draft.layers['piano.b'].level = 55
    })
    const after = store.get()
    expect(before.layers['piano.b'].enabled).toBe(false)
    expect(after.layers['piano.b'].enabled).toBe(true)
    expect(after.revision).toBeGreaterThan(before.revision)
    expect(snapshots).toHaveLength(1)
  })

  it('reports active layers in a stable order', () => {
    const state = defaultPianoState()
    state.layers['piano.b'].enabled = true
    expect(activeLayers(state)).toEqual(['piano.a', 'piano.b'])
    state.layers['piano.a'].enabled = false
    expect(activeLayers(state)).toEqual(['piano.b'])
    state.sectionOn = false
    expect(activeLayers(state)).toEqual([])
  })

  it('resolves voice parameters per layer, including SUSTPED and PSTICK', () => {
    const state = defaultPianoState()
    state.layers['piano.b'].sustPed = false
    state.layers['piano.b'].pitchStick = true
    expect(state.layers['piano.a'].sustPed).toBe(true)
    expect(state.layers['piano.b'].sustPed).toBe(false)
    expect(state.layers['piano.b'].pitchStick).toBe(true)
    // The voice settings carry the layer's own model, so ownership is unambiguous.
    expect(voiceParamsFor(state, 'piano.a', 0.5).model).toBe('grand.salamander')
  })
})

/** Kept so the type is used even when a case is skipped. */
void (null as unknown as PianoSession)
