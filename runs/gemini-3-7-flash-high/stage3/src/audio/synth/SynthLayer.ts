import { SynthVoice } from './SynthVoice';
import { SynthArpeggiator } from './SynthArpeggiator';
import { EffectChain } from '../effects/EffectChain';
import { RotaryEffect } from '../effects/RotaryEffect';
import { SynthParams, SynthLayerState } from './types';
import { ALL_ZONES_ASSIGNMENT } from '../../model/splits';

export class SynthLayer {
  private ctx: AudioContext;
  public id: 'A' | 'B' | 'C';
  public effectChain: EffectChain;
  public readonly levelGain: GainNode;

  private state: SynthLayerState;
  private params: SynthParams;
  public arpeggiator: SynthArpeggiator;

  private activeVoices: Map<number, SynthVoice[]> = new Map();
  private heldKeyStack: number[] = [];
  private currentMonoVoice: SynthVoice | null = null;
  private maxPolyphony: number;
  private onVoiceCountChange?: () => void;
  private isDisposed = false;

  constructor(
    ctx: AudioContext,
    id: 'A' | 'B' | 'C',
    sharedRotary: RotaryEffect,
    masterBus: GainNode,
    maxPolyphony: number = 32,
    onVoiceCountChange?: () => void
  ) {
    this.ctx = ctx;
    this.id = id;
    this.maxPolyphony = maxPolyphony;
    this.onVoiceCountChange = onVoiceCountChange;

    // Dedicated 6-unit Effect Chain for this synth layer
    this.effectChain = new EffectChain(ctx, sharedRotary);
    this.levelGain = ctx.createGain();
    this.effectChain.output.connect(this.levelGain);
    this.levelGain.connect(masterBus);

    this.state = {
      enabled: id === 'A',
      focused: id === 'A',
      level: id === 'A' ? 7.5 : 5.0,
      octave: 0,
      sustainPedal: true,
      pitchStick: false,
      zones: { ...ALL_ZONES_ASSIGNMENT },
    };

    this.params = {
      oscCategory: 'Pure',
      waveformIndex: 2, // Saw
      oscMod: 0,
      pitchCoarse: 0,
      pitchFine: 0,
      filterType: 'LP24',
      filterCutoff: 7.0,
      filterResonance: 2.0,
      filterDrive: 0,
      filterEnvAmt: 3.0,
      filterKbTracking: 3, // 1:1
      ampAttack: 0.05,
      ampDecay: 2.0,
      ampSustain: 8.0,
      ampRelease: 1.0,
      ampVelocity: 1,
      modAttack: 0.1,
      modDecay: 1.5,
      modRelease: 1.0,
      modVelocity: false,
      modToPitch: false,
      modEnvAmt: 0,
      lfoWaveform: 'Triangle',
      lfoDestination: 'Off',
      lfoRate: 4.0,
      lfoAmount: 0,
      lfoClockSync: false,
      voiceMode: 'Poly',
      voicePriority: 'Off',
      glide: 0,
      unison: 0,
      vibratoMode: 'Off',
      vibratoRate: 5.0,
      vibratoAmount: 2.0,
      arpMode: 'Arp',
      arpDirection: 'Up',
      arpRange: 1,
      arpRate: 5.0,
      arpClockSync: false,
      arpKbHold: false,
      arpRun: false,
    };

    this.arpeggiator = new SynthArpeggiator(
      {
        mode: this.params.arpMode,
        direction: this.params.arpDirection,
        range: this.params.arpRange,
        rate: this.params.arpRate,
        clockSync: this.params.arpClockSync,
        kbHold: this.params.arpKbHold,
        run: this.params.arpRun,
        tempoBpm: 120,
      },
      (midis, durationMs) => {
        midis.forEach((m) => {
          this.spawnVoice(m, 0.8, false, 1.0);
          setTimeout(() => {
            this.killVoice(m);
          }, durationMs);
        });
      }
    );
  }

  public getState(): SynthLayerState {
    return { ...this.state };
  }

  public getParams(): SynthParams {
    return { ...this.params };
  }

  public updateState(partial: Partial<SynthLayerState>): void {
    this.state = { ...this.state, ...partial };

    if (partial.level !== undefined || partial.enabled !== undefined) {
      const now = this.ctx.currentTime;
      const gainVal =
        Math.pow(Math.max(0, Math.min(10, this.state.level)) / 10, 1.5) *
        (this.state.enabled ? 1 : 0);
      this.levelGain.gain.setTargetAtTime(gainVal, now, 0.015);
    }
  }

