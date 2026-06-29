import { compressionGain, timbreProfile, type PianoState } from './pianoState';
import { EFFECT_ORDER, createInitialEffectRack, type EffectRackState } from './effects';

export type PianoAudioMode = 'loading' | 'sampled' | 'fallback';
export type NoteSource = 'pointer' | 'touch' | 'computer' | 'midi';
export type AudioContextLike = AudioContext | OfflineAudioContext;
export type SourceLayerId = 'pianoA' | 'pianoB' | 'organA' | 'organB' | 'synthA' | 'synthB' | 'synthC';

export interface PianoAudioStatus { mode: PianoAudioMode; label: string; loadedRoots: number[]; error?: string }
export interface PianoAudioParams { masterVolume: number; reverbMix: number; dynamicCompression: 0 | 1 | 2 | 3; timbreType: PianoState['type']; timbre: PianoState['timbre']; softRelease: boolean; stringResonance: boolean; unison: 0 | 1 | 2 | 3; softPedal: boolean }
export interface PianoAudioGraphSnapshot {
  masterGain: number;
  dryGain: number;
  wetGain: number;
  filterFrequency: number;
  compressorRatio: number;
  activeVoices: number;
  sampledVoices: number;
  fallbackVoices: number;
  contextCount: 1;
  layerBuses: string[];
  sourceBuses: SourceLayerId[];
  effectOrder: string[];
  limiter: boolean;
  allEffectsBypass: boolean;
}

export interface SampleAsset { midi: number; name: string; path: string }
interface Voice { id: number; note: number; layer: 'A' | 'B'; source: AudioBufferSourceNode | OscillatorNode; gain: GainNode; startedAt: number; sampled: boolean; state: 'held' | 'sustained' | 'released'; releaseTimer?: ReturnType<typeof setTimeout> }
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const midiFrequency = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
const nowSeconds = (context: AudioContextLike) => context.currentTime || 0;

export const RECORDED_PIANO_ASSETS: SampleAsset[] = [
  { midi: 33, name: 'A1', path: './audio/piano/A1.mp3' }, { midi: 45, name: 'A2', path: './audio/piano/A2.mp3' },
  { midi: 57, name: 'A3', path: './audio/piano/A3.mp3' }, { midi: 69, name: 'A4', path: './audio/piano/A4.mp3' },
  { midi: 81, name: 'A5', path: './audio/piano/A5.mp3' }, { midi: 93, name: 'A6', path: './audio/piano/A6.mp3' },
  { midi: 105, name: 'A7', path: './audio/piano/A7.mp3' },
];

function createImpulse(context: AudioContextLike, seconds = 1.8): AudioBuffer {
  const buffer = context.createBuffer(2, Math.max(1, Math.floor(context.sampleRate * seconds)), context.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) data[index] = (Math.random() * 2 - 1) * Math.pow(1 - index / data.length, 2.5);
  }
  return buffer;
}

interface LayerChain {
  input: GainNode;
  mod1: GainNode;
  mod1Lfo: OscillatorNode;
  mod2: BiquadFilterNode;
  delayInput: GainNode;
  delayDry: GainNode;
  delay: DelayNode;
  delayWet: GainNode;
  delayFeedback: GainNode;
  delaySum: GainNode;
  amp: WaveShaperNode;
  eq: BiquadFilterNode;
  compressor: DynamicsCompressorNode;
  reverbInput: GainNode;
  reverbDry: GainNode;
  reverb: ConvolverNode;
  reverbWet: GainNode;
  reverbSum: GainNode;
  rotary: GainNode;
  rotaryLfo: OscillatorNode;
}

function curveForDrive(drive: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(128 * Float32Array.BYTES_PER_ELEMENT));
  for (let index = 0; index < curve.length; index += 1) {
    const x = (index / (curve.length - 1)) * 2 - 1;
    curve[index] = Math.tanh(x * (1 + drive * 10));
  }
  return curve;
}

const SOURCE_LAYER_IDS: SourceLayerId[] = ['pianoA', 'pianoB', 'organA', 'organB', 'synthA', 'synthB', 'synthC'];

export class SharedAudioGraph {
  readonly context: AudioContextLike | null;
  readonly destination: AudioDestinationNode | null;
  readonly masterBus: GainNode | null;
  readonly limiter: DynamicsCompressorNode | null;
  readonly layerBuses: Record<'A' | 'B', GainNode | null>;
  readonly sourceBuses: Record<SourceLayerId, GainNode | null>;
  readonly chains: Record<SourceLayerId, LayerChain | null>;
  private effects: EffectRackState = createInitialEffectRack();
  private allBypass = false;

