import { describe, expect, it, vi } from 'vitest'
import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  Clock,
  DynamicsCompressorNodeLike,
  GainNodeLike,
  OscillatorNodeLike,
  PianoEngineStatusSnapshot,
  PianoVoiceBackend,
  TimerHandle,
} from '../audio/boundaries'
import { NoteLifecycleController } from '../audio/noteLifecycle'
import { measureWindowRms, renderPianoSequencePcm } from '../audio/offlineRender'
import { selectSampleForNote, velocityToLayerAndGain } from '../audio/pianoSamples'
import { midiToFrequency, WebAudioPianoEngine } from '../audio/pianoVoice'

function createMockAudioParam(initial = 0): AudioParamLike {
  const param: AudioParamLike = {
    value: initial,
    setValueAtTime(v: number) {
      param.value = v
      return param
    },
    linearRampToValueAtTime(v: number) {
      param.value = v
      return param
    },
    exponentialRampToValueAtTime(v: number) {
      param.value = v
      return param
    },
    setTargetAtTime(v: number) {
      param.value = v
      return param
    },
    cancelScheduledValues() {
      return param
    },
  }
  return param
}

function createFakeAudioContext() {
  let currentTime = 0
  let state: AudioContextState = 'running'
  let createdNodes = 0
  let disconnectedNodes = 0
  const bufferSources: AudioBufferSourceNodeLike[] = []
  const oscillators: OscillatorNodeLike[] = []

  const makeNode = () => {
    createdNodes++
    let disconnected = false
    return {
      connect: vi.fn(),
      disconnect: vi.fn(() => {
        if (!disconnected) {
          disconnected = true
          disconnectedNodes++
        }
      }),
    }
  }

  const ctx: AudioContextLike = {
    get currentTime() {
      return currentTime
    },
    get state() {
      return state
    },
    sampleRate: 44100,
    destination: { connect: vi.fn(), disconnect: vi.fn() },
    resume: vi.fn(async () => {
      state = 'running'
    }),
    close: vi.fn(async () => {
      state = 'closed'
    }),
    createGain: (): GainNodeLike => ({
      ...makeNode(),
      gain: createMockAudioParam(1),
    }),
    createBiquadFilter: (): BiquadFilterNodeLike => ({
      ...makeNode(),
      type: 'lowpass',
      frequency: createMockAudioParam(1000),
      Q: createMockAudioParam(1),
    }),
    createDynamicsCompressor: (): DynamicsCompressorNodeLike => ({
      ...makeNode(),
      threshold: createMockAudioParam(-6),
      knee: createMockAudioParam(12),
      ratio: createMockAudioParam(8),
      attack: createMockAudioParam(0.002),
      release: createMockAudioParam(0.12),
    }),
    createOscillator: (): OscillatorNodeLike => {
      const osc: OscillatorNodeLike = {
        ...makeNode(),
        type: 'sine',
        frequency: createMockAudioParam(440),
        detune: createMockAudioParam(0),
        onended: null,
        start: vi.fn(),
        stop: vi.fn(),
      }
      oscillators.push(osc)
      return osc
    },
    createBufferSource: (): AudioBufferSourceNodeLike => {
      const src: AudioBufferSourceNodeLike = {
        ...makeNode(),
        buffer: null,
        playbackRate: createMockAudioParam(1),
        onended: null,
        start: vi.fn(),
        stop: vi.fn(),
      }
      bufferSources.push(src)
      return src
    },
    decodeAudioData: vi.fn(async (): Promise<AudioBufferLike> => ({
      duration: 4.5,
      length: 44100 * 4.5,
      numberOfChannels: 2,
      sampleRate: 44100,
    })),
  }

  return {
    ctx,
    bufferSources,
    oscillators,
    advanceTime: (sec: number) => {
      currentTime += sec
    },
    getStats: () => ({ createdNodes, disconnectedNodes }),
  }
}

function createManualClock(): { clock: Clock; flushAll: () => void; pendingCount: () => number } {
  let now = 0
  let nextId = 1
  const timers = new Map<number, () => void>()

  const clock: Clock = {
    now: () => now,
    setTimeout: (cb, ms) => {
      const id = nextId++
      now += ms
      timers.set(id, cb)
      return id
    },
    clearTimeout: (id: TimerHandle) => {
      if (typeof id === 'number') {
        timers.delete(id)
      }
    },
  }

  return {
    clock,
    pendingCount: () => timers.size,
    flushAll: () => {
      for (const [id, fn] of Array.from(timers.entries())) {
        timers.delete(id)
        fn()
      }
    },
  }
}

