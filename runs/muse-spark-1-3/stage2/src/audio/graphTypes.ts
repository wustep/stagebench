/**
 * Phase 2 extended Web Audio surface: filters, delays, dynamics, shapers,
 * panners, oscillators, and convolvers for the piano/effects graph.
 *
 * Additive over `types.ts` (which stays byte-identical for the Phase 1
 * regression): every interface here extends the Phase 1 shape, and the live
 * `StageEngine` only touches `StageAudioContextLike`, so tests inject
 * `StageFakeContext` with zero audio output.
 */

import type { AudioContextLike, AudioNodeLike, BufferSourceNodeLike } from './types';

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): void;
  linearRampToValueAtTime(value: number, endTime: number): void;
  setTargetAtTime(target: number, startTime: number, timeConstant: number): void;
  cancelScheduledValues(cancelTime: number): void;
}

export type BiquadType =
  | 'lowpass'
  | 'highpass'
  | 'bandpass'
  | 'peaking'
  | 'lowshelf'
  | 'highshelf'
  | 'notch';

export interface BiquadFilterNodeLike extends AudioNodeLike {
  type: BiquadType;
  frequency: AudioParamLike;
  Q: AudioParamLike;
  gain: AudioParamLike;
}

export interface DelayNodeLike extends AudioNodeLike {
  delayTime: AudioParamLike;
}

export interface DynamicsCompressorNodeLike extends AudioNodeLike {
  threshold: AudioParamLike;
  knee: AudioParamLike;
  ratio: AudioParamLike;
  attack: AudioParamLike;
  release: AudioParamLike;
}

export interface WaveShaperNodeLike extends AudioNodeLike {
  curve: Float32Array | null;
  oversample: string;
}

export interface StereoPannerNodeLike extends AudioNodeLike {
  pan: AudioParamLike;
}

export type OscillatorWaveform = 'sine' | 'square' | 'triangle' | 'sawtooth';

export interface OscillatorNodeLike extends AudioNodeLike {
  type: OscillatorWaveform;
  frequency: AudioParamLike;
  onended: (() => void) | null;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface ConvolverNodeLike extends AudioNodeLike {
  buffer: { sampleRate: number; length: number } | null;
}

/** Buffer source with pitch controls (superset of the Phase 1 source). */
export interface VoiceSourceNodeLike extends BufferSourceNodeLike {
  playbackRate: AudioParamLike;
  detune: AudioParamLike;
}

export interface StageAudioContextLike extends AudioContextLike {
  createBufferSource(): VoiceSourceNodeLike;
  createBiquadFilter(): BiquadFilterNodeLike;
  createDelay(maxDelayTime?: number): DelayNodeLike;
  createDynamicsCompressor(): DynamicsCompressorNodeLike;
  createWaveShaper(): WaveShaperNodeLike;
  createStereoPanner(): StereoPannerNodeLike;
  createOscillator(): OscillatorNodeLike;
  createConvolver(): ConvolverNodeLike;
  decodeAudioData(data: ArrayBuffer): Promise<{ getChannelData(c: number): Float32Array; sampleRate: number; length: number; duration: number }>;
}

export type StageAudioContextFactory = () => StageAudioContextLike | null;
