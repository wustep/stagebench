/**
 * Phase 2 offline renderer: pure, deterministic Float32Array DSP that mirrors
 * the live graph's parameter semantics (same order, same control meanings).
 *
 * Tests prove every piano/effect control measurably changes rendered audio by
 * comparing these buffers — no browser, no audio output. Roughly 80% of the
 * Phase 2 audio test rules run through this module; the remaining 20% assert
 * live-graph wiring (node types, connections, cleanup) on `StageFakeContext`.
 */

import { midiToFrequency, rms as baseRms, tailLength as baseTailLength } from './dsp';
import { nearestRoot, velocityLayer, type DecodedSample } from './samples';
import { octaveSemitones, type LayerId, type LayerPianoState } from './pianoTypes';
import type { ChainState, FocusState, Mod1Type, Mod2Type } from '../state/fxTypes';

export { baseRms as rms, baseTailLength as tailLength };

export const RENDER_SR = 44100;

/** Deterministic LCG in [-1, 1]. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return s / 0x3fffffff - 1;
  };
}

function resampleNearest(data: Float32Array, ratio: number, outLen: number): Float32Array {
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i += 1) {
    const src = Math.min(data.length - 1, Math.max(0, Math.floor(i * ratio)));
    out[i] = data[src];
  }
  return out;
}

function gainOf(buf: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < buf.length; i += 1) {
    const a = Math.abs(buf[i]);
    if (a > peak) peak = a;
  }
  return peak || 1;
}

/** KB Touch curve → velocity shaping multiplier (audible gain mapping). */
export function touchGain(velocity: number, touch: LayerPianoState['kbTouch']): number {
  const v = Math.min(127, Math.max(1, velocity)) / 127;
  if (touch === 'Heavy') return 0.12 + 0.88 * Math.pow(v, 2.2); // needs force
  if (touch === 'Light') return 0.12 + 0.88 * Math.pow(v, 0.85); // easy to bark
  return 0.12 + 0.88 * Math.pow(v, 1.5); // Medium
}

/** Dyn Comp: raise soft strokes toward the loud end (narrow range). */
export function dynCompGain(raw: number, amount: number): number {
  if (amount <= 0) return raw;
  const lift = [0, 0.22, 0.42, 0.62][Math.min(3, amount)];
  return raw + (1 - raw) * lift * (1 - raw * 0.35);
}

export interface SynthVoiceSpec {
  kind: 'clav' | 'digital' | 'misc';
}

