/**
 * Web MIDI boundary. The manager works against an injected access provider
 * so tests never need a physical device; denied/disconnected states are
 * first-class and surface honest status text.
 */

export type MidiStatus = 'pending' | 'connected' | 'denied' | 'disconnected' | 'unavailable' | 'error';

export interface MidiNoteHandlers {
  onNoteOn(midi: number, velocity: number): void;
  onNoteOff(midi: number): void;
  onSustainChange(on: boolean): void;
  onStatusChange(status: MidiStatus, detail: string): void;
}

export interface MidiInputLike {
  onmidimessage: ((event: { data: ArrayLike<number> | null }) => void) | null | undefined;
  [extra: string]: unknown;
}

export interface MidiAccessLike {
  inputs: Map<string, MidiInputLike> | Iterable<MidiInputLike>;
  onstatechange: ((event: unknown) => void) | null | undefined;
  [extra: string]: unknown;
}

export type MidiAccessProvider = () => Promise<MidiAccessLike | null>;

export function parseMidiMessage(data: ArrayLike<number> | null):
  | { type: 'noteOn'; midi: number; velocity: number }
  | { type: 'noteOff'; midi: number }
  | { type: 'sustain'; on: boolean }
  | null {
  if (!data || data.length < 3) return null;
  const status = data[0] & 0xf0;
  const note = data[1] & 0x7f;
  const value = data[2] & 0x7f;
  if (status === 0x90) {
    // Note-on with velocity 0 is note-off by convention.
    if (value === 0) return { type: 'noteOff', midi: note };
    return { type: 'noteOn', midi: note, velocity: value };
  }
  if (status === 0x80) return { type: 'noteOff', midi: note };
  if (status === 0xb0 && note === 64) return { type: 'sustain', on: value >= 64 };
  return null;
}

function inputList(access: MidiAccessLike): MidiInputLike[] {
  if (access.inputs instanceof Map) return [...access.inputs.values()];
  return [...(access.inputs as Iterable<MidiInputLike>)];
}

export class MidiManager {
  private readonly provider: MidiAccessProvider;
  private readonly handlers: MidiNoteHandlers;
  private status: MidiStatus = 'pending';
  private detail = 'MIDI: checking for devices…';
  private access: MidiAccessLike | null = null;

  constructor(provider: MidiAccessProvider, handlers: MidiNoteHandlers) {
    this.provider = provider;
    this.handlers = handlers;
  }

  getStatus(): MidiStatus {
    return this.status;
  }

  getDetail(): string {
    return this.detail;
  }

  private setStatus(status: MidiStatus, detail: string): void {
    this.status = status;
    this.detail = detail;
    this.handlers.onStatusChange(status, detail);
  }

  /** Probe for MIDI access. Never throws; denied access is reported. */
  async init(): Promise<MidiStatus> {
    try {
      const access = await this.provider();
      if (!access) {
        this.setStatus('unavailable', 'MIDI unavailable in this browser.');
        return this.status;
      }
      this.access = access;
      const inputs = inputList(access);
      if (inputs.length === 0) {
        this.setStatus('disconnected', 'MIDI ready — no keyboard connected.');
      } else {
        this.setStatus('connected', `MIDI connected (${inputs.length} input${inputs.length === 1 ? '' : 's'}).`);
      }
      for (const input of inputs) {
        input.onmidimessage = (event) => this.handleMessage(event.data);
      }
      access.onstatechange = () => {
        const next = this.access ? inputList(this.access) : [];
        // Rebind (new ports may have appeared) and update status.
        for (const input of next) input.onmidimessage = (event) => this.handleMessage(event.data);
        if (next.length === 0) {
          this.setStatus('disconnected', 'MIDI keyboard disconnected.');
        } else {
          this.setStatus('connected', `MIDI connected (${next.length} input${next.length === 1 ? '' : 's'}).`);
        }
      };
      return this.status;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/permission|denied|security/i.test(message)) {
        this.setStatus('denied', 'MIDI access denied — keybed and computer keys still play.');
      } else {
        this.setStatus('error', `MIDI error: ${message}`);
      }
      return this.status;
    }
  }

  /** Test seam: feed a raw MIDI message without hardware. */
  injectMessage(data: ArrayLike<number> | null): void {
    this.handleMessage(data);
  }

  /** Test seam: simulate device disconnect. */
  simulateDisconnect(): void {
    this.setStatus('disconnected', 'MIDI keyboard disconnected.');
    this.access = null;
  }

  dispose(): void {
    if (this.access) {
      for (const input of inputList(this.access)) input.onmidimessage = null;
      this.access.onstatechange = null;
      this.access = null;
    }
    this.setStatus('pending', 'MIDI: checking for devices…');
  }

  private handleMessage(data: ArrayLike<number> | null): void {
    const parsed = parseMidiMessage(data);
    if (!parsed) return;
    if (parsed.type === 'noteOn') this.handlers.onNoteOn(parsed.midi, parsed.velocity);
    else if (parsed.type === 'noteOff') this.handlers.onNoteOff(parsed.midi);
    else this.handlers.onSustainChange(parsed.on);
  }
}
