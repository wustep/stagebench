import { EffectsGraph } from './effectsGraph';

export type OrganModel = 'B3' | 'B3 Bass' | 'Vox' | 'Farf' | 'Pipe 1' | 'Pipe 2';
export type RotarySpeed = 'Stop' | 'Slow' | 'Fast';
export type OrganLayer = 'A' | 'B';
export interface OrganLayerControls {
  enabled: boolean; level: number; model: OrganModel; drawbars: number[]; registers: boolean[];
  percussion: boolean; percussionSoft: boolean; percussionFast: boolean; percussionThird: boolean;
  keyClick: number; vibrato: boolean; vibratoType: 1|2|3; chorus: boolean; rotary: RotarySpeed;
  rotaryDrive: number; rotaryCloseMic: boolean; octave: number; zones: number[]; preset: boolean;
}
export interface OrganControls { layerA: OrganLayerControls; layerB: OrganLayerControls; focusedLayer: OrganLayer; masterVolume: number; morphSpeed: number; masterClock: number; }
export interface OrganRenderedAudio { samples: Float32Array; sampleRate: number; peak: number; rms: number; mode: 'tonewheel-model'|'fallback'; }
export type OrganRenderOptions = Omit<Partial<OrganControls>, 'layerA'|'layerB'> & { layerA?: Partial<OrganLayerControls>; layerB?: Partial<OrganLayerControls> };

const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const midiFreq = (note: number) => 440 * 2 ** ((note - 69) / 12);
const modelHarmonics: Record<OrganModel, number[]> = {
  'B3': [1, 2, 3, 4, 5, 6, 8, 10, 12], 'B3 Bass': [0.5, 1, 2],
  Vox: [1, 2, 3, 4, 6, 8, 10], Farf: [1, 2, 3, 4, 5.33, 8, 10, 12, 16],
  'Pipe 1': [0.5, 1, 2, 3, 4, 6, 8, 12, 16], 'Pipe 2': [1, 2, 3, 4, 5, 6, 8, 10, 12],
};
const defaultLayer = (model: OrganModel): OrganLayerControls => ({ enabled: false, level: .8, model, drawbars: [0.75,.55,.8,.45,.35,.3,.2,.15,.1], registers: Array(9).fill(true), percussion: false, percussionSoft: false, percussionFast: false, percussionThird: false, keyClick: .08, vibrato: false, vibratoType: 1, chorus: false, rotary: 'Stop', rotaryDrive: .15, rotaryCloseMic: false, octave: 0, zones: [0,1,2,3], preset: true });
export const defaultOrganControls: OrganControls = { layerA: { ...defaultLayer('B3'), enabled: true }, layerB: defaultLayer('B3 Bass'), focusedLayer: 'A', masterVolume: .8, morphSpeed: .5, masterClock: 120 };

export function renderOrganNote(note: number, velocity = .8, options: OrganRenderOptions = {}, seconds = .5, sampleRate = 22050): OrganRenderedAudio {
  const c: OrganControls = { ...defaultOrganControls, ...options, layerA: { ...defaultOrganControls.layerA, ...(options.layerA ?? {}) }, layerB: { ...defaultOrganControls.layerB, ...(options.layerB ?? {}) } };
  const n = Math.max(1, Math.floor(seconds * sampleRate)); const out = new Float32Array(n); let peak = 0; let sumSq = 0;
  const layers = [c.layerA, c.layerB];
  layers.forEach((layer, li) => {
    if (!layer.enabled) return;
    const harmonics = modelHarmonics[layer.model]; const base = midiFreq(note) * 2 ** (layer.octave / 12);
    const modelGain = layer.model === 'Vox' ? 0.72 : layer.model === 'Farf' ? 0.64 : layer.model.startsWith('Pipe') ? 0.58 : 0.78;
    const organGain = layer.level * c.masterVolume * velocity * modelGain * (li ? .92 : 1);
    const bars = layer.preset ? layer.drawbars : layer.drawbars.map(v => clamp(v));
    for (let i = 0; i < n; i += 1) {
      const t = i / sampleRate; const attack = Math.min(1, t / .008); const release = Math.exp(-t * (layer.model === 'Farf' ? 1.8 : 1.05));
      let sample = 0;
      harmonics.forEach((ratio, h) => {
        const bar = bars[h % bars.length] ?? .5; const active = layer.model === 'Farf' ? (layer.registers[h % 9] ? 1 : .08) : 1;
        const shape = layer.model === 'B3' || layer.model === 'B3 Bass' ? Math.sin(2 * Math.PI * base * ratio * t) : Math.tanh(Math.sin(2 * Math.PI * base * ratio * t) * (1.5 + h * .08));
        sample += shape * bar * active / (1 + h * .3);
      });
      if (layer.vibrato || layer.chorus) { const rate = layer.vibratoType === 3 ? 5.8 : layer.vibratoType === 2 ? 6.4 : 5.2; sample *= 1 + (layer.vibrato ? .12 : .05) * Math.sin(2 * Math.PI * rate * t); if (layer.chorus) sample += .12 * Math.sin(2 * Math.PI * base * 1.005 * t); }
      if (layer.percussion && (layer.model === 'B3' || layer.model === 'B3 Bass')) { const ratio = layer.percussionThird ? 3 : 2; const decay = layer.percussionFast ? 28 : 12; sample += Math.sin(2 * Math.PI * base * ratio * t) * Math.exp(-decay * t) * (layer.percussionSoft ? .1 : .2); }
      if (layer.keyClick > 0) sample += Math.sin(2 * Math.PI * base * 18 * t) * Math.exp(-t * 80) * layer.keyClick;
      const rotary = layer.rotary === 'Fast' ? 6.2 : layer.rotary === 'Slow' ? 1.2 : 0;
      if (rotary) sample *= 1 + .08 * Math.sin(2 * Math.PI * rotary * t) + layer.rotaryDrive * .12;
      const micGain = layer.rotaryCloseMic ? 1.18 : 1;
      const value = sample / Math.max(3, harmonics.length * .48) * organGain * micGain * attack * release;
      out[i] += value; const a = Math.abs(out[i]); if (a > peak) peak = a; sumSq += value * value;
    }
  });
  return { samples: out, sampleRate, peak, rms: Math.sqrt(sumSq / n), mode: 'tonewheel-model' };
}

