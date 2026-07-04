import '@testing-library/jest-dom/vitest';
import { beforeAll } from 'vitest';

// Mock Web Audio API for tests
beforeAll(() => {
  // Create a mock AudioContext for tests
  const mockAudioContext = class {
    currentTime = 0;
    destination = { connect: () => {} };
    private nodes: any[] = [];

    createGain() {
      const node = {
        gain: {
          value: 1,
          setValueAtTime: () => {},
          linearRampToValueAtTime: () => {},
          cancelScheduledValues: () => {},
          setTargetAtTime: () => {},
        },
        connect: (dest?: any) => dest || this.destination,
        disconnect: () => {},
      };
      this.nodes.push(node);
      return node as any;
    }

    createOscillator() {
      const node = {
        type: 'sine',
        frequency: {
          value: 440,
          setValueAtTime: () => {},
          linearRampToValueAtTime: () => {},
          setTargetAtTime: () => {},
        },
        connect: (dest: any) => dest,
        start: () => {},
        stop: () => {},
      };
      this.nodes.push(node);
      return node as any;
    }

    createBiquadFilter() {
      const node = {
        type: 'lowpass',
        frequency: {
          value: 350,
          setValueAtTime: () => {},
          linearRampToValueAtTime: () => {},
          setTargetAtTime: () => {},
        },
        Q: { value: 1 },
        gain: { value: 0 },
        connect: (dest: any) => dest,
        disconnect: () => {},
      };
      this.nodes.push(node);
      return node as any;
    }

    createDelay(maxTime: number = 1) {
      const node = {
        delayTime: {
          value: 0,
          setValueAtTime: () => {},
          linearRampToValueAtTime: () => {},
          setTargetAtTime: () => {},
        },
        connect: (dest: any) => dest,
        disconnect: () => {},
      };
      this.nodes.push(node);
      return node as any;
    }

    createDynamicsCompressor() {
      const node = {
        threshold: { value: -24, setTargetAtTime: () => {} },
        knee: { value: 30 },
        ratio: { value: 12, setTargetAtTime: () => {} },
        attack: { value: 0.003, setTargetAtTime: () => {} },
        release: { value: 0.25, setTargetAtTime: () => {} },
        connect: (dest: any) => dest,
        disconnect: () => {},
      };
      this.nodes.push(node);
      return node as any;
    }

    createStereoPanner() {
      const node = {
        pan: {
          value: 0,
          setValueAtTime: () => {},
          linearRampToValueAtTime: () => {},
          setTargetAtTime: () => {},
        },
        connect: (dest: any) => dest,
        disconnect: () => {},
      };
      this.nodes.push(node);
      return node as any;
    }
  };

  (global as any).AudioContext = mockAudioContext;
  (global as any).webkitAudioContext = mockAudioContext;
});
