/**
 * Maps panel control state to real audio on the AudioEngine.
 *
 * Every functional Piano / Layer-Effects / Master control routes through here so
 * the panel and the rendered audio never disagree (honesty contract). Controls
 * outside Phase 2 scope (Organ, Synth, Program) are intentionally NOT bound —
 * they stay decorative.
 *
 * `applyControl(engine, id, value, state)` applies one control's current value.
 * `applyAll` re-syncs the whole engine from a control snapshot (mount / focus
 * change). Values come from the presentation ControlStore (0..1 for knobs/faders,
 * option index for selectors, boolean for buttons).
 */

import type { AudioEngine, LayerId } from './audioEngine';
import { type AmpModel, type DelayFilterType } from './effects';
import { PIANO_TYPES } from './instruments';
import type { ControlState } from '../state/controlStore';
import type { PerformanceState } from '../state/program';
import { applyOrgan, applySynth, applyPerformance, makeRoutingGate } from './sectionBindings';

/**
 * The panel amp-model selector options are, in order:
 *   ['Small', 'JC', 'Twin', 'To Rotary', 'LP Filter', 'HP Filter']
 * Map each to the corresponding effect AmpModel.
 */
const AMP_MODEL_BY_PANEL_INDEX: AmpModel[] = [
  'Small',
  'JC',
  'Twin',
  'To Rotary',
  'LP24 Filter',
  'HP24 Filter',
];

/**
 * Reverb panel options: ['Room', 'Stage', 'Booth', 'Hall', 'Spring', 'Cath'].
 * Map to the effect ReverbType enum.
 */
const REVERB_BY_PANEL_INDEX = ['Room', 'Stage', 'Booth', 'Hall', 'Spring', 'Cathedral'] as const;

/** Mod 1 panel options: ['RM','Trem','A-Pan','A-Wah','Wah','Pump'] -> effect types. */
const MOD1_BY_PANEL_INDEX = ['Ring Mod', 'Tremolo', 'A-Pan', 'A-Wah', 'Wah', 'Pump'] as const;
/** Mod 2 panel options: ['Chor','Flang','Phas','Vibe','Ens','Spin'] -> effect types. */
const MOD2_BY_PANEL_INDEX = ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin'] as const;

const num = (v: unknown, d = 0): number => (typeof v === 'number' ? v : d);
const bool = (v: unknown): boolean => v === true;

/** Piano type selector index -> engine type id. */
function typeFromIndex(i: number) {
  return PIANO_TYPES[Math.max(0, Math.min(PIANO_TYPES.length - 1, i))];
}

/** Octave buttons are decorative counters; octave is tracked in the store as a number. */

/** Re-apply the full engine state from a control snapshot (+ optional performance). */
export function applyAll(engine: AudioEngine, state: ControlState, perf?: PerformanceState): void {
  // Master level
  engine.setMasterLevel(num(state['performance-master-level'], 0.7));

  // Piano performance (shared across layers)
  engine.setPerformance({
    type: typeFromIndex(num(state['piano-type'])),
    kbTouch: num(state['piano-kb-touch'], 1),
    dynComp: num(state['piano-dyn-comp']),
    timbre: num(state['piano-timbre']),
    unison: num(state['piano-unison']),
    softRelease: bool(state['piano-soft-rel']),
    stringRes: bool(state['piano-string-res']),
  });

  // Piano layers
  applyLayer(engine, 'A', state);
  applyLayer(engine, 'B', state);

  // Layer effects
  engine.setEffectsMasterOn(bool(state['effects-on']));
  engine.setPianoGroup(bool(state['effects-group']));
  engine.setGlobalUnit('delay', bool(state['effects-delay-global']));
  engine.setGlobalUnit('comp', bool(state['effects-comp-global']));
  engine.setGlobalUnit('reverb', bool(state['effects-reverb-global']));
  applyEffectFocus(engine, state);
  applyEffectParams(engine, state);

  // Organ + Synth sections (Phase 3).
  applyOrgan(engine, state);
  applySynth(engine, state);

  // Performance state (splits × scenes routing, clock, transpose).
  if (perf) {
    applyPerformance(engine, perf);
    engine.setRouting(makeRoutingGate(perf));
  }
}

function applyLayer(engine: AudioEngine, layer: LayerId, state: ControlState): void {
  const l = layer.toLowerCase();
  // A layer only sounds when the Piano section is ON and the layer is enabled.
  const sectionOn = bool(state['piano-on']);
  // Octave is owned by the engine (shifted by the octave buttons on the focused
  // layer); we preserve the current engine octave here rather than overwrite it.
  engine.setLayer(layer, {
    enabled: sectionOn && bool(state[`piano-on-off-${l}`]),
    level: num(state[`piano-level-${l}`], layer === 'A' ? 0.85 : 0.4),
    octave: engine.getLayer(layer).octave,
    sustPed: bool(state['piano-sustped']),
    pStick: bool(state['piano-pstick']),
  });
}

/** FX focus selector maps Organ A..Synth C; only Piano A/B are functional here. */
export function focusLayerFromIndex(i: number): LayerId | null {
  // options: ['Organ A','Organ B','Piano A','Piano B','Synth A','Synth B','Synth C']
  if (i === 2) return 'A';
  if (i === 3) return 'B';
  return null;
}

function applyEffectFocus(engine: AudioEngine, state: ControlState): void {
  const layer = focusLayerFromIndex(num(state['effects-focus'], 2));
  if (layer) engine.setFocus(layer);
}

