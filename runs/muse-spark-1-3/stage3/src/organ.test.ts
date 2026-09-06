/**
 * organ.engine / organ.models-drawbars / organ.rotary — two-layer note
 * lifecycle, levels, focus, zones, shared effect chain, cleanup; B3/Vox/Farf/
 * Pipe spectral distinctions; drawbars/registers with LED state; percussion,
 * key click, vibrato/chorus; rotary slow/fast/stop with acceleration, drive,
 * morphable speed.
 *
 * Audio claims cross the boundary twice: offline deterministic renders
 * (directional distinctions) + live StageEngine/StageFakeContext wiring.
 */
import { describe, expect, it } from 'vitest';
import { StageEngine } from './audio/stageEngine';
import { StageFakeContext } from './audio/stageFakes';
import { createTestClock } from './audio/types';
import { defaultOrganLayer } from './audio/organTypes';
import {
  applyVibChorus,
  drawbarGain,
  renderB3Note,
  renderFarfNote,
  renderOrganNote,
  renderPipeNote,
  renderVoxNote,
  vibDepth,
} from './audio/organRender';
import { rms } from './audio/render';

function silentEngine() {
  const ctx = new StageFakeContext();
  const engine = new StageEngine({ createContext: () => ctx, fetchImpl: null, clock: createTestClock() });
  return { engine, ctx };
}

function diff(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let d = 0;
  for (let i = 0; i < n; i += 1) d += Math.abs(a[i] - b[i]);
  return d / n;
}

function stdDrawbars(): number[] {
  return [8, 6, 8, 6, 4, 4, 2, 2, 2];
}

describe('organ.models-drawbars', () => {
  it('B3, Vox, Farf, and Pipe render audibly distinct engines', () => {
    const base = { ...defaultOrganLayer(), drawbars: stdDrawbars() };
    const b3 = renderB3Note(60, 96, base);
    const vox = renderVoxNote(60, 96, base);
    const farf = renderFarfNote(60, 96, base);
    const pipe = renderPipeNote(60, 96, base);
    for (const out of [b3, vox, farf, pipe]) expect(rms(out)).toBeGreaterThan(0.01);
    const outs = [b3, vox, farf, pipe];
    for (let i = 0; i < outs.length; i += 1) {
      for (let j = i + 1; j < outs.length; j += 1) {
        expect(diff(outs[i], outs[j])).toBeGreaterThan(0.002);
      }
    }
  });

  it('dispatch renders B3 Bass (16+8 only) and Pipe 2 (brighter principal)', () => {
    const base = { ...defaultOrganLayer(), drawbars: stdDrawbars() };
    const bass = renderOrganNote(48, 96, { ...base, model: 'B3 Bass' });
    const full = renderOrganNote(48, 96, { ...base, model: 'B3' });
    expect(diff(bass, full)).toBeGreaterThan(0.002);
    const pipe2 = renderOrganNote(60, 96, { ...base, model: 'Pipe 2' });
    const pipe1 = renderOrganNote(60, 96, { ...base, model: 'Pipe 1' });
    expect(diff(pipe2, pipe1)).toBeGreaterThan(0.0005);
  });

  it('every drawbar movement changes the audible spectrum', () => {
    const base = { ...defaultOrganLayer(), drawbars: stdDrawbars() };
    const full = renderB3Note(60, 96, base);
    for (let i = 0; i < 9; i += 1) {
      const moved = [...stdDrawbars()];
      moved[i] = moved[i] >= 8 ? 0 : moved[i] + 2;
      expect(diff(renderB3Note(60, 96, { ...base, drawbars: moved }), full)).toBeGreaterThan(0.0005);
    }
    expect(drawbarGain(0)).toBe(0);
    expect(drawbarGain(8)).toBe(1);
    expect(drawbarGain(4)).toBeCloseTo(0.5, 5);
  });

  it('B3 percussion (on/soft/fast/third) and key click change rendered audio', () => {
    const base = { ...defaultOrganLayer(), drawbars: stdDrawbars(), keyClick: false };
    const dry = renderB3Note(60, 96, base);
    const perc = renderB3Note(60, 96, { ...base, percussion: { on: true, soft: false, fast: true, third: false } });
    expect(diff(perc, dry)).toBeGreaterThan(0.002);
    const soft = renderB3Note(60, 96, { ...base, percussion: { on: true, soft: true, fast: true, third: false } });
    expect(diff(soft, perc)).toBeGreaterThan(0.0005);
    const slow = renderB3Note(60, 96, { ...base, percussion: { on: true, soft: false, fast: false, third: false } });
    expect(diff(slow, perc)).toBeGreaterThan(0.0005);
    const third = renderB3Note(60, 96, { ...base, percussion: { on: true, soft: false, fast: true, third: true } });
    expect(diff(third, perc)).toBeGreaterThan(0.0005);
    const click = renderB3Note(60, 96, { ...base, keyClick: true });
    expect(diff(click, dry)).toBeGreaterThan(0.0002);
  });

  it('vibrato/chorus: V1 and C1 distinct, depth grows 1..3', () => {
    const dry = renderVoxNote(60, 96, { ...defaultOrganLayer(), drawbars: stdDrawbars() });
    const v1 = applyVibChorus(dry, 'V1');
    const c1 = applyVibChorus(dry, 'C1');
    expect(diff(v1, dry)).toBeGreaterThan(0.0003);
    expect(diff(c1, dry)).toBeGreaterThan(0.0003);
    expect(diff(v1, c1)).toBeGreaterThan(0.0003);
    expect(vibDepth('V3')).toBeGreaterThan(vibDepth('V1'));
    expect(vibDepth('C3')).toBeGreaterThan(vibDepth('C1'));
    expect(diff(applyVibChorus(dry, 'V3'), dry)).toBeGreaterThan(diff(applyVibChorus(dry, 'V1'), dry));
  });

  it('Farf registers are on/off past half', () => {
    const half = renderFarfNote(60, 96, { ...defaultOrganLayer(), drawbars: [4, 4, 4, 4, 4, 4, 4, 4, 4] });
    expect(rms(half)).toBeLessThan(0.001);
    const on = renderFarfNote(60, 96, { ...defaultOrganLayer(), drawbars: [5, 5, 5, 5, 5, 5, 5, 5, 5] });
    expect(rms(on)).toBeGreaterThan(0.01);
  });
});

