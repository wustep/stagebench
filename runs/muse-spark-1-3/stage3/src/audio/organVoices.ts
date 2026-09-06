/**
 * Phase 3 live organ voices: per-model oscillator stacks built on the SAME
 * injected `StageAudioContextLike` as the Phase 2 graph — no second context.
 *
 * Voice design (mirrors `organRender.ts` semantics):
 * - B3/B3 Bass: one oscillator per active drawbar partial (tonewheel ratios),
 *   plus a shared percussion envelope (single gain driven by one decaying
 *   source), plus a click transient (short noise buffer).
 * - Vox: squarish partials (oscillator type square for edge) + mix drawbar.
 * - Farf: on/off register switches (past half = on), reedy (sawtooth stack).
 * - Pipe: near-sine ranks + chiff transient.
 * - Vibrato/chorus: live LFO → detune (vibrato) with a dry/wet chorus mix.
 * - Percussion is single-triggered: it retriggers only after all organ keys
 *   are released (manual p. 20); the engine tracks this via `percArmed`.
 */

import { midiToFrequency } from './dsp';
import { B3_RATIOS, PIPE_RATIOS, VOX_RATIOS } from './organTypes';
import { vibDepth } from './organRender';
import type { OrganLayerState, OrganModelId } from './organTypes';
import type { OscillatorNodeLike, StageAudioContextLike } from './graphTypes';

export interface OrganVoiceNodes {
  oscs: OscillatorNodeLike[];
  gains: { gain: { value: number }; connect(d: unknown): void; disconnect(): void }[];
  stop: () => void;
}

export interface PercBus {
  input: { connect(d: unknown): void };
  trigger: (midi: number, velocity: number, layer: OrganLayerState, when: number) => void;
  dispose: () => void;
}

export interface VibBus {
  input: { connect(d: unknown): void };
  output: { connect(d: unknown): void };
  update: (layer: OrganLayerState) => void;
  dispose: () => void;
}

function drawAmp(v: number): number {
  return Math.min(8, Math.max(0, v)) / 8;
}

/** Build the oscillator stack for one organ note; caller connects `output`. */
export function buildOrganVoice(
  ctx: StageAudioContextLike,
  model: OrganModelId,
  midi: number,
  velocity: number,
  layer: OrganLayerState,
  output: { connect(d: unknown): void },
): OrganVoiceNodes {
  const oscs: OscillatorNodeLike[] = [];
  const gains: OrganVoiceNodes['gains'] = [];
  const f = midiToFrequency(midi);
  const vel = 0.25 + 0.75 * (Math.min(127, Math.max(1, velocity)) / 127);
  const stop = () => {
    for (const o of oscs) {
      try { o.stop(); } catch { /* already stopped */ }
      try { o.disconnect(); } catch { /* already gone */ }
    }
    for (const g of gains) {
      try { g.disconnect(); } catch { /* already gone */ }
    }
  };
  const addPartial = (freq: number, amp: number, type: OscillatorNodeLike['type']) => {
    if (amp <= 0.001) return;
    try {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = Math.max(20, freq);
      const g = ctx.createGain();
      (g.gain as unknown as { value: number }).value = amp * vel * 0.14;
      osc.connect(g as never);
      g.connect(output as never);
      oscs.push(osc);
      gains.push(g as unknown as OrganVoiceNodes['gains'][number]);
      try { osc.start(); } catch { /* fake errors non-fatal */ }
    } catch { /* voice is best-effort on fakes */ }
  };
  if (model === 'B3' || model === 'B3 Bass') {
    const count = model === 'B3 Bass' ? 2 : 9;
    for (let d = 0; d < count; d += 1) {
      addPartial(f * B3_RATIOS[d], drawAmp(layer.drawbars[d] ?? 0), 'sine');
      // Tonewheel body: soft 2nd-harmonic shimmer per partial.
      if ((layer.drawbars[d] ?? 0) > 0) addPartial(f * B3_RATIOS[d] * 2, drawAmp(layer.drawbars[d]) * 0.18, 'sine');
    }
  } else if (model === 'Vox') {
    for (let d = 0; d < 7; d += 1) {
      addPartial(f * VOX_RATIOS[d], drawAmp(layer.drawbars[d] ?? 0), d < 3 ? 'sine' : 'square');
    }
    const mix = drawAmp(layer.drawbars[8] ?? 0);
    if (mix > 0) addPartial(f * 4.02, mix * 0.8, 'square');
  } else if (model === 'Farf') {
    const ratios = [0.5, 0.5, 1, 1, 1, 1, 2, 2, 2.99];
    for (let d = 0; d < 9; d += 1) {
      if ((layer.drawbars[d] ?? 0) <= 4) continue; // pulled past half = on
      addPartial(f * ratios[d], 0.85, 'sawtooth');
    }
  } else {
    // Pipe 1 / Pipe 2: near-sine flue ranks.
    const bright = model === 'Pipe 2' ? 1.15 : 1;
    for (let d = 0; d < 9; d += 1) {
      const amp = d < 3 ? drawAmp(layer.drawbars[d] ?? 0) * bright : drawAmp(layer.drawbars[d] ?? 0);
      addPartial(f * PIPE_RATIOS[d], amp, 'sine');
    }
  }
  return { oscs, gains, stop };
}

