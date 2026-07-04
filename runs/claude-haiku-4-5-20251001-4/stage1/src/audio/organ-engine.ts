import { OrganLayerState } from '../types';

/**
 * Organ Engine - B3/Vox/Farf/Pipe tonewheel models
 *
 * Each model is implemented as an oscillator stack that approximates the
 * harmonic content of the original tonewheel organ. The drawbars control
 * the relative amplitude of each harmonic.
 *
 * B3 (16', 5⅓', 8', 4', 2⅔', 2', 1⅗', 1⅓', 1'):
 *   Nine harmonics representing the standard Hammond B3 drawbar lineup
 *
 * Vox (seven partials + mix):
 *   Similar to B3 but with a different tonal character
 *
 * Farf:
 *   Bright, piercing registration with emphasis on higher harmonics
 *
 * Pipe:
 *   Pipe organ model with more sustain and tonal richness
 */

export interface OrganVoice {
  note: number;
  gain: GainNode;
  oscillators: OscillatorNode[];
  envelope: {
    startTime: number;
    releaseTime?: number;
  };
}

export class OrganEngine {
  private audioContext: AudioContext;
  private voices: Map<number, OrganVoice[]> = new Map(); // note -> voices

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext;
  }

  /**
   * Create a note with the given organ model and drawbar settings.
   * Returns a GainNode that contains all the harmonics for this note.
   */
  noteOn(
    note: number,
    gain: GainNode,
    state: OrganLayerState,
    currentTime?: number
  ): void {
    const time = currentTime || this.audioContext.currentTime;
    const harmonics = this.getHarmonicAmplitudes(state.model, state.drawbars);

    const oscillators: OscillatorNode[] = [];
    const gainNode = this.audioContext.createGain();
    gainNode.connect(gain);

    // Create oscillators for each harmonic
    harmonics.forEach((amplitude, index) => {
      if (amplitude < 0.001) return; // Skip silent harmonics

      const osc = this.audioContext.createOscillator();
      osc.type = 'sine';

      // Harmonic frequency = note frequency * (harmonic number)
      const noteFreq = 440 * Math.pow(2, (note - 69) / 12);
      const harmonicFreq = noteFreq * (index + 1);

      osc.frequency.value = harmonicFreq;

      const oscGain = this.audioContext.createGain();
      oscGain.gain.value = amplitude;

      osc.connect(oscGain);
      oscGain.connect(gainNode);
      osc.start(time);

      oscillators.push(osc);
    });

    // Add key click (short high-frequency click at note onset)
    if (state.keyClickEnabled && oscillators.length > 0) {
      this.addKeyClick(gainNode, time);
    }

    // Add percussion (B3 only)
    if (state.model === 'B3' && state.percussionEnabled) {
      this.addPercussion(gainNode, note, state, time);
    }

    // Apply vibrato/chorus
    this.applyVibratoChorus(oscillators, gainNode, state.vibratoChorus, time);

    // Store voice for note-off cleanup
    if (!this.voices.has(note)) {
      this.voices.set(note, []);
    }
    this.voices.get(note)!.push({
      note,
      gain: gainNode,
      oscillators,
      envelope: { startTime: time },
    });
  }

  noteOff(note: number, currentTime?: number): void {
    const time = currentTime || this.audioContext.currentTime;
    const voices = this.voices.get(note);

    if (!voices) return;

    voices.forEach((voice) => {
      voice.envelope.releaseTime = time;

      // Stop oscillators with small fade
      voice.oscillators.forEach((osc) => {
        osc.stop(time + 0.05);
      });

      // Fade gain
      voice.gain.gain.linearRampToValueAtTime(0, time + 0.05);
    });

    this.voices.delete(note);
  }

  cleanup(): void {
    this.voices.forEach((voices) => {
      voices.forEach((voice) => {
        try {
          voice.oscillators.forEach((osc) => osc.stop());
        } catch (_e) {
          // Already stopped
        }
      });
    });
    this.voices.clear();
  }

  private getHarmonicAmplitudes(
    model: string,
    drawbars: number[]
  ): number[] {
    // Drawbar values: 0-8, where 0 is fully retracted and 8 is fully pushed
    // Normalize to 0-1 for amplitude control
    const amplitudes = drawbars.map((val) => (val ?? 0) / 8);

    switch (model) {
      case 'B3':
      case 'B3 Bass':
        // B3: Nine harmonics (1, 3, 2, 4, 5, 6, 7, 8, 9)
        // Represented as: 16', 5⅓', 8', 4', 2⅔', 2', 1⅗', 1⅓', 1'
        // These map roughly to harmonics 1, 3, 2, 4, 5, 6, 7, 8, 9
        return [
          amplitudes[2] * 1.0, // 8' (fundamental - harmonic 1, using index 2)
          amplitudes[2] * 0.6, // 4' (octave - harmonic 2, from fundamental)
          amplitudes[0] * 0.3, // 16' (sub - harmonic 1/2, using index 0)
          amplitudes[3] * 0.8, // 4' (harmonic 4)
          amplitudes[4] * 0.5, // 2⅔' (harmonic 5)
          amplitudes[5] * 0.4, // 2' (harmonic 6)
          amplitudes[6] * 0.3, // 1⅗' (harmonic 7)
          amplitudes[7] * 0.3, // 1⅓' (harmonic 8)
          amplitudes[8] * 0.2, // 1' (harmonic 9)
        ];

      case 'Vox':
        // Vox: Seven partials with different character
        return [
          amplitudes[2] * 0.9, // Bright fundamental
          amplitudes[2] * 0.7, // Strong second
          amplitudes[3] * 0.6, // Mid-range
          amplitudes[4] * 0.5,
          amplitudes[5] * 0.4,
          amplitudes[6] * 0.3,
          amplitudes[7] * 0.2,
          0, // Skip unused
          0,
        ];

      case 'Farf':
        // Farf: Bright, piercing, emphasizes high harmonics
        return [
          amplitudes[2] * 0.5, // Lower
          amplitudes[3] * 0.9, // Strong presence
          amplitudes[4] * 0.8,
          amplitudes[5] * 0.7,
          amplitudes[6] * 0.8, // Boost highs
          amplitudes[7] * 0.8,
          amplitudes[8] * 0.6,
          0,
          0,
        ];

      case 'Pipe 1':
      case 'Pipe 2':
        // Pipe: More sustaining, warmer than B3
        return [
          amplitudes[2] * 1.1, // Strong fundamental
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
    // Key click: short high-frequency burst at attack
    const osc = this.audioContext.createOscillator();
    osc.frequency.value = 2500; // High frequency click

    const clickGain = this.audioContext.createGain();
    clickGain.gain.setValueAtTime(0.3, time);
    clickGain.gain.exponentialRampToValueAtTime(0.01, time + 0.02);

    osc.connect(clickGain);
    clickGain.connect(gain);

    osc.start(time);
    osc.stop(time + 0.02);
  }

  private addPercussion(gain: GainNode, note: number, state: OrganLayerState, time: number): void {
    // Percussion: decay envelope with configurable harmonic
    const noteFreq = 440 * Math.pow(2, (note - 69) / 12);
    const harmonicMultiplier = state.percussionHarmonicThird ? 3 : 2;
    const percFreq = noteFreq * harmonicMultiplier;

    const osc = this.audioContext.createOscillator();
    osc.frequency.value = percFreq;

    const percGain = this.audioContext.createGain();
    const decayTime = state.percussionDecayFast ? 0.2 : 0.5;
    const level = state.percussionSoft ? 0.1 : 0.3;

    percGain.gain.setValueAtTime(level, time);
    percGain.gain.exponentialRampToValueAtTime(0.001, time + decayTime);

    osc.connect(percGain);
    percGain.connect(gain);

    osc.start(time);
    osc.stop(time + decayTime + 0.05);
  }

  private applyVibratoChorus(
    oscillators: OscillatorNode[],
    gain: GainNode,
    effect: string,
    time: number
  ): void {
    if (!oscillators || oscillators.length === 0 || effect === 'Off') {
      return;
    }

    // Parse vibrato/chorus setting (C1-C3, V1-V3)
    const intensity = parseInt(effect.charAt(1)) || 1;
    const isVibrato = effect.startsWith('V');

    // Vibrato: pitch modulation
    // Chorus: mix with slightly detuned copy
    const lfoFreq = 5 + intensity; // 5-8 Hz
    const lfo = this.audioContext.createOscillator();
    lfo.frequency.value = lfoFreq;
    lfo.type = 'sine';

    if (isVibrato) {
      // Pitch vibrato
      const vibDepth = 20 * intensity; // ~20-60 cents
      const depthGain = this.audioContext.createGain();
      depthGain.gain.value = vibDepth;

      lfo.connect(depthGain);

      oscillators.forEach((osc) => {
        depthGain.connect(osc.frequency as any);
      });

      lfo.start(time);
    } else {
      // Chorus: subtle detuning effect by mixing phase
      // For simplicity, we reduce amplitude slightly for a chorus effect
      gain.gain.linearRampToValueAtTime(0.85, time + 0.5);
    }
  }
}
