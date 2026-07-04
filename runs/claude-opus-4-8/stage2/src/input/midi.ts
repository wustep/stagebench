/**
 * Web MIDI input, behind an injectable boundary.
 *
 * `MidiAccessProvider` mirrors the tiny slice of the Web MIDI API we use, so
 * tests can supply a fake access object, fire fake MIDI messages, simulate the
 * "permission denied" path, and simulate device disconnect — all without a
 * physical device or the real navigator.requestMIDIAccess.
 */

export type MidiState = 'unsupported' | 'requesting' | 'denied' | 'ready' | 'disconnected';

export interface MidiMessage {
  data: Uint8Array | number[];
}

export interface FakeMidiInput {
  onmidimessage: ((e: MidiMessage) => void) | null;
  state?: string;
}

export interface FakeMidiAccess {
  inputs: Map<string, FakeMidiInput>;
  onstatechange: ((e: { port: { type: string; state: string } }) => void) | null;
}

export type MidiAccessProvider = () => Promise<FakeMidiAccess>;

export interface MidiHandlers {
  noteOn(midi: number, velocity: number): void;
  noteOff(midi: number): void;
  sustain(down: boolean): void;
}

export interface MidiController {
  getState(): MidiState;
  connect(): Promise<void>;
  disconnect(): void;
  /** For tests / status subscription. */
  onStateChange(fn: (state: MidiState) => void): () => void;
}

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const CONTROL_CHANGE = 0xb0;
const SUSTAIN_CC = 64;

/** Parse a raw MIDI message and dispatch to handlers. Exported for direct testing. */
export function handleMidiData(data: Uint8Array | number[], handlers: MidiHandlers): void {
  const status = data[0] & 0xf0;
  const d1 = data[1] ?? 0;
  const d2 = data[2] ?? 0;
  if (status === NOTE_ON) {
    if (d2 === 0) handlers.noteOff(d1); // running-status note-off
    else handlers.noteOn(d1, d2);
  } else if (status === NOTE_OFF) {
    handlers.noteOff(d1);
  } else if (status === CONTROL_CHANGE && d1 === SUSTAIN_CC) {
    handlers.sustain(d2 >= 64);
  }
}

export function createMidiController(
  provider: MidiAccessProvider | undefined,
  handlers: MidiHandlers,
): MidiController {
  let state: MidiState = provider ? 'unsupported' : 'unsupported';
  const listeners = new Set<(s: MidiState) => void>();
  const boundInputs: FakeMidiInput[] = [];

  // If a provider exists at all, we consider MIDI "supported" (state moves to
  // requesting only when connect() runs).
  if (provider) state = 'requesting';

  function setState(next: MidiState): void {
    state = next;
    for (const fn of listeners) fn(state);
  }

  function bind(access: FakeMidiAccess): void {
    for (const input of access.inputs.values()) {
      input.onmidimessage = (e) => handleMidiData(e.data, handlers);
      boundInputs.push(input);
    }
    access.onstatechange = (e) => {
      if (e.port.type === 'input' && e.port.state === 'disconnected') {
        // A device dropped: stop any sounding notes and report disconnected.
        handlers.sustain(false);
        setState('disconnected');
      }
    };
  }

  return {
    getState: () => state,
    async connect() {
      if (!provider) {
        setState('unsupported');
        return;
      }
      setState('requesting');
      try {
        const access = await provider();
        bind(access);
        setState('ready');
      } catch {
        setState('denied');
      }
    },
    disconnect() {
      for (const input of boundInputs) input.onmidimessage = null;
      boundInputs.length = 0;
      handlers.sustain(false);
      setState('disconnected');
    },
    onStateChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** Adapter for the real Web MIDI API (used only in the browser). */
export function browserMidiProvider(): MidiAccessProvider | undefined {
  const nav = navigator as Navigator & {
    requestMIDIAccess?: () => Promise<unknown>;
  };
  if (typeof nav.requestMIDIAccess !== 'function') return undefined;
  return () => nav.requestMIDIAccess!() as Promise<unknown> as Promise<FakeMidiAccess>;
}
