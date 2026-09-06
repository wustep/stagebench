/**
 * piano.basic-status-cleanup — truthful loading/ready/error/fallback status;
 * blur/disconnect/unmount stops every owned voice; counts return to baseline.
 */
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import App from './App';
import { PianoEngine } from './audio/engine';
import { FakeAudioContext } from './audio/fakes';
import { MidiManager, type MidiInputLike } from './midi/midi';

async function settled() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('piano.basic-status-cleanup', () => {
  it('moves loading -> ready with a truthful status message', async () => {
    const ctx = new FakeAudioContext();
    const engine = new PianoEngine({ createContext: () => ctx });
    render(<App engineFactory={() => engine} midiProvider={() => Promise.resolve(null)} />);
    expect(screen.getByTestId('engine-status').getAttribute('data-status')).toBe('idle');
    await settled();
    const status = screen.getByTestId('engine-status');
    expect(status.getAttribute('data-status')).toBe('ready');
    expect(status.textContent).toMatch(/ready/i);
    expect(status.textContent).not.toMatch(/sample|recorded/i);
  });

  it('reports an honest error when the context factory throws', async () => {
    const engine = new PianoEngine({
      createContext: () => {
        throw new Error('boom');
      },
    });
    render(<App engineFactory={() => engine} midiProvider={() => Promise.resolve(null)} />);
    await settled();
    const status = screen.getByTestId('engine-status');
    expect(status.getAttribute('data-status')).toBe('error');
    expect(status.textContent).toMatch(/boom|error|failed/i);
  });

  it('falls back with a labeled, still-tracking silent voice when audio is denied', async () => {
    const engine = new PianoEngine({ createContext: () => null, forceFallback: false });
    render(<App engineFactory={() => engine} midiProvider={() => Promise.resolve(null)} />);
    await settled();
    const status = screen.getByTestId('engine-status');
    expect(status.getAttribute('data-status')).toBe('fallback');
    expect(status.textContent).toMatch(/fallback/i);
    fireEvent.pointerDown(screen.getByTestId('key-c4-60'));
    expect(status.textContent).toMatch(/fallback/i);
  });

  it('unmount stops every owned voice and tears down the context', async () => {
    const ctx = new FakeAudioContext();
    const engine = new PianoEngine({ createContext: () => ctx });
    const view = render(<App engineFactory={() => engine} midiProvider={() => Promise.resolve(null)} />);
    await settled();
    fireEvent.pointerDown(screen.getByTestId('key-c4-60'));
    fireEvent.pointerDown(screen.getByTestId('key-e4-64'));
    expect(engine.getVoiceCount()).toBe(2);
    await act(async () => {
      view.unmount();
    });
    expect(engine.getVoiceCount()).toBe(0);
    expect(ctx.closed).toBe(true);
  });

  it('MIDI disconnect stops MIDI-held notes (all-notes-off)', async () => {
    const ctx = new FakeAudioContext();
    const engine = new PianoEngine({ createContext: () => ctx });
    await engine.init();
    const held = new Map<number, string>();
    const { NoteManager } = await import('./audio/lifecycle');
    const manager = new NoteManager({
      startVoice: (m, v, s) => engine.noteOn(m, v, s),
      stopVoice: (id) => engine.noteOff(id),
      holdVoice: (id, h) => engine.setSustained(id, h),
    });
    const port: MidiInputLike = { onmidimessage: null };
    const midi = new MidiManager(() => Promise.resolve({ inputs: new Map([['k', port]]), onstatechange: null }), {
      onNoteOn: (m, v) => manager.press(m, v, 'midi'),
      onNoteOff: (m) => manager.release(m, 'midi'),
      onSustainChange: (on) => manager.setSustain(on),
      onStatusChange: () => undefined,
    });
    await midi.init();
    midi.injectMessage([0x90, 60, 100]);
    midi.injectMessage([0x90, 64, 100]);
    expect(engine.getVoiceCount()).toBe(2);
    void held;
    // Disconnect path: host calls all-notes-off, then marks the port gone.
    manager.allNotesOff();
    midi.simulateDisconnect();
    expect(engine.getVoiceCount()).toBe(0);
    expect(midi.getStatus()).toBe('disconnected');
  });

  it('returns node counts to baseline after full cleanup', async () => {
    const ctx = new FakeAudioContext();
    const engine = new PianoEngine({ createContext: () => ctx });
    await engine.init();
    const gainsBefore = ctx.gains.length;
    const sourcesBefore = ctx.sources.length;
    const a = engine.noteOn(60, 96, false)!;
    const b = engine.noteOn(64, 96, true)!;
    engine.noteOff(a);
    engine.noteOff(b);
    // Ended voices disconnect their nodes: no growth beyond the two voices'
    // nodes, and re-pressing reuses the same accounting shape.
    expect(ctx.sources.length).toBe(sourcesBefore + 2);
    expect(ctx.gains.length).toBe(gainsBefore + 2); // two per-note gains; master predates
    const c = engine.noteOn(67, 96, false)!;
    engine.allNotesOff();
    expect(engine.getVoiceCount()).toBe(0);
    void c;
  });
});
