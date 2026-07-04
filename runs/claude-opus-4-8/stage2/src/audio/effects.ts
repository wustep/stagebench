/**
 * Layer effect units for the Nord Stage 4 Layer Effects section.
 *
 * Every unit is a real Web Audio subgraph with an input node, an output node, a
 * bypass path (dry) and a wet path, and click-free parameter ramps. Units are
 * built on a BaseAudioContext so they can be exercised in an OfflineAudioContext
 * during tests (rendered-audio assertions, not mocks).
 *
 * Signal order per layer (effects spec signalContract.requiredOrder):
 *   source -> Mod 1 -> Mod 2 -> Delay -> Amp Sim/EQ (or Filter) -> Compressor
 *          -> Reverb -> [Rotary when routed] -> layer level -> master -> dest
 *
 * "To Rotary" is the Amp/EQ model that reroutes the layer into the shared Rotary
 * placed AFTER Reverb (reverb always precedes rotary here — see spec excluded).
 */

const RAMP = 0.02; // 20 ms — short, click-free parameter ramp.

function ramp(param: AudioParam, value: number, ctx: BaseAudioContext, time = RAMP): void {
  const now = ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(value, now + time);
}

export interface EffectUnit {
  readonly input: AudioNode;
  readonly output: AudioNode;
  /** Turn the whole unit on/off (bypass = fully dry). Click-free. */
  setBypassed(bypassed: boolean): void;
  readonly bypassed: boolean;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Dry/wet mixer shared by units that have a wet path.
// ---------------------------------------------------------------------------

interface WetDryNodes {
  input: GainNode;
  output: GainNode;
  dry: GainNode;
  wet: GainNode;
}

function makeWetDry(ctx: BaseAudioContext): WetDryNodes {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  input.connect(dry).connect(output);
  // wet is connected to output by the caller after the wet processing chain.
  wet.connect(output);
  return { input, output, dry, wet };
}

// ---------------------------------------------------------------------------
// Mod 1 — A-Pan / Tremolo / Ring Mod / A-Wah / Wah / Pump
// ---------------------------------------------------------------------------

export type Mod1Type = 'A-Pan' | 'Tremolo' | 'Ring Mod' | 'A-Wah' | 'Wah' | 'Pump';
export const MOD1_TYPES: readonly Mod1Type[] = ['A-Pan', 'Tremolo', 'Ring Mod', 'A-Wah', 'Wah', 'Pump'];

export class Mod1Unit implements EffectUnit {
  readonly input: GainNode;
  readonly output: GainNode;
  bypassed = false;
  private type: Mod1Type = 'Tremolo';
  private rate = 0.4;
  private amount = 0.5;
  private readonly ctx: BaseAudioContext;
  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private lfo: OscillatorNode;
  private lfoGain: GainNode;
  // shared processing nodes; only some are used per type
  private readonly amp: GainNode; // tremolo/pump amplitude
  private readonly panner: StereoPannerNode;
  private readonly ringGain: GainNode; // ring mod: signal * sine
  private readonly ringOsc: OscillatorNode;
  private readonly filter: BiquadFilterNode; // wah
  private readonly disposers: Array<() => void> = [];

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    const nodes = makeWetDry(ctx);
    this.input = nodes.input;
    this.output = nodes.output;
    this.dry = nodes.dry;
    this.wet = nodes.wet;

    this.amp = ctx.createGain();
    this.panner = ctx.createStereoPanner();
    this.ringGain = ctx.createGain();
    this.ringGain.gain.value = 0;
    this.ringOsc = ctx.createOscillator();
    this.ringOsc.frequency.value = 200;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 800;
    this.filter.Q.value = 6;

    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 4;
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = 0.5;

    // default wet chain: tremolo (input -> amp -> wet)
    this.input.connect(this.amp).connect(this.wet);
    this.lfo.connect(this.lfoGain).connect(this.amp.gain);
    this.amp.gain.value = 1;

    try {
      this.lfo.start();
      this.ringOsc.start();
    } catch {
      /* offline autostart differences */
    }
    this.applyRouting();
    this.setBypassed(false);
  }

  private disconnectWet(): void {
    for (const n of [this.amp, this.panner, this.ringGain, this.filter]) {
      try {
        n.disconnect();
      } catch {
        /* noop */
      }
    }
    try {
      this.input.disconnect(this.amp);
    } catch {
      /* noop */
    }
    // rebuild base input->? handled by applyRouting
  }

