export type AudioStatus = 'uninitialized' | 'loading' | 'ready' | 'error' | 'suspended';

export interface AudioEngineOptions {
  audioContext?: AudioContext;
  maxPolyphony?: number;
  sampleRate?: number;
}

export interface VoiceNodeStats {
  activeVoices: number;
  sustainedVoices: number;
  totalAllocatedNodes: number;
}
