/**
 * AudioEngine — the ONE AudioContext graph for Phase 2.
 *
 * Signal contract (effects spec signalContract.requiredOrder):
 *   layer voices -> layer bus in
 *     -> Mod 1 -> Mod 2 -> Delay -> Amp Sim/EQ (or Filter) -> Compressor -> Reverb
 *     -> [shared Rotary when To Rotary] -> layer level gain
 *   -> master gain -> limiter (DynamicsCompressor) -> single destination
 *
 * There is exactly one BaseAudioContext (real AudioContext in the browser, or an
 * OfflineAudioContext in rendered-audio tests). Layer buses, ordered effects,
 * the shared rotary, master gain/limiter and the one destination all live in it.
 *
 * Voice ownership: each Piano layer (A, B) owns its own voices and routes them
 * only to its own bus. noteOn is dispatched to enabled layers; the focused layer
 * receives single-layer play, both enabled layers can sound together.
 */

import {
  Mod1Unit,
  Mod2Unit,
  DelayUnit,
  AmpEqUnit,
  CompressorUnit,
  ReverbUnit,
  RotaryUnit,
  type EffectUnit,
  type AmpModel,
} from './effects';
import {
  Sampler,
  createSynthVoice,
  type Voice,
  type VoiceParams,
  loadSampler,
  type SampleLoaderDeps,
} from './sampler';
import {
  PIANO_TYPE_DEFS,
  type PianoTypeId,
  type PianoTypeDef,
} from './instruments';
import { OrganVoice, type OrganModelId, type OrganParams } from './organEngine';
import { SynthVoice, type SynthLayerParams, defaultSynthLayerParams } from './synthEngine';
import { MasterClock } from './clock';

export type LayerId = 'A' | 'B';
export type OrganLayerId = 'A' | 'B';
export type SynthLayerId = 'A' | 'B' | 'C';
export type SectionId = 'organ' | 'piano' | 'synth';

export interface LayerParams {
  enabled: boolean;
  level: number; // 0..1 fader
  octave: number; // -2..2 -> semitone *12
  sustPed: boolean; // SUSTPED route
  pStick: boolean;
}

export interface PerformanceParams {
  type: PianoTypeId;
  kbTouch: number; // 0=Heavy 1=Medium 2=Light
  dynComp: number; // 0..3
  timbre: number; // index
  unison: number; // 0..3
  softRelease: boolean;
  stringRes: boolean;
}

const KB_TOUCH_EXPONENTS = [2.4, 1.6, 1.0]; // Heavy needs harder press; Light easy.

// ---- Organ section state --------------------------------------------------

export interface OrganLayerState {
  enabled: boolean;
  level: number;
  octave: number;
  model: OrganModelId;
  drawbars: number[]; // nine 0..8
}

export interface OrganSectionState {
  on: boolean;
  focus: OrganLayerId;
  sustPed: boolean;
  pStick: boolean;
  percussion: { on: boolean; soft: boolean; fast: boolean; third: boolean };
  vibChorus: { on: boolean; mode: string };
  rotaryRouted: boolean;
}

// ---- Synth section state --------------------------------------------------

export interface SynthLayerState extends SynthLayerParams {
  enabled: boolean;
  level: number;
  octave: number;
}

export interface SynthSectionState {
  on: boolean;
  focus: SynthLayerId;
  sustPed: boolean;
  pStick: boolean;
  voiceMode: 'Poly' | 'Mono' | 'Legato';
  priority: 'Off' | 'Low' | 'High';
  arpOn: boolean;
  arpMode: 'Arp' | 'Poly' | 'Gate';
  arpRange: number;
  arpDirection: 'Up' | 'Down' | 'Up/Down' | 'Random';
  arpRate: number;
  arpHold: boolean;
  arpClockSync: boolean;
  lfoWaveform: number; // 0..4
  lfoDestination: 'off' | 'pitch' | 'ctrl' | 'cutoff';
  lfoRate: number;
  lfoAmount: number;
  lfoClockSync: boolean;
  vibrato: 'Off' | 'On' | 'Wheel';
  kbHold: boolean;
}