interface WebVoice { id: number; gain: GainNode; oscillators: OscillatorNode[]; note: number; }
export class OrganEngine {
  readonly audioContext: AudioContext | null; readonly graph: EffectsGraph; readonly mode: 'tonewheel-model'|'fallback'; controls: OrganControls = JSON.parse(JSON.stringify(defaultOrganControls));
  private voices = new Map<number, WebVoice>(); private nextId = 1;
  constructor(context?: AudioContext|null, graph?: EffectsGraph) { this.audioContext = context ?? null; this.graph = graph ?? new EffectsGraph(this.audioContext); this.mode = this.audioContext ? 'tonewheel-model' : 'fallback'; }
  setControl<K extends keyof OrganControls>(key: K, value: OrganControls[K]): void { this.controls[key] = value; }
  setLayerControl(layer: OrganLayer, key: keyof OrganLayerControls, value: unknown): void { (this.controls[layer === 'A' ? 'layerA' : 'layerB'] as unknown as Record<string, unknown>)[key] = value; }
  setModel(layer: OrganLayer, model: OrganModel) { this.setLayerControl(layer, 'model', model); }
  setRotary(layer: OrganLayer, speed: RotarySpeed, drive = this.controls[layer === 'A' ? 'layerA' : 'layerB'].rotaryDrive, closeMic = this.controls[layer === 'A' ? 'layerA' : 'layerB'].rotaryCloseMic) { this.setLayerControl(layer, 'rotary', speed); this.setLayerControl(layer, 'rotaryDrive', drive); this.setLayerControl(layer, 'rotaryCloseMic', closeMic); }
  setPercussion(layer: OrganLayer, enabled: boolean, third = false, fast = false) { this.setLayerControl(layer, 'percussion', enabled); this.setLayerControl(layer, 'percussionThird', third); this.setLayerControl(layer, 'percussionFast', fast); }
  setVibrato(layer: OrganLayer, enabled: boolean, chorus = false, type: 1|2|3 = 1) { this.setLayerControl(layer, 'vibrato', enabled); this.setLayerControl(layer, 'chorus', chorus); this.setLayerControl(layer, 'vibratoType', type); }
  setDrawbar(layer: OrganLayer, index: number, value: number) { const target = this.controls[layer === 'A' ? 'layerA' : 'layerB']; if (index >= 0 && index < 9) target.drawbars[index] = clamp(value); }
  syncPreset(layer: OrganLayer) { const target = this.controls[layer === 'A' ? 'layerA' : 'layerB']; target.drawbars = [...target.drawbars]; target.preset = true; }
  noteOn(note: number, velocity = .8): number { const id = this.nextId++; const a = this.controls.layerA; const b = this.controls.layerB; const active = [a,b].filter(l => l.enabled); if (!active.length || !this.audioContext) { this.voices.set(id, { id, gain: null as unknown as GainNode, oscillators: [], note }); return id; } const ctx = this.audioContext; const gain = ctx.createGain(); gain.gain.value = .0001; const oscs: OscillatorNode[] = []; active.forEach(layer => { const ratios = modelHarmonics[layer.model].slice(0, Math.min(9, layer.drawbars.length)); ratios.forEach((ratio, i) => { const osc = ctx.createOscillator(); osc.type = layer.model === 'B3' || layer.model === 'B3 Bass' ? 'sine' : 'sawtooth'; osc.frequency.value = midiFreq(note) * ratio * 2 ** (layer.octave / 12); const pg = ctx.createGain(); pg.gain.value = (layer.drawbars[i] ?? .4) / (1 + i * .3); osc.connect(pg).connect(gain); osc.start(); oscs.push(osc); }); }); const layerBus = this.controls.focusedLayer === 'A' ? 'organ-A' : 'organ-B'; this.graph.connectSource(gain, layerBus); gain.gain.setTargetAtTime(Math.max(.001, velocity * .12), ctx.currentTime, .01); this.voices.set(id, { id, gain, oscillators: oscs, note }); return id; }
  noteOff(id: number) { const voice = this.voices.get(id); if (!voice) return; if (this.audioContext && voice.gain) { const now = this.audioContext.currentTime; voice.gain.gain.setTargetAtTime(.0001, now, .08); voice.oscillators.forEach(o => { try { o.stop(now + .4); } catch { /* noop */ } }); } this.voices.delete(id); }
  allNotesOff() { [...this.voices.keys()].forEach(id => this.noteOff(id)); }
  renderNote(note: number, velocity = .8, seconds = .5): OrganRenderedAudio { const rendered = renderOrganNote(note, velocity, this.controls, seconds, this.audioContext?.sampleRate ?? 22050); const processed = this.graph.process(rendered.samples, rendered.sampleRate, this.controls.focusedLayer === 'A' ? 'organ-A' : 'organ-B'); let peak = 0; let sum = 0; for (const value of processed) { peak = Math.max(peak, Math.abs(value)); sum += value * value; } return { ...rendered, samples: processed, peak, rms: Math.sqrt(sum / processed.length), mode: this.mode }; }
  dispose() { this.allNotesOff(); this.voices.clear(); }
}