/** Honest-synthesis voice recipes (Clav/Digital/Misc). */
export function renderSynthVoice(midi: number, velocity: number, kind: SynthVoiceSpec['kind'], sr = RENDER_SR): Float32Array {
  const len = Math.floor(sr * 1.6);
  const out = new Float32Array(len);
  const f = midiToFrequency(midi);
  const g = 0.12 + 0.88 * Math.pow(Math.min(127, Math.max(1, velocity)) / 127, 1.5);
  const attack = Math.floor(sr * 0.002);
  const rand = lcg(midi * 911 + velocity * 17 + kind.length * 131);
  if (kind === 'clav') {
    // Picked string: bright square-ish stack + pick snap, very short decay.
    for (const [ratio, amp, mult] of [[1, 1, 1], [2, 0.7, 1.4], [3, 0.5, 1.9], [4.3, 0.3, 2.6]] as const) {
      const decay = 9 * mult;
      for (let i = 0; i < len; i += 1) {
        const t = i / sr;
        const ramp = i < attack ? i / attack : 1;
        const sq = Math.sign(Math.sin(2 * Math.PI * f * ratio * t)) * 0.6 + Math.sin(2 * Math.PI * f * ratio * t) * 0.4;
        out[i] += g * amp * Math.exp(-t * decay) * ramp * sq;
      }
    }
    for (let i = 0; i < Math.min(len, Math.floor(sr * 0.008)); i += 1) {
      out[i] += g * 0.35 * rand() * Math.exp(-i / (sr * 0.002));
    }
  } else if (kind === 'digital') {
    // Layered-digital: two detuned saws-ish stacks + bell partial, med decay.
    for (const [ratio, amp, mult] of [[1, 1, 1], [1.004, 0.6, 1.1], [2, 0.5, 1.6], [2.997, 0.28, 2.4], [4.2, 0.12, 3.4]] as const) {
      const decay = 3.4 * mult;
      for (let i = 0; i < len; i += 1) {
        const t = i / sr;
        const ramp = i < attack ? i / attack : 1;
        out[i] += g * amp * Math.exp(-t * decay) * ramp * Math.sin(2 * Math.PI * f * ratio * t);
      }
    }
  } else {
    // Marimba/mallet: near-sine + strong 4th partial, fast high decay.
    for (const [ratio, amp, mult] of [[1, 1, 1], [3.98, 0.32, 3.2], [9.2, 0.06, 9.0]] as const) {
      const decay = 5.2 * mult;
      for (let i = 0; i < len; i += 1) {
        const t = i / sr;
        const ramp = i < attack ? i / attack : 1;
        out[i] += g * amp * Math.exp(-t * decay) * ramp * Math.sin(2 * Math.PI * f * ratio * t);
      }
    }
    for (let i = 0; i < Math.min(len, Math.floor(sr * 0.006)); i += 1) {
      out[i] += g * 0.22 * Math.abs(rand()) * Math.exp(-i / (sr * 0.0015));
    }
  }
  return out;
}

/**
 * Render one sampled voice offline: nearest root × velocity layer,
 * pitch-shifted, touch/dyn-shaped. Falls back to a labeled synth voice when
 * the asset is missing (mirrors the live engine's fallback path).
 */
export function renderSampledVoice(
  midi: number,
  velocity: number,
  setId: 'grand' | 'upright' | 'electric',
  buffers: Map<string, DecodedSample>,
  piano: LayerPianoState,
  sr = RENDER_SR,
): { data: Float32Array; fallback: boolean; shiftSt: number } {
  const { root, shiftSt } = nearestRoot(midi + octaveSemitones(piano.octave));
  const layer = velocityLayer(velocity);
  const key = `${setId}.${root}.${layer.id}`;
  const entry = buffers.get(key);
  const raw = touchGain(velocity, piano.kbTouch);
  const shaped = dynCompGain(raw, piano.dynComp);
  const fallbackKind = setId === 'electric' ? 'clav' : 'digital';
  if (!entry) {
    const synth = renderSynthVoice(midi, velocity, fallbackKind, sr);
    const k = (shaped / gainOf(synth)) * 0.5;
    for (let i = 0; i < synth.length; i += 1) synth[i] *= k;
    return { data: synth, fallback: true, shiftSt };
  }
  const ratio = Math.pow(2, shiftSt / 12);
  const outLen = Math.max(1, Math.floor(entry.data.length / ratio));
  const shifted = resampleNearest(entry.data, ratio, outLen);
  const k = (shaped / gainOf(shifted)) * 0.85;
  // Soft release: slightly longer, less pronounced release — crossfade the
  // last 35% toward a gentler slope (less abrupt tail cutoff).
  const data = shifted;
  for (let i = 0; i < data.length; i += 1) data[i] *= k;
  if (piano.softRelease) {
    const start = Math.floor(data.length * 0.65);
    const span = Math.max(1, data.length - start);
    const dry = Float32Array.from(data.subarray(start));
    let y = dry[0] ?? 0;
    const a = 1 / (1 + sr * 0.004);
    for (let i = 0; i < dry.length; i += 1) {
      y += a * (dry[i] - y);
      const t = i / span;
      data[start + i] = dry[i] * (1 - t * 0.35) + y * t * 0.35;
    }
  }
  return { data, fallback: false, shiftSt };
}