/** One ordered effect chain for a single layer. */
export class LayerChain {
  readonly input: GainNode;
  readonly mod1: Mod1Unit;
  readonly mod2: Mod2Unit;
  readonly delay: DelayUnit;
  readonly amp: AmpEqUnit;
  readonly comp: CompressorUnit;
  readonly reverb: ReverbUnit;
  /** Output of the effect chain, then shared layer level. */
  readonly level: GainNode;
  private levelValue = 0.85;
  /** Normal path send to master (muted when the layer routes To Rotary). */
  private readonly normalSend: GainNode;
  /** Post-reverb send into the shared rotary (open only when To Rotary). */
  private readonly rotarySend: GainNode;
  private masterBypass = false;

  constructor(
    private readonly ctx: BaseAudioContext,
    masterBus: AudioNode,
    rotaryInput: AudioNode,
  ) {
    this.input = ctx.createGain();
    this.mod1 = new Mod1Unit(ctx);
    this.mod2 = new Mod2Unit(ctx);
    this.delay = new DelayUnit(ctx);
    this.amp = new AmpEqUnit(ctx);
    this.comp = new CompressorUnit(ctx);
    this.reverb = new ReverbUnit(ctx);
    this.level = ctx.createGain();
    this.normalSend = ctx.createGain();
    this.normalSend.gain.value = 1;
    this.rotarySend = ctx.createGain();
    this.rotarySend.gain.value = 0;

    // Ordered chain: source -> Mod1 -> Mod2 -> Delay -> Amp/EQ -> Comp -> Reverb -> level.
    this.input.connect(this.mod1.input);
    this.mod1.output.connect(this.mod2.input);
    this.mod2.output.connect(this.delay.input);
    this.delay.output.connect(this.amp.input);
    this.amp.output.connect(this.comp.input);
    this.comp.output.connect(this.reverb.input);
    this.reverb.output.connect(this.level);

    // level -> normalSend -> master  AND  level -> rotarySend -> shared rotary.
    this.level.connect(this.normalSend).connect(masterBus);
    this.level.connect(this.rotarySend).connect(rotaryInput);

    // All units start OFF (bypassed = dry) to match the default unitOn=false.
    for (const key of Object.keys(this.unitOn)) this.applyBypass(key);
  }

  get bus(): AudioNode {
    return this.input;
  }

  setLevel(v: number): void {
    this.levelValue = v;
    const now = this.ctx.currentTime;
    this.level.gain.cancelScheduledValues(now);
    this.level.gain.setValueAtTime(this.level.gain.value, now);
    this.level.gain.linearRampToValueAtTime(v, now + 0.02);
  }

  /** Amp model "To Rotary" reroutes this layer's post-reverb signal to the shared rotary. */
  updateRotaryRouting(): void {
    const toRotary = this.amp.routeToRotary;
    const now = this.ctx.currentTime;
    this.rotarySend.gain.cancelScheduledValues(now);
    this.rotarySend.gain.linearRampToValueAtTime(toRotary ? 1 : 0, now + 0.02);
    this.normalSend.gain.cancelScheduledValues(now);
    this.normalSend.gain.linearRampToValueAtTime(toRotary ? 0 : 1, now + 0.02);
  }

  /** Per-unit user on-states (true = engaged). Effective bypass = !on || masterBypass. */
  private readonly unitOn: Record<string, boolean> = {
    mod1: false,
    mod2: false,
    delay: false,
    amp: false,
    comp: false,
    reverb: false,
  };

  private unitByKey(key: string): EffectUnit {
    return { mod1: this.mod1, mod2: this.mod2, delay: this.delay, amp: this.amp, comp: this.comp, reverb: this.reverb }[key]!;
  }

  setUnitOn(key: string, on: boolean): void {
    this.unitOn[key] = on;
    this.applyBypass(key);
  }

  private applyBypass(key: string): void {
    const unit = this.unitByKey(key);
    unit.setBypassed(this.masterBypass || !this.unitOn[key]);
  }

