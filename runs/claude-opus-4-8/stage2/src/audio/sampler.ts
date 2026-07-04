/**
 * Sampler + synth voices for the Piano types.
 *
 * A Sampler owns decoded AudioBuffers keyed by root MIDI note. noteOn() picks
 * the nearest recorded root and pitch-shifts by at most ~1 semitone (root notes
 * are spaced a minor third apart), so no note is obviously stretched. Grand /
 * Upright / Electric use this path with RECORDED buffers.
 *
 * SynthVoice provides the HONEST SYNTHESIS voices for Clav / Digital / Misc.
 *
 * Both expose the same Voice shape so the engine treats them uniformly. Voices
 * route to a per-layer destination node (the layer bus input).
 */

import type { PianoTypeDef, SampleManifest } from './instruments';

export interface Voice {
  /** Note-off with a release ramp; returns when it can be reaped. */
  release(soft: boolean): void;
  /** Immediate hard stop (panic / steal). */
  stop(): void;
  readonly midi: number;
  readonly stopped: boolean;
}

export interface KbTouchCurve {
  /** 'Heavy' | 'Medium' | 'Light' */
  exponent: number;
}

export interface VoiceParams {
  velocity: number; // 1..127
  destination: AudioNode;
  /** KB Touch curve exponent (higher = needs harder press for loud). */
  touchExponent: number;
  /** Dyn Comp 0..3 — raises soft strokes. */
  dynComp: number;
  /** Timbre index into the type's timbre list. */
  timbre: number;
  /** Unison 0..3. */
  unison: number;
  /** Soft release engaged. */
  softRelease: boolean;
  release: number;
  softReleaseTime: number;
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Map velocity (1..127) through KB Touch + Dyn Comp to a 0..1 gain factor. */
export function shapeVelocity(velocity: number, touchExponent: number, dynComp: number): number {
  const v = Math.max(1, Math.min(127, velocity)) / 127;
  let g = Math.pow(v, touchExponent);
  if (dynComp > 0) {
    // Raise the floor of soft strokes; higher dynComp narrows the range more.
    const floor = 0.15 * dynComp; // 0.15 / 0.30 / 0.45
    g = floor + (1 - floor) * g;
  }
  return 0.08 + 0.85 * g;
}

/** Timbre tone shaping: returns a lowpass/highshelf tilt in dB + cutoff. */
export function timbreFilter(
  ctx: BaseAudioContext,
  timbre: number,
  family: 'acoustic' | 'electric',
): BiquadFilterNode | null {
  if (timbre <= 0) return null;
  const f = ctx.createBiquadFilter();
  // 1=Soft, 2=Mid, 3=Bright, 4=Dyno1, 5=Dyno2 (electric)
  switch (timbre) {
    case 1: // Soft — dampen highs
      f.type = 'lowpass';
      f.frequency.value = 2200;
      break;
    case 2: // Mid — midrange presence
      f.type = 'peaking';
      f.frequency.value = 1200;
      f.Q.value = 1;
      f.gain.value = 6;
      break;
    case 3: // Bright — treble lift
      f.type = 'highshelf';
      f.frequency.value = 3500;
      f.gain.value = 8;
      break;
    case 4: // Dyno 1 (electric preamp)
      f.type = 'highshelf';
      f.frequency.value = 2500;
      f.gain.value = 5;
      break;
    case 5: // Dyno 2 (more)
      f.type = 'highshelf';
      f.frequency.value = 2000;
      f.gain.value = 10;
      break;
    default:
      return null;
  }
  void family;
  return f;
}

// ---------------------------------------------------------------------------
// Sampled voice
// ---------------------------------------------------------------------------

class SampledVoice implements Voice {
  stopped = false;
  private readonly sources: AudioBufferSourceNode[] = [];
  private readonly gain: GainNode;
  private readonly filter: BiquadFilterNode | null;

