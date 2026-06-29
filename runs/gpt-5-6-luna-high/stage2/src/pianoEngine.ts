/*
 * Phase 2 Piano signal boundary.
 *
 * The normal browser path is a lightweight modal/physical model: a bank of
 * inharmonic partials, a felt/noise transient, and per-note envelopes. This
 * is deliberately modelled synthesis (not a pretend sample bank), so it can
 * remain redistributable and work without a network request. If Web Audio is
 * unavailable, the same deterministic model is rendered in memory and the UI
 * reports the fallback honestly.
 */

export type InputSource = 'pointer' | 'touch' | 'keyboard' | 'midi' | 'test';
export type TouchCurve = 'Heavy' | 'Medium' | 'Light';
export type Timbre = 'Off' | 'Soft' | 'Mid' | 'Bright' | 'Dyno 1' | 'Dyno 2';
export type PianoType = 'Grand' | 'Upright' | 'Electric' | 'Clav' | 'Digital' | 'Misc';

export interface PianoControls {
  layerA: boolean; layerB: boolean; layerLevelA: number; layerLevelB: number;
  pianoType: PianoType; model: number; touch: TouchCurve; dynamicCompression: 0 | 1 | 2 | 3;
  timbre: Timbre; unison: 0 | 1 | 2 | 3; softRelease: boolean; stringResonance: boolean;
  sustain: number; sostenuto: boolean; softPedal: boolean; masterVolume: number; reverb: number;
}

export interface VoiceSnapshot { id: number; note: number; velocity: number; source: InputSource; released: boolean; startedAt: number; }
export interface RenderedAudio { samples: Float32Array; sampleRate: number; mode: 'physical-model' | 'fallback'; peak: number; rms: number; }

const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const midiFreq = (note: number) => 440 * 2 ** ((note - 69) / 12);

export function applyTouchCurve(velocity: number, curve: TouchCurve): number {
  const v = clamp(velocity);
  if (curve === 'Heavy') return clamp(v ** 1.35);
  if (curve === 'Light') return clamp(v ** 0.72);
  return v;
}

/** Deterministic modal piano renderer used by both the WebAudio and test paths. */
export function renderModelledPiano(note: number, velocity: number, options: Partial<PianoControls> = {}, seconds = 0.35, sampleRate = 22050): RenderedAudio {
  const c: PianoControls = { ...defaultPianoControls, ...options };
  const n = Math.max(1, Math.floor(seconds * sampleRate));
  const out = new Float32Array(n);
  const f = midiFreq(note);
  const v = applyTouchCurve(velocity, c.touch);
  const compression = 1 - c.dynamicCompression * 0.12;
  const timbreShift = c.timbre === 'Soft' ? -0.22 : c.timbre === 'Bright' ? 0.28 : c.timbre === 'Dyno 1' ? 0.36 : c.timbre === 'Dyno 2' ? 0.46 : c.timbre === 'Mid' ? 0.08 : 0;
  const typeShift = c.pianoType === 'Electric' ? 0.2 : c.pianoType === 'Clav' ? 0.34 : c.pianoType === 'Upright' ? -0.08 : 0;
  const modelShift = (c.model % 9) * 0.016;
  const decay = c.softRelease ? 3.1 : 5.8;
  const sustainGain = 0.58 + c.sustain * 0.34;
  const unison = c.unison * 0.0025;
  const layerGain = (c.layerA ? c.layerLevelA : 0) + (c.layerB ? c.layerLevelB * 0.9 : 0);
  const pedalGain = c.softPedal ? 0.68 : 1;
  const partials = [1, 2.01, 3.02, 4.06, 5.1, 6.2];
  const weights = [1, 0.52 + timbreShift, 0.28 + timbreShift * 0.65, 0.16 + timbreShift * 0.48, 0.09 + timbreShift * 0.3, 0.045 + timbreShift * 0.2];
  let peak = 0; let sumSq = 0;
  for (let i = 0; i < n; i += 1) {
    const t = i / sampleRate;
    const attack = Math.min(1, t / 0.004);
    const env = attack * (0.22 + 0.78 * Math.exp(-decay * t)) * (t < 0.08 ? 1 : sustainGain);
    let sample = 0;
    for (let p = 0; p < partials.length; p += 1) {
      const ph = 2 * Math.PI * f * partials[p] * t;
      sample += (weights[p] + typeShift * (p > 1 ? 0.5 : 0.15) + modelShift * (p + 1) * 0.12) * Math.sin(ph);
      if (unison) sample += weights[p] * 0.35 * Math.sin(2 * Math.PI * f * partials[p] * (1 + unison) * t);
    }
    // A short felt transient gives the attack a piano-like edge without an asset.
    const hammer = Math.sin(2 * Math.PI * (f * 8.1) * t) * Math.exp(-t * 46) * 0.11;
    const body = sample / 2.05 + hammer;
    const value = body * v * compression * c.masterVolume * layerGain * pedalGain * 0.17 * env;
    out[i] = value;
    const a = Math.abs(value); if (a > peak) peak = a; sumSq += value * value;
  }
  if (c.reverb > 0 || c.stringResonance) {
    const delay = Math.max(1, Math.floor(sampleRate * 0.095));
    const tailGain = c.reverb * 0.28 + (c.stringResonance ? 0.08 : 0);
    for (let i = delay; i < n; i += 1) out[i] += out[i - delay] * tailGain;
    peak = 0; sumSq = 0; for (const value of out) { const a = Math.abs(value); if (a > peak) peak = a; sumSq += value * value; }
  }
  return { samples: out, sampleRate, mode: 'physical-model', peak, rms: Math.sqrt(sumSq / n) };
}

