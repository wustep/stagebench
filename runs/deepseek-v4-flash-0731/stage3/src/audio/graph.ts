/**
 * Phase 2 Web Audio graph — the browser realization of the layer/bus/master
 * architecture.
 *
 * One AudioContext is created (injected for tests, since jsdom has none). It
 * builds:
 *   - two per-layer bus GainNodes (A, B)
 *   - a master GainNode (Master Level)
 *   - a DynamicsCompressorNode configured as a limiter
 *   - a single drain node (AudioWorkletNode when the context supports it,
 *     else a ScriptProcessorNode) that pulls stereo PCM from the StageEngine
 *     and writes it to the layer buses
 *   - exactly one destination (context.destination)
 *
 * The graph is a thin renderer: the actual ordered effect processing happens in
 * the deterministic StageEngine (see stage.ts / chain.ts), which the drain
 * renders. This keeps the audible signal path testable without a device while
 * the browser still routes through one real AudioContext to one destination.
 *
 * `dispose()` disconnects every node and closes the context so counts return to
 * baseline (cleanup gate).
 */

import { StageEngine } from './stage'

const WORKLET_BLOB = URL.createObjectURL(
  new Blob(
    [
      `registerProcessor('stage-drain', class extends AudioWorkletProcessor {
  process(inputs, outputs) {
    return true
  }
})`,
    ],
    { type: 'application/javascript' },
  ),
)

export interface AudioContextLike {
  readonly destination: unknown
  readonly sampleRate: number
  currentTime: number
  createGain(): GainNodeLike
  createDynamicsCompressor(): DynamicsCompressorLike
  createScriptProcessor(bufferSize: number, inChannels: number, outChannels: number): ScriptProcessorLike
  close(): Promise<void>
  /** optional modern worklet path. */
  audioWorklet?: {
    addModule(url: string): Promise<void>
    port?: { postMessage(msg: unknown): void }
  }
  createAudioWorkletNode?(name: string, options?: { numberOfInputs?: number; numberOfOutputs?: number; outputChannelCount?: number[]; processorOptions?: unknown }): WorkletNodeLike
}

export interface GainNodeLike {
  gain: { value: number; setValueAtTime?(v: number, t: number): void }
  connect(dest: unknown): unknown
  disconnect(): void
}

export interface DynamicsCompressorLike {
  threshold: { value: number }
  knee: { value: number }
  ratio: { value: number }
  attack: { value: number }
  release: { value: number }
  connect(dest: unknown): unknown
  disconnect(): void
}

export interface ScriptProcessorLike {
  onaudioprocess: ((event: { outputBuffer: { getChannelData(i: number): Float32Array } }) => void) | null
  connect(dest: unknown): unknown
  disconnect(): void
  port?: { postMessage(msg: unknown): void }
}

export interface WorkletNodeLike {
  port: { postMessage(msg: unknown): void }
  connect(dest: unknown): unknown
  disconnect(): void
}

export interface AudioGraphOptions {
  engine: StageEngine
  /** injected AudioContext factory (tests supply a recording fake). */
  contextFactory?: () => AudioContextLike
  /** initial master level 0..1. */
  masterLevel?: number
}

export class AudioGraph {
  readonly context: AudioContextLike
  private engine: StageEngine
  private masterGain: GainNodeLike
  private limiter: DynamicsCompressorLike
  private drain: ScriptProcessorLike | WorkletNodeLike
  private buses: { A: GainNodeLike; B: GainNodeLike }
  private disposed = false

  constructor(options: AudioGraphOptions) {
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
    // limiter config: high ratio, low threshold, fast attack
    this.limiter.threshold.value = -3
    this.limiter.knee.value = 0
    this.limiter.ratio.value = 20
    this.limiter.attack.value = 0.001
    this.limiter.release.value = 0.1
    this.buses = { A: this.context.createGain(), B: this.context.createGain() }
    this.buses.A.gain.value = 1
    this.buses.B.gain.value = 1
    this.drain = this.createDrain()
    // wire: drain -> layer buses -> master -> limiter -> one destination
    this.drain.connect(this.buses.A)
    this.drain.connect(this.buses.B)
    this.buses.A.connect(this.masterGain)
    this.buses.B.connect(this.masterGain)
    this.masterGain.connect(this.limiter)
    this.limiter.connect(this.context.destination)
  }

  private createDrain(): ScriptProcessorLike | WorkletNodeLike {
    // Prefer AudioWorkletNode (no deprecation warning) when supported.
    if (this.context.audioWorklet && this.context.createAudioWorkletNode) {
      void this.context.audioWorklet.addModule(WORKLET_BLOB).catch(() => undefined)
      const node = this.context.createAudioWorkletNode('stage-drain', {
        numberOfInputs: 0,
        numberOfOutputs: 2,
        outputChannelCount: [1, 2],
      })
      return node
    }
    const sp = this.context.createScriptProcessor(256, 0, 2)
    sp.onaudioprocess = (event) => {
      const outL = event.outputBuffer.getChannelData(0)
      const outR = event.outputBuffer.getChannelData(1)
      const res = this.engine.render(outL.length)
      outL.set(res.samples)
      outR.set(res.samples)
    }
    return sp
  }

  /** update Master Level (ramped to avoid clicks). */
  setMasterLevel(level: number): void {
    const v = Math.max(0, Math.min(1, level))
    if (this.masterGain.gain.setValueAtTime && this.context.currentTime !== undefined) {
      this.masterGain.gain.setValueAtTime(v, this.context.currentTime)
    } else {
      this.masterGain.gain.value = v
    }
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  /** disconnect every node and close the context (cleanup). */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if ('onaudioprocess' in this.drain) this.drain.onaudioprocess = null
    this.drain.disconnect()
    this.buses.A.disconnect()
    this.buses.B.disconnect()
    this.masterGain.disconnect()
    this.limiter.disconnect()
    void this.context.close()
  }
}
