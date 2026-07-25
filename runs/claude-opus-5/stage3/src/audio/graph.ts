/**
 * The narrow slice of Web Audio the instrument actually uses.
 *
 * The engine is written against these interfaces rather than against `lib.dom`'s `AudioContext`
 * so that the audio boundary is injectable: the browser passes a real `AudioContext`, and tests
 * pass the deterministic offline renderer in `src/audio/offline.ts`, which implements the same
 * surface and produces real sample data (jsdom ships no Web Audio at all).
 *
 * Phase 2 adds the node types the effect chain needs — delay lines, wave shapers and stereo
 * panners — plus audio-rate modulation (connecting a node to an AudioParam), which is how the
 * LFOs, the ring modulator and the compressor's envelope follower are built.
 */

export interface GraphParam {
  value: number
  setValueAtTime(value: number, startTime: number): unknown
  linearRampToValueAtTime(value: number, endTime: number): unknown
  exponentialRampToValueAtTime(value: number, endTime: number): unknown
  cancelScheduledValues(startTime: number): unknown
}

export interface GraphNode {
  connect(destination: GraphNode | GraphParam): unknown
  disconnect(): unknown
}

export interface GraphGain extends GraphNode {
  readonly gain: GraphParam
}

export interface GraphBiquad extends GraphNode {
  type: string
  readonly frequency: GraphParam
  readonly Q: GraphParam
  readonly gain: GraphParam
}

export interface GraphOscillator extends GraphNode {
  type: string
  readonly frequency: GraphParam
  start(when: number): void
  stop(when: number): void
}

export interface GraphBuffer {
  readonly length: number
  readonly sampleRate: number
  readonly numberOfChannels: number
  getChannelData(channel: number): Float32Array
}

export interface GraphBufferSource extends GraphNode {
  buffer: GraphBuffer | null
  readonly playbackRate: GraphParam
  /**
   * Loop the buffer instead of playing it once. Phase 3 uses this for the two sustained
   * generated sources the synth needs: the white-noise waveform and the single-cycle wavetables
   * that carry the hard-sync waveforms, which cannot be built from a plain oscillator.
   */
  loop?: boolean
  start(when: number): void
  stop(when: number): void
}

export interface GraphDelay extends GraphNode {
  readonly delayTime: GraphParam
}

export interface GraphWaveShaper extends GraphNode {
  curve: Float32Array | null
  oversample?: string
}

export interface GraphStereoPanner extends GraphNode {
  readonly pan: GraphParam
}

export interface GraphContext {
  readonly sampleRate: number
  readonly currentTime: number
  readonly destination: GraphNode
  readonly state: string
  createGain(): GraphGain
  createBiquadFilter(): GraphBiquad
  createOscillator(): GraphOscillator
  createBufferSource(): GraphBufferSource
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): GraphBuffer
  createDelay(maxDelayTime?: number): GraphDelay
  createWaveShaper(): GraphWaveShaper
  createStereoPanner(): GraphStereoPanner
  resume(): Promise<void>
  close(): Promise<void>
}

/** Timer boundary, so voice reaping is deterministic under test. */
export interface Scheduler {
  setTimeout(handler: () => void, timeoutMs: number): number
  clearTimeout(handle: number): void
}

export const realScheduler: Scheduler = {
  setTimeout: (handler, timeoutMs) => globalThis.setTimeout(handler, timeoutMs) as unknown as number,
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
}

/** Deterministic scheduler for tests: nothing runs until `advance` is called. */
export class ManualScheduler implements Scheduler {
  private nextHandle = 1
  private readonly pending = new Map<number, { at: number; handler: () => void }>()
  private now = 0

  setTimeout(handler: () => void, timeoutMs: number): number {
    const handle = this.nextHandle++
    this.pending.set(handle, { at: this.now + timeoutMs, handler })
    return handle
  }

  clearTimeout(handle: number): void {
    this.pending.delete(handle)
  }

  get pendingCount(): number {
    return this.pending.size
  }

  advance(ms: number): void {
    this.now += ms
    const due = [...this.pending.entries()]
      .filter(([, entry]) => entry.at <= this.now)
      .sort((a, b) => a[1].at - b[1].at)
    for (const [handle, entry] of due) {
      this.pending.delete(handle)
      entry.handler()
    }
  }
}
