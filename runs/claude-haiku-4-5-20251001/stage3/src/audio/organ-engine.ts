import { OrganLayerState } from '../types';

/**
 * Organ Engine - B3/Vox/Farf/Pipe tonewheel models
 * Implements harmonic-based organ synthesis with drawbar control
 */

export class OrganEngine {
  private audioContext: AudioContext;
  private voices: Map<number, { oscs: OscillatorNode[]; gain: GainNode }> = new Map();

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext;
  }

  noteOn(note: number, gain: GainNode, state: OrganLayerState): void {
    const time = this.audioContext.currentTime;
    const noteFreq = 440 * Math.pow(2, (note - 69) / 12);

    // Get harmonic amplitudes based on drawbars and model
    const harmonics = this.getHarmonicAmplitudes(state.model, state.drawbars);

    const oscillators: OscillatorNode[] = [];
    const voiceGain = this.audioContext.createGain();
    voiceGain.connect(gain);

    // Create oscillators for each harmonic
    harmonics.forEach((amplitude, index) => {
      if (amplitude < 0.001) return;

      const osc = this.audioContext.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = noteFreq * (index + 1);

      const oscGain = this.audioContext.createGain();
      oscGain.gain.value = amplitude;

      osc.connect(oscGain);
      oscGain.connect(voiceGain);
      osc.start(time);

      oscillators.push(osc);
    });

    // Add key click
    if (state.keyClickEnabled) {
      this.addKeyClick(voiceGain, time);
    }

    // Add percussion (B3 only)
    if (state.model === 'B3' && state.percussionEnabled) {
      this.addPercussion(voiceGain, noteFreq, time);
    }

    this.voices.set(note, { oscs: oscillators, gain: voiceGain });
  }

  noteOff(note: number): void {
    const voice = this.voices.get(note);
    if (!voice) return;

    const time = this.audioContext.currentTime;
    voice.oscs.forEach((osc) => {
      try {
        osc.stop(time + 0.05);
      } catch (_e) {
        // Already stopped
      }
    });

    voice.gain.gain.linearRampToValueAtTime(0, time + 0.05);
    this.voices.delete(note);
  }

  cleanup(): void {
    this.voices.forEach((voice) => {
      voice.oscs.forEach((osc) => {
        try {
          osc.stop();
        } catch (_e) {
          // Already stopped
        }
      });
    });
    this.voices.clear();
  }

  private getHarmonicAmplitudes(model: string, drawbars: number[]): number[] {
    const amplitudes = drawbars.map((val) => (val ?? 0) / 8);

    switch (model) {
      case 'B3':
        return [
          amplitudes[2] * 1.0,
          amplitudes[2] * 0.6,
          amplitudes[0] * 0.3,
          amplitudes[3] * 0.8,
          amplitudes[4] * 0.5,
          amplitudes[5] * 0.4,
          amplitudes[6] * 0.3,
          amplitudes[7] * 0.3,
          amplitudes[8] * 0.2,
        ];
      case 'Vox':
        return [
          amplitudes[2] * 0.9,
          amplitudes[2] * 0.7,
          amplitudes[3] * 0.6,
          amplitudes[4] * 0.5,
          amplitudes[5] * 0.4,
          amplitudes[6] * 0.3,
          amplitudes[7] * 0.2,
          0,
          0,
        ];
      case 'Farf':
        return [
          amplitudes[2] * 0.5,
          amplitudes[3] * 0.9,
          amplitudes[4] * 0.8,
          amplitudes[5] * 0.7,
          amplitudes[6] * 0.8,
          amplitudes[7] * 0.8,
          amplitudes[8] * 0.6,
          0,
          0,
        ];
      case 'Pipe':
        return [
          amplitudes[2] * 1.1,
          amplitudes[2] * 0.5,
          amplitudes[0] * 0.4,
          amplitudes[3] * 0.6,
          amplitudes[4] * 0.4,
          amplitudes[5] * 0.3,
          amplitudes[6] * 0.2,
          amplitudes[7] * 0.15,
          amplitudes[8] * 0.1,
        ];
      default:
        return amplitudes;
    }
  }

  private addKeyClick(gain: GainNode, time: number): void {
    const osc = this.audioContext.createOscillator();
    osc.frequency.value = 2500;

    const clickGain = this.audioContext.createGain();
    clickGain.gain.setValueAtTime(0.3, time);
    clickGain.gain.exponentialRampToValueAtTime(0.01, time + 0.02);

    osc.connect(clickGain);
    clickGain.connect(gain);

    osc.start(time);
    osc.stop(time + 0.02);
  }

  private addPercussion(gain: GainNode, noteFreq: number, time: number): void {
    const percFreq = noteFreq * 2;
    const osc = this.audioContext.createOscillator();
    osc.frequency.value = percFreq;

    const percGain = this.audioContext.createGain();
    percGain.gain.setValueAtTime(0.2, time);
    percGain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);

    osc.connect(percGain);
    percGain.connect(gain);

    osc.start(time);
    osc.stop(time + 0.35);
  }
}
