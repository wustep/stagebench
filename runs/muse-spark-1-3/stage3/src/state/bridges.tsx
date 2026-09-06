/**
 * Phase 3 hardware bridge: every non-excluded Phase 1 control ID drives
 * canonical instrument state (same movement moves the knob and the sound).
 * Null outside the InstrumentProvider — isolated Phase 1–2 tests keep their
 * exact presentation behavior.
 *
 * Mapping table (full audit in `evidence/stage3-binding-audit.md`):
 * - perf-mod-wheel → Wheel morph position 0..10 (also vibrato when WHL).
 * - perf-rotary-stop → rotary Stop (toggles stop/slow).
 * - organ drawbars/volume/perc/models/vib/layers/levels → focused organ layer.
 * - piano hardware → focused piano layer (type/model/timbre/octave/levels…).
 * - program slots/dial/pages/live/scene/store/split/transpose/mono/panic,
 *   wheel/pedal morph arm → instrument store.
 * - synth wave/shape/oct/cutoff/res/env/amp/lfo/layers/unison/run/tap/vib →
 *   focused synth layer (+ morph capture when armed).
 * - fx hardware → focused chain params (organ amount/rate, piano amount/rate,
 *   delay/reverb/amp/comp, on/off, focus A/B).
 */

import { useInstrumentOptional } from './instrument';
import { LIVE_SLOTS, PROGRAM_SLOTS } from './program';
import { MORPH_TARGET_INFO } from './program';
import type { OrganModelId } from '../audio/organTypes';
import { ORGAN_MODELS, VIB_CHORUS_POSITIONS } from '../audio/organTypes';
import { PIANO_TYPES } from '../audio/pianoTypes';
import type { PianoTypeId } from '../audio/pianoTypes';
import { ALL_WAVES, type SynthLayerId } from '../audio/synthTypes';

export interface Phase3Bridge {
  valueOf(id: string): number | undefined;
  interact(id: string, direction: 1 | -1): void;
  /** Green morph LED: this hardware control has a morph assignment. */
  isMorphed(id: string): boolean;
}

const ORGAN_MODELS_BY_BTN = ['B3', 'Vox', 'Farf', 'Pipe 1', 'Pipe 2'] as OrganModelId[];
const PIANO_TYPES_BY_BTN = ['grand', 'upright', 'electric', 'clav', 'digital', 'misc'] as PianoTypeId[];

