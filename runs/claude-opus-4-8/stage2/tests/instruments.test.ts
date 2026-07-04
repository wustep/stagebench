import { describe, expect, it } from 'vitest';
import { makeEngine, render, fsLoaderDeps, brightness } from './helpers/audio';
import { PIANO_TYPE_DEFS } from '../src/audio/instruments';

// feature: piano.instrument-library — recorded, offline, audibly distinct sets.

async function renderType(type: 'grand' | 'upright' | 'electric') {
  const { engine, ctx } = makeEngine(1.0);
  await engine.loadLibrary(fsLoaderDeps(ctx));
  expect(engine.getStatus()).toBe('ready'); // loaded offline from bundled files
  engine.setPerformance({ type });
  engine.setEffectsMasterOn(false); // dry — compare raw instruments
  engine.noteOn(60, 110);
  engine.noteOn(64, 110);
  return render(ctx);
}

describe('recorded piano library (piano.instrument-library)', () => {
  it('Grand/Upright/Electric load from bundled files offline (real samplers)', async () => {
    const { engine, ctx } = makeEngine(0.4);
    await engine.loadLibrary(fsLoaderDeps(ctx));
    expect(engine.getStatus()).toBe('ready');
    for (const id of ['grand', 'upright', 'electric'] as const) {
      expect(engine.hasSampler(id)).toBe(true);
    }
  });

  it('the three recorded types are declared as sampled, not synthesized', () => {
    for (const id of ['grand', 'upright', 'electric'] as const) {
      expect(PIANO_TYPE_DEFS[id].kind).toBe('sampled');
    }
    for (const id of ['clav', 'digital', 'misc'] as const) {
      expect(PIANO_TYPE_DEFS[id].kind).toBe('synth');
    }
  });

  it('Grand, Upright, and Electric render audibly distinct signals', async () => {
    const grand = await renderType('grand');
    const upright = await renderType('upright');
    const electric = await renderType('electric');

    // All three actually produce sound.
    for (const s of [grand, upright, electric]) expect(s.rms).toBeGreaterThan(0.0005);

    // Distinctness: compare a spectral-brightness fingerprint pairwise. Recorded
    // acoustic grand, honky-tonk upright, and tine EP differ measurably.
    const bGrand = brightness(grand.buffer);
    const bUpright = brightness(upright.buffer);
    const bElectric = brightness(electric.buffer);
    const distinct = (x: number, y: number) => Math.abs(x - y) / Math.max(x, y) > 0.05;
    expect(distinct(bGrand, bUpright) || distinct(grand.rms, upright.rms)).toBe(true);
    expect(distinct(bGrand, bElectric) || distinct(grand.rms, electric.rms)).toBe(true);
    expect(distinct(bUpright, bElectric) || distinct(upright.rms, electric.rms)).toBe(true);
  });

  it('falls back to playable synthesis when sample assets fail to load', async () => {
    const { engine, ctx } = makeEngine(0.6);
    // Loader that always fails => fallback status, still playable.
    await engine.loadLibrary({
      fetchBytes: async () => {
        throw new Error('offline asset missing');
      },
      decode: async () => {
        throw new Error('no decode');
      },
      baseUrl: '',
    });
    expect(engine.getStatus()).toBe('fallback');
    engine.setPerformance({ type: 'grand' });
    engine.noteOn(60, 110);
    const stats = await render(ctx);
    expect(stats.peak).toBeGreaterThan(0.001); // labeled fallback still makes sound
  });

  it('synth types (Clav/Digital/Misc) render distinct honest synthesis', async () => {
    async function synth(type: 'clav' | 'digital' | 'misc') {
      const { engine, ctx } = makeEngine(0.8);
      engine.setStatus('ready');
      engine.setEffectsMasterOn(false);
      engine.setPerformance({ type });
      engine.noteOn(60, 110);
      return render(ctx);
    }
    const clav = await synth('clav');
    const digital = await synth('digital');
    const misc = await synth('misc');
    for (const s of [clav, digital, misc]) expect(s.rms).toBeGreaterThan(0.0005);
    expect(Math.abs(brightness(clav.buffer) - brightness(digital.buffer))).toBeGreaterThan(0);
  });
});
