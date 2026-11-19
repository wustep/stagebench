import type { Clock, TimerHandle } from './boundaries'
import {
  masterClockSubdivisionSeconds,
  type MasterClockState,
  type SynthArpDirection,
  type SynthArpState,
  type SynthLayerId,
} from '../model/organSynthTypes'

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Computes exact arpeggiator/gate step duration in seconds.
 * When `arp.clockSync` is true, locks strictly to `masterClock.bpm` and the selected subdivision.
 * Otherwise uses free BPM (40..240 BPM, eighth-note stepping).
 */
export function getArpStepSeconds(arp: SynthArpState, masterClock: MasterClockState): number {
  if (arp.clockSync) {
    return masterClockSubdivisionSeconds(masterClock.bpm, arp.rate)
  }
  const freeBpm = 40 + (Math.max(0, Math.min(100, arp.rate)) / 100) * 200
  return 30 / freeBpm
}

/**
 * Deterministically builds the octave-expanded note sequence for a given sorted note set,
 * octave range (1..4), and direction (`Up`, `Down`, `Up/Down`, `Random`).
 */
export function buildArpStepSequence(
  heldMidis: readonly number[],
  rangeOctaves: 1 | 2 | 3 | 4,
  direction: SynthArpDirection,
  randomSeed = 0x4e5334,
): readonly number[] {
  if (heldMidis.length === 0) return []
  const uniqueSorted = Array.from(new Set(heldMidis)).sort((a, b) => a - b)

  const expanded: number[] = []
  for (let oct = 0; oct < rangeOctaves; oct++) {
    for (const midi of uniqueSorted) {
      const shifted = midi + oct * 12
      if (shifted <= 127) {
        expanded.push(shifted)
      }
    }
  }
  if (expanded.length === 0) return []

  if (direction === 'Up') {
    return expanded
  }

  if (direction === 'Down') {
    return [...expanded].reverse()
  }

  if (direction === 'Up/Down') {
    if (expanded.length <= 2) return expanded
    const down = expanded.slice(1, -1).reverse()
    return [...expanded, ...down]
  }

  const shuffled = [...expanded]
  const rng = mulberry32(randomSeed ^ (expanded.length * 2654435761))
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = shuffled[i]
    shuffled[i] = shuffled[j]
    shuffled[j] = tmp
  }
  return shuffled
}

export interface ArpStepEvent {
  readonly layerId: SynthLayerId
  readonly stepIndex: number
  readonly notes: readonly number[]
  readonly velocity: number
  readonly gateSeconds: number
  readonly mode: SynthArpState['mode']
}

export interface SynthArpeggiatorCallbacks {
  readonly onStep: (event: ArpStepEvent) => void
  readonly onStopLayer: (layerId: SynthLayerId) => void
}

export class SynthArpeggiator {
  readonly layerId: SynthLayerId
  private readonly clock: Clock
  private readonly callbacks: SynthArpeggiatorCallbacks

  private arpState: SynthArpState
  private masterClock: MasterClockState
  private heldNotes = new Map<number, number>()
  private latchedNotes = new Map<number, number>()
  private stepIndex = 0
  private timer: TimerHandle | null = null
  private running = false

  constructor(
    layerId: SynthLayerId,
    initialArp: SynthArpState,
    initialMasterClock: MasterClockState,
    clock: Clock,
    callbacks: SynthArpeggiatorCallbacks,
  ) {
    this.layerId = layerId
    this.arpState = initialArp
    this.masterClock = initialMasterClock
    this.clock = clock
    this.callbacks = callbacks
  }

  get isRunning(): boolean {
    return this.running
  }

  getActiveNotes(): readonly number[] {
    const source = this.arpState.kbHold && this.latchedNotes.size > 0 ? this.latchedNotes : this.heldNotes
    return Array.from(source.keys()).sort((a, b) => a - b)
  }