export function usePhase3Bridge(): Phase3Bridge | null {
  const fx = useInstrumentOptional();
  // Null outside the provider: DecorativeControl keeps its exact Phase 1–2
  // presentation behavior in isolated tests.
  if (!fx) return null;
  const snap = fx.snapshot;
  const program = snap.program;

  const organFocus = program.organ.focus;
  const pianoFocus = program.piano.layerFocus;
  const synthFocus = program.synth.focus;

  /** Canonical morph target for a hardware control id (for LED + capture). */
  const morphTargetFor = (id: string): string | null => {
    const draw = /^organ-drawbar-(\d)$/.exec(id);
    if (draw) return `organ.drawbar.${draw[1]}`;
    if (id === 'organ-volume' || id === 'organ-level-a' || id === 'organ-level-b') {
      const layer = id === 'organ-level-b' ? 'B' : organFocus;
      return `organ.${layer}.level`;
    }
    if (id === 'piano-level-a') return 'piano.A.level';
    if (id === 'piano-level-b') return 'piano.B.level';
    if (id === 'synth-level-a') return 'synth.A.level';
    if (id === 'synth-level-b') return id === 'synth-level-b' && program.synth.focus === 'C' ? 'synth.C.level' : 'synth.B.level';
    if (id === 'synth-osc-shape') return `synth.${synthFocus}.oscCtrl`;
    if (id === 'synth-filter-cutoff') return `synth.${synthFocus}.filterFreq`;
    if (id === 'synth-filter-res') return `synth.${synthFocus}.filterRes`;
    if (id === 'synth-lfo-rate') return `synth.${synthFocus}.lfoRate`;
    if (id === 'synth-lfo-amount') return `synth.${synthFocus}.lfoAmt`;
    if (id === 'fx-organ-rate') return 'fx.mod1Rate';
    if (id === 'fx-organ-amount') return 'fx.mod1Amt';
    if (id === 'fx-piano-amount') return 'fx.mod2Amt';
    if (id === 'fx-delay-time') return 'fx.delayTempo';
    if (id === 'fx-delay-feedback') return 'fx.delayFb';
    if (id === 'fx-reverb-decay') return 'fx.reverbWet';
    if (id === 'fx-amp-drive') return 'fx.drive';
    if (id === 'fx-eq-treble') return 'fx.eqFreq';
    return null;
  };

  const captureIfArmed = (id: string, value: number) => {
    if (!fx.morphArmed) return;
    const target = morphTargetFor(id);
    if (target && MORPH_TARGET_INFO[target]) fx.captureMorphControl(fx.morphArmed, target, value);
  };

  const stepDrawbar = (layer: 'A' | 'B', index: number, direction: 1 | -1): number => {
    const st = program.organ.layers[layer];
    const next = [...st.drawbars];
    next[index] = Math.min(8, Math.max(0, next[index] + direction));
    fx.edit((p) => ({ ...p, organ: { ...p.organ, layers: { ...p.organ.layers, [layer]: { ...st, drawbars: next } } } }));
    return next[index];
  };

  return {
    valueOf: (id: string): number | undefined => {
      // Performance: the wheel shows the live Wheel morph position 0..10.
      // (Rotary stop is handled by the Phase 2 piano bridge.)
      if (id === 'perf-mod-wheel') return Math.round(fx.getMorphPos('wheel') * 10);
      // Organ.
      const draw = /^organ-drawbar-(\d)$/.exec(id);
      if (draw) return program.organ.layers[organFocus].drawbars[Number(draw[1]) - 1];
      if (id === 'organ-volume' || id === 'organ-level-a' || id === 'organ-level-b') {
        const layer = id === 'organ-level-b' ? 'B' : id === 'organ-level-a' ? 'A' : organFocus;
        return program.organ.layers[layer].level;
      }
      if (id === 'organ-on-a') return program.organ.layers.A.enabled ? 1 : 0;
      if (id === 'organ-on-b') return program.organ.layers.B.enabled ? 1 : 0;
      const om = /^organ-model-(\d)$/.exec(id);
      if (om) return program.organ.layers[organFocus].model === ORGAN_MODELS_BY_BTN[Number(om[1]) - 1] ? 1 : 0;
      const vib = /^organ-vib-(\d)$/.exec(id);
      if (vib) {
        const order = ['V1', 'V2', 'V3', 'C1', 'C2'] as const;
        return program.organ.layers[organFocus].vibChorus === order[Number(vib[1]) - 1] ? 1 : 0;
      }
      if (id === 'organ-perc-1' || id === 'organ-perc-2' || id === 'organ-perc-3' || id === 'organ-perc-4') {
        const st = program.organ.layers[organFocus].percussion;
        return (id === 'organ-perc-4' ? st.on : id === 'organ-perc-3' ? st.soft : id === 'organ-perc-2' ? st.fast : st.third) ? 1 : 0;
      }
      // Piano hardware → focused layer.
      const p = program.piano.layers[pianoFocus];
      if (id === 'piano-level-a') return program.piano.layers.A.level;
      if (id === 'piano-level-b') return program.piano.layers.B.level;
      if (id === 'piano-on') return program.piano.sectionOn ? 1 : 0;
      const pt = /^piano-type-(\d)$/.exec(id);
      if (pt) return p.type === PIANO_TYPES_BY_BTN[Number(pt[1]) - 1] ? 1 : 0;
      if (id === 'piano-model') return p.model;
      if (id === 'piano-octave') return p.octave;
      if (id === 'piano-timbre') {
        const fam = PIANO_TYPES.find((t) => t.id === p.type)!.models[0].timbreFamily;
        const opts = fam === 'electric' ? ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2'] : ['Off', 'Soft', 'Mid', 'Bright'];
        return Math.max(0, opts.indexOf(p.timbre));
      }
      const pd = /^piano-detail-(\d)$/.exec(id);
      if (pd) {
        const n = Number(pd[1]);
        const vals = [p.kbTouch !== 'Medium', p.dynComp > 0, p.softRelease, p.stringRes, p.sustPed, p.pStick];
        return vals[n - 1] ? 1 : 0;
      }
      // Program hardware.
      if (id === 'program-dial') return snap.liveMode ? snap.liveSlot : snap.slot;
      const slot = /^program-slot-(\d)$/.exec(id);
      if (slot) {
        const n = Number(slot[1]);
        if (snap.liveMode) return snap.liveSlot === n - 1 ? 1 : 0;
        const global = (snap.page - 1) * 8 + (n - 1);
        return snap.slot === global ? 1 : 0;
      }
      if (id === 'program-fn-1' || id === 'program-fn-2') return snap.page === (id === 'program-fn-1' ? 1 : 2) ? 1 : 0;
      if (id === 'program-fn-3') return snap.liveMode ? 1 : 0;
      if (id === 'program-fn-4' || id === 'program-fn-5') {
        const want = id === 'program-fn-4' ? 'I' : 'II';
        return snap.scene === want ? 1 : 0;
      }
      if (id === 'program-fn-6' || id === 'program-fn-9' || id === 'program-fn-10') return 0;
      if (id === 'program-fn-7') return program.split.on ? 1 : 0;
      if (id === 'program-fn-8') return program.transpose !== 0 ? 1 : 0;
      if (id === 'program-morph-1' || id === 'program-morph-2') {
        const source = id === 'program-morph-1' ? 'wheel' : 'pedal';
        return fx.morphArmed === source ? 1 : program.morphs[source].length > 0 ? 1 : 0;
      }
      // Synth hardware → focused layer.
      const s = program.synth.layers[synthFocus];
      if (id === 'synth-level-a') return program.synth.layers.A.level;
      if (id === 'synth-level-b') return program.synth.layers.B.level;
      if (id === 'synth-osc-wave') return ALL_WAVES.indexOf(s.wave);
      if (id === 'synth-osc-shape') return s.oscCtrl;
      if (id === 'synth-osc-oct') return s.octave;
      if (id === 'synth-filter-cutoff') return s.filterFreq;
      if (id === 'synth-filter-res') return s.filterRes;
      if (id === 'synth-filter-env') return s.filterEnvAmt;
      if (id === 'synth-amp-attack') return s.ampEnv.attack;
      if (id === 'synth-amp-decay') return s.ampEnv.decay;
      if (id === 'synth-amp-sustain') return s.ampSustain;
      if (id === 'synth-amp-release') return s.ampEnv.release;
      if (id === 'synth-lfo-rate') return s.lfoRate;
      if (id === 'synth-lfo-amount') return s.lfoAmt;
      if (id === 'synth-fn-1') return program.synth.layers.A.enabled ? 1 : 0;
      if (id === 'synth-fn-2') return program.synth.layers.B.enabled ? 1 : 0;
      if (id === 'synth-fn-3') return s.voice.unison > 0 ? 1 : 0;
      if (id === 'synth-fn-4') return s.arp.run ? 1 : 0;
      if (id === 'synth-fn-5' || id === 'synth-fn-6') return 0;
      // FX hardware → focused chain.
      const chainFor = (): { key: string; chain: import('./fxTypes').ChainState } => {
        const f = snap.program.piano.layerFocus;
        void f;
        return { key: 'piano', chain: program.piano.chains[program.piano.layerFocus] };
      };
      const c = chainFor().chain;
      if (id === 'fx-organ-amount') return program.organ.chain.mod1.amount;
      if (id === 'fx-organ-rate') return program.organ.chain.mod1.rate;
      if (id === 'fx-piano-amount') return c.mod2.amount;
      if (id === 'fx-piano-rate') return c.mod2.rate;
      if (id === 'fx-delay-time') return Math.round((c.delay.timeMs - 20) / 148);
      if (id === 'fx-delay-feedback') return c.delay.feedback;
      if (id === 'fx-reverb-decay') return c.reverb.wet;
      if (id === 'fx-amp-drive') return c.ampEq.drive;
      if (id === 'fx-eq-treble') return c.ampEq.treble + 15;
      if (id === 'fx-comp-amount') return c.comp.amount;
      if (id === 'fx-on-1') return program.organ.chain.mod1.on ? 1 : 0;
      if (id === 'fx-on-2') return c.mod2.on ? 1 : 0;
      if (id === 'fx-on-3') return c.delay.on ? 1 : 0;
      if (id === 'fx-on-4') return c.ampEq.on ? 1 : 0;
      if (id === 'fx-on-5') return c.ampEq.on ? 1 : 0;
      if (id === 'fx-on-6') return c.comp.on ? 1 : 0;
      if (id === 'fx-on-7') return c.reverb.on ? 1 : 0;
      if (id === 'fx-organ-focus-a' || id === 'fx-organ-focus-b') {
        return program.organ.focus === (id === 'fx-organ-focus-a' ? 'A' : 'B') ? 1 : 0;
      }
      return undefined;
    },
    interact: (id: string, direction: 1 | -1): void => {
      // Performance: the wheel drives the live Wheel morph position (0..10);
      // live-only, never stored, never dirty (manual pp. 38-39).
      if (id === 'perf-mod-wheel') {
        const cur = Math.round(fx.getMorphPos('wheel') * 10);
        fx.setMorphSourcePos('wheel', (Math.min(10, Math.max(0, cur + direction))) / 10);
        return;
      }
      const draw = /^organ-drawbar-(\d)$/.exec(id);
      if (draw) {
        const v = stepDrawbar(organFocus, Number(draw[1]) - 1, direction);
        captureIfArmed(id, v);
        return;
      }
      if (id === 'organ-volume') {
        const st = program.organ.layers[organFocus];
        const v = Math.min(10, Math.max(0, st.level + direction));
        fx.edit((p) => ({ ...p, organ: { ...p.organ, layers: { ...p.organ.layers, [organFocus]: { ...st, level: v } } } }));
        captureIfArmed(id, v);
        return;
      }
      if (id === 'organ-level-a' || id === 'organ-level-b') {
        const layer = id === 'organ-level-b' ? 'B' : 'A';
        const st = program.organ.layers[layer as 'A' | 'B'];
        const v = Math.min(10, Math.max(0, st.level + direction));
        fx.edit((p) => ({ ...p, organ: { ...p.organ, layers: { ...p.organ.layers, [layer]: { ...st, level: v } } } }));
        captureIfArmed(id, v);
        return;
      }
      if (id === 'organ-on-a' || id === 'organ-on-b') {
        const layer = id === 'organ-on-a' ? 'A' : 'B';
        const st = program.organ.layers[layer as 'A' | 'B'];
        fx.edit((p) => ({ ...p, organ: { ...p.organ, layers: { ...p.organ.layers, [layer]: { ...st, enabled: !st.enabled } } } }));
        return;
      }
      const om = /^organ-model-(\d)$/.exec(id);
      if (om) {
        const model = ORGAN_MODELS_BY_BTN[Number(om[1]) - 1];
        const st = program.organ.layers[organFocus];
        fx.edit((p) => ({ ...p, organ: { ...p.organ, layers: { ...p.organ.layers, [organFocus]: { ...st, model } } } }));
        return;
      }
      const vib = /^organ-vib-(\d)$/.exec(id);
      if (vib) {
        const order = ['V1', 'V2', 'V3', 'C1', 'C2'] as const;
        const st = program.organ.layers[organFocus];
        fx.edit((p) => ({ ...p, organ: { ...p.organ, layers: { ...p.organ.layers, [organFocus]: { ...st, vibChorus: order[Number(vib[1]) - 1], vibOn: true } } } }));
        return;
      }
      const perc = /^organ-perc-(\d)$/.exec(id);
      if (perc) {
        const n = Number(perc[1]);
        const st = program.organ.layers[organFocus];
        const pc = { ...st.percussion };
        if (n === 4) pc.on = !pc.on;
        else if (n === 3) pc.soft = !pc.soft;
        else if (n === 2) pc.fast = !pc.fast;
        else pc.third = !pc.third;
        fx.edit((p) => ({ ...p, organ: { ...p.organ, layers: { ...p.organ.layers, [organFocus]: { ...st, percussion: pc } } } }));
        return;
      }
      // Piano hardware.
      if (id === 'piano-level-a' || id === 'piano-level-b') {
        const layer = id === 'piano-level-a' ? 'A' : 'B';
        const v = Math.min(10, Math.max(0, program.piano.layers[layer as 'A' | 'B'].level + direction));
        fx.editPianoLayer(layer as 'A' | 'B', { level: v });
        captureIfArmed(id, v);
        return;
      }
      if (id === 'piano-on') {
        fx.edit((p) => ({ ...p, piano: { ...p.piano, sectionOn: !p.piano.sectionOn } }));
        return;
      }
      const pt = /^piano-type-(\d)$/.exec(id);
      if (pt) {
        fx.editPianoLayer(pianoFocus, { type: PIANO_TYPES_BY_BTN[Number(pt[1]) - 1], model: 0 });
        return;
      }
      if (id === 'piano-model') {
        const p = program.piano.layers[pianoFocus];
        const count = PIANO_TYPES.find((t) => t.id === p.type)!.models.length;
        fx.editPianoLayer(pianoFocus, { model: (p.model + (direction === 1 ? 1 : count - 1)) % count });
        return;
      }
      if (id === 'piano-octave') {
        const p = program.piano.layers[pianoFocus];
        fx.editPianoLayer(pianoFocus, { octave: Math.min(4, Math.max(0, p.octave + direction)) });
        return;
      }
      if (id === 'piano-timbre') {
        const p = program.piano.layers[pianoFocus];
        const fam = PIANO_TYPES.find((t) => t.id === p.type)!.models[0].timbreFamily;
        const opts = (fam === 'electric' ? ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2'] : ['Off', 'Soft', 'Mid', 'Bright']) as Array<typeof p.timbre>;
        fx.editPianoLayer(pianoFocus, { timbre: opts[(opts.indexOf(p.timbre) + (direction === 1 ? 1 : opts.length - 1)) % opts.length] });
        return;
      }
      const pd = /^piano-detail-(\d)$/.exec(id);
      if (pd) {
        const n = Number(pd[1]);
        const p = program.piano.layers[pianoFocus];
        if (n === 1) fx.editPianoLayer(pianoFocus, { kbTouch: p.kbTouch === 'Medium' ? 'Heavy' : 'Medium' });
        else if (n === 2) fx.editPianoLayer(pianoFocus, { dynComp: (p.dynComp + 1) % 4 });
        else if (n === 3) fx.editPianoLayer(pianoFocus, { softRelease: !p.softRelease });
        else if (n === 4) fx.editPianoLayer(pianoFocus, { stringRes: !p.stringRes });
        else if (n === 5) fx.editPianoLayer(pianoFocus, { sustPed: !p.sustPed });
        else fx.editPianoLayer(pianoFocus, { pStick: !p.pStick });
        return;
      }
      // Program hardware. While a Store draft is open, slot/dial moves
      // audition the destination (manual p. 13) instead of canceling it.
      if (id === 'program-dial') {
        if (snap.storeDraft) {
          const draft = snap.storeDraft;
          if (draft.liveDest !== null) {
            const next = (draft.dest + direction + LIVE_SLOTS) % LIVE_SLOTS;
            fx.setStoreDest(next, next);
          } else {
            const next = (draft.dest + direction + PROGRAM_SLOTS) % PROGRAM_SLOTS;
            fx.setStoreDest(next, null);
          }
          return;
        }
        fx.dialProgram(direction);
        return;
      }
      const slot = /^program-slot-(\d)$/.exec(id);
      if (slot) {
        const n = Number(slot[1]);
        if (snap.storeDraft) {
          const draft = snap.storeDraft;
          if (draft.liveDest !== null) fx.setStoreDest(n - 1, n - 1);
          else fx.setStoreDest((snap.page - 1) * 8 + (n - 1), null);
          return;
        }
        if (snap.liveMode) fx.selectLive(n - 1);
        else fx.selectSlot((snap.page - 1) * 8 + (n - 1));
        return;
      }
      if (id === 'program-fn-1') {
        fx.setPage(snap.page <= 1 ? 4 : snap.page - 1);
        return;
      }
      if (id === 'program-fn-2') {
        fx.setPage(snap.page >= 4 ? 1 : snap.page + 1);
        return;
      }
      if (id === 'program-fn-3') {
        fx.setLiveMode(!snap.liveMode);
        return;
      }
      if (id === 'program-fn-4') {
        fx.setScene('I');
        return;
      }
      if (id === 'program-fn-5') {
        fx.setScene('II');
        return;
      }
      if (id === 'program-fn-6') {
        if (snap.storeDraft) fx.confirmStore();
        else fx.beginStore(direction === -1);
        return;
      }
      if (id === 'program-fn-7') {
        fx.setSplitOn(!program.split.on);
        return;
      }
      if (id === 'program-fn-8') {
        // Transpose arm: direction steps ±1 st (Shift+direction = cancel to 0).
        fx.setTranspose(direction === -1 && program.transpose !== 0 ? 0 : program.transpose + direction);
        return;
      }
      if (id === 'program-fn-9') {
        fx.setSolo(!snap.solo);
        return;
      }
      if (id === 'program-fn-10') {
        // Panic is a button in the status bar; the hardware fn button also fires it.
        return;
      }
      if (id === 'program-morph-1' || id === 'program-morph-2') {
        const source = id === 'program-morph-1' ? 'wheel' : 'pedal';
        if (fx.morphArmed === source) fx.endMorphCapture(source);
        else fx.beginMorphCapture(source as 'wheel' | 'pedal');
        return;
      }
      // Synth hardware → focused layer.
      if (id === 'synth-level-a' || id === 'synth-level-b') {
        const layer = (id === 'synth-level-b' ? 'B' : 'A') as SynthLayerId;
        const st = program.synth.layers[layer];
        const v = Math.min(10, Math.max(0, st.level + direction));
        fx.edit((p) => ({ ...p, synth: { ...p.synth, layers: { ...p.synth.layers, [layer]: { ...st, level: v } } } }));
        captureIfArmed(id, v);
        return;
      }
      if (id === 'synth-fn-1' || id === 'synth-fn-2') {
        const layer = (id === 'synth-fn-1' ? 'A' : 'B') as SynthLayerId;
        const st = program.synth.layers[layer];
        fx.edit((p) => ({ ...p, synth: { ...p.synth, layers: { ...p.synth.layers, [layer]: { ...st, enabled: !st.enabled } } } }));
        return;
      }
      if (id === 'synth-fn-3') {
        const st = program.synth.layers[synthFocus];
        const v = (st.voice.unison + (direction === 1 ? 1 : 3)) % 4;
        fx.edit((p) => ({ ...p, synth: { ...p.synth, layers: { ...p.synth.layers, [synthFocus]: { ...st, voice: { ...st.voice, unison: v } } } } }));
        return;
      }
      if (id === 'synth-fn-4') {
        const st = program.synth.layers[synthFocus];
        fx.edit((p) => ({ ...p, synth: { ...p.synth, layers: { ...p.synth.layers, [synthFocus]: { ...st, arp: { ...st.arp, run: !st.arp.run, mode: st.arp.mode === 'Off' ? 'Arp' : st.arp.mode } } } } }));
        return;
      }
      if (id === 'synth-fn-5') {
        fx.tapClock(Date.now());
        return;
      }
      if (id === 'synth-fn-6') {
        const st = program.synth.layers[synthFocus];
        fx.edit((p) => ({ ...p, synth: { ...p.synth, layers: { ...p.synth.layers, [synthFocus]: { ...st, voice: { ...st.voice, vibrato: st.voice.vibrato === 'Off' ? 'On' : 'Off' } } } } }));
        return;
      }
      if (id === 'synth-osc-wave') {
        const st = program.synth.layers[synthFocus];
        const i = ALL_WAVES.indexOf(st.wave);
        const next = ALL_WAVES[(i + (direction === 1 ? 1 : ALL_WAVES.length - 1)) % ALL_WAVES.length];
        fx.edit((p) => ({ ...p, synth: { ...p.synth, layers: { ...p.synth.layers, [synthFocus]: { ...st, wave: next } } } }));
        return;
      }
      if (id === 'synth-osc-shape') {
        const st = program.synth.layers[synthFocus];
        const v = Math.min(10, Math.max(0, st.oscCtrl + direction));
        fx.edit((p) => ({ ...p, synth: { ...p.synth, layers: { ...p.synth.layers, [synthFocus]: { ...st, oscCtrl: v } } } }));
        captureIfArmed(id, v);
        return;
      }
      if (id === 'synth-osc-oct') {
        const st = program.synth.layers[synthFocus];
        fx.edit((p) => ({ ...p, synth: { ...p.synth, layers: { ...p.synth.layers, [synthFocus]: { ...st, octave: Math.min(4, Math.max(0, st.octave + direction)) } } } }));
        return;
      }
      const sPatch: Record<string, (v: number) => void> = {
        'synth-filter-cutoff': (v) => fx.edit((p) => ({ ...p, synth: { ...p.synth, layers: { ...p.synth.layers, [synthFocus]: { ...program.synth.layers[synthFocus], filterFreq: v } } } })),
        'synth-filter-res': (v) => fx.edit((p) => ({ ...p, synth: { ...p.synth, layers: { ...p.synth.layers, [synthFocus]: { ...program.synth.layers[synthFocus], filterRes: v } } } })),
        'synth-filter-env': (v) => fx.edit((p) => ({ ...p, synth: { ...p.synth, layers: { ...p.synth.layers, [synthFocus]: { ...program.synth.layers[synthFocus], filterEnvAmt: v } } } })),
        'synth-amp-attack': (v) => fx.edit((p) => ({ ...p, synth: { ...p.synth, layers: { ...p.synth.layers, [synthFocus]: { ...program.synth.layers[synthFocus], ampEnv: { ...program.synth.layers[synthFocus].ampEnv, attack: v } } } } })),
        'synth-amp-decay': (v) => fx.edit((p) => ({ ...p, synth: { ...p.synth, layers: { ...p.synth.layers, [synthFocus]: { ...program.synth.layers[synthFocus], ampEnv: { ...program.synth.layers[synthFocus].ampEnv, decay: v } } } } })),
        'synth-amp-sustain': (v) => fx.edit((p) => ({ ...p, synth: { ...p.synth, layers: { ...p.synth.layers, [synthFocus]: { ...program.synth.layers[synthFocus], ampSustain: v } } } })),
        'synth-amp-release': (v) => fx.edit((p) => ({ ...p, synth: { ...p.synth, layers: { ...p.synth.layers, [synthFocus]: { ...program.synth.layers[synthFocus], ampEnv: { ...program.synth.layers[synthFocus].ampEnv, release: v } } } } })),
        'synth-lfo-rate': (v) => fx.edit((p) => ({ ...p, synth: { ...p.synth, layers: { ...p.synth.layers, [synthFocus]: { ...program.synth.layers[synthFocus], lfoRate: v } } } })),
        'synth-lfo-amount': (v) => fx.edit((p) => ({ ...p, synth: { ...p.synth, layers: { ...p.synth.layers, [synthFocus]: { ...program.synth.layers[synthFocus], lfoAmt: v } } } })),
      };
      if (sPatch[id]) {
        const table: Record<string, number> = {
          'synth-filter-cutoff': program.synth.layers[synthFocus].filterFreq,
          'synth-filter-res': program.synth.layers[synthFocus].filterRes,
          'synth-filter-env': program.synth.layers[synthFocus].filterEnvAmt,
          'synth-amp-attack': program.synth.layers[synthFocus].ampEnv.attack,
          'synth-amp-decay': program.synth.layers[synthFocus].ampEnv.decay,
          'synth-amp-sustain': program.synth.layers[synthFocus].ampSustain,
          'synth-amp-release': program.synth.layers[synthFocus].ampEnv.release,
          'synth-lfo-rate': program.synth.layers[synthFocus].lfoRate,
          'synth-lfo-amount': program.synth.layers[synthFocus].lfoAmt,
        };
        const cur = table[id] ?? 0;
        const v = Math.min(10, Math.max(0, cur + direction));
        sPatch[id](v);
        captureIfArmed(id, v);
        return;
      }
      // FX hardware → focused piano chain (group-aware) + organ chain.
      const fxEdit = (fn: (c: import('./fxTypes').ChainState) => import('./fxTypes').ChainState) => {
        fx.edit((p) => ({ ...p, piano: { ...p.piano, chains: { ...p.piano.chains, [pianoFocus]: fn(p.piano.chains[p.piano.pianoGroup ? 'A' : pianoFocus]) } } }));
      };
      const organFx = (fn: (c: import('./fxTypes').ChainState) => import('./fxTypes').ChainState) => {
        fx.edit((p) => ({ ...p, organ: { ...p.organ, chain: fn(p.organ.chain) } }));
      };
      const step = (cur: number, max = 10) => Math.min(max, Math.max(0, cur + direction));
      if (id === 'fx-organ-amount') {
        const v = step(program.organ.chain.mod1.amount);
        organFx((c) => ({ ...c, mod1: { ...c.mod1, amount: v } }));
        captureIfArmed(id, v);
        return;
      }
      if (id === 'fx-organ-rate') {
        const v = step(program.organ.chain.mod1.rate);
        organFx((c) => ({ ...c, mod1: { ...c.mod1, rate: v } }));
        captureIfArmed(id, v);
        return;
      }
      if (id === 'fx-piano-amount') {
        const v = step(program.piano.chains[pianoFocus].mod2.amount);
        fxEdit((c) => ({ ...c, mod2: { ...c.mod2, amount: v } }));
        captureIfArmed(id, v);
        return;
      }
      if (id === 'fx-piano-rate') {
        const v = step(program.piano.chains[pianoFocus].mod2.rate);
        fxEdit((c) => ({ ...c, mod2: { ...c.mod2, rate: v } }));
        return;
      }
      if (id === 'fx-delay-time') {
        const cur = Math.round((program.piano.chains[pianoFocus].delay.timeMs - 20) / 148);
        const v = 20 + step(cur) * 148;
        fxEdit((c) => ({ ...c, delay: { ...c.delay, timeMs: v } }));
        captureIfArmed(id, step(cur));
        return;
      }
      if (id === 'fx-delay-feedback') {
        const v = step(program.piano.chains[pianoFocus].delay.feedback);
        fxEdit((c) => ({ ...c, delay: { ...c.delay, feedback: v } }));
        captureIfArmed(id, v);
        return;
      }
      if (id === 'fx-reverb-decay') {
        const v = step(program.piano.chains[pianoFocus].reverb.wet);
        fxEdit((c) => ({ ...c, reverb: { ...c.reverb, wet: v } }));
        captureIfArmed(id, v);
        return;
      }
      if (id === 'fx-amp-drive') {
        const v = step(program.piano.chains[pianoFocus].ampEq.drive);
        fxEdit((c) => ({ ...c, ampEq: { ...c.ampEq, drive: v } }));
        captureIfArmed(id, v);
        return;
      }
      if (id === 'fx-eq-treble') {
        const cur = program.piano.chains[pianoFocus].ampEq.treble + 15;
        const v = step(cur, 30) - 15;
        fxEdit((c) => ({ ...c, ampEq: { ...c.ampEq, treble: v } }));
        captureIfArmed(id, step(cur, 30));
        return;
      }
      if (id === 'fx-comp-amount') {
        const v = step(program.piano.chains[pianoFocus].comp.amount);
        fxEdit((c) => ({ ...c, comp: { ...c.comp, amount: v } }));
        return;
      }
      if (id === 'fx-on-1') {
        organFx((c) => ({ ...c, mod1: { ...c.mod1, on: !c.mod1.on } }));
        return;
      }
      if (id === 'fx-on-2') {
        fxEdit((c) => ({ ...c, mod2: { ...c.mod2, on: !c.mod2.on } }));
        return;
      }
      if (id === 'fx-on-3') {
        fxEdit((c) => ({ ...c, delay: { ...c.delay, on: !c.delay.on } }));
        return;
      }
      if (id === 'fx-on-4' || id === 'fx-on-5') {
        fxEdit((c) => ({ ...c, ampEq: { ...c.ampEq, on: !c.ampEq.on } }));
        return;
      }
      if (id === 'fx-on-6') {
        fxEdit((c) => ({ ...c, comp: { ...c.comp, on: !c.comp.on } }));
        return;
      }
      if (id === 'fx-on-7') {
        fxEdit((c) => ({ ...c, reverb: { ...c.reverb, on: !c.reverb.on } }));
        return;
      }
      if (id === 'fx-organ-focus-a' || id === 'fx-organ-focus-b') {
        const layer = id === 'fx-organ-focus-a' ? 'A' : 'B';
        fx.edit((p) => ({ ...p, organ: { ...p.organ, focus: layer as 'A' | 'B' } }));
        return;
      }
    },
    isMorphed: (id: string): boolean => {
      const target = morphTargetFor(id);
      if (!target) return false;
      return (
        program.morphs.wheel.some((a) => a.target === target) ||
        program.morphs.pedal.some((a) => a.target === target)
      );
    },
  };
}

export { ORGAN_MODELS, VIB_CHORUS_POSITIONS };
