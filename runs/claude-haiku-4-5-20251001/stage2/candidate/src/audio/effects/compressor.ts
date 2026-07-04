// Phase 2: Compressor effect with soft-knee dynamics

import { EffectProcessing } from './types';

export function createCompressorEffect(audioContext: AudioContext): EffectProcessing {
  const input = audioContext.createGain();
  const output = audioContext.createGain();
  const compressorNode = audioContext.createDynamicsCompressor();
  const makeupGain = audioContext.createGain();

  // Soft-knee compressor settings
  compressorNode.threshold.value = -30;
  compressorNode.knee.value = 30; // Soft knee
  compressorNode.ratio.value = 4;
  compressorNode.attack.value = 0.005;
  compressorNode.release.value = 0.1;
  makeupGain.gain.value = 1;

  input.connect(compressorNode);
  compressorNode.connect(makeupGain);
  makeupGain.connect(output);

  return {
    input,
    output,
    setType: () => {
      // Compressor only has one type
    },
    setParameter: (name: string, value: number) => {
      if (name === 'Amount') {
        // Value 0-1: 0 = no compression, 1 = heavy compression
        const ratio = 1 + value * 15; // 1:1 to 16:1
        compressorNode.ratio.setTargetAtTime(ratio, audioContext.currentTime, 0.05);

        // Adjust threshold based on amount
        const threshold = -30 - value * 30; // -30 to -60 dB
        compressorNode.threshold.setTargetAtTime(threshold, audioContext.currentTime, 0.05);

        // Makeup gain compensation
        const makeup = 1 + value * 0.5;
        makeupGain.gain.setTargetAtTime(makeup, audioContext.currentTime, 0.05);
      } else if (name === 'FastMode') {
        if (value > 0.5) {
          compressorNode.attack.setTargetAtTime(0.002, audioContext.currentTime, 0.05);
          compressorNode.release.setTargetAtTime(0.05, audioContext.currentTime, 0.05);
        } else {
          compressorNode.attack.setTargetAtTime(0.005, audioContext.currentTime, 0.05);
          compressorNode.release.setTargetAtTime(0.1, audioContext.currentTime, 0.05);
        }
      }
    },
    setEnabled: (enabled: boolean) => {
      output.gain.value = enabled ? 1 : 0;
    },
    setDryWet: () => {
      // Compressor typically stays in signal path
    },
    cleanup: () => {
      input.disconnect();
      output.disconnect();
      compressorNode.disconnect();
      makeupGain.disconnect();
    },
  };
}
