import { EffectChain } from './effects/EffectChain';
import { RotaryEffect } from './effects/RotaryEffect';
import { SampleLibrary } from './SampleLibrary';
import { PianoVoice, PianoVoiceConfig } from './PianoVoice';

export interface PianoLayerState {
  id: 'A' | 'B';
  enabled: boolean;
  focused: boolean;
  level: number; // 0..10
  octave: number; // -2..+2
  type: number; // 0..5
  model: number; // 1..9
  kbTouch: number; // 0..3
  timbre: number; // 0..5
  dynComp: number; // 0..3
  unison: number; // 0..3
  softRelease: boolean;
  stringRes: boolean;
  sustainPedal: boolean; // SUSTPED toggle
  pitchStick: boolean; // PSTICK toggle
}

export class PianoLayer {
  public readonly id: 'A' | 'B';
  public readonly effectChain: EffectChain;
  public readonly levelGain: GainNode;

  private ctx: AudioContext;
  private maxPolyphony: number = 32;
  private activeVoices: Map<number, PianoVoice[]> = new Map();
  private allVoices: PianoVoice[] = [];
  private onVoiceCountChange?: () => void;
  private isDisposed = false;

  private state: PianoLayerState;

  constructor(
    ctx: AudioContext,
    id: 'A' | 'B',
    sharedRotary: RotaryEffect,
    masterBus: AudioNode,
    maxPolyphony: number = 32,
    onVoiceCountChange?: () => void
  ) {
    this.ctx = ctx;
    this.id = id;
    this.maxPolyphony = maxPolyphony;
    this.onVoiceCountChange = onVoiceCountChange;

    this.state = {
      id,
      enabled: id === 'A', // Layer A on by default, Layer B off
      focused: id === 'A',
      level: id === 'A' ? 8.5 : 6.0,
      octave: 0,
      type: 0, // Grand
      model: 1, // Concert Grand
      kbTouch: 0, // Off
      timbre: 0, // Off
      dynComp: 0, // Off
      unison: 0, // Off
      softRelease: false,
      stringRes: true,
      sustainPedal: true,
      pitchStick: false,
    };

    // Effect chain for this layer
    this.effectChain = new EffectChain(ctx, sharedRotary);

    // Layer level fader gain node
    this.levelGain = ctx.createGain();
    const initialGain = this.calculateLevelGain(this.state.level, this.state.enabled);
    this.levelGain.gain.setValueAtTime(initialGain, ctx.currentTime);

    // Connect: effectChain.output -> levelGain -> masterBus
    this.effectChain.output.connect(this.levelGain);
    this.levelGain.connect(masterBus);
  }

  public getState(): PianoLayerState {
    return { ...this.state };
  }

  public updateState(partial: Partial<PianoLayerState>): void {
    const prevEnabled = this.state.enabled;
    this.state = { ...this.state, ...partial };

    if (partial.enabled !== undefined || partial.level !== undefined) {
      const now = this.ctx.currentTime;
      const targetGain = this.calculateLevelGain(this.state.level, this.state.enabled);
      this.levelGain.gain.setTargetAtTime(targetGain, now, 0.015);
    }

    if (prevEnabled && !this.state.enabled) {
      // If layer disabled, release voices gracefully
      this.allNotesOff();
    }
  }

  private calculateLevelGain(level: number, enabled: boolean): number {
    if (!enabled || level <= 0.05) return 0.0;
    // Logarithmic fader curve: 0..10 -> 0.0 to 1.2
    return Math.pow(level / 10, 1.6) * 1.1;
  }

  public getActiveVoiceCount(): number {
    return this.allVoices.filter((v) => v.isActive()).length;
  }

  public noteOn(
    midi: number,
    velocity: number,
    sampleLibrary: SampleLibrary,
    isSustainActive: boolean,
    softPedalActive: boolean = false
  ): PianoVoice | null {
    if (this.isDisposed || !this.state.enabled) return null;

    this.pruneDeadVoices();
    while (this.allVoices.length >= this.maxPolyphony) {
      this.stealOldestVoice();
    }

    const config: PianoVoiceConfig = {
      layerId: this.id,
      typeIdx: this.state.type,
      modelIdx: this.state.model,
      octaveShift: this.state.octave,
      kbTouch: this.state.kbTouch,
      timbre: this.state.timbre,
      dynComp: this.state.dynComp,
      unison: this.state.unison,
      softRelease: this.state.softRelease,
      stringRes: this.state.stringRes,
      sustainEnabled: this.state.sustainPedal,
      pitchStickEnabled: this.state.pitchStick,
      softPedalActive,
    };

    const voice = new PianoVoice(
      this.ctx,
      this.effectChain.input,
      sampleLibrary,
      midi,
      velocity,
      config,
      isSustainActive && this.state.sustainPedal,
      () => {
        this.pruneDeadVoices();
        if (this.onVoiceCountChange) this.onVoiceCountChange();
      }
    );

    const list = this.activeVoices.get(midi) || [];
    list.push(voice);
    this.activeVoices.set(midi, list);
    this.allVoices.push(voice);

    if (this.onVoiceCountChange) this.onVoiceCountChange();
    return voice;
  }

  public noteOff(midi: number, isSustainPedalDown: boolean): void {
    const list = this.activeVoices.get(midi);
    if (!list || list.length === 0) return;

    list.forEach((v) => {
      v.noteOff(isSustainPedalDown);
    });

    this.activeVoices.delete(midi);
    this.pruneDeadVoices();
    if (this.onVoiceCountChange) this.onVoiceCountChange();
  }

  public setSustain(sustain: boolean): void {
    if (!sustain) {
      this.allVoices.forEach((v) => {
        if (v.state === 'sustained') {
          v.release();
        }
      });
    }
    this.pruneDeadVoices();
    if (this.onVoiceCountChange) this.onVoiceCountChange();
  }

  public setPitchBend(semitones: number): void {
    this.allVoices.forEach((v) => {
      v.setPitchBend(semitones);
    });
  }

  private stealOldestVoice(): void {
    let candidate = this.allVoices.find((v) => v.state === 'releasing');
    if (!candidate) {
      candidate = this.allVoices.find((v) => v.state === 'sustained');
    }
    if (!candidate && this.allVoices.length > 0) {
      candidate = this.allVoices[0];
    }
    if (candidate) {
      candidate.stop(true);
      candidate.cleanup();
      this.pruneDeadVoices();
    }
  }

  private pruneDeadVoices(): void {
    this.allVoices = this.allVoices.filter((v) => v.state !== 'dead');
    for (const [m, list] of this.activeVoices.entries()) {
      const alive = list.filter((v) => v.state !== 'dead');
      if (alive.length === 0) {
        this.activeVoices.delete(m);
      } else {
        this.activeVoices.set(m, alive);
      }
    }
  }

  public allNotesOff(): void {
    this.allVoices.forEach((v) => {
      v.stop(true);
      v.cleanup();
    });
    this.activeVoices.clear();
    this.allVoices = [];
    if (this.onVoiceCountChange) this.onVoiceCountChange();
  }

  public dispose(): void {
    this.isDisposed = true;
    this.allNotesOff();
    this.effectChain.dispose();
    try {
      this.levelGain.disconnect();
    } catch {}
  }
}
