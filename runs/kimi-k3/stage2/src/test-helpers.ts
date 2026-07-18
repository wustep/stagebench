import { FakeAudioBackend } from './audio/fake-backend'
import { PianoEngine } from './audio/engine'
import { defaultEffectsState } from './state/effects-state'
import { DEFAULT_PIANO_PERF } from './state/piano-state'
import type { PianoTypeId } from './audio/piano-models'
import type { LayerId } from './audio/render'

export interface TestRig {
  backend: FakeAudioBackend
  engine: PianoEngine
}

/** Engine + deterministic backend with the default config pushed. */
export async function makeRig(): Promise<TestRig> {
  const backend = new FakeAudioBackend()
  const engine = new PianoEngine(backend)
  await engine.init()
  return { backend, engine }
}

/** Deep-cloned default effects state for per-test mutation. */
export function freshEffects() {
  return defaultEffectsState()
}

/** Fresh perf state for per-test mutation. */
export function freshPerf() {
  return { ...DEFAULT_PIANO_PERF }
}

export interface LayerOverride {
  enabled?: boolean
  level?: number
  octave?: number
  type?: PianoTypeId
}

/** Render one note through the graph with explicit overrides. */
export function renderIsolated(
  seconds: number,
  opts: {
    note?: number
    velocity?: number
    releaseAt?: number | null
    layer?: LayerOverride
    effects?: ReturnType<typeof freshEffects>
    perf?: ReturnType<typeof freshPerf>
    masterLevel?: number
  } = {},
): Float32Array {
  const backend = new FakeAudioBackend()
  const layer: LayerOverride = { enabled: true, level: 0.9, octave: 0, type: 'grand', ...opts.layer }
  const overrides = {
    layers: {
      pianoA: { id: 'pianoA' as LayerId, enabled: layer.enabled!, level: layer.level!, octave: layer.octave!, type: layer.type! },
      pianoB: { id: 'pianoB' as LayerId, enabled: false, level: 0.9, octave: 0, type: 'upright' as PianoTypeId },
    },
    perf: opts.perf ?? freshPerf(),
    effects: opts.effects ?? freshEffects(),
    masterLevel: opts.masterLevel ?? 0.9,
  }
  return backend.renderNote(opts.note ?? 60, opts.velocity ?? 0.8, seconds, opts.releaseAt ?? null, overrides)
}
