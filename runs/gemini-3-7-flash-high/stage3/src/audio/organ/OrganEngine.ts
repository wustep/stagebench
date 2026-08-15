import { OrganLayer } from './OrganLayer';
import { OrganVibratoChorus } from './OrganVibratoChorus';
import { EffectChain } from '../effects/EffectChain';
import { RotaryEffect } from '../effects/RotaryEffect';
import { VibratoChorusMode } from './types';
import { SplitConfig, calculateNoteZoneGains } from '../../model/splits';

export interface OrganEngineOptions {
  ctx: AudioContext;
  masterBus: GainNode;
  sharedRotary: RotaryEffect;
  maxPolyphony?: number;
  onVoiceCountChange?: () => void;
}

export class OrganEngine {
  private ctx: AudioContext;
  private masterBus: GainNode;
  private sharedRotary: RotaryEffect;

  public layerA: OrganLayer;
  public layerB: OrganLayer;
  public vibratoChorus: OrganVibratoChorus;
  public effectChain: EffectChain;

  private isSectionOn: boolean = false;
  private drawbars: [number, number, number, number, number, number, number, number, number] = [
    8, 8, 8, 0, 0, 0, 0, 0, 0,
  ];

  private percussion = {
    on: false,
    soft: false,
    fast: false,
    third: false,
  };

  private activePhysicalKeys: Set<number> = new Set();
  private isSustainActive: boolean = false;
  private isDisposed: boolean = false;
  private onVoiceCountChange?: () => void;

  constructor(options: OrganEngineOptions) {
    this.ctx = options.ctx;
    this.masterBus = options.masterBus;
    this.sharedRotary = options.sharedRotary;
    this.onVoiceCountChange = options.onVoiceCountChange;

    // Vibrato / Chorus Scanner
    this.vibratoChorus = new OrganVibratoChorus(this.ctx);

    // Shared Effect Chain for Organ (Layers A and B share ONE effect chain per spec)
    this.effectChain = new EffectChain(this.ctx, this.sharedRotary);
    this.effectChain.output.connect(this.masterBus);

    // Scanner output connects to shared Effect Chain input
    this.vibratoChorus.output.connect(this.effectChain.input);

    // Layers A and B connect into the Vibrato/Chorus input
    this.layerA = new OrganLayer(
      this.ctx,
      'A',
      this.vibratoChorus.input,
      options.maxPolyphony ?? 32,
      this.onVoiceCountChange
    );
    this.layerB = new OrganLayer(
      this.ctx,
      'B',
      this.vibratoChorus.input,
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

  public isOrganOn(): boolean {
    return this.isSectionOn;
  }

  public setDrawbars(
    drawbars: [number, number, number, number, number, number, number, number, number]
  ): void {
    this.drawbars = [...drawbars];
  }

  public setPercussion(perc: { on: boolean; soft: boolean; fast: boolean; third: boolean }): void {
    this.percussion = { ...perc };
  }

  public setVibratoMode(mode: VibratoChorusMode, enabled: boolean): void {
    this.vibratoChorus.setMode(mode);
    this.vibratoChorus.setEnabled(enabled);
  }

  public getActiveVoiceCount(): number {
    return this.layerA.getActiveVoiceCount() + this.layerB.getActiveVoiceCount();
  }

  public noteOn(
    midi: number,
    velocity: number = 0.8,
    splits?: SplitConfig
  ): void {
    if (this.isDisposed || !this.isSectionOn) return;

    // Single-triggered percussion logic:
    // Percussion triggers ONLY when no other physical organ keys are currently held
    const triggerPercussion = this.activePhysicalKeys.size === 0;
    this.activePhysicalKeys.add(midi);

    // Compute split zone gains
    const gainA = splits
      ? calculateNoteZoneGains(midi, splits, this.layerA.getState().zones ?? { zone1: true, zone2: true, zone3: true, zone4: true })
      : 1.0;
    const gainB = splits
      ? calculateNoteZoneGains(midi, splits, this.layerB.getState().zones ?? { zone1: true, zone2: true, zone3: true, zone4: true })
      : 1.0;

    if (gainA > 0) {
      this.layerA.noteOn(
        midi,
        velocity,
        this.drawbars,
        this.percussion,
        triggerPercussion,
        this.isSustainActive,
        gainA
      );
    }

    if (gainB > 0) {
      this.layerB.noteOn(
        midi,
        velocity,
        this.drawbars,
        this.percussion,
        triggerPercussion,
        this.isSustainActive,
        gainB
      );
    }
  }

  public noteOff(midi: number): void {
    this.activePhysicalKeys.delete(midi);
    this.layerA.noteOff(midi, this.isSustainActive);
    this.layerB.noteOff(midi, this.isSustainActive);
  }

  public setSustain(sustain: boolean): void {
    this.isSustainActive = sustain;
    this.layerA.setSustain(sustain);
    this.layerB.setSustain(sustain);
  }

  public setPitchBend(semitones: number): void {
    this.layerA.setPitchBend(semitones);
    this.layerB.setPitchBend(semitones);
  }

  public allNotesOff(): void {
    this.activePhysicalKeys.clear();
    this.layerA.allNotesOff();
    this.layerB.allNotesOff();
  }

  public dispose(): void {
    this.isDisposed = true;
    this.allNotesOff();
    this.layerA.dispose();
    this.layerB.dispose();
    this.vibratoChorus.dispose();
    this.effectChain.dispose();
  }
}