  public updateParams(partial: Partial<SynthParams>): void {
    this.params = { ...this.params, ...partial };

    this.arpeggiator.updateConfig({
      mode: this.params.arpMode,
      direction: this.params.arpDirection,
      range: this.params.arpRange,
      rate: this.params.arpRate,
      clockSync: this.params.arpClockSync,
      kbHold: this.params.arpKbHold,
      run: this.params.arpRun,
    });
  }

  public getActiveVoiceCount(): number {
    let count = 0;
    this.activeVoices.forEach((v) => {
      count += v.length;
    });
    return count;
  }

  public noteOn(
    midi: number,
    velocity: number = 0.8,
    isSustained: boolean = false,
    zoneGain: number = 1.0,
    modWheelValue: number = 0
  ): void {
    if (this.isDisposed || !this.state.enabled || zoneGain <= 0) return;

    if (this.params.arpRun) {
      this.arpeggiator.noteDown(midi);
      return;
    }

    const shiftedMidi = midi + this.state.octave * 12;
    if (shiftedMidi < 0 || shiftedMidi > 127) return;

    if (this.params.voiceMode === 'Poly') {
      this.spawnVoice(shiftedMidi, velocity, isSustained, zoneGain, modWheelValue);
    } else {
      // Mono or Legato
      this.handleMonoNoteOn(shiftedMidi, velocity, isSustained, zoneGain, modWheelValue);
    }
  }

  private spawnVoice(
    shiftedMidi: number,
    velocity: number,
    isSustained: boolean,
    zoneGain: number,
    modWheelValue: number = 0
  ): SynthVoice {
    this.enforcePolyphonyLimit();

    const vibratoActive =
      this.params.vibratoMode === 'On' ||
      (this.params.vibratoMode === 'Wheel' && modWheelValue > 0.05);

    const voice = new SynthVoice({
      ctx: this.ctx,
      destination: this.effectChain.input,
      midi: shiftedMidi,
      velocity: velocity * zoneGain,
      isSustained: this.state.sustainPedal && isSustained,
      oscCategory: this.params.oscCategory,
      waveformIndex: this.params.waveformIndex,
      oscCtrl: this.params.oscMod,
      pitchCoarse: this.params.pitchCoarse,
      pitchFine: this.params.pitchFine,
      unisonLevel: this.params.unison,
      filterType: this.params.filterType,
      filterCutoff: this.params.filterCutoff,
      filterResonance: this.params.filterResonance,
      filterDrive: this.params.filterDrive,
      filterEnvAmt: this.params.filterEnvAmt,
      filterKbTracking: this.params.filterKbTracking,
      ampAttack: this.params.ampAttack,
      ampDecay: this.params.ampDecay,
      ampSustain: this.params.ampSustain,
      ampRelease: this.params.ampRelease,
      ampVelocity: this.params.ampVelocity,
      modAttack: this.params.modAttack,
      modDecay: this.params.modDecay,
      modRelease: this.params.modRelease,
      modVelocity: this.params.modVelocity,
      modToPitch: this.params.modToPitch,
      modEnvAmt: this.params.modEnvAmt,
      lfoWaveform: this.params.lfoWaveform,
      lfoDestination: this.params.lfoDestination,
      lfoRate: this.params.lfoRate,
      lfoAmount: this.params.lfoAmount,
      vibratoActive,
      vibratoRate: this.params.vibratoRate,
      vibratoAmount: this.params.vibratoAmount,
    });

    const list = this.activeVoices.get(shiftedMidi) || [];
    list.push(voice);
    this.activeVoices.set(shiftedMidi, list);

    this.onVoiceCountChange?.();
    return voice;
  }

  private handleMonoNoteOn(
    shiftedMidi: number,
    velocity: number,
    isSustained: boolean,
    zoneGain: number,
    modWheelValue: number
  ): void {
    const isLegatoTransition =
      this.heldKeyStack.length > 0 && this.params.voiceMode === 'Legato' && this.currentMonoVoice;

    this.heldKeyStack.push(shiftedMidi);

    if (isLegatoTransition && this.currentMonoVoice) {
      // Legato glide to new pitch without retriggering envelopes
      const glideTimeSeconds = (this.params.glide / 10) * 0.5; // 0..0.5s
      this.currentMonoVoice.setGlidePitch(shiftedMidi, glideTimeSeconds);
    } else {
      // Retrigger voice
      if (this.currentMonoVoice) {
        this.currentMonoVoice.dispose();
        this.currentMonoVoice = null;
      }
      this.activeVoices.clear();
      this.currentMonoVoice = this.spawnVoice(
        shiftedMidi,
        velocity,
        isSustained,
        zoneGain,
        modWheelValue
      );
    }
  }

