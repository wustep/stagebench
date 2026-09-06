/**
 * piano.pedals — sustain from UI, computer keyboard, and MIDI CC64 honoring
 * SUSTPED; pitch bend only where PSTICK is on. piano.fallback — asset failure
 * enters a labeled playable fallback without reporting the primary ready.
 */
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import App from './App';
import { NoteManager } from './audio/lifecycle';
import { StageEngine, defaultPianoLayer } from './audio/stageEngine';
import { PianoEngine } from './audio/engine';
import { FakeAudioContext } from './audio/fakes';
import { StageFakeContext } from './audio/stageFakes';
import { createTestClock } from './audio/types';
import { MidiManager } from './midi/midi';
import { renderSynthVoice, rms } from './audio/render';

function memoryFetchFail(): () => Promise<never> {
  return () => Promise.reject(new Error('offline: asset unreachable'));
}

function memoryFetchEmpty(): (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }> {
  return async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(8) });
}

async function settled() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('piano.pedals', () => {
  it('sustains UI/keyboard/MIDI input only on SUSTPED-enabled layers', async () => {
    const ctx = new StageFakeContext();
    const engine = new StageEngine({ createContext: () => ctx, fetchImpl: null, clock: createTestClock() });
    // fetchImpl null → labeled synth fallback, still playable.
    const status = await engine.init();
    expect(status).toBe('fallback');
    engine.setLayers({
      A: defaultPianoLayer({ sustPed: true }),
      B: defaultPianoLayer({ enabled: true, level: 6, sustPed: false }),
      focus: 'A',
    });
    const mk = (layer: 'A' | 'B') =>
      new NoteManager({
        startVoice: (m, v, s) => engine.noteOn(layer, m, v, s),
        stopVoice: (id) => engine.noteOff(id),
        holdVoice: (id, h) => engine.setSustained(id, h),
      });
    const mA = mk('A');
    const mB = mk('B');
    // MIDI CC64 path through the MidiManager.
    let sustain = false;
    const midi = new MidiManager(() => Promise.resolve({ inputs: new Map(), onstatechange: null }), {
      onNoteOn: (m, v) => {
        mA.press(m, v, 'midi');
        mB.press(m, v, 'midi');
      },
      onNoteOff: (m) => {
        mA.release(m, 'midi');
        mB.release(m, 'midi');
      },
      onSustainChange: (on) => {
        sustain = on;
        mA.setSustain(on); // SUSTPED layer follows the damper…
        // …B ignores it (SUSTPED off).
      },
      onStatusChange: () => undefined,
    });
    await midi.init();
    midi.injectMessage([0x90, 60, 100]);
    midi.injectMessage([0xb0, 64, 127]); // CC64 down
    expect(sustain).toBe(true);
    midi.injectMessage([0x80, 60, 0]);
    expect(engine.getActiveVoices()).toEqual([{ layer: 'A', midi: 60 }]);
    midi.injectMessage([0xb0, 64, 0]); // CC64 up flushes A only
    expect(engine.getVoiceCount()).toBe(0);
    await engine.dispose();
    expect(ctx.closed).toBe(true);
  });

  it('pitch bend applies only to PSTICK-enabled layers (±2 st)', async () => {
    const ctx = new StageFakeContext();
    const engine = new StageEngine({ createContext: () => ctx, fetchImpl: null });
    await engine.init();
    engine.setLayers({
      A: defaultPianoLayer({ pStick: true }),
      B: defaultPianoLayer({ enabled: true, level: 6, pStick: false }),
      focus: 'A',
    });
    engine.setPitchBend(2);
    const a = engine.noteOn('A', 60, 96, false)!;
    const b = engine.noteOn('B', 60, 96, false)!;
    const voices = ctx.voices.slice(-2);
    expect(voices[0].detune.value).toBe(200);
    expect(voices[1].detune.value).toBe(0);
    engine.noteOff(a);
    engine.noteOff(b);
    // Clamp discipline.
    engine.setPitchBend(99);
    expect(engine.pitchBendSt).toBe(2);
    await engine.dispose();
  });

  it('runs sustain from the App UI pedal and Space key into the stage engine', async () => {
    const ctx = new StageFakeContext();
    const stage = new StageEngine({ createContext: () => ctx, fetchImpl: null });
    const legacy = new PianoEngine({ createContext: () => new FakeAudioContext() });
    render(
      <App engineFactory={() => legacy} stageFactory={() => stage} midiProvider={() => Promise.resolve(null)} />,
    );
    await settled();
    const pedal = screen.getByTestId('sustain-pedal');
    fireEvent.pointerDown(pedal); // sustain on
    expect(pedal).toHaveAttribute('aria-pressed', 'true');
    fireEvent.pointerDown(screen.getByTestId('key-c4-60'));
    fireEvent.pointerUp(screen.getByTestId('key-c4-60'));
    expect(stage.getVoiceCount()).toBe(1); // damper holds it
    fireEvent.pointerDown(pedal); // sustain off flushes
    expect(stage.getVoiceCount()).toBe(0);
    fireEvent.keyDown(window, { key: ' ' });
    fireEvent.pointerDown(screen.getByTestId('key-e4-64'));
    fireEvent.pointerUp(screen.getByTestId('key-e4-64'));
    expect(stage.getVoiceCount()).toBe(1);
    fireEvent.keyUp(window, { key: ' ' });
    expect(stage.getVoiceCount()).toBe(0);
  });
});

