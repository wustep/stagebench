/**
 * Phase 3 — System4 Web Audio graph.
 *
 * ONE AudioContext (injected in tests) drains System4's deterministic DSP mix
 * through a single master GainNode (Master Level) and a DynamicsCompressor
 * limiter into exactly one destination. Every engine — Piano, Organ, Synth —
 * is mixed inside System4 and reaches the destination only through this master
 * path (no second AudioContext, nothing bypasses it). `dispose()` disconnects
 * every node and closes the context so counts return to baseline (cleanup).
 */

import type { System4 } from './system4'
import type {
  AudioContextLike, DynamicsCompressorLike, GainNodeLike, ScriptProcessorLike,
} from './graph'

export interface SystemGraphOptions {
  engine: System4
  /** injected AudioContext factory (tests supply a recording fake). */
  contextFactory?: () => AudioContextLike
  /** initial master level 0..1. */
  masterLevel?: number
}

export class SystemGraph {
  readonly context: AudioContextLike
  private engine: System4
  private masterGain: GainNodeLike
  private limiter: DynamicsCompressorLike
  private drain: ScriptProcessorLike
  private disposed = false

  constructor(options: SystemGraphOptions) {
    this.engine = options.engine
    const factory = options.contextFactory ?? (() => {
      const Ctor = (globalThis as { AudioContext?: new () => AudioContextLike }).AudioContext
      if (!Ctor) throw new Error('Web Audio unavailable')
      return new Ctor()
    })
    this.context = factory()
    this.masterGain = this.context.createGain()
    this.masterGain.gain.value = options.masterLevel ?? 0.8
    this.limiter = this.context.createDynamicsCompressor()
    this.limiter.threshold.value = -3
    this.limiter.knee.value = 0
    this.limiter.ratio.value = 20
    this.limiter.attack.value = 0.001
    this.limiter.release.value = 0.1
    this.drain = this.context.createScriptProcessor(256, 0, 2)
    this.drain.onaudioprocess = (event) => {
      const outL = event.outputBuffer.getChannelData(0)
      const outR = event.outputBuffer.getChannelData(1)
      const res = this.engine.render(outL.length)
      outL.set(res.samples)
      outR.set(res.samples)
    }
    // drain → master → limiter → one destination.
    this.drain.connect(this.masterGain)
    this.masterGain.connect(this.limiter)
    this.limiter.connect(this.context.destination)
  }

  setMasterLevel(level: number): void {
    this.masterGain.gain.value = Math.max(0, Math.min(1, level))
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.drain.onaudioprocess = null
    this.drain.disconnect()
    this.masterGain.disconnect()
    this.limiter.disconnect()
    void this.context.close()
  }
}
