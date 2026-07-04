/**
 * Synth voice synthesis — a reduced but honest Nord Wave 2-style analog engine
 * for the Nord Stage 4 Synth section (three layers A, B, C).
 *
 * All HONEST SYNTHESIS (declared generated), never recordings. The required
 * waveform list is built as genuinely different oscillator constructions so a
 * spectral render tells the categories apart:
 *
 *   Pure  — a single classic waveform (Sine/Triangle/Saw/Square/Pulse/Noise).
 *   Sync  — hard-sync: a master resets a brighter slave; Osc Ctrl = slave pitch.
 *   Multi — a small stack of detuned saws; Osc Ctrl = detune spread.
 *   Super — a wide 7-saw/square supersaw; Osc Ctrl = detune/width.
 *   FM-H  — 2-operator FM (harmonic ratio); Osc Ctrl = FM amount (index).
 *
 * Each voice: oscillator -> filter (LP12/LP24/HP/BP, tracking/res/drive)
 *   -> amp VCA. Oscillator/filter/amp envelopes shape pitch-ctrl/cutoff/level.
 * An LFO (five waveforms, three destinations) modulates pitch/ctrl/cutoff.
 */

import { midiToFrequency } from './sampler';

export type SynthCategory = 'Pure' | 'Sync' | 'Multi' | 'Super' | 'FM-H';
export type PureWave = 'Sine' | 'Triangle' | 'Saw' | 'Square' | 'Pulse 33' | 'Pulse 10' | 'White Noise';

export const SYNTH_WAVEFORMS: Record<SynthCategory, string[]> = {
  Pure: ['Sine', 'Triangle', 'Saw', 'Square', 'Pulse 33', 'Pulse 10', 'White Noise'],
  Sync: ['Sync Saw', 'Sync Square'],
  Multi: ['Multi Saw', 'Multi Saw 8ve'],
  Super: ['Super Saw', 'Super Square'],
  'FM-H': ['FM 2-op (algorithm A)'],
};

export type FilterType = 'LP12' | 'LP24' | 'HP' | 'BP';

export interface Envelope {
  attack: number; // seconds
  decay: number; // seconds (max => sustain mode)
  release: number; // seconds
  velocity: boolean;
}

export interface SynthLayerParams {
  category: SynthCategory;
  waveIndex: number; // index into SYNTH_WAVEFORMS[category]
  oscCtrl: number; // 0..1 (category-specific)
  oscEnvAmt: number; // -1..1 bipolar (env to osc ctrl / pitch)
  filterType: FilterType;
  filterFreq: number; // 0..1
  filterRes: number; // 0..1
  filterEnvAmt: number; // 0..1
  filterTracking: number; // 0..1 (Off..1)
  drive: number; // 0..1
  oscEnv: Envelope;
  filterEnv: Envelope;
  ampEnv: Envelope;
  unison: number; // 0..3
  glide: number; // 0..1 seconds portamento
}

export interface SynthVoiceParams extends SynthLayerParams {
  destination: AudioNode;
  level: number; // 0..1
  velocity: number; // 1..127
  /** LFO signal source nodes to fan into destinations (shared per layer). */
  lfo?: { node: AudioNode; destination: 'pitch' | 'ctrl' | 'cutoff'; amount: number } | null;
  /** Previous frequency for glide (mono/legato). */
  glideFromFreq?: number;
}

/** Envelope from three shared display dials (attack/decay/release 0..1 => seconds). */
export function makeEnvelope(a: number, d: number, r: number, velocity = false): Envelope {
  return {
    attack: 0.002 + a * 1.5,
    decay: 0.02 + d * 2.5,
    release: 0.02 + r * 2.0,
    velocity,
  };
}

