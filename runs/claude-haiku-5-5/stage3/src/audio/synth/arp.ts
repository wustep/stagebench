// Arpeggiator and gate sequencer. Given held notes, a direction, a range, and a step length, it lists
// the notes each step plays. Time comes only from the caller, so with a fixed clock the step order and
// timing are deterministic (synth.json `determinism`).

export type ArpMode = 'arp' | 'poly' | 'gate'
export type ArpDirection = 'up' | 'down' | 'updown' | 'random'

export const ARP_MODES: readonly ArpMode[] = ['arp', 'poly', 'gate']
export const ARP_DIRECTIONS: readonly ArpDirection[] = ['up', 'down', 'updown', 'random']

/** Note values for the synced rate, in beats per step: 1/2, 1/4, 1/4T, 1/8, 1/8T, 1/16, 1/16T, 1/32. */
export const SYNC_DIVISIONS = [2, 1, 2 / 3, 0.5, 1 / 3, 0.25, 1 / 6, 0.125] as const

/** Seconds per step for the rate knob: synced to the master clock, or free at the same tempo scale. */
export function stepSeconds(rate: number, bpm: number, synced: boolean): number {
  if (synced) {
    const index = Math.min(SYNC_DIVISIONS.length - 1, Math.floor(Math.min(0.999, Math.max(0, rate)) * SYNC_DIVISIONS.length))
    return (60 / bpm) * SYNC_DIVISIONS[index]
  }
  return 60 / (bpm * (0.5 + rate))
}

/** Octave range from the knob: 1 to 4 octaves. */
export function rangeOctaves(knob: number): number {
  return 1 + Math.round(Math.min(1, Math.max(0, knob)) * 3)
}

/** Expands held notes across the octave range, lowest first. */
export function expandNotes(held: readonly number[], octaves: number): number[] {
  const base = [...held].sort((a, b) => a - b)
  const out: number[] = []
  for (let octave = 0; octave < octaves; octave += 1) {
    for (const note of base) {
      if (note + 12 * octave <= 127) out.push(note + 12 * octave)
    }
  }
  return out
}

/** Deterministic pseudo-random sequence for the Random direction, so the same seed gives the same order. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 1
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/** The order one pass of the arpeggio plays. Up/Down/Up-Down follow the expanded list; Random draws from a fixed seed. */
export function arpPattern(notes: readonly number[], direction: ArpDirection, length: number, seed = 1): number[] {
  if (notes.length === 0) return []
  const sorted = [...notes].sort((a, b) => a - b)
  const sequence: number[] = []
  const random = seededRandom(seed)
  for (let step = 0; step < length; step += 1) {
    switch (direction) {
      case 'up':
        sequence.push(sorted[step % sorted.length])
        break
      case 'down':
        sequence.push(sorted[sorted.length - 1 - (step % sorted.length)])
        break
      case 'updown': {
        const period = Math.max(1, 2 * sorted.length - 2)
        const phase = step % period
        sequence.push(sorted[phase < sorted.length ? phase : period - phase])
        break
      }
      case 'random':
        sequence.push(sorted[Math.floor(random() * sorted.length)])
        break
    }
  }
  return sequence
}

export interface ArpEvent {
  time: number
  type: 'on' | 'off'
  note: number
}

export interface ArpSettings {
  mode: ArpMode
  direction: ArpDirection
  octaves: number
  /** Seconds per step. */
  step: number
  /** Gate length as a fraction of the step, 0..1. */
  gate: number
}

/**
 * Steps the arpeggio forward in time. `advance(now, held)` returns every on and off event whose time is
 * at or before `now`, in order. Steps sit on a fixed grid from `start`, so the events never drift with
 * the call rate.
 */
export class ArpSequencer {
  private nextStep = 0
  private startTime = 0
  private running = false
  private pattern: number[] = []
  private lastNotes: number[] = []

  start(time: number): void {
    this.running = true
    this.startTime = time
    this.nextStep = 0
  }

  /** Stops stepping. The caller releases any note that is still sounding. */
  stop(): void {
    this.running = false
  }

  get isRunning(): boolean {
    return this.running
  }

  advance(now: number, held: readonly number[], settings: ArpSettings): ArpEvent[] {
    const events: ArpEvent[] = []
    if (!this.running) return events
    const expanded = expandNotes(held, settings.octaves)
    if (expanded.length === 0) {
      this.lastNotes = []
      return events
    }
    if (expanded.join(',') !== this.lastNotes.join(',')) {
      this.lastNotes = expanded
      this.pattern = arpPattern(expanded, settings.direction, 64)
    }
    while (this.startTime + this.nextStep * settings.step <= now) {
      const time = this.startTime + this.nextStep * settings.step
      if (settings.mode === 'arp') {
        const note = this.pattern[this.nextStep % this.pattern.length]
        events.push({ time, type: 'on', note }, { time: time + settings.step * settings.gate, type: 'off', note })
      } else {
        // Poly and gate sound every held note on each step.
        for (const note of expanded) {
          events.push({ time, type: 'on', note }, { time: time + settings.step * settings.gate, type: 'off', note })
        }
      }
      this.nextStep += 1
    }
    return events
  }
}
