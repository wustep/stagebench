import { describe, expect, it } from 'vitest';
import { PianoEngine } from '../src/audio/pianoEngine';
import { createFakeBackend } from '../src/audio/fakeBackend';
import { NoteRouter } from '../src/input/noteRouter';

function setup() {
  const backend = createFakeBackend();
  const engine = new PianoEngine(backend);
  engine.markReady();
  const router = new NoteRouter(engine);
  return { backend, engine, router };
}

// feature: piano.basic-inputs (independent multi-touch ownership via router)
describe('note router ownership (piano.basic-inputs)', () => {
  it('tracks active notes and notifies subscribers', () => {
    const { router } = setup();
    const seen: number[] = [];
    router.subscribe((active) => seen.push(active.size));
    router.noteOn('pointer:1', 60, 100);
    router.noteOn('pointer:2', 64, 100);
    expect(router.activeNotes.has(60)).toBe(true);
    expect(router.activeNotes.has(64)).toBe(true);
    expect(seen).toEqual([1, 2]);
  });

  it('independent multi-touch: lifting one finger keeps the other note', () => {
    const { engine, router } = setup();
    router.noteOn('pointer:1', 60, 100);
    router.noteOn('pointer:2', 64, 100);
    router.noteOff('pointer:1', 60);
    expect(router.activeNotes.has(60)).toBe(false);
    expect(router.activeNotes.has(64)).toBe(true);
    expect(engine.activeVoiceCount).toBe(1);
  });

  it('co-owned note only stops when the last owner releases', () => {
    const { engine, router } = setup();
    router.noteOn('pointer:1', 60, 100);
    router.noteOn('kbd:60', 60, 100); // same pitch, second source
    router.noteOff('pointer:1', 60);
    expect(router.activeNotes.has(60)).toBe(true); // still held by kbd
    router.noteOff('kbd:60', 60);
    expect(router.activeNotes.has(60)).toBe(false);
    expect(engine.activeVoiceCount).toBe(0);
  });

  it('releaseOwner drops only that source (blur cleanup)', () => {
    const { router } = setup();
    router.noteOn('midi', 60, 100);
    router.noteOn('midi', 64, 100);
    router.noteOn('pointer:1', 67, 100);
    router.releaseOwner('midi');
    expect(router.activeNotes.has(60)).toBe(false);
    expect(router.activeNotes.has(64)).toBe(false);
    expect(router.activeNotes.has(67)).toBe(true);
  });

  it('panic hard-stops everything', () => {
    const { engine, router } = setup();
    router.noteOn('pointer:1', 60, 100);
    router.noteOn('midi', 64, 100);
    router.panic();
    expect(router.activeNotes.size).toBe(0);
    expect(engine.activeVoiceCount).toBe(0);
  });

  it('routes sustain through to the engine', () => {
    const { engine, router } = setup();
    router.setSustain(true);
    expect(engine.sustaining).toBe(true);
    router.setSustain(false);
    expect(engine.sustaining).toBe(false);
  });
});
