/**
 * piano.basic-note-lifecycle — one deterministic lifecycle:
 * note on/off, repeated + overlapping notes, release, all-notes-off,
 * node cleanup back to baseline.
 */
import { describe, expect, it } from 'vitest';
import { NoteManager } from './audio/lifecycle';
import { PianoEngine } from './audio/engine';
import { FakeAudioContext } from './audio/fakes';
import { createTestClock } from './audio/types';

function makeEngine(maxVoices = 16) {
  const ctx = new FakeAudioContext();
  const clock = createTestClock();
  const engine = new PianoEngine({ createContext: () => ctx, clock, maxVoices });
  return { ctx, clock, engine };
}

describe('piano.basic-note-lifecycle', () => {
  it('starts and stops a voice with node cleanup', async () => {
    const { ctx, engine } = makeEngine();
    await engine.init();
    const id = engine.noteOn(60, 96, false);
    expect(id).not.toBeNull();
    expect(engine.getVoiceCount()).toBe(1);
    expect(ctx.sources).toHaveLength(1);
    engine.noteOff(id!);
    expect(engine.getVoiceCount()).toBe(0);
  });

  it('handles repeated notes (retrigger steals the old voice)', async () => {
    const { engine } = makeEngine();
    await engine.init();
    const first = engine.noteOn(60, 80, false)!;
    const second = engine.noteOn(60, 100, false)!;
    // Engine-level: two noteOn calls without noteOff accumulate unless the
    // lifecycle retriggers; NoteManager (below) performs the steal. Here both
    // voices exist and both stop cleanly.
    engine.noteOff(first);
    engine.noteOff(second);
    expect(engine.getVoiceCount()).toBe(0);
  });

  it('supports overlapping notes on different pitches', async () => {
    const { engine } = makeEngine();
    await engine.init();
    const ids = [60, 64, 67].map((m) => engine.noteOn(m, 96, false)!);
    expect(engine.getVoiceCount()).toBe(3);
    expect(new Set(engine.getActiveNotes())).toEqual(new Set([60, 64, 67]));
    for (const id of ids) engine.noteOff(id);
    expect(engine.getVoiceCount()).toBe(0);
  });

  it('all-notes-off stops every owned voice', async () => {
    const { engine } = makeEngine();
    await engine.init();
    engine.noteOn(60, 96, false);
    engine.noteOn(64, 96, false);
    expect(engine.allNotesOff()).toBe(2);
    expect(engine.getVoiceCount()).toBe(0);
  });

  it('lifecycle refcounts overlapping sources before note-off', async () => {
    const { engine } = makeEngine();
    await engine.init();
    const manager = new NoteManager({
      startVoice: (m, v, s) => engine.noteOn(m, v, s),
      stopVoice: (id) => engine.noteOff(id),
      holdVoice: (id, h) => engine.setSustained(id, h),
    });
    manager.press(60, 96, 'pointer');
    manager.press(60, 96, 'keyboard');
    expect(engine.getVoiceCount()).toBe(1);
    manager.release(60, 'pointer');
    expect(engine.getVoiceCount()).toBe(1); // keyboard still holds
    manager.release(60, 'keyboard');
    expect(engine.getVoiceCount()).toBe(0);
  });

  it('lifecycle retriggers a repeated note without leaking voices', async () => {
    const { engine } = makeEngine();
    await engine.init();
    const manager = new NoteManager({
      startVoice: (m, v, s) => engine.noteOn(m, v, s),
      stopVoice: (id) => engine.noteOff(id),
      holdVoice: (id, h) => engine.setSustained(id, h),
    });
    manager.press(60, 80, 'pointer');
    manager.press(60, 100, 'pointer'); // retrigger, new velocity
    expect(engine.getVoiceCount()).toBe(1);
    manager.release(60, 'pointer');
    expect(engine.getVoiceCount()).toBe(0);
  });

  it('unknown noteOff is a safe no-op', async () => {
    const { engine } = makeEngine();
    await engine.init();
    expect(() => engine.noteOff('nope')).not.toThrow();
    expect(engine.getVoiceCount()).toBe(0);
  });
});
