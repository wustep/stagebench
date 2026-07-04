/**
 * Factory programs — at least eight stored programs demonstrating piano, organ,
 * synth, split, and layered setups (programs spec `storage.factoryContent`).
 *
 * Each is a full ProgramState built from a base control snapshot with targeted
 * overrides, so loading one is a real, audible reconfiguration of the whole
 * instrument (not a label).
 */

import { createInitialState } from './controlStore';
import {
  defaultPerformanceState,
  defaultSceneEnables,
  makeProgram,
  type ProgramState,
  type PerformanceState,
} from './program';

function base(): ReturnType<typeof createInitialState> {
  return createInitialState();
}

function perf(mut?: (p: PerformanceState) => void): PerformanceState {
  const p = defaultPerformanceState();
  mut?.(p);
  return p;
}

export function factoryPrograms(): ProgramState[] {
  const programs: ProgramState[] = [];

  // 1.1 — White Grand (piano only, grand type).
  {
    const c = base();
    c['piano-on'] = true;
    c['piano-on-off-a'] = true;
    c['piano-type'] = 0; // Grand
    c['organ-on'] = false;
    c['synth-on'] = false;
    const p = perf((s) => {
      s.scenes.I['piano-A'] = true;
    });
    programs.push(makeProgram('White Grand', c, p));
  }

  // 1.2 — Tine Stack (electric piano layered with synth pad).
  {
    const c = base();
    c['piano-on'] = true;
    c['piano-on-off-a'] = true;
    c['piano-type'] = 2; // Electric
    c['synth-on'] = true;
    c['synth-on-off-a'] = true;
    c['effects-reverb-on'] = true;
    const p = perf((s) => {
      s.scenes.I['piano-A'] = true;
      s.scenes.I['synth-A'] = true;
    });
    programs.push(makeProgram('Tine Stack', c, p));
  }

  // 1.3 — B3 Soulful (organ only, B3 with percussion + rotary).
  {
    const c = base();
    c['piano-on'] = false;
    c['piano-on-off-a'] = false;
    c['organ-on'] = true;
    c['organ-on-off-a'] = true;
    c['organ-model'] = 0; // B3
    c['organ-perc-on'] = true;
    c['performance-rotary-on'] = true;
    const p = perf((s) => {
      s.scenes.I = defaultSceneEnables();
      s.scenes.I['piano-A'] = false;
      s.scenes.I['organ-A'] = true;
    });
    programs.push(makeProgram('B3 Soulful', c, p));
  }

  // 1.4 — Vox Continental (organ Vox model).
  {
    const c = base();
    c['piano-on'] = false;
    c['piano-on-off-a'] = false;
    c['organ-on'] = true;
    c['organ-on-off-a'] = true;
    c['organ-model'] = 1; // VOX
    c['organ-vib-on'] = true;
    const p = perf((s) => {
      s.scenes.I = defaultSceneEnables();
      s.scenes.I['piano-A'] = false;
      s.scenes.I['organ-A'] = true;
    });
    programs.push(makeProgram('Vox Continental', c, p));
  }

  // 2.1 — Super Saw Lead (synth, super saw, mono lead).
  {
    const c = base();
    c['piano-on'] = false;
    c['piano-on-off-a'] = false;
    c['synth-on'] = true;
    c['synth-on-off-a'] = true;
    c['synth-voice-mode'] = 1; // Mono
    c['synth-filter-freq'] = 0.7;
    const p = perf((s) => {
      s.scenes.I = defaultSceneEnables();
      s.scenes.I['piano-A'] = false;
      s.scenes.I['synth-A'] = true;
    });
    programs.push(makeProgram('Super Saw Lead', c, p));
  }

  // 2.2 — Vista Pad Whl (synth pad with wheel morph on filter).
  {
    const c = base();
    c['piano-on'] = false;
    c['piano-on-off-a'] = false;
    c['synth-on'] = true;
    c['synth-on-off-a'] = true;
    c['synth-filter-freq'] = 0.3;
    const p = perf((s) => {
      s.scenes.I = defaultSceneEnables();
      s.scenes.I['piano-A'] = false;
      s.scenes.I['synth-A'] = true;
      s.morph.wheel = [{ controlId: 'synth-filter-freq', from: 0.3, to: 0.9 }];
    });
    programs.push(makeProgram('Vista Pad Whl', c, p));
  }

  // 2.3 — Split Bass/Lead (synth bass left, synth lead right; split at C4).
  {
    const c = base();
    c['piano-on'] = false;
    c['piano-on-off-a'] = false;
    c['synth-on'] = true;
    c['synth-on-off-a'] = true;
    c['synth-on-off-b'] = true;
    const p = perf((s) => {
      s.scenes.I = defaultSceneEnables();
      s.scenes.I['piano-A'] = false;
      s.scenes.I['synth-A'] = true;
      s.scenes.I['synth-B'] = true;
      s.split.on = true;
      s.split.points.mid = 4; // C4
      s.split.zones['synth-A'] = 0; // lower zone
      s.split.zones['synth-B'] = 1; // upper zone
    });
    programs.push(makeProgram('Split Bass/Lead', c, p));
  }

  // 2.4 — Piano + Organ Split (piano low, organ high).
  {
    const c = base();
    c['piano-on'] = true;
    c['piano-on-off-a'] = true;
    c['piano-type'] = 0;
    c['organ-on'] = true;
    c['organ-on-off-a'] = true;
    c['organ-model'] = 0;
    const p = perf((s) => {
      s.scenes.I = defaultSceneEnables();
      s.scenes.I['piano-A'] = true;
      s.scenes.I['organ-A'] = true;
      s.split.on = true;
      s.split.points.mid = 4;
      s.split.zones['piano-A'] = 0;
      s.split.zones['organ-A'] = 1;
    });
    programs.push(makeProgram('Piano/Organ Split', c, p));
  }

  // 3.1 — Layered Scene Demo (piano + synth, scene II drops synth).
  {
    const c = base();
    c['piano-on'] = true;
    c['piano-on-off-a'] = true;
    c['synth-on'] = true;
    c['synth-on-off-a'] = true;
    const p = perf((s) => {
      s.scenes.I = defaultSceneEnables();
      s.scenes.I['piano-A'] = true;
      s.scenes.I['synth-A'] = true;
      s.scenes.II = defaultSceneEnables();
      s.scenes.II['piano-A'] = true;
      s.scenes.II['synth-A'] = false;
    });
    programs.push(makeProgram('Scene Layers', c, p));
  }

  return programs;
}
