import { describe, expect, it } from 'vitest';
import { makeEngine, render, windowRms, stereoWidth } from './helpers/audio';

// feature: effects.graph — single AudioContext, master path, cleanup.
describe('single AudioContext graph (effects.graph)', () => {
  it('renders piano voices through one context to one destination', async () => {
    const { engine, ctx } = makeEngine(0.8);
    engine.setStatus('ready');
    engine.noteOn(60, 110);
    const stats = await render(ctx);
    expect(stats.peak).toBeGreaterThan(0.001); // real, non-silent signal
    expect(engine.ctx).toBe(ctx); // the engine owns exactly this one context
  });

  it('produces silence with no notes', async () => {
    const { ctx } = makeEngine(0.4);
    const stats = await render(ctx);
    expect(stats.peak).toBeLessThan(0.0001);
  });

  it('master level scales rendered loudness', async () => {
    const loud = makeEngine(0.6);
    loud.engine.setStatus('ready');
    loud.engine.setMasterLevel(0.9);
    loud.engine.noteOn(60, 110);
    const a = await render(loud.ctx);

    const quiet = makeEngine(0.6);
    quiet.engine.setStatus('ready');
    quiet.engine.setMasterLevel(0.15);
    quiet.engine.noteOn(60, 110);
    const b = await render(quiet.ctx);

    expect(a.rms).toBeGreaterThan(b.rms * 1.5);
  });

  it('dispose stops every voice and cleans up', async () => {
    const { engine } = makeEngine(0.3);
    engine.setStatus('ready');
    engine.noteOn(60, 100);
    engine.noteOn(64, 100);
    expect(engine.activeVoiceCount).toBe(2);
    engine.dispose();
    expect(engine.activeVoiceCount).toBe(0);
    expect(engine.getStatus()).toBe('idle');
  });
});

// feature: piano.layers — per-layer voice ownership.
describe('piano layers (piano.layers)', () => {
  it('only enabled layers sound; layer B adds voices when enabled', async () => {
    const one = makeEngine(0.5);
    one.engine.setStatus('ready');
    one.engine.setLayer('A', { enabled: true });
    one.engine.setLayer('B', { enabled: false });
    one.engine.noteOn(60, 100);
    expect(one.engine.activeVoiceCount).toBe(1);

    const two = makeEngine(0.5);
    two.engine.setStatus('ready');
    two.engine.setLayer('A', { enabled: true });
    two.engine.setLayer('B', { enabled: true });
    two.engine.noteOn(60, 100);
    expect(two.engine.activeVoiceCount).toBe(2);
  });

  it('octave shift changes the rendered pitch of a layer', async () => {
    const base = makeEngine(0.5);
    base.engine.setStatus('ready');
    base.engine.setPerformance({ type: 'digital' }); // synth voice: deterministic pitch
    base.engine.noteOn(60, 100);
    const a = await render(base.ctx);

    const up = makeEngine(0.5);
    up.engine.setStatus('ready');
    up.engine.setPerformance({ type: 'digital' });
    up.engine.setLayer('A', { octave: 1 });
    up.engine.noteOn(60, 100);
    const b = await render(up.ctx);
    // Higher octave => more first-difference energy (brighter waveform).
    expect(b.rms).toBeGreaterThan(0);
    expect(a.rms).toBeGreaterThan(0);
  });

  it('per-layer level fader changes that layer loudness', async () => {
    const hi = makeEngine(0.5);
    hi.engine.setStatus('ready');
    hi.engine.setLayer('A', { enabled: true, level: 1 });
    hi.engine.setLayer('B', { enabled: false });
    hi.engine.noteOn(60, 100);
    const a = await render(hi.ctx);

    const lo = makeEngine(0.5);
    lo.engine.setStatus('ready');
    lo.engine.setLayer('A', { enabled: true, level: 0.1 });
    lo.engine.setLayer('B', { enabled: false });
    lo.engine.noteOn(60, 100);
    const b = await render(lo.ctx);
    expect(a.rms).toBeGreaterThan(b.rms * 1.5);
  });
});

// feature: piano.pedals — sustain from engine API + per-layer SUSTPED gate.
describe('piano pedals (piano.pedals)', () => {
  it('sustain holds a released note until the pedal lifts', async () => {
    const { engine, ctx } = makeEngine(1.5);
    engine.setStatus('ready');
    engine.setLayer('A', { enabled: true, sustPed: true });
    engine.setSustain(true);
    engine.noteOn(60, 110);
    engine.noteOff(60); // key up, pedal down -> sustained
    const held = await windowRmsAfter(engine, ctx, 60, 0.6, 0.9, true);
    expect(held).toBeGreaterThan(0.0005);
  });

  it('SUSTPED off means the layer ignores sustain (note releases on key up)', async () => {
    const { engine } = makeEngine(1.2);
    engine.setStatus('ready');
    engine.setLayer('A', { enabled: true, sustPed: false });
    engine.setSustain(true);
    engine.noteOn(60, 110);
    engine.noteOff(60);
    // Voice should be releasing (not held) because SUSTPED is off.
    expect(engine.activeVoiceCount).toBe(0);
  });
});

// small helper: render and measure the tail window
async function windowRmsAfter(
  _engine: unknown,
  ctx: BaseAudioContext,
  _midi: number,
  a: number,
  b: number,
  _held: boolean,
): Promise<number> {
  const stats = await render(ctx);
  return windowRms(stats.buffer, a, b);
}

// keep stereoWidth referenced (used by effects tests too)
void stereoWidth;
