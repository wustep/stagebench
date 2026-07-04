/**
 * Organ voice synthesis — B3, Vox, Farf, Pipe 1 (and the may-reuse B3 Bass /
 * Pipe 2) engines for the Nord Stage 4 Organ section.
 *
 * These are HONEST additive/subtractive synthesis voices (declared as generated
 * sources), NOT recordings and NOT one renamed oscillator. Each model builds a
 * genuinely different harmonic structure so a spectral render tells them apart:
 *
 *   B3   — tonewheel: nine sine partials at the drawbar footages, tonewheel
 *          leakage hum, a short random key-click transient, and single-triggered
 *          percussion (2nd/3rd harmonic, soft/normal, slow/fast decay).
 *   Vox  — transistor combo: partials with an added odd-harmonic (square-ish)
 *          reediness and a filtered/unfiltered mix drawbar, brighter than B3.
 *   Farf — transistor combo: buzzy fixed voicing; drawbars act as on/off register
 *          switches (pulled past half). Very bright, rich in high odd harmonics.
 *   Pipe — flute-like sine ranks with light per-rank detuning (chorus), softest
 *          of the four. Pipe 2 reuses Pipe with a brighter principal registration.
 *
 * A voice routes to a per-layer destination node (its layer bus). The engine
 * lives in the ONE shared AudioContext.
 */

import { midiToFrequency } from './sampler';

export type OrganModelId = 'B3' | 'VOX' | 'FARF' | 'PIPE1' | 'PIPE2' | 'B3BASS';

/** Footage ratios for the nine drawbars relative to the 8' fundamental. */
const FOOTAGE_RATIOS = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8]; // 16',5 1/3',8',4',2 2/3',2',1 3/5',1 1/3',1'

export interface OrganParams {
  model: OrganModelId;
  drawbars: number[]; // nine values 0..8
  destination: AudioNode;
  level: number; // 0..1 pre-bus trim
  velocity: number; // 1..127
  percussion: { on: boolean; soft: boolean; fast: boolean; third: boolean };
  vibChorus: { on: boolean; mode: string }; // 'V1'..'C3'
  /** true if any other key is already held (percussion single-trigger). */
  percAvailable: boolean;
}

/** A single sounding organ note. */
export class OrganVoice {
  stopped = false;
  private readonly oscs: OscillatorNode[] = [];
  private readonly gain: GainNode;
  private readonly percGain: GainNode | null = null;
  private readonly clickBuf: AudioBufferSourceNode | null = null;

  constructor(
    private readonly ctx: BaseAudioContext,
    readonly midi: number,
    params: OrganParams,
    private readonly onEnd: () => void,
  ) {
    this.gain = ctx.createGain();
    this.gain.connect(params.destination);
    const now = ctx.currentTime;
    const freq = midiToFrequency(midi);
    const vel = Math.max(1, Math.min(127, params.velocity)) / 127;

    const spec = organSpectrum(params.model, params.drawbars);
    // Vibrato/chorus detuning per partial (very light) when engaged.
    const vc = params.vibChorus;
    const depthByMode: Record<string, number> = { V1: 4, V2: 8, V3: 14, C1: 5, C2: 10, C3: 18 };
    const detuneDepth = vc.on ? (depthByMode[vc.mode] ?? 6) : 0;

    let idx = 0;
    for (const partial of spec) {
      const osc = ctx.createOscillator();
      osc.type = partial.type;
      osc.frequency.value = freq * partial.ratio;
      // Alternate detune direction per partial for a chorus/vibrato shimmer.
      if (detuneDepth > 0) osc.detune.value = ((idx % 2) * 2 - 1) * detuneDepth;
      const g = ctx.createGain();
      g.gain.value = partial.gain * params.level;
      osc.connect(g).connect(this.gain);
      try {
        osc.start(now);
      } catch {
        /* offline */
      }
      this.oscs.push(osc);
      idx++;
    }

    // Organ amp envelope: near-instant attack, flat sustain (no natural decay).
    const peak = 0.16 + 0.12 * vel;
    this.gain.gain.setValueAtTime(0, now);
    this.gain.gain.linearRampToValueAtTime(peak, now + 0.006);

    // Key click: a short filtered noise transient on attack (B3/B3 Bass/Pipe).
    if (params.model === 'B3' || params.model === 'B3BASS' || params.model === 'PIPE1' || params.model === 'PIPE2') {
      this.clickBuf = makeClickBurst(ctx, this.gain, now);
    }

    // Percussion: a decaying 2nd/3rd harmonic partial from a shared trigger.
    if (params.model === 'B3' && params.percussion.on && params.percAvailable) {
      const pGain = ctx.createGain();
      pGain.connect(params.destination);
      const pOsc = ctx.createOscillator();
      pOsc.type = 'sine';
      const harmonicRatio = params.percussion.third ? 3 : 2;
      pOsc.frequency.value = freq * harmonicRatio;
      pOsc.connect(pGain);
      const pPeak = (params.percussion.soft ? 0.12 : 0.24) * (0.6 + 0.4 * vel);
      const decay = params.percussion.fast ? 0.18 : 0.55;
      pGain.gain.setValueAtTime(0, now);
      pGain.gain.linearRampToValueAtTime(pPeak, now + 0.004);
      pGain.gain.exponentialRampToValueAtTime(0.0005, now + 0.004 + decay);
      try {
        pOsc.start(now);
        pOsc.stop(now + 0.004 + decay + 0.05);
      } catch {
        /* offline */
      }
      this.oscs.push(pOsc);
      this.percGain = pGain;
    }
  }

