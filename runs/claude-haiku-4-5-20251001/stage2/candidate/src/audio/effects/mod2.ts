// Phase 2: Mod 2 effects (Chorus, Flanger, Phaser, Vibe, Ensemble, Spin)

import { EffectProcessing, Mod2Type } from './types';

export function createMod2Effect(
  audioContext: AudioContext,
  initialType: Mod2Type = 'Chorus'
): EffectProcessing {
  const input = audioContext.createGain();
  const output = audioContext.createGain();
  const dryWetMixer = audioContext.createGain();
  const wetGain = audioContext.createGain();

  input.connect(dryWetMixer);
  dryWetMixer.connect(output);
  wetGain.connect(output);

  let lfoOscillator: OscillatorNode | null = null;
  let delayNode: DelayNode | null = null;
  let feedbackGain: GainNode | null = null;

  const setType = (type: string) => {
    // Cleanup
    if (lfoOscillator) {
      try {
        lfoOscillator.stop();
      } catch {
        // Already stopped
      }
    }
    if (delayNode) {
      delayNode.disconnect();
    }

    const effectOut = audioContext.createGain();
    const effectInput = audioContext.createGain();
    input.connect(effectInput);

    switch (type) {
      case 'Chorus': {
        // Detuned delay modulation
        lfoOscillator = audioContext.createOscillator();
        lfoOscillator.frequency.value = 1.5;
        delayNode = audioContext.createDelay(0.05);
        const delayModulator = audioContext.createGain();
        delayModulator.gain.value = 0.015; // Modulation depth

        lfoOscillator.connect(delayModulator);
        delayModulator.connect(delayNode.delayTime);
        effectInput.connect(delayNode);
        delayNode.connect(effectOut);
        lfoOscillator.start();
        break;
      }

      case 'Flanger': {
        // Comb-filter with feedback
        lfoOscillator = audioContext.createOscillator();
        lfoOscillator.frequency.value = 0.5;
        delayNode = audioContext.createDelay(0.01);
        feedbackGain = audioContext.createGain();
        feedbackGain.gain.value = 0.5;
        const delayModulator = audioContext.createGain();
        delayModulator.gain.value = 0.005;

        lfoOscillator.connect(delayModulator);
        delayModulator.connect(delayNode.delayTime);
        effectInput.connect(delayNode);
        delayNode.connect(feedbackGain);
        feedbackGain.connect(delayNode);
        delayNode.connect(effectOut);
        lfoOscillator.start();
        break;
      }

      case 'Phaser': {
        // All-pass filter sweep
        const allpass1 = audioContext.createBiquadFilter();
        allpass1.type = 'allpass';
        allpass1.frequency.value = 500;
        const allpass2 = audioContext.createBiquadFilter();
        allpass2.type = 'allpass';
        allpass2.frequency.value = 1000;

        lfoOscillator = audioContext.createOscillator();
        lfoOscillator.frequency.value = 0.5;
        const freqModulator = audioContext.createGain();
        freqModulator.gain.value = 800;

        lfoOscillator.connect(freqModulator);
        freqModulator.connect(allpass1.frequency);
        freqModulator.connect(allpass2.frequency);
        effectInput.connect(allpass1);
        allpass1.connect(allpass2);
        allpass2.connect(effectOut);
        lfoOscillator.start();
        break;
      }

      case 'Vibe': {
        // Staggered phase filters
        lfoOscillator = audioContext.createOscillator();
        lfoOscillator.frequency.value = 4;
        delayNode = audioContext.createDelay(0.02);
        const delayModulator = audioContext.createGain();
        delayModulator.gain.value = 0.01;

        lfoOscillator.connect(delayModulator);
        delayModulator.connect(delayNode.delayTime);
        effectInput.connect(delayNode);
        delayNode.connect(effectOut);
        lfoOscillator.start();
        break;
      }

      case 'Ensemble': {
        // Three cross-connected delays
        delayNode = audioContext.createDelay(0.02);
        feedbackGain = audioContext.createGain();
        feedbackGain.gain.value = 0.3;

        lfoOscillator = audioContext.createOscillator();
        lfoOscillator.frequency.value = 0.8;
        const delayMod = audioContext.createGain();
        delayMod.gain.value = 0.01;

        lfoOscillator.connect(delayMod);
        delayMod.connect(delayNode.delayTime);
        effectInput.connect(delayNode);
        delayNode.connect(feedbackGain);
        feedbackGain.connect(delayNode);
        delayNode.connect(effectOut);
        lfoOscillator.start();
        break;
      }

      case 'Spin': {
        // Gentle rotary-like modulation
        lfoOscillator = audioContext.createOscillator();
        lfoOscillator.frequency.value = 0.3;
        const modGain = audioContext.createGain();
        modGain.gain.value = 0.3;

        lfoOscillator.connect(modGain);
        modGain.connect(input.gain);
        effectInput.connect(effectOut);
        lfoOscillator.start();
        break;
      }

      default:
        effectInput.connect(effectOut);
    }

    effectOut.connect(wetGain);
  };

  setType(initialType);

  return {
    input,
    output,
    setType,
    setParameter: (name: string, value: number) => {
      if (name === 'Rate' && lfoOscillator) {
        lfoOscillator.frequency.setTargetAtTime(value, audioContext.currentTime, 0.05);
      } else if (name === 'Amount' && feedbackGain) {
        feedbackGain.gain.setTargetAtTime(value, audioContext.currentTime, 0.05);
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
      if (delayNode) delayNode.disconnect();
      if (feedbackGain) feedbackGain.disconnect();
    },
  };
}