  setMasterBypass(bypass: boolean): void {
    this.masterBypass = bypass;
    for (const key of Object.keys(this.unitOn)) this.applyBypass(key);
  }

  units(): EffectUnit[] {
    return [this.mod1, this.mod2, this.delay, this.amp, this.comp, this.reverb];
  }

  dispose(): void {
    for (const u of this.units()) u.dispose();
    for (const n of [this.input, this.level, this.normalSend, this.rotarySend]) {
      try {
        n.disconnect();
      } catch {
        /* noop */
      }
    }
  }
}

interface LiveVoice {
  voice: Voice;
  layer: LayerId;
  midi: number;
  order: number;
  sustained: boolean;
}

export interface AudioEngineOptions {
  maxVoicesPerLayer?: number;
}

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error' | 'fallback';

export class AudioEngine {
  readonly ctx: BaseAudioContext;
  private readonly master: GainNode;
  private readonly limiter: DynamicsCompressorNode;
  private readonly rotary: RotaryUnit;
  private readonly chains: Record<LayerId, LayerChain>;
  /** Organ shares the same shared effect chain per layer (organ spec). */
  private readonly organChains: Record<OrganLayerId, LayerChain>;
  /** Synth has independent effect chains per layer (synth spec). */
  private readonly synthChains: Record<SynthLayerId, LayerChain>;
  private readonly samplers = new Map<PianoTypeId, Sampler>();
  private readonly voices: LiveVoice[] = [];
  private readonly organVoices: Array<{ voice: OrganVoice; layer: OrganLayerId; midi: number; sustained: boolean }> = [];
  private readonly synthVoicesList: Array<{ voice: SynthVoice; layer: SynthLayerId; midi: number; sustained: boolean }> = [];
  private order = 0;
  private readonly maxVoices: number;
  readonly clock = new MasterClock();
  /** Per-synth-layer running LFO (one oscillator + gain fanned into voices). */
  private readonly synthLfos: Record<SynthLayerId, { osc: OscillatorNode | null; out: GainNode }> = {
    A: { osc: null, out: null as unknown as GainNode },
    B: { osc: null, out: null as unknown as GainNode },
    C: { osc: null, out: null as unknown as GainNode },
  };
  private transpose = 0; // -6..6 semitones (whole instrument)
  private lastSynthFreq: Record<SynthLayerId, number | undefined> = { A: undefined, B: undefined, C: undefined };

  /**
   * Routing gate: for a given MIDI note, decides whether each section-layer
   * should sound (split zones × active scene enables). Set by the bindings from
   * the PerformanceStore. Returns a per-layer 0..1 gain (crossfade) or 0.
   */
  private routing: {
    layerGain: (section: SectionId, layer: string, midi: number) => number;
  } = { layerGain: () => 1 };

  setRouting(fn: (section: SectionId, layer: string, midi: number) => number): void {
    this.routing = { layerGain: fn };
  }

  private status: EngineStatus = 'idle';
  private focused: LayerId = 'A';
  private sustainDown = false;

  private layers: Record<LayerId, LayerParams> = {
    A: { enabled: true, level: 0.85, octave: 0, sustPed: true, pStick: true },
    B: { enabled: false, level: 0.4, octave: 0, sustPed: true, pStick: false },
  };
  private perf: PerformanceParams = {
    type: 'grand',
    kbTouch: 1,
    dynComp: 0,
    timbre: 0,
    unison: 0,
    softRelease: false,
    stringRes: false,
  };

  private organ: OrganSectionState = {
    on: false,
    focus: 'A',
    sustPed: true,
    pStick: true,
    percussion: { on: false, soft: false, fast: false, third: false },
    vibChorus: { on: false, mode: 'V1' },
    rotaryRouted: false,
  };
  private organLayers: Record<OrganLayerId, OrganLayerState> = {
    A: { enabled: true, level: 0.8, octave: 0, model: 'B3', drawbars: [8, 8, 8, 0, 0, 0, 0, 0, 3] },
    B: { enabled: false, level: 0.5, octave: 0, model: 'VOX', drawbars: [8, 6, 8, 4, 0, 0, 0, 0, 0] },
  };

