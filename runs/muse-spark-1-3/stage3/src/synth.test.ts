/**
 * synth.sources / synth.filter-envelopes / synth.voice-modes / synth.arp-gate
 * — three layers; required waveforms distinct per category; Osc Ctrl per
 * category; filter types/tracking/resonance/drive + three envelopes;
 * poly/mono/legato, priority, glide, unison, vibrato, LFO; deterministic
 * arp/gate with rate/sync/range/direction/hold/run.
 */
import { describe, expect, it } from 'vitest';
import { StageEngine } from './audio/stageEngine';
import { StageFakeContext } from './audio/stageFakes';
import { createTestClock } from './audio/types';
import {
  ALL_WAVES,
  REQUIRED_WAVES,
  defaultSynthLayer,
  oscCtrlKind,
  waveCategory,
} from './audio/synthTypes';
import {
  adsrLevel,
  applySynthFilter,
  arpStepMs,
  arpStepOrder,
  cutoffHz,
  gateLevel,
  lfoRateHz,
  renderOscWave,
  renderSynthLayerVoice,
  trackedCutoff,
} from './audio/synthRender';
import { glideMs, monoTarget, renderLiveSynthVoice } from './audio/synthVoices';
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

const SR = 44100;

describe('synth.sources', () => {
  it('ships the exact required waveform list', () => {
    expect(REQUIRED_WAVES.Pure).toEqual(['Sine', 'Triangle', 'Saw', 'Square', 'Pulse 33', 'Pulse 10', 'White Noise']);
    expect(REQUIRED_WAVES.Sync).toEqual(['Sync Saw', 'Sync Square']);
    expect(REQUIRED_WAVES.Multi).toEqual(['Multi Saw', 'Multi Saw 8ve']);
    expect(REQUIRED_WAVES.Super).toEqual(['Super Saw', 'Super Square']);
    expect(REQUIRED_WAVES['FM-H']).toEqual(['FM 2-op (algorithm A)']);
    expect(ALL_WAVES).toHaveLength(14);
  });

  it('Pure, Sync, Multi, Super, FM-H are audibly distinct source behaviors', () => {
    const reps = ['Saw', 'Sync Saw', 'Multi Saw', 'Super Saw', 'FM 2-op (algorithm A)'];
    const outs = reps.map((w) => renderOscWave(w, 220, 5, SR, SR));
    for (const out of outs) expect(rms(out)).toBeGreaterThan(0.05);
    for (let i = 0; i < outs.length; i += 1) {
      for (let j = i + 1; j < outs.length; j += 1) {
        expect(diff(outs[i], outs[j]), `${reps[i]} vs ${reps[j]}`).toBeGreaterThan(0.02);
      }
    }
  });

  it('Osc Ctrl behaves per category (Pure none, Sync pitch, Multi/Super detune, FM amount)', () => {
    const len = Math.floor(SR * 0.5);
    // Pure: no effect.
    expect(diff(renderOscWave('Saw', 220, 0, len, SR), renderOscWave('Saw', 220, 10, len, SR))).toBeLessThan(0.00001);
    expect(oscCtrlKind('Saw')).toBe('none');
    // Sync: relative pitch moves timbre.
    expect(diff(renderOscWave('Sync Saw', 220, 1, len, SR), renderOscWave('Sync Saw', 220, 9, len, SR))).toBeGreaterThan(0.02);
    expect(oscCtrlKind('Sync Saw')).toBe('syncPitch');
    // Multi/Super: detune width.
    expect(diff(renderOscWave('Multi Saw', 220, 0, len, SR), renderOscWave('Multi Saw', 220, 10, len, SR))).toBeGreaterThan(0.005);
    expect(diff(renderOscWave('Super Saw', 220, 0, len, SR), renderOscWave('Super Saw', 220, 10, len, SR))).toBeGreaterThan(0.005);
    // FM-H: modulation amount.
    expect(diff(renderOscWave('FM 2-op (algorithm A)', 220, 0, len, SR), renderOscWave('FM 2-op (algorithm A)', 220, 10, len, SR))).toBeGreaterThan(0.05);
    expect(oscCtrlKind('FM 2-op (algorithm A)')).toBe('fmAmount');
    expect(waveCategory('Pulse 10')).toBe('Pure');
  });

  it('three layers render independently with own voices', async () => {
    const { engine } = silentEngine();
    await engine.init();
    engine.setSynth(
      {
        A: defaultSynthLayer({ wave: 'Saw' }),
        B: defaultSynthLayer({ wave: 'Square' }),
        C: defaultSynthLayer({ wave: 'Sine' }),
        focus: 'A',
      },
      engine.synthChains,
      true,
      false,
    );
    const ids = [
      engine.synthNoteOn('A', 60, 96, false)!,
      engine.synthNoteOn('B', 64, 96, false)!,
      engine.synthNoteOn('C', 67, 96, false)!,
    ];
    expect(engine.getVoiceCount()).toBe(3);
    for (const id of ids) engine.synthNoteOff(id);
    await engine.dispose();
  });
});