/** Timbre EQ (3-band approximations matching the live graph). */
export function applyTimbre(data: Float32Array, timbre: LayerPianoState['timbre'], sr = RENDER_SR): Float32Array {
  if (timbre === 'Off') return data;
  const out = Float32Array.from(data);
  // One-pole helpers.
  const lowpass = (cut: number) => {
    const rc = 1 / (2 * Math.PI * cut);
    const dt = 1 / sr;
    const a = dt / (rc + dt);
    let y = 0;
    for (let i = 0; i < out.length; i += 1) {
      y += a * (out[i] - y);
      out[i] = y;
    }
  };
  const highpass = (cut: number) => {
    const rc = 1 / (2 * Math.PI * cut);
    const dt = 1 / sr;
    const a = rc / (rc + dt);
    let y = 0;
    let xPrev = 0;
    for (let i = 0; i < out.length; i += 1) {
      const x = out[i];
      y = a * (y + x - xPrev);
      xPrev = x;
      out[i] = y;
    }
  };
  if (timbre === 'Soft') {
    const dry = Float32Array.from(out);
    lowpass(2400);
    for (let i = 0; i < out.length; i += 1) out[i] = dry[i] * 0.35 + out[i] * 0.65;
  } else if (timbre === 'Mid') {
    const dry = Float32Array.from(out);
    highpass(500);
    const lp = Float32Array.from(out);
    // band-ish: hp then lp
    for (let i = 0; i < out.length; i += 1) out[i] = lp[i];
    void dry;
    lowpass(5200);
    for (let i = 0; i < out.length; i += 1) out[i] = dry[i] * 0.25 + out[i] * 0.95;
  } else if (timbre === 'Bright') {
    const dry = Float32Array.from(out);
    highpass(1800);
    for (let i = 0; i < out.length; i += 1) out[i] = dry[i] + out[i] * 0.55;
  } else if (timbre === 'Dyno 1') {
    const dry = Float32Array.from(out);
    highpass(900);
    for (let i = 0; i < out.length; i += 1) out[i] = dry[i] * 0.9 + out[i] * 0.5;
    // gentle drive
    for (let i = 0; i < out.length; i += 1) out[i] = Math.tanh(out[i] * 1.6) * 0.8;
  } else if (timbre === 'Dyno 2') {
    const dry = Float32Array.from(out);
    highpass(500);
    for (let i = 0; i < out.length; i += 1) out[i] = dry[i] * 0.85 + out[i] * 0.65;
    for (let i = 0; i < out.length; i += 1) out[i] = Math.tanh(out[i] * 2.4) * 0.75;
  }
  return out;
}

/** String resonance: sympathetic wash while other notes/pedal are held. */
export function applyStringRes(
  data: Float32Array,
  held: boolean,
  sr = RENDER_SR,
): Float32Array {
  if (!held) return data;
  const out = Float32Array.from(data);
  // Comb wash: three short delays mixed back in (simulation, spec-allowed).
  for (const [ms, g] of [[31, 0.18], [47, 0.13], [73, 0.09]] as const) {
    const d = Math.floor((sr * ms) / 1000);
    for (let i = d; i < out.length; i += 1) out[i] += data[i - d] * g;
  }
  return out;
}

/** Unison: detuned stereo-ish copies folded to mono (off/1/2/3). */
export function applyUnison(data: Float32Array, level: number, _sr = RENDER_SR): Float32Array {
  void _sr;
  if (level <= 0) return data;
  const copies = Math.min(3, level);
  const out = Float32Array.from(data);
  const cents = [4, 8, 13];
  for (let c = 0; c < copies; c += 1) {
    const ratio = Math.pow(2, cents[c] / 1200);
    const shifted = resampleNearest(data, ratio, data.length);
    const k = 0.4 - c * 0.08;
    for (let i = 0; i < out.length; i += 1) out[i] += shifted[i] * k;
  }
  return out;
}

