/**
 * PianoEngine — the one dependable Phase 1 piano voice and its deterministic
 * note lifecycle. Speaks only to the injected AudioBackend, so it is fully
 * testable without real audio.
 *
 * Guarantees:
 *  - note on/off with per-note release,
 *  - velocity response (louder strokes -> higher peak gain),
 *  - repeated/overlapping notes (retrigger steals the same pitch's voice),
 *  - sustain (CC64 / pedal): released notes are held until the pedal lifts,
 *  - polyphony with deterministic oldest-first voice stealing at maxVoices,
 *  - all-notes-off and full node cleanup on demand.
 */

import type { AudioBackend, Seconds, ToneHandle } from './types';

export type PianoStatus = 'idle' | 'loading' | 'ready' | 'error' | 'fallback';

export interface PianoEngineOptions {
  maxVoices?: number;
  attack?: Seconds;
  release?: Seconds;
  /** Longer, gentler release when Soft Release is engaged (Phase 2 wires the control). */
  softRelease?: Seconds;
}

interface Voice {
  midi: number;
  velocity: number;
  tone: ToneHandle;
  /** Monotonic id for deterministic age ordering. */
  order: number;
  /** True once the physical key is up but the voice is sustained by the pedal. */
  sustained: boolean;
  /** True once release has been scheduled and the voice is dying. */
  releasing: boolean;
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const DEFAULTS = { maxVoices: 16, attack: 0.005, release: 0.28, softRelease: 0.6 } as const;

export class PianoEngine {
  private readonly opts: Required<PianoEngineOptions>;
  private readonly voices = new Map<number, Voice>();
  private order = 0;
  private sustainDown = false;
  private status: PianoStatus = 'idle';

  constructor(
    private readonly backend: AudioBackend,
    options: PianoEngineOptions = {},
  ) {
    this.opts = { ...DEFAULTS, ...options };
  }

  getStatus(): PianoStatus {
    return this.status;
  }

  setStatus(status: PianoStatus): void {
    this.status = status;
  }

  /**
   * Marks the generated voice ready. There is no async asset load in Phase 1
   * (the voice is synthesized), so we report ready truthfully and immediately.
   */
  markReady(): void {
    this.status = 'ready';
  }

  get activeVoiceCount(): number {
    return this.voices.size;
  }

  get sustaining(): boolean {
    return this.sustainDown;
  }

  /** Velocity 1..127 -> peak gain, with a musical curve. */
  private velocityToGain(velocity: number): number {
    const v = Math.max(1, Math.min(127, velocity)) / 127;
    return 0.08 + 0.72 * v * v;
  }

  noteOn(midi: number, velocity = 100): void {
    // Retrigger: a still-sounding voice for this pitch is stolen first so
    // repeated/overlapping notes stay deterministic (one voice per pitch).
    const existing = this.voices.get(midi);
    if (existing) this.hardStop(existing);

    if (this.voices.size >= this.opts.maxVoices) this.stealOldest();

    const now = this.backend.now;
    const peak = this.velocityToGain(velocity);
    const tone = this.backend.createTone({ frequency: midiToFrequency(midi), peakGain: peak });
    tone.start(now);
    tone.rampGain(0, now); // ensure a defined starting point
    tone.rampGain(peak, now + this.opts.attack);

    this.voices.set(midi, {
      midi,
      velocity,
      tone,
      order: this.order++,
      sustained: false,
      releasing: false,
    });
  }

  noteOff(midi: number): void {
    const voice = this.voices.get(midi);
    if (!voice) return;
    if (this.sustainDown) {
      // Held by the damper pedal: keep sounding, mark for release on pedal up.
      voice.sustained = true;
      return;
    }
    this.release(voice);
  }

  setSustain(down: boolean, opts: { soft?: boolean } = {}): void {
    if (down === this.sustainDown) return;
    this.sustainDown = down;
    if (!down) {
      // Pedal up: release every voice whose key is already up.
      for (const voice of [...this.voices.values()]) {
        if (voice.sustained) this.release(voice, opts.soft);
      }
    }
  }

  /** Immediately release every voice (blur / disconnect / unmount). */
  allNotesOff(): void {
    this.sustainDown = false;
    for (const voice of [...this.voices.values()]) this.hardStop(voice);
  }

  /** Full teardown. */
  dispose(): void {
    this.allNotesOff();
    this.status = 'idle';
  }

  private release(voice: Voice, soft = false): void {
    if (voice.releasing) return;
    voice.releasing = true;
    const now = this.backend.now;
    const rel = soft ? this.opts.softRelease : this.opts.release;
    voice.tone.rampGain(0, now + rel);
    voice.tone.stop(now + rel);
    this.voices.delete(voice.midi);
  }

  private hardStop(voice: Voice): void {
    voice.tone.stop(this.backend.now);
    this.voices.delete(voice.midi);
  }

  private stealOldest(): void {
    let oldest: Voice | undefined;
    for (const voice of this.voices.values()) {
      if (!oldest || voice.order < oldest.order) oldest = voice;
    }
    if (oldest) this.hardStop(oldest);
  }
}