export const defaultPianoControls: PianoControls = {
  layerA: true, layerB: false, layerLevelA: 0.8, layerLevelB: 0.65, pianoType: 'Grand', model: 0,
  touch: 'Medium', dynamicCompression: 0, timbre: 'Off', unison: 0, softRelease: false,
  stringResonance: true, sustain: 0, sostenuto: false, softPedal: false, masterVolume: 0.8, reverb: 0.18,
};

interface WebVoice { snapshot: VoiceSnapshot; gain: GainNode; oscillators: OscillatorNode[]; noise?: AudioBufferSourceNode; }

export class PianoEngine {
  readonly maxVoices = 24;
  readonly sampleRate: number;
  readonly audioContext: AudioContext | null;
  readonly mode: 'physical-model' | 'fallback';
  controls: PianoControls = { ...defaultPianoControls };
  midiStatus = 'MIDI unavailable';
  audioStatus: 'suspended' | 'ready' | 'fallback' | 'error' = 'fallback';
  private statusListeners = new Set<() => void>();
  private voices = new Map<number, WebVoice>();
  private noteOwners = new Map<number, number>();
  private sustained = new Set<number>();
  private sostenutoHeld = new Set<number>();
  private nextId = 1;
  private clock = 0;
  private masterGain: GainNode | null = null;
  private reverbGain: GainNode | null = null;
  private wetDelay: DelayNode | null = null;

  constructor(context?: AudioContext | null) {
    this.audioContext = context ?? PianoEngine.createContext();
    this.sampleRate = this.audioContext?.sampleRate ?? 22050;
    this.mode = this.audioContext ? 'physical-model' : 'fallback';
    this.audioStatus = this.audioContext ? (this.audioContext.state === 'running' ? 'ready' : 'suspended') : 'fallback';
    if (this.audioContext) this.configureGraph();
  }