// --- Effect units (offline mirrors; same parameter semantics as live) ---

export interface OfflineFxParams {
  chain: ChainState;
  focus: FocusState;
  layer: LayerId;
  pianoGroup: boolean;
}

export function resolveChain(params: OfflineFxParams): ChainState {
  return params.chain;
}

function lfo(sr: number, len: number, rate: number): Float32Array {
  const out = new Float32Array(len);
  for (let i = 0; i < len; i += 1) out[i] = Math.sin((2 * Math.PI * rate * i) / sr);
  return out;
}

export function applyMod1(data: Float32Array, type: Mod1Type, rate: number, amount: number, sr = RENDER_SR): Float32Array {
  if (amount <= 0) return data;
  const out = Float32Array.from(data);
  const depth = amount / 10;
  if (type === 'off') return data;
  if (type === 'tremolo') {
    const m = lfo(sr, out.length, rate);
    for (let i = 0; i < out.length; i += 1) out[i] *= 1 - depth * 0.85 * (0.5 + 0.5 * m[i]);
  } else if (type === 'a-pan') {
    const m = lfo(sr, out.length, rate);
    for (let i = 0; i < out.length; i += 1) out[i] *= 1 - depth * 0.3 * m[i];
  } else if (type === 'ring-mod') {
    for (let i = 0; i < out.length; i += 1) {
      out[i] *= (1 - depth) + depth * Math.sin((2 * Math.PI * (40 + rate * 8) * i) / sr);
    }
  } else if (type === 'wah') {
    const m = lfo(sr, out.length, rate);
    const rc = (i: number) => 1 / (2 * Math.PI * (400 + (2600 * (0.5 + 0.5 * m[i]) * depth + 200)));
    void rc;
    const dt = 1 / sr;
    let y = 0;
    for (let i = 0; i < out.length; i += 1) {
      const cut = 400 + 2800 * (0.5 + 0.5 * m[i]) * depth;
      const a = dt / (1 / (2 * Math.PI * cut) + dt);
      y += a * (out[i] - y);
      out[i] = out[i] * (1 - depth * 0.5) + (out[i] - y) * depth * 0.9;
    }
  } else if (type === 'a-wah') {
    // Envelope follower: bright attacks open the filter.
    let env = 0;
    let y = 0;
    const dt = 1 / sr;
    const sens = 0.5 + rate / 10;
    for (let i = 0; i < out.length; i += 1) {
      env += 0.01 * sens * (Math.abs(data[i]) - env);
      const cut = 500 + 3500 * Math.min(1, env * 4) * depth;
      const a = dt / (1 / (2 * Math.PI * cut) + dt);
      y += a * (out[i] - y);
      out[i] = out[i] * (1 - depth * 0.4) + (out[i] - y) * depth;
    }
  } else if (type === 'pump') {
    const m = lfo(sr, out.length, rate);
    for (let i = 0; i < out.length; i += 1) {
      const duck = Math.pow(0.5 + 0.5 * m[i], 2);
      out[i] *= 1 - depth * 0.9 * duck;
    }
  }
  return out;
}