  public noteOff(midi: number, isSustainActive: boolean): void {
    if (this.params.arpRun) {
      this.arpeggiator.noteUp(midi);
      return;
    }

    const shiftedMidi = midi + this.state.octave * 12;

    if (this.params.voiceMode === 'Poly') {
      const list = this.activeVoices.get(shiftedMidi);
      if (!list) return;

      const shouldHold = this.state.sustainPedal && isSustainActive;
      if (shouldHold) {
        list.forEach((v) => (v.isSustained = true));
      } else {
        list.forEach((v) => v.release(() => this.removeVoice(shiftedMidi, v)));
        this.activeVoices.delete(shiftedMidi);
      }
    } else {
      // Mono/Legato release
      this.heldKeyStack = this.heldKeyStack.filter((m) => m !== shiftedMidi);
      if (this.heldKeyStack.length === 0) {
        if (this.currentMonoVoice) {
          const shouldHold = this.state.sustainPedal && isSustainActive;
          if (shouldHold) {
            this.currentMonoVoice.isSustained = true;
          } else {
            this.currentMonoVoice.release();
            this.currentMonoVoice = null;
          }
        }
      } else {
        // Return to remaining held note (priority)
        const targetMidi =
          this.params.voicePriority === 'Low'
            ? Math.min(...this.heldKeyStack)
            : this.params.voicePriority === 'High'
            ? Math.max(...this.heldKeyStack)
            : this.heldKeyStack[this.heldKeyStack.length - 1];

        if (this.currentMonoVoice && targetMidi !== undefined) {
          this.currentMonoVoice.setGlidePitch(targetMidi, (this.params.glide / 10) * 0.3);
        }
      }
    }

    this.onVoiceCountChange?.();
  }

  private killVoice(midi: number): void {
    const list = this.activeVoices.get(midi);
    if (list) {
      list.forEach((v) => v.release(() => this.removeVoice(midi, v)));
      this.activeVoices.delete(midi);
    }
  }

  public setSustain(sustain: boolean): void {
    if (!this.state.sustainPedal) return;

    if (!sustain) {
      this.activeVoices.forEach((voices, midi) => {
        voices.forEach((v) => {
          if (v.isSustained) {
            v.release(() => this.removeVoice(midi, v));
          }
        });
      });
      this.activeVoices.clear();
      if (this.currentMonoVoice?.isSustained) {
        this.currentMonoVoice.release();
        this.currentMonoVoice = null;
      }
      this.onVoiceCountChange?.();
    }
  }

  public setPitchBend(semitones: number): void {
    if (!this.state.pitchStick) return;
    this.activeVoices.forEach((voices) => {
      voices.forEach((v) => v.setPitchBend(semitones));
    });
    if (this.currentMonoVoice) {
      this.currentMonoVoice.setPitchBend(semitones);
    }
  }

  private enforcePolyphonyLimit(): void {
    const total = this.getActiveVoiceCount();
    if (total >= this.maxPolyphony) {
      const firstEntry = this.activeVoices.entries().next().value;
      if (firstEntry) {
        const [midi, voices] = firstEntry;
        const oldest = voices.shift();
        if (oldest) oldest.dispose();
        if (voices.length === 0) this.activeVoices.delete(midi);
      }
    }
  }

  private removeVoice(midi: number, voice: SynthVoice): void {
    const list = this.activeVoices.get(midi);
    if (list) {
      const idx = list.indexOf(voice);
      if (idx !== -1) list.splice(idx, 1);
      if (list.length === 0) this.activeVoices.delete(midi);
    }
    this.onVoiceCountChange?.();
  }

  public allNotesOff(): void {
    this.activeVoices.forEach((voices) => {
      voices.forEach((v) => v.dispose());
    });
    this.activeVoices.clear();
    this.heldKeyStack = [];
    if (this.currentMonoVoice) {
      this.currentMonoVoice.dispose();
      this.currentMonoVoice = null;
    }
    this.arpeggiator.clearHold();
    this.onVoiceCountChange?.();
  }

  public dispose(): void {
    this.isDisposed = true;
    this.allNotesOff();
    this.arpeggiator.dispose();
    this.effectChain.dispose();
  }
}
