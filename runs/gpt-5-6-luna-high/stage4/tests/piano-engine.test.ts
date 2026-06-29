import { PianoEngine, applyTouchCurve, renderModelledPiano } from '../src/pianoEngine';

describe('Phase 2 Piano audio boundary', () => {
  it('renders a truthful playable physical model and velocity changes level', () => {
    const quiet = renderModelledPiano(60, 0.2);
    const loud = renderModelledPiano(60, 1);
    expect(quiet.mode).toBe('physical-model');
    expect(loud.rms).toBeGreaterThan(quiet.rms);
    expect(loud.peak).toBeGreaterThan(quiet.peak);
  });

  it('applies touch curves and sonic Piano controls', () => {
    expect(applyTouchCurve(0.5, 'Heavy')).toBeLessThan(0.5);
    expect(applyTouchCurve(0.5, 'Light')).toBeGreaterThan(0.5);
    const engine = new PianoEngine(null);
    const dry = engine.renderNote(60, 0.8);
    engine.setMasterVolume(0.35);
    const quieter = engine.renderNote(60, 0.8);
    expect(quieter.rms).toBeLessThan(dry.rms);
    engine.setMasterVolume(0.8); engine.setReverb(0.85); engine.setControl('timbre', 'Bright'); engine.setControl('unison', 3);
    const altered = engine.renderNote(60, 0.8);
    expect(altered.rms).not.toBeCloseTo(dry.rms, 4);
    expect(altered.samples).not.toEqual(dry.samples);
    engine.setControl('layerB', true); engine.setControl('layerLevelB', 0.2); engine.setControl('model', 8); engine.setControl('stringResonance', false); engine.setControl('softPedal', true);
    const layered = engine.renderNote(60, 0.8);
    expect(layered.samples).not.toEqual(altered.samples);
  });

  it('shares deterministic note ownership, repeated notes and cleanup', () => {
    const engine = new PianoEngine(null);
    const first = engine.noteOn(60, 0.7, 'pointer');
    const second = engine.noteOn(60, 0.9, 'keyboard');
    expect(second).not.toBe(first);
    expect(engine.activeVoices).toHaveLength(1);
    engine.noteOff(60, 'keyboard');
    expect(engine.activeVoices).toHaveLength(0);
    engine.noteOn(60, 0.8, 'midi'); engine.noteOn(64, 0.8, 'touch');
    engine.allNotesOff();
    expect(engine.activeVoices).toHaveLength(0);
    engine.dispose();
  });

  it('holds and orders releases through sustain and half-pedal', () => {
    const engine = new PianoEngine(null);
    engine.noteOn(60, 0.8); engine.setSustain(0.5); engine.noteOff(60);
    expect(engine.activeVoices[0].released).toBe(false);
    engine.setSustain(0); expect(engine.activeVoices).toHaveLength(0);
  });

  it('sostenuto captures only notes held when engaged', () => {
    const engine = new PianoEngine(null);
    engine.noteOn(60); engine.setSostenuto(true); engine.noteOn(64);
    engine.noteOff(60); engine.noteOff(64);
    expect(engine.activeVoices.map(v => v.note)).toEqual([60]);
    engine.setSostenuto(false);
    expect(engine.activeVoices).toHaveLength(0);
  });

  it('resumes a suspended AudioContext from the first gesture and reports errors', async () => {
    let state: AudioContextState = 'suspended';
    const context = { get state() { return state; }, resume: vi.fn(async () => { state = 'running'; }) };
    const fake = { audioContext: context, audioStatus: 'suspended', notifyStatus: vi.fn() };
    const resumed = await PianoEngine.prototype.resumeAudio.call(fake as unknown as PianoEngine);
    expect(resumed).toBe(true); expect(fake.audioStatus).toBe('ready'); expect(context.resume).toHaveBeenCalled();
  });

  it('steals deterministically at the voice limit and parses MIDI', () => {
    const engine = new PianoEngine(null);
    for (let i = 0; i < 25; i += 1) engine.noteOn(40 + i, 0.7, 'midi');
    expect(engine.activeVoices.length).toBeLessThanOrEqual(24);
    engine.handleMidi({ data: [0x90, 60, 100] });
    expect(engine.activeVoices.some(v => v.note === 60)).toBe(true);
    engine.handleMidi({ data: [0xb0, 64, 80] }); expect(engine.controls.sustain).toBeGreaterThan(0.5);
    expect(engine.status).toMatch(/ready/);
  });

  it('reports MIDI failure without navigator access', async () => {
    const engine = new PianoEngine(null);
    const connected = await engine.connectMidi();
    expect(connected).toBe(false);
    expect(engine.midiStatus).toMatch(/unavailable|permission/);
  });
});
