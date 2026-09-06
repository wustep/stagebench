/**
 * Phase 1 piano engine: one synthesized basic piano voice.
 *
 * Honest description: live additive synthesis rendered through generated
 * PCM buffers (see IMPLEMENTATION_DETAILS.json — no recorded samples).
 * Signal path for every voice: buffer source -> per-note gain -> master gain
 * -> destination. Nothing bypasses the master path.
 */

import { renderPianoNote, pickStealVictim, SAMPLE_RATE } from './dsp';
import type { AudioContextFactory, AudioContextLike, ClockLike } from './types';

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error' | 'fallback';

export interface EngineOptions {
  createContext: AudioContextFactory;
  clock?: ClockLike;
  /** Maximum concurrent voices before deterministic stealing. */
  maxVoices?: number;
  /** Force the silent-fallback path (autoplay/policy denial). */
  forceFallback?: boolean;
}

interface OwnedVoice {
  noteId: string;
  midi: number;
  startedAt: number;
  sustained: boolean;
  release: () => void;
  dispose: () => void;
}

const DEFAULT_MAX_VOICES = 16;

export class PianoEngine {
  private readonly createContext: AudioContextFactory;
  private readonly clock: ClockLike;
  private readonly maxVoices: number;
  private readonly forceFallback: boolean;
  private ctx: AudioContextLike | null = null;
  private master: { gain: { value: number }; connect: (d: unknown) => void } | null = null;
  private voices = new Map<string, OwnedVoice>();
  private status: EngineStatus = 'idle';
  private statusDetail = '';
  private seq = 0;

  constructor(opts: EngineOptions) {
    this.createContext = opts.createContext;
    this.clock = opts.clock ?? { now: () => Date.now() };
    this.maxVoices = opts.maxVoices ?? DEFAULT_MAX_VOICES;
    this.forceFallback = opts.forceFallback ?? false;
  }

  getStatus(): EngineStatus {
    return this.status;
  }

  getStatusDetail(): string {
    return this.statusDetail;
  }

  getVoiceCount(): number {
    return this.voices.size;
  }

  getActiveNotes(): number[] {
    return [...this.voices.values()].map((v) => v.midi);
  }

  /** Build the context + master bus. Idempotent; reports honest status. */
  async init(): Promise<EngineStatus> {
    if (this.status === 'ready' || this.status === 'fallback') return this.status;
    this.status = 'loading';
    this.statusDetail = 'Preparing piano voice…';
    try {
      const ctx = this.createContext();
      if (!ctx || this.forceFallback) {
        this.ctx = null;
        this.master = null;
        this.status = 'fallback';
        this.statusDetail = this.forceFallback
          ? 'Audio unavailable — silent fallback: keys track visually.'
          : 'Audio unavailable in this browser — silent fallback: keys track visually.';
        return this.status;
      }
      this.ctx = ctx;
      const master = ctx.createGain();
      master.gain.value = 0.8;
      master.connect(ctx.destination);
      this.master = master as unknown as { gain: { value: number }; connect: (d: unknown) => void };
      // Resume may never resolve without a user gesture (autoplay policy);
      // never leave the status stuck in loading because of it.
      try {
        await Promise.race([ctx.resume(), new Promise((resolve) => setTimeout(resolve, 1500))]);
      } catch {
        /* suspended until first gesture — graph is built and ready */
      }
      this.status = 'ready';
      this.statusDetail = 'Piano ready (synthesized basic voice).';
      return this.status;
    } catch (err) {
      this.ctx = null;
      this.master = null;
      this.status = 'error';
      this.statusDetail = `Piano voice failed to start: ${err instanceof Error ? err.message : String(err)}`;
      return this.status;
    }
  }

  /** Start a voice. Returns the owned note id, or null when silent. */
  noteOn(midi: number, velocity: number, sustain: boolean): string | null {
    if (!this.ctx || !this.master || (this.status !== 'ready' && this.status !== 'fallback')) {
      return null;
    }
    const noteId = `n${this.clock.now()}-${this.seq}`;
    this.seq += 1;
    if (this.status === 'fallback' || !this.ctx) {
      // Fallback still tracks ownership so release/cleanup accounting holds.
      this.voices.set(noteId, {
        noteId,
        midi,
        startedAt: this.clock.now(),
        sustained: sustain,
        release: () => undefined,
        dispose: () => undefined,
      });
      this.enforcePolyphony();
      return noteId;
    }
    const ctx = this.ctx;
    const sampleRate = ctx.sampleRate || SAMPLE_RATE;
    const rendered = renderPianoNote(midi, velocity, { sampleRate, sustain });
    const buffer = ctx.createBuffer(1, rendered.length, sampleRate);
    buffer.getChannelData(0).set(rendered);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 1;
    source.connect(gain);
    gain.connect(this.master as unknown as never);
    const owned: OwnedVoice = {
      noteId,
      midi,
      startedAt: this.clock.now(),
      sustained: sustain,
      release: () => {
        try {
          source.stop();
        } catch {
          /* already stopped */
        }
        try {
          source.disconnect();
        } catch {
          /* already gone */
        }
        try {
          gain.disconnect();
        } catch {
          /* already gone */
        }
      },
      dispose: () => {
        try {
          source.stop();
        } catch {
          /* already stopped */
        }
        try {
          source.disconnect();
        } catch {
          /* already gone */
        }
        try {
          gain.disconnect();
        } catch {
          /* already gone */
        }
        source.onended = null;
      },
    };
    source.onended = () => {
      if (this.voices.get(noteId) === owned) this.voices.delete(noteId);
    };
    this.voices.set(noteId, owned);
    this.enforcePolyphony();
    try {
      source.start();
    } catch {
      this.voices.delete(noteId);
      return null;
    }
    return noteId;
  }

  /** Release a voice by note id (no-op for unknown ids). */
  noteOff(noteId: string): void {
    const voice = this.voices.get(noteId);
    if (!voice) return;
    voice.release();
    this.voices.delete(noteId);
  }

  /** Mark an owned voice sustained / released (damper). */
  setSustained(noteId: string, sustained: boolean): void {
    const voice = this.voices.get(noteId);
    if (voice) voice.sustained = sustained;
  }

  /** Stop every owned voice and drop ownership. Returns stopped count. */
  allNotesOff(): number {
    const count = this.voices.size;
    for (const voice of this.voices.values()) voice.dispose();
    this.voices.clear();
    return count;
  }

  /** Tear down the engine: voices, master bus, context. */
  async dispose(): Promise<void> {
    this.allNotesOff();
    this.master = null;
    if (this.ctx) {
      try {
        await this.ctx.close();
      } catch {
        /* ignore teardown errors */
      }
      this.ctx = null;
    }
    this.status = 'idle';
    this.statusDetail = '';
  }

  private enforcePolyphony(): void {
    while (this.voices.size > this.maxVoices) {
      const victim = pickStealVictim(
        [...this.voices.values()].map((v) => ({
          noteId: v.noteId,
          midi: v.midi,
          startedAt: v.startedAt,
          sustained: v.sustained,
        })),
        this.clock.now(),
      );
      if (!victim) return;
      const owned = this.voices.get(victim.noteId);
      if (!owned) return;
      owned.dispose();
      this.voices.delete(victim.noteId);
    }
  }
}