  updateConfig(arpState: SynthArpState, masterClock: MasterClockState, layerActive: boolean): void {
    const prevHold = this.arpState.kbHold
    this.arpState = arpState
    this.masterClock = masterClock

    if (prevHold && !arpState.kbHold) {
      this.latchedNotes.clear()
      if (this.heldNotes.size === 0) {
        this.stopScheduler()
        this.callbacks.onStopLayer(this.layerId)
      }
    }

    if (!layerActive || !arpState.run) {
      this.stopScheduler()
      return
    }

    if (this.getActiveNotes().length > 0 && !this.running) {
      this.startScheduler()
    }
  }

  noteOn(midi: number, velocity: number): boolean {
    if (this.arpState.kbHold && this.heldNotes.size === 0) {
      this.latchedNotes.clear()
    }
    this.heldNotes.set(midi, velocity)
    if (this.arpState.kbHold) {
      this.latchedNotes.set(midi, velocity)
    }

    if (!this.arpState.run) return false

    if (!this.running) {
      this.stepIndex = 0
      this.startScheduler()
    }
    return true
  }

  noteOff(midi: number): void {
    this.heldNotes.delete(midi)
    if (!this.arpState.kbHold) {
      this.latchedNotes.delete(midi)
    }
    if (this.getActiveNotes().length === 0) {
      this.stopScheduler()
      this.callbacks.onStopLayer(this.layerId)
    }
  }

  stepNow(): ArpStepEvent | null {
    const source =
      this.arpState.kbHold && this.latchedNotes.size > 0 ? this.latchedNotes : this.heldNotes
    if (source.size === 0 || !this.arpState.run) return null

    const midis = Array.from(source.keys()).sort((a, b) => a - b)
    let velSum = 0
    for (const v of source.values()) velSum += v
    const avgVel = Math.round(velSum / source.size)
    const stepSec = getArpStepSeconds(this.arpState, this.masterClock)

    let notes: readonly number[]
    let gateSeconds: number

    if (this.arpState.mode === 'Arp') {
      const seq = buildArpStepSequence(midis, this.arpState.range, this.arpState.direction)
      const note = seq[this.stepIndex % seq.length]
      notes = [note]
      gateSeconds = stepSec * 0.72
    } else if (this.arpState.mode === 'Poly') {
      const octOffset = (this.stepIndex % this.arpState.range) * 12
      notes = midis.map((m) => Math.min(127, m + octOffset))
      gateSeconds = stepSec * 0.72
    } else {
      notes = midis
      const duty = 0.15 + (Math.max(0, Math.min(100, this.arpState.gateEnv)) / 100) * 0.77
      gateSeconds = stepSec * duty
    }

    const evt: ArpStepEvent = {
      layerId: this.layerId,
      stepIndex: this.stepIndex,
      notes,
      velocity: avgVel,
      gateSeconds,
      mode: this.arpState.mode,
    }
    this.stepIndex += 1
    this.callbacks.onStep(evt)
    return evt
  }

  private startScheduler(): void {
    if (this.running) return
    this.running = true
    this.stepNow()
    this.scheduleNext()
  }

  private scheduleNext(): void {
    if (!this.running) return
    const stepMs = Math.max(25, Math.round(getArpStepSeconds(this.arpState, this.masterClock) * 1000))
    this.timer = this.clock.setTimeout(() => {
      this.timer = null
      if (!this.running) return
      if (this.getActiveNotes().length === 0 || !this.arpState.run) {
        this.stopScheduler()
        return
      }
      this.stepNow()
      this.scheduleNext()
    }, stepMs)
  }

  private stopScheduler(): void {
    this.running = false
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer)
      this.timer = null
    }
  }

  clearAll(): void {
    this.stopScheduler()
    this.heldNotes.clear()
    this.latchedNotes.clear()
    this.stepIndex = 0
  }

  dispose(): void {
    this.clearAll()
  }
}
