/**
 * Phase 3 offline synth renderer: pure, deterministic Float32Array DSP
 * covering the required waveform list with category-correct Osc Ctrl, the
 * four filters with tracking/resonance/drive, ADR envelopes, the 5-wave LFO,
 * and voice/arp helpers. Mirrors the live synth voice semantics so tests
 * cross the audio boundary without audio output.
 */

import { midiToFrequency } from './dsp';
import { RENDER_SR } from './render';
import {
  envSeconds,
  isSustainMode,
  oscCtrlKind,
  trackingRatio,
  type AdrEnvelope,
  type FilterTracking,
  type LfoWave,
  type SynthFilterType,
  type SynthLayerState,
} from './synthTypes';

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return s / 0x3fffffff - 1;
  };
}

// --- Oscillators ---------------------------------------------------------------

function square(ph: number, width: number): number {
  const p = ((ph / (2 * Math.PI)) % 1 + 1) % 1;
  return p < width ? 1 : -1;
}

function saw(ph: number): number {
  const p = ((ph / (2 * Math.PI)) % 1 + 1) % 1;
  return p * 2 - 1;
}

/**
 * Render one raw oscillator cycle buffer for a wave at frequency f.
 * Osc Ctrl behaves per category (manual pp. 29-30); Pure ignores it.
 */
export function renderOscWave(
  wave: string,
  f: number,
  oscCtrl: number,
  len: number,
  sr = RENDER_SR,
  seed = 1,
): Float32Array {
  const out = new Float32Array(len);
  const ctrl = Math.min(10, Math.max(0, oscCtrl)) / 10;
  const kind = oscCtrlKind(wave);
  const rand = lcg(seed);
  const noiseBuf = kind === 'none' && wave === 'White Noise' ? Array.from({ length: len }, () => rand()) : null;
  for (let i = 0; i < len; i += 1) {
    const t = i / sr;
    const ph = 2 * Math.PI * f * t;
    let s = 0;
    switch (wave) {
      case 'Sine': s = Math.sin(ph); break;
      case 'Triangle': s = (2 / Math.PI) * Math.asin(Math.sin(ph)); break;
      case 'Saw': s = saw(ph); break;
      case 'Square': s = Math.sign(Math.sin(ph)); break;
      case 'Pulse 33': s = square(ph, 0.33); break;
      case 'Pulse 10': s = square(ph, 0.1); break;
      case 'White Noise': s = noiseBuf![i]; break;
      case 'Sync Saw':
      case 'Sync Square': {
        // Oscillator sync: slave restarts on the master; relative pitch from
        // Osc Ctrl (1..8x) changes the perceived timbre dramatically.
        const ratio = 1 + ctrl * 7;
        const master = (f * t) % 1;
        const slavePh = 2 * Math.PI * f * ratio * t;
        const wrapped = slavePh % (2 * Math.PI);
        const edge = master < 1 / (f * (i >= 0 ? 1 : 1)) ? 0 : 0;
        void edge;
        s = wave === 'Sync Saw' ? (wrapped / Math.PI - 1) : Math.sign(Math.sin(wrapped));
        // Reset click each master cycle: scale by intra-cycle position.
        s *= 0.4 + 0.6 * master;
        break;
      }
      case 'Multi Saw':
      case 'Multi Saw 8ve': {
        // Two saws: same pitch (or octave apart) with Osc-Ctrl detune.
        const det = 1 + ctrl * 0.02;
        const f2 = wave === 'Multi Saw 8ve' ? f * 2 : f * det;
        s = 0.6 * saw(ph) + 0.6 * saw(2 * Math.PI * f2 * t);
        break;
      }
      case 'Super Saw':
      case 'Super Square': {
        // Stack of 5 detuned oscillators; Osc Ctrl = detune/width.
        const det = ctrl * 0.03;
        s = 0;
        for (let k = -2; k <= 2; k += 1) {
          const fk = f * (1 + k * det);
          const p = 2 * Math.PI * fk * t;
          s += (wave === 'Super Saw' ? saw(p) : Math.sign(Math.sin(p))) * 0.28;
        }
        break;
      }
      case 'FM 2-op (algorithm A)': {
        // 2-op FM, harmonic ratio 1:1; Osc Ctrl = FM amount.
        const mod = Math.sin(ph) * ctrl * 6;
        s = Math.sin(ph + mod);
        break;
      }
      default: s = saw(ph);
    }
    out[i] = s;
  }
  return out;
}

