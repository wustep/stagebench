import { PianoKernel, type KernelOptions } from './kernel'

/** Messages from the main thread to the DSP host. */
export type EngineMessage =
  | { type: 'noteOn'; note: number; velocity: number }
  | { type: 'noteOff'; note: number }
  | { type: 'sustain'; down: boolean }
  | { type: 'allNotesOff' }
  | { type: 'master'; gain: number }

/** Reports from the DSP host back to the main thread. */
export type EngineReport = { type: 'voices'; count: number }

export const PROCESSOR_NAME = 'stage-piano'

/** Frames between voice-count reports, so the status line does not flood the message port. */
const REPORT_INTERVAL = 2048

/**
 * Owns a kernel and speaks the message protocol. The AudioWorklet processor and the
 * ScriptProcessor fallback are both thin shells around this class.
 */
export class KernelHost {
  readonly kernel: PianoKernel
  private readonly report: (report: EngineReport) => void
  private lastReported = 0
  private sinceReport = 0

  constructor(options: KernelOptions, report: (report: EngineReport) => void) {
    this.kernel = new PianoKernel(options)
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
      case 'master':
        this.kernel.setMasterGain(message.gain)
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
  }
}