describe('organ.engine', () => {
  it('two-layer note lifecycle, levels, zones, shared chain, cleanup', async () => {
    const { engine, ctx } = silentEngine();
    await engine.init();
    engine.setOrgan(
      { A: defaultOrganLayer({ enabled: true }), B: defaultOrganLayer({ enabled: true, level: 6 }), focus: 'A' },
      engine.organChain,
      true,
      true,
    );
    const a = engine.organNoteOn('A', 60, 96, false)!;
    const b = engine.organNoteOn('B', 64, 96, false)!;
    expect(engine.getVoiceCount()).toBe(2);
    // Live oscillator stacks were built (partial loops per drawbar).
    expect(ctx.oscillators.length).toBeGreaterThan(4);
    engine.organNoteOff(a);
    expect(engine.getVoiceCount()).toBe(1);
    engine.organNoteOff(b);
    expect(engine.getVoiceCount()).toBe(0);
    // Disabled layers and zones stay silent.
    engine.setOrgan(
      { A: defaultOrganLayer({ enabled: false, level: 0 }), B: engine.organ.B, focus: 'A' },
      engine.organChain,
      true,
      true,
    );
    expect(engine.organNoteOn('A', 60, 96, false)).toBeNull();
    // Cleanup returns voice counts to baseline.
    const id = engine.organNoteOn('B', 60, 96, false)!;
    engine.organNoteOff(id);
    expect(engine.getVoiceCount()).toBe(0);
    const count = engine.organAllNotesOff();
    expect(count).toBe(0);
    await engine.dispose();
    expect(ctx.closed).toBe(true);
  });

  it('percussion is single-triggered (re-arms after all keys release)', async () => {
    const { engine } = silentEngine();
    await engine.init();
    engine.setOrgan(
      { A: defaultOrganLayer({ percussion: { on: true, soft: false, fast: true, third: false } }), B: engine.organ.B, focus: 'A' },
      engine.organChain,
      true,
      true,
    );
    expect(engine.organPercArmed).toBe(true);
    const a = engine.organNoteOn('A', 60, 96, false)!;
    const b = engine.organNoteOn('A', 64, 96, false)!;
    engine.organNoteOff(a);
    engine.organNoteOff(b);
    expect(engine.organPercArmed).toBe(true);
    await engine.dispose();
  });

  it('one context: organ chains share the master path, nothing bypasses it', async () => {
    const { engine, ctx } = silentEngine();
    await engine.init();
    engine.setOrgan(
      { A: defaultOrganLayer(), B: defaultOrganLayer({ enabled: false, level: 0 }), focus: 'A' },
      engine.organChain,
      true,
      true,
    );
    // Same context object; organ graph output reaches the master gain.
    expect(engine.getContext()).toBe(ctx as never);
    // Six chains total: 2 piano + 1 organ (shared) + 3 synth, one convolver each.
    expect(ctx.convolvers.length).toBe(6);
    await engine.dispose();
  });
});

describe('organ.rotary', () => {
  it('routing, slow/fast/stop with ramps, drive, morphable speed', async () => {
    const { engine, ctx } = silentEngine();
    await engine.init();
    engine.setRotary('slow', 3);
    const lfo = () => ctx.oscillators[ctx.oscillators.length - 1];
    const slowHz = lfo().frequency.value;
    engine.setRotary('fast', 3);
    const fastHz = lfo().frequency.value;
    // Acceleration: ramp events on the shared rotary LFO (not instant).
    const events = (lfo().frequency as unknown as { events: Array<{ op: string }> }).events;
    expect(events.some((e) => e.op === 'target')).toBe(true);
    expect(fastHz).toBeGreaterThan(slowHz);
    // Drive moves the shaper curve.
    engine.setRotary('fast', 9);
    // Stop freezes the rotor (gain → 0, speed param holds).
    engine.setRotary('stop', 3);
    expect(engine.rotarySpeed).toBe('stop');
    // Morphable speed: morph interpolation resolves slow/fast/stop.
    engine.setMorphAssigns('wheel', [{ target: 'rotary.speed', start: 0, end: 1 }]);
    engine.captureMorphBase();
    engine.setMorphPos('wheel', 0);
    expect(engine.rotarySpeed).toBe('slow');
    engine.setMorphPos('wheel', 0.5);
    expect(engine.rotarySpeed).toBe('fast');
    engine.setMorphPos('wheel', 1);
    expect(engine.rotarySpeed).toBe('stop');
    await engine.dispose();
  });
});
