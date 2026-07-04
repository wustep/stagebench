// Phase 2: Piano layer management with per-layer voices, effects bus, and performance controls

export interface PianoLayerConfig {
  id: 'A' | 'B';
  enabled: boolean;
  focused: boolean;
  level: number; // 0-1 output level
  octaveShift: number; // -12 to +12 semitones
}

export interface PianoPerformanceControls {
  kbTouch: 'Heavy' | 'Medium' | 'Light'; // velocity curve
  dynComp: 0 | 1 | 2 | 3; // dynamic compression level
  timbre: 'Off' | 'Soft' | 'Mid' | 'Bright' | 'Dyno1' | 'Dyno2'; // tone shaping
  unison: 0 | 1 | 2 | 3; // detuned unison voices
  softRelease: boolean; // extended release envelope
  stringRes: boolean; // sympathetic resonance
}

export class PianoVoice {
  private audioContext: AudioContext;
  private oscillator?: OscillatorNode;
  private gainNode: GainNode;
  private layerBus: GainNode; // Per-layer effect bus input
  private envelope: GainNode;
  private note: number;
  private velocity: number;
  private startTime: number;
  private releaseTime?: number;
  private isReleasing: boolean = false;
  private performanceControls: PianoPerformanceControls;
  private unisonVoices: PianoVoice[] = [];

  constructor(
    audioContext: AudioContext,
    note: number,
    velocity: number,
    layerBus: GainNode,
    performanceControls: PianoPerformanceControls
  ) {
    this.audioContext = audioContext;
    this.note = note;
    this.velocity = velocity;
    this.startTime = audioContext.currentTime;
    this.performanceControls = performanceControls;
    this.layerBus = layerBus;

    // Create envelope for this voice
    this.envelope = audioContext.createGain();
    this.envelope.connect(layerBus);

    // Create voice gain
    this.gainNode = audioContext.createGain();
    this.gainNode.connect(this.envelope);

    // Create main oscillator
    this.oscillator = audioContext.createOscillator();
    this.oscillator.type = 'triangle';
    this.oscillator.frequency.value = this.getFrequency(0); // Octave shift handled at layer level
    this.oscillator.connect(this.gainNode);

    // Apply velocity curve based on KB Touch setting
    const velocityGain = this.applyVelocityCurve(velocity / 127);
    this.gainNode.gain.setValueAtTime(velocityGain, audioContext.currentTime);

    // Start oscillator
    this.oscillator.start(audioContext.currentTime);

    // Apply ADSR envelope
    this.applyEnvelope();

    // Create unison voices if needed
    if (this.performanceControls.unison > 0) {
      this.createUnisonVoices();
    }
  }

  private getFrequency(octaveShift: number = 0): number {
    const baseFreq = 440 * Math.pow(2, (this.note - 69) / 12);
    return baseFreq * Math.pow(2, octaveShift / 12);
  }

  private applyVelocityCurve(normalizedVelocity: number): number {
    const control = this.performanceControls.kbTouch;
    // Heavy: steeper curve (quieter touches are quieter)
    // Medium: linear
    // Light: gentler curve (quieter touches are louder)
    if (control === 'Heavy') {
      return normalizedVelocity * normalizedVelocity * 0.3;
    } else if (control === 'Light') {
      return (0.3 + normalizedVelocity * 0.7) * normalizedVelocity;
    } else {
      // Medium
      return normalizedVelocity * 0.3;
    }
  }

  private applyEnvelope(): void {
    const now = this.audioContext.currentTime;
    const attackTime = 0.05;
    const decayTime = 0.1;
    const sustainLevel = 0.7;

    this.envelope.gain.setValueAtTime(0, now);
    this.envelope.gain.linearRampToValueAtTime(1, now + attackTime);
    this.envelope.gain.linearRampToValueAtTime(sustainLevel, now + attackTime + decayTime);
  }

  private createUnisonVoices(): void {
    const detuneAmounts = [0.005, 0.01, 0.015]; // 0.5%, 1%, 1.5% detune
    const amount = Math.min(this.performanceControls.unison - 1, 2);

    for (let i = 0; i < amount; i++) {
      const detuneOscillator = this.audioContext.createOscillator();
      const detuneGain = this.audioContext.createGain();

      detuneOscillator.type = 'triangle';
      const detuneRatio = 1 + detuneAmounts[i] * (i % 2 === 0 ? 1 : -1);
      detuneOscillator.frequency.value = this.getFrequency(0) * detuneRatio;

      const velocityGain = this.applyVelocityCurve(this.velocity / 127);
      detuneGain.gain.setValueAtTime(velocityGain * 0.5, this.audioContext.currentTime);

      detuneOscillator.connect(detuneGain);
      detuneGain.connect(this.layerBus);
      detuneOscillator.start(this.audioContext.currentTime);

      (this.unisonVoices as any).push({
        oscillator: detuneOscillator,
        gainNode: detuneGain,
      });
    }
  }

