/**
 * Minimal Web Audio surface used by the Phase 1 piano engine.
 * The engine only touches this interface, so tests inject fakes and no test
 * needs real audio output.
 */

export interface AudioNodeLike {
  connect(destination: AudioNodeLike | AudioDestinationLike): void;
  disconnect(): void;
}

export interface AudioDestinationLike {
  __destinationBrand: true;
}

export interface GainNodeLike extends AudioNodeLike {
  gain: { value: number };
}

export interface BufferSourceNodeLike extends AudioNodeLike {
  buffer: FakeAudioBuffer | null;
  onended: (() => void) | null;
  start(when?: number): void;
  stop(when?: number): void;
}

/** Smallest buffer shape the engine needs (real AudioBuffer compatible). */
export interface FakeAudioBuffer {
  sampleRate: number;
  length: number;
  duration: number;
  getChannelData(channel: number): Float32Array;
}

export interface AudioContextLike {
  readonly sampleRate: number;
  readonly currentTime: number;
  readonly state: string;
  readonly destination: AudioDestinationLike;
  createGain(): GainNodeLike;
  createBuffer(channels: number, length: number, sampleRate: number): FakeAudioBuffer;
  createBufferSource(): BufferSourceNodeLike;
  resume(): Promise<void>;
  close(): Promise<void>;
}

export type AudioContextFactory = () => AudioContextLike | null;

export interface ClockLike {
  now(): number;
}

/** Monotonic test clock with manual advance. */
export function createTestClock(start = 1000): ClockLike & { advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}