function createRecordingBackend(): {
  backend: PianoVoiceBackend
  triggered: Array<{ voiceId: number; midi: number; velocity: number }>
  released: Array<{ voiceId: number; fastSteal: boolean }>
  stoppedAllCount: () => number
} {
  const triggered: Array<{ voiceId: number; midi: number; velocity: number }> = []
  const released: Array<{ voiceId: number; fastSteal: boolean }> = []
  let stopCount = 0
  const status: PianoEngineStatusSnapshot = {
    status: 'ready',
    loadedSamples: 78,
    totalSamples: 78,
    usingFallback: false,
    message: 'ready',
    audioContextState: 'running',
  }
  const backend: PianoVoiceBackend = {
    unlock: async () => undefined,
    triggerNote: (voiceId, midi, velocity) => triggered.push({ voiceId, midi, velocity }),
    releaseNote: (voiceId, fastSteal = false) => released.push({ voiceId, fastSteal }),
    stopAllImmediate: () => {
      stopCount++
    },
    getActiveNodeCount: () => 0,
    getStatus: () => status,
    subscribeStatus: () => () => undefined,
    dispose: () => undefined,
  }
  return { backend, triggered, released, stoppedAllCount: () => stopCount }
}

describe('piano.basic-note-lifecycle — note on/off, overlaps, repeats, all-notes-off, node cleanup', () => {
  it('handles overlapping notes, multi-source holds, repeated re-strikes, and full node cleanup', () => {
    const { ctx } = createFakeAudioContext()
    const { clock, flushAll, pendingCount } = createManualClock()
    const engine = new WebAudioPianoEngine({
      contextFactory: () => ctx,
      clock,
      autoLoadSamples: false,
    })
    const lifecycle = new NoteLifecycleController(engine, { maxPolyphony: 16 })

    // Overlapping C4 + E4 + G4 chord
    lifecycle.noteOn(60, 100, 'pointer:1')
    lifecycle.noteOn(64, 90, 'pointer:2')
    lifecycle.noteOn(67, 110, 'kbd:KeyG')
    expect(lifecycle.getSnapshot().activeVoiceCount).toBe(3)
    expect(engine.getActiveNodeCount()).toBeGreaterThan(0)

    // Holding C4 from a second source keeps C4 active when first releases
    lifecycle.noteOn(60, 105, 'kbd:KeyA')
    lifecycle.noteOff(60, 'pointer:1')
    expect(lifecycle.getSnapshot().activeNotes.has(60)).toBe(true)

    // Release all remaining notes and flush release timers -> node & timer count return to 0
    lifecycle.noteOff(60, 'kbd:KeyA')
    lifecycle.noteOff(64, 'pointer:2')
    lifecycle.noteOff(67, 'kbd:KeyG')
    flushAll()

    expect(lifecycle.getSnapshot().activeVoiceCount).toBe(0)
    expect(engine.getActiveNodeCount()).toBe(0)
    expect(pendingCount()).toBe(0)

    engine.dispose()
  })

  it('re-striking a sustained note cleanly damps the older voice without leaking nodes', () => {
    const { backend, triggered, released } = createRecordingBackend()
    const lifecycle = new NoteLifecycleController(backend, { maxPolyphony: 8 })

    lifecycle.setSustain(true, 'midi:1:cc64')
    const v1 = lifecycle.noteOn(60, 80, 'kbd:KeyA')
    lifecycle.noteOff(60, 'kbd:KeyA')
    expect(released).toHaveLength(0)

    const v2 = lifecycle.noteOn(60, 110, 'kbd:KeyA')
    expect(v2).not.toBe(v1)
    expect(triggered).toHaveLength(2)
    expect(released).toEqual([{ voiceId: v1!, fastSteal: true }])

    lifecycle.allNotesOff()
    expect(lifecycle.getSnapshot().activeVoiceCount).toBe(0)
  })
})

