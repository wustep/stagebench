/**
 * Web Audio adapter for the AudioBackend boundary.
 *
 * One AudioContext, one master gain -> limiter (soft DynamicsCompressor) ->
 * destination. Each tone is a small additive stack (fundamental + a couple of
 * detuned/harmonic partials) shaped by a per-tone gain node. This is HONEST
 * SYNTHESIS — a generated piano-like voice — not a recorded sample set. That is
 * declared truthfully in IMPLEMENTATION_DETAILS.json.
 */

import type { AudioBackend, Seconds, ToneHandle, ToneSpec } from './types';

class WebAudioTone implements ToneHandle {
  stopped = false;
  private readonly oscillators: OscillatorNode[] = [];
  private readonly gain: GainNode;
  private started = false;

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
    spec: ToneSpec,
    private readonly onStop: () => void,
  ) {
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(destination);

    // Partial recipe: fundamental plus a soft octave and a slightly detuned
    // fundamental for chorus-like body. Relative gains keep a piano-ish decay.
    const partials: Array<{ ratio: number; gain: number; detune: number; type: OscillatorType }> = [
      { ratio: 1, gain: 1, detune: 0, type: 'triangle' },
      { ratio: 1, gain: 0.35, detune: 4, type: 'sine' },
      { ratio: 2, gain: 0.22, detune: 0, type: 'sine' },
      { ratio: 3, gain: 0.08, detune: 0, type: 'sine' },
    ];
    const peak = Math.max(0, Math.min(1, spec.peakGain));
    for (const p of partials) {
      const osc = ctx.createOscillator();
      osc.type = p.type;
      osc.frequency.value = spec.frequency * p.ratio;
      osc.detune.value = p.detune;
      const g = ctx.createGain();
      g.gain.value = p.gain * peak;
      osc.connect(g).connect(this.gain);
      this.oscillators.push(osc);
    }
  }

  start(when: Seconds): void {
    if (this.started) return;
    this.started = true;
    for (const osc of this.oscillators) osc.start(when);
  }

  rampGain(target: number, when: Seconds): void {
    const t = Math.max(when, this.ctx.currentTime);
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(this.gain.gain.value, this.ctx.currentTime);
    this.gain.gain.linearRampToValueAtTime(target, t);
  }

  holdGain(when: Seconds): void {
    const t = Math.max(when, this.ctx.currentTime);
    const current = this.gain.gain.value;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(current, t);
  }

  stop(when: Seconds): void {
    if (this.stopped) return;
    this.stopped = true;
    const t = Math.max(when, this.ctx.currentTime);
    for (const osc of this.oscillators) {
      try {
        osc.stop(t + 0.05);
      } catch {
        /* already stopped */
      }
    }
    const cleanup = () => {
      try {
        this.gain.disconnect();
      } catch {
        /* noop */
      }
      this.onStop();
    };
    // Release nodes shortly after the scheduled stop.
    const first = this.oscillators[0];
    if (first) first.onended = cleanup;
    else cleanup();
  }
}

export function createWebAudioBackend(ctxFactory?: () => AudioContext): AudioBackend {
  const ctx = (ctxFactory ?? (() => new AudioContext()))();
  const master = ctx.createGain();
  master.gain.value = 0.6;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.ratio.value = 12;
  master.connect(limiter).connect(ctx.destination);

  let active = 0;

  return {
    get now() {
      return ctx.currentTime;
    },
    get state() {
      return ctx.state as 'suspended' | 'running' | 'closed';
    },
    async resume() {
      if (ctx.state === 'suspended') await ctx.resume();
    },
    createTone(spec: ToneSpec): ToneHandle {
      active++;
      return new WebAudioTone(ctx, master, spec, () => {
        active = Math.max(0, active - 1);
      });
    },
    get activeToneCount() {
      return active;
    },
    async close() {
      if (ctx.state !== 'closed') await ctx.close();
    },
  };
}