describe('piano.fallback', () => {
  it('failed fetch enters a labeled playable fallback (never "ready")', async () => {
    const ctx = new StageFakeContext();
    const engine = new StageEngine({ createContext: () => ctx, fetchImpl: memoryFetchFail(), clock: createTestClock() });
    const status = await engine.init();
    expect(status).toBe('fallback');
    expect(engine.isFallback()).toBe(true);
    expect(engine.getFallbackReason()).toMatch(/fallback/i);
    expect(engine.getStatusDetail()).toMatch(/fallback/i);
    // Still playable: synth voices sound.
    const id = engine.noteOn('A', 60, 96, false);
    expect(id).not.toBeNull();
    expect(engine.getVoiceCount()).toBe(1);
    engine.noteOff(id!);
    await engine.dispose();
  });

  it('missing manifest is a labeled fallback, not silence', async () => {
    const ctx = new StageFakeContext();
    const engine = new StageEngine({
      createContext: () => ctx,
      fetchImpl: memoryFetchEmpty(),
      manifestUrl: 'mem/manifest.json',
      sampleBase: 'mem',
    });
    const status = await engine.init();
    expect(status).toBe('fallback');
    expect(engine.getSampleLibrary().failed).toContain('manifest.json');
    const id = engine.noteOn('A', 64, 100, false);
    expect(id).not.toBeNull();
    await engine.dispose();
  });

  it('decode failure is a labeled fallback without reporting the primary ready', async () => {
    const ctx = new StageFakeContext();
    ctx.failDecode = true;
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'samples');
    const fetchImpl = async (url: string) => {
      const name = url.split('/').slice(-2).join('/');
      const path = url.endsWith('manifest.json') ? join(dir, 'manifest.json') : join(dir, name);
      const buf = readFileSync(path);
      return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer };
    };
    const engine = new StageEngine({ createContext: () => ctx, fetchImpl, sampleBase: 'x', manifestUrl: 'x/manifest.json' });
    const status = await engine.init();
    expect(status).toBe('fallback');
    expect(engine.getStatusDetail()).not.toMatch(/library ready/);
    await engine.dispose();
  });

  it('synth fallback voices are audible (non-silent deterministic renders)', () => {
    expect(rms(renderSynthVoice(60, 96, 'clav'))).toBeGreaterThan(0.01);
    expect(rms(renderSynthVoice(60, 96, 'digital'))).toBeGreaterThan(0.01);
    expect(rms(renderSynthVoice(60, 96, 'misc'))).toBeGreaterThan(0.01);
  });

  it('App surfaces the fallback in the stage status and the piano panel', async () => {
    const ctx = new StageFakeContext();
    const stage = new StageEngine({ createContext: () => ctx, fetchImpl: memoryFetchFail() });
    const legacy = new PianoEngine({ createContext: () => new FakeAudioContext() });
    render(
      <App engineFactory={() => legacy} stageFactory={() => stage} midiProvider={() => Promise.resolve(null)} />,
    );
    await settled();
    await settled();
    const status = screen.getByTestId('stage-status');
    expect(status.getAttribute('data-status')).toBe('fallback');
    expect(status.textContent).toMatch(/fallback/i);
  });
});
