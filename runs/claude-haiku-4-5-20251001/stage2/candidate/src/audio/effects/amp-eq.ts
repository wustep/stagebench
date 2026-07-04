// Phase 2: Amp Sim / EQ effect

import { EffectProcessing, AmpEqType } from './types';

export function createAmpEqEffect(
  audioContext: AudioContext,
  initialType: AmpEqType = 'EQ only'
): EffectProcessing {
  const input = audioContext.createGain();
  const output = audioContext.createGain();
  const eqBass = audioContext.createBiquadFilter();
  const eqMid = audioContext.createBiquadFilter();
  const eqTreble = audioContext.createBiquadFilter();
  const ampColorNode = audioContext.createGain();

  eqBass.type = 'lowshelf';
  eqBass.frequency.value = 100;
  eqBass.gain.value = 0;

  eqMid.type = 'peaking';
  eqMid.frequency.value = 1000;
  eqMid.Q.value = 1;
  eqMid.gain.value = 0;

  eqTreble.type = 'highshelf';
  eqTreble.frequency.value = 4000;
  eqTreble.gain.value = 0;

  input.connect(ampColorNode);
  ampColorNode.connect(eqBass);
  eqBass.connect(eqMid);
  eqMid.connect(eqTreble);
  eqTreble.connect(output);

  let toRotaryMode = false;

  const setType = (type: string) => {
    toRotaryMode = type === 'To Rotary';

    // Apply coloration for amp models
    if (type === 'Twin') {
      // Bright, clean amp
      eqBass.gain.setValueAtTime(2, audioContext.currentTime);
      eqMid.gain.setValueAtTime(3, audioContext.currentTime);
      eqTreble.gain.setValueAtTime(4, audioContext.currentTime);
      ampColorNode.gain.setValueAtTime(0.9, audioContext.currentTime);
    } else if (type === 'JC') {
      // Clean, warm amp
      eqBass.gain.setValueAtTime(3, audioContext.currentTime);
      eqMid.gain.setValueAtTime(2, audioContext.currentTime);
      eqTreble.gain.setValueAtTime(2, audioContext.currentTime);
      ampColorNode.gain.setValueAtTime(0.95, audioContext.currentTime);
    } else if (type === 'Small') {
      // Small, punchy amp
      eqBass.gain.setValueAtTime(5, audioContext.currentTime);
      eqMid.gain.setValueAtTime(4, audioContext.currentTime);
      eqTreble.gain.setValueAtTime(1, audioContext.currentTime);
      ampColorNode.gain.setValueAtTime(0.85, audioContext.currentTime);
    } else if (type === 'LP24 Filter') {
      // Low-pass filter
      eqTreble.type = 'lowpass';
      eqTreble.frequency.value = 4000;
      eqBass.gain.setValueAtTime(0, audioContext.currentTime);
      eqMid.gain.setValueAtTime(0, audioContext.currentTime);
    } else if (type === 'HP24 Filter') {
      // High-pass filter
      eqBass.type = 'highpass';
      eqBass.frequency.value = 100;
      eqMid.gain.setValueAtTime(0, audioContext.currentTime);
      eqTreble.gain.setValueAtTime(0, audioContext.currentTime);
    } else {
      // EQ only - neutral
      eqBass.gain.setValueAtTime(0, audioContext.currentTime);
      eqMid.gain.setValueAtTime(0, audioContext.currentTime);
      eqTreble.gain.setValueAtTime(0, audioContext.currentTime);
      ampColorNode.gain.setValueAtTime(1, audioContext.currentTime);
    }
  };

  setType(initialType);

  return {
    input,
    output,
    setType,
    setParameter: (name: string, value: number) => {
      // value is 0-1 range; map to dB gain
      const gainDb = (value - 0.5) * 30; // -15 to +15 dB

      if (name === 'Bass') {
        eqBass.gain.setTargetAtTime(gainDb, audioContext.currentTime, 0.05);
      } else if (name === 'Mid') {
        eqMid.gain.setTargetAtTime(gainDb, audioContext.currentTime, 0.05);
      } else if (name === 'Treble') {
        eqTreble.gain.setTargetAtTime(gainDb, audioContext.currentTime, 0.05);
      } else if (name === 'Drive') {
        // Drive adds saturation approximation
        ampColorNode.gain.setTargetAtTime(0.8 + value * 0.4, audioContext.currentTime, 0.05);
      }
    },
    setEnabled: (enabled: boolean) => {
      output.gain.value = enabled ? 1 : 0;
    },
    setDryWet: () => {
      // Amp/EQ typically stays in signal path
    },
    cleanup: () => {
      input.disconnect();
      output.disconnect();
      eqBass.disconnect();
      eqMid.disconnect();
      eqTreble.disconnect();
      ampColorNode.disconnect();
    },
  };
}