// --- Filters -------------------------------------------------------------------

/** UI 0..10 → cutoff Hz (20..12000, exponential). */
export function cutoffHz(v: number): number {
  const c = Math.min(10, Math.max(0, v)) / 10;
  return 20 * Math.pow(12000 / 20, c);
}

/** Cutoff with keyboard tracking from the played note. */
export function trackedCutoff(base: number, midi: number, ref: number, tracking: FilterTracking): number {
  const r = trackingRatio(tracking);
  return base * Math.pow(2, ((midi - ref) * r) / 12);
}

function driveSample(x: number, drive: number): number {
  if (drive <= 0) return x;
  const k = 1 + (drive / 3) * 5;
  return Math.tanh(x * k) / Math.tanh(k * 0.4) * 0.4;
}

/** Resonant lowpass (2-pole LP12 / 4-pole LP24 approximation). */
function resonantLowpass(data: Float32Array, cut: number, res: number, poles: 2 | 4, sr: number): Float32Array {
  const out = Float32Array.from(data);
  const q = 1 + (Math.min(10, Math.max(0, res)) / 10) * 9;
  const stages = poles === 4 ? 2 : 1;
  for (let s = 0; s < stages; s += 1) {
    let y = 0;
    const a = 1 / sr / (1 / (2 * Math.PI * Math.min(sr / 2.2, Math.max(20, cut))) + 1 / sr);
    for (let i = 0; i < out.length; i += 1) {
      y += a * (out[i] - y);
      // Resonance emphasis: feed a resonant peak around cutoff.
      out[i] = y * (1 + (q - 1) * 0.18) + (out[i] - y) * ((q - 1) * 0.05);
    }
  }
  return out;
}

function highpass(data: Float32Array, cut: number, sr: number): Float32Array {
  const out = Float32Array.from(data);
  let y = 0;
  let xp = 0;
  const rc = 1 / (2 * Math.PI * Math.min(sr / 2.2, Math.max(20, cut)));
  const a = rc / (rc + 1 / sr);
  for (let i = 0; i < out.length; i += 1) {
    const x = out[i];
    y = a * (y + x - xp);
    xp = x;
    out[i] = y;
  }
  return out;
}

function bandpass(data: Float32Array, cut: number, res: number, sr: number): Float32Array {
  const lp = resonantLowpass(data, cut * 1.4, res, 2, sr);
  const hp = highpass(lp, cut / 1.4, sr);
  for (let i = 0; i < hp.length; i += 1) hp[i] *= 1.6;
  return hp;
}

export function applySynthFilter(
  data: Float32Array,
  type: SynthFilterType,
  cutoffUi: number,
  res: number,
  drive: number,
  midi: number,
  tracking: FilterTracking,
  sr = RENDER_SR,
): Float32Array {
  const cut = trackedCutoff(cutoffHz(cutoffUi), midi, 60, tracking);
  let out: Float32Array;
  if (type === 'LP12') out = resonantLowpass(data, cut, res, 2, sr);
  else if (type === 'LP24') out = resonantLowpass(data, cut, res, 4, sr);
  else if (type === 'HP') out = highpass(data, cut, sr);
  else out = bandpass(data, cut, res, sr);
  if (drive > 0) {
    for (let i = 0; i < out.length; i += 1) out[i] = driveSample(out[i], drive);
  }
  return out;
}

// --- Envelopes -------------------------------------------------------------------

/**
 * Evaluate an ADR envelope at time t (key held `holdT`, released at `relT`;
 * relT = Infinity while held). Decay at max = sustain mode (manual p. 33).
 */
export function adsrLevel(env: AdrEnvelope, t: number, holdT: number, relT: number, sustain: number): number {
  const atk = envSeconds(env.attack);
  const dec = envSeconds(env.decay);
  const rel = envSeconds(env.release);
  const susMode = isSustainMode(env.decay);
  const held = t < relT ? t : relT;
  let level: number;
  if (held < atk) {
    level = atk <= 0 ? 1 : held / atk;
  } else if (susMode) {
    level = 1;
  } else {
    const dt = held - atk;
    level = dec <= 0 ? sustain : sustain + (1 - sustain) * Math.exp(-dt / (dec / 3));
    void holdT;
  }
  if (t >= relT) {
    const dt = t - relT;
    const start = level;
    level = rel <= 0 ? 0 : start * Math.exp(-dt / (rel / 3));
  }
  return Math.min(1, Math.max(0, level));
}

