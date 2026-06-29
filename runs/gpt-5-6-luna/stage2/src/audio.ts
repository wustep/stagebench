import { compressionGain, timbreProfile, type PianoState } from './pianoState';

export type PianoAudioMode = 'loading' | 'sampled' | 'fallback';
export type NoteSource = 'pointer' | 'touch' | 'computer' | 'midi';

export interface PianoAudioStatus {
  mode: PianoAudioMode;
  label: string;
  loadedRoots: number[];
  error?: string;
}

export interface PianoAudioParams {
  masterVolume: number;
  reverbMix: number;
  dynamicCompression: 0 | 1 | 2 | 3;
  timbreType: PianoState['type'];
  timbre: PianoState['timbre'];
  softRelease: boolean;
  stringResonance: boolean;
  unison: 0 | 1 | 2 | 3;
  softPedal: boolean;
}

export interface PianoAudioGraphSnapshot {
  masterGain: number;
  dryGain: number;
  wetGain: number;
  filterFrequency: number;
  compressorRatio: number;
  activeVoices: number;
  sampledVoices: number;
  fallbackVoices: number;
}

type AudioContextLike = AudioContext | OfflineAudioContext;

interface SampleAsset {
  midi: number;
  name: string;
  path: string;
}

interface Voice {
  id: number;
  note: number;
  layer: 'A' | 'B';
  source: AudioBufferSourceNode | OscillatorNode;
  gain: GainNode;
  startedAt: number;
  sampled: boolean;
  state: 'held' | 'sustained' | 'released';
  releaseTimer?: ReturnType<typeof setTimeout>;
}

export const RECORDED_PIANO_ASSETS: SampleAsset[] = [
  { midi: 33, name: 'A1', path: './audio/piano/A1.mp3' },
  { midi: 45, name: 'A2', path: './audio/piano/A2.mp3' },
  { midi: 57, name: 'A3', path: './audio/piano/A3.mp3' },
  { midi: 69, name: 'A4', path: './audio/piano/A4.mp3' },
  { midi: 81, name: 'A5', path: './audio/piano/A5.mp3' },
  { midi: 93, name: 'A6', path: './audio/piano/A6.mp3' },
  { midi: 105, name: 'A7', path: './audio/piano/A7.mp3' },
];

const DEFAULT_PARAMS: PianoAudioParams = {
  masterVolume: 0.68,
  reverbMix: 0.22,
  dynamicCompression: 0,
  timbreType: 'Grand',
  timbre: 'Off',
  softRelease: false,
  stringResonance: true,
  unison: 0,
  softPedal: false,
};

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const midiFrequency = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

function nowSeconds(context: AudioContextLike): number {
  return context.currentTime || 0;
}

function createImpulse(context: AudioContextLike, seconds = 1.8): AudioBuffer {
  const length = Math.max(1, Math.floor(context.sampleRate * seconds));
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2.5) * (channel ? 0.85 : 1);
    }
  }
  return buffer;
}

export interface PianoAudioEngineOptions {
  context?: AudioContextLike | null;
  sampleBuffers?: Map<number, AudioBuffer>;
  assetLoader?: (asset: SampleAsset, context: AudioContextLike) => Promise<AudioBuffer>;
  autoLoad?: boolean;
  maxVoices?: number;
}

export class PianoAudioEngine {
  readonly maxVoices: number;
  readonly context: AudioContextLike | null;
  readonly masterGain: GainNode | null;
  readonly pianoBus: GainNode | null;
  readonly dryGain: GainNode | null;
  readonly wetGain: GainNode | null;
  readonly reverb: ConvolverNode | null;
  readonly timbreFilter: BiquadFilterNode | null;
  readonly compressor: DynamicsCompressorNode | null;

  private readonly layerGains: Record<'A' | 'B', GainNode | null>;
  private readonly assetLoader?: PianoAudioEngineOptions['assetLoader'];
  private readonly samples = new Map<number, AudioBuffer>();
  private readonly voices = new Map<number, Voice>();
  private voiceId = 0;
  private sustain = 0;
  private sostenuto = false;
  private params: PianoAudioParams = { ...DEFAULT_PARAMS };
  private statusValue: PianoAudioStatus;