  constructor(context: AudioContextLike | null) {
    this.context = context;
    if (!context) {
      this.destination = null; this.masterBus = null; this.limiter = null;
      this.layerBuses = { A: null, B: null };
      this.sourceBuses = Object.fromEntries(SOURCE_LAYER_IDS.map((id) => [id, null])) as Record<SourceLayerId, GainNode | null>;
      this.chains = Object.fromEntries(SOURCE_LAYER_IDS.map((id) => [id, null])) as Record<SourceLayerId, LayerChain | null>;
      return;
    }
    this.destination = context.destination;
    this.masterBus = context.createGain();
    this.limiter = context.createDynamicsCompressor();
    this.limiter.threshold.value = -1; this.limiter.knee.value = 0; this.limiter.ratio.value = 20;
    this.masterBus.connect(this.limiter); this.limiter.connect(context.destination);
    this.sourceBuses = Object.fromEntries(SOURCE_LAYER_IDS.map((id) => [id, context.createGain()])) as Record<SourceLayerId, GainNode>;
    this.layerBuses = { A: this.sourceBuses.pianoA, B: this.sourceBuses.pianoB };
    this.chains = Object.fromEntries(SOURCE_LAYER_IDS.map((id) => [id, this.createLayerChain(this.sourceBuses[id])])) as Record<SourceLayerId, LayerChain>;
    this.setEffects(this.effects, 'Piano', false);
  }

  private createLayerChain(input: GainNode): LayerChain {
    const context = this.context!;
    const chain: LayerChain = {
      input, mod1: context.createGain(), mod1Lfo: context.createOscillator(), mod2: context.createBiquadFilter(),
      delayInput: context.createGain(), delayDry: context.createGain(), delay: context.createDelay(2), delayWet: context.createGain(), delayFeedback: context.createGain(), delaySum: context.createGain(),
      amp: context.createWaveShaper(), eq: context.createBiquadFilter(), compressor: context.createDynamicsCompressor(),
      reverbInput: context.createGain(), reverbDry: context.createGain(), reverb: context.createConvolver(), reverbWet: context.createGain(), reverbSum: context.createGain(),
      rotary: context.createGain(), rotaryLfo: context.createOscillator(),
    };
    chain.mod1Lfo.frequency.value = 1.2; chain.mod1Lfo.connect(chain.mod1.gain); chain.mod1Lfo.start();
    chain.mod2.type = 'peaking'; chain.mod2.frequency.value = 900; chain.mod2.Q.value = 0.8;
    chain.delay.connect(chain.delayFeedback); chain.delayFeedback.connect(chain.delay);
    chain.eq.type = 'highshelf'; chain.eq.frequency.value = 2400;
    chain.amp.curve = curveForDrive(0.1); chain.amp.oversample = '2x';
    chain.reverb.buffer = createImpulse(context); chain.compressor.threshold.value = -18; chain.compressor.knee.value = 18;
    chain.rotaryLfo.frequency.value = 0.8; chain.rotaryLfo.connect(chain.rotary.gain); chain.rotaryLfo.start();
    input.connect(chain.mod1); chain.mod1.connect(chain.mod2); chain.mod2.connect(chain.delayInput);
    chain.delayInput.connect(chain.delayDry); chain.delayInput.connect(chain.delay); chain.delay.connect(chain.delayWet);
    chain.delayDry.connect(chain.delaySum); chain.delayWet.connect(chain.delaySum); chain.delaySum.connect(chain.amp); chain.amp.connect(chain.eq); chain.eq.connect(chain.compressor);
    chain.compressor.connect(chain.reverbInput); chain.reverbInput.connect(chain.reverbDry); chain.reverbInput.connect(chain.reverb); chain.reverb.connect(chain.reverbWet);
    chain.reverbDry.connect(chain.reverbSum); chain.reverbWet.connect(chain.reverbSum); chain.reverbSum.connect(chain.rotary); chain.rotary.connect(this.masterBus!);
    return chain;
  }

  setLayerState(layer: 'A' | 'B', enabled: boolean, level: number): void { this.setSourceLayerState(layer === 'A' ? 'pianoA' : 'pianoB', enabled, level); }
  setSourceLayerState(layer: SourceLayerId, enabled: boolean, level: number): void {
    const gain = this.sourceBuses[layer]?.gain; if (!gain) return;
    gain.setTargetAtTime(enabled ? clamp(level) : 0, this.context?.currentTime ?? 0, 0.012);
  }

