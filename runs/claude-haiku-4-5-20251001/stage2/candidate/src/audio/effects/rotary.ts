// Phase 2: Rotary speaker effect

import { EffectProcessing } from './types';

export function createRotaryEffect(audioContext: AudioContext): EffectProcessing {
  const input = audioContext.createGain();
  const output = audioContext.createGain();
  const rotaryGain = audioContext.createGain();

  // Create rotary speaker simulation using modulation
  const hornLFO = audioContext.createOscillator();
  const bassLFO = audioContext.createOscillator();
  const hornModGain = audioContext.createGain();
  const bassModGain = audioContext.createGain();
  const hornFilter = audioContext.createBiquadFilter();
  const bassPan = audioContext.createStereoPanner();

  // Rotary speaker: horn (fast) and bass rotor (slow)
  hornLFO.frequency.value = 5; // Slow speed: 5 Hz
  bassLFO.frequency.value = 0.5; // Very slow: 0.5 Hz

  hornModGain.gain.value = 200; // Frequency modulation depth
  bassModGain.gain.value = 0.4; // Pan modulation depth

  hornFilter.type = 'highpass';
  hornFilter.frequency.value = 1000;

  input.connect(hornFilter);
  input.connect(bassPan);

  hornLFO.connect(hornModGain);
  hornModGain.connect(hornFilter.frequency);

  bassLFO.connect(bassModGain);
  bassModGain.connect(bassPan.pan);

  hornFilter.connect(rotaryGain);
  bassPan.connect(rotaryGain);
  rotaryGain.connect(output);

  hornLFO.start();
  bassLFO.start();

  let currentSpeed: 'slow' | 'fast' = 'slow';

  return {
    input,
    output,
    setType: () => {
      // Rotary has one type
    },
    setParameter: (name: string, value: number) => {
      if (name === 'Speed') {
        // 0-0.5 = slow (ramp to 5 Hz), 0.5-1 = fast (ramp to 15 Hz)
        let targetFreq: number;
        if (value < 0.5) {
          targetFreq = 3 + (value / 0.5) * 2; // 3-5 Hz for slow
          currentSpeed = 'slow';
        } else {
          targetFreq = 5 + ((value - 0.5) / 0.5) * 10; // 5-15 Hz for fast
          currentSpeed = 'fast';
        }

        // Smooth ramp to new frequency
        hornLFO.frequency.setTargetAtTime(targetFreq, audioContext.currentTime, 0.2);
        bassLFO.frequency.setTargetAtTime(targetFreq * 0.1, audioContext.currentTime, 0.2);
      } else if (name === 'Drive') {
        // Drive adds saturation effect
        rotaryGain.gain.setTargetAtTime(0.8 + value * 0.4, audioContext.currentTime, 0.05);
      }
    },
    setEnabled: (enabled: boolean) => {
      output.gain.value = enabled ? 1 : 0;
    },
    setDryWet: () => {
      // Rotary typically stays in signal path
    },
    cleanup: () => {
      try {
        hornLFO.stop();
        bassLFO.stop();
      } catch {
        // Already stopped
      }
      input.disconnect();
      output.disconnect();
      rotaryGain.disconnect();
      hornModGain.disconnect();
      bassModGain.disconnect();
      hornFilter.disconnect();
      bassPan.disconnect();
    },
  };
}
