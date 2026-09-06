/**
 * Injectable test doubles for the Web Audio boundary.
 * The fake context records every node/timer/listener it owns so tests can
 * assert cleanup returns counts to baseline.
 */

import type {
  AudioContextLike,
  AudioDestinationLike,
  BufferSourceNodeLike,
  FakeAudioBuffer,
  GainNodeLike,
} from './types';

export class FakeAudioBufferImpl implements FakeAudioBuffer {
  readonly sampleRate: number;
  readonly length: number;
  readonly duration: number;
  private readonly data: Float32Array;

  constructor(length: number, sampleRate: number) {
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.data = new Float32Array(length);
  }

  getChannelData(_channel: number): Float32Array {
    return this.data;
  }
}

export class FakeGainNode implements GainNodeLike {
  gain = { value: 1 };
  connectedTo: unknown[] = [];
  disconnected = 0;

  connect(destination: unknown): void {
    this.connectedTo.push(destination);
  }

  disconnect(): void {
    this.disconnected += 1;
  }
}

export class FakeBufferSourceNode implements BufferSourceNodeLike {
  buffer: FakeAudioBuffer | null = null;
  onended: (() => void) | null = null;
  started = 0;
  stopped = 0;
  connectedTo: unknown[] = [];
  disconnected = 0;

  connect(destination: unknown): void {
    this.connectedTo.push(destination as never);
  }

  disconnect(): void {
    this.disconnected += 1;
  }

  start(_when = 0): void {
    this.started += 1;
  }

  stop(_when = 0): void {
    this.stopped += 1;
  }
}

export class FakeAudioContext implements AudioContextLike {
  readonly sampleRate = 44100;
  readonly destination: AudioDestinationLike = { __destinationBrand: true } as AudioDestinationLike;
  gains: FakeGainNode[] = [];
  sources: FakeBufferSourceNode[] = [];
  buffers: FakeAudioBufferImpl[] = [];
  closed = false;
  resumed = 0;
  state = 'running';

  get currentTime(): number {
    return 0;
  }

  createGain(): GainNodeLike {
    const node = new FakeGainNode();
    this.gains.push(node);
    return node;
  }

  createBuffer(channels: number, length: number, sampleRate: number): FakeAudioBuffer {
    void channels;
    const buffer = new FakeAudioBufferImpl(length, sampleRate);
    this.buffers.push(buffer);
    return buffer;
  }

  createBufferSource(): BufferSourceNodeLike {
    const node = new FakeBufferSourceNode();
    this.sources.push(node);
    return node;
  }

  async resume(): Promise<void> {
    this.resumed += 1;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