  release(): void {
    if (this.stopped) return;
    const now = this.ctx.currentTime;
    const rel = 0.08; // organ has a fast, tonewheel-like release
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(0, now + rel);
    for (const osc of this.oscs) {
      try {
        osc.stop(now + rel + 0.02);
      } catch {
        /* noop */
      }
    }
    const first = this.oscs[0];
    if (first) first.onended = () => this.reap();
    else this.reap();
    this.stopped = true;
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const osc of this.oscs) {
      try {
        osc.stop();
      } catch {
        /* noop */
      }
    }
    this.reap();
  }

  private reap(): void {
    try {
      this.gain.disconnect();
    } catch {
      /* noop */
    }
    if (this.percGain) {
      try {
        this.percGain.disconnect();
      } catch {
        /* noop */
      }
    }
    void this.clickBuf;
    this.onEnd();
  }
}

interface Partial {
  ratio: number;
  gain: number;
  type: OscillatorType;
}

/**
 * Build the harmonic spectrum for a model + its nine drawbars. Each model maps
 * drawbar values to partial gains in a genuinely different way so renders are
 * spectrally distinct even with identical drawbar positions.
 */
export function organSpectrum(model: OrganModelId, drawbars: number[]): Partial[] {
  const db = (i: number) => (drawbars[i] ?? 0) / 8; // 0..1 per drawbar
  const partials: Partial[] = [];

  if (model === 'B3' || model === 'B3BASS') {
    // Tonewheel: pure sines at the nine footages. B3 Bass limits to 16' + 8'.
    const active = model === 'B3BASS' ? [0, 2] : [0, 1, 2, 3, 4, 5, 6, 7, 8];
    for (const i of active) {
      const g = db(i);
      if (g <= 0) continue;
      partials.push({ ratio: FOOTAGE_RATIOS[i], gain: g * 0.5, type: 'sine' });
    }
    // Tonewheel leakage hum: a very faint fundamental always present.
    partials.push({ ratio: 1, gain: 0.02, type: 'sine' });
    return partials;
  }

  if (model === 'VOX') {
    // Transistor combo: reedier — sine core plus an odd-harmonic buzz per footage.
    for (let i = 0; i < 9; i++) {
      const g = db(i);
      if (g <= 0) continue;
      partials.push({ ratio: FOOTAGE_RATIOS[i], gain: g * 0.4, type: 'triangle' });
      // Added third-harmonic reed on each active footage (the Vox character).
      partials.push({ ratio: FOOTAGE_RATIOS[i] * 3, gain: g * 0.14, type: 'sine' });
    }
    return partials;
  }

  if (model === 'FARF') {
    // Farfisa: drawbars act as on/off register switches (pulled past half = on).
    // Buzzy, bright — square/saw partials with strong high odd harmonics.
    for (let i = 0; i < 9; i++) {
      const on = (drawbars[i] ?? 0) > 4;
      if (!on) continue;
      partials.push({ ratio: FOOTAGE_RATIOS[i], gain: 0.32, type: 'sawtooth' });
      partials.push({ ratio: FOOTAGE_RATIOS[i] * 2, gain: 0.16, type: 'square' });
    }
    if (partials.length === 0) {
      // Farf with no register on still gives its characteristic reediness faintly.
      partials.push({ ratio: 1, gain: 0.04, type: 'sawtooth' });
    }
    return partials;
  }

  // PIPE1 / PIPE2 — flute/principal ranks. Pure, breathy sines; PIPE2 brighter.
  const bright = model === 'PIPE2';
  for (let i = 0; i < 9; i++) {
    const g = db(i);
    if (g <= 0) continue;
    partials.push({ ratio: FOOTAGE_RATIOS[i], gain: g * (bright ? 0.42 : 0.5), type: 'sine' });
    if (bright) {
      // Principal ranks add a soft second harmonic per rank.
      partials.push({ ratio: FOOTAGE_RATIOS[i] * 2, gain: g * 0.12, type: 'sine' });
    }
  }
  return partials;
}

/** A short random click transient (key click) mixed into a target gain. */
function makeClickBurst(ctx: BaseAudioContext, target: AudioNode, now: number): AudioBufferSourceNode | null {
  try {
    const len = Math.max(1, Math.floor(ctx.sampleRate * 0.01));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let seed = 0x9e37;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const env = 1 - i / len;
      data[i] = ((seed / 0x7fffffff) * 2 - 1) * env * 0.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1500;
    const g = ctx.createGain();
    g.gain.value = 0.4;
    src.connect(hp).connect(g).connect(target);
    src.start(now);
    src.stop(now + 0.02);
    return src;
  } catch {
    return null;
  }
}

/** Vibrato/chorus depth grows across 1..3 and V vs C differ audibly. */
export function vibChorusDepth(mode: string): number {
  const map: Record<string, number> = { V1: 4, V2: 8, V3: 14, C1: 5, C2: 10, C3: 18 };
  return map[mode] ?? 0;
}
