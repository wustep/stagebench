/**
 * piano.basic-sustain-polyphony — sustain transitions, concurrent voices,
 * deterministic stealing, velocity response. DSP relationships are asserted
 * on rendered deterministic buffers (not exact cross-browser waveforms).
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, act } from '@testing-library/react';
import App from './App';
import { PianoEngine } from './audio/engine';
import { NoteManager } from './audio/lifecycle';
import { FakeAudioContext } from './audio/fakes';
import { createTestClock } from './audio/types';
import { pickStealVictim, renderPianoNote, rms, tailLength } from './audio/dsp';

describe('piano.basic-sustain-polyphony', () => {
  it('renders non-silent output that scales with velocity', () => {
    const soft = renderPianoNote(60, 32);
    const loud = renderPianoNote(60, 120);
    expect(rms(soft)).toBeGreaterThan(0.0001);
    expect(rms(loud)).toBeGreaterThan(rms(soft) * 1.5);
  });

  it('sustain lengthens the tail vs. a plain release', () => {
    const plain = renderPianoNote(60, 96, { sustain: false });
    const held = renderPianoNote(60, 96, { sustain: true });
    expect(tailLength(held)).toBeGreaterThan(tailLength(plain));
  });

  it('holds released notes while the damper is down, then flushes', async () => {
    const ctx = new FakeAudioContext();
    const engine = new PianoEngine({ createContext: () => ctx });
    await engine.init();
    const manager = new NoteManager({
      startVoice: (m, v, s) => engine.noteOn(m, v, s),
      stopVoice: (id) => engine.noteOff(id),
      holdVoice: (id, h) => engine.setSustained(id, h),
    });
    manager.press(60, 96, 'pointer');
    manager.setSustain(true);
    manager.release(60, 'pointer');
    expect(engine.getVoiceCount()).toBe(1); // held by damper
    manager.press(64, 96, 'pointer');
    manager.release(64, 'pointer');
    expect(engine.getVoiceCount()).toBe(2);
    manager.setSustain(false);
    expect(engine.getVoiceCount()).toBe(0);
  });

  it('steals deterministically: oldest sustained voice first', () => {
    const now = 5000;
    const voices = [
      { noteId: 'n1', midi: 60, startedAt: 1000, sustained: false },
      { noteId: 'n2', midi: 64, startedAt: 2000, sustained: true },
      { noteId: 'n3', midi: 67, startedAt: 3000, sustained: true },
    ];
    // n1 is oldest overall but sustained voices are preferred victims.
    expect(pickStealVictim(voices, now)?.noteId).toBe('n2');
    const unsustained = voices.map((v) => ({ ...v, sustained: false }));
    expect(pickStealVictim(unsustained, now)?.noteId).toBe('n1');
    // Tie on start time breaks by note id — deterministic.
    expect(
      pickStealVictim(
        [
          { noteId: 'nb', midi: 60, startedAt: 1000, sustained: false },
          { noteId: 'na', midi: 64, startedAt: 1000, sustained: false },
        ],
        now,
      )?.noteId,
    ).toBe('na');
  });

  it('caps polyphony at maxVoices with deterministic victims', async () => {
    const ctx = new FakeAudioContext();
    const engine = new PianoEngine({ createContext: () => ctx, clock: createTestClock(), maxVoices: 4 });
    await engine.init();
    const ids: string[] = [];
    for (const midi of [60, 62, 64, 65, 67, 69]) ids.push(engine.noteOn(midi, 96, false)!);
    expect(engine.getVoiceCount()).toBe(4);
    expect(engine.getActiveNotes()).toEqual([64, 65, 67, 69]);
    engine.allNotesOff();
    expect(engine.getVoiceCount()).toBe(0);
  });

  it('runs sustain from the UI pedal and the Space key', async () => {
    const ctx = new FakeAudioContext();
    const engine = new PianoEngine({ createContext: () => ctx });
    render(<App engineFactory={() => engine} midiProvider={() => Promise.resolve(null)} />);
    await act(async () => {
      await Promise.resolve();
    });
    const pedal = screen.getByTestId('sustain-pedal');
    fireEvent.pointerDown(pedal); // sustain on
    expect(pedal).toHaveAttribute('aria-pressed', 'true');
    fireEvent.pointerDown(screen.getByTestId('key-c4-60'));
    fireEvent.pointerUp(screen.getByTestId('key-c4-60'));
    expect(engine.getVoiceCount()).toBe(1); // damper holds it
    fireEvent.pointerDown(pedal); // sustain off flushes
    expect(engine.getVoiceCount()).toBe(0);
    // Space key path.
    fireEvent.keyDown(window, { key: ' ' });
    fireEvent.pointerDown(screen.getByTestId('key-e4-64'));
    fireEvent.pointerUp(screen.getByTestId('key-e4-64'));
    expect(engine.getVoiceCount()).toBe(1);
    fireEvent.keyUp(window, { key: ' ' });
    expect(engine.getVoiceCount()).toBe(0);
  });
});