export function applyMod2(data: Float32Array, type: Mod2Type, rate: number, amount: number, sr = RENDER_SR): Float32Array {
  if (amount <= 0) return data;
  const out = Float32Array.from(data);
  const depth = amount / 10;
  if (type === 'off') return data;
  const modDelay = (baseMs: number, depthMs: number, fb: number, extraTaps = 0) => {
    const m = lfo(sr, out.length, rate);
    const src = Float32Array.from(out);
    const wet = new Float32Array(out.length);
    for (let i = 0; i < out.length; i += 1) {
      const dMs = baseMs + depthMs * (0.5 + 0.5 * m[i]) * depth;
      const d = Math.min(i, Math.floor((sr * dMs) / 1000));
      wet[i] = src[i - d] ?? 0;
    }
    for (let i = 0; i < out.length; i += 1) out[i] = src[i] * (1 - 0.45 * depth) + wet[i] * (0.45 * depth + fb * depth * 0.3);
    if (extraTaps > 0) {
      for (let i = 0; i < out.length; i += 1) {
        const d2 = Math.min(i, Math.floor((sr * (baseMs * 1.7 + 1)) / 1000));
        out[i] += src[i - d2] * 0.2 * depth;
      }
    }
    void fb;
  };
  if (type === 'chorus') {
    modDelay(14, 9, 0.1, amount > 6 ? 1 : 0);
  } else if (type === 'flanger') {
    modDelay(3, 4, 0.55);
  } else if (type === 'phaser') {
    // All-pass-ish sweep approximated with modulated notch mixing.
    const m = lfo(sr, out.length, rate);
    const src = Float32Array.from(out);
    let y = 0;
    for (let i = 0; i < out.length; i += 1) {
      const cut = 600 + 3200 * (0.5 + 0.5 * m[i]);
      const rc = 1 / (2 * Math.PI * cut);
      const dt = 1 / sr;
      const a = dt / (rc + dt);
      y += a * (src[i] - y);
      out[i] = src[i] * (1 - depth * 0.6) + (src[i] - y * 2) * depth * 0.6;
    }
  } else if (type === 'vibe') {
    const m = lfo(sr, out.length, rate);
    const src = Float32Array.from(out);
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < out.length; i += 1) {
      const wob = 1 + depth * 0.02 * m[i];
      y1 += 0.2 * (src[i] * wob - y1);
      y2 += 0.12 * (y1 - y2);
      out[i] = src[i] * (1 - depth * 0.5) + (y1 - y2) * depth * 1.4;
    }
  } else if (type === 'ensemble') {
    const m = lfo(sr, out.length, rate);
    const src = Float32Array.from(out);
    for (const [base, ph] of [[11, 0], [17, 2.1], [23, 4.2]] as const) {
      for (let i = 0; i < out.length; i += 1) {
        const dMs = base + 6 * (0.5 + 0.5 * Math.sin((2 * Math.PI * rate * i) / sr + ph)) * depth;
        const d = Math.min(i, Math.floor((sr * dMs) / 1000));
        out[i] += (src[i - d] ?? 0) * 0.16 * depth;
      }
    }
    void m;
  } else if (type === 'spin') {
    // Gentle rotary-like shimmer: slow tremolo + short modulated delay.
    const m = lfo(sr, out.length, rate);
    const src = Float32Array.from(out);
    for (let i = 0; i < out.length; i += 1) {
      const d = Math.min(i, Math.floor((sr * (6 + 3 * (0.5 + 0.5 * m[i]))) / 1000));
      out[i] = src[i] * (1 - 0.3 * depth) + (src[i - d] ?? 0) * 0.3 * depth;
      out[i] *= 1 - depth * 0.15 * m[i];
    }
  }
  return out;
}

export type DelayFilter = 'off' | 'lp' | 'hp' | 'bp';

function filterRepeat(buf: Float32Array, kind: DelayFilter, sr: number): Float32Array {
  if (kind === 'off') return buf;
  const out = Float32Array.from(buf);
  let y = 0;
  let xPrev = 0;
  const lpCut = 2200;
  const hpCut = 900;
  const aLp = 1 / sr / (1 / (2 * Math.PI * lpCut) + 1 / sr);
  const rcHp = 1 / (2 * Math.PI * hpCut);
  const aHp = rcHp / (rcHp + 1 / sr);
  let yh = 0;
  for (let i = 0; i < out.length; i += 1) {
    const x = out[i];
    if (kind === 'lp') {
      y += aLp * (x - y);
      out[i] = y;
    } else if (kind === 'hp') {
      yh = aHp * (yh + x - xPrev);
      xPrev = x;
      out[i] = yh;
    } else {
      y += aLp * (x - y);
      const lp = y;
      yh = aHp * (yh + x - xPrev);
      xPrev = x;
      out[i] = (lp + yh) * 0.6;
    }
  }
  return out;
}

