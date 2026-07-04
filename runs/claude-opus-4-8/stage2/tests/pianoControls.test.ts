import { describe, expect, it } from 'vitest';
import { makeEngine, render } from './helpers/audio';
import { shapeVelocity } from '../src/audio/sampler';

// feature: piano.velocity-controls — KB Touch, Dyn Comp, Timbre, Unison, Soft
// Release, String Res each measurably change rendered audio.

function playSynth(
  perf: Partial<Parameters<ReturnType<typeof makeEngine>['engine']['setPerformance']>[0]>,
  velocity = 100,
  seconds = 0.8,
) {
  const { engine, ctx } = makeEngine(seconds);
  engine.setStatus('ready');
  engine.setEffectsMasterOn(false);
  engine.setPerformance({ type: 'digital', ...perf });
  engine.noteOn(60, velocity);
  return { engine, ctx };
}

describe('velocity shaping (piano.velocity-controls)', () => {
  it('KB Touch curve changes how velocity maps to loudness', () => {
    // Heavy (exp 2.4) yields quieter soft strokes than Light (exp 1.0).
    const heavy = shapeVelocity(50, 2.4, 0);
    const light = shapeVelocity(50, 1.0, 0);
    expect(light).toBeGreaterThan(heavy);
  });

  it('Dyn Comp raises the level of soft strokes', () => {
    const off = shapeVelocity(30, 1.6, 0);
    const comp3 = shapeVelocity(30, 1.6, 3);
    expect(comp3).toBeGreaterThan(off);
  });

  it('velocity maps to rendered loudness monotonically', async () => {
    const soft = playSynth({ kbTouch: 1 }, 30);
    const loud = playSynth({ kbTouch: 1 }, 120);
    const a = await render(soft.ctx);
    const b = await render(loud.ctx);
    expect(b.rms).toBeGreaterThan(a.rms);
  });

  it('KB Touch Light renders louder than Heavy for the same soft velocity', async () => {
    const heavy = playSynth({ kbTouch: 0 }, 45);
    const light = playSynth({ kbTouch: 2 }, 45);
    const a = await render(heavy.ctx);
    const b = await render(light.ctx);
    expect(b.rms).toBeGreaterThan(a.rms);
  });

  it('Timbre changes the rendered tone (Bright vs Off differ)', async () => {
    const off = playSynth({ timbre: 0 });
    const bright = playSynth({ timbre: 3 });
    const a = await render(off.ctx);
    const b = await render(bright.ctx);
    // Different spectral shaping => different RMS/peak fingerprint.
    expect(Math.abs(a.rms - b.rms)).toBeGreaterThan(0);
    expect(a.peak).not.toBe(b.peak);
  });

  it('Unison adds detuned voices (wider/thicker signal)', async () => {
    const off = playSynth({ unison: 0 });
    const uni = playSynth({ unison: 3 });
    const a = await render(off.ctx);
    const b = await render(uni.ctx);
    // Detuned stacked voices beat against each other, changing the waveform.
    expect(a.peak).not.toBe(b.peak);
  });

  it('Soft Release lengthens the note tail', async () => {
    const hard = makeEngine(1.2);
    hard.engine.setStatus('ready');
    hard.engine.setEffectsMasterOn(false);
    hard.engine.setPerformance({ type: 'digital', softRelease: false });
    hard.engine.noteOn(60, 100);
    hard.engine.noteOff(60);
    const a = await render(hard.ctx);

    const soft = makeEngine(1.2);
    soft.engine.setStatus('ready');
    soft.engine.setEffectsMasterOn(false);
    soft.engine.setPerformance({ type: 'digital', softRelease: true });
    soft.engine.noteOn(60, 100);
    soft.engine.noteOff(60);
    const b = await render(soft.ctx);

    // Later window energy is higher with soft release (longer decay).
    const tail = (buf: AudioBuffer) => {
      const d = buf.getChannelData(0);
      const start = Math.floor(0.35 * buf.sampleRate);
      let s = 0;
      for (let i = start; i < d.length; i++) s += d[i] * d[i];
      return Math.sqrt(s / (d.length - start));
    };
    expect(tail(b.buffer)).toBeGreaterThan(tail(a.buffer));
  });
});

// feature: piano.pedals continued — layer B independent voice ownership.
describe('layer voice ownership (piano.layers)', () => {
  it('disabling a layer stops routing its voices', async () => {
    const { engine } = makeEngine(0.4);
    engine.setStatus('ready');
    engine.setLayer('A', { enabled: false });
    engine.setLayer('B', { enabled: false });
    engine.noteOn(60, 100);
    expect(engine.activeVoiceCount).toBe(0); // no enabled layer owns the note
  });
});