  constructor(
    ctx: BaseAudioContext,
    readonly midi: number,
    buffer: AudioBuffer,
    rootMidi: number,
    params: VoiceParams,
    family: 'acoustic' | 'electric',
    private readonly onEnd: () => void,
  ) {
    this.gain = ctx.createGain();
    const peak = shapeVelocity(params.velocity, params.touchExponent, params.dynComp);
    this.filter = timbreFilter(ctx, params.timbre, family);
    let tail: AudioNode = this.gain;
    if (this.filter) {
      this.gain.connect(this.filter);
      tail = this.filter;
    }
    tail.connect(params.destination);

    const now = ctx.currentTime;
    this.gain.gain.setValueAtTime(0, now);
    this.gain.gain.linearRampToValueAtTime(peak, now + 0.004);

    const rate = midiToFrequency(midi) / midiToFrequency(rootMidi);
    const voiceCount = Math.max(1, params.unison + 1);
    const detuneSpread = params.unison * 6; // cents; wider with more unison
    for (let i = 0; i < voiceCount; i++) {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = rate;
      if (voiceCount > 1) {
        const offset = ((i / (voiceCount - 1)) * 2 - 1) * detuneSpread;
        src.detune.value = offset;
      }
      const vg = ctx.createGain();
      vg.gain.value = 1 / voiceCount;
      src.connect(vg).connect(this.gain);
      try {
        src.start(now);
      } catch {
        /* noop */
      }
      this.sources.push(src);
    }
    const last = this.sources[0];
    if (last) last.onended = () => this.reap();
  }

  release(soft: boolean): void {
    if (this.stopped) return;
    const ctx = this.gain.context;
    const now = ctx.currentTime;
    const rel = soft ? 0.5 : 0.28;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(0, now + rel);
    for (const src of this.sources) {
      try {
        src.stop(now + rel + 0.02);
      } catch {
        /* noop */
      }
    }
    this.stopped = true;
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const src of this.sources) {
      try {
        src.stop();
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
    if (this.filter) {
      try {
        this.filter.disconnect();
      } catch {
        /* noop */
      }
    }
    this.onEnd();
  }
}

export class Sampler {
  private readonly buffers = new Map<number, AudioBuffer>();
  private readonly roots: number[] = [];
  loaded = false;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly family: 'acoustic' | 'electric',
  ) {}

  add(rootMidi: number, buffer: AudioBuffer): void {
    this.buffers.set(rootMidi, buffer);
    this.roots.push(rootMidi);
    this.roots.sort((a, b) => a - b);
    this.loaded = this.buffers.size > 0;
  }

  get rootCount(): number {
    return this.buffers.size;
  }

  private nearestRoot(midi: number): number {
    let best = this.roots[0];
    let bestDist = Infinity;
    for (const r of this.roots) {
      const d = Math.abs(r - midi);
      if (d < bestDist) {
        bestDist = d;
        best = r;
      }
    }
    return best;
  }

  createVoice(midi: number, params: VoiceParams, onEnd: () => void): Voice | null {
    if (!this.loaded) return null;
    const root = this.nearestRoot(midi);
    const buffer = this.buffers.get(root)!;
    return new SampledVoice(this.ctx, midi, buffer, root, params, this.family, onEnd);
  }
}

// ---------------------------------------------------------------------------
// Synth voice (Clav / Digital / Misc — honest synthesis)
// ---------------------------------------------------------------------------

export type SynthRecipe = 'clav' | 'digital' | 'mallet';

class SynthVoice implements Voice {
  stopped = false;
  private readonly oscs: OscillatorNode[] = [];
  private readonly gain: GainNode;
  private readonly filter: BiquadFilterNode | null;

