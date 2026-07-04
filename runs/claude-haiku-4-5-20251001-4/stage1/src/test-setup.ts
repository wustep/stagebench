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
        gain: { value: 1, setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, cancelScheduledValues: () => {} },
        connect: (dest?: any) => dest || this.destination,
        disconnect: () => {},
      };
      this.nodes.push(node);
      return node as any;
    }

    createOscillator() {
      const node = {
        type: 'sine',
        frequency: { value: 440, setValueAtTime: () => {}, linearRampToValueAtTime: () => {} },
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
        frequency: { value: 350, setValueAtTime: () => {}, linearRampToValueAtTime: () => {} },
        Q: { value: 1 },
        gain: { value: 0 },
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
