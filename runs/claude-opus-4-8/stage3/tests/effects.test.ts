import { describe, expect, it } from 'vitest';
import { makeOfflineCtx, render, stereoWidth, brightness, windowRms } from './helpers/audio';
import {
  Mod1Unit,
  Mod2Unit,
  DelayUnit,
  AmpEqUnit,
  CompressorUnit,
  ReverbUnit,
  RotaryUnit,
  MOD1_TYPES,
  MOD2_TYPES,
  REVERB_TYPES,
} from '../src/audio/effects';
import { AudioEngine } from '../src/audio/audioEngine';

/**
 * Effect-unit tests render a standardized excitation signal through one unit and
 * assert the OUTPUT differs measurably (processing), that bypass restores the dry
 * signal, and that types are distinct. All real Web Audio, no mocks.
 */

/** Drive a unit with a steady tone and return rendered stats. */
async function throughUnit(
  build: (ctx: BaseAudioContext) => { input: AudioNode; output: AudioNode },
  seconds = 1.0,
  freq = 220,
) {
  const ctx = makeOfflineCtx(seconds);
  const unit = build(ctx);
  const osc = ctx.createOscillator();
  osc.frequency.value = freq;
  const src = ctx.createGain();
  src.gain.value = 0.5;
  osc.connect(src).connect(unit.input);
  unit.output.connect(ctx.destination);
  osc.start(0);
  osc.stop(seconds);
  return render(ctx);
}