describe('synth.filter-envelopes', () => {
  it('filter type/freq/res/tracking/drive each alter rendered audio', () => {
    const dry = renderOscWave('Saw', 220, 5, SR, SR);
    const lp12 = applySynthFilter(dry, 'LP12', 4, 2, 0, 60, 'Off', SR);
    const lp24 = applySynthFilter(dry, 'LP24', 4, 2, 0, 60, 'Off', SR);
    const hp = applySynthFilter(dry, 'HP', 4, 2, 0, 60, 'Off', SR);
    const bp = applySynthFilter(dry, 'BP', 4, 2, 0, 60, 'Off', SR);
    for (const out of [lp12, lp24, hp, bp]) expect(diff(out, dry)).toBeGreaterThan(0.001);
    expect(diff(lp12, lp24)).toBeGreaterThan(0.0005);
    expect(diff(lp12, hp)).toBeGreaterThan(0.001);
    expect(diff(hp, bp)).toBeGreaterThan(0.0005);
    // Frequency sweeps; resonance colors; tracking follows pitch; drive saturates.
    expect(diff(applySynthFilter(dry, 'LP24', 2, 2, 0, 60, 'Off', SR), applySynthFilter(dry, 'LP24', 8, 2, 0, 60, 'Off', SR))).toBeGreaterThan(0.002);
    expect(diff(applySynthFilter(dry, 'LP24', 5, 0, 0, 60, 'Off', SR), applySynthFilter(dry, 'LP24', 5, 8, 0, 60, 'Off', SR))).toBeGreaterThan(0.0005);
    expect(trackedCutoff(1000, 72, 60, '1')).toBeCloseTo(2000, 0);
    expect(trackedCutoff(1000, 72, 60, 'Off')).toBe(1000);
    expect(diff(applySynthFilter(dry, 'LP12', 6, 2, 0, 60, 'Off', SR), applySynthFilter(dry, 'LP12', 6, 2, 3, 60, 'Off', SR))).toBeGreaterThan(0.001);
    expect(cutoffHz(0)).toBeLessThan(cutoffHz(10));
  });

  it('osc/filter/amp ADR envelopes shape time; decay-max sustains; velocity matters', () => {
    const env = { attack: 2, decay: 4, release: 3 };
    expect(adsrLevel(env, 0, 10, Infinity, 0.8)).toBeLessThan(adsrLevel(env, 5, 10, Infinity, 0.8));
    // Decay-max = sustain mode: level holds instead of decaying.
    const sus = { attack: 0, decay: 10, release: 3 };
    expect(adsrLevel(sus, 3, 10, Infinity, 0.8)).toBeCloseTo(1, 2);
    // Release tail falls after key-up.
    expect(adsrLevel(env, 11, 10, 10, 0.8)).toBeLessThan(adsrLevel(env, 9.9, 10, Infinity, 0.8));
    // Amp velocity levels shape loudness.
    const soft = renderSynthLayerVoice(60, 40, defaultSynthLayer(), { sr: SR });
    const loud = renderSynthLayerVoice(60, 120, defaultSynthLayer(), { sr: SR });
    expect(rms(loud)).toBeGreaterThan(rms(soft));
    // Filter env amount audibly sweeps the voice.
    const flat = renderSynthLayerVoice(60, 100, defaultSynthLayer({ filterEnvAmt: 0 }), { sr: SR });
    const swept = renderSynthLayerVoice(60, 100, defaultSynthLayer({ filterEnvAmt: 8, filterEnv: { attack: 1, decay: 5, release: 3 } }), { sr: SR });
    expect(diff(flat, swept)).toBeGreaterThan(0.0005);
  });

  it('LFO: five waves, three dests, clock sync, audible modulation', () => {
    const base = defaultSynthLayer({ lfoDest: 'Filter Freq', lfoAmt: 7, lfoRate: 5 });
    const dry = renderSynthLayerVoice(60, 100, defaultSynthLayer({ lfoDest: null }), { sr: SR });
    const waves = ['Triangle', 'Saw down', 'Saw up', 'Square', 'Sample & Hold'] as const;
    const outs = waves.map((w) => renderSynthLayerVoice(60, 100, { ...base, lfoWave: w }, { sr: SR }));
    for (const out of outs) expect(diff(out, dry)).toBeGreaterThan(0.0003);
    // Destinations differ.
    const pitch = renderSynthLayerVoice(60, 100, { ...base, lfoDest: 'Osc Pitch' }, { sr: SR });
    const ctrl = renderSynthLayerVoice(60, 100, { ...base, lfoDest: 'Osc Ctrl' }, { sr: SR });
    expect(diff(pitch, outs[0])).toBeGreaterThan(0.0002);
    expect(diff(ctrl, outs[0])).toBeGreaterThan(0.0002);
    // Sync locks to the clock subdivision (manual dial spans 0.1..20 Hz).
    const synced = { ...base, lfoSync: true, lfoSubdiv: '1/16' as const };
    expect(lfoRateHz(synced, 120)).toBeCloseTo(8, 3);
    expect(lfoRateHz({ ...base, lfoSync: false, lfoRate: 5 }, 120)).toBeCloseTo(10.05, 1);
  });
});

