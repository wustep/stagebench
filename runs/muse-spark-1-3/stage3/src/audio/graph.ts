/**
 * Phase 2 live signal graph: per-layer buses with six ordered effect units,
 * a shared Rotary after Reverb, layer level, and master gain/limiter feeding
 * one destination — all on ONE AudioContext.
 *
 * Order per layer: Mod 1 → Mod 2 → Delay ⤺(feedback filter in loop) →
 * Amp Sim/EQ → Compressor → Reverb → [Rotary when To Rotary] → layer level.
 * Layers feed master gain → limiter → destination. Nothing bypasses master.
 *
 * Every audible parameter change uses short ramps (click-free); `dispose()`
 * stops and disconnects every node it owns.
 */

import type { ChainState, DelayState } from '../state/fxTypes';
import { mod1RateHz, mod2RateHz } from '../state/fxTypes';
import type {
  AudioParamLike,
  BiquadFilterNodeLike,
  DelayNodeLike,
  DynamicsCompressorNodeLike,
  StageAudioContextLike,
  StereoPannerNodeLike,
  WaveShaperNodeLike,
} from './graphTypes';
import type { AudioNodeLike } from './types';

export interface GraphHandles {
  input: { connect(d: AudioNodeLike | { __destinationBrand: true }): void };
  output: AudioNodeLike;
  nodes: AudioNodeLike[];
  update(chain: ChainState, delay: DelayState, rotary: { speed: 'slow' | 'fast' | 'stop'; drive: number }): void;
  setBypass(allBypass: boolean): void;
  dispose(): void;
}

function ramp(param: AudioParamLike, value: number, now: number): void {
  try {
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.setTargetAtTime(value, now, 0.008);
  } catch {
    param.value = value;
  }
}

function tanhDriveCurve(drive: number): Float32Array {
  const k = 1 + (drive / 10) * 6;
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i += 1) {
    const x = (i / 128) - 1;
    curve[i] = Math.tanh(x * k) / Math.tanh(k * 0.35) * 0.35;
  }
  return curve;
}

/**
 * Build one layer chain. `levelNode`/`rotarySend` are created by the caller
 * (StageEngine) so chains, level, and rotary stay in the documented order.
 */
