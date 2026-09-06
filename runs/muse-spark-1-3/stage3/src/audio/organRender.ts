/**
 * Phase 3 offline organ renderer: pure, deterministic Float32Array DSP with
 * four audibly distinct engines (B3 tonewheel, Vox transistor, Farfisa
 * transistor registers, Pipe flue). Mirrors the live organ voice semantics
 * (drawbars → spectrum, percussion, key click, vibrato/chorus) so tests cross
 * the audio boundary without audio output.
 */

import { midiToFrequency } from './dsp';
import { RENDER_SR } from './render';
import {
  B3_RATIOS,
  PIPE_RATIOS,
  VOX_RATIOS,
  type OrganLayerState,
  type OrganModelId,
  type VibChorusPos,
} from './organTypes';

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return s / 0x3fffffff - 1;
  };
}

/** Drawbar 0..8 → linear amplitude. */
export function drawbarGain(v: number): number {
  return Math.min(8, Math.max(0, v)) / 8;
}

function envTimes(perc: OrganLayerState['percussion']): { peak: number; decay: number } {
  return { peak: perc.soft ? 0.35 : 0.7, decay: perc.fast ? 14 : 5 };
}

/** Render one B3-family note (tonewheel stack + percussion + click). */
export function renderB3Note(
  midi: number,
  velocity: number,
  layer: OrganLayerState,
  opts: { bassOnly?: boolean; seconds?: number; sr?: number } = {},
): Float32Array {
  const sr = opts.sr ?? RENDER_SR;
  const len = Math.floor(sr * (opts.seconds ?? 1.2));
  const out = new Float32Array(len);
  const f = midiToFrequency(midi);
  const g = 0.25 + 0.75 * (Math.min(127, Math.max(1, velocity)) / 127);
  const bars = layer.drawbars.map(drawbarGain);
  const count = opts.bassOnly ? 2 : 9;
  for (let d = 0; d < count; d += 1) {
    const amp = bars[d];
    if (amp <= 0) continue;
    const ratio = B3_RATIOS[d];
    // Tonewheel character: fundamental + slight 2nd-harmonic body, slow swell.
    for (let i = 0; i < len; i += 1) {
      const t = i / sr;
      const swell = Math.min(1, t / 0.008);
      out[i] +=
        g *
        amp *
        0.32 *
        swell *
        (Math.sin(2 * Math.PI * f * ratio * t) + 0.25 * Math.sin(2 * Math.PI * f * ratio * 2 * t));
    }
  }
  if (!opts.bassOnly && layer.percussion.on) {
    const { peak, decay } = envTimes(layer.percussion);
    const ratio = layer.percussion.third ? 3 : 2;
    for (let i = 0; i < len; i += 1) {
      const t = i / sr;
      out[i] += g * peak * 0.4 * Math.exp(-t * decay) * Math.sin(2 * Math.PI * f * ratio * t);
    }
  }
  if (layer.keyClick) {
    const rand = lcg(midi * 733 + 41);
    const clickLen = Math.min(len, Math.floor(sr * 0.006));
    for (let i = 0; i < clickLen; i += 1) {
      out[i] += g * 0.5 * rand() * Math.exp(-i / (sr * 0.0012));
    }
  }
  return out;
}

/** Render one Vox note: bright transistor stack + mix drawbar. */
export function renderVoxNote(
  midi: number,
  velocity: number,
  layer: OrganLayerState,
  opts: { seconds?: number; sr?: number } = {},
): Float32Array {
  const sr = opts.sr ?? RENDER_SR;
  const len = Math.floor(sr * (opts.seconds ?? 1.2));
  const out = new Float32Array(len);
  const f = midiToFrequency(midi);
  const g = 0.25 + 0.75 * (Math.min(127, Math.max(1, velocity)) / 127);
  const bars = layer.drawbars.map(drawbarGain);
  for (let d = 0; d < 7; d += 1) {
    const amp = bars[d];
    if (amp <= 0) continue;
    // Transistor character: squarish partials (odd-harmonic edge).
    for (let i = 0; i < len; i += 1) {
      const t = i / sr;
      const swell = Math.min(1, t / 0.006);
      const s = Math.sin(2 * Math.PI * f * VOX_RATIOS[d] * t);
      out[i] += g * amp * 0.3 * swell * (s + 0.33 * Math.sign(s) * Math.abs(s));
    }
  }
  // Rightmost drawbar: filtered (soft/dark) vs unfiltered (bright) mix.
  const mix = bars[8] ?? 0;
  if (mix > 0) {
    const bright = new Float32Array(len);
    for (let i = 0; i < len; i += 1) {
      const t = i / sr;
      bright[i] = Math.sin(2 * Math.PI * f * 4.02 * t) + 0.5 * Math.sin(2 * Math.PI * f * 8.03 * t);
    }
    // Unfiltered bright path vs smoothed dark path blended by the drawbar.
    let y = 0;
    const a = 1 / (1 + sr * 0.0004);
    for (let i = 0; i < len; i += 1) {
      y += a * (bright[i] - y);
      out[i] += g * 0.3 * (bright[i] * mix + y * (1 - mix));
    }
  }
  return out;
}