  constructor(
    ctx: BaseAudioContext,
    readonly midi: number,
    recipe: SynthRecipe,
    params: VoiceParams,
    family: 'acoustic' | 'electric',
    private readonly onEnd: () => void,
  ) {
    this.gain = ctx.createGain();
    this.filter = timbreFilter(ctx, params.timbre, family);
    let tail: AudioNode = this.gain;
    if (this.filter) {
      this.gain.connect(this.filter);
      tail = this.filter;
    }
    tail.connect(params.destination);

    const freq = midiToFrequency(midi);
    const peak = shapeVelocity(params.velocity, params.touchExponent, params.dynComp);
    const now = ctx.currentTime;

    const partials =
      recipe === 'clav'
        ? [
            { ratio: 1, gain: 1, type: 'sawtooth' as OscillatorType },
            { ratio: 2, gain: 0.3, type: 'square' as OscillatorType },
          ]
        : recipe === 'mallet'
          ? [
              { ratio: 1, gain: 1, type: 'sine' as OscillatorType },
              { ratio: 4, gain: 0.5, type: 'sine' as OscillatorType },
              { ratio: 9.2, gain: 0.15, type: 'sine' as OscillatorType },
            ]
          : [
              { ratio: 1, gain: 1, type: 'triangle' as OscillatorType },
              { ratio: 2, gain: 0.4, type: 'sine' as OscillatorType },
              { ratio: 3, gain: 0.15, type: 'sine' as OscillatorType },
            ];

    const voiceCount = Math.max(1, params.unison + 1);
    for (let u = 0; u < voiceCount; u++) {
      const detune = voiceCount > 1 ? ((u / (voiceCount - 1)) * 2 - 1) * params.unison * 6 : 0;
      for (const p of partials) {
        const osc = ctx.createOscillator();
        osc.type = p.type;
        osc.frequency.value = freq * p.ratio;
        osc.detune.value = detune;
        const g = ctx.createGain();
        g.gain.value = (p.gain * peak) / voiceCount;
        osc.connect(g).connect(this.gain);
        try {
          osc.start(now);
        } catch {
          /* noop */
        }
        this.oscs.push(osc);
      }
    }

    this.gain.gain.setValueAtTime(0, now);
    this.gain.gain.linearRampToValueAtTime(1, now + 0.004);
    if (recipe === 'mallet' || recipe === 'clav') {
      // Percussive decay.
      this.gain.gain.linearRampToValueAtTime(recipe === 'mallet' ? 0.0001 : 0.2, now + (recipe === 'mallet' ? 1.4 : 0.5));
    }
  }

  release(soft: boolean): void {
    if (this.stopped) return;
    const ctx = this.gain.context;
    const now = ctx.currentTime;
    const rel = soft ? 0.5 : 0.24;
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
    if (this.filter) {
      try {
        this.filter.disconnect();
      } catch {
        /* noop */
      }
    }
    this.onEnd();
  }
}

export function createSynthVoice(
  ctx: BaseAudioContext,
  midi: number,
  recipe: SynthRecipe,
  params: VoiceParams,
  family: 'acoustic' | 'electric',
  onEnd: () => void,
): Voice {
  return new SynthVoice(ctx, midi, recipe, params, family, onEnd);
}

// ---------------------------------------------------------------------------
// Sample loading (browser). Injectable fetch/decode for tests.
// ---------------------------------------------------------------------------

export interface SampleLoaderDeps {
  fetchBytes: (url: string) => Promise<ArrayBuffer>;
  decode: (bytes: ArrayBuffer) => Promise<AudioBuffer>;
  baseUrl?: string;
}

export async function loadSampler(
  ctx: BaseAudioContext,
  def: PianoTypeDef & { kind: 'sampled' },
  deps: SampleLoaderDeps,
): Promise<Sampler> {
  const base = deps.baseUrl ?? '';
  const manifestUrl = `${base}samples/${def.set}/manifest.json`;
  const manifestBytes = await deps.fetchBytes(manifestUrl);
  const manifest: SampleManifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  const sampler = new Sampler(ctx, def.family);
  await Promise.all(
    manifest.rootNotes.map(async (note) => {
      const bytes = await deps.fetchBytes(`${base}samples/${def.set}/${note.file}`);
      const buffer = await deps.decode(bytes);
      sampler.add(note.midi, buffer);
    }),
  );
  return sampler;
}
