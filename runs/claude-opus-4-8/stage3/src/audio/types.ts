/**
 * Injectable audio boundary.
 *
 * The piano engine talks only to these minimal interfaces, never to the global
 * `AudioContext` directly. Tests supply a deterministic fake (see
 * src/audio/fakeBackend.ts) so behavior can be asserted without real audio
 * output, and production supplies a thin Web Audio adapter (webAudioBackend.ts).
 *
 * The surface is intentionally small: what the piano voice actually needs is an
 * oscillator + gain that can be scheduled and stopped, plus a master node.
 */

export type Seconds = number;

/** A single scheduled tone. Owned by one voice; released and stopped by it. */
export interface ToneHandle {
  /** Start the tone at the given context time. */
  start(when: Seconds): void;
  /** Set the amplitude envelope target (0..1) with a ramp ending at `when`. */
  rampGain(target: number, when: Seconds): void;
  /** Immediately hold gain at its current value at `when` (cancels ramps). */
  holdGain(when: Seconds): void;
  /** Stop the tone at the given time and release its nodes. */
  stop(when: Seconds): void;
  /** True once stop() has been called. */
  readonly stopped: boolean;
}

export interface ToneSpec {
  /** Fundamental frequency in Hz. */
  frequency: number;
  /** Peak gain for this tone (already velocity-scaled), 0..1. */
  peakGain: number;
}

export interface AudioBackend {
  /** Current audio clock time in seconds (monotonic). */
  readonly now: Seconds;
  /** Context lifecycle state. */
  readonly state: 'suspended' | 'running' | 'closed';
  /** Resume a suspended context (browser autoplay gesture). */
  resume(): Promise<void>;
  /** Create a playable tone routed to the master bus. */
  createTone(spec: ToneSpec): ToneHandle;
  /** Number of tones currently alive (not yet stopped). For cleanup assertions. */
  readonly activeToneCount: number;
  /** Tear down the whole graph. */
  close(): Promise<void>;
}
