// Phase 2: Delay effect with feedback filter

import { EffectProcessing } from './types';

export function createDelayEffect(audioContext: AudioContext): EffectProcessing {
  const input = audioContext.createGain();
  const output = audioContext.createGain();
  const dryWetMixer = audioContext.createGain();
  const wetGain = audioContext.createGain();
  const delayNode = audioContext.createDelay(3);
  const feedbackGain = audioContext.createGain();
  const feedbackFilter = audioContext.createBiquadFilter();
  feedbackFilter.type = 'lowpass';
  feedbackFilter.frequency.value = 5000;

  input.connect(dryWetMixer);
  dryWetMixer.connect(output);

  input.connect(delayNode);
  delayNode.connect(feedbackGain);
  feedbackGain.connect(feedbackFilter);
  feedbackFilter.connect(delayNode);
  delayNode.connect(wetGain);
  wetGain.connect(output);

  delayNode.delayTime.value = 0.5;
  feedbackGain.gain.value = 0.6;

  return {
    input,
    output,
    setType: () => {
      // Delay only has one type
    },
    setParameter: (name: string, value: number) => {
      if (name === 'Tempo') {
        // Value is in milliseconds
        delayNode.delayTime.setTargetAtTime(value / 1000, audioContext.currentTime, 0.05);
      } else if (name === 'Feedback') {
        feedbackGain.gain.setTargetAtTime(value, audioContext.currentTime, 0.05);
      } else if (name === 'FeedbackFilter') {
        // 0 = Off, 1 = LP, 2 = HP, 3 = BP
        if (value === 0) {
          feedbackFilter.frequency.value = 20000; // Bypass (pass all frequencies)
        } else if (value === 1) {
          feedbackFilter.type = 'lowpass';
          feedbackFilter.frequency.value = 5000;
        } else if (value === 2) {
          feedbackFilter.type = 'highpass';
          feedbackFilter.frequency.value = 500;
        } else if (value === 3) {
          feedbackFilter.type = 'bandpass';
          feedbackFilter.frequency.value = 2000;
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
      input.disconnect();
      output.disconnect();
      dryWetMixer.disconnect();
      wetGain.disconnect();
      delayNode.disconnect();
      feedbackGain.disconnect();
      feedbackFilter.disconnect();
    },
  };
}