  private synth: SynthSectionState = {
    on: false,
    focus: 'A',
    sustPed: true,
    pStick: true,
    voiceMode: 'Poly',
    priority: 'Off',
    arpOn: false,
    arpMode: 'Arp',
    arpRange: 1,
    arpDirection: 'Up',
    arpRate: 0.5,
    arpHold: false,
    arpClockSync: false,
    lfoWaveform: 0,
    lfoDestination: 'off',
    lfoRate: 0.3,
    lfoAmount: 0.2,
    lfoClockSync: false,
    vibrato: 'Off',
    kbHold: false,
  };
  private synthLayers: Record<SynthLayerId, SynthLayerState> = {
    A: { enabled: true, level: 0.75, octave: 0, ...defaultSynthLayerParams() },
    B: { enabled: false, level: 0.6, octave: 0, ...defaultSynthLayerParams() },
    C: { enabled: false, level: 0.5, octave: 0, ...defaultSynthLayerParams() },
  };

  constructor(ctx: BaseAudioContext, options: AudioEngineOptions = {}) {
    this.ctx = ctx;
    this.maxVoices = options.maxVoicesPerLayer ?? 16;

    // Master path: master gain -> limiter -> single destination.
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.1;
    this.master.connect(this.limiter).connect(ctx.destination);

    // Shared rotary sits after reverb, before master.
    this.rotary = new RotaryUnit(ctx);
    this.rotary.output.connect(this.master);

    this.chains = {
      A: new LayerChain(ctx, this.master, this.rotary.input),
      B: new LayerChain(ctx, this.master, this.rotary.input),
    };
    this.chains.A.setLevel(this.layers.A.level);
    this.chains.B.setLevel(this.layers.B.level);

    // Organ layer chains (route through the shared effect graph + rotary + master).
    this.organChains = {
      A: new LayerChain(ctx, this.master, this.rotary.input),
      B: new LayerChain(ctx, this.master, this.rotary.input),
    };
    this.organChains.A.setLevel(this.organLayers.A.level);
    this.organChains.B.setLevel(this.organLayers.B.level);

    // Synth layer chains (independent effects per layer).
    this.synthChains = {
      A: new LayerChain(ctx, this.master, this.rotary.input),
      B: new LayerChain(ctx, this.master, this.rotary.input),
      C: new LayerChain(ctx, this.master, this.rotary.input),
    };
    for (const l of ['A', 'B', 'C'] as SynthLayerId[]) {
      this.synthChains[l].setLevel(this.synthLayers[l].level);
      this.synthLfos[l].out = ctx.createGain();
    }
  }

  getStatus(): EngineStatus {
    return this.status;
  }
  setStatus(s: EngineStatus): void {
    this.status = s;
  }

  get masterNode(): GainNode {
    return this.master;
  }
  get destination(): AudioNode {
    return this.ctx.destination;
  }
  get rotaryUnit(): RotaryUnit {
    return this.rotary;
  }

  chain(layer: LayerId): LayerChain {
    return this.chains[layer];
  }

  get activeVoiceCount(): number {
    return this.voices.filter((v) => !v.voice.stopped).length;
  }

  /** Total live nodes-of-record (for cleanup assertions). */
  get liveVoices(): number {
    return this.voices.length;
  }

  // ---- sample library --------------------------------------------------

  registerSampler(type: PianoTypeId, sampler: Sampler): void {
    this.samplers.set(type, sampler);
  }

  hasSampler(type: PianoTypeId): boolean {
    return this.samplers.get(type)?.loaded ?? false;
  }

  async loadLibrary(deps: SampleLoaderDeps): Promise<void> {
    this.status = 'loading';
    const sampled = (Object.values(PIANO_TYPE_DEFS) as PianoTypeDef[]).filter(
      (d): d is PianoTypeDef & { kind: 'sampled' } => d.kind === 'sampled',
    );
    try {
      await Promise.all(
        sampled.map(async (def) => {
          const sampler = await loadSampler(this.ctx, def, deps);
          this.registerSampler(def.id, sampler);
        }),
      );
      this.status = 'ready';
    } catch {
      // Asset load failed: enter labeled playable fallback (synth for all types).
      this.status = 'fallback';
    }
  }

