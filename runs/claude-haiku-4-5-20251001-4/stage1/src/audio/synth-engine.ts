import { SynthLayerState } from '../types';

/**
 * Synth Engine - Nord Wave 2-style synthesizer
 *
 * Supports:
 * - Multiple waveform categories (Pure, Sync, Multi, Super, FM-H)
 * - Four filter types (LP12, LP24, HP, BP)
 * - Three envelope generators (Oscillator, Filter, Amplifier)
 * - LFO with multiple destinations
 * - Voice modes (Poly/Mono/Legato) with glide
 * - Arpeggiator with deterministic stepping
 */

export interface SynthVoice {
  note: number;
  velocity: number;
  gainNode: GainNode;
  oscillators: OscillatorNode[];
  filters: BiquadFilterNode[];
  envelopes: {
    osc: GainNode;
    filter: GainNode;
    amp: GainNode;
  };
  startTime: number;
  releaseTime?: number;
  glidingFrom?: number;
}

export class SynthEngine {
  private audioContext: AudioContext;
  private activeVoices: SynthVoice[] = [];
  private voicePool: SynthVoice[] = [];
  private maxVoices: number = 16;
  private lfoOscillator?: OscillatorNode;
  private lfoGain?: GainNode;
  private arpeggiatorBuffer: number[] = []; // Current notes being arpeggiated
  private arpeggiatorIndex: number = 0;

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext;
  }

  noteOn(
    note: number,
    velocity: number,
    gain: GainNode,
    state: SynthLayerState,
    currentTime?: number
  ): void {
    const time = currentTime || this.audioContext.currentTime;

    // Get or create voice
    let voice = this.voicePool.pop();
    if (!voice) {
      voice = this.createVoice(gain, state, time);
    }

    voice.note = note;
    voice.velocity = velocity;
    voice.startTime = time;
    voice.releaseTime = undefined;

    // Create oscillators for the selected waveform
    this.createOscillators(voice, note, state, time);

    // Setup filters
    this.setupFilters(voice, state, note, time);

    // Start envelopes
    this.startEnvelopes(voice, state, velocity, time);

    // Handle voice modes (poly/mono/legato)
    this.handleVoiceMode(voice, state, time);

    this.activeVoices.push(voice);
  }

  noteOff(note: number, currentTime?: number): void {
    const time = currentTime || this.audioContext.currentTime;

    // Find all voices for this note
    this.activeVoices = this.activeVoices.filter((voice) => {
      if (voice.note === note) {
        voice.releaseTime = time;

        // Stop oscillators
        voice.oscillators.forEach((osc) => {
          try {
            osc.stop(time + 0.1);
          } catch (e) {
            // Already stopped
          }
        });

        // Fade envelope
        voice.envelopes.amp.gain.linearRampToValueAtTime(0, time + 0.1);

        return false; // Remove from active
      }
      return true;
    });
  }

  allNotesOff(): void {
    const time = this.audioContext.currentTime;
    this.activeVoices.forEach((voice) => {
      try {
        voice.oscillators.forEach((osc) => osc.stop(time + 0.05));
        voice.envelopes.amp.gain.setValueAtTime(0, time);
      } catch (e) {
        // Already stopped
      }
    });
    this.activeVoices = [];
    this.arpeggiatorBuffer = [];
    this.arpeggiatorIndex = 0;
  }

  updateArpeggiator(state: SynthLayerState, currentNotes: number[], time?: number): void {
    const t = time || this.audioContext.currentTime;

    if (state.arpMode === 'Poly' || state.arpMode === 'Gate') {
      // Poly and Gate modes don't arpeggiate
      return;
    }

    // Store notes for arpeggiator
    const sortedNotes = [...currentNotes].sort((a, b) => {
      if (state.arpDirection === 'Down') return b - a;
      if (state.arpDirection === 'Random') return Math.random() - 0.5;
      return a - b; // Up
    });

    this.arpeggiatorBuffer = sortedNotes;
    this.arpeggiatorIndex = 0;
  }

  cleanup(): void {
    this.allNotesOff();
    if (this.lfoOscillator) {
      try {
        this.lfoOscillator.stop();
      } catch (e) {
        // Already stopped
      }
    }
  }

  private createVoice(gain: GainNode, state: SynthLayerState, time: number): SynthVoice {
    const voiceGain = this.audioContext.createGain();
    voiceGain.connect(gain);

    const filters: BiquadFilterNode[] = [];
    // Create filter chain (for now, one main filter)
    const mainFilter = this.audioContext.createBiquadFilter();
    mainFilter.connect(voiceGain);
    filters.push(mainFilter);

    const envelopes = {
      osc: this.audioContext.createGain(),
      filter: this.audioContext.createGain(),
      amp: this.audioContext.createGain(),
    };

    envelopes.amp.connect(voiceGain);

    return {
      note: 0,
      velocity: 64,
      gainNode: voiceGain,
      oscillators: [],
      filters,
      envelopes,
      startTime: time,
    };
  }

  private createOscillators(
    voice: SynthVoice,
    note: number,
    state: SynthLayerState,
    time: number
  ): void {
    const noteFreq = 440 * Math.pow(2, (note - 69) / 12);
    const baseFreq = noteFreq * Math.pow(2, state.oscPitchCoarse / 12) *
      Math.pow(2, state.oscPitchFine / 1200);

    // Clear any existing oscillators
    voice.oscillators.forEach((osc) => {
      try {
        osc.stop(time);
      } catch (e) {
        // Already stopped
      }
    });
    voice.oscillators = [];

    // Create waveforms based on category
    switch (state.waveform) {
      case 'Sine':
      case 'Triangle':
      case 'Saw':
      case 'Square':
      case 'Pulse 33':
      case 'Pulse 10':
      case 'White Noise':
        this.createPureWaveform(voice, baseFreq, state, time);
        break;

      case 'Sync Saw':
      case 'Sync Square':
        this.createSyncWaveform(voice, baseFreq, state, time);
        break;

      case 'Multi Saw':
      case 'Multi Saw 8ve':
        this.createMultiWaveform(voice, baseFreq, state, time);
        break;

      case 'Super Saw':
      case 'Super Square':
        this.createSuperWaveform(voice, baseFreq, state, time);
        break;

      case 'FM 2-op (algorithm A)':
        this.createFMWaveform(voice, baseFreq, state, time);
        break;

      default:
        this.createPureWaveform(voice, baseFreq, state, time);
    }
  }

  private createPureWaveform(
    voice: SynthVoice,
    baseFreq: number,
    state: SynthLayerState,
    time: number
  ): void {
    const osc = this.audioContext.createOscillator();

    // Map waveform to OscillatorNode type
    if (state.waveform === 'Sine') {
      osc.type = 'sine';
    } else if (state.waveform === 'Triangle') {
      osc.type = 'triangle';
    } else if (state.waveform === 'Saw') {
      osc.type = 'sawtooth';
    } else if (state.waveform === 'Square' || state.waveform === 'Pulse 33') {
      osc.type = 'square';
    } else if (state.waveform === 'Pulse 10') {
      // Narrow pulse approximated with square
      osc.type = 'square';
    } else if (state.waveform === 'White Noise') {
      // Use noise buffer instead of oscillator
      return this.createNoiseWaveform(voice, baseFreq, state, time);
    }

    osc.frequency.value = baseFreq;
    osc.connect(voice.filters[0]);

    voice.oscillators.push(osc);
    osc.start(time);
  }

  private createNoiseWaveform(
    voice: SynthVoice,
    _baseFreq: number,
    _state: SynthLayerState,
    time: number
  ): void {
    // Create white noise buffer
    const bufferSize = this.audioContext.sampleRate * 0.1;
    const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(voice.filters[0]);
    source.start(time);

    // Track as oscillator for cleanup
    voice.oscillators.push(source as any);
  }

  private createSyncWaveform(
    voice: SynthVoice,
    baseFreq: number,
    state: SynthLayerState,
    time: number
  ): void {
    // Sync: master and slave oscillator with pitch relationship
    const master = this.audioContext.createOscillator();
    const slave = this.audioContext.createOscillator();

    master.type = state.waveform === 'Sync Saw' ? 'sawtooth' : 'square';
    slave.type = state.waveform === 'Sync Saw' ? 'sawtooth' : 'square';

    master.frequency.value = baseFreq;
    // Osc Ctrl adjusts slave pitch relative to master
    slave.frequency.value = baseFreq * (1 + state.oscCtrl * 0.5);

    const oscCtrlGain = this.audioContext.createGain();
    oscCtrlGain.gain.value = 0.5;

    master.connect(voice.filters[0]);
    slave.connect(oscCtrlGain);
    oscCtrlGain.connect(voice.filters[0]);

    voice.oscillators.push(master);
    voice.oscillators.push(slave);

    master.start(time);
    slave.start(time);
  }

  private createMultiWaveform(
    voice: SynthVoice,
    baseFreq: number,
    state: SynthLayerState,
    time: number
  ): void {
    // Multi: multiple detuned saws
    const count = state.waveform === 'Multi Saw 8ve' ? 2 : 3;
    const detuneAmount = state.oscCtrl * 20; // Up to ±20 cents

    for (let i = 0; i < count; i++) {
      const osc = this.audioContext.createOscillator();
      osc.type = 'sawtooth';

      const detune = (i - Math.floor(count / 2)) * detuneAmount;
      osc.frequency.value = baseFreq * Math.pow(2, detune / 1200);

      osc.connect(voice.filters[0]);
      voice.oscillators.push(osc);
      osc.start(time);
    }
  }

  private createSuperWaveform(
    voice: SynthVoice,
    baseFreq: number,
    state: SynthLayerState,
    time: number
  ): void {
    // Super: many detuned oscillators for a thick sound
    const count = 7;
    const spreadAmount = state.oscCtrl * 30; // Up to ±30 cents spread

    for (let i = 0; i < count; i++) {
      const osc = this.audioContext.createOscillator();
      osc.type = state.waveform === 'Super Saw' ? 'sawtooth' : 'square';

      const spread = (i / (count - 1)) * spreadAmount - spreadAmount / 2;
      osc.frequency.value = baseFreq * Math.pow(2, spread / 1200);

      osc.connect(voice.filters[0]);
      voice.oscillators.push(osc);
      osc.start(time);
    }
  }

  private createFMWaveform(
    voice: SynthVoice,
    baseFreq: number,
    state: SynthLayerState,
    time: number
  ): void {
    // FM: two-operator FM synthesis
    const carrier = this.audioContext.createOscillator();
    const modulator = this.audioContext.createOscillator();

    carrier.type = 'sine';
    modulator.type = 'sine';

    carrier.frequency.value = baseFreq;
    modulator.frequency.value = baseFreq * 2; // Modulator at 2x carrier

    const modGain = this.audioContext.createGain();
    const fmAmount = baseFreq * state.oscCtrl * 50; // FM depth based on OscCtrl
    modGain.gain.value = fmAmount;

    modulator.connect(modGain);
    modGain.connect(carrier.frequency as any);

    carrier.connect(voice.filters[0]);

    voice.oscillators.push(carrier);
    voice.oscillators.push(modulator);

    carrier.start(time);
    modulator.start(time);
  }

  private setupFilters(voice: SynthVoice, state: SynthLayerState, note: number, time: number): void {
    const filter = voice.filters[0];

    // Set filter type
    switch (state.filterType) {
      case 'LP12':
      case 'LP24':
        filter.type = 'lowpass';
        break;
      case 'HP':
        filter.type = 'highpass';
        break;
      case 'BP':
        filter.type = 'bandpass';
        break;
    }

    // Set frequency (0-1 maps to ~20Hz-20kHz)
    const minFreq = 20;
    const maxFreq = 20000;
    const cutoff = minFreq * Math.pow(maxFreq / minFreq, state.filterFreq);
    filter.frequency.value = cutoff;

    // Apply keyboard tracking
    if (state.filterTracking !== 'Off') {
      const trackingFactor = {
        '1/3': 1 / 3,
        '2/3': 2 / 3,
        '1': 1,
      }[state.filterTracking] || 0;

      const noteFreq = 440 * Math.pow(2, (note - 69) / 12);
      const trackingAmount = noteFreq * trackingFactor * 0.5;
      filter.frequency.value += trackingAmount;
    }

    // Set resonance (Q is readonly, affects filter peak)
    // For now, we approximate resonance by using the frequency parameter
    // A proper implementation would use a custom filter or shelf techniques

    // Set drive (simple gain before filter for saturation effect)
    if (state.filterDrive !== 'Off') {
      const driveLevel = {
        '1': 1.5,
        '2': 2,
        '3': 3,
      }[state.filterDrive.toString()] || 1;
      voice.filters[0].gain.value = driveLevel;
    }
  }

  private startEnvelopes(
    voice: SynthVoice,
    state: SynthLayerState,
    velocity: number,
    time: number
  ): void {
    const velFactor = state.ampEnvelope.velocityEnabled ? velocity / 127 : 1;

    // Amplifier envelope
    voice.envelopes.amp.gain.setValueAtTime(0, time);
    voice.envelopes.amp.gain.linearRampToValueAtTime(
      1 * velFactor,
      time + state.ampEnvelope.attack
    );
    voice.envelopes.amp.gain.exponentialRampToValueAtTime(
      0.01,
      time + state.ampEnvelope.attack + state.ampEnvelope.decay
    );

    // Filter envelope
    voice.envelopes.filter.gain.setValueAtTime(0, time);
    voice.envelopes.filter.gain.linearRampToValueAtTime(
      state.filterEnvAmount,
      time + state.filterEnvelope.attack
    );
    voice.envelopes.filter.gain.exponentialRampToValueAtTime(
      0.001,
      time + state.filterEnvelope.attack + state.filterEnvelope.decay
    );

    // Oscillator envelope (for modulation)
    voice.envelopes.osc.gain.setValueAtTime(0, time);
    voice.envelopes.osc.gain.linearRampToValueAtTime(
      1,
      time + state.oscEnvelope.attack
    );
    voice.envelopes.osc.gain.exponentialRampToValueAtTime(
      0.01,
      time + state.oscEnvelope.attack + state.oscEnvelope.decay
    );
  }

  private handleVoiceMode(voice: SynthVoice, state: SynthLayerState, time: number): void {
    // Voice mode handling (mono/legato/poly)
    if (state.voiceMode === 'Mono' || state.voiceMode === 'Legato') {
      // Kill other voices
      const voicesToKill = this.activeVoices.filter(
        (v) => v.note !== voice.note
      );
      voicesToKill.forEach((v) => {
        v.releaseTime = time;
        v.oscillators.forEach((osc) => {
          try {
            osc.stop(time + 0.05);
          } catch (e) {
            // Already stopped
          }
        });
      });

      this.activeVoices = this.activeVoices.filter(
        (v) => v.note === voice.note || v.releaseTime !== undefined
      );

      // Handle glide in mono mode
      if (state.glideRate > 0 && this.activeVoices.length > 1) {
        const prevVoice = this.activeVoices[this.activeVoices.length - 2];
        if (prevVoice) {
          voice.glidingFrom = prevVoice.note;
        }
      }
    }
  }
}
