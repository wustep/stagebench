import { SynthArpMode, SynthArpDirection } from './types';

export interface SynthArpConfig {
  mode: SynthArpMode;
  direction: SynthArpDirection;
  range: number; // 1..4 octaves
  rate: number; // 0..10
  clockSync: boolean;
  kbHold: boolean;
  run: boolean;
  tempoBpm: number;
}

export class SynthArpeggiator {
  private heldNotes: number[] = [];
  private heldPhysicalNotes: Set<number> = new Set();
  private isRunning: boolean = false;
  private timerId: ReturnType<typeof setInterval> | null = null;

  private currentStepIndex: number = 0;
  private isStepDirectionUp: boolean = true;
  private config: SynthArpConfig;
  private onStepCallback?: (midis: number[], durationMs: number) => void;

  constructor(
    config: SynthArpConfig,
    onStepCallback?: (midis: number[], durationMs: number) => void
  ) {
    this.config = { ...config };
    this.onStepCallback = onStepCallback;
    if (config.run) {
      this.start();
    }
  }

  public updateConfig(partial: Partial<SynthArpConfig>): void {
    const wasRun = this.config.run;
    this.config = { ...this.config, ...partial };

    if (partial.run !== undefined) {
      if (partial.run && !wasRun) {
        this.start();
      } else if (!partial.run && wasRun) {
        this.stop();
      }
    }

    if (this.isRunning && (partial.rate !== undefined || partial.tempoBpm !== undefined || partial.clockSync !== undefined)) {
      // Restart interval with new rate
      this.restartTimer();
    }
  }

  public noteDown(midi: number): void {
    this.heldPhysicalNotes.add(midi);

    if (this.config.kbHold) {
      if (!this.heldNotes.includes(midi)) {
        this.heldNotes.push(midi);
        this.heldNotes.sort((a, b) => a - b);
      }
    } else {
      this.heldNotes = Array.from(this.heldPhysicalNotes).sort((a, b) => a - b);
    }
  }

  public noteUp(midi: number): void {
    this.heldPhysicalNotes.delete(midi);

    if (!this.config.kbHold) {
      this.heldNotes = Array.from(this.heldPhysicalNotes).sort((a, b) => a - b);
      if (this.heldNotes.length === 0) {
        this.currentStepIndex = 0;
      }
    }
  }

  public clearHold(): void {
    this.heldNotes = Array.from(this.heldPhysicalNotes).sort((a, b) => a - b);
  }

  public start(): void {
    this.isRunning = true;
    this.currentStepIndex = 0;
    this.restartTimer();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.currentStepIndex = 0;
  }

  private restartTimer(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }

    if (!this.isRunning) return;

    const intervalMs = this.calculateStepIntervalMs();
    this.timerId = setInterval(() => this.step(), intervalMs);
  }

  private calculateStepIntervalMs(): number {
    let bpm = this.config.tempoBpm || 120;
    if (!this.config.clockSync) {
      // Free rate: 30..300 BPM scaled from 0..10
      bpm = 40 + (this.config.rate / 10) * 260;
    }

    // Default: 1/16th notes (4 steps per beat)
    const quarterNoteMs = 60000 / bpm;
    const sixteenthNoteMs = quarterNoteMs / 4;
    return Math.max(20, sixteenthNoteMs);
  }

  public step(): void {
    if (this.heldNotes.length === 0) return;

    const notes = this.generateStepNoteSequence();
    if (notes.length === 0) return;

    const intervalMs = this.calculateStepIntervalMs();
    const durationMs = intervalMs * 0.8; // 80% gate length

    if (this.config.mode === 'Poly') {
      // Poly: all held notes play simultaneously on every clock step
      this.onStepCallback?.(notes, durationMs);
    } else if (this.config.mode === 'Gate') {
      // Gate: rhythmic chord gating
      this.onStepCallback?.(this.heldNotes, durationMs * (this.config.range / 4));
    } else {
      // Arp Mode: single note per step according to pattern
      const activeMidi = notes[this.currentStepIndex % notes.length];
      if (activeMidi !== undefined) {
        this.onStepCallback?.([activeMidi], durationMs);
      }

      // Advance step index
      this.advanceStepIndex(notes.length);
    }
  }

  private generateStepNoteSequence(): number[] {
    const baseNotes = [...this.heldNotes].sort((a, b) => a - b);
    const range = Math.max(1, Math.min(4, this.config.range));

    const fullSequence: number[] = [];
    for (let oct = 0; oct < range; oct++) {
      baseNotes.forEach((n) => fullSequence.push(n + oct * 12));
    }

    if (this.config.direction === 'Down') {
      fullSequence.reverse();
    }

    return fullSequence;
  }

  private advanceStepIndex(totalSteps: number): void {
    if (totalSteps <= 1) {
      this.currentStepIndex = 0;
      return;
    }

    if (this.config.direction === 'Up/Down') {
      if (this.isStepDirectionUp) {
        this.currentStepIndex++;
        if (this.currentStepIndex >= totalSteps - 1) {
          this.isStepDirectionUp = false;
        }
      } else {
        this.currentStepIndex--;
        if (this.currentStepIndex <= 0) {
          this.isStepDirectionUp = true;
        }
      }
    } else if (this.config.direction === 'Random') {
      this.currentStepIndex = Math.floor(Math.random() * totalSteps);
    } else {
      this.currentStepIndex = (this.currentStepIndex + 1) % totalSteps;
    }
  }

  public dispose(): void {
    this.stop();
    this.heldNotes = [];
    this.heldPhysicalNotes.clear();
  }
}