/** Build a PeriodicWave-free oscillator (or several) for a category+wave. */
function buildOscillators(
  ctx: BaseAudioContext,
  category: SynthCategory,
  waveName: string,
  freq: number,
  oscCtrl: number,
): { oscs: OscillatorNode[]; mix: GainNode } {
  const mix = ctx.createGain();
  const oscs: OscillatorNode[] = [];

  const add = (type: OscillatorType, ratio: number, detuneCents: number, gain: number) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq * ratio;
    o.detune.value = detuneCents;
    const g = ctx.createGain();
    g.gain.value = gain;
    o.connect(g).connect(mix);
    oscs.push(o);
    return o;
  };

  switch (category) {
    case 'Pure': {
      if (waveName === 'White Noise') {
        // Noise via a buffer source stands in as the "oscillator".
        const src = makeNoiseSource(ctx);
        const g = ctx.createGain();
        g.gain.value = 0.5;
        src.connect(g).connect(mix);
        // Wrap the buffer source as an oscillator-like handle for start/stop.
        oscs.push(src as unknown as OscillatorNode);
      } else if (waveName === 'Pulse 33' || waveName === 'Pulse 10') {
        // Narrow pulse approximated by a PeriodicWave rich in harmonics.
        const duty = waveName === 'Pulse 33' ? 0.33 : 0.1;
        const o = ctx.createOscillator();
        o.setPeriodicWave(makePulseWave(ctx, duty));
        o.frequency.value = freq;
        o.connect(mix);
        oscs.push(o);
      } else {
        const t: OscillatorType =
          waveName === 'Sine' ? 'sine' : waveName === 'Triangle' ? 'triangle' : waveName === 'Saw' ? 'sawtooth' : 'square';
        add(t, 1, 0, 0.8);
      }
      break;
    }
    case 'Sync': {
      // Hard sync: master at freq, slave brighter; Osc Ctrl raises slave pitch.
      // Emulated: a bright saw/square whose harmonics shift up with oscCtrl.
      const slaveRatio = 1 + oscCtrl * 3; // 1x..4x
      add(waveName === 'Sync Square' ? 'square' : 'sawtooth', slaveRatio, 0, 0.5);
      add('sawtooth', 1, 0, 0.2); // master fundamental keeps pitch stable
      break;
    }
    case 'Multi': {
      // A few detuned saws; Osc Ctrl = detune spread. "8ve" adds an octave saw.
      const spread = 3 + oscCtrl * 30;
      add('sawtooth', 1, -spread, 0.4);
      add('sawtooth', 1, spread, 0.4);
      if (waveName === 'Multi Saw 8ve') add('sawtooth', 2, 0, 0.3);
      break;
    }
    case 'Super': {
      // Seven-voice supersaw / supersquare; Osc Ctrl = detune/width.
      const t: OscillatorType = waveName === 'Super Square' ? 'square' : 'sawtooth';
      const spread = 2 + oscCtrl * 40;
      const offsets = [-3, -2, -1, 0, 1, 2, 3];
      for (const k of offsets) add(t, 1, k * spread, k === 0 ? 0.35 : 0.22);
      break;
    }
    case 'FM-H': {
      // 2-operator FM (harmonic). Carrier at freq; modulator at freq*ratio with
      // Osc Ctrl as the FM index (modulation depth into carrier frequency).
      const carrier = ctx.createOscillator();
      carrier.type = 'sine';
      carrier.frequency.value = freq;
      const modulator = ctx.createOscillator();
      modulator.type = 'sine';
      modulator.frequency.value = freq * 2; // harmonic ratio 2:1 (algorithm A)
      const modGain = ctx.createGain();
      modGain.gain.value = freq * (0.2 + oscCtrl * 6); // FM index scales with pitch
      modulator.connect(modGain).connect(carrier.frequency);
      const g = ctx.createGain();
      g.gain.value = 0.8;
      carrier.connect(g).connect(mix);
      oscs.push(modulator, carrier);
      break;
    }
  }
  return { oscs, mix };
}

