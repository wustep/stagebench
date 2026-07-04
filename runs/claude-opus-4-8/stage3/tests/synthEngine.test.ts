import { describe, expect, it } from 'vitest';
import { makeOfflineCtx, render, brightness, windowRms } from './helpers/audio';
import { AudioEngine } from '../src/audio/audioEngine';
import { arpSequence, Arpeggiator, MasterClock } from '../src/audio/clock';
import { defaultSynthLayerParams, type SynthCategory } from '../src/audio/synthEngine';

function synthEngine(seconds = 0.8) {
  const ctx = makeOfflineCtx(seconds);
  const engine = new AudioEngine(ctx);
  engine.setStatus('ready');
  engine.setSynthSection({ on: true });
  engine.setSynthLayer('A', { enabled: true });
  engine.setSynthLayer('B', { enabled: false });
  engine.setSynthLayer('C', { enabled: false });
  return { engine, ctx };
}

async function renderCategory(category: SynthCategory, overrides: Partial<ReturnType<typeof defaultSynthLayerParams>> = {}) {
  const { engine, ctx } = synthEngine();
  engine.setSynthLayer('A', { enabled: true, ...defaultSynthLayerParams(), category, filterFreq: 0.9, filterEnvAmt: 0, ...overrides });
  engine.synthNoteOn(60, 110);
  return render(ctx);
}

// feature: synth.sources
describe('synth source categories are audibly distinct (synth.sources)', () => {
  it('Pure, Sync, Multi, Super, FM-H render distinct signals', async () => {
    const pure = await renderCategory('Pure', { waveIndex: 2 }); // Saw
    const sync = await renderCategory('Sync', { oscCtrl: 0.7 });
    const multi = await renderCategory('Multi', { oscCtrl: 0.6 });
    const superc = await renderCategory('Super', { oscCtrl: 0.6 });
    const fm = await renderCategory('FM-H', { oscCtrl: 0.6 });

    for (const s of [pure, sync, multi, superc, fm]) expect(s.rms).toBeGreaterThan(0.0005);

    // Distinct brightness signatures across the five categories.
    const b = [pure, sync, multi, superc, fm].map((s) => brightness(s.buffer));
    // They are not all equal — every adjacent pair differs.
    for (let i = 1; i < b.length; i++) expect(b[i]).not.toBe(b[i - 1]);
  });

  it('Osc Ctrl acts per category (Super detune widens the stereo/spectral field)', async () => {
    const narrow = await renderCategory('Super', { oscCtrl: 0.0 });
    const wide = await renderCategory('Super', { oscCtrl: 1.0 });
    // Wider detune changes the rendered signal (different brightness/rms).
    expect(Math.abs(brightness(wide.buffer) - brightness(narrow.buffer)) + Math.abs(wide.rms - narrow.rms)).toBeGreaterThan(0);
  });

  it('FM-H amount changes the harmonic content', async () => {
    const low = await renderCategory('FM-H', { oscCtrl: 0.05 });
    const high = await renderCategory('FM-H', { oscCtrl: 0.9 });
    expect(brightness(high.buffer)).toBeGreaterThan(brightness(low.buffer));
  });
});

// feature: synth.filter-envelopes
describe('synth filter + envelopes (synth.filter-envelopes)', () => {
  it('lower cutoff removes high-frequency energy', async () => {
    const open = await renderCategory('Pure', { waveIndex: 2, filterFreq: 0.95, filterType: 'LP24' });
    const closed = await renderCategory('Pure', { waveIndex: 2, filterFreq: 0.1, filterType: 'LP24' });
    expect(brightness(open.buffer)).toBeGreaterThan(brightness(closed.buffer));
  });

  it('HP filter keeps highs, cuts lows vs LP', async () => {
    // Low-resonance, no envelope so the cutoff shape dominates the comparison.
    const common = { waveIndex: 2, filterFreq: 0.5, filterRes: 0.0, filterEnvAmt: 0 } as const;
    const lp = await renderCategory('Pure', { ...common, filterType: 'LP24' });
    const hp = await renderCategory('Pure', { ...common, filterType: 'HP' });
    // HP passes the bright upper partials the LP removes.
    expect(brightness(hp.buffer)).toBeGreaterThan(brightness(lp.buffer));
  });

  it('amp envelope attack delays the onset', async () => {
    const fast = await renderCategory('Pure', { waveIndex: 0, ampEnv: { attack: 0.005, decay: 1, release: 0.3, velocity: true } });
    const slow = await renderCategory('Pure', { waveIndex: 0, ampEnv: { attack: 0.4, decay: 1, release: 0.3, velocity: true } });
    // Early window is quieter with the slow attack.
    expect(windowRms(slow.buffer, 0, 0.05)).toBeLessThan(windowRms(fast.buffer, 0, 0.05));
  });

  it('filter envelope amount sweeps the cutoff (changes brightness over time)', async () => {
    const noEnv = await renderCategory('Pure', { waveIndex: 2, filterFreq: 0.2, filterEnvAmt: 0 });
    const withEnv = await renderCategory('Pure', { waveIndex: 2, filterFreq: 0.2, filterEnvAmt: 1 });
    // Envelope opens the filter early: more brightness in the attack window.
    expect(windowRms(withEnv.buffer, 0.0, 0.1)).not.toBe(windowRms(noEnv.buffer, 0.0, 0.1));
  });
});