  constructor(options: PianoAudioEngineOptions = {}) {
    this.context = options.context ?? PianoAudioEngine.createContext();
    this.maxVoices = options.maxVoices ?? 32;
    this.assetLoader = options.assetLoader;
    options.sampleBuffers?.forEach((buffer, midi) => this.samples.set(midi, buffer));
    this.statusValue = { mode: this.samples.size ? 'sampled' : 'loading', label: this.samples.size ? 'SAMPLED PIANO' : 'LOADING PIANO', loadedRoots: [...this.samples.keys()].sort((a, b) => a - b) };

    if (!this.context) {
      this.statusValue = { mode: 'fallback', label: 'FALLBACK · SYNTH PIANO', loadedRoots: [], error: 'Web Audio is unavailable' };
      this.masterGain = null;
      this.pianoBus = null;
      this.dryGain = null;
      this.wetGain = null;
      this.reverb = null;
      this.timbreFilter = null;
      this.compressor = null;
      this.layerGains = { A: null, B: null };
      return;
    }

    this.masterGain = this.context.createGain();
    this.pianoBus = this.context.createGain();
    this.dryGain = this.context.createGain();
    this.wetGain = this.context.createGain();
    this.reverb = this.context.createConvolver();
    this.timbreFilter = this.context.createBiquadFilter();
    this.compressor = this.context.createDynamicsCompressor();
    this.layerGains = { A: this.context.createGain(), B: this.context.createGain() };
    this.reverb.buffer = createImpulse(this.context);
    this.timbreFilter.type = 'highshelf';
    this.timbreFilter.frequency.value = 2400;
    this.compressor.threshold.value = -20;
    this.compressor.knee.value = 18;
    this.pianoBus.connect(this.timbreFilter);
    this.timbreFilter.connect(this.compressor);
    this.compressor.connect(this.dryGain);
    this.compressor.connect(this.reverb);
    this.reverb.connect(this.wetGain);
    this.dryGain.connect(this.masterGain);
    this.wetGain.connect(this.masterGain);
    this.masterGain.connect(this.context.destination);
    this.layerGains.A?.connect(this.pianoBus);
    this.layerGains.B?.connect(this.pianoBus);
    this.setParams(this.params);
    if (options.autoLoad !== false && this.samples.size === 0) void this.prepare();
  }

  static createContext(): AudioContextLike | null {
    const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext;
    return AudioContextCtor ? new AudioContextCtor() : null;
  }

  get status(): PianoAudioStatus {
    return { ...this.statusValue, loadedRoots: [...this.statusValue.loadedRoots] };
  }

  get activeVoiceCount(): number {
    return this.voices.size;
  }

  get graphSnapshot(): PianoAudioGraphSnapshot {
    const profile = timbreProfile(this.params.timbreType, this.params.timbre);
    return {
      masterGain: this.masterGain?.gain.value ?? this.params.masterVolume,
      dryGain: this.dryGain?.gain.value ?? 1 - this.params.reverbMix,
      wetGain: this.wetGain?.gain.value ?? this.params.reverbMix,
      filterFrequency: this.timbreFilter?.frequency.value ?? 2400 * profile.high,
      compressorRatio: this.compressor?.ratio.value ?? 1 + this.params.dynamicCompression * 2,
      activeVoices: this.voices.size,
      sampledVoices: [...this.voices.values()].filter((voice) => voice.sampled).length,
      fallbackVoices: [...this.voices.values()].filter((voice) => !voice.sampled).length,
    };
  }

  async prepare(): Promise<PianoAudioStatus> {
    if (!this.context || this.samples.size > 0) {
      this.statusValue = this.samples.size ? { mode: 'sampled', label: 'SAMPLED PIANO', loadedRoots: [...this.samples.keys()].sort((a, b) => a - b) } : this.statusValue;
      return this.status;
    }
    try {
      const loader = this.assetLoader ?? (async (asset: SampleAsset, context: AudioContextLike) => {
        const response = await fetch(asset.path);
        if (!response.ok) throw new Error(`Sample ${asset.name} returned ${response.status}`);
        return context.decodeAudioData(await response.arrayBuffer());
      });
      await Promise.all(RECORDED_PIANO_ASSETS.map(async (asset) => {
        const buffer = await loader(asset, this.context!);
        this.samples.set(asset.midi, buffer);
      }));
      this.statusValue = { mode: 'sampled', label: 'SAMPLED PIANO', loadedRoots: [...this.samples.keys()].sort((a, b) => a - b) };
    } catch (error) {
      this.statusValue = { mode: 'fallback', label: 'FALLBACK · SYNTH PIANO', loadedRoots: [], error: error instanceof Error ? error.message : 'Sample decode failed' };
    }
    return this.status;
  }

  async resume(): Promise<void> {
    if (this.context && 'resume' in this.context && this.context.state === 'suspended') await this.context.resume();
  }

  setParams(next: Partial<PianoAudioParams>): void {
    this.params = { ...this.params, ...next, masterVolume: clamp(next.masterVolume ?? this.params.masterVolume), reverbMix: clamp(next.reverbMix ?? this.params.reverbMix) };
    const profile = timbreProfile(this.params.timbreType, this.params.timbre);
    const now = this.context ? nowSeconds(this.context) : 0;
    this.masterGain?.gain.setTargetAtTime(this.params.masterVolume, now, 0.01);
    this.dryGain?.gain.setTargetAtTime(1 - this.params.reverbMix, now, 0.01);
    this.wetGain?.gain.setTargetAtTime(this.params.reverbMix, now, 0.01);
    this.timbreFilter?.frequency.setTargetAtTime(2400 * profile.high, now, 0.01);
    this.timbreFilter?.gain.setTargetAtTime((profile.high - 1) * 9, now, 0.01);
    this.compressor?.ratio.setTargetAtTime(1 + this.params.dynamicCompression * 2, now, 0.01);
    this.compressor?.threshold.setTargetAtTime(-20 + this.params.dynamicCompression * 4, now, 0.01);
    this.layerGains.A?.gain.setTargetAtTime(this.params.softPedal ? 0.72 : 1, now, 0.01);
    this.layerGains.B?.gain.setTargetAtTime(this.params.softPedal ? 0.72 : 1, now, 0.01);
  }

