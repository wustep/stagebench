export type EffectUnit = 'mod1'|'mod2'|'delay'|'ampEq'|'compressor'|'reverb'|'rotary';
export const EFFECT_ORDER: EffectUnit[] = ['mod1','mod2','delay','ampEq','compressor','reverb','rotary'];
export interface EffectOptions { on?: boolean; bypass?: boolean; dryWet?: number; params?: Record<string, number>; type?: string; global?: boolean; group?: boolean; toRotary?: boolean; }
export interface LayerBus { id: string; input: GainNode|null; chain: Map<EffectUnit, AudioNode>; output: GainNode|null; }
const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));

/** Shared signal architecture. Every layer enters one ordered chain and the master limiter is the only destination path. */
export class EffectsGraph {
  readonly order = [...EFFECT_ORDER];
  readonly context: AudioContext | null; readonly destination: AudioNode|null; readonly masterBus: GainNode|null; readonly limiter: DynamicsCompressorNode|null;
  readonly layerBuses = new Map<string, LayerBus>(); readonly state: Record<EffectUnit, Required<EffectOptions>>; allBypass = false; focusedLayer = 'piano-A';
  private nativeProcessors = new Map<string, Map<EffectUnit, AudioNode>>();
  private nativeDry = new Map<string, Map<EffectUnit, GainNode>>();
  private nativeWet = new Map<string, Map<EffectUnit, GainNode>>();
  private disposed = false;
  constructor(context: AudioContext|null, layerIds = ['piano-A','piano-B','organ-A','organ-B','synth-A','synth-B']) {
    this.context = context; this.destination = context?.destination ?? null; this.masterBus = context?.createGain() ?? null; this.limiter = context?.createDynamicsCompressor() ?? null;
    this.state = Object.fromEntries(EFFECT_ORDER.map(id => [id, { on: id === 'reverb', bypass: false, dryWet: id === 'reverb' ? .18 : 1, params: {}, type: id, global: ['delay','compressor','reverb'].includes(id), group: false, toRotary: false }])) as Record<EffectUnit, Required<EffectOptions>>;
    if (this.masterBus && this.limiter && this.destination) { this.masterBus.connect(this.limiter); this.limiter.threshold.value = -1; this.limiter.ratio.value = 12; this.limiter.connect(this.destination); }
    layerIds.forEach(id => this.addLayer(id));
  }
  addLayer(id: string) { if (this.layerBuses.has(id)) return this.layerBuses.get(id)!; const input = this.context?.createGain() ?? null; const output = this.context?.createGain() ?? null; const chain = new Map<EffectUnit, AudioNode>(); const processors = new Map<EffectUnit, AudioNode>(); const dry = new Map<EffectUnit, GainNode>(); const wet = new Map<EffectUnit, GainNode>(); if (input && output && this.masterBus) { let cursor: AudioNode = input; EFFECT_ORDER.forEach(unit => { const node = unit === 'compressor' ? this.context!.createDynamicsCompressor() : unit === 'delay' || unit === 'reverb' || unit === 'rotary' ? this.context!.createDelay(2) : (unit === 'ampEq' || unit === 'mod1' || unit === 'mod2') ? this.context!.createBiquadFilter() : this.context!.createGain(); const dryGain = this.context!.createGain(); const wetGain = this.context!.createGain(); const sum = this.context!.createGain(); dryGain.gain.value = 1; wetGain.gain.value = 0; cursor.connect(dryGain); cursor.connect(node); node.connect(wetGain); dryGain.connect(sum); wetGain.connect(sum); chain.set(unit, node); processors.set(unit, node); dry.set(unit, dryGain); wet.set(unit, wetGain); cursor = sum; }); cursor.connect(output); output.connect(this.masterBus); } this.nativeProcessors.set(id, processors); this.nativeDry.set(id, dry); this.nativeWet.set(id, wet); const bus = { id, input, chain, output }; this.layerBuses.set(id, bus); return bus; }
  connectSource(source: AudioNode, layer = 'piano-A') { const bus = this.addLayer(layer); source.connect(bus.input ?? this.masterBus!); return bus; }
  setFocusedLayer(layer: string) { this.focusedLayer = layer; }
  setFocus(layer: string) { this.setFocusedLayer(layer); }
  setEffect(unit: EffectUnit, options: EffectOptions) { this.state[unit] = { ...this.state[unit], ...options, dryWet: clamp(options.dryWet ?? this.state[unit].dryWet), params: { ...this.state[unit].params, ...(options.params ?? {}) } }; this.applyNative(unit); }
  setBypass(unit: EffectUnit, bypass: boolean) { this.setEffect(unit, { bypass }); }
  setAllBypass(bypass: boolean) { this.allBypass = bypass; EFFECT_ORDER.forEach(unit => this.applyNative(unit)); }
  routeToRotary(enabled: boolean) { this.setEffect('rotary', { on: enabled, toRotary: enabled }); }
  setMasterLevel(level: number) { if (this.masterBus) this.masterBus.gain.setTargetAtTime(clamp(level), this.context?.currentTime ?? 0, .01); }
  private applyNative(unit: EffectUnit) { const s = this.state[unit]; this.layerBuses.forEach(bus => { const node = this.nativeProcessors.get(bus.id)?.get(unit); if (!node) return; const now = this.context?.currentTime ?? 0; const enabled = s.on && !s.bypass && !this.allBypass; const wet = enabled ? clamp(s.dryWet) : 0; this.nativeDry.get(bus.id)?.get(unit)?.gain.setTargetAtTime(enabled ? 1 - wet : 1, now, .01); this.nativeWet.get(bus.id)?.get(unit)?.gain.setTargetAtTime(wet, now, .01); if ('frequency' in node) { const filter = node as BiquadFilterNode; filter.frequency.setTargetAtTime(unit === 'ampEq' ? 500 + (s.params.midFreq ?? .5) * 6000 : unit === 'mod1' ? 1800 : 2800, now, .01); filter.Q.setTargetAtTime(0.4 + (s.params.amount ?? .2) * 8, now, .01); filter.type = unit === 'ampEq' ? 'peaking' : 'lowpass'; } if ('delayTime' in node) (node as DelayNode).delayTime.setTargetAtTime(unit === 'delay' ? .12 + (s.params.tempo ?? .4) * .45 : unit === 'rotary' ? .012 : .065, now, .01); if (unit === 'compressor' && 'ratio' in node) (node as DynamicsCompressorNode).ratio.setTargetAtTime(1 + (s.params.amount ?? .2) * 11, now, .01); }); }
  /** Deterministic offline processor used to assert audible changes without an output device. */
  process(samples: Float32Array, sampleRate = 22050, layer = 'piano-A'): Float32Array {
    let out = new Float32Array(samples); const active = (u: EffectUnit) => { const s = this.state[u]; return s.on && !s.bypass && !this.allBypass && (!s.global || layer === this.focusedLayer || layer.startsWith('piano')); };
    if (active('mod1')) { const amount = clamp(this.state.mod1.params.amount ?? .3) * .8; const rate = .5 + clamp(this.state.mod1.params.rate ?? .3) * 8; for (let i=0;i<out.length;i++) out[i] *= 1 - amount * .5 + amount * .5 * Math.sin(i / sampleRate * rate * Math.PI * 2); }
    if (active('mod2')) { const amount = clamp(this.state.mod2.params.amount ?? .3); const delayed = new Float32Array(out); const d = Math.max(1, Math.round(sampleRate * .004)); for (let i=d;i<out.length;i++) out[i] = out[i] * (1-amount*.5) + delayed[i-d] * amount*.5; }
    if (active('delay')) { const wet = clamp(this.state.delay.dryWet); const fb = clamp(this.state.delay.params.feedback ?? .3) * .75; const d = Math.max(1, Math.round(sampleRate * (.08 + clamp(this.state.delay.params.tempo ?? .4) * .2))); const delayed = new Float32Array(out); for (let i=d;i<out.length;i++) out[i] = delayed[i] * (1-wet) + (delayed[i-d] + (i>=d*2 ? out[i-d] * fb : 0)) * wet; }
    if (active('ampEq')) { const drive = clamp((this.state.ampEq.params.drive ?? 0) + .5); for (let i=0;i<out.length;i++) out[i] = Math.tanh(out[i] * (1 + drive * 5)); }
    if (active('compressor')) { const amount = clamp(this.state.compressor.params.amount ?? .2); for (let i=0;i<out.length;i++) { const a=Math.abs(out[i]); out[i] = Math.sign(out[i]) * (a > amount ? amount + (a-amount)*.25 : a); } }
    if (active('reverb')) { const wet=clamp(this.state.reverb.dryWet); const d=Math.max(1,Math.round(sampleRate*.065)); const delayed=new Float32Array(out); for(let i=d;i<out.length;i++) out[i]=delayed[i]*(1-wet)+delayed[i-d]*wet*.7; }
    if (active('rotary') && this.state.rotary.toRotary) { const d=Math.max(1,Math.round(sampleRate*.012)); const delayed=new Float32Array(out); for(let i=d;i<out.length;i++) out[i]=delayed[i]*.7+delayed[i-d]*.3; }
    return out;
  }
  dispose() { if (this.disposed) return; this.disposed = true; this.layerBuses.forEach(bus => { bus.input?.disconnect(); bus.output?.disconnect(); bus.chain.forEach(node => node.disconnect()); }); this.masterBus?.disconnect(); this.limiter?.disconnect(); this.layerBuses.clear(); this.nativeProcessors.clear(); this.nativeDry.clear(); this.nativeWet.clear(); }
}

/** Backwards-compatible singular name for callers that treat the graph as one instrument effect rack. */
export const EffectGraph = EffectsGraph;
