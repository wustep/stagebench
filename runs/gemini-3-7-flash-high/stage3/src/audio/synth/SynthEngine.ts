import { SynthLayer } from './SynthLayer';
import { RotaryEffect } from '../effects/RotaryEffect';
import { SplitConfig, calculateNoteZoneGains } from '../../model/splits';

export interface SynthEngineOptions {
  ctx: AudioContext;
  masterBus: GainNode;
  sharedRotary: RotaryEffect;
  maxPolyphony?: number;
  onVoiceCountChange?: () => void;
}

export class SynthEngine {
  private ctx: AudioContext;
  private masterBus: GainNode;
  private sharedRotary: RotaryEffect;

  public layerA: SynthLayer;
  public layerB: SynthLayer;
  public layerC: SynthLayer;

  private isSectionOn: boolean = false;
  private isSustainActive: boolean = false;
  private modWheelValue: number = 0;
  private isDisposed: boolean = false;
  private onVoiceCountChange?: () => void;

  constructor(options: SynthEngineOptions) {
    this.ctx = options.ctx;
    this.masterBus = options.masterBus;
    this.sharedRotary = options.sharedRotary;
    this.onVoiceCountChange = options.onVoiceCountChange;

    this.layerA = new SynthLayer(
      this.ctx,
      'A',
      this.sharedRotary,
      this.masterBus,
      options.maxPolyphony ?? 32,
      this.onVoiceCountChange
    );
    this.layerB = new SynthLayer(
      this.ctx,
      'B',
      this.sharedRotary,
      this.masterBus,
      options.maxPolyphony ?? 32,
      this.onVoiceCountChange
    );
    this.layerC = new SynthLayer(
      this.ctx,
      'C',
      this.sharedRotary,
      this.masterBus,
      options.maxPolyphony ?? 32,
      this.onVoiceCountChange
    );
  }

  public setSectionOn(on: boolean): void {
    this.isSectionOn = on;
    if (!on) {
      this.allNotesOff();
    }
  }

  public isSynthOn(): boolean {
    return this.isSectionOn;
  }

  public setModWheel(val: number): void {
    this.modWheelValue = Math.max(0, Math.min(1.0, val));
  }

  public getActiveVoiceCount(): number {
    return (
      this.layerA.getActiveVoiceCount() +
      this.layerB.getActiveVoiceCount() +
      this.layerC.getActiveVoiceCount()
    );
  }

  public setTempoBpm(bpm: number): void {
    this.layerA.arpeggiator.updateConfig({ tempoBpm: bpm });
    this.layerB.arpeggiator.updateConfig({ tempoBpm: bpm });
    this.layerC.arpeggiator.updateConfig({ tempoBpm: bpm });
  }

  public noteOn(
    midi: number,
    velocity: number = 0.8,
    splits?: SplitConfig
  ): void {
    if (this.isDisposed || !this.isSectionOn) return;

    const gainA = splits
      ? calculateNoteZoneGains(midi, splits, this.layerA.getState().zones ?? { zone1: true, zone2: true, zone3: true, zone4: true })
      : 1.0;
    const gainB = splits
      ? calculateNoteZoneGains(midi, splits, this.layerB.getState().zones ?? { zone1: true, zone2: true, zone3: true, zone4: true })
      : 1.0;
    const gainC = splits
      ? calculateNoteZoneGains(midi, splits, this.layerC.getState().zones ?? { zone1: true, zone2: true, zone3: true, zone4: true })
      : 1.0;

    if (gainA > 0) {
      this.layerA.noteOn(midi, velocity, this.isSustainActive, gainA, this.modWheelValue);
    }
    if (gainB > 0) {
      this.layerB.noteOn(midi, velocity, this.isSustainActive, gainB, this.modWheelValue);
    }
    if (gainC > 0) {
      this.layerC.noteOn(midi, velocity, this.isSustainActive, gainC, this.modWheelValue);
    }
  }

  public noteOff(midi: number): void {
    this.layerA.noteOff(midi, this.isSustainActive);
    this.layerB.noteOff(midi, this.isSustainActive);
    this.layerC.noteOff(midi, this.isSustainActive);
  }

  public setSustain(sustain: boolean): void {
    this.isSustainActive = sustain;
    this.layerA.setSustain(sustain);
    this.layerB.setSustain(sustain);
    this.layerC.setSustain(sustain);
  }

  public setPitchBend(semitones: number): void {
    this.layerA.setPitchBend(semitones);
    this.layerB.setPitchBend(semitones);
    this.layerC.setPitchBend(semitones);
  }

  public allNotesOff(): void {
    this.layerA.allNotesOff();
    this.layerB.allNotesOff();
    this.layerC.allNotesOff();
  }

  public dispose(): void {
    this.isDisposed = true;
    this.allNotesOff();
    this.layerA.dispose();
    this.layerB.dispose();
    this.layerC.dispose();
  }
}