/** Gate envelope for Gate arp mode: hardness 0..1 (soft→hard on/off). */
export function gateLevel(t: number, period: number, hardness: number): number {
  const p = ((t % period) + period) % period;
  const duty = 0.85 - hardness * 0.6;
  const edge = 0.002 + (1 - hardness) * 0.03;
  const tNorm = p / period;
  if (tNorm < duty) return Math.min(1, tNorm / Math.max(0.001, edge / period));
  const dt = (tNorm - duty) / Math.max(0.001, edge / period);
  return Math.max(0, 1 - dt);
}

// --- LFO -------------------------------------------------------------------------

export function lfoSample(wave: LfoWave, phase: number, seedFn?: () => number): number {
  const p = ((phase % 1) + 1) % 1;
  switch (wave) {
    case 'Triangle': return p < 0.5 ? p * 4 - 1 : 3 - p * 4;
    case 'Saw down': return 1 - p * 2;
    case 'Saw up': return p * 2 - 1;
    case 'Square': return p < 0.5 ? 1 : -1;
    case 'Sample & Hold': {
      // Deterministic stepped random per cycle (seeded by caller context).
      const r = seedFn ? seedFn() : 0;
      void r;
      return Math.sin(p * 12.9898) * 43758.5453 % 1;
    }
  }
}

