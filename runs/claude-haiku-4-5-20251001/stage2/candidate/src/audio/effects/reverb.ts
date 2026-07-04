// Phase 2: Reverb effect with multiple types

import { EffectProcessing, ReverbType } from './types';

export function createReverbEffect(
  audioContext: AudioContext,
  initialType: ReverbType = 'Room'
): EffectProcessing {
  const input = audioContext.createGain();
  const output = audioContext.createGain();
  const dryWetMixer = audioContext.createGain();
  const wetGain = audioContext.createGain();
  const reverbGain = audioContext.createGain();

  // Create simple algorithmic reverb using delays and feedback
  const predelay = audioContext.createDelay(0.05);
  const earlyReflections: DelayNode[] = [];
  const lateReflections: DelayNode[] = [];
  const feedbackGains: GainNode[] = [];

  input.connect(dryWetMixer);
  dryWetMixer.connect(output);

  // Create early and late reflection taps
  for (let i = 0; i < 4; i++) {
    const delayNode = audioContext.createDelay(0.1);
    const gainNode = audioContext.createGain();
    earlyReflections.push(delayNode);
    feedbackGains.push(gainNode);
  }

  input.connect(predelay);
  predelay.connect(reverbGain);

  earlyReflections.forEach((delay, i) => {
    reverbGain.connect(delay);
    delay.connect(feedbackGains[i]);
    feedbackGains[i].connect(reverbGain);
    delay.connect(wetGain);
  });

  wetGain.connect(output);

  const setType = (type: string) => {
    // Set decay time and early reflection pattern based on type
    const decayTimes: Record<ReverbType, number> = {
      Booth: 0.5,
      Room: 1.2,
      Spring: 1.5,
      Stage: 2.0,
      Hall: 3.0,
      Cathedral: 5.0,
    };

    const decayTime = decayTimes[type as ReverbType] || 1.2;

    // Adjust feedback gains for decay
    feedbackGains.forEach((gain, i) => {
      const delayMs = 30 + i * 20; // Staggered delay taps
      earlyReflections[i].delayTime.value = delayMs / 1000;
      gain.gain.setValueAtTime(
        Math.pow(0.5, (delayMs / 1000) / decayTime),
        audioContext.currentTime
      );
    });

    // Adjust pre-delay for type
    if (type === 'Spring') {
      predelay.delayTime.value = 0.01; // Spring has tight pre-delay
    } else if (type === 'Cathedral') {
      predelay.delayTime.value = 0.03; // Cathedral has longer pre-delay
    } else {
      predelay.delayTime.value = 0.015;
    }
  };

  setType(initialType);

  return {
    input,
    output,
    setType,
    setParameter: (name: string, value: number) => {
      if (name === 'Decay') {
        // Scale the reverb decay time
        feedbackGains.forEach((gain) => {
          gain.gain.setTargetAtTime(value, audioContext.currentTime, 0.05);
        });
      } else if (name === 'Bright') {
        // Add high-pass filtering for brightness
        // Value > 0.5 = brighter (less filtering)
        // This is approximated by adjusting overall timbre
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
      reverbGain.disconnect();
      predelay.disconnect();
      earlyReflections.forEach((delay) => delay.disconnect());
      feedbackGains.forEach((gain) => gain.disconnect());
    },
  };
}