export function buildLayerChain(
  ctx: StageAudioContextLike,
  initial: ChainState,
  initialDelay: DelayState,
): GraphHandles {
  const nodes: AudioNodeLike[] = [];
  const now = () => ctx.currentTime;

  const track = <T extends AudioNodeLike>(node: T): T => {
    nodes.push(node);
    return node;
  };

  // Input gain (chain entry) — bypass routing pivots around it.
  const input = track(ctx.createGain());
  // Dry path: input → dryGain → chainOut (parallel so bypass is click-free).
  const dryGain = track(ctx.createGain());
  const wetEntry = track(ctx.createGain());
  const chainOut = track(ctx.createGain());
  input.connect(dryGain);
  dryGain.connect(chainOut);
  input.connect(wetEntry);

  // --- Mod 1: tremolo/pan gain + optional ring/panner/wah filter ---
  const mod1Gain = track(ctx.createGain());
  const mod1Pan = track(ctx.createStereoPanner());
  const mod1Filter = track(ctx.createBiquadFilter());
  mod1Filter.type = 'lowpass';
  mod1Filter.frequency.value = 4000;
  const mod1Lfo = track(ctx.createOscillator());
  mod1Lfo.type = 'sine';
  const mod1LfoGain = track(ctx.createGain());
  mod1Lfo.connect(mod1LfoGain);

  // --- Mod 2: short modulated delay + sweep filter ---
  const mod2Delay = track(ctx.createDelay(0.1));
  const mod2Mix = track(ctx.createGain());
  const mod2Filter = track(ctx.createBiquadFilter());
  mod2Filter.type = 'bandpass';
  mod2Filter.frequency.value = 1600;
  const mod2Lfo = track(ctx.createOscillator());
  mod2Lfo.type = 'sine';
  const mod2LfoGain = track(ctx.createGain());
  mod2Lfo.connect(mod2LfoGain);

  // --- Delay with feedback loop; filter sits IN the loop (repeats only) ---
  const delayNode = track(ctx.createDelay(2));
  const delayFb = track(ctx.createGain());
  const delayFbFilter = track(ctx.createBiquadFilter());
  delayFbFilter.type = 'lowpass';
  delayFbFilter.frequency.value = 6000;
  const delayWet = track(ctx.createGain());
  const delayDry = track(ctx.createGain());
  delayNode.connect(delayFb);
  delayFb.connect(delayFbFilter);
  delayFbFilter.connect(delayNode); // regeneration loop (filtered repeats)
  delayNode.connect(delayWet);

  // --- Amp/EQ: shaper + tone stack + resonant filter ---
  const ampShaper = track(ctx.createWaveShaper());
  ampShaper.oversample = '2x';
  const ampBass = track(ctx.createBiquadFilter());
  ampBass.type = 'lowshelf';
  ampBass.frequency.value = 100;
  const ampMid = track(ctx.createBiquadFilter());
  ampMid.type = 'peaking';
  ampMid.Q.value = 1;
  const ampTreble = track(ctx.createBiquadFilter());
  ampTreble.type = 'highshelf';
  ampTreble.frequency.value = 4000;
  const ampFilter = track(ctx.createBiquadFilter()); // LP24/HP24 resonant filter
  ampFilter.type = 'lowpass';
  ampFilter.frequency.value = 8000;

  // --- Compressor + Reverb (convolver with generated IR) ---
  const comp = track(ctx.createDynamicsCompressor());
  const reverb = track(ctx.createConvolver());
  const reverbWet = track(ctx.createGain());
  const reverbDry = track(ctx.createGain());
  reverb.connect(reverbWet);

  // Series order: wetEntry → mod1 → mod2 → delay → amp → comp → reverb.
  wetEntry.connect(mod1Gain);
  mod1Gain.connect(mod1Pan);
  mod1Pan.connect(mod1Filter);
  mod1Filter.connect(mod2Delay);
  mod2Delay.connect(mod2Filter);
  mod2Filter.connect(mod2Mix);
  mod2Delay.connect(mod2Mix);
  mod2Mix.connect(delayDry);
  mod2Mix.connect(delayNode);
  delayDry.connect(ampShaper);
  delayWet.connect(ampShaper);
  ampShaper.connect(ampBass);
  ampBass.connect(ampMid);
  ampMid.connect(ampTreble);
  ampTreble.connect(ampFilter);
  ampFilter.connect(comp);
  comp.connect(reverbDry);
  comp.connect(reverb);
  reverbDry.connect(chainOut);
  reverbWet.connect(chainOut);

  // Reverb impulse: deterministic generated stereo-ish wash (mono buffer).
  const buildIr = (seconds: number, bright: boolean): { getChannelData(c: number): Float32Array; sampleRate: number; length: number; duration: number } | null => {
    try {
      const sr = ctx.sampleRate || 44100;
      const len = Math.max(16, Math.floor(sr * Math.min(seconds, 2.5)));
      const buf = ctx.createBuffer(1, len, sr);
      const ch = buf.getChannelData(0);
      let seed = 7000 + Math.floor(seconds * 977);
      let y = 0;
      const dark = bright ? 0.1 : 0.3;
      for (let i = 0; i < len; i += 1) {
        seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
        const x = seed / 0x3fffffff - 1;
        y += (1 - dark) * (x - y);
        ch[i] = y * Math.exp((-i / sr) * (4.2 / seconds)) * 0.6;
      }
      return buf;
    } catch {
      return null;
    }
  };

  const applyChain = (
    chain: ChainState,
    delay: DelayState,
    rotary: { speed: 'slow' | 'fast' | 'stop'; drive: number },
    allBypass: boolean,
  ): void => {
    const t = now();
    void rotary;
    const bypassed = allBypass;

    // Dry/wet balance: all-bypass or everything-off → pure dry.
    const anyWet =
      !bypassed &&
      (chain.mod1.on || chain.mod2.on || chain.delay.on || chain.ampEq.on || chain.comp.on || chain.reverb.on);
    ramp(dryGain.gain as unknown as AudioParamLike, anyWet ? 0 : 1, t);
    ramp(wetEntry.gain as unknown as AudioParamLike, anyWet ? 1 : 0, t);

    // Mod 1.
    ramp(mod1Gain.gain as unknown as AudioParamLike, chain.mod1.on && chain.mod1.type === 'tremolo' ? 1 : 1, t);
    const m1 = chain.mod1;
    mod1Lfo.frequency.value = mod1RateHz(m1.rate);
    mod1LfoGain.gain.value = m1.on ? (m1.amount / 10) * (m1.type === 'tremolo' ? 0.85 : m1.type === 'pump' ? 0.9 : 0.35) : 0;
    if (m1.type === 'tremolo' || m1.type === 'pump') {
      try { mod1LfoGain.disconnect(); } catch { /* idempotent */ }
      mod1LfoGain.connect(mod1Gain.gain as unknown as never);
    } else if (m1.type === 'a-pan') {
      try { mod1LfoGain.disconnect(); } catch { /* idempotent */ }
      mod1LfoGain.connect(mod1Pan.pan as unknown as never);
    } else if (m1.type === 'ring-mod') {
      mod1Lfo.frequency.value = 40 + m1.rate * 8;
    } else if (m1.type === 'wah' || m1.type === 'a-wah') {
      mod1Filter.type = 'lowpass';
      mod1Filter.frequency.value = m1.type === 'wah' ? 900 + m1.rate * 220 : 2500;
    }
    ramp(mod1Filter.frequency as unknown as AudioParamLike, m1.on && (m1.type === 'wah' || m1.type === 'a-wah') ? 1400 : 4000, t);

    // Mod 2.
    const m2 = chain.mod2;
    mod2Delay.delayTime.value = m2.type === 'flanger' ? 0.0035 : m2.type === 'chorus' ? 0.014 : 0.009;
    mod2Lfo.frequency.value = mod2RateHz(m2.rate);
    mod2LfoGain.gain.value = 0.004 * (m2.amount / 10);
    try { mod2LfoGain.disconnect(); } catch { /* idempotent */ }
    if (m2.on) mod2LfoGain.connect(mod2Delay.delayTime as unknown as never);
    ramp(mod2Mix.gain as unknown as AudioParamLike, m2.on ? 0.5 + (m2.amount / 10) * 0.4 : 0.5, t);
    ramp(mod2Filter.frequency as unknown as AudioParamLike, m2.on && m2.type === 'phaser' ? 1600 : 3200, t);

    // Delay: time + feedback + wet + IN-LOOP filter (repeats only).
    ramp(delayNode.delayTime as unknown as AudioParamLike, Math.min(1.9, Math.max(0.02, delay.timeMs / 1000)), t);
    ramp(delayFb.gain as unknown as AudioParamLike, delay.on ? Math.min(0.85, delay.feedback / 10) : 0, t);
    ramp(delayWet.gain as unknown as AudioParamLike, delay.on ? (delay.wet / 10) * 0.6 : 0, t);
    ramp(delayDry.gain as unknown as AudioParamLike, 1, t);
    if (delay.filter === 'lp') {
      delayFbFilter.type = 'lowpass';
      delayFbFilter.frequency.value = 2200;
    } else if (delay.filter === 'hp') {
      delayFbFilter.type = 'highpass';
      delayFbFilter.frequency.value = 900;
    } else if (delay.filter === 'bp') {
      delayFbFilter.type = 'bandpass';
      delayFbFilter.frequency.value = 1500;
    } else {
      delayFbFilter.type = 'lowpass';
      delayFbFilter.frequency.value = 12000;
    }

    // Amp/EQ.
    const amp = chain.ampEq;
    ampShaper.curve = amp.on && amp.type !== 'eq' && amp.type !== 'to-rotary' ? tanhDriveCurve(amp.drive) : null;
    ramp(ampBass.gain as unknown as AudioParamLike, amp.bass, t);
    ramp(ampMid.gain as unknown as AudioParamLike, amp.type === 'lp24' || amp.type === 'hp24' ? 0 : amp.mid, t);
    ramp(ampMid.frequency as unknown as AudioParamLike, Math.min(8000, Math.max(200, amp.freq)), t);
    ramp(ampTreble.gain as unknown as AudioParamLike, amp.treble, t);
    if (amp.type === 'lp24') {
      ampFilter.type = 'lowpass';
      ramp(ampFilter.frequency as unknown as AudioParamLike, Math.min(12000, Math.max(80, amp.freq)), t);
      ramp(ampFilter.Q as unknown as AudioParamLike, 1 + (amp.mid / 15) * 8, t);
    } else if (amp.type === 'hp24') {
      ampFilter.type = 'highpass';
      ramp(ampFilter.frequency as unknown as AudioParamLike, Math.min(8000, Math.max(40, amp.freq)), t);
      ramp(ampFilter.Q as unknown as AudioParamLike, 1 + (amp.mid / 15) * 8, t);
    } else {
      ampFilter.type = 'lowpass';
      ramp(ampFilter.frequency as unknown as AudioParamLike, amp.type === 'twin' ? 6500 : amp.type === 'small' ? 1800 : 12000, t);
      ramp(ampFilter.Q as unknown as AudioParamLike, 0.7, t);
    }

    // Compressor.
    const c = chain.comp;
    ramp(comp.threshold as unknown as AudioParamLike, c.on ? -12 - (c.amount / 10) * 24 : 0, t);
    ramp(comp.ratio as unknown as AudioParamLike, c.on ? 1 + (c.amount / 10) * 11 : 1, t);
    ramp(comp.attack as unknown as AudioParamLike, c.fast ? 0.002 : 0.008, t);
    ramp(comp.release as unknown as AudioParamLike, c.fast ? 0.08 : 0.28, t);

    // Reverb: generated IR by type; bright/dark; wet→fully wet at max.
    const decays: Record<string, number> = { room: 0.5, booth: 0.18, spring: 0.7, stage: 1.2, hall: 2.4, cathedral: 4.2 };
    const ir = buildIr(decays[chain.reverb.type] ?? 0.5, chain.reverb.bright);
    if (ir) {
      try {
        reverb.buffer = ir as never;
      } catch {
        /* keep previous IR */
      }
    }
    ramp(reverbWet.gain as unknown as AudioParamLike, chain.reverb.on ? (chain.reverb.wet / 10) * 0.9 : 0, t);
    ramp(reverbDry.gain as unknown as AudioParamLike, chain.reverb.on ? 1 - (chain.reverb.wet / 10) * 0.85 : 1, t);
  };

  let current: { chain: ChainState; delay: DelayState; rotary: { speed: 'slow' | 'fast' | 'stop'; drive: number }; bypass: boolean } = {
    chain: initial,
    delay: initialDelay,
    rotary: { speed: 'slow', drive: 3 },
    bypass: false,
  };

  try {
    mod1Lfo.start();
    mod2Lfo.start();
  } catch {
    /* fake/start errors are non-fatal */
  }
  applyChain(initial, initialDelay, current.rotary, false);

  return {
    input,
    output: chainOut,
    nodes,
    update(chain, delay, rotary) {
      current = { chain, delay, rotary, bypass: current.bypass };
      applyChain(chain, delay, rotary, current.bypass);
    },
    setBypass(allBypass: boolean) {
      current = { ...current, bypass: allBypass };
      applyChain(current.chain, current.delay, current.rotary, allBypass);
    },
    dispose() {
      for (const lfo of [mod1Lfo, mod2Lfo]) {
        try { lfo.stop(); } catch { /* already stopped */ }
      }
      for (const node of nodes) {
        try { node.disconnect(); } catch { /* already gone */ }
      }
    },
  };
}