  // ---- parameter setters ----------------------------------------------

  setMasterLevel(v: number): void {
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(v, now + 0.02);
  }

  setLayer(layer: LayerId, patch: Partial<LayerParams>): void {
    this.layers[layer] = { ...this.layers[layer], ...patch };
    if (patch.level !== undefined) this.chains[layer].setLevel(patch.level);
  }

  getLayer(layer: LayerId): LayerParams {
    return this.layers[layer];
  }

  setFocus(layer: LayerId): void {
    this.focused = layer;
  }
  get focusedLayer(): LayerId {
    return this.focused;
  }

  setPerformance(patch: Partial<PerformanceParams>): void {
    this.perf = { ...this.perf, ...patch };
  }
  getPerformance(): PerformanceParams {
    return this.perf;
  }

  setEffectsMasterOn(on: boolean): void {
    this.chains.A.setMasterBypass(!on);
    this.chains.B.setMasterBypass(!on);
  }

  // ---- effect control targeting --------------------------------------
  // Piano group mode: A and B share one effect setting. Global mode for
  // Delay/Compressor/Reverb applies across both piano layers. Otherwise the
  // focused layer is edited.

  private pianoGroup = false;
  private readonly globalUnits = new Set<string>(); // 'delay'|'comp'|'reverb'

  setPianoGroup(on: boolean): void {
    this.pianoGroup = on;
  }
  get pianoGrouped(): boolean {
    return this.pianoGroup;
  }

  setGlobalUnit(key: string, on: boolean): void {
    if (on) this.globalUnits.add(key);
    else this.globalUnits.delete(key);
  }
  isGlobalUnit(key: string): boolean {
    return this.globalUnits.has(key);
  }

  /** Which layer chains a given unit edit should target. */
  private targetLayers(unitKey: string): LayerId[] {
    if (this.globalUnits.has(unitKey)) return ['A', 'B'];
    if (this.pianoGroup) return ['A', 'B'];
    return [this.focused];
  }

  /** Apply a callback to the relevant unit on each targeted layer chain. */
  applyToUnit(unitKey: string, fn: (chain: LayerChain) => void): void {
    for (const l of this.targetLayers(unitKey)) fn(this.chains[l]);
  }

  /** Convenience: set a unit's on-state on the targeted layers. */
  setUnitEngaged(unitKey: string, on: boolean): void {
    this.applyToUnit(unitKey, (chain) => chain.setUnitOn(unitKey, on));
  }

  /** Amp model + rotary routing update on targeted layers. */
  setAmpModel(model: AmpModel): void {
    this.applyToUnit('amp', (chain) => {
      chain.amp.setModel(model);
      chain.updateRotaryRouting();
    });
  }

  // ---- organ section ---------------------------------------------------

  organChain(layer: OrganLayerId): LayerChain {
    return this.organChains[layer];
  }
  getOrganSection(): OrganSectionState {
    return this.organ;
  }
  setOrganSection(patch: Partial<OrganSectionState>): void {
    this.organ = { ...this.organ, ...patch };
  }
  getOrganLayer(layer: OrganLayerId): OrganLayerState {
    return this.organLayers[layer];
  }
  setOrganLayer(layer: OrganLayerId, patch: Partial<OrganLayerState>): void {
    this.organLayers[layer] = { ...this.organLayers[layer], ...patch };
    if (patch.level !== undefined) this.organChains[layer].setLevel(patch.level);
  }
  setOrganDrawbar(layer: OrganLayerId, index: number, value: number): void {
    const db = [...this.organLayers[layer].drawbars];
    db[index] = Math.max(0, Math.min(8, value));
    this.organLayers[layer] = { ...this.organLayers[layer], drawbars: db };
  }