/** Delay with feedback loop; each repeat passes through the filter again. */
export function applyDelay(
  data: Float32Array,
  ms: number,
  feedback: number,
  wet: number,
  filter: DelayFilter,
  sr = RENDER_SR,
): Float32Array {
  const out: Float32Array = Float32Array.from(data);
  if (wet <= 0) return out;
  const d = Math.max(1, Math.floor((sr * ms) / 1000));
  const wetGain = wet / 10;
  const fb = Math.min(0.85, Math.max(0, feedback / 10));
  let repeat: Float32Array = new Float32Array(out.length);
  for (let i = 0; i < out.length; i += 1) repeat[i] = i >= d ? data[i - d] : 0;
  // Up to 6 regenerations; the filter processes the REPEATS (loop), progressively.
  let regen: Float32Array = repeat;
  for (let r = 0; r < 6; r += 1) {
    regen = filterRepeat(regen, filter, sr);
    const k = Math.pow(fb, r);
    if (k < 0.01) break;
    for (let i = 0; i < out.length; i += 1) out[i] += regen[i] * wetGain * k;
    const next: Float32Array = new Float32Array(out.length);
    for (let i = 0; i < out.length; i += 1) next[i] = i >= d ? regen[i - d] : 0;
    regen = next;
  }
  return out;
}

export function driveCurve(x: number, drive: number): number {
  const k = 1 + (drive / 10) * 6;
  return Math.tanh(x * k) / Math.tanh(k * 0.35) * 0.35;
}

export function applyAmpEq(
  data: Float32Array,
  amp: ChainState['ampEq'],
  sr = RENDER_SR,
): Float32Array {
  const out = Float32Array.from(data);
  if (amp.type === 'to-rotary') return out; // routing only; processed downstream
  if (amp.type !== 'eq') {
    for (let i = 0; i < out.length; i += 1) out[i] = driveCurve(out[i], amp.drive);
    if (amp.type === 'twin') {
      // Scooped mids, sparkling top: soften 400–2k, lift highs.
      const dry = Float32Array.from(out);
      let y = 0;
      const a = 1 / sr / (1 / (2 * Math.PI * 3200) + 1 / sr);
      for (let i = 0; i < out.length; i += 1) {
        y += a * (out[i] - y);
        out[i] = dry[i] * 0.55 + (dry[i] - (dry[i] - y) * 0.4) * 0.3 + (dry[i] - y) * 0.35;
      }
    } else if (amp.type === 'jc') {
      // Flat, clean, tight: mild highpass + transparent.
      let yh = 0;
      let xp = 0;
      const rc = 1 / (2 * Math.PI * 120);
      const a = rc / (rc + 1 / sr);
      for (let i = 0; i < out.length; i += 1) {
        const x = out[i];
        yh = a * (yh + x - xp);
        xp = x;
        out[i] = yh * 1.05;
      }
    } else if (amp.type === 'small') {
      // Boxy small cab: band-limited, early breakup feel.
      let y = 0;
      const a = 1 / sr / (1 / (2 * Math.PI * 1800) + 1 / sr);
      const dry = Float32Array.from(out);
      for (let i = 0; i < out.length; i += 1) {
        y += a * (out[i] - y);
        out[i] = (dry[i] * 0.4 + y * 0.6) * 1.1;
      }
    } else if (amp.type === 'lp24') {
      // Resonant lowpass: cutoff = freq, gain = resonance.
      const cut = amp.freq;
      const res = 1 + (amp.mid / 15) * 8;
      let y1 = 0;
      let y2 = 0;
      const a = 1 / sr / (1 / (2 * Math.PI * cut) + 1 / sr);
      for (let i = 0; i < out.length; i += 1) {
        y1 += a * (out[i] - y1);
        y2 += a * (y1 - y2);
        out[i] = y2 * res * 0.5 + out[i] * 0.08;
      }
    } else if (amp.type === 'hp24') {
      const cut = amp.freq;
      let y1 = 0;
      let y2 = 0;
      const dt = 1 / sr;
      const a = dt / (1 / (2 * Math.PI * cut) + dt);
      for (let i = 0; i < out.length; i += 1) {
        const lp1 = (y1 += a * (out[i] - y1));
        const lp2 = (y2 += a * (lp1 - y2));
        out[i] = (out[i] - lp2) * 0.9;
      }
    }
  }
  // 3-band EQ: bass 100 Hz shelf, treble 4 kHz shelf, mid peak (freq knob).
  const bassK = amp.bass / 15;
  const trebK = amp.treble / 15;
  const midK = amp.mid / 15;
  void midK;
  if (Math.abs(bassK) > 0.001 || Math.abs(trebK) > 0.001) {
    // Bass shelf via lowpass blend.
    let y = 0;
    const a = 1 / sr / (1 / (2 * Math.PI * 100) + 1 / sr);
    for (let i = 0; i < out.length; i += 1) {
      y += a * (out[i] - y);
      out[i] = out[i] + y * bassK * 1.4;
    }
    // Treble shelf via highpass blend.
    let yh = 0;
    let xp = 0;
    const rc = 1 / (2 * Math.PI * 4000);
    const ah = rc / (rc + 1 / sr);
    for (let i = 0; i < out.length; i += 1) {
      const x = out[i];
      yh = ah * (yh + x - xp);
      xp = x;
      out[i] = out[i] + yh * trebK * 1.4;
    }
  }
  return out;
}