function applyEffectParams(engine: AudioEngine, state: ControlState): void {
  // Mod 1
  engine.setUnitEngaged('mod1', bool(state['effects-mod1-on']));
  engine.applyToUnit('mod1', (c) => {
    c.mod1.setType(MOD1_BY_PANEL_INDEX[num(state['effects-mod1-type'], 1)] ?? 'Tremolo');
    c.mod1.setRate(num(state['effects-mod1-rate'], 0.4));
    c.mod1.setAmount(num(state['effects-mod1-amount'], 0.5));
  });

  // Mod 2
  engine.setUnitEngaged('mod2', bool(state['effects-mod2-on']));
  engine.applyToUnit('mod2', (c) => {
    c.mod2.setType(MOD2_BY_PANEL_INDEX[num(state['effects-mod2-type'], 0)] ?? 'Chorus');
    c.mod2.setRate(num(state['effects-mod2-rate'], 0.35));
    c.mod2.setAmount(num(state['effects-mod2-amount'], 0.5));
  });

  // Delay
  engine.setUnitEngaged('delay', bool(state['effects-delay-on']));
  engine.applyToUnit('delay', (c) => {
    c.delay.setTempo(num(state['effects-delay-tempo'], 0.4));
    c.delay.setFeedback(num(state['effects-delay-feedback'], 0.5));
    c.delay.setDryWet(num(state['effects-delay-drywet'], 0.3));
    c.delay.setFilter(delayFilterFromIndex(num(state['effects-delay-filter'])));
    c.delay.setPingPong(bool(state['effects-delay-pingpong']));
  });

  // Amp Sim / EQ (model may route To Rotary)
  engine.setUnitEngaged('amp', bool(state['effects-amp-on']));
  engine.setAmpModel(AMP_MODEL_BY_PANEL_INDEX[num(state['effects-amp-model'], 0)] ?? 'Small');
  engine.applyToUnit('amp', (c) => {
    c.amp.setDrive(num(state['effects-amp-drive'], 0.3));
    c.amp.setFreq(num(state['effects-amp-freq'], 0.6));
    c.amp.setBass(num(state['effects-amp-bass'], 0.5));
    c.amp.setMid(num(state['effects-amp-mid'], 0.5));
    c.amp.setTreble(num(state['effects-amp-treble'], 0.5));
  });

  // Compressor
  engine.setUnitEngaged('comp', bool(state['effects-comp-on']));
  engine.applyToUnit('comp', (c) => {
    c.comp.setAmount(num(state['effects-comp-amount'], 0.4));
    c.comp.setFast(bool(state['effects-comp-fast']));
  });

  // Reverb
  engine.setUnitEngaged('reverb', bool(state['effects-reverb-on']));
  engine.applyToUnit('reverb', (c) => {
    c.reverb.setType(REVERB_BY_PANEL_INDEX[num(state['effects-reverb-type'], 0)] ?? 'Room');
    c.reverb.setDryWet(num(state['effects-reverb-drywet'], 0.35));
    c.reverb.setTone(num(state['effects-reverb-tone']) === 1);
  });

  // Shared rotary (drive/speed from performance rotary controls).
  engine.rotaryUnit.setDrive(num(state['performance-rotary-drive'], 0.2));
  engine.rotaryUnit.setSpeed(num(state['performance-rotary-speed']) === 1);
}

function delayFilterFromIndex(i: number): DelayFilterType {
  return (['LP', 'HP', 'BP'] as const)[Math.max(0, Math.min(2, i))];
}

/**
 * Apply a single control change. For most effect params we just re-run the
 * relevant slice; for focus and type changes we re-sync so the newly focused /
 * grouped chain reflects the current panel values. Returns true if the control
 * is a functional Phase 2 binding (so callers know it touched audio).
 */
export function applyControl(engine: AudioEngine, id: string, state: ControlState): boolean {
  if (id === 'performance-master-level') {
    engine.setMasterLevel(num(state[id], 0.7));
    return true;
  }
  if (id === 'effects-focus' || id === 'effects-focus-a' || id === 'effects-focus-b') {
    if (id === 'effects-focus-a') engine.setFocus('A');
    else if (id === 'effects-focus-b') engine.setFocus('B');
    else applyEffectFocus(engine, state);
    // Re-sync effect params so the panel reflects the focused chain.
    applyEffectParams(engine, state);
    return true;
  }
  if (id === 'effects-group') {
    engine.setPianoGroup(bool(state[id]));
    applyEffectParams(engine, state);
    return true;
  }
  if (id.startsWith('piano-')) {
    // Any piano performance/layer control: re-sync piano state.
    engine.setPerformance({
      type: typeFromIndex(num(state['piano-type'])),
      kbTouch: num(state['piano-kb-touch'], 1),
      dynComp: num(state['piano-dyn-comp']),
      timbre: num(state['piano-timbre']),
      unison: num(state['piano-unison']),
      softRelease: bool(state['piano-soft-rel']),
      stringRes: bool(state['piano-string-res']),
    });
    applyLayer(engine, 'A', state);
    applyLayer(engine, 'B', state);
    return true;
  }
  if (id === 'effects-on') {
    engine.setEffectsMasterOn(bool(state[id]));
    return true;
  }
  if (id === 'effects-all-off') {
    // Momentary: while pressed, bypass everything.
    engine.setEffectsMasterOn(!bool(state[id]) && bool(state['effects-on']));
    return true;
  }
  if (id.startsWith('effects-') || id.startsWith('performance-rotary-')) {
    applyEffectParams(engine, state);
    return true;
  }
  if (id.startsWith('organ-')) {
    applyOrgan(engine, state);
    return true;
  }
  if (id.startsWith('synth-')) {
    applySynth(engine, state);
    return true;
  }
  return false;
}
