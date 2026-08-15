import { OrganLayerState } from './types';
import { OrganVoice } from './OrganVoice';
import { ALL_ZONES_ASSIGNMENT } from '../../model/splits';

export class OrganLayer {
  private ctx: AudioContext;
  public id: 'A' | 'B';
  public output: GainNode;

  private state: OrganLayerState;
  private activeVoices: Map<number, OrganVoice[]> = new Map();
  private maxPolyphony: number;
  private onVoiceCountChange?: () => void;
  private isDisposed = false;

  constructor(
    ctx: AudioContext,
    id: 'A' | 'B',
    destination: AudioNode,
    maxPolyphony: number = 32,
    onVoiceCountChange?: () => void
  ) {
    this.ctx = ctx;
    this.id = id;
    this.maxPolyphony = maxPolyphony;
    this.onVoiceCountChange = onVoiceCountChange;

    this.output = ctx.createGain();
    const initialGain = Math.pow((id === 'A' ? 8.0 : 7.0) / 10, 1.5);
    this.output.gain.setValueAtTime(initialGain, ctx.currentTime);
    this.output.connect(destination);

    this.state = {
      enabled: id === 'A',
      focused: id === 'A',
      level: id === 'A' ? 8.0 : 7.0,
      octave: 0,
      model: 'B3',
      vibratoOn: id === 'A',
      sustainPedal: true,
      pitchStick: false,
      zones: { ...ALL_ZONES_ASSIGNMENT },
    };
  }

  public getState(): OrganLayerState {
    return { ...this.state };
  }

  public updateState(partial: Partial<OrganLayerState>): void {
    const oldLevel = this.state.level;
    this.state = { ...this.state, ...partial };

    if (partial.level !== undefined && partial.level !== oldLevel) {
      const now = this.ctx.currentTime;
      const gainVal = Math.pow(Math.max(0, Math.min(10, partial.level)) / 10, 1.5);
      this.output.gain.setTargetAtTime(gainVal, now, 0.015);
    }
  }

  public getActiveVoiceCount(): number {
    let count = 0;
    this.activeVoices.forEach((voices) => {
      count += voices.length;
    });
    return count;
  }

  public noteOn(
    midi: number,
    velocity: number,
    drawbars: [number, number, number, number, number, number, number, number, number],
    percussion: { on: boolean; soft: boolean; fast: boolean; third: boolean },
    triggerPercussion: boolean,
    isSustained: boolean,
    zoneGain: number = 1.0
  ): OrganVoice | null {
    if (this.isDisposed || !this.state.enabled || zoneGain <= 0) return null;

    const shiftedMidi = midi + this.state.octave * 12;
    if (shiftedMidi < 0 || shiftedMidi > 127) return null;

    // Polyphony voice stealing if necessary
    this.enforcePolyphonyLimit();

    const voice = new OrganVoice({
      ctx: this.ctx,
      destination: this.output,
      midi: shiftedMidi,
      velocity: velocity * zoneGain,
      model: this.state.model,
      drawbars,
      percussion,
      triggerPercussion,
      isSustained: this.state.sustainPedal && isSustained,
    });

    const list = this.activeVoices.get(midi) || [];
    list.push(voice);
    this.activeVoices.set(midi, list);

    this.onVoiceCountChange?.();
    return voice;
  }

  public noteOff(midi: number, isSustainActive: boolean): void {
    const list = this.activeVoices.get(midi);
    if (!list) return;

    const shouldHold = this.state.sustainPedal && isSustainActive;

    if (shouldHold) {
      list.forEach((v) => {
        v.isSustained = true;
      });
    } else {
      list.forEach((v) => {
        v.release(() => this.removeVoice(midi, v));
      });
      this.activeVoices.delete(midi);
    }

    this.onVoiceCountChange?.();
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
      this.onVoiceCountChange?.();
    }
  }

  public setPitchBend(semitones: number): void {
    if (!this.state.pitchStick) return;
    this.activeVoices.forEach((voices) => {
      voices.forEach((v) => v.setPitchBend(semitones));
    });
  }

  private enforcePolyphonyLimit(): void {
    const total = this.getActiveVoiceCount();
    if (total >= this.maxPolyphony) {
      // Steal oldest voice
      const firstEntry = this.activeVoices.entries().next().value;
      if (firstEntry) {
        const [midi, voices] = firstEntry;
        const oldest = voices.shift();
        if (oldest) oldest.dispose();
        if (voices.length === 0) {
          this.activeVoices.delete(midi);
        }
      }
    }
  }

  private removeVoice(midi: number, voice: OrganVoice): void {
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
    this.onVoiceCountChange?.();
  }

  public dispose(): void {
    this.isDisposed = true;
    this.allNotesOff();
    try {
      this.output.disconnect();
    } catch {}
  }
}
