// Phase 2: Mod 1 effects (A-Pan, Tremolo, Ring Mod, A-Wah, Wah, Pump)

import { EffectProcessing, Mod1Type, MOD1_TYPES } from './types';

export function createMod1Effect(
  audioContext: AudioContext,
  initialType: Mod1Type = 'Tremolo'
): EffectProcessing {
  const input = audioContext.createGain();
  const output = audioContext.createGain();
  const dryWetMixer = audioContext.createGain();
  const wetGain = audioContext.createGain();

  input.connect(dryWetMixer);
  dryWetMixer.connect(output);
  wetGain.connect(output);

  let currentType = initialType;
  let currentEffect: EffectProcessing | null = null;
  let lfoOscillator: OscillatorNode | null = null;
  let lfoPan: StereoPannerNode | null = null;
  let gainModulator: GainNode | null = null;
  let filterModulator: BiquadFilterNode | null = null;

  const setType = (type: string) => {
    // Cleanup previous effect
    if (lfoOscillator) {
      try {
        lfoOscillator.stop();
      } catch {
        // Already stopped
      }
    }

    currentType = type as Mod1Type;

    // Create new effect
    const dryIn = audioContext.createGain();
    const effectOut = audioContext.createGain();
    input.connect(dryIn);

    switch (type) {
      case 'Tremolo': {
        // LFO modulates volume
        lfoOscillator = audioContext.createOscillator();
        lfoOscillator.frequency.value = 4; // 4 Hz default
        gainModulator = audioContext.createGain();
        gainModulator.gain.value = 0.5; // Modulation depth
        const volumeModulator = audioContext.createGain();
        volumeModulator.gain.value = 0.5; // Offset

        lfoOscillator.connect(gainModulator);
        gainModulator.connect(volumeModulator.gain);
        dryIn.connect(volumeModulator);
        volumeModulator.connect(effectOut);
        lfoOscillator.start();
        break;
      }

      case 'A-Pan': {
        // LFO modulates stereo panning
        lfoOscillator = audioContext.createOscillator();
        lfoOscillator.frequency.value = 2; // 2 Hz default
        lfoPan = audioContext.createStereoPanner();
        const panModulator = audioContext.createGain();
        panModulator.gain.value = 0.5; // Pan depth

        lfoOscillator.connect(panModulator);
        panModulator.connect(lfoPan.pan);
        dryIn.connect(lfoPan);
        lfoPan.connect(effectOut);
        lfoOscillator.start();
        break;
      }

      case 'Ring Mod': {
        // Signal multiplied by sine wave
        lfoOscillator = audioContext.createOscillator();
        lfoOscillator.frequency.value = 100; // 100 Hz default (rate = pitch)
        const waveshaper = audioContext.createGain();

        dryIn.connect(waveshaper);
        // Ring mod approximation: multiply signal by carrier
        lfoOscillator.connect(waveshaper.gain);
        waveshaper.connect(effectOut);
        lfoOscillator.start();
        break;
      }

      case 'Wah': {
        // LFO-driven resonant low-pass sweep
        lfoOscillator = audioContext.createOscillator();
        lfoOscillator.frequency.value = 1; // 1 Hz default
        filterModulator = audioContext.createBiquadFilter();
        filterModulator.type = 'lowpass';
        filterModulator.frequency.value = 1000;
        filterModulator.Q.value = 5;

        const freqModulator = audioContext.createGain();
        freqModulator.gain.value = 2000; // Sweep range

        lfoOscillator.connect(freqModulator);
        freqModulator.connect(filterModulator.frequency);
        dryIn.connect(filterModulator);
        filterModulator.connect(effectOut);
        lfoOscillator.start();
        break;
      }

      case 'A-Wah': {
        // Envelope-follower band-pass sweep (approximated with filter)
        filterModulator = audioContext.createBiquadFilter();
        filterModulator.type = 'bandpass';
        filterModulator.frequency.value = 1500;
        filterModulator.Q.value = 3;

        dryIn.connect(filterModulator);
        filterModulator.connect(effectOut);
        break;
      }

      case 'Pump': {
        // Side-chain-style LFO ducking
        lfoOscillator = audioContext.createOscillator();
        lfoOscillator.frequency.value = 2; // 2 Hz default
        gainModulator = audioContext.createGain();
        gainModulator.gain.value = 0.7; // Ducketing depth
        const duckGain = audioContext.createGain();
        duckGain.gain.value = 1;

        // Invert LFO for ducking (when LFO is high, gain is low)
        lfoOscillator.connect(gainModulator);
        gainModulator.connect(duckGain.gain);
        dryIn.connect(duckGain);
        duckGain.connect(effectOut);
        lfoOscillator.start();
        break;
      }

      default:
        effectOut.connect(input); // Pass-through fallback
    }

    // Connect effect output to dry/wet mixer
    effectOut.connect(wetGain);
  };

  // Initialize with default type
  setType(initialType);

  return {
    input,
    output,
    setType,
    setParameter: (name: string, value: number) => {
      if (name === 'Rate' && lfoOscillator) {
        lfoOscillator.frequency.setTargetAtTime(value, audioContext.currentTime, 0.05);
      } else if (name === 'Amount') {
        // Modulate depth based on amount
        if (gainModulator) {
          gainModulator.gain.setTargetAtTime(value, audioContext.currentTime, 0.05);
        }
      }
    },
    setEnabled: (enabled: boolean) => {
      output.gain.value = enabled ? 1 : 0;
    },
    setDryWet: (amount: number) => {
      dryWetMixer.gain.setTargetAtTime(1 - amount, audioContext.currentTime, 0.01);
      wetGain.gain.setTargetAtTime(amount, audioContext.currentTime, 0.01);
    },
    cleanup: () => {
      if (lfoOscillator) {
        try {
          lfoOscillator.stop();
        } catch {
          // Already stopped
        }
      }
      input.disconnect();
      output.disconnect();
      dryWetMixer.disconnect();
      wetGain.disconnect();
    },
  };
}