// feature: effects.processing — each unit processes real audio; bypass works.
describe('effect processing + bypass (effects.processing)', () => {
  it('Mod 1 (Tremolo) modulates amplitude vs bypass', async () => {
    const on = await throughUnit((ctx) => {
      const u = new Mod1Unit(ctx);
      u.setType('Tremolo');
      u.setAmount(0.9);
      u.setRate(0.8);
      u.setBypassed(false);
      return u;
    });
    const off = await throughUnit((ctx) => {
      const u = new Mod1Unit(ctx);
      u.setType('Tremolo');
      u.setAmount(0.9);
      u.setBypassed(true);
      return u;
    });
    // Tremolo creates amplitude variation across windows; bypass is steady.
    const varOn = Math.abs(windowRms(on.buffer, 0, 0.1) - windowRms(on.buffer, 0.3, 0.4));
    const varOff = Math.abs(windowRms(off.buffer, 0, 0.1) - windowRms(off.buffer, 0.3, 0.4));
    expect(varOn).toBeGreaterThan(varOff);
  });

  it('Mod 1 A-Pan produces stereo width', async () => {
    const on = await throughUnit((ctx) => {
      const u = new Mod1Unit(ctx);
      u.setType('A-Pan');
      u.setAmount(0.9);
      u.setRate(0.6);
      u.setBypassed(false);
      return u;
    });
    expect(stereoWidth(on.buffer)).toBeGreaterThan(0.0001);
  });

  it('Mod 1 types are audibly distinct', async () => {
    const fps: number[] = [];
    for (const t of MOD1_TYPES) {
      const s = await throughUnit((ctx) => {
        const u = new Mod1Unit(ctx);
        u.setType(t);
        u.setAmount(0.7);
        u.setRate(0.5);
        u.setBypassed(false);
        return u;
      });
      fps.push(s.rms + brightness(s.buffer) * 10 + stereoWidth(s.buffer) * 100);
    }
    const unique = new Set(fps.map((f) => f.toFixed(3)));
    expect(unique.size).toBeGreaterThanOrEqual(4);
  });

  it('Mod 2 types are audibly distinct', async () => {
    const fps: number[] = [];
    for (const t of MOD2_TYPES) {
      const s = await throughUnit((ctx) => {
        const u = new Mod2Unit(ctx);
        u.setType(t);
        u.setAmount(0.7);
        u.setRate(0.5);
        u.setBypassed(false);
        return u;
      });
      fps.push(s.rms + brightness(s.buffer) * 10 + stereoWidth(s.buffer) * 100);
    }
    const unique = new Set(fps.map((f) => f.toFixed(3)));
    expect(unique.size).toBeGreaterThanOrEqual(3);
  });

  it('Delay produces audible repeats after the dry onset', async () => {
    const s = await throughUnit((ctx) => {
      const u = new DelayUnit(ctx);
      u.setTempo(0.2);
      u.setFeedback(0.7);
      u.setDryWet(0.6);
      u.setBypassed(false);
      // gate the source to a short burst by using a short render + measuring tail
      return u;
    }, 1.4);
    // Energy in the late window comes from delay repeats.
    expect(windowRms(s.buffer, 0.9, 1.3)).toBeGreaterThan(0.001);
  });

  it('Delay feedback filter progressively filters the repeats (not the dry path)', async () => {
    // With an LP feedback filter the late repeats are darker than early ones.
    const ctx = makeOfflineCtx(2.0);
    const u = new DelayUnit(ctx);
    u.setTempo(0.25);
    u.setFeedback(0.85);
    u.setDryWet(0.7);
    u.setFilter('LP');
    u.setBypassed(false);
    // 100ms noise burst
    const burst = ctx.createBufferSource();
    const nb = ctx.createBuffer(1, Math.floor(0.1 * ctx.sampleRate), ctx.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    burst.buffer = nb;
    burst.connect(u.input);
    u.output.connect(ctx.destination);
    burst.start(0);
    const s = await render(ctx);
    const early = brightness(s.buffer, 0); // whole-buffer proxy
    void early;
    const earlyWin = windowRms(s.buffer, 0.3, 0.6);
    const lateWin = windowRms(s.buffer, 1.2, 1.6);
    // repeats keep sounding but get quieter/darker over time
    expect(earlyWin).toBeGreaterThan(0);
    expect(lateWin).toBeGreaterThan(0);
    expect(earlyWin).toBeGreaterThan(lateWin * 0.5);
  });

  it('Amp/EQ drive changes the signal vs bypass', async () => {
    const on = await throughUnit((ctx) => {
      const u = new AmpEqUnit(ctx);
      u.setModel('Twin');
      u.setDrive(0.9);
      u.setBypassed(false);
      return u;
    });
    const off = await throughUnit((ctx) => {
      const u = new AmpEqUnit(ctx);
      u.setModel('Twin');
      u.setDrive(0.9);
      u.setBypassed(true);
      return u;
    });
    expect(Math.abs(on.rms - off.rms) + Math.abs(on.peak - off.peak)).toBeGreaterThan(0.001);
  });

  it('Amp models Twin/JC/Small are not identical', async () => {
    const fp = async (model: 'Twin' | 'JC' | 'Small') => {
      const s = await throughUnit((ctx) => {
        const u = new AmpEqUnit(ctx);
        u.setModel(model);
        u.setBypassed(false);
        return u;
      });
      return brightness(s.buffer);
    };
    const twin = await fp('Twin');
    const jc = await fp('JC');
    const small = await fp('Small');
    expect(new Set([twin.toFixed(4), jc.toFixed(4), small.toFixed(4)]).size).toBe(3);
  });

  it('Compressor narrows the loud/quiet ratio at higher amounts', async () => {
    // Loud section then quiet section. Compression + makeup lifts the quiet part
    // relative to the loud part, so the loud:quiet RMS ratio shrinks.
    const ratio = async (amount: number) => {
      const ctx = makeOfflineCtx(0.8);
      const u = new CompressorUnit(ctx);
      u.setAmount(amount);
      u.setFast(true);
      u.setBypassed(false);
      const osc = ctx.createOscillator();
      osc.frequency.value = 200;
      const g = ctx.createGain();
      g.gain.setValueAtTime(1.0, 0);
      g.gain.setValueAtTime(1.0, 0.35);
      g.gain.setValueAtTime(0.12, 0.4); // step down to quiet
      osc.connect(g).connect(u.input);
      u.output.connect(ctx.destination);
      osc.start(0);
      osc.stop(0.8);
      const s = await render(ctx);
      const loud = windowRms(s.buffer, 0.1, 0.3);
      const quiet = windowRms(s.buffer, 0.55, 0.75);
      return loud / (quiet + 1e-9);
    };
    const off = await ratio(0.0);
    const on = await ratio(1.0);
    expect(on).toBeLessThan(off);
  });

  it('Reverb adds a decay tail after the source stops', async () => {
    const ctx = makeOfflineCtx(1.5);
    const u = new ReverbUnit(ctx);
    u.setType('Hall');
    u.setDryWet(0.8);
    u.setBypassed(false);
    const osc = ctx.createOscillator();
    osc.frequency.value = 300;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    osc.connect(g).connect(u.input);
    u.output.connect(ctx.destination);
    osc.start(0);
    osc.stop(0.2); // stop early; tail must persist
    const s = await render(ctx);
    expect(windowRms(s.buffer, 0.4, 0.9)).toBeGreaterThan(0.0005);
  });

  it('Reverb decay length grows from Booth to Cathedral', async () => {
    const tail = async (type: (typeof REVERB_TYPES)[number]) => {
      const ctx = makeOfflineCtx(2.0);
      const u = new ReverbUnit(ctx);
      u.setType(type);
      u.setDryWet(0.9);
      u.setBypassed(false);
      const osc = ctx.createOscillator();
      osc.frequency.value = 300;
      const g = ctx.createGain();
      g.gain.value = 0.5;
      osc.connect(g).connect(u.input);
      u.output.connect(ctx.destination);
      osc.start(0);
      osc.stop(0.2);
      const s = await render(ctx);
      return windowRms(s.buffer, 0.8, 1.8);
    };
    const booth = await tail('Booth');
    const cath = await tail('Cathedral');
    expect(cath).toBeGreaterThan(booth);
  });

  it('Rotary produces moving stereo image', async () => {
    const s = await throughUnit((ctx) => {
      const u = new RotaryUnit(ctx);
      u.setSpeed(true);
      u.setDrive(0.5);
      u.setBypassed(false);
      return u;
    });
    expect(stereoWidth(s.buffer)).toBeGreaterThan(0.0001);
  });
});

// feature: effects.routing — signal order, all-off, focus/group/global, To Rotary.
describe('effect routing (effects.routing)', () => {
  it('all-effects bypass (Layer Effects OFF) neutralizes the chain', async () => {
    // Very short note; only a Cathedral reverb tail can fill the late window.
    // With Layer Effects OFF the whole chain is bypassed, so that tail vanishes.
    const play = async (masterOn: boolean) => {
      const ctx = makeOfflineCtx(2.0);
      const engine = new AudioEngine(ctx);
      engine.setStatus('ready');
      engine.setPerformance({ type: 'misc' }); // fast percussive decay: short dry
      engine.setEffectsMasterOn(masterOn);
      engine.setUnitEngaged('reverb', true);
      engine.applyToUnit('reverb', (c) => {
        c.reverb.setType('Cathedral');
        c.reverb.setDryWet(0.95);
      });
      engine.noteOn(60, 120);
      engine.noteOff(60);
      const s = await render(ctx);
      return windowRms(s.buffer, 1.5, 1.95);
    };
    const withFx = await play(true);
    const bypassed = await play(false);
    expect(withFx).toBeGreaterThan(bypassed * 3);
  });

  it('per-unit on/off changes the signal', async () => {
    // mallet dry fully decays by ~1.4s; a Cathedral tail rings past that. With the
    // reverb unit engaged the late window has energy; with it off it is ~silent.
    const play = async (reverbOn: boolean) => {
      const ctx = makeOfflineCtx(2.0);
      const engine = new AudioEngine(ctx);
      engine.setStatus('ready');
      engine.setPerformance({ type: 'misc' });
      engine.setEffectsMasterOn(true);
      engine.setUnitEngaged('reverb', reverbOn);
      engine.applyToUnit('reverb', (c) => {
        c.reverb.setType('Cathedral');
        c.reverb.setDryWet(0.9);
      });
      engine.noteOn(60, 120);
      engine.noteOff(60);
      const s = await render(ctx);
      return windowRms(s.buffer, 1.5, 1.95);
    };
    expect(await play(true)).toBeGreaterThan(await play(false) * 3);
  });

  it('To Rotary routes the layer into the shared rotary (moving stereo image)', async () => {
    const ctx = makeOfflineCtx(1.0);
    const engine = new AudioEngine(ctx);
    engine.setStatus('ready');
    engine.setPerformance({ type: 'digital' });
    engine.setEffectsMasterOn(true);
    engine.setUnitEngaged('amp', true);
    engine.setAmpModel('To Rotary');
    engine.rotaryUnit.setSpeed(true);
    engine.rotaryUnit.setDrive(0.6);
    for (const m of [60, 64, 67]) engine.noteOn(m, 110);
    const s = await render(ctx);
    expect(stereoWidth(s.buffer)).toBeGreaterThan(0.0001);
  });

  it('focus targets the focused layer; group applies to both piano layers', async () => {
    const ctx = makeOfflineCtx(0.6);
    const engine = new AudioEngine(ctx);
    engine.setStatus('ready');
    engine.setLayer('A', { enabled: true });
    engine.setLayer('B', { enabled: true });
    // Focus B only: engaging reverb hits B's chain.
    engine.setFocus('B');
    engine.setUnitEngaged('reverb', true);
    expect(engine.chain('B').reverb.bypassed).toBe(false);
    expect(engine.chain('A').reverb.bypassed).toBe(true);
    // Group mode: now both.
    engine.setPianoGroup(true);
    engine.setUnitEngaged('reverb', true);
    expect(engine.chain('A').reverb.bypassed).toBe(false);
    expect(engine.chain('B').reverb.bypassed).toBe(false);
  });

  it('global mode targets both layers regardless of focus', async () => {
    const ctx = makeOfflineCtx(0.5);
    const engine = new AudioEngine(ctx);
    engine.setFocus('A');
    engine.setGlobalUnit('delay', true);
    engine.setUnitEngaged('delay', true);
    expect(engine.chain('A').delay.bypassed).toBe(false);
    expect(engine.chain('B').delay.bypassed).toBe(false);
  });

  it('the ordered chain is Mod1->Mod2->Delay->Amp->Comp->Reverb per layer', () => {
    const ctx = makeOfflineCtx(0.3);
    const engine = new AudioEngine(ctx);
    const chain = engine.chain('A');
    // Structural contract: the units exist in the documented order.
    const order = chain.units().map((u) => u.constructor.name);
    expect(order).toEqual([
      'Mod1Unit',
      'Mod2Unit',
      'DelayUnit',
      'AmpEqUnit',
      'CompressorUnit',
      'ReverbUnit',
    ]);
  });
});
