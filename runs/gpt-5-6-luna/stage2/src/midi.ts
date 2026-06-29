export type MidiEvent =
  | { type: 'note-on'; note: number; velocity: number; channel: number }
  | { type: 'note-off'; note: number; velocity: number; channel: number }
  | { type: 'sustain'; value: number; channel: number }
  | { type: 'sostenuto'; value: number; channel: number }
  | { type: 'soft-pedal'; value: number; channel: number };

export type MidiMessageHandler = (event: MidiEvent) => void;

export function parseMidiMessage(data: Uint8Array): MidiEvent | null {
  if (data.length < 2) return null;
  const status = data[0];
  const command = status & 0xf0;
  const channel = status & 0x0f;
  const note = data[1] & 0x7f;
  const value = data[2] ?? 0;
  if (command === 0x90 && value > 0) return { type: 'note-on', note, velocity: value / 127, channel };
  if (command === 0x80 || (command === 0x90 && value === 0)) return { type: 'note-off', note, velocity: value / 127, channel };
  if (command === 0xb0 && note === 64) return { type: 'sustain', value: value / 127, channel };
  if (command === 0xb0 && note === 66) return { type: 'sostenuto', value: value / 127, channel };
  if (command === 0xb0 && note === 67) return { type: 'soft-pedal', value: value / 127, channel };
  return null;
}

export interface MidiInputLike {
  onmidimessage: ((event: { data: Uint8Array }) => void) | null;
}

export interface MidiAccessLike {
  inputs: Map<string, MidiInputLike>;
}

export function connectMidi(access: MidiAccessLike, handler: MidiMessageHandler): () => void {
  const inputs = [...access.inputs.values()];
  const listeners = inputs.map((input) => {
    const listener = (event: { data: Uint8Array }) => {
      const parsed = parseMidiMessage(event.data);
      if (parsed) handler(parsed);
    };
    input.onmidimessage = listener;
    return { input, listener };
  });
  return () => {
    for (const { input, listener } of listeners) if (input.onmidimessage === listener) input.onmidimessage = null;
  };
}

export async function requestMidi(): Promise<{ access?: MidiAccessLike; status: 'connected' | 'unavailable' | 'denied' }> {
  if (!navigator.requestMIDIAccess) return { status: 'unavailable' };
  try {
    const access = await navigator.requestMIDIAccess();
    return { access: access as unknown as MidiAccessLike, status: 'connected' };
  } catch {
    return { status: 'denied' };
  }
}