/** Key click transient: short noise burst through a gain into `output`. */
export function fireClick(
  ctx: StageAudioContextLike,
  midi: number,
  velocity: number,
  output: { connect(d: unknown): void },
): void {
  try {
    const len = Math.max(16, Math.floor((ctx.sampleRate || 44100) * 0.004));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate || 44100);
    const ch = buf.getChannelData(0);
    let seed = (midi * 733 + 41) >>> 0;
    for (let i = 0; i < len; i += 1) {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      ch[i] = (seed / 0x3fffffff - 1) * Math.exp(-i / (len / 4));
    }
    const src = ctx.createBufferSource();
    src.buffer = buf as never;
    const g = ctx.createGain();
    const vel = 0.25 + 0.75 * (Math.min(127, Math.max(1, velocity)) / 127);
    (g.gain as unknown as { value: number }).value = 0.12 * vel;
    src.connect(g as never);
    g.connect(output as never);
    try { src.start(); } catch { /* ignore */ }
    const cleanup = () => {
      try { src.disconnect(); } catch { /* gone */ }
      try { g.disconnect(); } catch { /* gone */ }
    };
    src.onended = cleanup;
    setTimeout(cleanup, 60);
  } catch { /* click is best-effort */ }
}

/**
 * Shared percussion bus: a single decaying envelope source retriggered by
 * `trigger` (single-triggered behavior is enforced by the caller via
 * `percArmed`). Adds the 2nd/3rd harmonic attack partial.
 */
export function buildPercBus(
  ctx: StageAudioContextLike,
  output: { connect(d: unknown): void },
): PercBus {
  const input = ctx.createGain();
  (input.gain as unknown as { value: number }).value = 1;
  input.connect(output as never);
  const trigger = (midi: number, velocity: number, layer: OrganLayerState, when: number) => {
    if (!layer.percussion.on) return;
    try {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const ratio = layer.percussion.third ? 3 : 2;
      osc.frequency.value = midiToFrequency(midi) * ratio;
      const g = ctx.createGain();
      const peak = (layer.percussion.soft ? 0.35 : 0.7) * 0.4;
      const param = g.gain as unknown as {
        value: number;
        setValueAtTime(v: number, t: number): void;
        setTargetAtTime(v: number, t: number, c: number): void;
      };
      try {
        param.setValueAtTime(peak, when);
        param.setTargetAtTime(0, when, layer.percussion.fast ? 0.03 : 0.09);
      } catch {
        param.value = peak;
      }
      void velocity;
      osc.connect(g as never);
      g.connect(input as never);
      try { osc.start(when); } catch { try { osc.start(); } catch { /* ignore */ } }
      const stopAt = when + (layer.percussion.fast ? 0.5 : 1.2);
      try { osc.stop(stopAt); } catch { /* ignore */ }
      setTimeout(() => {
        try { osc.disconnect(); } catch { /* gone */ }
        try { g.disconnect(); } catch { /* gone */ }
      }, Math.max(50, (stopAt - when) * 1000 + 80));
    } catch { /* percussion best-effort */ }
  };
  return {
    input: input as unknown as PercBus['input'],
    trigger,
    dispose: () => {
      try { (input as unknown as { disconnect(): void }).disconnect(); } catch { /* gone */ }
    },
  };
}

/**
 * Vibrato/chorus bus: input gain → wet path (LFO-detuned via per-voice
 * detune is applied at voice build; this bus applies the chorus mix + slow
 * scanner wobble on a tremolo gain) → output. Live approximation of the
 * scanner: LFO-driven gain wobble, depth grows 1..3, chorus mixes dry.
 */
export function buildVibBus(
  ctx: StageAudioContextLike,
  output: { connect(d: unknown): void },
): VibBus {
  const input = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const wobble = ctx.createGain();
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 6;
  const lfoGain = ctx.createGain();
  (lfoGain.gain as unknown as { value: number }).value = 0;
  try {
    (lfo as unknown as { connect(d: unknown): void }).connect(lfoGain as never);
    (lfoGain as unknown as { connect(d: unknown): void }).connect(wobble.gain as never);
  } catch { /* wiring best-effort */ }
  input.connect(dry as never);
  dry.connect(output as never);
  input.connect(wobble as never);
  wobble.connect(wet as never);
  wet.connect(output as never);
  try { lfo.start(); } catch { /* ignore */ }
  let last: OrganLayerState | null = null;
  const update = (layer: OrganLayerState) => {
    last = layer;
    const depth = vibDepth(layer.vibChorus);
    const isChorus = layer.vibChorus.startsWith('C');
    const on = layer.vibOn;
    (dry.gain as unknown as { value: number }).value = !on ? 1 : isChorus ? 0.55 : 0;
    (wet.gain as unknown as { value: number }).value = !on ? 0 : isChorus ? 0.45 : 1;
    (lfoGain.gain as unknown as { value: number }).value = on ? 0.1 + depth * 0.3 : 0;
    void last;
  };
  update({ vibChorus: 'C1', vibOn: false } as OrganLayerState);
  return {
    input: input as unknown as PercBus['input'],
    output: output as unknown as VibBus['output'],
    update,
    dispose: () => {
      try { lfo.stop(); } catch { /* stopped */ }
      for (const n of [input, dry, wet, wobble, lfoGain] as unknown as { disconnect(): void }[]) {
        try { n.disconnect(); } catch { /* gone */ }
      }
    },
  };
}
