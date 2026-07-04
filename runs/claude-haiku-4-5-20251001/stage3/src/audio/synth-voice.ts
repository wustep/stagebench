// Basic synthesized piano voice for Phase 1
// This uses Web Audio API synthesis rather than samples

export class SynthPianoVoice {
  private audioContext: AudioContext;
  private oscillator?: OscillatorNode;
  private gainNode: GainNode;
  private filter: BiquadFilterNode;
  private envelope: GainNode;
  private note: number;
  private velocity: number;
  private startTime: number;
  private releaseTime?: number;
  private isReleasing: boolean = false;

  constructor(
    audioContext: AudioContext,
    note: number,
    velocity: number,
    masterGain: GainNode,
    filter: BiquadFilterNode
  ) {
    this.audioContext = audioContext;
    this.note = note;
    this.velocity = velocity;
    this.startTime = audioContext.currentTime;

    // Create voice-specific gain (envelope)
    this.envelope = audioContext.createGain();
    this.envelope.connect(filter);

    // Create filter for this voice
    this.filter = filter;

    // Create main gain for this voice
    this.gainNode = audioContext.createGain();
    this.gainNode.connect(this.envelope);

    // Create oscillator
    this.oscillator = audioContext.createOscillator();
    this.oscillator.type = 'triangle';
    this.oscillator.frequency.value = this.midiNoteToFreq(note);
    this.oscillator.connect(this.gainNode);

    // Set velocity-based volume (0-127 MIDI velocity)
    const velocityGain = (velocity / 127) * 0.3; // Scale to reasonable level
    this.gainNode.gain.setValueAtTime(velocityGain, audioContext.currentTime);

    // Start the oscillator
    this.oscillator.start(audioContext.currentTime);

    // Apply envelope
    this.applyEnvelope();
  }

  private midiNoteToFreq(midiNote: number): number {
    return 440 * Math.pow(2, (midiNote - 69) / 12);
  }

  private applyEnvelope(): void {
    const now = this.audioContext.currentTime;
    const attackTime = 0.05;
    const decayTime = 0.1;
    const sustainLevel = 0.7;

    // ADSR envelope
    this.envelope.gain.setValueAtTime(0, now);
    this.envelope.gain.linearRampToValueAtTime(1, now + attackTime);
    this.envelope.gain.linearRampToValueAtTime(sustainLevel, now + attackTime + decayTime);
  }

  noteOff(sustainActive: boolean = false): void {
    if (this.isReleasing) return;

    this.isReleasing = true;
    this.releaseTime = this.audioContext.currentTime;

    // Release time depends on sustain
    const releaseTime = sustainActive ? 1.0 : 0.3;

    this.envelope.gain.cancelScheduledValues(this.audioContext.currentTime);
    this.envelope.gain.linearRampToValueAtTime(
      0,
      this.audioContext.currentTime + releaseTime
    );

    // Stop oscillator after release
    this.oscillator?.stop(this.audioContext.currentTime + releaseTime);
  }

  setSustain(active: boolean): void {
    if (this.isReleasing) return;

    if (active) {
      // Hold current level when sustain is on
      this.envelope.gain.cancelScheduledValues(this.audioContext.currentTime);
      const currentLevel = 0.7;
      this.envelope.gain.setValueAtTime(currentLevel, this.audioContext.currentTime);
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
    } catch {
      // Already stopped
    }
  }
}

export class PianoVoiceEngine {
  private audioContext: AudioContext;
  private masterGain: GainNode;
  private voices: Map<number, SynthPianoVoice> = new Map(); // note -> voice
  private maxPolyphony: number = 32;
  private voiceHistory: number[] = []; // track note order for stealing
  private sustainPedal: boolean = false;
  private filter: BiquadFilterNode;

  constructor(audioContext: AudioContext, masterGain: GainNode) {
    this.audioContext = audioContext;
    this.masterGain = masterGain;

    // Create shared filter
    this.filter = audioContext.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 3000;
    this.filter.connect(masterGain);
  }

  noteOn(note: number, velocity: number): void {
    // If note is already playing, release it first (voice stealing)
    if (this.voices.has(note)) {
      this.voices.get(note)?.noteOff(this.sustainPedal);
      this.voices.delete(note);
    }

    // Check polyphony limit
    if (this.voices.size >= this.maxPolyphony) {
      // Steal oldest voice
      const oldestNote = this.voiceHistory.shift();
      if (oldestNote !== undefined) {
        this.voices.get(oldestNote)?.cleanup();
        this.voices.delete(oldestNote);
      }
    }

    // Create new voice
    const voice = new SynthPianoVoice(
      this.audioContext,
      note,
      velocity,
      this.masterGain,
      this.filter
    );

    this.voices.set(note, voice);
    this.voiceHistory.push(note);
  }

  noteOff(note: number): void {
    const voice = this.voices.get(note);
    if (voice) {
      voice.noteOff(this.sustainPedal);
      // Keep in map until it finishes releasing
      this.voiceHistory = this.voiceHistory.filter((n) => n !== note);
    }
  }

  setSustainPedal(active: boolean): void {
    this.sustainPedal = active;
    // Apply sustain to all active voices
    this.voices.forEach((voice) => {
      voice.setSustain(active);
    });
  }

  allNotesOff(): void {
    this.voices.forEach((voice) => {
      voice.noteOff(false); // Force release regardless of sustain
    });
    this.voices.clear();
    this.voiceHistory = [];
  }

  cleanup(): void {
    this.allNotesOff();
    this.filter.disconnect();
  }

  getActiveVoiceCount(): number {
    return this.voices.size;
  }
}