  organNoteOn(midi: number, velocity = 100): void {
    if (!this.organ.on) return;
    const shifted = midi + this.transpose;
    const anyHeld = this.organVoices.some((v) => !v.voice.stopped);
    for (const layer of ['A', 'B'] as OrganLayerId[]) {
      const ls = this.organLayers[layer];
      if (!ls.enabled) continue;
      const gain = this.routing.layerGain('organ', layer, midi);
      if (gain <= 0) continue;
      const params: OrganParams = {
        model: ls.model,
        drawbars: ls.drawbars,
        destination: this.organChains[layer].bus,
        level: gain,
        velocity,
        percussion: this.organ.percussion,
        vibChorus: this.organ.vibChorus,
        percAvailable: !anyHeld,
      };
      const voice = new OrganVoice(this.ctx, shifted + ls.octave * 12, params, () => this.reapOrgan());
      this.organVoices.push({ voice, layer, midi, sustained: false });
    }
  }

  organNoteOff(midi: number): void {
    for (const ov of this.organVoices) {
      if (ov.midi !== midi || ov.voice.stopped) continue;
      if (this.sustainDown && this.organ.sustPed) {
        ov.sustained = true;
        continue;
      }
      ov.voice.release();
    }
  }

  private reapOrgan(): void {
    for (let i = this.organVoices.length - 1; i >= 0; i--) {
      if (this.organVoices[i].voice.stopped) this.organVoices.splice(i, 1);
    }
  }

  get organVoiceCount(): number {
    return this.organVoices.filter((v) => !v.voice.stopped).length;
  }

  // ---- synth section ---------------------------------------------------

  synthChain(layer: SynthLayerId): LayerChain {
    return this.synthChains[layer];
  }
  getSynthSection(): SynthSectionState {
    return this.synth;
  }
  setSynthSection(patch: Partial<SynthSectionState>): void {
    const prev = this.synth;
    this.synth = { ...this.synth, ...patch };
    if (patch.lfoDestination !== undefined || patch.lfoWaveform !== undefined || patch.lfoRate !== undefined || patch.lfoClockSync !== undefined) {
      this.syncLfos();
    }
    void prev;
  }
  getSynthLayer(layer: SynthLayerId): SynthLayerState {
    return this.synthLayers[layer];
  }
  setSynthLayer(layer: SynthLayerId, patch: Partial<SynthLayerState>): void {
    this.synthLayers[layer] = { ...this.synthLayers[layer], ...patch };
    if (patch.level !== undefined) this.synthChains[layer].setLevel(patch.level);
  }

  /** Rate for a synth LFO in Hz, honoring clock sync. */
  private synthLfoHz(): number {
    if (this.synth.lfoClockSync) {
      // Sync to master clock: a whole-note..sixteenth grid mapped from rate 0..1.
      const subdivisions = [4, 2, 1, 0.5, 0.25];
      const idx = Math.min(subdivisions.length - 1, Math.floor(this.synth.lfoRate * subdivisions.length));
      return 1 / (this.clock.quarterSeconds() * subdivisions[idx]);
    }
    return 0.1 + this.synth.lfoRate * 12;
  }

  /** (Re)build the shared per-layer LFO oscillators for the focused synth layer. */
  private syncLfos(): void {
    const LFO_WAVES: OscillatorType[] = ['triangle', 'sawtooth', 'sawtooth', 'square', 'square'];
    for (const l of ['A', 'B', 'C'] as SynthLayerId[]) {
      const slot = this.synthLfos[l];
      if (!slot.osc) {
        const osc = this.ctx.createOscillator();
        osc.type = LFO_WAVES[this.synth.lfoWaveform] ?? 'triangle';
        osc.frequency.value = this.synthLfoHz();
        // Saw up vs saw down: invert via a gain of -1 on waveform index 2.
        osc.connect(slot.out);
        try {
          osc.start();
        } catch {
          /* offline */
        }
        slot.osc = osc;
        slot.out.gain.value = this.synth.lfoWaveform === 1 ? -1 : 1; // saw down inverts
      } else {
        slot.osc.type = LFO_WAVES[this.synth.lfoWaveform] ?? 'triangle';
        const now = this.ctx.currentTime;
        slot.osc.frequency.cancelScheduledValues(now);
        slot.osc.frequency.linearRampToValueAtTime(this.synthLfoHz(), now + 0.05);
      }
    }
  }

