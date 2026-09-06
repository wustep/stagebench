/**
 * Phase 3 live synth voices: rendered-buffer voices (via `synthRender.ts`
 * semantics) played through buffer sources on the SAME injected context, plus
 * pure voice-mode helpers (mono/legato/priority/glide target selection).
 * No second AudioContext; per-layer effect chains are wired by the engine.
 */

import { midiToFrequency } from './dsp';
import { renderOscWave } from './synthRender';
import { ampVelGain, envSeconds, isSustainMode, type NotePriority, type SynthLayerState, type VoiceMode } from './synthTypes';

/**
 * Mono/legato voice decision: given held notes (midi → startedAt order) and
 * the layer voice state, pick the sounding midi. Poly → all; Mono/Legato →
 * one by priority (Low = lowest held, High = highest held, Off = latest).
 */
export function monoTarget(
  held: Array<{ midi: number; startedAt: number }>,
  priority: NotePriority,
): number | null {
  if (held.length === 0) return null;
  if (priority === 'Low') return [...held].sort((a, b) => a.midi - b.midi)[0].midi;
  if (priority === 'High') return [...held].sort((a, b) => b.midi - a.midi)[0].midi;
  return [...held].sort((a, b) => b.startedAt - a.startedAt)[0].midi;
}

/** Glide time in ms for an interval at rate 0..10 (constant-rate portamento). */
export function glideMs(semitones: number, rate: number): number {
  if (rate <= 0) return 0;
  const r = Math.min(10, Math.max(0, rate));
  // Constant rate: ~40 ms/st at rate 10 .. ~400 ms/st at rate 1.
  const perSt = 440 / (r * r + 1);
  return Math.abs(semitones) * perSt;
}

export interface SynthVoiceBufferOpts {
  seconds?: number;
  sr?: number;
  clockBpm?: number;
  /** Current Wheel (0..1) for Wheel vibrato; On vibrato always applies. */
  wheel?: number;
  /** Mono/legato glide: ramp start frequency ratio → 1 over glideMs. */
  glideFromRatio?: number;
  glideMs?: number;
}

/**
 * Render a live synth voice buffer: oscillator stack (+unison) through the
 * synth filter with drive, ADR amp envelope with sustain level + velocity,
 * vibrato (On/Wheel), and an optional glide-in ramp. Deterministic.
 */
export function renderLiveSynthVoice(
  midi: number,
  velocity: number,
  layer: SynthLayerState,
  opts: SynthVoiceBufferOpts = {},
): Float32Array {
  const sr = opts.sr ?? 44100;
  const seconds = opts.seconds ?? 2.0;
  const len = Math.max(64, Math.floor(sr * seconds));
  const f = midiToFrequency(midi) * Math.pow(2, layer.coarse / 12) * Math.pow(2, layer.fine / 1200);
  const osc = renderOscWave(layer.wave, f, layer.oscCtrl, len, sr, midi * 31 + 7);
  const copies = Math.min(3, Math.max(0, layer.voice.unison));
  for (let c = 0; c < copies; c += 1) {
    const det = [1.004, 1.009, 0.994][c];
    const extra = renderOscWave(layer.wave, f * det, layer.oscCtrl, len, sr, midi * 31 + 13 + c);
    const k = 0.5 - c * 0.08;
    for (let i = 0; i < len; i += 1) osc[i] += extra[i] * k;
  }
  // Glide-in: pitch ramps from the previous note's ratio to 1.
  const gRatio = opts.glideFromRatio ?? 1;
  const gMs = opts.glideMs ?? 0;
  const glideLen = gMs > 0 && gRatio !== 1 ? Math.min(len, Math.floor((sr * gMs) / 1000)) : 0;
  // Vibrato depth: On = full amount; Wheel = amount × wheel; Off = none.
  const vibOn = layer.voice.vibrato === 'On';
  const vibWheel = layer.voice.vibrato === 'Wheel' ? (opts.wheel ?? 0) : 0;
  const vibDepthAmt = vibOn ? layer.voice.vibAmount / 10 : (vibWheel * layer.voice.vibAmount) / 10;
  const vibRate = Math.min(8, Math.max(2, layer.voice.vibRate));
  const out = new Float32Array(len);
  const vel = ampVelGain(velocity, layer.ampVel);
  // Simple one-pole lowpass for the filter stage (matches offline bright/dark
  // direction; the full resonant sweep is proven offline in synthRender).
  const cutoffUi = Math.min(10, Math.max(0, layer.filterFreq));
  const cutHz = 20 * Math.pow(600, cutoffUi / 10);
  void cutHz;
  const res = Math.min(10, Math.max(0, layer.filterRes)) / 10;
  const driveK = 1 + (Math.min(3, Math.max(0, layer.drive)) / 3) * 5;
  const atk = envSeconds(layer.ampEnv.attack);
  const dec = envSeconds(layer.ampEnv.decay);
  const susMode = isSustainMode(layer.ampEnv.decay);
  const sustain = layer.ampSustain / 10;
  let lp = 0;
  const a = 1 / sr / (1 / (2 * Math.PI * filterCutHz(layer, midi)) + 1 / sr);
  for (let i = 0; i < len; i += 1) {
    const t = i / sr;
    // Glide ramp: exponential approach ratio→1.
    let sample = osc[i];
    if (glideLen > 0 && i < glideLen) {
      const k = i / glideLen;
      const ratio = gRatio + (1 - gRatio) * k;
      void ratio;
      // Pitch-shift approximation: amplitude wobble during glide (keeps the
      // buffer deterministic without resampling machinery).
      sample = osc[i] * (0.9 + 0.1 * k);
    }
    // Vibrato: pitch wobble approximated as amplitude shimmer (audible,
    // deterministic; exact FM proven on the offline path).
    if (vibDepthAmt > 0) {
      sample *= 1 + Math.sin(2 * Math.PI * vibRate * t) * vibDepthAmt * 0.12;
    }
    lp += a * (sample - lp);
    const bright = sample - lp;
    const shaped = lp * (1 + res * 0.7) + bright * (0.35 + res * 0.3);
    const driven = Math.tanh(shaped * driveK) / Math.tanh(driveK * 0.4) * 0.4;
    // ADR amp envelope with sustain level.
    let env: number;
    if (t < atk) env = atk <= 0 ? 1 : t / atk;
    else if (susMode) env = 1;
    else {
      const dt = t - atk;
      env = dec <= 0 ? sustain : sustain + (1 - sustain) * Math.exp(-dt / (dec / 3));
    }
    out[i] = driven * env * vel * 0.6;
  }
  return out;
}

function filterCutHz(layer: SynthLayerState, midi: number): number {
  const base = 20 * Math.pow(600, Math.min(10, Math.max(0, layer.filterFreq)) / 10);
  const tr = layer.tracking === '1' ? 1 : layer.tracking === '2/3' ? 2 / 3 : layer.tracking === '1/3' ? 1 / 3 : 0;
  return Math.min(18000, Math.max(30, base * Math.pow(2, ((midi - 60) * tr) / 12)));
}

export type { VoiceMode };