  noteOn(note: number, velocity: number, layer: 'A' | 'B' = 'A'): Voice | null {
    if (!this.context) return null;
    void this.resume();
    if (this.voices.has(note)) this.releaseVoice(this.voices.get(note)!, true);
    if (this.voices.size >= this.maxVoices) this.stealVoice();
    const root = this.nearestRoot(note);
    const buffer = root === null ? undefined : this.samples.get(root);
    const sampled = Boolean(buffer);
    const source = sampled ? this.context.createBufferSource() : this.context.createOscillator();
    const gain = this.context.createGain();
    const voice: Voice = { id: ++this.voiceId, note, layer, source, gain, startedAt: nowSeconds(this.context), sampled, state: 'held' };
    const normalizedVelocity = clamp(velocity, 0.05, 1);
    const amplitude = compressionGain(this.params.dynamicCompression, normalizedVelocity) * (this.params.softPedal ? 0.72 : 1) * 0.34;
    const now = nowSeconds(this.context);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, amplitude), now + 0.008);
    source.connect(gain);
    gain.connect(this.layerGains[layer] ?? this.pianoBus!);
    if (sampled) {
      const bufferSource = source as AudioBufferSourceNode;
      bufferSource.buffer = buffer!;
      bufferSource.playbackRate.value = Math.pow(2, (note - root!) / 12) * (1 + this.params.unison * 0.002);
      bufferSource.start(now);
    } else {
      const oscillator = source as OscillatorNode;
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(midiFrequency(note), now);
      oscillator.start(now);
    }
    source.addEventListener('ended', () => this.removeVoice(voice));
    this.voices.set(note, voice);
    return voice;
  }

  noteOff(note: number): void {
    const voice = this.voices.get(note);
    if (!voice || voice.state === 'released') return;
    if (this.sustain > 0 || this.sostenuto) {
      voice.state = 'sustained';
      return;
    }
    this.releaseVoice(voice);
  }

  setSustain(value: number): void {
    const next = clamp(value);
    const wasDown = this.sustain > 0;
    this.sustain = next;
    if (wasDown && next === 0) {
      for (const voice of this.voices.values()) if (voice.state === 'sustained') this.releaseVoice(voice);
    }
  }

  setSostenuto(value: boolean): void {
    this.sostenuto = value;
    if (!value && this.sustain === 0) for (const voice of this.voices.values()) if (voice.state === 'sustained') this.releaseVoice(voice);
  }

  allNotesOff(): void {
    for (const voice of [...this.voices.values()]) this.releaseVoice(voice, true);
  }

  private nearestRoot(note: number): number | null {
    if (this.samples.size === 0) return null;
    return [...this.samples.keys()].reduce((closest, root) => Math.abs(root - note) < Math.abs(closest - note) ? root : closest);
  }

  private stealVoice(): void {
    const candidates = [...this.voices.values()].sort((a, b) => {
      if (a.state !== b.state) return a.state === 'released' ? -1 : 1;
      return a.startedAt - b.startedAt || a.id - b.id;
    });
    if (candidates[0]) this.releaseVoice(candidates[0], true);
  }

  private releaseVoice(voice: Voice, immediate = false): void {
    if (voice.state === 'released') return;
    voice.state = 'released';
    const now = this.context ? nowSeconds(this.context) : 0;
    const release = immediate ? 0.012 : (this.params.softRelease ? 0.8 : 0.32) * (1 + this.sustain * 0.25);
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(0.0001, now, Math.max(0.004, release / 4));
    try { voice.source.stop(now + Math.max(0.02, release * 4)); } catch { /* source already stopped */ }
    voice.releaseTimer = setTimeout(() => this.removeVoice(voice), Math.max(30, release * 1000 + 30));
  }

  private removeVoice(voice: Voice): void {
    if (this.voices.get(voice.note)?.id === voice.id) this.voices.delete(voice.note);
    if (voice.releaseTimer) clearTimeout(voice.releaseTimer);
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

export function pianoParamsFromState(state: PianoState, masterVolume: number, reverbMix: number): PianoAudioParams {
  return {
    masterVolume,
    reverbMix,
    dynamicCompression: state.dynamicCompression,
    timbreType: state.type,
    timbre: state.timbre,
    softRelease: state.softRelease,
    stringResonance: state.stringResonance,
    unison: state.unison,
    softPedal: state.softPedal,
  };
}
