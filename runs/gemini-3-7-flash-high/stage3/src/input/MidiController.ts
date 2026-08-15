export type MidiStatus = 'unsupported' | 'pending' | 'granted' | 'denied' | 'disconnected';

export interface MidiNoteEvent {
  midi: number;
  velocity: number;
}

export interface MidiControllerCallbacks {
  onNoteOn: (midi: number, velocity: number) => void;
  onNoteOff: (midi: number) => void;
  onSustainChange: (sustain: boolean) => void;
  onStatusChange: (status: MidiStatus) => void;
}

export interface GenericMidiAccess {
  inputs: Map<string, GenericMidiInput>;
  onstatechange: ((e: unknown) => void) | null;
}

export interface GenericMidiInput {
  onmidimessage: ((event: GenericMidiMessageEvent) => void) | null;
}

export interface GenericMidiMessageEvent {
  data: Uint8Array | number[];
}

export class MidiController {
  private status: MidiStatus = 'pending';
  private callbacks: MidiControllerCallbacks;
  private midiAccess: GenericMidiAccess | null = null;
  private isDisposed = false;

  constructor(callbacks: MidiControllerCallbacks, customMidiAccess?: GenericMidiAccess | null) {
    this.callbacks = callbacks;

    if (customMidiAccess !== undefined) {
      if (customMidiAccess) {
        this.midiAccess = customMidiAccess;
        this.status = 'granted';
        this.attachMidiInputs();
        this.callbacks.onStatusChange(this.status);
      } else {
        this.status = 'denied';
        this.callbacks.onStatusChange(this.status);
      }
    } else {
      this.initMidi();
    }
  }

  public getStatus(): MidiStatus {
    return this.status;
  }

  private async initMidi(): Promise<void> {
    const nav = typeof navigator !== 'undefined' ? (navigator as unknown as { requestMIDIAccess?: (opts?: { sysex: boolean }) => Promise<GenericMidiAccess> }) : null;
    if (!nav || !nav.requestMIDIAccess) {
      this.status = 'unsupported';
      this.callbacks.onStatusChange(this.status);
      return;
    }

    try {
      const access = await nav.requestMIDIAccess({ sysex: false });
      if (this.isDisposed) {
        return;
      }
      this.midiAccess = access;
      this.status = access.inputs.size > 0 ? 'granted' : 'disconnected';
      this.callbacks.onStatusChange(this.status);

      this.attachMidiInputs();

      access.onstatechange = () => {
        if (this.isDisposed || !this.midiAccess) return;
        const hasInputs = this.midiAccess.inputs.size > 0;
        this.status = hasInputs ? 'granted' : 'disconnected';
        this.callbacks.onStatusChange(this.status);
        this.attachMidiInputs();
      };
    } catch {
      this.status = 'denied';
      this.callbacks.onStatusChange(this.status);
    }
  }

  private attachMidiInputs(): void {
    if (!this.midiAccess) return;

    for (const input of this.midiAccess.inputs.values()) {
      input.onmidimessage = this.handleMidiMessage.bind(this);
    }
  }

  public handleMidiMessage(event: GenericMidiMessageEvent): void {
    if (this.isDisposed || !event.data || event.data.length < 2) return;

    const [statusByte, data1, data2 = 0] = event.data;
    const command = statusByte & 0xf0;

    // Note On (0x90) with velocity > 0
    if (command === 0x90) {
      const velocity = data2 / 127;
      if (data2 > 0) {
        this.callbacks.onNoteOn(data1, velocity);
      } else {
        // Velocity 0 is Note Off
        this.callbacks.onNoteOff(data1);
      }
    }
    // Note Off (0x80)
    else if (command === 0x80) {
      this.callbacks.onNoteOff(data1);
    }
    // Control Change (0xB0)
    else if (command === 0xb0) {
      // CC64: Damper / Sustain Pedal
      if (data1 === 64) {
        const isDown = data2 >= 64;
        this.callbacks.onSustainChange(isDown);
      }
    }
  }

  public dispose(): void {
    this.isDisposed = true;
    if (this.midiAccess) {
      for (const input of this.midiAccess.inputs.values()) {
        input.onmidimessage = null;
      }
      this.midiAccess.onstatechange = null;
      this.midiAccess = null;
    }
  }
}
