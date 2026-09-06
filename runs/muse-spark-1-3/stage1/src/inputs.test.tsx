/**
 * piano.basic-inputs — pointer, independent multi-touch, mapped computer
 * keys with repeat suppression, MIDI note/velocity/sustain, denied and
 * disconnected MIDI. No physical device, network, or audio output needed.
 */
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import App from './App';
import { MidiManager, type MidiInputLike } from './midi/midi';
import { NoteManager } from './audio/lifecycle';
import { PianoEngine } from './audio/engine';
import { FakeAudioContext } from './audio/fakes';

function renderApp(midiProvider?: () => Promise<never>) {
  const ctx = new FakeAudioContext();
  const engine = new PianoEngine({ createContext: () => ctx });
  const view = render(
    <App engineFactory={() => engine} midiProvider={midiProvider ?? (() => Promise.resolve(null))} />,
  );
  return { ctx, engine, view };
}

async function settled() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('piano.basic-inputs', () => {
  it('plays a key with pointer down/up (press + release + depressed visual)', async () => {
    const { engine } = renderApp();
    await settled();
    const key = screen.getByTestId('key-c4-60');
    fireEvent.pointerDown(key);
    expect(engine.getVoiceCount()).toBe(1);
    expect(key).toHaveAttribute('aria-pressed', 'true');
    fireEvent.pointerUp(key);
    expect(engine.getVoiceCount()).toBe(0);
    expect(key).toHaveAttribute('aria-pressed', 'false');
  });

  it('tracks independent multi-touch presses on different pitches', async () => {
    const { engine } = renderApp();
    await settled();
    fireEvent.pointerDown(screen.getByTestId('key-c4-60'));
    fireEvent.pointerDown(screen.getByTestId('key-e4-64'));
    expect(engine.getVoiceCount()).toBe(2);
    fireEvent.pointerUp(screen.getByTestId('key-c4-60'));
    expect(engine.getVoiceCount()).toBe(1);
    expect(engine.getActiveNotes()).toEqual([64]);
    fireEvent.pointerUp(screen.getByTestId('key-e4-64'));
    expect(engine.getVoiceCount()).toBe(0);
  });

  it('releases on pointer cancel (touch interruption)', async () => {
    const { engine } = renderApp();
    await settled();
    const key = screen.getByTestId('key-g4-67');
    fireEvent.pointerDown(key);
    expect(engine.getVoiceCount()).toBe(1);
    fireEvent.pointerCancel(key);
    expect(engine.getVoiceCount()).toBe(0);
  });

  it('plays mapped computer keys with repeat suppression', async () => {
    const { engine } = renderApp();
    await settled();
    fireEvent.keyDown(window, { key: 'a' }); // C4
    expect(engine.getVoiceCount()).toBe(1);
    fireEvent.keyDown(window, { key: 'a', repeat: true });
    fireEvent.keyDown(window, { key: 'a' }); // duplicate without repeat flag
    expect(engine.getVoiceCount()).toBe(1);
    fireEvent.keyUp(window, { key: 'a' });
    expect(engine.getVoiceCount()).toBe(0);
  });

  it('drives notes from injected MIDI: note on/off, velocity, CC64 sustain', async () => {
    const events: Array<{ midi: number; velocity: number }> = [];
    let sustainState = false;
    const inputs = new Map<string, MidiInputLike>();
    const port: MidiInputLike = { onmidimessage: null };
    inputs.set('fake-keys', port);
    const manager = new NoteManager({
      startVoice: (m, v, s) => {
        events.push({ midi: m, velocity: v });
        void s;
        return `v${m}`;
      },
      stopVoice: () => undefined,
      holdVoice: () => undefined,
    });
    const midi = new MidiManager(() => Promise.resolve({ inputs, onstatechange: null }), {
      onNoteOn: (m, v) => manager.press(m, v, 'midi'),
      onNoteOff: (m) => manager.release(m, 'midi'),
      onSustainChange: (on) => {
        sustainState = on;
        manager.setSustain(on);
      },
      onStatusChange: () => undefined,
    });
    await midi.init();
    expect(midi.getStatus()).toBe('connected');
    midi.injectMessage([0x90, 60, 100]);
    expect(events).toEqual([{ midi: 60, velocity: 100 }]);
    expect(manager.activeMidis()).toEqual([60]);
    midi.injectMessage([0xb0, 64, 127]); // sustain down
    expect(sustainState).toBe(true);
    midi.injectMessage([0x80, 60, 0]); // released while sustained
    expect(manager.activeCount()).toBe(1);
    midi.injectMessage([0xb0, 64, 0]); // sustain up flushes
    expect(manager.activeCount()).toBe(0);
    // Velocity-0 note-on is note-off.
    midi.injectMessage([0x90, 62, 90]);
    midi.injectMessage([0x90, 62, 0]);
    expect(manager.activeCount()).toBe(0);
  });

  it('handles denied MIDI access with an honest status (keybed still works)', async () => {
    const statuses: string[] = [];
    const midi = new MidiManager(() => Promise.reject(new Error('Permission denied by user')), {
      onNoteOn: () => undefined,
      onNoteOff: () => undefined,
      onSustainChange: () => undefined,
      onStatusChange: (status) => statuses.push(status),
    });
    const status = await midi.init();
    expect(status).toBe('denied');
    expect(statuses).toContain('denied');
    // App with a denied provider still plays the keybed.
    const failing = () => Promise.reject(new Error('Security: permission denied'));
    const { engine } = renderApp(failing as unknown as () => Promise<never>);
    await settled();
    expect(screen.getByTestId('midi-status').getAttribute('data-status')).toBe('denied');
    fireEvent.pointerDown(screen.getByTestId('key-c4-60'));
    expect(engine.getVoiceCount()).toBe(1);
    fireEvent.pointerUp(screen.getByTestId('key-c4-60'));
  });

  it('reports disconnected MIDI when no keyboard is attached', async () => {
    const empty = () => Promise.resolve({ inputs: new Map(), onstatechange: null });
    const { view } = renderApp(empty as unknown as () => Promise<never>);
    void view;
    await settled();
    expect(screen.getByTestId('midi-status').getAttribute('data-status')).toBe('disconnected');
  });

  it('all-notes-off on window blur stops sounding voices', async () => {
    const { engine } = renderApp();
    await settled();
    fireEvent.pointerDown(screen.getByTestId('key-c4-60'));
    fireEvent.keyDown(window, { key: 'a' });
    expect(engine.getVoiceCount()).toBeGreaterThan(0);
    fireEvent(window, new FocusEvent('blur'));
    // blur handler is on window 'blur' — dispatch explicitly:
    window.dispatchEvent(new Event('blur'));
    expect(engine.getVoiceCount()).toBe(0);
  });

  it('ignores unmapped computer keys and pitches outside the 73-key range', async () => {
    const { engine } = renderApp();
    await settled();
    fireEvent.keyDown(window, { key: 'z' }); // not in the map
    fireEvent.keyDown(window, { key: 'F1' });
    expect(engine.getVoiceCount()).toBe(0);
    fireEvent.keyUp(window, { key: 'z' });
    expect(engine.getVoiceCount()).toBe(0);
  });
});