describe('synth.voice-modes', () => {
  it('mono/legato/priority select one voice; glide times intervals; unison/vibrato audible', async () => {
    // Priority selection is pure and deterministic.
    const held = [
      { midi: 60, startedAt: 100 },
      { midi: 64, startedAt: 200 },
      { midi: 67, startedAt: 300 },
    ];
    expect(monoTarget(held, 'Low')).toBe(60);
    expect(monoTarget(held, 'High')).toBe(67);
    expect(monoTarget(held, 'Off')).toBe(67); // latest
    expect(monoTarget([], 'Low')).toBeNull();
    // Glide: constant rate (wider interval = longer), silent at rate 0.
    expect(glideMs(12, 0)).toBe(0);
    expect(glideMs(12, 5)).toBeGreaterThan(glideMs(2, 5));
    // Live mono behavior: legato retrigger keeps one voice with glide.
    const { engine } = silentEngine();
    await engine.init();
    engine.setSynth(
      { A: defaultSynthLayer({ voice: { ...defaultSynthLayer().voice, mode: 'Legato', glide: 6 } }), B: engine.synth.B, C: engine.synth.C, focus: 'A' },
      engine.synthChains,
      true,
      false,
    );
    const n1 = engine.synthNoteOn('A', 60, 96, false)!;
    expect(engine.getVoiceCount()).toBe(1);
    const n2 = engine.synthNoteOn('A', 67, 96, false)!;
    expect(engine.getVoiceCount()).toBe(1); // retriggered, still one voice
    engine.synthNoteOff(n1);
    engine.synthNoteOff(n2);
    // Unison + vibrato change the voice.
    const dry = renderLiveSynthVoice(60, 100, defaultSynthLayer({ voice: { ...defaultSynthLayer().voice } }), { sr: SR });
    const uni = renderLiveSynthVoice(60, 100, defaultSynthLayer({ voice: { ...defaultSynthLayer().voice, unison: 3 } }), { sr: SR });
    expect(diff(dry, uni)).toBeGreaterThan(0.001);
    const vib = renderLiveSynthVoice(60, 100, defaultSynthLayer({ voice: { ...defaultSynthLayer().voice, vibrato: 'On', vibAmount: 8 } }), { sr: SR });
    expect(diff(dry, vib)).toBeGreaterThan(0.0005);
    // Wheel vibrato needs the wheel.
    const wheelOff = renderLiveSynthVoice(60, 100, defaultSynthLayer({ voice: { ...defaultSynthLayer().voice, vibrato: 'Wheel', vibAmount: 8 } }), { sr: SR, wheel: 0 });
    const wheelOn = renderLiveSynthVoice(60, 100, defaultSynthLayer({ voice: { ...defaultSynthLayer().voice, vibrato: 'Wheel', vibAmount: 8 } }), { sr: SR, wheel: 1 });
    expect(diff(wheelOff, dry)).toBeLessThan(0.00001);
    expect(diff(wheelOn, dry)).toBeGreaterThan(0.0005);
    await engine.dispose();
  });
});

