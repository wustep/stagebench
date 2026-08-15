import { SynthOscCategory } from './types';

export interface SynthOscillatorOptions {
  ctx: AudioContext;
  destination: AudioNode;
  frequency: number; // fundamental Hz
  category: SynthOscCategory;
  waveformIndex: number;
  oscCtrl: number; // 0..10
  unisonLevel: number; // 0..3
}

export class SynthOscillator {
  private ctx: AudioContext;
  private destination: AudioNode;
  public frequency: number;
  private category: SynthOscCategory;
  private waveformIndex: number;
  private oscCtrl: number;
  private unisonLevel: number;

  private primaryNodes: AudioNode[] = [];
  private oscillators: OscillatorNode[] = [];
  private modGain: GainNode | null = null;
  private outputGain: GainNode;

  constructor(options: SynthOscillatorOptions) {
    this.ctx = options.ctx;
    this.destination = options.destination;
    this.frequency = options.frequency;
    this.category = options.category;
    this.waveformIndex = options.waveformIndex;
    this.oscCtrl = Math.max(0, Math.min(10, options.oscCtrl));
    this.unisonLevel = options.unisonLevel;

    const now = this.ctx.currentTime;
    this.outputGain = this.ctx.createGain();
    this.outputGain.gain.setValueAtTime(0.5, now);
    this.outputGain.connect(this.destination);

    this.setupOscillators(now);
  }

  private setupOscillators(now: number): void {
    switch (this.category) {
      case 'Pure': {
        this.buildPure(now);
        break;
      }
      case 'Sync': {
        this.buildSync(now);
        break;
      }
      case 'Multi': {
        this.buildMulti(now);
        break;
      }
      case 'Super': {
        this.buildSuper(now);
        break;
      }
      case 'FM-H': {
        this.buildFM(now);
        break;
      }
    }
  }

  private buildPure(now: number): void {
    // 0: Sine, 1: Triangle, 2: Saw, 3: Square, 4: Pulse 33, 5: Pulse 10, 6: White Noise
    const wf = this.waveformIndex;

    if (wf === 6) {
      // White noise generator
      try {
        const bufferSize = Math.floor(this.ctx.sampleRate * 2);
        const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          output[i] = Math.random() * 2 - 1;
        }

        const whiteNoise = this.ctx.createBufferSource();
        whiteNoise.buffer = noiseBuffer;
        whiteNoise.loop = true;
        whiteNoise.connect(this.outputGain);
        whiteNoise.start(now);
        this.primaryNodes.push(whiteNoise);
      } catch {}
      return;
    }

    const osc = this.ctx.createOscillator();
    if (wf === 0) osc.type = 'sine';
    else if (wf === 1) osc.type = 'triangle';
    else if (wf === 2) osc.type = 'sawtooth';
    else if (wf === 3) osc.type = 'square';
    else if (wf === 4 || wf === 5) {
      // Pulse 33 or Pulse 10
      osc.type = 'square';
    } else {
      osc.type = 'sawtooth';
    }

    osc.frequency.setValueAtTime(this.frequency, now);

