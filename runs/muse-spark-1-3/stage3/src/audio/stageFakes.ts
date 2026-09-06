/**
 * Phase 2 injectable doubles for the extended Web Audio surface.
 * `StageFakeContext` subclasses the Phase 1 `FakeAudioContext` — Phase 1
 * accounting (`gains`, `sources`, `buffers`, `closed`) keeps working — and
 * records every Phase 2 node it owns so tests assert wiring, parameter
 * application, and cleanup back to baseline.
 */

import { FakeAudioBufferImpl, FakeAudioContext, FakeGainNode } from './fakes';

export type { FakeGainNode };
import type { FakeAudioBuffer, GainNodeLike } from './types';
import type {
  AudioParamLike,
  BiquadFilterNodeLike,
  BiquadType,
  ConvolverNodeLike,
  DelayNodeLike,
  DynamicsCompressorNodeLike,
  OscillatorNodeLike,
  OscillatorWaveform,
  StageAudioContextLike,
  StereoPannerNodeLike,
  VoiceSourceNodeLike,
  WaveShaperNodeLike,
} from './graphTypes';

export class FakeAudioParam implements AudioParamLike {
  value: number;
  events: Array<{ op: string; value: number; time: number; tau?: number }> = [];

  constructor(initial = 0) {
    this.value = initial;
  }

  setValueAtTime(value: number, startTime: number): void {
    this.events.push({ op: 'set', value, time: startTime });
    this.value = value;
  }

  linearRampToValueAtTime(value: number, endTime: number): void {
    this.events.push({ op: 'linear', value, time: endTime });
    this.value = value;
  }

  setTargetAtTime(target: number, startTime: number, timeConstant: number): void {
    this.events.push({ op: 'target', value: target, time: startTime, tau: timeConstant });
    this.value = target;
  }

  cancelScheduledValues(cancelTime: number): void {
    this.events.push({ op: 'cancel', value: 0, time: cancelTime });
  }
}

class FakeNodeBase {
  connectedTo: unknown[] = [];
  disconnected = 0;

  connect(destination: unknown): void {
    this.connectedTo.push(destination);
  }

  disconnect(): void {
    this.disconnected += 1;
  }
}

export class FakeVoiceSource extends FakeNodeBase implements VoiceSourceNodeLike {
  buffer: FakeAudioBuffer | null = null;
  onended: (() => void) | null = null;
  playbackRate = new FakeAudioParam(1);
  detune = new FakeAudioParam(0);
  started = 0;
  stopped = 0;

  start(_when = 0): void {
    this.started += 1;
  }

  stop(_when = 0): void {
    this.stopped += 1;
  }
}

export class FakeBiquad extends FakeNodeBase implements BiquadFilterNodeLike {
  type: BiquadType = 'lowpass';
  frequency = new FakeAudioParam(1000);
  Q = new FakeAudioParam(1);
  gain = new FakeAudioParam(0);
}

export class FakeDelay extends FakeNodeBase implements DelayNodeLike {
  delayTime = new FakeAudioParam(0.3);
}

export class FakeCompressor extends FakeNodeBase implements DynamicsCompressorNodeLike {
  threshold = new FakeAudioParam(-24);
  knee = new FakeAudioParam(30);
  ratio = new FakeAudioParam(12);
  attack = new FakeAudioParam(0.003);
  release = new FakeAudioParam(0.25);
}

export class FakeShaper extends FakeNodeBase implements WaveShaperNodeLike {
  curve: Float32Array | null = null;
  oversample = 'none';
}

export class FakePanner extends FakeNodeBase implements StereoPannerNodeLike {
  pan = new FakeAudioParam(0);
}

export class FakeOscillator extends FakeNodeBase implements OscillatorNodeLike {
  type: OscillatorWaveform = 'sine';
  frequency = new FakeAudioParam(440);
  onended: (() => void) | null = null;
  started = 0;
  stopped = 0;

  start(_when = 0): void {
    this.started += 1;
  }

  stop(_when = 0): void {
    this.stopped += 1;
  }
}

export class FakeConvolver extends FakeNodeBase implements ConvolverNodeLike {
  buffer: { sampleRate: number; length: number } | null = null;
}

export class StageFakeContext extends FakeAudioContext implements StageAudioContextLike {
  declare sources: FakeVoiceSource[];
  voices: FakeVoiceSource[] = [];
  filters: FakeBiquad[] = [];
  delays: FakeDelay[] = [];
  compressors: FakeCompressor[] = [];
  shapers: FakeShaper[] = [];
  panners: FakePanner[] = [];
  oscillators: FakeOscillator[] = [];
  convolvers: FakeConvolver[] = [];
  decoded: FakeAudioBufferImpl[] = [];
  decodeJobs: ArrayBuffer[] = [];
  /** When set, decodeAudioData rejects to simulate asset failure. */
  failDecode = false;
  /** Extra recorded assets keyed by URL path for sample loading tests. */
  assetBytes = new Map<string, ArrayBuffer>();

  override createGain(): GainNodeLike {
    const node = new FakeGainNode();
    this.gains.push(node);
    return node;
  }

  override createBufferSource(): VoiceSourceNodeLike {
    const node = new FakeVoiceSource();
    this.voices.push(node);
    this.sources.push(node);
    return node;
  }

  createBiquadFilter(): BiquadFilterNodeLike {
    const node = new FakeBiquad();
    this.filters.push(node);
    return node;
  }

  createDelay(_max = 2): DelayNodeLike {
    void _max;
    const node = new FakeDelay();
    this.delays.push(node);
    return node;
  }

  createDynamicsCompressor(): DynamicsCompressorNodeLike {
    const node = new FakeCompressor();
    this.compressors.push(node);
    return node;
  }

  createWaveShaper(): WaveShaperNodeLike {
    const node = new FakeShaper();
    this.shapers.push(node);
    return node;
  }

  createStereoPanner(): StereoPannerNodeLike {
    const node = new FakePanner();
    this.panners.push(node);
    return node;
  }

  createOscillator(): OscillatorNodeLike {
    const node = new FakeOscillator();
    this.oscillators.push(node);
    return node;
  }

  createConvolver(): ConvolverNodeLike {
    const node = new FakeConvolver();
    this.convolvers.push(node);
    return node;
  }

  async decodeAudioData(data: ArrayBuffer): Promise<FakeAudioBufferImpl> {
    this.decodeJobs.push(data);
    if (this.failDecode) throw new Error('decode failed (simulated asset failure)');
    // Deterministic 22050 Hz mono render sized from byte length.
    const length = Math.max(64, Math.floor(data.byteLength / 2));
    const buffer = new FakeAudioBufferImpl(length, 22050);
    const ch = buffer.getChannelData(0);
    const bytes = new Uint8Array(data);
    for (let i = 0; i < ch.length; i += 1) {
      ch[i] = ((bytes[i % bytes.length] ?? 128) - 128) / 128;
    }
    this.decoded.push(buffer);
    return buffer;
  }

  /** Total live node count for cleanup accounting. */
  totalNodes(): number {
    return (
      this.gains.length +
      this.voices.length +
      this.filters.length +
      this.delays.length +
      this.compressors.length +
      this.shapers.length +
      this.panners.length +
      this.oscillators.length +
      this.convolvers.length
    );
  }
}