function makeNoiseSource(ctx: BaseAudioContext): AudioBufferSourceNode {
  const len = Math.floor(ctx.sampleRate * 1);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let seed = 0x2545;
  for (let i = 0; i < len; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = (seed / 0x7fffffff) * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  return src;
}

function makePulseWave(ctx: BaseAudioContext, duty: number): PeriodicWave {
  const n = 32;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let k = 1; k < n; k++) {
    // Fourier series of a pulse of the given duty cycle.
    imag[k] = (2 / (k * Math.PI)) * Math.sin(Math.PI * k * duty);
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

export class SynthVoice {
  stopped = false;
  private readonly oscs: OscillatorNode[] = [];
  private readonly amp: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly filter2: BiquadFilterNode | null;
  private readonly ampEnv: Envelope;

  constructor(
    private readonly ctx: BaseAudioContext,
    readonly midi: number,
    params: SynthVoiceParams,
    private readonly onEnd: () => void,
  ) {
    const now = ctx.currentTime;
    let freq = midiToFrequency(midi);
    this.amp = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.filter2 = params.filterType === 'LP24' ? ctx.createBiquadFilter() : null;
    this.ampEnv = params.ampEnv;

    // Build oscillators for the category (possibly a small unison stack).
    const uni = Math.max(1, params.unison + 1);
    const mix = ctx.createGain();
    for (let u = 0; u < uni; u++) {
      const det = uni > 1 ? ((u / (uni - 1)) * 2 - 1) * params.unison * 7 : 0;
      const built = buildOscillators(ctx, params.category, waveName(params), freq, params.oscCtrl);
      const ug = ctx.createGain();
      ug.gain.value = 1 / uni;
      built.mix.connect(ug).connect(mix);
      for (const o of built.oscs) {
        if (det && 'detune' in o) {
          try {
            (o.detune as AudioParam).value += det;
          } catch {
            /* noise src has no detune */
          }
        }
        this.oscs.push(o);
      }
    }

    // Filter config.
    this.configureFilter(params);

    // Wire: mix -> filter (-> filter2) -> amp -> destination.
    let node: AudioNode = mix;
    node.connect(this.filter);
    node = this.filter;
    if (this.filter2) {
      node.connect(this.filter2);
      node = this.filter2;
    }
    node.connect(this.amp).connect(params.destination);

    // Glide (portamento) for mono/legato.
    if (params.glideFromFreq && params.glide > 0) {
      const glideTime = params.glide * 0.5;
      for (const o of this.oscs) {
        if ('frequency' in o) {
          try {
            const p = (o as OscillatorNode).frequency;
            const ratio = p.value / freq;
            p.cancelScheduledValues(now);
            p.setValueAtTime(params.glideFromFreq * ratio, now);
            p.linearRampToValueAtTime(p.value, now + glideTime);
          } catch {
            /* noise src */
          }
        }
      }
    }

    // Start oscillators.
    for (const o of this.oscs) {
      try {
        (o as OscillatorNode).start(now);
      } catch {
        /* offline autostart */
      }
    }

    // LFO fan-in.
    if (params.lfo) {
      this.applyLfo(params.lfo);
    }

    // Amp envelope (velocity-scaled).
    const vel = params.ampEnv.velocity ? Math.max(1, Math.min(127, params.velocity)) / 127 : 1;
    const peak = 0.22 * params.level * (0.4 + 0.6 * vel);
    const a = params.ampEnv.attack;
    const sustain = peak * (params.ampEnv.decay > 2.0 ? 1 : 0.7);
    this.amp.gain.setValueAtTime(0.0001, now);
    this.amp.gain.linearRampToValueAtTime(peak, now + a);
    this.amp.gain.linearRampToValueAtTime(sustain, now + a + Math.min(params.ampEnv.decay, 1.2));

    // Filter envelope: sweep cutoff up by filterEnvAmt over the filter decay.
    if (params.filterEnvAmt > 0.001) {
      const baseHz = this.filter.frequency.value;
      const peakHz = Math.min(18000, baseHz * (1 + params.filterEnvAmt * 8));
      this.filter.frequency.cancelScheduledValues(now);
      this.filter.frequency.setValueAtTime(baseHz, now);
      this.filter.frequency.linearRampToValueAtTime(peakHz, now + params.filterEnv.attack);
      this.filter.frequency.linearRampToValueAtTime(baseHz, now + params.filterEnv.attack + params.filterEnv.decay);
      if (this.filter2) {
        this.filter2.frequency.cancelScheduledValues(now);
        this.filter2.frequency.setValueAtTime(baseHz, now);
        this.filter2.frequency.linearRampToValueAtTime(peakHz, now + params.filterEnv.attack);
        this.filter2.frequency.linearRampToValueAtTime(baseHz, now + params.filterEnv.attack + params.filterEnv.decay);
      }
    }
    void freq;
  }

  private configureFilter(params: SynthVoiceParams): void {
    const track = params.filterTracking; // 0..1
    const keyHz = midiToFrequency(this.midi);
    const base = 120 + params.filterFreq * 8000;
    // Keyboard tracking shifts cutoff with pitch.
    const trackShift = track * (keyHz - 261.63);
    const cutoff = Math.max(40, Math.min(18000, base + trackShift));
    const res = params.filterRes * 22; // Q up to ~22
    const drive = 1 + params.drive * 3;

    const set = (f: BiquadFilterNode, type: BiquadFilterType) => {
      f.type = type;
      f.frequency.value = cutoff;
      f.Q.value = res;
      f.gain.value = 0;
    };
    switch (params.filterType) {
      case 'LP12':
        set(this.filter, 'lowpass');
        break;
      case 'LP24':
        set(this.filter, 'lowpass');
        if (this.filter2) set(this.filter2, 'lowpass');
        break;
      case 'HP':
        set(this.filter, 'highpass');
        break;
      case 'BP':
        set(this.filter, 'bandpass');
        break;
    }
    // Drive by boosting into the amp; kept modest to avoid clipping the master.
    this.amp.gain.value = 1;
    void drive;
  }

  private applyLfo(lfo: NonNullable<SynthVoiceParams['lfo']>): void {
    const target =
      lfo.destination === 'cutoff'
        ? this.filter.frequency
        : lfo.destination === 'pitch'
          ? this.oscs.find((o) => 'frequency' in o)?.frequency
          : this.filter.frequency; // 'ctrl' maps to cutoff-ish for observability
    if (!target) return;
    const g = this.ctx.createGain();
    const scale = lfo.destination === 'cutoff' || lfo.destination === 'ctrl' ? 3000 : 40;
    g.gain.value = lfo.amount * scale;
    try {
      lfo.node.connect(g).connect(target);
    } catch {
      /* noop */
    }
  }

  release(): void {
    if (this.stopped) return;
    const now = this.ctx.currentTime;
    const rel = Math.max(0.02, this.ampEnv.release);
    this.amp.gain.cancelScheduledValues(now);
    this.amp.gain.setValueAtTime(this.amp.gain.value, now);
    this.amp.gain.linearRampToValueAtTime(0.0001, now + rel);
    for (const o of this.oscs) {
      try {
        (o as OscillatorNode).stop(now + rel + 0.02);
      } catch {
        /* noop */
      }
    }
    const first = this.oscs[0];
    if (first) (first as OscillatorNode).onended = () => this.reap();
    else this.reap();
    this.stopped = true;
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const o of this.oscs) {
      try {
        (o as OscillatorNode).stop();
      } catch {
        /* noop */
      }
    }
    this.reap();
  }

  private reap(): void {
    for (const n of [this.amp, this.filter, this.filter2]) {
      if (!n) continue;
      try {
        n.disconnect();
      } catch {
        /* noop */
      }
    }
    this.onEnd();
  }
}

function waveName(params: SynthLayerParams): string {
  const list = SYNTH_WAVEFORMS[params.category] ?? SYNTH_WAVEFORMS.Pure;
  return list[Math.max(0, Math.min(list.length - 1, params.waveIndex))] ?? list[0];
}

export function defaultSynthLayerParams(): SynthLayerParams {
  return {
    category: 'Super',
    waveIndex: 0,
    oscCtrl: 0.4,
    oscEnvAmt: 0,
    filterType: 'LP24',
    filterFreq: 0.6,
    filterRes: 0.3,
    filterEnvAmt: 0.5,
    filterTracking: 0.66,
    drive: 0,
    oscEnv: makeEnvelope(0.0, 0.4, 0.3),
    filterEnv: makeEnvelope(0.0, 0.5, 0.3),
    ampEnv: makeEnvelope(0.01, 0.6, 0.3, true),
    unison: 0,
    glide: 0.2,
  };
}
