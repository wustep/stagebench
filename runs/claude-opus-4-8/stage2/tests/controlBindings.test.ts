import { describe, expect, it } from 'vitest';
import { makeOfflineCtx, render } from './helpers/audio';
import { AudioEngine } from '../src/audio/audioEngine';
import { ControlStore } from '../src/state/controlStore';
import { applyAll, applyControl } from '../src/audio/controlBindings';

/** Mirror the app: any store change re-syncs the whole engine via applyAll. */
function sync(engine: AudioEngine, store: ControlStore) {
  applyAll(engine, store.getState());
}

// feature: effects.routing / piano.* — panel state maps to real audio and the
// panel/audio never disagree (honesty contract).

function engineWithStore(seconds = 0.6) {
  const ctx = makeOfflineCtx(seconds);
  const engine = new AudioEngine(ctx);
  engine.setStatus('ready');
  const store = new ControlStore();
  applyAll(engine, store.getState());
  return { engine, ctx, store };
}

describe('panel-to-audio bindings (effects.routing)', () => {
  it('master level control drives master gain', async () => {
    const { engine, ctx, store } = engineWithStore();
    store.set('performance-master-level', 0.05);
    applyControl(engine, 'performance-master-level', store.getState());
    engine.setLayer('A', { enabled: true });
    engine.noteOn(60, 110);
    const quiet = await render(ctx);

    const b = engineWithStore();
    b.store.set('performance-master-level', 0.95);
    applyControl(b.engine, 'performance-master-level', b.store.getState());
    b.engine.setLayer('A', { enabled: true });
    b.engine.noteOn(60, 110);
    const loud = await render(b.ctx);
    expect(loud.rms).toBeGreaterThan(quiet.rms);
  });

  it('piano type selector changes the sounding voice', async () => {
    // Default (Grand, no samples loaded) falls back to synth 'digital' recipe;
    // switching to a synth type (Misc/mallet) changes the rendered waveform.
    const { engine, ctx, store } = engineWithStore(0.8);
    store.set('piano-on-off-a', true);
    store.set('piano-type', 5); // Misc
    applyControl(engine, 'piano-type', store.getState());
    engine.noteOn(60, 110);
    const misc = await render(ctx);

    const b = engineWithStore(0.8);
    b.store.set('piano-on-off-a', true);
    b.store.set('piano-type', 3); // Clav
    applyControl(b.engine, 'piano-type', b.store.getState());
    b.engine.noteOn(60, 110);
    const clav = await render(b.ctx);
    expect(Math.abs(misc.rms - clav.rms)).toBeGreaterThan(0);
  });

  it('layer B enable button brings layer B voices online', () => {
    const { engine, store } = engineWithStore();
    store.set('piano-on-off-a', true);
    store.set('piano-on-off-b', false);
    applyControl(engine, 'piano-on-off-b', store.getState());
    engine.noteOn(60, 100);
    expect(engine.activeVoiceCount).toBe(1);
    engine.allNotesOff();

    store.set('piano-on-off-b', true);
    applyControl(engine, 'piano-on-off-b', store.getState());
    engine.noteOn(60, 100);
    expect(engine.activeVoiceCount).toBe(2);
  });

  it('reverb ON toggles the unit bypass on the focused layer', () => {
    const { engine, store } = engineWithStore();
    store.set('effects-on', true);
    store.set('effects-reverb-on', true);
    sync(engine, store);
    expect(engine.chain('A').reverb.bypassed).toBe(false);
    store.set('effects-reverb-on', false);
    sync(engine, store);
    expect(engine.chain('A').reverb.bypassed).toBe(true);
  });

  it('effects-group applies unit engagement to both piano layers', () => {
    const { engine, store } = engineWithStore();
    store.set('effects-on', true);
    store.set('effects-group', true);
    store.set('effects-delay-on', true);
    sync(engine, store);
    expect(engine.chain('A').delay.bypassed).toBe(false);
    expect(engine.chain('B').delay.bypassed).toBe(false);
  });

  it('delay GLOBAL toggle targets both layers regardless of focus', () => {
    const { engine, store } = engineWithStore();
    store.set('effects-on', true);
    store.set('effects-focus', 2); // Piano A
    store.set('effects-delay-global', true);
    store.set('effects-delay-on', true);
    sync(engine, store);
    expect(engine.chain('A').delay.bypassed).toBe(false);
    expect(engine.chain('B').delay.bypassed).toBe(false);
  });

  it('amp model To Rotary flips the chain rotary routing', () => {
    const { engine, store } = engineWithStore();
    store.set('effects-on', true);
    store.set('effects-amp-on', true);
    store.set('effects-amp-model', 3); // To Rotary
    sync(engine, store);
    expect(engine.chain('A').amp.routeToRotary).toBe(true);
  });

  it('Organ/Synth/Program controls stay decorative (no audio binding)', () => {
    const { engine, store } = engineWithStore();
    // Toggling organ/synth controls returns false: not a functional binding.
    expect(applyControl(engine, 'organ-on', store.getState())).toBe(false);
    expect(applyControl(engine, 'synth-filter-freq', store.getState())).toBe(false);
    expect(applyControl(engine, 'program-store', store.getState())).toBe(false);
  });
});
