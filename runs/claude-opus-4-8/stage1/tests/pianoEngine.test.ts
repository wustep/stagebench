import { describe, expect, it } from 'vitest';
import { PianoEngine, midiToFrequency } from '../src/audio/pianoEngine';
import { createFakeBackend } from '../src/audio/fakeBackend';

function setup(maxVoices = 16) {
  const backend = createFakeBackend();
  const engine = new PianoEngine(backend, { maxVoices });
  engine.markReady();
  return { backend, engine };
}

// feature: piano.basic-note-lifecycle
describe('note lifecycle (piano.basic-note-lifecycle)', () => {
  it('note on creates a started, non-silent tone', () => {
    const { backend, engine } = setup();
    engine.noteOn(60, 100);
    expect(backend.tones).toHaveLength(1);
    const tone = backend.tones[0];
    expect(tone.startTime).not.toBeNull();
    expect(tone.spec.frequency).toBeCloseTo(midiToFrequency(60), 3);
    expect(tone.peakRamp).toBeGreaterThan(0); // differs from silence
  });

  it('note off releases (ramps to zero then stops) the tone', () => {
    const { backend, engine } = setup();
    engine.noteOn(60, 100);
    const tone = backend.tones[0];
    engine.noteOff(60);
    expect(tone.stopped).toBe(true);
    const lastRamp = [...tone.events].reverse().find((e) => e.kind === 'ramp');
    expect(lastRamp?.value).toBe(0);
    expect(engine.activeVoiceCount).toBe(0);
  });

  it('overlapping distinct notes each get their own voice', () => {
    const { backend, engine } = setup();
    engine.noteOn(60, 100);
    engine.noteOn(64, 100);
    engine.noteOn(67, 100);
    expect(engine.activeVoiceCount).toBe(3);
    expect(backend.activeToneCount).toBe(3);
  });

  it('retriggering the same pitch steals the prior voice (one per pitch)', () => {
    const { backend, engine } = setup();
    engine.noteOn(60, 80);
    const first = backend.tones[0];
    engine.noteOn(60, 120);
    expect(first.stopped).toBe(true);
    expect(engine.activeVoiceCount).toBe(1);
    expect(backend.tones).toHaveLength(2);
  });

  it('all notes off stops every voice and cleans up nodes', () => {
    const { backend, engine } = setup();
    for (const midi of [60, 62, 64, 65]) engine.noteOn(midi, 100);
    expect(backend.activeToneCount).toBe(4);
    engine.allNotesOff();
    expect(engine.activeVoiceCount).toBe(0);
    expect(backend.activeToneCount).toBe(0);
    for (const t of backend.tones) expect(t.stopped).toBe(true);
  });

  it('noteOff on an unknown pitch is a no-op', () => {
    const { engine } = setup();
    expect(() => engine.noteOff(99)).not.toThrow();
    expect(engine.activeVoiceCount).toBe(0);
  });
});

// feature: piano.basic-sustain-polyphony
describe('sustain, polyphony, velocity (piano.basic-sustain-polyphony)', () => {
  it('velocity scales peak gain monotonically', () => {
    const { backend, engine } = setup();
    engine.noteOn(60, 20);
    engine.noteOn(64, 127);
    const soft = backend.tones[0].peakRamp;
    const loud = backend.tones[1].peakRamp;
    expect(loud).toBeGreaterThan(soft);
  });

  it('sustain holds released notes until the pedal lifts', () => {
    const { backend, engine } = setup();
    engine.setSustain(true);
    engine.noteOn(60, 100);
    const tone = backend.tones[0];
    engine.noteOff(60); // key up while pedal down
    expect(tone.stopped).toBe(false);
    expect(engine.activeVoiceCount).toBe(1);
    engine.setSustain(false); // pedal up releases it
    expect(tone.stopped).toBe(true);
    expect(engine.activeVoiceCount).toBe(0);
  });

  it('sustain does not hold notes whose key is still down', () => {
    const { backend, engine } = setup();
    engine.setSustain(true);
    engine.noteOn(60, 100);
    engine.setSustain(false); // release pedal but key never lifted
    expect(backend.tones[0].stopped).toBe(false);
    expect(engine.activeVoiceCount).toBe(1);
  });

  it('deterministically steals the oldest voice at the polyphony limit', () => {
    const { backend, engine } = setup(3);
    engine.noteOn(60, 100); // oldest
    engine.noteOn(62, 100);
    engine.noteOn(64, 100);
    engine.noteOn(65, 100); // exceeds limit -> steal midi 60
    expect(engine.activeVoiceCount).toBe(3);
    expect(backend.tones[0].stopped).toBe(true); // the first (oldest)
    expect(backend.tones[1].stopped).toBe(false);
  });
});

// feature: piano.basic-status-cleanup
describe('status and cleanup (piano.basic-status-cleanup)', () => {
  it('reports ready only after markReady', () => {
    const backend = createFakeBackend();
    const engine = new PianoEngine(backend);
    expect(engine.getStatus()).toBe('idle');
    engine.setStatus('loading');
    expect(engine.getStatus()).toBe('loading');
    engine.markReady();
    expect(engine.getStatus()).toBe('ready');
  });

  it('dispose stops every owned voice and returns to idle', () => {
    const { backend, engine } = setup();
    engine.noteOn(60, 100);
    engine.noteOn(64, 100);
    engine.dispose();
    expect(engine.activeVoiceCount).toBe(0);
    expect(backend.activeToneCount).toBe(0);
    expect(engine.getStatus()).toBe('idle');
  });
});
