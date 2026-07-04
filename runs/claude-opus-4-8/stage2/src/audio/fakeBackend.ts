/**
 * Deterministic in-memory AudioBackend for tests. No Web Audio, no timers, no
 * real output. Records the full lifecycle of every tone so tests can assert
 * note on/off, gain ramps (velocity/sustain/release), and node cleanup.
 */

import type { AudioBackend, Seconds, ToneHandle, ToneSpec } from './types';

export interface FakeToneEvent {
  kind: 'start' | 'ramp' | 'hold' | 'stop';
  when: Seconds;
  value?: number;
}

export interface FakeTone extends ToneHandle {
  readonly spec: ToneSpec;
  readonly events: FakeToneEvent[];
  readonly startTime: number | null;
  readonly stopTime: number | null;
  /** Peak gain target reached across ramps — a proxy for rendered loudness. */
  readonly peakRamp: number;
}

class FakeToneImpl implements FakeTone {
  stopped = false;
  readonly events: FakeToneEvent[] = [];
  startTime: number | null = null;
  stopTime: number | null = null;
  peakRamp = 0;

  constructor(
    readonly spec: ToneSpec,
    private readonly onStop: () => void,
  ) {}

  start(when: Seconds): void {
    if (this.startTime !== null) return;
    this.startTime = when;
    this.events.push({ kind: 'start', when });
  }

  rampGain(target: number, when: Seconds): void {
    this.peakRamp = Math.max(this.peakRamp, target);
    this.events.push({ kind: 'ramp', when, value: target });
  }

  holdGain(when: Seconds): void {
    this.events.push({ kind: 'hold', when });
  }

  stop(when: Seconds): void {
    if (this.stopped) return;
    this.stopped = true;
    this.stopTime = when;
    this.events.push({ kind: 'stop', when });
    this.onStop();
  }
}

export interface FakeBackend extends AudioBackend {
  /** Every tone ever created, including stopped ones. */
  readonly tones: readonly FakeTone[];
  /** Advance the fake clock. */
  advance(seconds: number): void;
  resumeCalls: number;
}

export function createFakeBackend(startTime = 0): FakeBackend {
  let clock = startTime;
  let active = 0;
  let state: 'suspended' | 'running' | 'closed' = 'suspended';
  const tones: FakeToneImpl[] = [];

  return {
    get now() {
      return clock;
    },
    get state() {
      return state;
    },
    async resume() {
      this.resumeCalls++;
      if (state === 'suspended') state = 'running';
    },
    createTone(spec: ToneSpec): ToneHandle {
      active++;
      const tone = new FakeToneImpl(spec, () => {
        active = Math.max(0, active - 1);
      });
      tones.push(tone);
      return tone;
    },
    get activeToneCount() {
      return active;
    },
    async close() {
      state = 'closed';
    },
    get tones() {
      return tones;
    },
    advance(seconds: number) {
      clock += seconds;
    },
    resumeCalls: 0,
  };
}