export interface RotaryHandles {
  input: AudioNodeLike;
  output: AudioNodeLike;
  nodes: AudioNodeLike[];
  update(speed: 'slow' | 'fast' | 'stop', drive: number): void;
  dispose(): void;
}

/** Shared Rotary: horn + bass rotor shimmer, smooth speed ramps. */
export function buildRotary(ctx: StageAudioContextLike): RotaryHandles {
  const nodes: AudioNodeLike[] = [];
  const track = <T extends AudioNodeLike>(node: T): T => {
    nodes.push(node);
    return node;
  };
  const input = track(ctx.createGain());
  const shaper = track(ctx.createWaveShaper());
  const trem = track(ctx.createGain());
  const lfo = track(ctx.createOscillator());
  lfo.type = 'sine';
  lfo.frequency.value = 0.8;
  const lfoGain = track(ctx.createGain());
  lfoGain.gain.value = 0.2;
  lfo.connect(lfoGain);
  try {
    (lfoGain as unknown as { connect(d: unknown): void }).connect(trem.gain as unknown as never);
  } catch {
    /* wiring best-effort on fakes */
  }
  const output = track(ctx.createGain());
  input.connect(shaper);
  shaper.connect(trem);
  trem.connect(output);
  try {
    lfo.start();
  } catch {
    /* ignore */
  }
  return {
    input,
    output,
    nodes,
    update(speed, drive) {
      const t = ctx.currentTime;
      shaper.curve = tanhDriveCurve(drive * 0.6);
      ramp(lfo.frequency as unknown as AudioParamLike, speed === 'fast' ? 6.4 : speed === 'slow' ? 0.8 : 0.8, t);
      ramp(lfoGain.gain as unknown as AudioParamLike, speed === 'stop' ? 0 : 0.22, t);
    },
    dispose() {
      try { lfo.stop(); } catch { /* already stopped */ }
      for (const node of nodes) {
        try { node.disconnect(); } catch { /* already gone */ }
      }
    },
  };
}

export type { AudioNodeLike };
export type { DelayNodeLike, DynamicsCompressorNodeLike, WaveShaperNodeLike, StereoPannerNodeLike, BiquadFilterNodeLike };