/** Render one Farfisa note: on/off register switches (past half = on). */
export function renderFarfNote(
  midi: number,
  velocity: number,
  layer: OrganLayerState,
  opts: { seconds?: number; sr?: number } = {},
): Float32Array {
  const sr = opts.sr ?? RENDER_SR;
  const len = Math.floor(sr * (opts.seconds ?? 1.0));
  const out = new Float32Array(len);
  const f = midiToFrequency(midi);
  const g = 0.25 + 0.75 * (Math.min(127, Math.max(1, velocity)) / 127);
  const on = layer.drawbars.map((d) => (d > 4 ? 1 : 0));
  // Reedy transistor registers: harmonically rich, nasal (strong upper mids).
  const ratios = [0.5, 0.5, 1, 1, 1, 1, 2, 2, 2.99];
  const colors = [0.5, 0.42, 0.55, 0.7, 0.85, 0.5, 0.62, 0.45, 0.4];
  for (let d = 0; d < 9; d += 1) {
    if (!on[d]) continue;
    for (let i = 0; i < len; i += 1) {
      const t = i / sr;
      const swell = Math.min(1, t / 0.005);
      const ph = 2 * Math.PI * f * ratios[d] * t;
      out[i] += g * 0.3 * colors[d] * swell * (Math.sign(Math.sin(ph)) * 0.55 + Math.sin(ph) * 0.45);
    }
  }
  return out;
}

/** Render one Pipe note: pure flue ranks + detune chorus. */
export function renderPipeNote(
  midi: number,
  velocity: number,
  layer: OrganLayerState,
  opts: { bright?: boolean; seconds?: number; sr?: number } = {},
): Float32Array {
  const sr = opts.sr ?? RENDER_SR;
  const len = Math.floor(sr * (opts.seconds ?? 1.4));
  const out = new Float32Array(len);
  const f = midiToFrequency(midi);
  const g = 0.25 + 0.75 * (Math.min(127, Math.max(1, velocity)) / 127);
  const bars = layer.drawbars.map(drawbarGain);
  const boost = opts.bright ? 1.15 : 1;
  for (let d = 0; d < 9; d += 1) {
    const amp = d < 3 ? bars[d] * boost : bars[d];
    if (amp <= 0) continue;
    // Flue character: near-sine ranks with chiff attack transient.
    for (let i = 0; i < len; i += 1) {
      const t = i / sr;
      const swell = Math.min(1, t / 0.02);
      out[i] += g * Math.min(1, amp) * 0.3 * swell * Math.sin(2 * Math.PI * f * PIPE_RATIOS[d] * t);
    }
  }
  // Chiff: short breath transient on attack.
  const rand = lcg(midi * 977 + 7);
  const chiffLen = Math.min(len, Math.floor(sr * 0.03));
  for (let i = 0; i < chiffLen; i += 1) {
    out[i] += g * 0.06 * Math.abs(rand()) * Math.exp(-i / (sr * 0.008));
  }
  return out;
}

/** Dispatch to the canonical engine for a model id. */
export function renderOrganNote(
  midi: number,
  velocity: number,
  layer: OrganLayerState,
  sr = RENDER_SR,
): Float32Array {
  const model: OrganModelId = layer.model;
  if (model === 'B3 Bass') return renderB3Note(midi, velocity, layer, { bassOnly: true, sr });
  if (model === 'Vox') return renderVoxNote(midi, velocity, layer, { sr });
  if (model === 'Farf') return renderFarfNote(midi, velocity, layer, { sr });
  if (model === 'Pipe 2') return renderPipeNote(midi, velocity, layer, { bright: true, sr });
  if (model === 'Pipe 1') return renderPipeNote(midi, velocity, layer, { sr });
  return renderB3Note(midi, velocity, layer, { sr });
}

/** Vibrato depth 1..3 grows (V positions additionally mix dry). */
export function vibDepth(pos: VibChorusPos): number {
  const n = Number(pos.slice(1));
  return [0, 4, 7, 11][Math.min(3, Math.max(1, n))] / 11;
}

/**
 * Apply vibrato/chorus: pitch vibrato (delay-line wobble), chorus mixes the
 * modulated signal with the original. V1/C1 are audibly distinct effects and
 * depth grows across 1..3 (manual p. 19). `rateHz` ≈ 6 Hz scanner.
 */
export function applyVibChorus(
  data: Float32Array,
  pos: VibChorusPos,
  sr = RENDER_SR,
  rateHz = 6,
): Float32Array {
  const depth = vibDepth(pos);
  const isChorus = pos.startsWith('C');
  const out = new Float32Array(data.length);
  const maxDev = Math.floor((sr * 0.004 * depth) / 1) + 1;
  for (let i = 0; i < data.length; i += 1) {
    const wob = Math.sin((2 * Math.PI * rateHz * i) / sr) * maxDev * depth;
    const j = Math.min(data.length - 1, Math.max(0, Math.round(i + wob)));
    const wet = data[j] ?? 0;
    out[i] = isChorus ? data[i] * 0.55 + wet * 0.45 : wet;
  }
  return out;
}