  setEffects(next: EffectRackState, focus: 'Organ' | 'Piano' | 'Synth' = 'Piano', allBypass = false): void {
    this.effects = next; this.allBypass = allBypass;
    for (const chain of Object.values(this.chains)) if (chain) {
      const values = (id: keyof EffectRackState) => next[id];
      const mod1 = values('mod1'); const mod2 = values('mod2'); const delay = values('delay'); const amp = values('ampEq'); const comp = values('compressor'); const reverb = values('reverb'); const rotary = values('rotary');
      const active = (enabled: boolean, target: string, global: boolean) => !allBypass && enabled && (global || target === focus || target === 'Piano');
      const now = this.context?.currentTime ?? 0;
      chain.mod1Lfo.frequency.setTargetAtTime(active(mod1.enabled, mod1.target, mod1.global) ? 0.2 + mod1.rate * 8 : 0, now, 0.015);
      chain.mod1.gain.setTargetAtTime(1, now, 0.015);
      chain.mod2.gain.setTargetAtTime(active(mod2.enabled, mod2.target, mod2.global) ? mod2.amount * 10 : 0, now, 0.015);
      chain.delayDry.gain.setTargetAtTime(active(delay.enabled, delay.target, delay.global) ? 1 - delay.dryWet : 1, now, 0.015);
      chain.delayWet.gain.setTargetAtTime(active(delay.enabled, delay.target, delay.global) ? delay.dryWet : 0, now, 0.015);
      chain.delay.delayTime.setTargetAtTime(0.04 + delay.rate * 0.75, now, 0.015); chain.delayFeedback.gain.setTargetAtTime(active(delay.enabled, delay.target, delay.global) ? clamp(delay.feedback, 0, 0.9) : 0, now, 0.015);
      chain.amp.curve = curveForDrive(active(amp.enabled, amp.target, amp.global) ? amp.drive : 0);
      chain.eq.gain.setTargetAtTime(active(amp.enabled, amp.target, amp.global) ? (amp.amount - 0.5) * 12 : 0, now, 0.015);
      chain.compressor.ratio.setTargetAtTime(active(comp.enabled, comp.target, comp.global) ? 1 + comp.amount * 10 : 1, now, 0.015);
      chain.reverbDry.gain.setTargetAtTime(active(reverb.enabled, reverb.target, reverb.global) ? 1 - reverb.dryWet : 1, now, 0.015);
      chain.reverbWet.gain.setTargetAtTime(active(reverb.enabled, reverb.target, reverb.global) ? reverb.dryWet : 0, now, 0.015);
      chain.rotaryLfo.frequency.setTargetAtTime(active(rotary.enabled, rotary.target, rotary.global) && rotary.toRotary ? 0.3 + rotary.rate * 7 : 0, now, 0.015);
    }
  }

  snapshot(): Pick<PianoAudioGraphSnapshot, 'contextCount' | 'layerBuses' | 'sourceBuses' | 'effectOrder' | 'limiter' | 'allEffectsBypass'> {
    return { contextCount: 1, layerBuses: ['A', 'B'], sourceBuses: [...SOURCE_LAYER_IDS], effectOrder: [...EFFECT_ORDER], limiter: Boolean(this.limiter), allEffectsBypass: this.allBypass };
  }

  dispose(): void {
    for (const chain of Object.values(this.chains)) if (chain) { try { chain.mod1Lfo.stop(); chain.rotaryLfo.stop(); } catch { /* already stopped */ } }
    for (const node of [this.masterBus, this.limiter, ...Object.values(this.sourceBuses)]) node?.disconnect();
  }
}

const DEFAULT_PARAMS: PianoAudioParams = { masterVolume: 0.68, reverbMix: 0.22, dynamicCompression: 0, timbreType: 'Grand', timbre: 'Off', softRelease: false, stringResonance: true, unison: 0, softPedal: false };

export interface PianoAudioEngineOptions {
  context?: AudioContextLike | null;
  graph?: SharedAudioGraph;
  sampleBuffers?: Map<number, AudioBuffer>;
  assetLoader?: (asset: SampleAsset, context: AudioContextLike) => Promise<AudioBuffer>;
  autoLoad?: boolean;
  maxVoices?: number;
}