  private static createContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try { return new Ctor(); } catch { return null; }
  }

  private configureGraph() {
    const ctx = this.audioContext!;
    this.masterGain = ctx.createGain();
    this.reverbGain = ctx.createGain();
    this.wetDelay = ctx.createDelay(2);
    this.wetDelay.delayTime.value = 0.095;
    this.masterGain.gain.value = this.controls.masterVolume;
    this.reverbGain.gain.value = this.controls.reverb;
    this.masterGain.connect(ctx.destination);
    this.wetDelay.connect(this.reverbGain).connect(this.masterGain);
  }

  get status() {
    if (this.audioStatus === 'fallback') return 'Fallback model ready (Web Audio unavailable)';
    if (this.audioStatus === 'suspended') return 'AudioContext suspended — interact to start';
    if (this.audioStatus === 'error') return 'Audio error — fallback model available';
    return 'Modelled piano ready';
  }
  get activeVoices() { return [...this.voices.values()].map(v => v.snapshot); }
  subscribeStatus(listener: () => void) { this.statusListeners.add(listener); return () => { this.statusListeners.delete(listener); }; }
  private notifyStatus() { for (const listener of this.statusListeners) listener(); }

  async resumeAudio(): Promise<boolean> {
    if (!this.audioContext) return false;
    if (this.audioContext.state === 'running') { this.audioStatus = 'ready'; this.notifyStatus(); return true; }
    try { await this.audioContext.resume(); this.audioStatus = 'ready'; this.notifyStatus(); return true; }
    catch { this.audioStatus = 'error'; this.notifyStatus(); return false; }
  }

  setControl<K extends keyof PianoControls>(key: K, value: PianoControls[K]) {
    this.controls[key] = value;
    if (key === 'masterVolume' && this.masterGain) this.masterGain.gain.setTargetAtTime(Number(value), this.audioContext!.currentTime, 0.01);
    if (key === 'reverb' && this.reverbGain) this.reverbGain.gain.setTargetAtTime(Number(value), this.audioContext!.currentTime, 0.02);
    if (key === 'stringResonance' && this.wetDelay) this.wetDelay.delayTime.setTargetAtTime(value ? 0.095 : 0.045, this.audioContext!.currentTime, 0.02);
  }
  setMasterVolume(value: number) { this.setControl('masterVolume', clamp(value)); }
  setReverb(value: number) { this.setControl('reverb', clamp(value)); }

  noteOn(note: number, velocity = 0.8, source: InputSource = 'test') {
    void this.resumeAudio();
    const midiNote = Math.max(0, Math.min(127, Math.round(note)));
    const existing = this.noteOwners.get(midiNote);
    if (existing) this.releaseVoice(existing, true);
    if (this.voices.size >= this.maxVoices) this.stealVoice();
    const snapshot: VoiceSnapshot = { id: this.nextId++, note: midiNote, velocity: applyTouchCurve(velocity, this.controls.touch), source, released: false, startedAt: this.clock++ };
    const voice = this.createVoice(snapshot);
    this.voices.set(snapshot.id, voice); this.noteOwners.set(midiNote, snapshot.id);
    return snapshot.id;
  }

  noteOff(note: number, _source: InputSource = 'test') {
    const id = this.noteOwners.get(Math.round(note));
    if (!id) return;
    if (this.controls.sustain > 0.05 || this.sostenutoHeld.has(id)) { this.sustained.add(id); return; }
    this.releaseVoice(id);
  }

  setSustain(value: number) {
    const previous = this.controls.sustain; this.controls.sustain = clamp(value);
    if (previous > 0.05 && this.controls.sustain <= 0.05) for (const id of [...this.sustained]) { if (!this.sostenutoHeld.has(id)) { this.sustained.delete(id); this.releaseVoice(id); } }
  }
  setSostenuto(value: boolean) {
    this.controls.sostenuto = value;
    if (value) this.sostenutoHeld = new Set([...this.noteOwners.values()]);
    else for (const id of [...this.sustained]) { if (this.sostenutoHeld.has(id)) { this.sustained.delete(id); if (this.controls.sustain <= 0.05) this.releaseVoice(id); } }
    if (!value) this.sostenutoHeld.clear();
  }
  allNotesOff() { for (const id of [...this.voices.keys()]) this.releaseVoice(id, true); this.sustained.clear(); this.sostenutoHeld.clear(); this.noteOwners.clear(); }
  dispose() { this.allNotesOff(); this.masterGain?.disconnect(); this.reverbGain?.disconnect(); this.wetDelay?.disconnect(); this.statusListeners.clear(); }

  private stealVoice() {
    const candidate = [...this.voices.values()].sort((a, b) => Number(b.snapshot.released) - Number(a.snapshot.released) || a.snapshot.startedAt - b.snapshot.startedAt)[0];
    if (candidate) this.releaseVoice(candidate.snapshot.id, true);
  }
  private createVoice(snapshot: VoiceSnapshot): WebVoice {
    if (!this.audioContext || !this.masterGain || !this.wetDelay) return { snapshot, gain: null as unknown as GainNode, oscillators: [] };
    const ctx = this.audioContext; const gain = ctx.createGain(); const f = midiFreq(snapshot.note);
    const ratios = [1, 2.01, 3.02, 4.06, 5.1]; const oscillators = ratios.map((ratio, i) => { const o = ctx.createOscillator(); o.type = i === 0 ? 'triangle' : 'sine'; o.frequency.value = f * ratio; o.detune.value = this.controls.model * 0.15 + this.controls.unison * (i % 2 ? 5 : -3); const partialGain = ctx.createGain(); partialGain.gain.value = [1, .44, .24, .12, .06][i] / 2.2; o.connect(partialGain).connect(gain); o.start(); return o; });
    const layerGain = (this.controls.layerA ? this.controls.layerLevelA : 0) + (this.controls.layerB ? this.controls.layerLevelB * 0.9 : 0);
    const peak = Math.max(0.001, snapshot.velocity * layerGain * (this.controls.softPedal ? 0.68 : 1)); gain.gain.setValueAtTime(0.0001, ctx.currentTime); gain.gain.linearRampToValueAtTime(peak * 0.19, ctx.currentTime + 0.006); gain.connect(this.masterGain); gain.connect(this.wetDelay); return { snapshot, gain, oscillators };
  }
  private releaseVoice(id: number, immediate = false) {
    const voice = this.voices.get(id); if (!voice) return;
    voice.snapshot.released = true; this.noteOwners.delete(voice.snapshot.note);
    if (this.audioContext && voice.gain) { const now = this.audioContext.currentTime; const duration = immediate ? 0.01 : (this.controls.softRelease ? 0.7 : 0.25) * (1 - this.controls.sustain * 0.45); voice.gain.gain.cancelScheduledValues(now); voice.gain.gain.setTargetAtTime(0.0001, now, duration / 4); if (immediate) this.voices.delete(id); const dispose = () => { for (const o of voice.oscillators) { try { o.stop(now + duration); } catch { /* already stopped */ } o.disconnect(); } voice.gain.disconnect(); this.voices.delete(id); }; if (immediate) dispose(); else globalThis.setTimeout(dispose, duration * 1000 + 20); } else this.voices.delete(id);
  }

  /** Render a deterministic boundary result for tests, demos, and offline fallback. */
  renderNote(note: number, velocity = 0.8, seconds = 0.35): RenderedAudio { const rendered = renderModelledPiano(note, velocity, this.controls, seconds, this.sampleRate); return { ...rendered, mode: this.mode }; }

  async connectMidi(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) { this.midiStatus = 'MIDI unavailable'; return false; }
    try { const access = await navigator.requestMIDIAccess(); for (const input of access.inputs.values()) input.onmidimessage = (event) => this.handleMidi(event); access.onstatechange = () => { const count = [...access.inputs.values()].filter(input => input.state === 'connected').length; this.midiStatus = count ? `${count} MIDI input${count === 1 ? '' : 's'} connected` : 'MIDI disconnected'; this.notifyStatus(); }; this.midiStatus = `${access.inputs.size} MIDI input${access.inputs.size === 1 ? '' : 's'} connected`; this.notifyStatus(); return true; } catch { this.midiStatus = 'MIDI permission denied'; this.notifyStatus(); return false; }
  }
  handleMidi(event: MIDIMessageEvent | { data: Uint8Array | number[] }) { const data = Array.from(event.data as ArrayLike<number>); const [status, note, value] = data; const command = status & 0xf0; if (command === 0x90 && value > 0) this.noteOn(note, value / 127, 'midi'); else if (command === 0x80 || (command === 0x90 && value === 0)) this.noteOff(note, 'midi'); else if (command === 0xb0 && note === 64) this.setSustain(value / 127); else if (command === 0xb0 && note === 67) this.setControl('softPedal', value > 63); }
}
