/**
 * Master Clock + deterministic Arpeggiator/Gate.
 *
 * The master clock is a BPM source (30-300) set by tapping the MST CLK button
 * four or more times, or by holding it and dialing a BPM. It syncs the
 * Arpeggiator/Gate, the Synth LFO, the Delay, and Mod 1 rate.
 *
 * The arpeggiator is DETERMINISTIC: given a fixed clock BPM and a held note set,
 * the produced step order and timing are a pure function of inputs, so tests can
 * assert the exact sequence without real timers. `stepsFor` computes the ordered
 * pitch sequence; `Arpeggiator` drives it against an injectable scheduler.
 */

export type ArpDirection = 'Up' | 'Down' | 'Up/Down' | 'Random';

export class MasterClock {
  private bpm = 120;
  private readonly tapTimes: number[] = [];

  getBpm(): number {
    return this.bpm;
  }

  setBpm(bpm: number): void {
    this.bpm = Math.max(30, Math.min(300, Math.round(bpm)));
  }

  /** Register a tap at time `nowMs`; after >=4 taps sets BPM from the average interval. */
  tap(nowMs: number): void {
    // Reset the tap buffer if the gap is too long (a fresh tap sequence).
    const last = this.tapTimes[this.tapTimes.length - 1];
    if (last !== undefined && nowMs - last > 2000) this.tapTimes.length = 0;
    this.tapTimes.push(nowMs);
    if (this.tapTimes.length > 8) this.tapTimes.shift();
    if (this.tapTimes.length >= 4) {
      let sum = 0;
      for (let i = 1; i < this.tapTimes.length; i++) sum += this.tapTimes[i] - this.tapTimes[i - 1];
      const avg = sum / (this.tapTimes.length - 1);
      if (avg > 0) this.setBpm(60000 / avg);
    }
  }

  /** Seconds per quarter note. */
  quarterSeconds(): number {
    return 60 / this.bpm;
  }

  /** Seconds per step for a subdivision multiplier (e.g. 0.25 = 1/16 of a quarter). */
  stepSeconds(subdivision: number): number {
    return this.quarterSeconds() * subdivision;
  }
}

/**
 * Compute the deterministic ordered arpeggio pitch sequence for a set of held
 * MIDI notes, a range in octaves (1..4), and a direction. Random uses a seeded
 * PRNG so it is reproducible/testable.
 */
export function arpSequence(
  heldNotes: number[],
  rangeOctaves: number,
  direction: ArpDirection,
  seed = 1,
): number[] {
  if (heldNotes.length === 0) return [];
  const base = [...heldNotes].sort((a, b) => a - b);
  const expanded: number[] = [];
  const range = Math.max(1, Math.min(4, Math.round(rangeOctaves)));
  for (let oct = 0; oct < range; oct++) {
    for (const n of base) expanded.push(n + oct * 12);
  }
  switch (direction) {
    case 'Up':
      return expanded;
    case 'Down':
      return [...expanded].reverse();
    case 'Up/Down': {
      const down = [...expanded].reverse().slice(1, -1);
      return [...expanded, ...down];
    }
    case 'Random': {
      // Fisher-Yates with a seeded PRNG (deterministic for a given seed).
      const out = [...expanded];
      let a = seed >>> 0;
      const rnd = () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    }
  }
}

export interface ArpSink {
  noteOn(midi: number, velocity?: number): void;
  noteOff(midi: number): void;
}

export interface Scheduler {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const defaultScheduler: Scheduler = {
  setInterval: (fn, ms) => (typeof setInterval !== 'undefined' ? setInterval(fn, ms) : 0),
  clearInterval: (h) => {
    if (typeof clearInterval !== 'undefined') clearInterval(h as ReturnType<typeof setInterval>);
  },
};

/**
 * Drives an arpeggio against a sink. Deterministic step order; timing from the
 * master clock. Uses an injectable scheduler so tests can step it manually.
 */
export class Arpeggiator {
  private handle: unknown = null;
  private held: number[] = [];
  private step = 0;
  private lastPlayed: number | null = null;
  running = false;
  rangeOctaves = 1;
  direction: ArpDirection = 'Up';
  hold = false;
  /** Gate mode retriggers held notes rather than stepping through them. */
  mode: 'Arp' | 'Poly' | 'Gate' = 'Arp';
  private seq: number[] = [];

  constructor(
    private readonly sink: ArpSink,
    private readonly clock: MasterClock,
    private readonly scheduler: Scheduler = defaultScheduler,
    private stepSubdivision = 0.5, // fraction of a quarter note per step
  ) {}

  setHeld(notes: number[]): void {
    this.held = [...notes];
    this.rebuild();
  }

  private rebuild(): void {
    this.seq = arpSequence(this.held, this.rangeOctaves, this.direction);
    if (this.step >= this.seq.length) this.step = 0;
  }

  setSubdivision(sub: number): void {
    this.stepSubdivision = sub;
    if (this.running) this.restartTimer();
  }

  /** Current ordered sequence (deterministic; for tests). */
  sequence(): number[] {
    return [...this.seq];
  }

  /** Advance exactly one step (deterministic; drives the sink). */
  tick(): void {
    if (this.seq.length === 0) return;
    if (this.lastPlayed !== null) this.sink.noteOff(this.lastPlayed);
    const note = this.mode === 'Gate' ? this.held[this.step % Math.max(1, this.held.length)] : this.seq[this.step % this.seq.length];
    this.sink.noteOn(note, 100);
    this.lastPlayed = note;
    this.step = (this.step + 1) % Math.max(1, this.mode === 'Gate' ? this.held.length : this.seq.length);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.step = 0;
    this.restartTimer();
  }

  private restartTimer(): void {
    if (this.handle) this.scheduler.clearInterval(this.handle);
    const ms = this.clock.stepSeconds(this.stepSubdivision) * 1000;
    this.handle = this.scheduler.setInterval(() => this.tick(), ms);
  }

  stop(): void {
    this.running = false;
    if (this.handle) {
      this.scheduler.clearInterval(this.handle);
      this.handle = null;
    }
    if (this.lastPlayed !== null) {
      this.sink.noteOff(this.lastPlayed);
      this.lastPlayed = null;
    }
    this.step = 0;
  }
}
