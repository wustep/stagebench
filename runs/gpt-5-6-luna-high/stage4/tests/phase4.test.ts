import { describe, expect, it } from 'vitest';
import { OrganEngine, renderOrganNote } from '../src/organEngine';
import { SynthEngine, renderSynthNote } from '../src/synthEngine';
import { EffectsGraph } from '../src/effectsGraph';
import { ProgramStore, serializeProgram, deserializeProgram } from '../src/programState';

const energy = (a: Float32Array) => a.reduce((s, v, i) => s + v * v * (1 + (i % 7) / 10), 0);

describe('Phase 4 Organ engine boundary', () => {
  it('renders six distinct model spectra and drawbar/register changes', () => {
    const models = ['B3','B3 Bass','Vox','Farf','Pipe 1','Pipe 2'] as const;
    const signatures = models.map(model => energy(renderOrganNote(60, .8, { layerA: { enabled: true, model }, layerB: { enabled: false } }, .12).samples));
    expect(new Set(signatures.map(v => v.toFixed(7))).size).toBeGreaterThan(3);
    const a = renderOrganNote(60, .8, { layerA: { enabled: true, model: 'B3', drawbars: [1,0,0,0,0,0,0,0,0] }, layerB: { enabled: false } });
    const b = renderOrganNote(60, .8, { layerA: { enabled: true, model: 'B3', drawbars: [0,0,0,0,0,0,0,0,1] }, layerB: { enabled: false } });
    expect(energy(a.samples)).not.toBeCloseTo(energy(b.samples), 5);
  });
  it('applies percussion, click, vibrato, rotary, and two-layer controls', () => {
    const dry = renderOrganNote(48, .7, { layerA: { enabled: true, model: 'B3', percussion: false, keyClick: 0, vibrato: false, rotary: 'Stop' }, layerB: { enabled: false } });
    const wet = renderOrganNote(48, .7, { layerA: { enabled: true, model: 'B3', percussion: true, keyClick: .5, vibrato: true, rotary: 'Fast', rotaryDrive: .8 }, layerB: { enabled: true, model: 'Pipe 2', level: .4 } });
    expect(energy(dry.samples)).not.toBeCloseTo(energy(wet.samples), 3);
    const engine = new OrganEngine(null, new EffectsGraph(null)); engine.controls.layerA.enabled = true; const id = engine.noteOn(60); expect(id).toBeGreaterThan(0); engine.noteOff(id); engine.dispose();
  });
});

describe('Phase 4 Synth engine boundary', () => {
  it('renders source families and Osc Ctrl differently', () => {
    const pure = renderSynthNote(60, .8, { layerA: { enabled: true, mode: 'Analog', category: 'Pure', oscCtrl: .1 }, layerB: { enabled: false }, layerC: { enabled: false } }, .15);
    const fm = renderSynthNote(60, .8, { layerA: { enabled: true, mode: 'Analog', category: 'FM Inharmonic', oscCtrl: .9 }, layerB: { enabled: false }, layerC: { enabled: false } }, .15);
    const sample = renderSynthNote(60, .8, { layerA: { enabled: true, mode: 'Samples', sample: 'Unison options', unison: 2 }, layerB: { enabled: false }, layerC: { enabled: false } }, .15);
    expect(energy(pure.samples)).not.toBeCloseTo(energy(fm.samples), 4); expect(energy(sample.samples)).not.toBeCloseTo(energy(pure.samples), 4);
  });
  it('changes filters, envelopes, LFO, voice mode and deterministic arp pattern', () => {
    const lp = renderSynthNote(64, .8, { layerA: { enabled: true, filterType: 'LP24', filterFrequency: .2, resonance: .8, filterDrive: 0, ampAttack: .2 }, layerB: { enabled: false }, layerC: { enabled: false } });
    const hp = renderSynthNote(64, .8, { layerA: { enabled: true, filterType: 'HP', filterFrequency: .8, resonance: .1, filterDrive: 3, lfoAmount: .8, lfoDestination: 'Filter', voiceMode: 'Mono', arpMode: 'Gate', arpPattern: [1,-1,0,1] }, layerB: { enabled: false }, layerC: { enabled: false } });
    expect(energy(lp.samples)).not.toBeCloseTo(energy(hp.samples), 3);
    const engine = new SynthEngine(null, new EffectsGraph(null)); engine.setLayerControl('A', 'arpPattern', [1,-1,2]); expect(engine.arpPattern(6)).toEqual([1,-1,2,1,-1,2]); engine.dispose();
  });
  it('shares inherited graph and Program state round-trip for engine metadata', () => {
    const graph = new EffectsGraph(null); const organ = new OrganEngine(null, graph); const synth = new SynthEngine(null, graph); expect(organ.graph).toBe(synth.graph); const store = new ProgramStore(); store.update(s => { s.organ.layerA = { model: 'Vox', drawbars: [1,0,1], enabled: true }; s.synth.layerA = { mode: 'Analog', category: 'Super', oscCtrl: .8, enabled: true }; s.layers.organA.enabled = true; s.layers.synthA.enabled = true; }); const restored = deserializeProgram(serializeProgram(store.state)); expect((restored.organ.layerA as { model: string }).model).toBe('Vox'); expect((restored.synth.layerA as { category: string }).category).toBe('Super'); organ.dispose(); synth.dispose(); graph.dispose();
  });
});