export class PianoAudioEngine {
  readonly maxVoices: number;
  readonly context: AudioContextLike | null;
  readonly graph: SharedAudioGraph;
  readonly masterGain: GainNode | null;
  readonly pianoBus: GainNode | null;
  readonly dryGain: GainNode | null;
  readonly wetGain: GainNode | null;
  readonly reverb: ConvolverNode | null;
  readonly timbreFilter: BiquadFilterNode | null;
  readonly compressor: DynamicsCompressorNode | null;
  private readonly assetLoader?: PianoAudioEngineOptions['assetLoader'];
  private readonly samples = new Map<number, AudioBuffer>();
  private readonly voices = new Map<number, Voice>();
  private readonly layerEnabled: Record<'A' | 'B', boolean> = { A: true, B: false };
  private voiceId = 0; private sustain = 0; private sostenuto = false; private params: PianoAudioParams = { ...DEFAULT_PARAMS };
  private statusValue: PianoAudioStatus;

  constructor(options: PianoAudioEngineOptions = {}) {
    this.context = options.graph?.context ?? options.context ?? PianoAudioEngine.createContext(); this.graph = options.graph ?? new SharedAudioGraph(this.context);
    this.maxVoices = options.maxVoices ?? 32; this.assetLoader = options.assetLoader; options.sampleBuffers?.forEach((buffer, midi) => this.samples.set(midi, buffer));
    this.statusValue = { mode: this.samples.size ? 'sampled' : 'loading', label: this.samples.size ? 'SAMPLED PIANO' : 'LOADING PIANO', loadedRoots: [...this.samples.keys()].sort((a, b) => a - b) };
    this.masterGain = this.graph.masterBus; this.pianoBus = this.graph.layerBuses.A; this.dryGain = null; this.wetGain = null; this.reverb = null; this.timbreFilter = null; this.compressor = this.graph.limiter;
    if (!this.context) this.statusValue = { mode: 'fallback', label: 'FALLBACK · SYNTH PIANO', loadedRoots: [], error: 'Web Audio is unavailable' };
    this.setParams(this.params); if (options.autoLoad !== false && this.samples.size === 0) void this.prepare();
  }

