// Arpeggiator/gate (synth spec arpeggiatorGate): deterministic step sequencing of the held chord.
// Step times come from an origin and a fixed step length, so with a fixed clock and note set the
// step order and timing are exactly reproducible; `tick(now)` only decides when a due step is
// emitted. Random direction uses a seeded generator that restarts with the pattern.
import type { ArpDirection, ArpMode } from '../model/synthState'

export interface ArpSettings {
  mode: ArpMode
  /** Seconds per step. */
  step: number
  /** 1…4 octaves (Gate mode ignores it). */
  octaves: number
  direction: ArpDirection
  /** Master-clock grid origin (seconds) when synced; null = free-running from the first key. */
  gridOrigin: number | null
  /** Restart the pattern (and grid) on a key press after all keys were up. */
  kbSync: boolean
}

export interface ArpOutput {
  play(notes: readonly ArpNote[], time: number): void
  stop(notes: readonly ArpNote[], time: number): void
  /** Gate mode: open the layer gate for one step. */
  gate(time: number, step: number): void
}

export interface ArpNote {
  note: number
  velocity: number
  gain: number
}

export interface ArpEvent {
  time: number
  notes: number[]
}

/** The pattern of pitches (Arp mode) or chord transpositions (Poly mode) for one cycle. */
export function arpPattern(chord: readonly number[], octaves: number, direction: ArpDirection): number[] {
  const sorted = [...new Set(chord)].sort((a, b) => a - b)
  const up: number[] = []
  for (let o = 0; o < octaves; o++) for (const n of sorted) up.push(n + 12 * o)
  switch (direction) {
    case 'up':
    case 'random':
      return up
    case 'down':
      return [...up].reverse()
    case 'upDown':
      return up.length <= 2 ? up : [...up, ...up.slice(1, -1).reverse()]
  }
}

export class Arpeggiator {
  private chord: ArpNote[] = []
  private sounding: ArpNote[] = []
  private origin: number | null = null
  private index = 0
  private seed = 1
  running = false
  /** Emitted steps (bounded log for diagnostics and tests). */
  readonly events: ArpEvent[] = []

  constructor(
    private settings: ArpSettings,
    private readonly out: ArpOutput,
  ) {}

  configure(settings: ArpSettings): void {
    const stepChanged = settings.step !== this.settings.step || settings.gridOrigin !== this.settings.gridOrigin
    this.settings = settings
    if (stepChanged && this.origin !== null && this.nextTime !== null) {
      // Keep the upcoming step where it is and continue at the new rate from there.
      this.origin = this.nextTime
      this.index = 0
      this.stepCount = 0
    }
  }

  private stepCount = 0
  private get nextTime(): number | null {
    return this.origin === null ? null : this.origin + this.stepCount * this.settings.step
  }

  get held(): readonly ArpNote[] {
    return this.chord
  }

  keyDown(n: ArpNote, now: number): void {
    const wasEmpty = this.chord.length === 0
    this.chord = [...this.chord.filter((c) => c.note !== n.note), n]
    if (!wasEmpty) return
    // First key: (re)start the pattern.
    this.index = 0
    this.seed = 1
    this.stepCount = 0
    const s = this.settings
    if (s.gridOrigin === null || s.kbSync) this.origin = now
    else {
      const k = Math.ceil((now - s.gridOrigin) / s.step - 1e-9)
      this.origin = s.gridOrigin + Math.max(0, k) * s.step
    }
    // The first step is emitted by the next tick, so keys pressed together form one chord.
  }

  keyUp(note: number, now: number): void {
    this.chord = this.chord.filter((c) => c.note !== note)
    if (this.chord.length === 0) this.silence(now)
  }

  /** Stop sounding and forget the chord (run off, panic). */
  reset(now: number): void {
    this.chord = []
    this.silence(now)
  }

  private silence(now: number): void {
    if (this.sounding.length) this.out.stop(this.sounding, now)
    this.sounding = []
    this.origin = null
  }

  /** Emit every step due at `now` (a late tick after a long stall skips ahead instead of bursting). */
  tick(now: number): void {
    if (!this.chord.length || this.origin === null) return
    const step = this.settings.step
    let t = this.nextTime!
    if (now - t > 4 * step) {
      const skip = Math.floor((now - t) / step)
      this.stepCount += skip
      this.index += skip
      t = this.nextTime!
    }
    while (t <= now + 1e-9) {
      this.emit(t)
      this.stepCount++
      t = this.nextTime!
    }
  }

  private random(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0
    return this.seed / 0x100000000
  }

  private emit(time: number): void {
    const s = this.settings
    if (s.mode === 'gate') {
      this.out.gate(time, s.step)
      this.log(time, this.chord.map((c) => c.note))
      return
    }
    const notes = this.chord.map((c) => c.note)
    const pattern = arpPattern(notes, s.mode === 'poly' ? 1 : s.octaves, s.direction)
    let played: ArpNote[]
    if (s.mode === 'poly') {
      // Poly: the whole chord steps through the octave range.
      const octs = arpPattern([0], s.octaves, s.direction)
      const shift = s.direction === 'random' ? 12 * Math.floor(this.random() * s.octaves) : octs[this.index % octs.length]
      played = this.chord.map((c) => ({ ...c, note: c.note + shift }))
    } else {
      const i = s.direction === 'random' ? Math.floor(this.random() * pattern.length) : this.index % pattern.length
      const pitch = pattern[i]
      const base = this.nearest(pitch)
      played = [{ note: pitch, velocity: base.velocity, gain: base.gain }]
    }
    if (this.sounding.length) this.out.stop(this.sounding, time)
    this.out.play(played, time)
    this.sounding = played
    this.index++
    this.log(time, played.map((p) => p.note))
  }

  private nearest(pitch: number): ArpNote {
    return this.chord.reduce((best, c) => ((((pitch - c.note) % 12) + 12) % 12 === 0 ? c : best), this.chord[0])
  }

  private log(time: number, notes: number[]): void {
    this.events.push({ time, notes })
    if (this.events.length > 256) this.events.splice(0, this.events.length - 256)
  }
}
