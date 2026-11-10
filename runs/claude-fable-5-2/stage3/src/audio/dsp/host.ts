import type { KernelOptions } from './kernel'
import type { SampleSet, SampleSetId, SoundState } from './params'
import { StageKernel } from './stage'

/** Messages from the main thread to the DSP host. */
export type EngineMessage =
  | { type: 'noteOn'; note: number; velocity: number }
  | { type: 'noteOff'; note: number }
  | { type: 'sustain'; down: boolean }
  | { type: 'allNotesOff' }
  /** The complete sound state; sent whenever the panel's canonical state changes. */
  | { type: 'state'; state: SoundState }
  /** A decoded sample set, or null when it could not be loaded. */
  | { type: 'sampleSet'; id: SampleSetId; set: SampleSet | null }

/** Reports from the DSP host back to the main thread. */
export type EngineReport = { type: 'voices'; count: number } | { type: 'compressor'; active: boolean[] }

export const PROCESSOR_NAME = 'stage-piano'

/** Frames between reports, so the status line does not flood the message port. */
const REPORT_INTERVAL = 2048

/**
 * Owns a kernel and speaks the message protocol. The AudioWorklet processor and the
 * ScriptProcessor fallback are both thin shells around this class.
 */
export class KernelHost {
  readonly kernel: StageKernel
  private readonly report: (report: EngineReport) => void
  private lastReported = 0
  private lastCompressor: boolean[] = [false, false, false, false, false, false]
  private sinceReport = 0

  constructor(options: Pick<KernelOptions, 'sampleRate'>, report: (report: EngineReport) => void) {
    this.kernel = new StageKernel({ sampleRate: options.sampleRate })
    this.report = report
  }

  handle(message: EngineMessage): void {
    switch (message.type) {
      case 'noteOn':
        this.kernel.noteOn(message.note, message.velocity)
        break
      case 'noteOff':
        this.kernel.noteOff(message.note)
        break
      case 'sustain':
        this.kernel.setSustain(message.down)
        break
      case 'allNotesOff':
        this.kernel.allNotesOff()
        break
      case 'state':
        this.kernel.setState(message.state)
        break
      case 'sampleSet':
        this.kernel.loadSampleSet(message.id, message.set)
        break
    }
  }

  process(left: Float32Array, right: Float32Array): void {
    this.kernel.process(left, right)
    this.sinceReport += left.length
    if (this.sinceReport < REPORT_INTERVAL) return
    this.sinceReport = 0
    const count = this.kernel.voiceCount
    if (count !== this.lastReported) {
      this.lastReported = count
      this.report({ type: 'voices', count })
    }
    // One flag per effect chain: Piano A, Piano B, Organ, Synth A, Synth B, Synth C.
    const active: boolean[] = []
    for (let chain = 0; chain < this.kernel.busCount; chain += 1) active.push(this.kernel.compressorActive(chain))
    if (active.some((value, chain) => value !== this.lastCompressor[chain])) {
      this.lastCompressor = active
      this.report({ type: 'compressor', active })
    }
  }
}