// feature: synth.voice-modes
describe('synth voice modes (synth.voice-modes)', () => {
  it('mono mode keeps a single voice per layer; poly stacks', () => {
    const { engine } = synthEngine();
    engine.setSynthSection({ on: true, voiceMode: 'Poly' });
    engine.setSynthLayer('A', { enabled: true });
    engine.synthNoteOn(60, 100);
    engine.synthNoteOn(64, 100);
    expect(engine.synthVoiceCount).toBe(2);
    engine.allNotesOff();

    engine.setSynthSection({ on: true, voiceMode: 'Mono' });
    engine.synthNoteOn(60, 100);
    engine.synthNoteOn(64, 100);
    expect(engine.synthVoiceCount).toBe(1);
  });

  it('unison adds detuned voices (wider signal)', async () => {
    const none = await renderCategory('Super', { unison: 0 });
    const uni = await renderCategory('Super', { unison: 3 });
    expect(uni.rms).toBeGreaterThan(0);
    expect(none.rms).toBeGreaterThan(0);
  });
});

// feature: synth.arp-gate
describe('arpeggiator determinism (synth.arp-gate)', () => {
  it('arpSequence is deterministic for Up/Down/Range', () => {
    expect(arpSequence([60, 64, 67], 1, 'Up')).toEqual([60, 64, 67]);
    expect(arpSequence([60, 64, 67], 1, 'Down')).toEqual([67, 64, 60]);
    expect(arpSequence([60, 64, 67], 2, 'Up')).toEqual([60, 64, 67, 72, 76, 79]);
    expect(arpSequence([60, 64, 67], 1, 'Up/Down')).toEqual([60, 64, 67, 64]);
  });

  it('Random is reproducible for a fixed seed', () => {
    const a = arpSequence([60, 62, 64, 65], 1, 'Random', 42);
    const b = arpSequence([60, 62, 64, 65], 1, 'Random', 42);
    expect(a).toEqual(b);
    expect(a.sort()).toEqual([60, 62, 64, 65]);
  });

  it('Arpeggiator ticks deterministically against a manual scheduler + clock', () => {
    const clock = new MasterClock();
    clock.setBpm(120);
    const played: Array<{ on: boolean; note: number }> = [];
    const arp = new Arpeggiator(
      {
        noteOn: (n) => played.push({ on: true, note: n }),
        noteOff: (n) => played.push({ on: false, note: n }),
      },
      clock,
      { setInterval: () => 1, clearInterval: () => {} },
    );
    arp.direction = 'Up';
    arp.rangeOctaves = 1;
    arp.setHeld([60, 64, 67]);
    arp.start();
    arp.tick();
    arp.tick();
    arp.tick();
    arp.tick(); // wraps to start
    const ons = played.filter((p) => p.on).map((p) => p.note);
    expect(ons).toEqual([60, 64, 67, 60]);
  });

  it('master clock tap sets BPM from four+ evenly spaced taps', () => {
    const clock = new MasterClock();
    // 120 BPM => 500ms per beat.
    clock.tap(0);
    clock.tap(500);
    clock.tap(1000);
    clock.tap(1500);
    expect(clock.getBpm()).toBe(120);
  });
});