    // Apply Unison if active
    if (this.unisonLevel > 0) {
      const detunes = this.unisonLevel === 1 ? [-7, 7] : this.unisonLevel === 2 ? [-14, 0, 14] : [-22, -10, 0, 10, 22];
      detunes.forEach((cents) => {
        const uOsc = this.ctx.createOscillator();
        uOsc.type = osc.type;
        uOsc.frequency.setValueAtTime(this.frequency, now);
        uOsc.detune.setValueAtTime(cents, now);
        const uGain = this.ctx.createGain();
        uGain.gain.setValueAtTime(0.3 / detunes.length, now);
        uOsc.connect(uGain);
        uGain.connect(this.outputGain);
        try {
          uOsc.start(now);
        } catch {}
        this.oscillators.push(uOsc);
        this.primaryNodes.push(uGain);
      });
    } else {
      osc.connect(this.outputGain);
      try {
        osc.start(now);
      } catch {}
      this.oscillators.push(osc);
    }
  }

  private buildSync(now: number): void {
    // Sync: Master oscillator + slave oscillator tuned via Osc Ctrl
    const oscType = this.waveformIndex === 1 ? 'square' : 'sawtooth';

    // Master fundamental
    const masterOsc = this.ctx.createOscillator();
    masterOsc.type = oscType;
    masterOsc.frequency.setValueAtTime(this.frequency, now);

    // Slave tuned higher by oscCtrl (1.0x to 4.5x)
    const slaveFreq = this.frequency * (1.0 + (this.oscCtrl / 10) * 3.5);
    const slaveOsc = this.ctx.createOscillator();
    slaveOsc.type = oscType;
    slaveOsc.frequency.setValueAtTime(slaveFreq, now);

    const masterGain = this.ctx.createGain();
    masterGain.gain.setValueAtTime(0.4, now);
    masterOsc.connect(masterGain);
    masterGain.connect(this.outputGain);

    const slaveGain = this.ctx.createGain();
    slaveGain.gain.setValueAtTime(0.4, now);
    slaveOsc.connect(slaveGain);
    slaveGain.connect(this.outputGain);

    try {
      masterOsc.start(now);
      slaveOsc.start(now);
    } catch {}

    this.oscillators.push(masterOsc, slaveOsc);
    this.primaryNodes.push(masterGain, slaveGain);
  }

  private buildMulti(now: number): void {
    // Multi Saw: 3 stacked saws detuned by Osc Ctrl
    const detuneAmount = (this.oscCtrl / 10) * 45; // 0..45 cents
    const is8ve = this.waveformIndex === 1; // Multi Saw 8ve

    const detunes = is8ve
      ? [
          { mult: 1.0, cents: -detuneAmount },
          { mult: 1.0, cents: detuneAmount },
          { mult: 2.0, cents: 0 },
        ]
      : [
          { mult: 1.0, cents: -detuneAmount },
          { mult: 1.0, cents: 0 },
          { mult: 1.0, cents: detuneAmount },
        ];

    detunes.forEach((d) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(this.frequency * d.mult, now);
      osc.detune.setValueAtTime(d.cents, now);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.28, now);
      osc.connect(gain);
      gain.connect(this.outputGain);

      try {
        osc.start(now);
      } catch {}

      this.oscillators.push(osc);
      this.primaryNodes.push(gain);
    });
  }

  private buildSuper(now: number): void {
    // Super Saw / Super Square: 5-voice dense hypersaw detuned by Osc Ctrl
    const oscType = this.waveformIndex === 1 ? 'square' : 'sawtooth';
    const spreadCents = (this.oscCtrl / 10) * 60; // 0..60 cents

    const offsets = [-1.0, -0.5, 0, 0.5, 1.0];
    offsets.forEach((ratio) => {
      const osc = this.ctx.createOscillator();
      osc.type = oscType;
      osc.frequency.setValueAtTime(this.frequency, now);
      osc.detune.setValueAtTime(ratio * spreadCents, now);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.18, now);
      osc.connect(gain);
      gain.connect(this.outputGain);

      try {
        osc.start(now);
      } catch {}

      this.oscillators.push(osc);
      this.primaryNodes.push(gain);
    });
  }

  private buildFM(now: number): void {
    // 2-Operator Harmonic FM: Carrier sine + Modulator sine (ratio 2:1 or 1:1)
    const carrier = this.ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(this.frequency, now);

    const modulator = this.ctx.createOscillator();
    modulator.type = 'sine';
    modulator.frequency.setValueAtTime(this.frequency * 2.0, now); // 2nd harmonic modulator

    this.modGain = this.ctx.createGain();
    // Modulation index: 0..8x carrier frequency
    const modDepth = (this.oscCtrl / 10) * 8.0 * this.frequency;
    this.modGain.gain.setValueAtTime(modDepth, now);

    modulator.connect(this.modGain);
    this.modGain.connect(carrier.frequency);

    carrier.connect(this.outputGain);

    try {
      modulator.start(now);
      carrier.start(now);
    } catch {}

    this.oscillators.push(modulator, carrier);
    this.primaryNodes.push(this.modGain);
  }

  public setFrequency(freq: number, timeConstant: number = 0.005): void {
    this.frequency = freq;
    const now = this.ctx.currentTime;
    this.oscillators.forEach((osc) => {
      try {
        osc.frequency.setTargetAtTime(freq, now, timeConstant);
      } catch {}
    });
  }

  public setDetune(cents: number): void {
    const now = this.ctx.currentTime;
    this.oscillators.forEach((osc) => {
      try {
        osc.detune.setTargetAtTime(cents, now, 0.015);
      } catch {}
    });
  }

  public setOscCtrl(val: number): void {
    this.oscCtrl = Math.max(0, Math.min(10, val));
    const now = this.ctx.currentTime;
    if (this.category === 'FM-H' && this.modGain) {
      const depth = (this.oscCtrl / 10) * 8.0 * this.frequency;
      this.modGain.gain.setTargetAtTime(depth, now, 0.015);
    }
  }

  public dispose(): void {
    this.oscillators.forEach((osc) => {
      try {
        osc.stop();
        osc.disconnect();
      } catch {}
    });
    this.oscillators = [];

    this.primaryNodes.forEach((node) => {
      try {
        (node as AudioScheduledSourceNode).stop?.();
        node.disconnect();
      } catch {}
    });
    this.primaryNodes = [];

    try {
      this.outputGain.disconnect();
    } catch {}
  }
}