  synthNoteOn(midi: number, velocity = 100): void {
    if (!this.synth.on) return;
    const shifted = midi + this.transpose;
    for (const layer of ['A', 'B', 'C'] as SynthLayerId[]) {
      const ls = this.synthLayers[layer];
      if (!ls.enabled) continue;
      const gain = this.routing.layerGain('synth', layer, midi);
      if (gain <= 0) continue;
      // Mono/legato: steal the layer's existing voice.
      if (this.synth.voiceMode !== 'Poly') {
        for (const sv of this.synthVoicesList) {
          if (sv.layer === layer && !sv.voice.stopped) sv.voice.stop();
        }
      }
      const lfoDest = this.synth.lfoDestination;
      const lfo = lfoDest !== 'off' ? { node: this.synthLfos[layer].out, destination: lfoDest, amount: this.synth.lfoAmount } : null;
      const voice = new SynthVoice(
        this.ctx,
        shifted + ls.octave * 12,
        {
          ...ls,
          destination: this.synthChains[layer].bus,
          level: gain,
          velocity,
          lfo,
          glideFromFreq: this.synth.voiceMode !== 'Poly' ? this.lastSynthFreq[layer] : undefined,
        },
        () => this.reapSynth(),
      );
      this.synthVoicesList.push({ voice, layer, midi, sustained: false });
      this.lastSynthFreq[layer] = 440 * Math.pow(2, (shifted + ls.octave * 12 - 69) / 12);
    }
  }

  synthNoteOff(midi: number): void {
    for (const sv of this.synthVoicesList) {
      if (sv.midi !== midi || sv.voice.stopped) continue;
      if ((this.sustainDown && this.synth.sustPed) || this.synth.kbHold) {
        sv.sustained = true;
        continue;
      }
      sv.voice.release();
    }
  }

  private reapSynth(): void {
    for (let i = this.synthVoicesList.length - 1; i >= 0; i--) {
      if (this.synthVoicesList[i].voice.stopped) this.synthVoicesList.splice(i, 1);
    }
  }

  get synthVoiceCount(): number {
    return this.synthVoicesList.filter((v) => !v.voice.stopped).length;
  }

  // ---- master clock + transpose ---------------------------------------

  setTranspose(semitones: number): void {
    this.transpose = Math.max(-6, Math.min(6, Math.round(semitones)));
  }
  getTranspose(): number {
    return this.transpose;
  }

  // ---- note lifecycle --------------------------------------------------

  private voiceParams(velocity: number, destination: AudioNode, zoneGain = 1): VoiceParams {
    return {
      velocity,
      destination,
      touchExponent: KB_TOUCH_EXPONENTS[this.perf.kbTouch] ?? 1.6,
      dynComp: this.perf.dynComp,
      timbre: this.perf.timbre,
      unison: this.perf.unison,
      softRelease: this.perf.softRelease,
      release: 0.28,
      softReleaseTime: 0.5,
      zoneGain,
    };
  }

  private makeVoice(layer: LayerId, midi: number, velocity: number, zoneGain = 1): Voice | null {
    const def = PIANO_TYPE_DEFS[this.perf.type];
    const shifted = midi + this.transpose + this.layers[layer].octave * 12;
    const dest = this.chains[layer].bus;
    const onEnd = () => this.reap();
    if (def.kind === 'sampled' && this.hasSampler(def.id) && this.status !== 'fallback') {
      const sampler = this.samplers.get(def.id)!;
      const v = sampler.createVoice(shifted, this.voiceParams(velocity, dest, zoneGain), onEnd);
      if (v) return v;
    }
    // Synth types, or fallback when samples failed.
    const recipe = def.kind === 'synth' ? def.recipe : 'digital';
    return createSynthVoice(this.ctx, shifted, recipe, this.voiceParams(velocity, dest, zoneGain), def.family, onEnd);
  }