  static createContext(): AudioContextLike | null { const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext; return AudioContextCtor ? new AudioContextCtor() : null; }
  get status(): PianoAudioStatus { return { ...this.statusValue, loadedRoots: [...this.statusValue.loadedRoots] }; }
  get activeVoiceCount(): number { return this.voices.size; }
  get graphSnapshot(): PianoAudioGraphSnapshot {
    const profile = timbreProfile(this.params.timbreType, this.params.timbre);
    const graph = this.graph.snapshot();
    return { masterGain: this.masterGain?.gain.value ?? this.params.masterVolume, dryGain: 1 - this.params.reverbMix, wetGain: this.params.reverbMix, filterFrequency: 2400 * profile.high, compressorRatio: this.compressor?.ratio.value ?? 1 + this.params.dynamicCompression * 2, activeVoices: this.voices.size, sampledVoices: [...this.voices.values()].filter((voice) => voice.sampled).length, fallbackVoices: [...this.voices.values()].filter((voice) => !voice.sampled).length, ...graph };
  }
  get graphTopology() { return this.graph.snapshot(); }
  async prepare(): Promise<PianoAudioStatus> {
    if (!this.context || this.samples.size > 0) { if (this.samples.size) this.statusValue = { mode: 'sampled', label: 'SAMPLED PIANO', loadedRoots: [...this.samples.keys()].sort((a, b) => a - b) }; return this.status; }
    try {
      const loader = this.assetLoader ?? (async (asset: SampleAsset, context: AudioContextLike) => { const response = await fetch(asset.path); if (!response.ok) throw new Error(`Sample ${asset.name} returned ${response.status}`); return context.decodeAudioData(await response.arrayBuffer()); });
      await Promise.all(RECORDED_PIANO_ASSETS.map(async (asset) => this.samples.set(asset.midi, await loader(asset, this.context!))));
      this.statusValue = { mode: 'sampled', label: 'SAMPLED PIANO', loadedRoots: [...this.samples.keys()].sort((a, b) => a - b) };
    } catch (error) { this.statusValue = { mode: 'fallback', label: 'FALLBACK · SYNTH PIANO', loadedRoots: [], error: error instanceof Error ? error.message : 'Sample decode failed' }; }
    return this.status;
  }
  async resume(): Promise<void> { if (this.context && 'resume' in this.context && this.context.state === 'suspended') await this.context.resume(); }
  setParams(next: Partial<PianoAudioParams>): void { this.params = { ...this.params, ...next, masterVolume: clamp(next.masterVolume ?? this.params.masterVolume), reverbMix: clamp(next.reverbMix ?? this.params.reverbMix) }; this.masterGain?.gain.setTargetAtTime(this.params.masterVolume, this.context?.currentTime ?? 0, 0.01); }
  setLayerState(layer: 'A' | 'B', enabled: boolean, level: number): void { this.layerEnabled[layer] = enabled; this.graph.setLayerState(layer, enabled, level); }
  setEffects(effects: EffectRackState, focus: 'Organ' | 'Piano' | 'Synth', allBypass: boolean): void { this.graph.setEffects(effects, focus, allBypass); }
  noteOn(note: number, velocity: number, layer: 'A' | 'B' = 'A'): Voice | null {
    if (!this.context || !this.layerEnabled[layer]) return null; void this.resume(); if (this.voices.has(note)) this.releaseVoice(this.voices.get(note)!, true); if (this.voices.size >= this.maxVoices) this.stealVoice();
    const root = this.nearestRoot(note); const buffer = root === null ? undefined : this.samples.get(root); const sampled = Boolean(buffer); const source = sampled ? this.context.createBufferSource() : this.context.createOscillator(); const gain = this.context.createGain(); const voice: Voice = { id: ++this.voiceId, note, layer, source, gain, startedAt: nowSeconds(this.context), sampled, state: 'held' };
    const amplitude = compressionGain(this.params.dynamicCompression, clamp(velocity, 0.05, 1)) * (this.params.softPedal ? 0.72 : 1) * 0.34; const now = nowSeconds(this.context); gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, amplitude), now + 0.008); source.connect(gain); gain.connect(this.graph.layerBuses[layer]!);
    if (sampled) { const bufferSource = source as AudioBufferSourceNode; bufferSource.buffer = buffer!; bufferSource.playbackRate.value = Math.pow(2, (note - root!) / 12) * (1 + this.params.unison * 0.002); bufferSource.start(now); } else { const oscillator = source as OscillatorNode; oscillator.type = 'triangle'; oscillator.frequency.setValueAtTime(midiFrequency(note), now); oscillator.start(now); }
    source.addEventListener('ended', () => this.removeVoice(voice)); this.voices.set(note, voice); return voice;
  }
  noteOff(note: number): void { const voice = this.voices.get(note); if (!voice || voice.state === 'released') return; if (this.sustain > 0 || this.sostenuto) { voice.state = 'sustained'; return; } this.releaseVoice(voice); }
  setSustain(value: number): void { const next = clamp(value); const wasDown = this.sustain > 0; this.sustain = next; if (wasDown && next === 0) for (const voice of this.voices.values()) if (voice.state === 'sustained') this.releaseVoice(voice); }
  setSostenuto(value: boolean): void { this.sostenuto = value; if (!value && this.sustain === 0) for (const voice of this.voices.values()) if (voice.state === 'sustained') this.releaseVoice(voice); }
  allNotesOff(): void { for (const voice of [...this.voices.values()]) this.releaseVoice(voice, true); }
  dispose(): void { this.allNotesOff(); this.graph.dispose(); }
  private nearestRoot(note: number): number | null { if (!this.samples.size) return null; return [...this.samples.keys()].reduce((closest, root) => Math.abs(root - note) < Math.abs(closest - note) ? root : closest); }
  private stealVoice(): void { const candidates = [...this.voices.values()].sort((a, b) => (a.state !== b.state ? (a.state === 'released' ? -1 : 1) : a.startedAt - b.startedAt || a.id - b.id)); if (candidates[0]) this.releaseVoice(candidates[0], true); }
  private releaseVoice(voice: Voice, immediate = false): void { if (voice.state === 'released') return; voice.state = 'released'; const now = this.context ? nowSeconds(this.context) : 0; const release = immediate ? 0.012 : 0.32 * (1 + this.sustain * 0.25); voice.gain.gain.cancelScheduledValues(now); voice.gain.gain.setTargetAtTime(0.0001, now, Math.max(0.004, release / 4)); try { voice.source.stop(now + Math.max(0.02, release * 4)); } catch { /* already stopped */ } voice.releaseTimer = setTimeout(() => this.removeVoice(voice), Math.max(30, release * 1000 + 30)); }
  private removeVoice(voice: Voice): void { if (this.voices.get(voice.note)?.id === voice.id) this.voices.delete(voice.note); if (voice.releaseTimer) clearTimeout(voice.releaseTimer); }
}

declare global { interface Window { webkitAudioContext?: typeof AudioContext } }

export function pianoParamsFromState(state: PianoState, masterVolume: number, reverbMix: number): PianoAudioParams { return { masterVolume, reverbMix, dynamicCompression: state.dynamicCompression, timbreType: state.type, timbre: state.timbre, softRelease: state.softRelease, stringResonance: state.stringResonance, unison: state.unison, softPedal: state.softPedal }; }
