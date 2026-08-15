import { AudioEngineOptions, AudioStatus } from './types';
import { PianoVoice } from './PianoVoice';

export class PianoEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private status: AudioStatus = 'uninitialized';
  private maxPolyphony: number;
  private activeVoices: Map<number, PianoVoice[]> = new Map(); // MIDI -> active voices
  private allVoices: PianoVoice[] = [];
  private isSustainActive: boolean = false;
  private listeners: Set<(status: AudioStatus) => void> = new Set();
  private voiceCountListeners: Set<(count: number) => void> = new Set();
  private isDisposed = false;

  constructor(options: AudioEngineOptions = {}) {
    this.maxPolyphony = options.maxPolyphony ?? 32;

    if (options.audioContext) {
      this.ctx = options.audioContext;
      this.setupMasterNodes();
      this.status = this.ctx.state === 'running' ? 'ready' : 'suspended';
    }
  }

  public subscribeStatus(fn: (status: AudioStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  public subscribeVoiceCount(fn: (count: number) => void): () => void {
    this.voiceCountListeners.add(fn);
    fn(this.getActiveVoiceCount());
    return () => this.voiceCountListeners.delete(fn);
  }

  private notifyStatus(newStatus: AudioStatus): void {
    this.status = newStatus;
    this.listeners.forEach(fn => fn(newStatus));
  }

  private notifyVoiceCount(): void {
    const count = this.getActiveVoiceCount();
    this.voiceCountListeners.forEach(fn => fn(count));
  }

  public async init(): Promise<void> {
    if (this.isDisposed) return;
    if (this.status === 'ready' && this.ctx?.state === 'running') return;

    this.notifyStatus('loading');

    try {
      if (!this.ctx) {
        const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtxClass) {
          this.notifyStatus('error');
          return;
        }
        this.ctx = new AudioCtxClass();
      }

      this.setupMasterNodes();

      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }

      this.notifyStatus('ready');
    } catch {
      this.notifyStatus('error');
    }
  }

  private setupMasterNodes(): void {
    if (!this.ctx || this.masterGain) return;
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(0.85, this.ctx.currentTime);
    this.masterGain.connect(this.ctx.destination);
  }

  public getStatus(): AudioStatus {
    return this.status;
  }

  public getAudioContext(): AudioContext | null {
    return this.ctx;
  }

  public getActiveVoiceCount(): number {
    return this.allVoices.filter(v => v.state !== 'dead').length;
  }

  public noteOn(midi: number, velocity: number = 0.8): void {
    if (this.isDisposed) return;

    // Lazy init / auto-resume context
    if (!this.ctx || this.ctx.state !== 'running') {
      this.init().then(() => {
        if (!this.isDisposed) this.spawnVoice(midi, velocity);
      });
      return;
    }

    this.spawnVoice(midi, velocity);
  }

  private spawnVoice(midi: number, velocity: number): void {
    if (!this.ctx || !this.masterGain) return;

    // Polyphony voice stealing check
    this.pruneDeadVoices();
    while (this.allVoices.length >= this.maxPolyphony) {
      this.stealOldestVoice();
    }

    const voice = new PianoVoice(
      this.ctx,
      this.masterGain,
      midi,
      velocity,
      this.isSustainActive,
      () => {
        this.pruneDeadVoices();
        this.notifyVoiceCount();
      }
    );

    const keyVoices = this.activeVoices.get(midi) || [];
    keyVoices.push(voice);
    this.activeVoices.set(midi, keyVoices);
    this.allVoices.push(voice);

    this.notifyVoiceCount();
  }

  public noteOff(midi: number): void {
    const keyVoices = this.activeVoices.get(midi);
    if (!keyVoices || keyVoices.length === 0) return;

    keyVoices.forEach(voice => {
      voice.noteOff(this.isSustainActive);
    });

    // Remove from active key voices map since physical/logical key is released
    this.activeVoices.delete(midi);
    this.pruneDeadVoices();
    this.notifyVoiceCount();
  }

  public setSustain(sustain: boolean): void {
    this.isSustainActive = sustain;

    if (!sustain) {
      // Release all voices that were held solely by sustain
      this.allVoices.forEach(voice => {
        if (voice.state === 'sustained') {
          voice.release();
        }
      });
    }

    this.pruneDeadVoices();
    this.notifyVoiceCount();
  }

  public isSustained(): boolean {
    return this.isSustainActive;
  }

  private stealOldestVoice(): void {
    // Stealing preference:
    // 1. A voice already in 'releasing' state
    // 2. A voice in 'sustained' state (oldest)
    // 3. The oldest active voice
    let candidate = this.allVoices.find(v => v.state === 'releasing');
    if (!candidate) {
      candidate = this.allVoices.find(v => v.state === 'sustained');
    }
    if (!candidate && this.allVoices.length > 0) {
      candidate = this.allVoices[0];
    }

    if (candidate) {
      candidate.stop(true);
      candidate.cleanup();
      this.pruneDeadVoices();
    }
  }

  private pruneDeadVoices(): void {
    this.allVoices = this.allVoices.filter(v => v.state !== 'dead');

    for (const [midi, list] of this.activeVoices.entries()) {
      const alive = list.filter(v => v.state !== 'dead');
      if (alive.length === 0) {
        this.activeVoices.delete(midi);
      } else {
        this.activeVoices.set(midi, alive);
      }
    }
  }

  public allNotesOff(): void {
    this.allVoices.forEach(voice => {
      voice.stop(true);
      voice.cleanup();
    });
    this.activeVoices.clear();
    this.allVoices = [];
    this.notifyVoiceCount();
  }

  public dispose(): void {
    this.isDisposed = true;
    this.allNotesOff();
    this.listeners.clear();
    this.voiceCountListeners.clear();

    if (this.masterGain) {
      try {
        this.masterGain.disconnect();
      } catch {
        // Disconnect safe
      }
      this.masterGain = null;
    }

    if (this.ctx && this.ctx.state !== 'closed') {
      try {
        this.ctx.close();
      } catch {
        // Safe close
      }
    }
  }
}
