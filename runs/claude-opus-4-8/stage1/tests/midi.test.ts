import { describe, expect, it, vi } from 'vitest';
import {
  handleMidiData,
  createMidiController,
  type FakeMidiAccess,
  type FakeMidiInput,
  type MidiHandlers,
} from '../src/input/midi';

function collector(): { handlers: MidiHandlers; log: string[] } {
  const log: string[] = [];
  return {
    log,
    handlers: {
      noteOn: (m, v) => log.push(`on:${m}:${v}`),
      noteOff: (m) => log.push(`off:${m}`),
      sustain: (d) => log.push(`sustain:${d}`),
    },
  };
}

// feature: piano.basic-inputs (MIDI note/velocity/CC64 + denied/disconnected)
describe('MIDI message parsing (piano.basic-inputs)', () => {
  it('parses note on/off and velocity', () => {
    const { handlers, log } = collector();
    handleMidiData([0x90, 60, 100], handlers); // note on C4 vel 100
    handleMidiData([0x80, 60, 0], handlers); // note off
    expect(log).toEqual(['on:60:100', 'off:60']);
  });

  it('treats note-on velocity 0 as note-off (running status)', () => {
    const { handlers, log } = collector();
    handleMidiData([0x90, 62, 0], handlers);
    expect(log).toEqual(['off:62']);
  });

  it('maps CC64 to sustain down/up at the 64 threshold', () => {
    const { handlers, log } = collector();
    handleMidiData([0xb0, 64, 127], handlers);
    handleMidiData([0xb0, 64, 0], handlers);
    expect(log).toEqual(['sustain:true', 'sustain:false']);
  });

  it('ignores unrelated control changes', () => {
    const { handlers, log } = collector();
    handleMidiData([0xb0, 1, 100], handlers); // mod wheel CC1
    expect(log).toEqual([]);
  });
});

describe('MIDI controller lifecycle (piano.basic-inputs)', () => {
  function fakeAccess(): FakeMidiAccess {
    const input: FakeMidiInput = { onmidimessage: null, state: 'connected' };
    return { inputs: new Map([['in-1', input]]), onstatechange: null };
  }

  it('reports unsupported when no provider exists', async () => {
    const { handlers } = collector();
    const controller = createMidiController(undefined, handlers);
    expect(controller.getState()).toBe('unsupported');
    await controller.connect();
    expect(controller.getState()).toBe('unsupported');
  });

  it('connects and dispatches messages from bound inputs', async () => {
    const { handlers, log } = collector();
    const access = fakeAccess();
    const controller = createMidiController(async () => access, handlers);
    await controller.connect();
    expect(controller.getState()).toBe('ready');
    const input = access.inputs.get('in-1')!;
    input.onmidimessage!({ data: [0x90, 69, 90] });
    expect(log).toEqual(['on:69:90']);
  });

  it('surfaces denied when the provider rejects', async () => {
    const { handlers } = collector();
    const controller = createMidiController(async () => {
      throw new Error('SecurityError');
    }, handlers);
    await controller.connect();
    expect(controller.getState()).toBe('denied');
  });

  it('handles device disconnect: releases sustain and reports disconnected', async () => {
    const { handlers, log } = collector();
    const access = fakeAccess();
    const controller = createMidiController(async () => access, handlers);
    await controller.connect();
    access.onstatechange!({ port: { type: 'input', state: 'disconnected' } });
    expect(controller.getState()).toBe('disconnected');
    expect(log).toContain('sustain:false');
  });

  it('disconnect() unbinds inputs and stops sustain', async () => {
    const { handlers, log } = collector();
    const access = fakeAccess();
    const controller = createMidiController(async () => access, handlers);
    await controller.connect();
    controller.disconnect();
    expect(controller.getState()).toBe('disconnected');
    const input = access.inputs.get('in-1')!;
    expect(input.onmidimessage).toBeNull();
    expect(log).toContain('sustain:false');
  });

  it('notifies state change subscribers', async () => {
    const { handlers } = collector();
    const access = fakeAccess();
    const controller = createMidiController(async () => access, handlers);
    const fn = vi.fn();
    controller.onStateChange(fn);
    await controller.connect();
    expect(fn).toHaveBeenCalledWith('ready');
  });
});
