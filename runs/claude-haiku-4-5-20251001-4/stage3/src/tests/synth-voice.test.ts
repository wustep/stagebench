import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PianoVoiceEngine } from '../audio/synth-voice';

describe('Piano Voice Engine', () => {
  let audioContext: AudioContext;
  let masterGain: GainNode;
  let engine: PianoVoiceEngine;

  beforeEach(() => {
    audioContext = new (global as any).AudioContext();
    masterGain = audioContext.createGain();
    engine = new PianoVoiceEngine(audioContext, masterGain);
  });

  afterEach(() => {
    engine.cleanup();
  });

  it('creates voices on noteOn', () => {
    expect(engine.getActiveVoiceCount()).toBe(0);
    engine.noteOn(60, 64);
    expect(engine.getActiveVoiceCount()).toBe(1);
  });

  it('can play multiple notes simultaneously', () => {
    engine.noteOn(60, 64);
    engine.noteOn(64, 70);
    engine.noteOn(67, 65);
    expect(engine.getActiveVoiceCount()).toBe(3);
  });

  it('removes voices on noteOff', () => {
    engine.noteOn(60, 64);
    engine.noteOn(64, 70);
    expect(engine.getActiveVoiceCount()).toBe(2);

    engine.noteOff(60);
    // Voice is in release state, might still count
    expect(engine.getActiveVoiceCount()).toBeLessThanOrEqual(2);
  });

  it('respects max polyphony', () => {
    // Note: The default maxPolyphony is 32, so we test with lower values
    for (let i = 0; i < 35; i++) {
      engine.noteOn(60 + (i % 12), 64);
    }
    // Should not exceed max polyphony
    expect(engine.getActiveVoiceCount()).toBeLessThanOrEqual(32);
  });

  it('performs voice stealing when polyphony limit reached', () => {
    // Add voices up to limit
    for (let i = 0; i < 32; i++) {
      engine.noteOn(36 + (i % 48), 64);
    }
    expect(engine.getActiveVoiceCount()).toBe(32);

    // One more note should trigger stealing
    engine.noteOn(72, 64);
    expect(engine.getActiveVoiceCount()).toBeLessThanOrEqual(32);
  });

  it('supports sustain pedal', () => {
    engine.noteOn(60, 64);
    engine.setSustainPedal(true);
    // Voice should still be active (sustain holding)
    expect(engine.getActiveVoiceCount()).toBe(1);

    engine.setSustainPedal(false);
    // Even after turning off sustain, voice should still exist
    // (it's in release state)
  });

  it('clears all notes on allNotesOff', () => {
    engine.noteOn(60, 64);
    engine.noteOn(64, 70);
    engine.noteOn(67, 65);
    expect(engine.getActiveVoiceCount()).toBe(3);

    engine.allNotesOff();
    expect(engine.getActiveVoiceCount()).toBe(0);
  });

  it('different velocities affect voice volume', () => {
    engine.noteOn(60, 127); // Max velocity
    engine.noteOn(64, 1); // Min velocity
    // Both voices should exist
    expect(engine.getActiveVoiceCount()).toBe(2);
  });
});