/** Compressor: static-curve gain reduction; fast mode pumps harder. */
export function applyComp(data: Float32Array, amount: number, fast: boolean): Float32Array {
  if (amount <= 0) return data;
  const out = Float32Array.from(data);
  const depth = amount / 10;
  const ratio = 1 + depth * 9;
  const thresh = 0.5 - depth * 0.3;
  let env = 0;
  const attack = fast ? 0.02 : 0.08;
  const release = fast ? 0.12 : 0.3;
  for (let i = 0; i < out.length; i += 1) {
    const a = Math.abs(out[i]);
    env += (a > env ? attack : release) * (a - env);
    const over = Math.max(0, env - thresh);
    const gr = over > 0 ? thresh + over / ratio - over : 0;
    const target = env > 0.0001 ? (env + gr) / env : 1;
    out[i] *= 1 + (target - 1) * depth;
  }
  // Makeup: hotter with amount.
  const makeup = 1 + depth * (fast ? 0.5 : 0.35);
  for (let i = 0; i < out.length; i += 1) out[i] *= makeup;
  return out;
}

function expDecayIr(sr: number, seconds: number, seed: number, bright: boolean): Float32Array {
  const len = Math.max(16, Math.floor(sr * seconds));
  const out = new Float32Array(len);
  const rand = lcg(seed);
  let y = 0;
  const dark = bright ? 0.12 : 0.3;
  for (let i = 0; i < len; i += 1) {
    const x = rand();
    y += (1 - (1 - dark)) * (x - y);
    const t = i / sr;
    out[i] = y * Math.exp(-t * (4.2 / seconds)) * 0.6;
  }
  // Spring: periodic boing — resonant sine bursts at 90/140 Hz.
  return out;
}

function springIr(sr: number, seconds: number, seed: number): Float32Array {
  const base = expDecayIr(sr, seconds, seed, true);
  for (let i = 0; i < base.length; i += 1) {
    const t = i / sr;
    base[i] += 0.35 * Math.exp(-t * 9) * Math.sin(2 * Math.PI * 92 * t) * Math.exp(-t * 2);
    base[i] += 0.2 * Math.exp(-t * 11) * Math.sin(2 * Math.PI * 147 * t + 1) * Math.exp(-t * 2);
  }
  return base;
}

