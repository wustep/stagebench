import { SynthLayerState } from '../types';

/**
 * Synth Engine - Nord Wave 2-style synthesizer
 * Supports Pure waveforms, filters, envelopes, and voice modes
 */

export class SynthEngine {
  private audioContext: AudioContext;
  private voices: Array<{
    note: number;
    velocity: number;
    oscs: OscillatorNode[];
    filter: BiquadFilterNode;
    gainNode: GainNode;
    startTime: number;
  }> = [];
  private maxVoices: number = 16;

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext;
  }

  noteOn(note: number, velocity: number, gain: GainNode, state: SynthLayerState): void {
    const time = this.audioContext.currentTime;
    const noteFreq = 440 * Math.pow(2, (note - 69) / 12);

    // Handle voice modes
    if (state.voiceMode === 'Mono' || state.voiceMode === 'Legato') {
      // Kill other voices
      this.voices.forEach((voice) => {
        if (voice.note !== note) {
          voice.oscs.forEach((osc) => {
            try {
              osc.stop(time + 0.01);
            } catch (_e) {
              // Already stopped
            }
          });
          voice.gainNode.gain.setValueAtTime(0, time);
        }
      });
      this.voices = this.voices.filter((v) => v.note === note || v.startTime < time - 1);
    }

    // Limit polyphony
    if (this.voices.length >= this.maxVoices) {
      const oldest = this.voices[0];
      oldest.oscs.forEach((osc) => {
        try {
          osc.stop(time + 0.02);
        } catch (_e) {
          // Already stopped
        }
      });
      this.voices.shift();
    }

    // Create voice
    const voiceGain = this.audioContext.createGain();
    voiceGain.connect(gain);

    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = state.filterFreq * 20000;
    filter.connect(voiceGain);

    const oscillators: OscillatorNode[] = [];

    // Create oscillator
    const osc = this.audioContext.createOscillator();
    const waveMap: Record<string, OscillatorType> = {
      Sine: 'sine',
      Triangle: 'triangle',
      Saw: 'sawtooth',
      Square: 'square',
    };
    osc.type = waveMap[state.waveform] || 'sine';
    osc.frequency.value = noteFreq;

    osc.connect(filter);
    osc.start(time);
    oscillators.push(osc);

    // Envelope
    const ampEnvAttack = 0.01;
    const ampEnvDecay = 0.2;
    const ampEnvRelease = 0.1;

    voiceGain.gain.setValueAtTime(0, time);
    voiceGain.gain.linearRampToValueAtTime(velocity / 127, time + ampEnvAttack);
    voiceGain.gain.exponentialRampToValueAtTime(0.1, time + ampEnvAttack + ampEnvDecay);

    this.voices.push({
      note,
      velocity,
      oscs: oscillators,
      filter,
      gainNode: voiceGain,
      startTime: time,
    });
  }

  noteOff(note: number): void {
    const time = this.audioContext.currentTime;

    this.voices = this.voices.filter((voice) => {
      if (voice.note === note) {
        voice.oscs.forEach((osc) => {
          try {
            osc.stop(time + 0.1);
          } catch (_e) {
            // Already stopped
          }
        });
        voice.gainNode.gain.linearRampToValueAtTime(0, time + 0.1);
        return false;
      }
      return true;
    });
  }

  allNotesOff(): void {
    const time = this.audioContext.currentTime;
    this.voices.forEach((voice) => {
      voice.oscs.forEach((osc) => {
        try {
          osc.stop(time + 0.05);
        } catch (_e) {
          // Already stopped
        }
      });
      voice.gainNode.gain.setValueAtTime(0, time);
    });
    this.voices = [];
  }

  cleanup(): void {
    this.allNotesOff();
  }
}
