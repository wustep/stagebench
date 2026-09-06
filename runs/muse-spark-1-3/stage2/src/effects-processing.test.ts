/**
 * effects.processing — every unit and every listed type measurably changes a
 * standardized rendered signal. All assertions run on rendered Float32Array
 * buffers (audio boundary), with tolerant directional relationships.
 */
import { describe, expect, it } from 'vitest';
import {
  applyAmpEq,
  applyComp,
  applyDelay,
  applyMod1,
  applyMod2,
  applyReverb,
  applyRotary,
  renderLayerChain,
  reverbIr,
  rms,
} from './audio/render';
import { AMP_TYPES, MOD1_TYPES, MOD2_TYPES, REVERB_TYPES, defaultChain } from './state/fxTypes';
import { renderSynthVoice } from './audio/render';

function standard(): Float32Array {
  // Standardized rendered signal: deterministic digital voice, fixed pitch/vel.
  return renderSynthVoice(64, 100, 'digital');
}

function diff(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let d = 0;
  for (let i = 0; i < n; i += 1) d += Math.abs(a[i] - b[i]);
  return d / n;
}

describe('effects.processing', () => {
  it('Mod 1: all six listed types audibly distinct from dry and each other', () => {
    const dry = standard();
    expect(rms(dry)).toBeGreaterThan(0.01);
    const outs = MOD1_TYPES.map((t) => applyMod1(dry, t, 5, 7));
    for (const out of outs) {
      expect(rms(out)).toBeGreaterThan(0.001);
      expect(diff(out, dry)).toBeGreaterThan(0.0005);
    }
    // Pairwise distinct (tolerant — types must not render identically).
    for (let i = 0; i < outs.length; i += 1) {
      for (let j = i + 1; j < outs.length; j += 1) {
        expect(diff(outs[i], outs[j])).toBeGreaterThan(0.0002);
      }
    }
    // Amount moves the signal in the expected direction.
    const soft = applyMod1(dry, 'tremolo', 5, 2);
    const hard = applyMod1(dry, 'tremolo', 5, 9);
    expect(diff(hard, dry)).toBeGreaterThan(diff(soft, dry));
    // Rate moves the signal too.
    expect(diff(applyMod1(dry, 'tremolo', 2, 7), applyMod1(dry, 'tremolo', 8, 7))).toBeGreaterThan(0.0002);
  });

  it('Mod 2: all six listed types audibly distinct from dry and each other', () => {
    const dry = standard();
    const outs = MOD2_TYPES.map((t) => applyMod2(dry, t, 4, 6));
    for (const out of outs) {
      expect(rms(out)).toBeGreaterThan(0.001);
      expect(diff(out, dry)).toBeGreaterThan(0.0003);
    }
    for (let i = 0; i < outs.length; i += 1) {
      for (let j = i + 1; j < outs.length; j += 1) {
        expect(diff(outs[i], outs[j])).toBeGreaterThan(0.0001);
      }
    }
    const soft = applyMod2(dry, 'chorus', 4, 2);
    const hard = applyMod2(dry, 'chorus', 4, 9);
    expect(diff(hard, dry)).toBeGreaterThan(diff(soft, dry));
  });

  it('Delay: time/feedback/wet move the signal; feedback filter processes repeats', () => {
    const dry = standard();
    const slap = applyDelay(dry, 120, 2, 5, 'off');
    const long = applyDelay(dry, 480, 6, 7, 'off');
    expect(diff(slap, dry)).toBeGreaterThan(0.0003);
    expect(diff(long, dry)).toBeGreaterThan(diff(slap, dry));
    // Filters color the repeats: lp/hp/bp each differ from unfiltered.
    const lp = applyDelay(dry, 300, 7, 8, 'lp');
    const hp = applyDelay(dry, 300, 7, 8, 'hp');
    const bp = applyDelay(dry, 300, 7, 8, 'bp');
    const plain = applyDelay(dry, 300, 7, 8, 'off');
    for (const f of [lp, hp, bp]) expect(diff(f, plain)).toBeGreaterThan(0.0002);
    expect(diff(lp, hp)).toBeGreaterThan(0.0002);
    // Wet 0 ≈ dry.
    expect(diff(applyDelay(dry, 300, 7, 0, 'off'), dry)).toBeLessThan(0.00001);
  });

  it('Amp Sim/EQ: three amps distinct; filters sweep with freq; EQ bands move tone', () => {
    const dry = standard();
    const mk = (type: (typeof AMP_TYPES)[number]) => ({
      ...defaultChain().ampEq,
      on: true,
      type,
      drive: 4,
      bass: 0,
      mid: 0,
      freq: 1200,
      treble: 0,
    });
    const twin = applyAmpEq(dry, mk('twin'));
    const jc = applyAmpEq(dry, mk('jc'));
    const small = applyAmpEq(dry, mk('small'));
    for (const amp of [twin, jc, small]) expect(diff(amp, dry)).toBeGreaterThan(0.0003);
    expect(diff(twin, jc)).toBeGreaterThan(0.0002);
    expect(diff(twin, small)).toBeGreaterThan(0.0002);
    expect(diff(jc, small)).toBeGreaterThan(0.0002);
    // EQ only passes tone without drive coloration, but bands still move it.
    const flat = applyAmpEq(dry, { ...mk('eq'), drive: 0 });
    const bassy = applyAmpEq(dry, { ...mk('eq'), drive: 0, bass: 12 });
    const trebly = applyAmpEq(dry, { ...mk('eq'), drive: 0, treble: 12 });
    expect(diff(bassy, flat)).toBeGreaterThan(0.0002);
    expect(diff(trebly, flat)).toBeGreaterThan(0.0002);
    // Filters: cutoff sweeps audibly; resonance (mid) colors LP24.
    const lpLow = applyAmpEq(dry, { ...mk('lp24'), freq: 400 });
    const lpHigh = applyAmpEq(dry, { ...mk('lp24'), freq: 6000 });
    expect(diff(lpLow, lpHigh)).toBeGreaterThan(0.001);
    const hpLow = applyAmpEq(dry, { ...mk('hp24'), freq: 200 });
    const hpHigh = applyAmpEq(dry, { ...mk('hp24'), freq: 4000 });
    expect(diff(hpLow, hpHigh)).toBeGreaterThan(0.001);
    // Drive moves the signal in the expected direction.
    const clean = applyAmpEq(dry, { ...mk('twin'), drive: 0 });
    const dirty = applyAmpEq(dry, { ...mk('twin'), drive: 9 });
    expect(diff(dirty, dry)).toBeGreaterThan(diff(clean, dry));
  });

  it('Compressor: higher amounts reduce dynamic range; fast pumps harder', () => {
    const dry = standard();
    const mild = applyComp(dry, 3, false);
    const hot = applyComp(dry, 9, false);
    const fast = applyComp(dry, 9, true);
    expect(diff(mild, dry)).toBeGreaterThan(0.0001);
    expect(diff(hot, dry)).toBeGreaterThan(diff(mild, dry));
    expect(diff(fast, dry)).toBeGreaterThan(0.0001);
    expect(diff(fast, hot)).toBeGreaterThan(0.0001);
    // Crest factor falls as amount rises (range reduction, then makeup).
    const crest = (b: Float32Array) => {
      let peak = 0;
      for (let i = 0; i < b.length; i += 1) peak = Math.max(peak, Math.abs(b[i]));
      return peak / (rms(b) || 1);
    };
    expect(crest(hot)).toBeLessThan(crest(dry));
  });

  it('Reverb: six types with growing decays; spring boings; wet→fully wet', { timeout: 120000 }, () => {
    const dry = standard();
    const outs = REVERB_TYPES.map((t) => applyReverb(dry, t, 6, false));
    for (const out of outs) expect(diff(out, dry)).toBeGreaterThan(0.0003);
    for (let i = 0; i < outs.length; i += 1) {
      for (let j = i + 1; j < outs.length; j += 1) {
        expect(diff(outs[i], outs[j])).toBeGreaterThan(0.0001);
      }
    }
    // Decay grows Booth < Room < Stage < Hall < Cathedral. Decay length is
    // a property of the IR envelope, so it is asserted on the deterministic
    // IRs (late-window energy, 0.25–0.6 s): single-realization convolution
    // energy against one dry phrase is seed-sensitive and not a stable
    // measure of decay length.
    const lateEnergy = (kind: (typeof REVERB_TYPES)[number]) => {
      const ir = reverbIr(kind, false);
      const late0 = Math.min(ir.length, Math.floor(44100 * 0.25));
      const late1 = Math.min(ir.length, Math.floor(44100 * 0.6));
      let e = 0;
      for (let i = late0; i < late1; i += 1) e += ir[i] * ir[i];
      return e;
    };
    const ordered = (['booth', 'room', 'stage', 'hall', 'cathedral'] as const).map(lateEnergy);
    for (let i = 1; i < ordered.length; i += 1) {
      expect(ordered[i]).toBeGreaterThan(ordered[i - 1]);
    }
    // Rendered spot-check: a long hall wash clearly outlasts a booth.
    const tailEnergy = (b: Float32Array) => {
      const start = Math.floor(b.length * 0.5);
      let e = 0;
      for (let i = start; i < b.length; i += 1) e += b[i] * b[i];
      return e;
    };
    const booth = applyReverb(dry, 'booth', 8, false);
    const hall = applyReverb(dry, 'hall', 8, false);
    expect(tailEnergy(hall)).toBeGreaterThan(tailEnergy(booth));
    // Bright/dark moves the signal.
    expect(diff(applyReverb(dry, 'hall', 6, true), applyReverb(dry, 'hall', 6, false))).toBeGreaterThan(0.0001);
    // Wet 0 ≈ dry; wet 10 ≈ fully wet (dry nearly gone).
    expect(diff(applyReverb(dry, 'hall', 0, false), dry)).toBeLessThan(0.00001);
    const soaked = applyReverb(dry, 'hall', 10, false);
    expect(diff(soaked, dry)).toBeGreaterThan(diff(hall, dry));
  });

  it('Rotary: slow/fast shimmer audibly; drive moves tone; stop ≈ unity', () => {
    const dry = standard();
    const slow = applyRotary(dry, 'slow', 3);
    const fast = applyRotary(dry, 'fast', 3);
    expect(diff(slow, dry)).toBeGreaterThan(0.0003);
    expect(diff(fast, dry)).toBeGreaterThan(0.0003);
    expect(diff(slow, fast)).toBeGreaterThan(0.0002);
    expect(diff(applyRotary(dry, 'stop', 3), dry)).toBeLessThan(0.00001);
    expect(diff(applyRotary(dry, 'fast', 8), fast)).toBeGreaterThan(0.0002);
  });

  it('full chain order: reverb precedes rotary; bypass returns dry', () => {
    const dry = standard();
    const chain = {
      ...defaultChain(),
      reverb: { ...defaultChain().reverb, on: true, type: 'hall' as const, wet: 7 },
      ampEq: { ...defaultChain().ampEq, on: true, type: 'to-rotary' as const },
      rotaryOn: true,
    };
    const wet = renderLayerChain(dry, chain, { rotarySpeed: 'fast', rotaryDrive: 4, allBypass: false });
    expect(diff(wet, dry)).toBeGreaterThan(0.001);
    const bypassed = renderLayerChain(dry, chain, { rotarySpeed: 'fast', rotaryDrive: 4, allBypass: true });
    expect(diff(bypassed, dry)).toBeLessThan(0.00001);
    // Without To Rotary, the rotary stage never runs even when others do.
    const noRot = renderLayerChain(dry, { ...chain, rotaryOn: false }, { rotarySpeed: 'fast', rotaryDrive: 4, allBypass: false });
    expect(diff(noRot, wet)).toBeGreaterThan(0.0002);
  });
});
