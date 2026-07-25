import type { Scheduler } from './graph'
import type { ArpDirection, ArpMode } from './settings'
import { arpSteps } from './synthVoice'

/**
 * The arpeggiator / gate clock.
 *
 * It owns no audio: it turns a held-note set into a deterministic sequence of step callbacks
 * through the injectable `Scheduler`, so a test with the manual scheduler can advance time by
 * hand and assert the exact step order and timing (synth spec, `arpeggiatorGate.determinism`).
 *
 * - **Arp** plays one note of `arpSteps(...)` per step.
 * - **Gate** re-triggers every held note on every step, which is what makes it a gate rather than
 *   an arpeggio.
 * - **Poly** does nothing at all; the notes sound normally.
 */

export interface ArpConfig {
  readonly mode: ArpMode
  readonly run: boolean
  readonly stepsPerSecond: number
  readonly range: number
  readonly direction: ArpDirection
}

export type ArpStepHandler = (notes: readonly number[], stepSeconds: number, index: number) => void

export class ArpRunner {
  private config: ArpConfig = { mode: 'poly', run: false, stepsPerSecond: 4, range: 1, direction: 'up' }
  private notes: number[] = []
  private handle: number | null = null
  private index = 0

  constructor(
    private readonly scheduler: Scheduler,
    private readonly onStep: ArpStepHandler,
  ) {}

  get running(): boolean {
    return this.handle !== null
  }

  get stepIndex(): number {
    return this.index
  }

  /** The step order the current configuration would play, for tests and the display. */
  sequence(): number[] {
    return arpSteps(this.notes, this.config.range, this.config.direction)
  }

  setConfig(config: ArpConfig): void {
    const restart = config.mode !== this.config.mode || config.run !== this.config.run
    this.config = config
    if (restart) this.index = 0
    this.sync()
  }

  setNotes(notes: readonly number[]): void {
    const next = [...notes].sort((a, b) => a - b)
    const changed = next.length !== this.notes.length || next.some((note, i) => note !== this.notes[i])
    this.notes = next
    if (changed && this.notes.length === 0) this.index = 0
    this.sync()
  }

  stop(): void {
    if (this.handle !== null) this.scheduler.clearTimeout(this.handle)
    this.handle = null
  }

  private get active(): boolean {
    return this.config.run && this.config.mode !== 'poly' && this.notes.length > 0
  }

  private sync(): void {
    if (!this.active) {
      this.stop()
      return
    }
    if (this.handle === null) this.schedule(0)
  }

  private schedule(delayMs: number): void {
    this.handle = this.scheduler.setTimeout(() => {
      this.handle = null
      if (!this.active) return
      this.fire()
      this.schedule(this.intervalMs)
    }, delayMs)
  }

  private get intervalMs(): number {
    return 1000 / Math.max(0.1, this.config.stepsPerSecond)
  }

  private fire(): void {
    const stepSeconds = this.intervalMs / 1000
    if (this.config.mode === 'gate') {
      this.onStep(this.notes, stepSeconds, this.index)
    } else {
      const sequence = this.sequence()
      if (sequence.length === 0) return
      this.onStep([sequence[this.index % sequence.length]], stepSeconds, this.index)
    }
    this.index += 1
  }
}