export function sampleHoldValue(step: number): number {
  const x = Math.sin(step * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

// --- Voice -------------------------------------------------------------------------

/** Full synth voice render (osc → filter/envs → amp), deterministic. */
export function renderSynthLayerVoice(
  midi: number,
  velocity: number,
  layer: SynthLayerState,
  opts: { seconds?: number; sr?: number; clockBpm?: number } = {},
): Float32Array {
  const sr = opts.sr ?? RENDER_SR;
  const seconds = opts.seconds ?? 1.6;
  const len = Math.floor(sr * seconds);
  const f = midiToFrequency(midi);
  const fineRatio = Math.pow(2, layer.fine / 1200);
  const coarseRatio = Math.pow(2, layer.coarse / 12);
  const osc = renderOscWave(layer.wave, f * fineRatio * coarseRatio, layer.oscCtrl, len, sr, midi * 31 + 7);
  // Unison extra detuned copies.
  const copies = Math.min(3, Math.max(0, layer.voice.unison));
  for (let c = 0; c < copies; c += 1) {
    const det = [1.004, 1.009, 0.994][c];
    const extra = renderOscWave(layer.wave, f * det * coarseRatio, layer.oscCtrl, len, sr, midi * 31 + 13 + c);
    const k = 0.5 - c * 0.08;
    for (let i = 0; i < len; i += 1) osc[i] += extra[i] * k;
  }
  // Filter stage: time-varying one-pole lowpass driven by the filter
  // envelope (cutoff sweeps with Env Amt), then static resonant character.
  const holdT = seconds;
  const envAmt = (layer.filterEnvAmt / 10) * 7;
  const baseCut = cutoffHz(layer.filterFreq);
  const swept = new Float32Array(len);
  let lpSweep = 0;
  for (let i = 0; i < len; i += 1) {
    const t = i / sr;
    const mod = adsrLevel(layer.filterEnv, t, holdT, Infinity, layer.ampSustain / 10);
    // Envelope opens the cutoff up to ~8x at full amount (audible sweep).
    const cut = Math.min(16000, Math.max(40, baseCut * (1 + mod * envAmt)));
    const a = 1 / sr / (1 / (2 * Math.PI * cut) + 1 / sr);
    lpSweep += a * (osc[i] - lpSweep);
    swept[i] = lpSweep;
  }
  // Static filter per type adds the resonant/drive character on top.
  const filtered = applySynthFilter(swept, layer.filterType, layer.filterFreq, layer.filterRes, layer.drive, midi, layer.tracking, sr);
  // LFO onto filter freq (post-filter wobble approximation) or pitch/ctrl.
  const lfoHz = lfoRateHz(layer, opts.clockBpm ?? 120);
  if (layer.lfoDest !== null && layer.lfoAmt > 0) {
    const depth = layer.lfoAmt / 10;
    const shRand = lcg(midi * 57 + 3);
    let prev = 0;
    for (let i = 0; i < len; i += 1) {
      const t = i / sr;
      let v: number;
      if (layer.lfoWave === 'Sample & Hold') {
        const step = Math.floor(t * lfoHz);
        v = sampleHoldValue(step + midi);
      } else {
        v = lfoSample(layer.lfoWave, t * lfoHz, shRand);
      }
      if (layer.lfoDest === 'Osc Pitch') {
        filtered[i] *= 1 + v * depth * 0.06;
      } else if (layer.lfoDest === 'Osc Ctrl') {
        filtered[i] += osc[i] * v * depth * 0.15;
      } else {
        // Filter Freq: amplitude wobble proportional to resonance-ish depth.
        filtered[i] *= 1 + v * depth * 0.25;
      }
      void prev;
    }
  }
  // Amp envelope + velocity.
  const vel = velocityAmp(velocity, layer.ampVel);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i += 1) {
    const t = i / sr;
    out[i] = filtered[i] * adsrLevel(layer.ampEnv, t, holdT, Infinity, layer.ampSustain / 10) * vel * 0.5;
  }
  return out;
}

function velocityAmp(velocity: number, level: number): number {
  if (level <= 0) return 1;
  const v = Math.min(127, Math.max(1, velocity)) / 127;
  const depth = [0, 0.4, 0.7, 1][Math.min(3, level)];
  return (1 - depth) + depth * v;
}

/** LFO rate in Hz: manual dial or clock subdivision (manual p. 34). */
export function lfoRateHz(layer: SynthLayerState, clockBpm: number): number {
  if (layer.lfoSync) {
    const quarters: Record<string, number> = { '1/2': 2, '1/4': 1, '1/8': 0.5, '1/8T': 1 / 3, '1/16': 0.25, '1/16T': 1 / 6 };
    const q = quarters[layer.lfoSubdiv] ?? 0.5;
    return clockBpm / 60 / q;
  }
  return 0.1 + (Math.min(10, Math.max(0, layer.lfoRate)) / 10) * 19.9;
}

// --- Arp ---------------------------------------------------------------------------

/**
 * Deterministic arp step order for a fixed note set (manual pp. 35-36).
 * Range adds octave transpositions; returns midis in play order.
 */
export function arpStepOrder(notes: number[], layer: SynthLayerState, steps: number, seed = 0): number[] {
  if (notes.length === 0) return [];
  const sorted = [...notes].sort((a, b) => a - b);
  const range = Math.min(4, Math.max(1, Math.round(layer.arp.range)));
  const pool: number[] = [];
  for (let o = 0; o < range; o += 1) {
    for (const n of sorted) pool.push(n + o * 12);
  }
  const dir = layer.arp.direction;
  let order: number[];
  if (dir === 'Up') order = pool;
  else if (dir === 'Down') order = [...pool].reverse();
  else if (dir === 'Up/Down') {
    order = pool.length > 1 ? [...pool, ...[...pool].reverse().slice(1, -1)] : pool;
  } else {
    // Random: deterministic LCG shuffle with the given seed.
    order = [...pool];
    let s = (seed * 1103515245 + 12345) >>> 0;
    const rnd = () => {
      s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rnd() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  }
  const out: number[] = [];
  for (let i = 0; i < steps; i += 1) out.push(order[i % order.length]);
  return out;
}

/** Arp rate knob → step period ms (unsynced: quarter-note BPM; plays 8ths). */
export function arpStepMs(layer: SynthLayerState, clockBpm: number): number {
  if (layer.arp.sync) {
    const quarters: Record<string, number> = { '1/2': 2, '1/4': 1, '1/8': 0.5, '1/8T': 1 / 3, '1/16': 0.25, '1/16T': 1 / 6 };
    const q = quarters[layer.arp.subdiv] ?? 0.5;
    return (60000 / clockBpm) * q;
  }
  const bpm = 40 + (Math.min(10, Math.max(0, layer.arp.rate)) / 10) * 200;
  return 60000 / bpm / 2; // 8th notes at the rate BPM
}

export type { AdrEnvelope };