describe('synth.arp-gate', () => {
  it('deterministic order/timing: range, direction, sync, hold, run', async () => {
    const layer = defaultSynthLayer({
      arp: { mode: 'Arp', rate: 5, sync: false, subdiv: '1/8', range: 2, direction: 'Up', hold: false, run: true },
    });
    // Up over 2 octaves from a 2-note set.
    expect(arpStepOrder([60, 64], layer, 4)).toEqual([60, 64, 72, 76]);
    expect(arpStepOrder([60, 64], { ...layer, arp: { ...layer.arp, direction: 'Down' } }, 4)).toEqual([76, 72, 64, 60]);
    const updown = arpStepOrder([60, 64, 67], { ...layer, arp: { ...layer.arp, direction: 'Up/Down', range: 1 } }, 5);
    expect(updown).toEqual([60, 64, 67, 64, 60]);
    // Random is deterministic for a fixed seed.
    const r1 = arpStepOrder([60, 64, 67], { ...layer, arp: { ...layer.arp, direction: 'Random' } }, 8, 7);
    const r2 = arpStepOrder([60, 64, 67], { ...layer, arp: { ...layer.arp, direction: 'Random' } }, 8, 7);
    expect(r1).toEqual(r2);
    // Unsynced rate → 8th-note period; synced → subdivision of the clock.
    const free = arpStepMs({ ...layer, arp: { ...layer.arp, sync: false, rate: 5 } }, 120);
    expect(free).toBeGreaterThan(30);
    expect(arpStepMs({ ...layer, arp: { ...layer.arp, sync: true, subdiv: '1/16' } }, 120)).toBe(125);
    // Gate hardness shapes the envelope: hard cuts mid-cycle, soft sustains.
    expect(gateLevel(0.5, 1, 0)).toBeGreaterThan(gateLevel(0.5, 1, 1));
    // Live: arpTick steps deterministically without timers.
    const { engine } = silentEngine();
    await engine.init();
    engine.setSynth({ A: layer, B: engine.synth.B, C: engine.synth.C, focus: 'A' }, engine.synthChains, true, false);
    engine.synthNoteOn('A', 60, 96, false);
    engine.synthNoteOn('A', 64, 96, false);
    expect(engine.arpTick('A')).toBe(60);
    expect(engine.arpTick('A')).toBe(64);
    expect(engine.arpTick('A')).toBe(72);
    expect(engine.arpInfo('A').running).toBe(true);
    // Clock change re-times the scheduler.
    engine.setClockBpm(140);
    expect(engine.arpInfo('A').periodMs).toBe(arpStepMs(engine.synth.A, 140));
    await engine.dispose();
  });
});