  private applyRouting(): void {
    // Reset input fanout (dry stays connected separately).
    try {
      this.input.disconnect();
    } catch {
      /* noop */
    }
    this.input.connect(this.dry);
    this.disconnectWet();
    // reconnect lfo target below per type
    try {
      this.lfoGain.disconnect();
    } catch {
      /* noop */
    }

    const depth = this.amount;
    switch (this.type) {
      case 'A-Pan': {
        this.input.connect(this.panner).connect(this.wet);
        this.lfoGain.connect(this.panner.pan);
        ramp(this.lfoGain.gain, depth, this.ctx);
        ramp(this.panner.pan, 0, this.ctx);
        break;
      }
      case 'Tremolo': {
        this.input.connect(this.amp).connect(this.wet);
        this.lfoGain.connect(this.amp.gain);
        // Full level at zero amount (spec): base 1, subtract depth*lfo.
        ramp(this.amp.gain, 1 - depth * 0.5, this.ctx);
        ramp(this.lfoGain.gain, depth * 0.5, this.ctx);
        break;
      }
      case 'Pump': {
        this.input.connect(this.amp).connect(this.wet);
        this.lfoGain.connect(this.amp.gain);
        ramp(this.amp.gain, 1 - depth * 0.7, this.ctx);
        ramp(this.lfoGain.gain, depth * 0.7, this.ctx);
        break;
      }
      case 'Ring Mod': {
        // signal * sine: multiply by connecting osc to a gain whose input is signal.
        this.input.connect(this.ringGain).connect(this.wet);
        this.ringGain.gain.value = 0;
        this.ringOsc.connect(this.ringGain.gain);
        break;
      }
      case 'Wah':
      case 'A-Wah': {
        this.input.connect(this.filter).connect(this.wet);
        this.lfoGain.connect(this.filter.frequency);
        ramp(this.filter.frequency, 500 + depth * 1500, this.ctx);
        ramp(this.lfoGain.gain, this.type === 'Wah' ? 1200 * depth : 400 * depth, this.ctx);
        this.filter.Q.value = 4 + depth * 8;
        break;
      }
    }
    this.setBypassed(this.bypassed);
  }

  setType(type: Mod1Type): void {
    if (type === this.type) return;
    this.type = type;
    this.applyRouting();
  }

  setRate(v: number): void {
    this.rate = v;
    ramp(this.lfo.frequency, 0.2 + v * 12, this.ctx);
    if (this.type === 'Ring Mod') ramp(this.ringOsc.frequency, 40 + v * 900, this.ctx);
  }

  setAmount(v: number): void {
    this.amount = v;
    this.applyRouting();
  }

  setBypassed(bypassed: boolean): void {
    this.bypassed = bypassed;
    ramp(this.dry.gain, bypassed ? 1 : 0, this.ctx);
    ramp(this.wet.gain, bypassed ? 0 : 1, this.ctx);
  }