  noteOff(sustainActive: boolean = false): void {
    if (this.isReleasing) return;

    this.isReleasing = true;
    this.releaseTime = this.audioContext.currentTime;

    let releaseTime = 0.3;
    if (sustainActive) {
      releaseTime = 1.0;
    }
    if (this.performanceControls.softRelease) {
      releaseTime *= 1.5; // Extend release by 50%
    }

    this.envelope.gain.cancelScheduledValues(this.audioContext.currentTime);
    this.envelope.gain.linearRampToValueAtTime(
      0,
      this.audioContext.currentTime + releaseTime
    );

    this.oscillator?.stop(this.audioContext.currentTime + releaseTime);

    // Release unison voices
    this.unisonVoices.forEach((voice: any) => {
      try {
        voice.oscillator?.stop(this.audioContext.currentTime + releaseTime);
      } catch {
        // Already stopped
      }
    });
  }

  setSustain(active: boolean): void {
    if (this.isReleasing) return;

    if (active) {
      this.envelope.gain.cancelScheduledValues(this.audioContext.currentTime);
      this.envelope.gain.setValueAtTime(0.7, this.audioContext.currentTime);
    }
  }

  isActive(): boolean {
    return !this.isReleasing && !!this.oscillator;
  }

  cleanup(): void {
    try {
      this.oscillator?.stop();
      this.gainNode.disconnect();
      this.envelope.disconnect();
      this.unisonVoices.forEach((voice: any) => {
        try {
          voice.oscillator?.stop();
          voice.gainNode?.disconnect();
        } catch {
          // Already stopped
        }
      });
    } catch {
      // Already cleaned up
    }
  }
}

export class PianoLayer {
  private audioContext: AudioContext;
  private layerId: 'A' | 'B';
  private enabled: boolean = true;
  private focused: boolean = false;
  private layerBus: GainNode; // Per-layer mix bus (before effects)
  private layerGain: GainNode; // Layer level fader
  private voices: Map<number, PianoVoice> = new Map();
  private maxPolyphony: number = 32;
  private voiceHistory: number[] = [];
  private sustainPedal: boolean = false;
  private performanceControls: PianoPerformanceControls;
  private config: PianoLayerConfig;

  constructor(
    audioContext: AudioContext,
    layerId: 'A' | 'B',
    effectsChainInput: GainNode,
    performanceControls: PianoPerformanceControls
  ) {
    this.audioContext = audioContext;
    this.layerId = layerId;
    this.performanceControls = performanceControls;

    // Create layer-specific nodes
    this.layerGain = audioContext.createGain();
    this.layerGain.gain.value = 1.0;
    this.layerGain.connect(effectsChainInput); // Routes to effects chain

    this.layerBus = audioContext.createGain();
    this.layerBus.gain.value = 1.0;
    this.layerBus.connect(this.layerGain);

    this.config = {
      id: layerId,
      enabled: true,
      focused: false,
      level: 1.0,
      octaveShift: 0,
    };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.config.enabled = enabled;

    if (!enabled) {
      // Stop all voices when layer is disabled
      this.allNotesOff();
    }
  }

  setFocused(focused: boolean): void {
    this.focused = focused;
    this.config.focused = focused;
  }

  setLevel(level: number): void {
    this.config.level = Math.max(0, Math.min(1, level));
    this.layerGain.gain.setTargetAtTime(this.config.level, this.audioContext.currentTime, 0.01);
  }

  setOctaveShift(shift: number): void {
    this.config.octaveShift = Math.max(-12, Math.min(12, shift));
    // Update frequency of all active voices
    this.voices.forEach((voice) => {
      // Voices have frequency set at creation; would need to store oscillators to update
      // For now, octave shift only affects new notes
    });
  }

  updatePerformanceControls(controls: Partial<PianoPerformanceControls>): void {
    this.performanceControls = { ...this.performanceControls, ...controls };
    // Performance controls affect new voices; could apply some retroactively
  }

  noteOn(note: number, velocity: number): void {
    if (!this.enabled) return;

    // Steal oldest voice if at polyphony limit
    if (this.voices.size >= this.maxPolyphony) {
      const oldestNote = this.voiceHistory.shift();
      if (oldestNote !== undefined) {
        this.voices.get(oldestNote)?.cleanup();
        this.voices.delete(oldestNote);
      }
    }

    // Create new voice
    const voice = new PianoVoice(
      this.audioContext,
      note,
      velocity,
      this.layerBus,
      this.performanceControls
    );

    this.voices.set(note, voice);
    this.voiceHistory.push(note);
  }

  noteOff(note: number): void {
    const voice = this.voices.get(note);
    if (voice) {
      voice.noteOff(this.sustainPedal);
      this.voiceHistory = this.voiceHistory.filter((n) => n !== note);
    }
  }

  setSustainPedal(active: boolean): void {
    this.sustainPedal = active;
    this.voices.forEach((voice) => {
      voice.setSustain(active);
    });
  }

  allNotesOff(): void {
    this.voices.forEach((_voice) => {
      _voice.noteOff(false);
    });
    this.voices.clear();
    this.voiceHistory = [];
  }

  cleanup(): void {
    this.allNotesOff();
    this.layerBus.disconnect();
    this.layerGain.disconnect();
  }

  getActiveVoiceCount(): number {
    return this.voices.size;
  }

  getConfig(): PianoLayerConfig {
    return { ...this.config };
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isFocused(): boolean {
    return this.focused;
  }
}