  /** Dispatch a note to every active section (piano + organ + synth). */
  noteOn(midi: number, velocity = 100): void {
    this.pianoNoteOn(midi, velocity);
    this.organNoteOn(midi, velocity);
    this.synthNoteOn(midi, velocity);
  }

  /** Piano-only note on (preserves inherited Phase-2 behavior/tests). */
  pianoNoteOn(midi: number, velocity = 100): void {
    const targets: LayerId[] = (['A', 'B'] as LayerId[]).filter((l) => this.layers[l].enabled);
    if (targets.length === 0) return;
    for (const layer of targets) {
      const gain = this.routing.layerGain('piano', layer, midi);
      if (gain <= 0) continue;
      // one voice per (layer, pitch): steal existing
      const existing = this.voices.find((v) => v.layer === layer && v.midi === midi && !v.voice.stopped);
      if (existing) existing.voice.stop();
      this.enforcePolyphony(layer);
      const voice = this.makeVoice(layer, midi, velocity, gain);
      if (!voice) continue;
      this.voices.push({ voice, layer, midi, order: this.order++, sustained: false });
    }
  }

  noteOff(midi: number): void {
    this.pianoNoteOff(midi);
    this.organNoteOff(midi);
    this.synthNoteOff(midi);
  }

  pianoNoteOff(midi: number): void {
    for (const lv of this.voices) {
      if (lv.midi !== midi || lv.voice.stopped) continue;
      const layerParams = this.layers[lv.layer];
      if (this.sustainDown && layerParams.sustPed) {
        lv.sustained = true;
        continue;
      }
      lv.voice.release(this.perf.softRelease);
    }
  }

  setSustain(down: boolean): void {
    if (down === this.sustainDown) return;
    this.sustainDown = down;
    if (!down) {
      for (const lv of this.voices) {
        if (lv.sustained && !lv.voice.stopped) lv.voice.release(this.perf.softRelease);
      }
      for (const ov of this.organVoices) {
        if (ov.sustained && !ov.voice.stopped) ov.voice.release();
      }
      for (const sv of this.synthVoicesList) {
        if (sv.sustained && !sv.voice.stopped && !this.synth.kbHold) sv.voice.release();
      }
    }
  }

  get sustaining(): boolean {
    return this.sustainDown;
  }

  /** Panic: internal All Notes Off + reset held performance inputs. */
  allNotesOff(): void {
    this.sustainDown = false;
    for (const lv of this.voices) {
      if (!lv.voice.stopped) lv.voice.stop();
    }
    this.voices.length = 0;
    for (const ov of this.organVoices) {
      if (!ov.voice.stopped) ov.voice.stop();
    }
    this.organVoices.length = 0;
    for (const sv of this.synthVoicesList) {
      if (!sv.voice.stopped) sv.voice.stop();
    }
    this.synthVoicesList.length = 0;
  }

  private enforcePolyphony(layer: LayerId): void {
    const layerVoices = this.voices.filter((v) => v.layer === layer && !v.voice.stopped);
    if (layerVoices.length < this.maxVoices) return;
    let oldest = layerVoices[0];
    for (const v of layerVoices) if (v.order < oldest.order) oldest = v;
    oldest.voice.stop();
  }

  private reap(): void {
    for (let i = this.voices.length - 1; i >= 0; i--) {
      if (this.voices[i].voice.stopped) this.voices.splice(i, 1);
    }
  }

  dispose(): void {
    this.allNotesOff();
    this.chains.A.dispose();
    this.chains.B.dispose();
    this.organChains.A.dispose();
    this.organChains.B.dispose();
    for (const l of ['A', 'B', 'C'] as SynthLayerId[]) {
      this.synthChains[l].dispose();
      const slot = this.synthLfos[l];
      if (slot.osc) {
        try {
          slot.osc.stop();
        } catch {
          /* noop */
        }
      }
      try {
        slot.out.disconnect();
      } catch {
        /* noop */
      }
    }
    this.rotary.dispose();
    for (const n of [this.master, this.limiter]) {
      try {
        n.disconnect();
      } catch {
        /* noop */
      }
    }
    this.status = 'idle';
  }
}