  dispose(): void {
    for (const d of this.disposers) d();
    for (const n of [this.lfo, this.ringOsc]) {
      try {
        n.stop();
      } catch {
        /* noop */
      }
    }
    for (const n of [this.input, this.output, this.dry, this.wet, this.amp, this.panner, this.ringGain, this.filter, this.lfoGain]) {
      try {
        n.disconnect();
      } catch {
        /* noop */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Mod 2 — Chorus / Flanger / Phaser / Vibe / Ensemble / Spin
// ---------------------------------------------------------------------------

export type Mod2Type = 'Chorus' | 'Flanger' | 'Phaser' | 'Vibe' | 'Ensemble' | 'Spin';
export const MOD2_TYPES: readonly Mod2Type[] = ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin'];

export class Mod2Unit implements EffectUnit {
  readonly input: GainNode;
  readonly output: GainNode;
  bypassed = false;
  private type: Mod2Type = 'Chorus';
  private rate = 0.35;
  private amount = 0.5;
  private readonly ctx: BaseAudioContext;
  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private readonly lfo: OscillatorNode;
  private readonly lfoGain: GainNode;
  private readonly delay: DelayNode;
  private readonly feedback: GainNode;
  private readonly allpass: BiquadFilterNode;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    const nodes = makeWetDry(ctx);
    this.input = nodes.input;
    this.output = nodes.output;
    this.dry = nodes.dry;
    this.wet = nodes.wet;

    this.delay = ctx.createDelay(0.05);
    this.delay.delayTime.value = 0.008;
    this.feedback = ctx.createGain();
    this.feedback.gain.value = 0;
    this.allpass = ctx.createBiquadFilter();
    this.allpass.type = 'allpass';
    this.allpass.frequency.value = 800;

    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 1.2;
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = 0.003;
    try {
      this.lfo.start();
    } catch {
      /* noop */
    }
    this.applyRouting();
    this.setBypassed(false);
  }

  private applyRouting(): void {
    try {
      this.input.disconnect();
    } catch {
      /* noop */
    }
    for (const n of [this.delay, this.feedback, this.allpass]) {
      try {
        n.disconnect();
      } catch {
        /* noop */
      }
    }
    try {
      this.lfoGain.disconnect();
    } catch {
      /* noop */
    }
    this.input.connect(this.dry);
    const depth = this.amount;

    if (this.type === 'Phaser' || this.type === 'Vibe') {
      this.input.connect(this.allpass).connect(this.wet);
      this.lfoGain.connect(this.allpass.frequency);
      ramp(this.lfoGain.gain, 400 + depth * 1200, this.ctx);
      this.feedback.gain.value = this.type === 'Vibe' ? 0.4 : depth * 0.5;
      this.allpass.connect(this.feedback).connect(this.allpass);
    } else {
      // Chorus / Flanger / Ensemble / Spin: modulated delay line.
      this.input.connect(this.delay).connect(this.wet);
      this.lfoGain.connect(this.delay.delayTime);
      const base =
        this.type === 'Flanger' ? 0.003 : this.type === 'Ensemble' ? 0.02 : 0.012;
      this.delay.delayTime.value = base;
      ramp(this.lfoGain.gain, (this.type === 'Flanger' ? 0.002 : 0.004) * (0.4 + depth), this.ctx);
      // Flanger has feedback; chorus/ensemble/spin light or none.
      this.feedback.gain.value = this.type === 'Flanger' ? depth * 0.6 : 0;
      this.delay.connect(this.feedback).connect(this.delay);
    }
    this.setBypassed(this.bypassed);
  }

  setType(type: Mod2Type): void {
    if (type === this.type) return;
    this.type = type;
    this.applyRouting();
  }

  setRate(v: number): void {
    this.rate = v;
    const hz = this.type === 'Spin' ? 0.1 + v * 2 : 0.1 + v * 6;
    ramp(this.lfo.frequency, hz, this.ctx, this.type === 'Spin' ? 0.4 : RAMP);
  }

  setAmount(v: number): void {
    this.amount = v;
    this.applyRouting();
  }

  setBypassed(bypassed: boolean): void {
    this.bypassed = bypassed;
    ramp(this.dry.gain, bypassed ? 1 : 0, this.ctx);
    ramp(this.wet.gain, bypassed ? 0 : 1, this.ctx);
  }

  dispose(): void {
    try {
      this.lfo.stop();
    } catch {
      /* noop */
    }
    for (const n of [this.input, this.output, this.dry, this.wet, this.delay, this.feedback, this.allpass, this.lfoGain]) {
      try {
        n.disconnect();
      } catch {
        /* noop */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Delay — tempo, feedback, dry/wet, feedback filter (repeats get progressively
// filtered because the filter sits inside the feedback loop). Ping-pong optional.
// ---------------------------------------------------------------------------

export type DelayFilterType = 'LP' | 'HP' | 'BP';

export class DelayUnit implements EffectUnit {
  readonly input: GainNode;
  readonly output: GainNode;
  bypassed = false;
  private readonly ctx: BaseAudioContext;
  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private readonly delayL: DelayNode;
  private readonly delayR: DelayNode;
  private readonly feedback: GainNode;
  private readonly fbFilter: BiquadFilterNode;
  private readonly merger: ChannelMergerNode;
  private pingPong = false;
  private wetTarget = 0.3;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    const nodes = makeWetDry(ctx);
    this.input = nodes.input;
    this.output = nodes.output;
    this.dry = nodes.dry;
    this.wet = nodes.wet;
    this.wet.gain.value = 0.3;
    this.dry.gain.value = 0.7;

    this.delayL = ctx.createDelay(2.5);
    this.delayR = ctx.createDelay(2.5);
    this.delayL.delayTime.value = 0.3;
    this.delayR.delayTime.value = 0.3;
    this.feedback = ctx.createGain();
    this.feedback.gain.value = 0.4;
    this.fbFilter = ctx.createBiquadFilter();
    this.fbFilter.type = 'lowpass';
    this.fbFilter.frequency.value = 3000;
    this.merger = ctx.createChannelMerger(2);

    this.buildLoop();
    this.setBypassed(false);
  }

  private buildLoop(): void {
    // input -> delayL -> fbFilter -> feedback -> back into delay (repeats filtered)
    // input -> delayL -> wet (repeats audible)
    this.input.connect(this.delayL);
    this.delayL.connect(this.fbFilter);
    this.fbFilter.connect(this.feedback);
    if (this.pingPong) {
      this.feedback.connect(this.delayR);
      this.delayR.connect(this.delayL);
      this.delayL.connect(this.wet);
      this.delayR.connect(this.wet);
    } else {
      this.feedback.connect(this.delayL);
      this.delayL.connect(this.wet);
    }
  }

  setTempo(v: number): void {
    // 0..1 -> 60ms..1.2s
    const t = 0.06 + v * 1.14;
    ramp(this.delayL.delayTime, t, this.ctx);
    ramp(this.delayR.delayTime, t, this.ctx);
  }

  setFeedback(v: number): void {
    ramp(this.feedback.gain, Math.min(0.9, v * 0.9), this.ctx);
  }

  private applyMix(): void {
    const wet = this.bypassed ? 0 : this.wetTarget;
    const dry = this.bypassed ? 1 : 1 - this.wetTarget * 0.5;
    ramp(this.wet.gain, wet, this.ctx);
    ramp(this.dry.gain, dry, this.ctx);
  }

  setDryWet(v: number): void {
    this.wetTarget = v;
    this.applyMix();
  }

  setFilter(type: DelayFilterType): void {
    this.fbFilter.type = type === 'LP' ? 'lowpass' : type === 'HP' ? 'highpass' : 'bandpass';
    this.fbFilter.frequency.value = type === 'HP' ? 800 : type === 'BP' ? 1200 : 3000;
  }

  setPingPong(on: boolean): void {
    if (on === this.pingPong) return;
    this.pingPong = on;
    try {
      this.input.disconnect();
      this.delayL.disconnect();
      this.delayR.disconnect();
      this.feedback.disconnect();
      this.fbFilter.disconnect();
    } catch {
      /* noop */
    }
    this.input.connect(this.dry);
    this.buildLoop();
    this.setBypassed(this.bypassed);
  }

  setBypassed(bypassed: boolean): void {
    this.bypassed = bypassed;
    this.applyMix();
  }

  dispose(): void {
    for (const n of [this.input, this.output, this.dry, this.wet, this.delayL, this.delayR, this.feedback, this.fbFilter, this.merger]) {
      try {
        n.disconnect();
      } catch {
        /* noop */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Amp Sim / EQ — EQ only / Twin / JC / Small / LP24 / HP24 / To Rotary
// ---------------------------------------------------------------------------

export type AmpModel = 'EQ only' | 'Twin' | 'JC' | 'Small' | 'LP24 Filter' | 'HP24 Filter' | 'To Rotary';
export const AMP_MODELS: readonly AmpModel[] = ['EQ only', 'Twin', 'JC', 'Small', 'LP24 Filter', 'HP24 Filter', 'To Rotary'];

export class AmpEqUnit implements EffectUnit {
  readonly input: GainNode;
  readonly output: GainNode;
  bypassed = false;
  private model: AmpModel = 'EQ only';
  private readonly ctx: BaseAudioContext;
  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private readonly drive: WaveShaperNode;
  private readonly preGain: GainNode;
  private readonly postGain: GainNode;
  private readonly bass: BiquadFilterNode;
  private readonly mid: BiquadFilterNode;
  private readonly treble: BiquadFilterNode;
  private readonly filter24a: BiquadFilterNode;
  private readonly filter24b: BiquadFilterNode;
  /** When true the layer routes into the shared rotary (To Rotary). */
  routeToRotary = false;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    const nodes = makeWetDry(ctx);
    this.input = nodes.input;
    this.output = nodes.output;
    this.dry = nodes.dry;
    this.wet = nodes.wet;

    this.preGain = ctx.createGain();
    this.postGain = ctx.createGain();
    this.drive = ctx.createWaveShaper();
    // Fixed soft-clip curve; drive intensity is modulated via pre/post gain so we
    // never reassign the curve (some engines forbid reassigning it).
    this.drive.curve = makeDriveCurve(1);
    this.bass = ctx.createBiquadFilter();
    this.bass.type = 'lowshelf';
    this.bass.frequency.value = 100;
    this.mid = ctx.createBiquadFilter();
    this.mid.type = 'peaking';
    this.mid.frequency.value = 1000;
    this.mid.Q.value = 1;
    this.treble = ctx.createBiquadFilter();
    this.treble.type = 'highshelf';
    this.treble.frequency.value = 4000;
    this.filter24a = ctx.createBiquadFilter();
    this.filter24a.type = 'lowpass';
    this.filter24a.frequency.value = 2000;
    this.filter24b = ctx.createBiquadFilter();
    this.filter24b.type = 'lowpass';
    this.filter24b.frequency.value = 2000;

    this.applyRouting();
    this.setBypassed(false);
  }

  private applyRouting(): void {
    for (const n of [this.input, this.preGain, this.drive, this.postGain, this.bass, this.mid, this.treble, this.filter24a, this.filter24b]) {
      try {
        n.disconnect();
      } catch {
        /* noop */
      }
    }
    this.input.connect(this.dry);

    if (this.model === 'LP24 Filter' || this.model === 'HP24 Filter') {
      const type = this.model === 'LP24 Filter' ? 'lowpass' : 'highpass';
      this.filter24a.type = type;
      this.filter24b.type = type;
      this.input.connect(this.filter24a).connect(this.filter24b).connect(this.wet);
    } else {
      // EQ + optional amp drive coloration.
      this.input
        .connect(this.preGain)
        .connect(this.drive)
        .connect(this.bass)
        .connect(this.mid)
        .connect(this.treble)
        .connect(this.postGain)
        .connect(this.wet);
      // Amp model voicing.
      switch (this.model) {
        case 'Twin':
          this.treble.gain.value = 4;
          this.mid.gain.value = -2;
          break;
        case 'JC':
          this.treble.gain.value = 6;
          this.bass.gain.value = 2;
          break;
        case 'Small':
          this.mid.gain.value = 4;
          this.treble.gain.value = -3;
          break;
        default:
          break;
      }
    }
    this.routeToRotary = this.model === 'To Rotary';
    this.setBypassed(this.bypassed);
  }

  setModel(model: AmpModel): void {
    if (model === this.model) return;
    this.model = model;
    this.applyRouting();
  }

  setDrive(v: number): void {
    // Push harder into the fixed soft-clip curve, then compensate level.
    ramp(this.preGain.gain, 1 + v * 6, this.ctx);
    ramp(this.postGain.gain, 1 / (1 + v * 2), this.ctx);
  }

  setBass(v: number): void {
    ramp(this.bass.gain, (v - 0.5) * 30, this.ctx);
  }
  setMid(v: number): void {
    if (this.model === 'LP24 Filter' || this.model === 'HP24 Filter') {
      this.filter24a.Q.value = v * 12;
      this.filter24b.Q.value = v * 6;
    } else {
      ramp(this.mid.gain, (v - 0.5) * 30, this.ctx);
    }
  }
  setTreble(v: number): void {
    ramp(this.treble.gain, (v - 0.5) * 30, this.ctx);
  }
  setFreq(v: number): void {
    const hz = 200 + v * 7800;
    if (this.model === 'LP24 Filter' || this.model === 'HP24 Filter') {
      ramp(this.filter24a.frequency, hz, this.ctx);
      ramp(this.filter24b.frequency, hz, this.ctx);
    } else {
      ramp(this.mid.frequency, hz, this.ctx);
    }
  }

  setBypassed(bypassed: boolean): void {
    this.bypassed = bypassed;
    ramp(this.dry.gain, bypassed ? 1 : 0, this.ctx);
    ramp(this.wet.gain, bypassed ? 0 : 1, this.ctx);
  }

  dispose(): void {
    for (const n of [this.input, this.output, this.dry, this.wet, this.preGain, this.postGain, this.bass, this.mid, this.treble, this.filter24a, this.filter24b]) {
      try {
        n.disconnect();
      } catch {
        /* noop */
      }
    }
  }
}

function makeDriveCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const k = amount * 50;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = k < 0.001 ? x : ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

// ---------------------------------------------------------------------------
// Compressor
// ---------------------------------------------------------------------------

export class CompressorUnit implements EffectUnit {
  readonly input: GainNode;
  readonly output: GainNode;
  bypassed = false;
  private readonly ctx: BaseAudioContext;
  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private readonly comp: DynamicsCompressorNode;
  private readonly makeup: GainNode;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    const nodes = makeWetDry(ctx);
    this.input = nodes.input;
    this.output = nodes.output;
    this.dry = nodes.dry;
    this.wet = nodes.wet;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.01;
    this.comp.release.value = 0.2;
    this.makeup = ctx.createGain();
    this.makeup.gain.value = 1;
    this.input.connect(this.comp).connect(this.makeup).connect(this.wet);
    this.setBypassed(false);
  }

  setAmount(v: number): void {
    // More amount -> lower threshold + higher ratio + makeup gain.
    ramp(this.comp.threshold, -6 - v * 42, this.ctx);
    this.comp.ratio.value = 2 + v * 18;
    ramp(this.makeup.gain, 1 + v * 1.5, this.ctx);
  }

  setFast(fast: boolean): void {
    this.comp.attack.value = fast ? 0.002 : 0.02;
    this.comp.release.value = fast ? 0.05 : 0.25;
  }

  setBypassed(bypassed: boolean): void {
    this.bypassed = bypassed;
    ramp(this.dry.gain, bypassed ? 1 : 0, this.ctx);
    ramp(this.wet.gain, bypassed ? 0 : 1, this.ctx);
  }

  dispose(): void {
    for (const n of [this.input, this.output, this.dry, this.wet, this.comp, this.makeup]) {
      try {
        n.disconnect();
      } catch {
        /* noop */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Reverb — convolution with a generated impulse per type.
// ---------------------------------------------------------------------------

export type ReverbType = 'Room' | 'Booth' | 'Spring' | 'Stage' | 'Hall' | 'Cathedral';
export const REVERB_TYPES: readonly ReverbType[] = ['Room', 'Booth', 'Spring', 'Stage', 'Hall', 'Cathedral'];

const REVERB_DECAY: Record<ReverbType, number> = {
  Booth: 0.4,
  Room: 0.9,
  Stage: 1.6,
  Spring: 1.2,
  Hall: 2.8,
  Cathedral: 4.5,
};

export class ReverbUnit implements EffectUnit {
  readonly input: GainNode;
  readonly output: GainNode;
  bypassed = false;
  private type: ReverbType = 'Room';
  private wetTarget = 0.35;
  private readonly ctx: BaseAudioContext;
  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private readonly convolver: ConvolverNode;
  private readonly tone: BiquadFilterNode;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    const nodes = makeWetDry(ctx);
    this.input = nodes.input;
    this.output = nodes.output;
    this.dry = nodes.dry;
    this.wet = nodes.wet;

    this.convolver = ctx.createConvolver();
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'highshelf';
    this.tone.frequency.value = 3000;
    this.tone.gain.value = 0;
    this.input.connect(this.convolver).connect(this.tone).connect(this.wet);
    this.setType('Room');
    this.setBypassed(false);
  }

  private applyMix(): void {
    const wet = this.bypassed ? 0 : this.wetTarget;
    const dry = this.bypassed ? 1 : 1 - this.wetTarget; // fully wet at max
    ramp(this.wet.gain, wet, this.ctx);
    ramp(this.dry.gain, dry, this.ctx);
  }

  setType(type: ReverbType): void {
    this.type = type;
    this.convolver.buffer = makeImpulse(this.ctx, REVERB_DECAY[type], type === 'Spring');
  }

  setDryWet(v: number): void {
    this.wetTarget = v;
    this.applyMix();
  }

  setTone(dark: boolean): void {
    ramp(this.tone.gain, dark ? -12 : 4, this.ctx);
  }

  setBypassed(bypassed: boolean): void {
    this.bypassed = bypassed;
    this.applyMix();
  }

  dispose(): void {
    for (const n of [this.input, this.output, this.dry, this.wet, this.convolver, this.tone]) {
      try {
        n.disconnect();
      } catch {
        /* noop */
      }
    }
  }
}

/** Deterministic PRNG (mulberry32) so impulse responses are reproducible in tests. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeImpulse(ctx: BaseAudioContext, seconds: number, spring: boolean): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buffer = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    const rnd = mulberry32(0x1234 + ch * 7 + Math.floor(seconds * 1000));
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const env = Math.pow(1 - t, spring ? 1.5 : 2.5);
      let s = (rnd() * 2 - 1) * env;
      if (spring) {
        // Add a resonant boingy ring for spring character.
        s += Math.sin((i / rate) * 2 * Math.PI * 220) * env * 0.4;
      }
      data[i] = s;
    }
  }
  return buffer;
}

// ---------------------------------------------------------------------------
// Rotary — shared unit (horn + bass rotor), reached via To Rotary / organ.
// ---------------------------------------------------------------------------

export class RotaryUnit implements EffectUnit {
  readonly input: GainNode;
  readonly output: GainNode;
  bypassed = false;
  private readonly ctx: BaseAudioContext;
  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private readonly hornPan: StereoPannerNode;
  private readonly hornAmp: GainNode;
  private readonly bassAmp: GainNode;
  private readonly split: BiquadFilterNode;
  private readonly bassSplit: BiquadFilterNode;
  private readonly hornLfo: OscillatorNode;
  private readonly hornPanGain: GainNode;
  private readonly hornAmpGain: GainNode;
  private readonly bassLfo: OscillatorNode;
  private readonly bassAmpGain: GainNode;
  private fast = false;
  private drive = 0.2;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    const nodes = makeWetDry(ctx);
    this.input = nodes.input;
    this.output = nodes.output;
    this.dry = nodes.dry;
    this.wet = nodes.wet;
    this.dry.gain.value = 0; // rotary is fully wet when engaged

    this.split = ctx.createBiquadFilter();
    this.split.type = 'highpass';
    this.split.frequency.value = 800;
    this.bassSplit = ctx.createBiquadFilter();
    this.bassSplit.type = 'lowpass';
    this.bassSplit.frequency.value = 800;

    this.hornPan = ctx.createStereoPanner();
    this.hornAmp = ctx.createGain();
    this.bassAmp = ctx.createGain();

    this.input.connect(this.split).connect(this.hornAmp).connect(this.hornPan).connect(this.wet);
    this.input.connect(this.bassSplit).connect(this.bassAmp).connect(this.wet);

    this.hornLfo = ctx.createOscillator();
    this.hornLfo.frequency.value = 1;
    this.hornPanGain = ctx.createGain();
    this.hornPanGain.gain.value = 0.8;
    this.hornAmpGain = ctx.createGain();
    this.hornAmpGain.gain.value = 0.2;
    this.hornLfo.connect(this.hornPanGain).connect(this.hornPan.pan);
    this.hornLfo.connect(this.hornAmpGain).connect(this.hornAmp.gain);
    this.hornAmp.gain.value = 1;

    this.bassLfo = ctx.createOscillator();
    this.bassLfo.frequency.value = 0.9;
    this.bassAmpGain = ctx.createGain();
    this.bassAmpGain.gain.value = 0.1;
    this.bassLfo.connect(this.bassAmpGain).connect(this.bassAmp.gain);
    this.bassAmp.gain.value = 1;

    try {
      this.hornLfo.start();
      this.bassLfo.start();
    } catch {
      /* noop */
    }
    this.setBypassed(false);
  }

  setSpeed(fast: boolean): void {
    this.fast = fast;
    // Speeds accelerate smoothly (long ramp).
    ramp(this.hornLfo.frequency, fast ? 6.5 : 0.8, this.ctx, 1.2);
    ramp(this.bassLfo.frequency, fast ? 5.5 : 0.7, this.ctx, 1.5);
  }

  setDrive(v: number): void {
    this.drive = v;
    ramp(this.hornAmpGain.gain, 0.15 + v * 0.4, this.ctx);
  }

  setBypassed(bypassed: boolean): void {
    this.bypassed = bypassed;
    // When bypassed the rotary passes dry (no rotation).
    ramp(this.dry.gain, bypassed ? 1 : 0, this.ctx);
    ramp(this.wet.gain, bypassed ? 0 : 1, this.ctx);
  }

  dispose(): void {
    for (const n of [this.hornLfo, this.bassLfo]) {
      try {
        n.stop();
      } catch {
        /* noop */
      }
    }
    for (const n of [this.input, this.output, this.dry, this.wet, this.hornPan, this.hornAmp, this.bassAmp, this.split, this.bassSplit, this.hornPanGain, this.hornAmpGain, this.bassAmpGain]) {
      try {
        n.disconnect();
      } catch {
        /* noop */
      }
    }
  }
}
