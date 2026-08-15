import { midiToFrequency } from '../model/keyboard';

export type VoiceState = 'active' | 'sustained' | 'releasing' | 'dead';

export class PianoVoice {
  public readonly midi: number;
  public readonly velocity: number;
  public readonly startTime: number;
  public state: VoiceState = 'active';

  private ctx: AudioContext;
  private masterGain: GainNode;
  private voiceGain: GainNode;
  private filter: BiquadFilterNode;
  private oscillators: OscillatorNode[] = [];
  private oscGains: GainNode[] = [];
  private onEndedCallback?: () => void;
  private isCleanedUp = false;

  constructor(
    ctx: AudioContext,
    destination: AudioNode,
    midi: number,
    velocity: number = 0.8,
    isSustained: boolean = false,
    onEnded?: () => void
  ) {
    this.ctx = ctx;
    this.midi = midi;
    this.velocity = Math.max(0.01, Math.min(1.0, velocity));
    this.startTime = ctx.currentTime;
    this.onEndedCallback = onEnded;

    const baseFreq = midiToFrequency(midi);
    const now = ctx.currentTime;

    // Master voice gain
    this.masterGain = ctx.createGain();
    this.masterGain.connect(destination);

    // Voice envelope gain
    this.voiceGain = ctx.createGain();
    this.voiceGain.connect(this.masterGain);

    // Dynamic lowpass filter to mimic acoustic piano brightness under velocity
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    const cutoffBase = Math.min(18000, baseFreq * (2.5 + this.velocity * 8.0));
    this.filter.frequency.setValueAtTime(cutoffBase, now);
    this.filter.Q.setValueAtTime(1.0, now);
    this.filter.connect(this.voiceGain);

    // Envelope parameters based on acoustic piano register
    // Higher registers decay faster, lower bass notes sustain longer
    const decayTime = Math.max(1.5, 9.0 - (midi - 28) * 0.09); // ~9s at E1 to ~2.5s at E7
    const attackTime = 0.003;
    const peakGain = Math.pow(this.velocity, 1.4) * 0.28;

    // Set voice gain envelope
    this.voiceGain.gain.setValueAtTime(0.0001, now);
    this.voiceGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peakGain), now + attackTime);
    // Exponential decay towards plateau
    this.voiceGain.gain.exponentialRampToValueAtTime(Math.max(0.00001, peakGain * 0.05), now + attackTime + decayTime);

    // Harmonics for rich acoustic grand piano sound
    // Partials with slight inharmonicity (string stiffness): f_n = n * f0 * sqrt(1 + B * n^2)
    const inharmonicityB = 0.0003;
    const partials = [
      { ratio: 1.0, gain: 1.0, type: 'sine' as OscillatorType },
      { ratio: 2.0 * Math.sqrt(1 + inharmonicityB * 4), gain: 0.6 * this.velocity, type: 'sine' as OscillatorType },
      { ratio: 3.0 * Math.sqrt(1 + inharmonicityB * 9), gain: 0.35 * Math.pow(this.velocity, 1.2), type: 'sine' as OscillatorType },
      { ratio: 4.0 * Math.sqrt(1 + inharmonicityB * 16), gain: 0.2 * Math.pow(this.velocity, 1.4), type: 'sine' as OscillatorType },
      { ratio: 5.0 * Math.sqrt(1 + inharmonicityB * 25), gain: 0.1 * Math.pow(this.velocity, 1.6), type: 'sine' as OscillatorType },
      { ratio: 6.0 * Math.sqrt(1 + inharmonicityB * 36), gain: 0.05 * Math.pow(this.velocity, 1.8), type: 'sine' as OscillatorType },
    ];

    partials.forEach((partial, index) => {
      const osc = ctx.createOscillator();
      const pGain = ctx.createGain();

      osc.type = partial.type;
      const freq = Math.min(20000, baseFreq * partial.ratio);
      osc.frequency.setValueAtTime(freq, now);

      // Higher partials decay faster than fundamental
      const partialDecay = decayTime / (1 + index * 0.7);
      pGain.gain.setValueAtTime(Math.max(0.0001, partial.gain), now);
      pGain.gain.exponentialRampToValueAtTime(0.00001, now + partialDecay);

      osc.connect(pGain);
      pGain.connect(this.filter);

      try {
        osc.start(now);
      } catch {
        // Safe for test environments
      }

      this.oscillators.push(osc);
      this.oscGains.push(pGain);
    });

    // Auto-cleanup timer if note rings out naturally
    setTimeout(() => {
      if (!this.isCleanedUp && (this.state === 'dead' || this.state === 'releasing')) {
        this.cleanup();
      }
    }, (decayTime + 0.5) * 1000);
  }

  public noteOff(isSustainActive: boolean): void {
    if (this.state === 'dead') return;

    if (isSustainActive) {
      this.state = 'sustained';
    } else {
      this.release();
    }
  }

  public release(): void {
    if (this.state === 'dead' || this.state === 'releasing') return;
    this.state = 'releasing';

    const now = this.ctx.currentTime;
    // Release damping time: bass notes take ~0.35s to damp, treble notes ~0.15s
    const releaseDuration = Math.max(0.12, 0.35 - (this.midi - 28) * 0.003);

    try {
      this.voiceGain.gain.cancelScheduledValues(now);
      const currentGain = Math.max(0.0001, this.voiceGain.gain.value);
      this.voiceGain.gain.setValueAtTime(currentGain, now);
      this.voiceGain.gain.exponentialRampToValueAtTime(0.00001, now + releaseDuration);
    } catch {
      // Fallback
    }

    setTimeout(() => {
      this.cleanup();
    }, (releaseDuration + 0.05) * 1000);
  }

  public stop(immediate: boolean = false): void {
    if (this.state === 'dead') return;
    this.state = 'dead';

    const now = this.ctx.currentTime;
    const fadeTime = immediate ? 0.005 : 0.02;

    try {
      this.voiceGain.gain.cancelScheduledValues(now);
      const currentGain = Math.max(0.0001, this.voiceGain.gain.value);
      this.voiceGain.gain.setValueAtTime(currentGain, now);
      this.voiceGain.gain.linearRampToValueAtTime(0.00001, now + fadeTime);
    } catch {
      // Fallback
    }

    setTimeout(() => {
      this.cleanup();
    }, (fadeTime + 0.01) * 1000);
  }

  public cleanup(): void {
    if (this.isCleanedUp) return;
    this.isCleanedUp = true;
    this.state = 'dead';

    this.oscillators.forEach(osc => {
      try {
        osc.stop();
        osc.disconnect();
      } catch {
        // Safe disconnection
      }
    });
    this.oscillators = [];

    this.oscGains.forEach(g => {
      try {
        g.disconnect();
      } catch {
        // Safe disconnection
      }
    });
    this.oscGains = [];

    try {
      this.filter.disconnect();
      this.voiceGain.disconnect();
      this.masterGain.disconnect();
    } catch {
      // Safe disconnection
    }

    if (this.onEndedCallback) {
      this.onEndedCallback();
    }
  }
}
