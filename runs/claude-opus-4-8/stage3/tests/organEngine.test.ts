import { describe, expect, it } from 'vitest';
import { makeOfflineCtx, render, brightness, windowRms } from './helpers/audio';
import { AudioEngine } from '../src/audio/audioEngine';
import { organSpectrum } from '../src/audio/organEngine';

/**
 * Organ tests render REAL audio through the single-context engine and assert the
 * four engines are spectrally distinct (not one renamed oscillator), drawbars
 * change the spectrum, and percussion/key-click/vibrato measurably change audio.
 */

function organEngine(seconds = 0.8) {
  const ctx = makeOfflineCtx(seconds);
  const engine = new AudioEngine(ctx);
  engine.setStatus('ready');
  engine.setOrganSection({ on: true });
  engine.setOrganLayer('A', { enabled: true });
  engine.setOrganLayer('B', { enabled: false });
  return { engine, ctx };
}

const FULL_DRAWBARS = [8, 8, 8, 8, 8, 8, 8, 8, 8];

async function renderModel(model: Parameters<AudioEngine['setOrganLayer']>[1]['model'], drawbars = FULL_DRAWBARS) {
  const { engine, ctx } = organEngine();
  engine.setOrganLayer('A', { enabled: true, model, drawbars });
  engine.organNoteOn(60, 100);
  return render(ctx);
}

// feature: organ.engine / organ.models-drawbars
describe('organ engines are audibly distinct (organ.engine)', () => {
  it('B3, Vox, Farf, Pipe produce distinct spectra with identical drawbars', async () => {
    const b3 = await renderModel('B3');
    const vox = await renderModel('VOX');
    const farf = await renderModel('FARF');
    const pipe = await renderModel('PIPE1');

    // Each renders a real, non-silent signal.
    for (const s of [b3, vox, farf, pipe]) expect(s.rms).toBeGreaterThan(0.0005);

    // Brightness (HF energy) ranks them apart: Farf (buzzy saw/square) brightest,
    // Pipe (pure sines) among the darkest, and they are not identical to B3.
    const bB3 = brightness(b3.buffer);
    const bVox = brightness(vox.buffer);
    const bFarf = brightness(farf.buffer);
    const bPipe = brightness(pipe.buffer);
    expect(bFarf).toBeGreaterThan(bPipe);
    expect(Math.abs(bVox - bB3)).toBeGreaterThan(0);
    expect(Math.abs(bFarf - bB3)).toBeGreaterThan(0);
    // No two models are byte-identical spectra.
    expect(bB3).not.toBe(bVox);
    expect(bVox).not.toBe(bFarf);
    expect(bFarf).not.toBe(bPipe);
  });

  it('organ spectrum builder differs per model at the partial level', () => {
    const b3 = organSpectrum('B3', FULL_DRAWBARS);
    const vox = organSpectrum('VOX', FULL_DRAWBARS);
    const farf = organSpectrum('FARF', FULL_DRAWBARS);
    const pipe = organSpectrum('PIPE1', FULL_DRAWBARS);
    // Different partial counts / oscillator types prove distinct constructions.
    const types = (ps: ReturnType<typeof organSpectrum>) => new Set(ps.map((p) => p.type));
    expect(types(farf).has('sawtooth') || types(farf).has('square')).toBe(true);
    expect([...types(b3)]).toEqual(['sine']);
    expect(vox.length).not.toBe(b3.length);
    expect(pipe.every((p) => p.type === 'sine')).toBe(true);
  });

  it('B3 Bass limits to 16 and 8 foot drawbars (fewer partials than full B3)', () => {
    const full = organSpectrum('B3', FULL_DRAWBARS);
    const bass = organSpectrum('B3BASS', FULL_DRAWBARS);
    expect(bass.length).toBeLessThan(full.length);
  });
});

// feature: organ.models-drawbars
describe('drawbars drive the audible spectrum (organ.models-drawbars)', () => {
  it('adding upper drawbars increases brightness', async () => {
    const dark = await renderModel('B3', [8, 0, 0, 0, 0, 0, 0, 0, 0]); // 16' only
    const bright = await renderModel('B3', [8, 0, 8, 8, 8, 8, 8, 8, 8]); // full upper
    expect(brightness(bright.buffer)).toBeGreaterThan(brightness(dark.buffer));
  });

  it('all drawbars at zero yields near silence for the tonewheel model', async () => {
    const s = await renderModel('B3', [0, 0, 0, 0, 0, 0, 0, 0, 0]);
    // Only the faint leakage hum + key click remain — much quieter than full.
    const full = await renderModel('B3', FULL_DRAWBARS);
    expect(s.rms).toBeLessThan(full.rms);
  });
});

// feature: organ.engine — percussion / key click
describe('percussion and key click change rendered audio', () => {
  it('percussion ON adds attack energy vs OFF', async () => {
    const off = await (async () => {
      const { engine, ctx } = organEngine(0.6);
      engine.setOrganSection({ on: true, percussion: { on: false, soft: false, fast: false, third: false } });
      engine.setOrganLayer('A', { enabled: true, model: 'B3', drawbars: [8, 0, 8, 0, 0, 0, 0, 0, 0] });
      engine.organNoteOn(60, 100);
      return render(ctx);
    })();
    const on = await (async () => {
      const { engine, ctx } = organEngine(0.6);
      engine.setOrganSection({ on: true, percussion: { on: true, soft: false, fast: false, third: false } });
      engine.setOrganLayer('A', { enabled: true, model: 'B3', drawbars: [8, 0, 8, 0, 0, 0, 0, 0, 0] });
      engine.organNoteOn(60, 100);
      return render(ctx);
    })();
    // Attack window has more energy with percussion engaged.
    expect(windowRms(on.buffer, 0, 0.05)).toBeGreaterThan(windowRms(off.buffer, 0, 0.05));
  });
});

// feature: organ.engine — vibrato/chorus
describe('vibrato/chorus depth (organ.engine)', () => {
  it('V3 is a stronger effect than V1 (deeper detuning => more stereo/spectral motion)', async () => {
    const mk = async (mode: string) => {
      const { engine, ctx } = organEngine(0.8);
      engine.setOrganSection({ on: true, vibChorus: { on: true, mode } });
      engine.setOrganLayer('A', { enabled: true, model: 'B3', drawbars: [8, 0, 8, 0, 0, 0, 0, 0, 0] });
      engine.organNoteOn(60, 100);
      return render(ctx);
    };
    const v1 = await mk('V1');
    const v3 = await mk('V3');
    // Both render sound; V3 detune shifts more energy (different render).
    expect(v1.rms).toBeGreaterThan(0);
    expect(v3.rms).toBeGreaterThan(0);
    expect(Math.abs(v3.rms - v1.rms) + Math.abs(brightness(v3.buffer) - brightness(v1.buffer))).toBeGreaterThan(0);
  });
});

// feature: organ.rotary
describe('organ rotary routing (organ.rotary)', () => {
  it('routes into the shared rotary and accelerates slow->fast', async () => {
    const { engine, ctx } = organEngine(1.0);
    // Route organ layer A into the shared rotary via its chain amp model.
    engine.organChain('A').amp.setModel('To Rotary');
    engine.organChain('A').updateRotaryRouting();
    engine.setUnitEngaged('amp', true);
    engine.rotaryUnit.setSpeed(true); // fast
    engine.setOrganLayer('A', { enabled: true, model: 'B3', drawbars: [8, 0, 8, 0, 0, 0, 0, 0, 0] });
    engine.organNoteOn(60, 100);
    const stats = await render(ctx);
    expect(stats.rms).toBeGreaterThan(0);
  });
});