describe('piano.basic-sustain-polyphony — sustain, deterministic stealing, velocity & audible PCM checks', () => {
  it('steals oldest sustained voices before oldest held voices deterministically at polyphony limit', () => {
    const { backend, released } = createRecordingBackend()
    const lifecycle = new NoteLifecycleController(backend, { maxPolyphony: 3 })

    lifecycle.setSustain(true, 'ui:sustain')
    const v1 = lifecycle.noteOn(60, 90, 'p:1')!
    const v2 = lifecycle.noteOn(64, 90, 'p:2')!
    const v3 = lifecycle.noteOn(67, 90, 'p:3')!
    // Release v2 so v2 becomes 'sustained' while v1 and v3 remain 'held'
    lifecycle.noteOff(64, 'p:2')

    // 4th note MUST steal v2 (the sustained voice) before v1 (oldest held)
    lifecycle.noteOn(72, 100, 'p:4')
    expect(released).toEqual([{ voiceId: v2, fastSteal: true }])
    expect(lifecycle.getSnapshot().stolenVoiceCount).toBe(1)

    // 5th note steals v1 (oldest held voice)
    lifecycle.noteOn(76, 100, 'p:5')
    expect(released[1]).toEqual({ voiceId: v1, fastSteal: true })
    expect(lifecycle.getActiveVoices().map((v) => v.voiceId)).not.toContain(v1)
    expect(lifecycle.getActiveVoices().map((v) => v.voiceId)).toContain(v3)
  })

  it('produces real non-silent audio where velocity scales amplitude, sustain extends duration, and a 10-note chord does not clip', () => {
    // 1. Soft vs loud velocity renders strictly louder RMS
    const soft = renderPianoSequencePcm(
      [{ midi: 69, velocity: 28, startSec: 0.01, releaseSec: 0.35 }],
      0.8,
    )
    const loud = renderPianoSequencePcm(
      [{ midi: 69, velocity: 120, startSec: 0.01, releaseSec: 0.35 }],
      0.8,
    )
    expect(soft.rms).toBeGreaterThan(0.005)
    expect(loud.rms).toBeGreaterThan(soft.rms * 2.5)
    expect(loud.clippedSamples).toBe(0)

    // 2. Sustain pedal extends tail energy dramatically past key release
    const shortRelease = renderPianoSequencePcm(
      [{ midi: 60, velocity: 100, startSec: 0.01, releaseSec: 0.15 }],
      1.2,
    )
    const sustained = renderPianoSequencePcm(
      [{ midi: 60, velocity: 100, startSec: 0.01, releaseSec: 0.15, sustainHeldUntilSec: 0.95 }],
      1.2,
    )
    const shortTailRms = measureWindowRms(shortRelease.samples, shortRelease.sampleRate, 0.5, 0.9)
    const sustainedTailRms = measureWindowRms(sustained.samples, sustained.sampleRate, 0.5, 0.9)
    expect(shortTailRms).toBeLessThan(0.002)
    expect(sustainedTailRms).toBeGreaterThan(0.02)

    // 3. Ten-note fortissimo chord passes through master limiter with zero clipping
    const tenNoteChord = [48, 52, 55, 60, 64, 67, 71, 74, 79, 84].map((midi) => ({
      midi,
      velocity: 127,
      startSec: 0.01,
      releaseSec: 0.6,
    }))
    const chord = renderPianoSequencePcm(tenNoteChord, 0.9)
    expect(chord.rms).toBeGreaterThan(0.1)
    expect(chord.peak).toBeLessThanOrEqual(0.95)
    expect(chord.clippedSamples).toBe(0)

    // 4. Sample selection maps velocity layers and equal-temperament retuning accurately
    expect(midiToFrequency(69)).toBeCloseTo(440, 6)
    expect(velocityToLayerAndGain(25).vel).toBe('v3')
    expect(velocityToLayerAndGain(75).vel).toBe('v10')
    expect(velocityToLayerAndGain(120).vel).toBe('v16')
    const c4Sample = selectSampleForNote(60, 80)
    expect(c4Sample.region.midi).toBe(60)
    expect(c4Sample.playbackRate).toBeGreaterThan(0.99)
    expect(c4Sample.playbackRate).toBeLessThan(1.01)
  })
})

describe('piano.basic-status-cleanup — truthful loading/ready/fallback/error states & disposal', () => {
  it('transitions loading -> ready when samples decode and uses AudioBufferSourceNode', async () => {
    const { ctx, bufferSources } = createFakeAudioContext()
    const { clock } = createManualClock()
    const engine = new WebAudioPianoEngine({
      contextFactory: () => ctx,
      sampleFetcher: async () => new ArrayBuffer(16),
      clock,
      autoLoadSamples: false,
    })

    const loadPromise = engine.getSampleBank().loadAll(ctx)
    expect(engine.getStatus().status).toBe('loading')

    await loadPromise
    expect(engine.getStatus().status).toBe('ready')
    expect(engine.getStatus().usingFallback).toBe(false)
    expect(engine.getStatus().loadedSamples).toBe(78)

    engine.triggerNote(1, 60, 100)
    expect(bufferSources).toHaveLength(1)
    expect(bufferSources[0].buffer).not.toBeNull()

    engine.stopAllImmediate()
    expect(engine.getActiveNodeCount()).toBe(0)
    engine.dispose()
  })

  it('reports truthful fallback status when sample loading fails and still plays synthesized audio', async () => {
    const { ctx, oscillators } = createFakeAudioContext()
    const { clock } = createManualClock()
    const engine = new WebAudioPianoEngine({
      contextFactory: () => ctx,
      sampleFetcher: async () => {
        throw new Error('offline sample missing')
      },
      clock,
      autoLoadSamples: false,
    })

    await engine.getSampleBank().loadAll(ctx)
    const status = engine.getStatus()
    expect(status.status).toBe('fallback')
    expect(status.usingFallback).toBe(true)
    expect(status.message).toMatch(/fallback/i)

    // Still playable through live harmonic synthesis fallback
    engine.triggerNote(1, 69, 96)
    expect(oscillators).toHaveLength(3)
    expect(engine.getActiveNodeCount()).toBeGreaterThan(0)

    engine.dispose()
    expect(engine.getActiveNodeCount()).toBe(0)
  })

  it('reports truthful error status when Web Audio API is unavailable', () => {
    const { clock } = createManualClock()
    const engine = new WebAudioPianoEngine({
      contextFactory: () => null,
      clock,
      autoLoadSamples: false,
    })
    const status = engine.getStatus()
    expect(status.status).toBe('error')
    expect(status.audioContextState).toBe('unavailable')
    engine.dispose()
  })
})
