#!/usr/bin/env node
/**
 * Re-shape glass-etude-6.mid (this folder) with expressive dynamics and tempo.
 * Pitches and in-bar onsets are untouched. See ARRANGEMENT.md for the reasoning.
 *
 *   node etude6-dynamics.mjs                          -> glass-etude-6-v2.mid
 *   node etude6-dynamics.mjs --style=yuja             -> glass-etude-6-v3.mid
 *   node etude6-dynamics.mjs --style=yuja --form=yuja -> glass-etude-6-v3-yuja-form.mid
 *   node etude6-dynamics.mjs --style=yuja4 [--form=yuja] -> glass-etude-6-v4[-yuja-form].mid
 *   node etude6-dynamics.mjs --style=yuja5 [--form=yuja] [--pedal=baked]
 *                                        -> glass-etude-6-v5[-yuja-form][-keybed].mid
 *   (optional positional args: [in.mid] [out.mid])
 *
 * --style=v2    score-logic plan: section table, phrase arcs, breaths, final rit.
 * --style=yuja  per-bar loudness and per-section tempo measured from Yuja Wang's
 *               recording (yuja-profile.json), no breaths, in-tempo ending.
 * --style=yuja4 like yuja, from a beat-tracked bar grid: per-bar tempo, wider dynamics,
 *               and seeded micro-timing / articulation variation (see "v4 humanization").
 * --style=yuja5 like yuja4, plus a smooth per-beat tempo curve, dynamics interpolated
 *               within sections, correlated (AR(1)) timing drift, a stronger RH
 *               downbeat in the octave-hit sections, and sustain pedal.
 * --pedal=cc    (yuja5, default) CC64 on every channel: long partial pedal, changed
 *               once per 8-bar cycle.
 * --pedal=baked (yuja5) no CC; the same pedal is baked into note lengths, for players
 *               that ignore CC64 (scripts/record-take.mjs only presses keys).
 * --form=yuja   keep only the 180 bars she plays (she skips many repeats).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import midiPkg from '@tonejs/midi';
const { Midi } = midiPkg;

const root = path.dirname(fileURLToPath(import.meta.url)); // recording/songs/glass-etude-6: sources and outputs live here
const args = process.argv.slice(2);
const opt = (name, def) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? def;
const [inArg, outArg] = args.filter((a) => !a.startsWith('--'));
const STYLE = opt('style', 'v2');
const FORM = opt('form', 'full');
const PEDAL = opt('pedal', 'cc');
const VERSION = { v2: 'v2', yuja: 'v3', yuja4: 'v4', yuja5: 'v5' }[STYLE];
if (!VERSION) throw new Error(`unknown --style=${STYLE}`);
if (!['full', 'yuja'].includes(FORM)) throw new Error(`unknown --form=${FORM}`);
if (!['cc', 'baked'].includes(PEDAL)) throw new Error(`unknown --pedal=${PEDAL}`);
const defaultOut = `glass-etude-6-${VERSION}${VERSION !== 'v2' && FORM === 'yuja' ? '-yuja-form' : ''}`
  + `${STYLE === 'yuja5' && PEDAL === 'baked' ? '-keybed' : ''}.mid`;
const inPath = inArg || path.join(root, 'glass-etude-6.mid');
const outPath = outArg || path.join(root, defaultOut);

const midi = new Midi(fs.readFileSync(inPath));
const PPQ = midi.header.ppq; // 384
const BEAT = PPQ;
const BAR = 3 * BEAT; // 3/4
const BASE_BPM = midi.header.tempos[0]?.bpm ?? 196;
const [LH, RH, HITS] = midi.tracks; // Grand Piano / Grand Piano 2 / Grand Piano 3

// Dynamic levels = RH (melodic) velocity. LH and the octave-hit layer derive from it.
const D = { pp: 36, p: 48, mp: 60, mf: 72, f: 86, ff: 100 };

// Form inferred from the MIDI (8-bar phrases from bar 5). Bars are 1-indexed, inclusive.
// breath: tempo ease on the last beat before this section (1 = none).
const SECTIONS = [
  { name: 'Intro: LH ostinato alone', from: 1, to: 4, a: D.p, b: D.p + 4, breath: 1 },
  { name: 'A1: repeated F, eighths', from: 5, to: 20, a: D.p, b: D.mp, breath: 0.96 },
  { name: 'A1: rising line to C#5', from: 21, to: 36, a: D.mp, b: D.mf, breath: 1 },
  { name: 'B1: triplet arpeggios', from: 37, to: 52, a: D.mf - 2, b: D.mf + 6, breath: 0.95 },
  { name: 'C1: octave hits', from: 53, to: 68, a: D.f - 4, b: D.f, breath: 0.93 },
  { name: "A2: repeated F (subito mp)", from: 69, to: 84, a: D.mp + 2, b: D.mp + 6, breath: 0.9 },
  { name: 'A2: rising line', from: 85, to: 100, a: D.mp + 4, b: D.mf + 2, breath: 1 },
  { name: 'B2: triplet arpeggios', from: 101, to: 116, a: D.mf, b: D.f - 4, breath: 0.95 },
  { name: 'C2: octave hits', from: 117, to: 132, a: D.f, b: D.f + 2, breath: 0.93 },
  { name: 'D1: new harmony, F-G oscillation', from: 133, to: 148, a: D.mp + 2, b: D.mf, breath: 0.9 },
  { name: 'D1: five-note scale figure', from: 149, to: 164, a: D.mf, b: D.f, breath: 1 },
  { name: 'C3: octave hits', from: 165, to: 180, a: D.f + 2, b: D.ff - 4, breath: 0.95 },
  { name: 'B3: triplet arpeggios (breather)', from: 181, to: 196, a: D.mf, b: D.f - 2, breath: 0.9 },
  { name: 'C4: octave hits', from: 197, to: 212, a: D.f, b: D.f + 4, breath: 0.95 },
  { name: 'D2: F-G oscillation', from: 213, to: 228, a: D.mp + 2, b: D.mf + 4, breath: 0.9 },
  { name: 'D2: scale figure, long crescendo', from: 229, to: 244, a: D.f - 4, b: D.ff, breath: 1 },
  { name: 'C5: octave hits (climax)', from: 245, to: 260, a: D.ff, b: D.ff, breath: 0.95 },
  { name: 'B4: triplet arpeggios, receding', from: 261, to: 276, a: D.f, b: D.mf, breath: 0.94 },
  { name: 'A3: rising line, winding down', from: 277, to: 292, a: D.mf, b: D.mp, breath: 0.95 },
  { name: 'Coda: repeated F, fading', from: 293, to: 308, a: D.p, b: D.pp, breath: 0.92 },
];

// Swell toward bar 6 of each 8-bar phrase, relax into the cadence bar.
const PHRASE_ARC = [-2, -1, 0, 1, 2, 3, 1, -1];
// Final ritardando (bar -> bpm).
const RIT = { 305: BASE_BPM - 2, 306: BASE_BPM - 6, 307: BASE_BPM - 12, 308: BASE_BPM - 20 };

const sectionOf = (bar) => SECTIONS.find((s) => bar >= s.from && bar <= s.to);
const barOf = (ticks) => Math.floor(ticks / BAR) + 1;
const isC = (bar) => [[53, 68], [117, 132], [165, 180], [197, 212], [245, 260]].some(([a, b]) => bar >= a && bar <= b);

function levelV2(bar) {
  const s = sectionOf(bar);
  if (!s) return D.pp;
  const t = s.to === s.from ? 0 : (bar - s.from) / (s.to - s.from);
  let v = s.a + (s.b - s.a) * t;
  if (bar >= 5) {
    const pos = (bar - 5) % 8;
    v += PHRASE_ARC[pos] + (pos % 2 === 0 ? 1 : 0); // 2-bar harmonic units: lean on the first
  }
  return v;
}

// --- Yuja Wang profile -------------------------------------------------------
// yuja-profile.json: per MIDI bar she plays, loudness relative to her median
// (dB, corrected for how many notes the bar has) and her local bar tempo.
// Bars she skips borrow the matching bar of a same-type passage she does play.
const YUJA_BORROW = [
  [77, 84, 69], [93, 100, 85], [109, 116, 101], // second passes of A2 / rising line / B2
  [181, 196, 37], // B before C, as in B1
  [197, 212, 117], [213, 244, 133], [245, 260, 165], // C4, D2, C5 follow C2, D1, C3
  [269, 276, 261], [285, 292, 277], [293, 299, 301], [300, 300, 307], // repeats near the end (skip her final-bar accent)
];
// Section tempos from her cycle timings (averaged per section; single cycles are +-3 bpm).
const YUJA_TEMPO = [
  [1, 36, 207], [37, 52, 197], [53, 68, 195], [69, 100, 214], [101, 116, 201], [117, 132, 195],
  [133, 164, 213], [165, 180, 195], [181, 196, 197], [197, 212, 195], [213, 244, 213],
  [245, 260, 195], [261, 276, 201], [277, 292, 195], [293, 308, 200],
];
// The bars she plays, in order (for --form=yuja).
const YUJA_FORM = [[1, 76], [85, 92], [101, 108], [117, 180], [261, 268], [277, 284], [301, 308]];
// v4 maps her ~20 dB loud/soft contrast onto a wider velocity span than v3.
const V4PLUS = STYLE === 'yuja4' || STYLE === 'yuja5';
const VEL_PER_DB = V4PLUS ? 3.2 : 2.4;

// Per-bar profile field -> value for all 308 MIDI bars: borrowed for bars she skips,
// then lightly smoothed inside each phrase (intro, then 8-bar groups) so section
// boundaries stay terraced.
function yujaSeries(prof, field, centerWeight) {
  const raw = {};
  for (const [bar, v] of Object.entries(prof.bars)) raw[+bar] = v[field];
  for (const [from, to, src] of YUJA_BORROW) for (let b = from; b <= to; b++) raw[b] = raw[src + (b - from)];
  if (field === 'rel4') raw[1] = raw[2]; // bar 1 of the upload fades in
  const group = (b) => (b <= 4 ? 0 : Math.floor((b - 5) / 8) + 1);
  const out = {};
  for (let b = 1; b <= 308; b++) {
    const nb = [b - 1, b, b + 1].filter((x) => raw[x] != null && group(x) === group(b));
    const w = nb.map((x) => (x === b ? centerWeight : 1));
    out[b] = nb.reduce((s, x, i) => s + raw[x] * w[i], 0) / w.reduce((a, c) => a + c, 0);
  }
  return out;
}

let yujaRel = null;
let yujaBpm = null;
if (STYLE !== 'v2') {
  const prof = JSON.parse(fs.readFileSync(path.join(root, 'yuja-profile.json'), 'utf8'));
  yujaRel = V4PLUS ? yujaSeries(prof, 'rel4', 3) : yujaSeries(prof, 'rel', 2);
  if (V4PLUS) yujaBpm = yujaSeries(prof, 'bpm4', 2);
}
const levelYuja = (bar) => D.mp + VEL_PER_DB * (yujaRel[bar] ?? 0);
// v5: treat each bar's value as its midpoint and interpolate to the note's position,
// so crescendi move through the bar; section boundaries stay subito.
// (Also used for the per-beat tempo curve.)
function smoothAt(series, bar, tickInBar) {
  const pos = bar + tickInBar / BAR - 0.5;
  const b0 = Math.floor(pos);
  const b1 = b0 + 1;
  const sec = sectionOf(bar);
  const inSec = (b) => series[b] != null && sectionOf(b) === sec;
  if (!inSec(b0) || !inSec(b1)) return series[bar];
  return series[b0] + (series[b1] - series[b0]) * (pos - b0);
}
const levelYuja5 = (bar, tickInBar) => D.mp + VEL_PER_DB * smoothAt(yujaRel, bar, tickInBar);
const level = STYLE === 'v2' ? levelV2 : STYLE === 'yuja5' ? levelYuja5 : levelYuja;

function metric(tickInBar) {
  if (tickInBar === 0) return 5;
  if (tickInBar === 2 * BEAT) return 2;
  if (tickInBar === BEAT) return 1;
  return -2; // off-beat eighths and inner triplet notes
}

// Deterministic jitter so re-runs are identical.
let seed = 0x6e7d6;
const rand = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const jitter = (amt) => Math.round((rand() * 2 - 1) * amt);

// Notes sharing an onset within a track, for voicing (top/bottom).
function chordIndex(track) {
  const byTick = new Map();
  for (const n of track.notes) {
    if (!byTick.has(n.ticks)) byTick.set(n.ticks, []);
    byTick.get(n.ticks).push(n.midi);
  }
  return byTick;
}

// The source's written fade in the last bar (velocity ratio vs. the track's flat level).
const flatVel = (track) => {
  const counts = {};
  for (const n of track.notes) counts[n.velocity] = (counts[n.velocity] || 0) + 1;
  return +Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
};

function shape(track, role) {
  const chords = chordIndex(track);
  const flat = flatVel(track);
  const barMean = new Map();
  for (const n of track.notes) {
    const b = barOf(n.ticks);
    const m = barMean.get(b) || { sum: 0, n: 0 };
    m.sum += n.midi; m.n += 1;
    barMean.set(b, m);
  }
  for (const n of track.notes) {
    const bar = barOf(n.ticks);
    const L = level(bar, n.ticks % BAR);
    const chord = chords.get(n.ticks);
    const isTop = chord.length > 1 && n.midi === Math.max(...chord);
    const isBottom = chord.length > 1 && n.midi === Math.min(...chord);
    let v;
    if (role === 'rh') {
      const { sum, n: count } = barMean.get(bar);
      const contour = Math.max(-3, Math.min(3, 0.15 * (n.midi - sum / count)));
      v = L + metric(n.ticks % BAR) + contour + (chord.length > 1 ? (isTop ? 2 : -2) : 0);
      // Her RH downbeats in the octave-hit sections measure ~7 dB above the other beats.
      if (STYLE === 'yuja5' && isC(bar) && n.ticks % BAR === 0) v += 3;
    } else if (role === 'lh') {
      // Alone in the intro; afterwards it accompanies, ~80% of the RH level.
      v = (bar <= 4 ? L : 0.8 * L) + metric(n.ticks % BAR) + (chord.length > 1 ? (isBottom ? 2 : -1) : 0);
    } else {
      // Octave hits: low bass octave and high octave carry the section; mid-register chord a bit less.
      v = L + (n.midi < 48 ? 8 : n.midi >= 72 ? 6 : 2) + (isBottom || isTop ? 2 : 0);
    }
    v += jitter(2);
    let lo = 24;
    const ratio = n.velocity / flat;
    if (bar === 308) {
      if (STYLE === 'v2' && ratio < 0.99) { v *= ratio; lo = 12; } // keep the source's fade-out
      // Yuja ends in tempo and leans into beats 2-3 of the last bar instead of fading.
      if (STYLE !== 'v2' && n.ticks % BAR >= BEAT) v += 8;
    }
    n.velocity = Math.max(lo, Math.min(118, Math.round(v))) / 127;
  }
}

shape(LH, 'lh');
shape(RH, 'rh');
shape(HITS, 'hits');

let shortened = 0;
let tempos;
if (STYLE === 'v2') {
  // Breath: slightly shorten RH notes on the last beat before a section with a breath.
  const breathBars = new Set(SECTIONS.filter((s) => s.breath < 1).map((s) => s.from - 1));
  for (const n of RH.notes) {
    const bar = barOf(n.ticks);
    if (breathBars.has(bar) && n.ticks % BAR >= 2 * BEAT) {
      n.durationTicks = Math.max(48, Math.round(n.durationTicks * 0.7));
      shortened++;
    }
  }

  // Tempo map: base tempo, eased last beat before breath sections, final rit.
  tempos = [{ ticks: 0, bpm: BASE_BPM }];
  for (const s of SECTIONS) {
    if (s.breath >= 1) continue;
    const lastBeat = (s.from - 1) * BAR - BEAT;
    tempos.push({ ticks: lastBeat, bpm: BASE_BPM * s.breath });
    tempos.push({ ticks: (s.from - 1) * BAR, bpm: BASE_BPM });
  }
  for (const [bar, bpm] of Object.entries(RIT)) tempos.push({ ticks: (bar - 1) * BAR, bpm });
  tempos.sort((a, b) => a.ticks - b.ticks);
  // Drop a restore-to-base that lands on a rit bar.
  tempos = tempos.filter((t, i, arr) => !(arr[i + 1] && arr[i + 1].ticks === t.ticks));
} else if (STYLE === 'yuja') {
  tempos = YUJA_TEMPO.map(([from, , bpm]) => ({ ticks: (from - 1) * BAR, bpm }));
} else if (STYLE === 'yuja4') {
  // One tempo per bar, following her bar-to-bar rubato.
  tempos = Array.from({ length: 308 }, (_, i) => ({ ticks: i * BAR, bpm: Math.round(yujaBpm[i + 1] * 10) / 10 }));
} else {
  // One tempo per beat on a smooth curve through her bar tempos (no steps at barlines).
  tempos = Array.from({ length: 308 * 3 }, (_, j) => {
    const bar = Math.floor(j / 3) + 1;
    const tickInBar = (j % 3) * BEAT + BEAT / 2;
    return { ticks: j * BEAT, bpm: Math.round(smoothAt(yujaBpm, bar, tickInBar) * 10) / 10 };
  });
}

// --- v4 humanization -----------------------------------------------------------
// Her beats are even within the bar (+-1%), so the rubato lives in the per-bar tempo
// map. Here: small seeded onset offsets (RH leads the LH slightly, notes of a chord
// spread a little) and articulation variation. Offsets are in ms, converted with the
// bar's tempo. Applied after an optional cut so bar mapping stays exact.
let hseed = 0x7a11a;
const hrand = () => {
  hseed |= 0; hseed = (hseed + 0x6d2b79f5) | 0;
  let t = Math.imul(hseed ^ (hseed >>> 15), 1 | hseed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const gauss = () => Math.sqrt(-2 * Math.log(hrand() || 1e-9)) * Math.cos(2 * Math.PI * hrand());
const human = new Map(); // note -> { dt, dur }
if (V4PLUS) {
  const HAND = { lh: [0, 4], rh: [-4, 4], hits: [0, 3] }; // [mean, sd] ms per onset group
  const RHO = 0.9; // v5: each hand's timing drifts smoothly (AR(1)) instead of jumping per onset
  [[LH, 'lh'], [RH, 'rh'], [HITS, 'hits']].forEach(([track, role]) => {
    const group = new Map();
    let drift = 0;
    for (const n of track.notes) {
      const bar = barOf(n.ticks);
      const msToTicks = (ms) => (ms / 1000) * (yujaBpm[bar] / 60) * PPQ;
      if (!group.has(n.ticks)) {
        if (STYLE === 'yuja5') {
          drift = RHO * drift + Math.sqrt(1 - RHO * RHO) * gauss();
          group.set(n.ticks, HAND[role][0] + HAND[role][1] * drift);
        } else {
          group.set(n.ticks, HAND[role][0] + HAND[role][1] * gauss());
        }
      }
      const ms = Math.max(-15, Math.min(15, group.get(n.ticks) + 1.5 * gauss()));
      let f = 1;
      if (role === 'rh') f = n.durationTicks <= 96 ? 0.85 + 0.3 * hrand() : 0.92 + 0.12 * hrand();
      if (role === 'lh') f = (isC(bar) ? 0.86 : 0.93) + 0.08 * hrand();
      human.set(n, { dt: Math.round(msToTicks(ms)), dur: Math.max(24, Math.round(n.durationTicks * f)) });
    }
  });
}

if (FORM === 'yuja') {
  // Map each kept bar to its new position; drop notes in skipped bars.
  const newBar = new Map();
  let k = 0;
  for (const [from, to] of YUJA_FORM) for (let b = from; b <= to; b++) newBar.set(b, k++);
  const bpmAt = (ticks) => tempos.filter((t) => t.ticks <= ticks).at(-1).bpm;
  tempos = YUJA_FORM.map(([from]) => ({ ticks: newBar.get(from) * BAR, bpm: bpmAt((from - 1) * BAR) }))
    .concat(tempos.filter((t) => newBar.has(barOf(t.ticks)))
      .map((t) => ({ ticks: newBar.get(barOf(t.ticks)) * BAR + (t.ticks % BAR), bpm: t.bpm })))
    .sort((a, b) => a.ticks - b.ticks)
    .filter((t, i, arr) => i === 0 || t.ticks !== arr[i - 1].ticks || t.bpm !== arr[i - 1].bpm);
  for (const track of midi.tracks) {
    const kept = track.notes.filter((n) => newBar.has(barOf(n.ticks)))
      .map((n) => ({ ...n.toJSON(), ticks: newBar.get(barOf(n.ticks)) * BAR + (n.ticks % BAR), h: human.get(n) }));
    while (track.notes.length) track.notes.pop();
    for (const n of kept) {
      track.addNote({ midi: n.midi, ticks: n.ticks, durationTicks: n.durationTicks, velocity: n.velocity });
      if (n.h) human.set(track.notes.at(-1), n.h);
    }
  }
}

if (human.size) {
  for (const track of midi.tracks) {
    for (const n of track.notes) {
      const h = human.get(n);
      n.ticks = Math.max(0, n.ticks + h.dt);
      n.durationTicks = h.dur;
    }
    track.notes.sort((a, b) => a.ticks - b.ticks);
  }
  releaseBeforeRestrike();
}

// Same key (any track) must be released before it is struck again.
function releaseBeforeRestrike() {
  const byKey = new Map();
  for (const n of midi.tracks.flatMap((t) => t.notes)) {
    if (!byKey.has(n.midi)) byKey.set(n.midi, []);
    byKey.get(n.midi).push(n);
  }
  for (const list of byKey.values()) {
    list.sort((a, b) => a.ticks - b.ticks);
    for (let i = 0; i + 1 < list.length; i++) {
      const gap = list[i + 1].ticks - 6;
      if (list[i].ticks + list[i].durationTicks > gap) list[i].durationTicks = Math.max(12, gap - list[i].ticks);
    }
  }
}

// --- v5 sustain pedal ----------------------------------------------------------
// Measured on her recording: after a LH key is released its pitch fades at only
// ~0-9 dB/s (a damped note in that hall fades ~34 dB/s), and at harmony changes the
// previous harmony's pitches drop just 0.4 +- 0.4 dB across the downbeat. So she does
// not re-pedal with each bass change; the pedal is held long. Individual change points
// were not detectable, so v5 changes once per 8-bar cycle (legato pedalling: lift just
// after the downbeat, re-depress ~45 ms later) at a partial depth.
let pedalEvents = 0;
if (STYLE === 'yuja5') {
  const DEPTH = 100 / 127; // partial pedal where the player supports continuous CC64
  const LIFT = 8; // ticks after the downbeat
  const CATCH = 60;
  const lastEnd = Math.max(...midi.tracks.flatMap((t) => t.notes.map((n) => n.ticks + n.durationTicks)));
  const lastBar = barOf(lastEnd - 1);
  const lifts = [];
  for (let b = 5; b <= lastBar; b += 8) lifts.push((b - 1) * BAR + LIFT);
  const release = lastEnd + BEAT;
  if (PEDAL === 'cc') {
    for (const track of midi.tracks) {
      track.addCC({ number: 64, ticks: CATCH / 2, value: DEPTH });
      for (const t of lifts) {
        track.addCC({ number: 64, ticks: t, value: 0 });
        track.addCC({ number: 64, ticks: t + CATCH - LIFT, value: DEPTH });
      }
      track.addCC({ number: 64, ticks: release, value: 0 });
      pedalEvents += 2 + 2 * lifts.length;
    }
  } else {
    // Hold each key until the pedal would lift, capped at 2 bars past its written end.
    const stops = [...lifts, release];
    for (const n of midi.tracks.flatMap((t) => t.notes)) {
      const off = n.ticks + n.durationTicks;
      const caughtOff = stops.find((t) => t >= off) ?? release;
      const inGap = lifts.some((t) => off >= t && off < t + CATCH - LIFT);
      const end = inGap ? off : Math.min(caughtOff, off + 2 * BAR);
      n.durationTicks = Math.max(n.durationTicks, end - n.ticks);
    }
    releaseBeforeRestrike();
  }
}

midi.header.tempos = tempos;
midi.header.name = STYLE === 'v2' ? "Glass Etude No. 6 (v2 dynamics)"
  : `Glass Etude No. 6 (${VERSION}, after Yuja Wang${FORM === 'yuja' ? ', her form' : ''}`
    + `${STYLE === 'yuja5' ? (PEDAL === 'baked' ? ', pedal baked into durations' : ', CC64 pedal') : ''})`;
midi.header.update();

fs.writeFileSync(outPath, Buffer.from(midi.toArray()));
console.log('wrote', path.relative(root, outPath), `| style=${STYLE} form=${FORM} | RH phrase-end notes shortened: ${shortened} | tempo events: ${midi.header.tempos.length}`
  + (STYLE === 'yuja5' ? ` | pedal=${PEDAL}${pedalEvents ? ` (${pedalEvents} CC64 events)` : ''}` : ''));