export const REVERB_DECAYS: Record<string, number> = {
  room: 0.5,
  booth: 0.18,
  spring: 0.7,
  stage: 1.2,
  hall: 2.4,
  cathedral: 4.2,
};

export function reverbIr(kind: keyof typeof REVERB_DECAYS, bright: boolean, sr = RENDER_SR): Float32Array {
  const seconds = REVERB_DECAYS[kind];
  const seed = 7000 + kind.length * 977;
  if (kind === 'spring') return springIr(sr, Math.min(seconds, 1.5), seed);
  return expDecayIr(sr, seconds, seed, bright);
}

/** Convolve (truncated) + dry/wet mix; fully wet at max. */
export function applyReverb(
  data: Float32Array,
  kind: keyof typeof REVERB_DECAYS,
  wet: number,
  bright: boolean,
  sr = RENDER_SR,
): Float32Array {
  const out = Float32Array.from(data);
  if (wet <= 0) return out;
  const ir = reverbIr(kind, bright, sr);
  const wetGain = wet / 10;
  const stride = kind === 'cathedral' || kind === 'hall' ? 4 : 2;
  const tap = Math.min(ir.length, Math.floor(sr * 0.6));
  for (let i = 0; i < out.length; i += 1) {
    let acc = 0;
    for (let j = 0; j < tap; j += stride) {
      if (i - j < 0) break;
      acc += data[i - j] * ir[j];
    }
    out[i] = data[i] * (1 - wetGain * 0.85) + acc * wetGain * 0.5;
  }
  return out;
}

/** Rotary shimmer: slow/fast tremolo + widening; stop freezes at unity. */
export function applyRotary(data: Float32Array, speed: 'slow' | 'fast' | 'stop', drive: number, sr = RENDER_SR): Float32Array {
  if (speed === 'stop') return data;
  const out = Float32Array.from(data);
  const rate = speed === 'fast' ? 6.4 : 0.8;
  const m = lfo(sr, out.length, rate);
  for (let i = 0; i < out.length; i += 1) {
    const trem = 1 - 0.22 * (0.5 + 0.5 * m[i]);
    out[i] = driveCurve(out[i], drive * 0.6) * trem + out[i] * 0.25;
  }
  return out;
}

/** Full per-layer chain in the documented signal order. */
export function renderLayerChain(
  dry: Float32Array,
  chain: ChainState,
  opts: { rotarySpeed: 'slow' | 'fast' | 'stop'; rotaryDrive: number; allBypass: boolean; sr?: number },
): Float32Array {
  const sr = opts.sr ?? RENDER_SR;
  if (opts.allBypass) return dry;
  let out = dry;
  const apply = <T>(on: boolean, fn: (d: Float32Array) => T): Float32Array => (on ? (fn(out) as unknown as Float32Array) : out);
  out = apply(chain.mod1.on, (d) => applyMod1(d, chain.mod1.type, chain.mod1.rate, chain.mod1.amount, sr));
  out = apply(chain.mod2.on, (d) => applyMod2(d, chain.mod2.type, chain.mod2.rate, chain.mod2.amount, sr));
  out = apply(chain.delay.on, (d) =>
    applyDelay(d, chain.delay.timeMs, chain.delay.feedback, chain.delay.wet, chain.delay.filter, sr),
  );
  out = apply(chain.ampEq.on, (d) => applyAmpEq(d, chain.ampEq, sr));
  out = apply(chain.comp.on, (d) => applyComp(d, chain.comp.amount, chain.comp.fast));
  out = apply(chain.reverb.on, (d) => applyReverb(d, chain.reverb.type, chain.reverb.wet, chain.reverb.bright, sr));
  if (chain.ampEq.type === 'to-rotary' && chain.rotaryOn) {
    out = applyRotary(out, opts.rotarySpeed, opts.rotaryDrive, sr);
  }
  return out;
}
