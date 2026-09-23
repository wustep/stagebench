// Loads a show config (shows/<name>.json) and resolves everything the pipeline needs:
// the song's MIDI, each model's label/rank/score (from runs/<id>/run.json), its capture fixture
// (models.json), and the timing plan. Every script calls loadShow(), so recording, prep and
// compose always agree.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import midiPkg from '@tonejs/midi';

const { Midi } = midiPkg;
export const REC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); // recording/
export const REPO = path.resolve(REC, '..');
export const FPS = 30;
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

// StageBench overall ranks from runs/<id>/run.json evaluation.score (the gallery's aggregate):
// every scored run, highest first; ties share a rank.
export function leaderboard() {
  const runs = fs.readdirSync(path.join(REPO, 'runs'))
    .filter((d) => fs.existsSync(path.join(REPO, 'runs', d, 'run.json')))
    .map((d) => readJson(path.join(REPO, 'runs', d, 'run.json')))
    .map((r) => ({ ...r, score: r.evaluation?.score }))
    .filter((r) => typeof r.score === 'number');
  return Object.fromEntries(runs.map((r) => [r.id, {
    id: r.id, title: r.title, score: r.score, of: runs.length,
    rank: 1 + runs.filter((o) => o.score > r.score).length,
  }]));
}

export const loadMidi = (file) => new Midi(fs.readFileSync(file));

// Note events for notes starting in [from, before); offs sort before ons at equal times.
export function events(midi, from, before) {
  const ev = [];
  for (const tr of midi.tracks) for (const n of tr.notes) {
    if (n.time < from - 1e-6 || n.time >= before) continue;
    ev.push({ t: n.time, on: 1, note: n.midi, vel: Math.max(1, Math.round(n.velocity * 127)) });
    ev.push({ t: n.time + n.duration, on: 0, note: n.midi });
  }
  return ev.sort((a, b) => a.t - b.t || a.on - b.on);
}

export function assertSamePerformance(a, b) {
  const sig = (m) => m.tracks.flatMap((t) => t.notes.map((n) => `${n.ticks}:${n.midi}:${n.velocity.toFixed(4)}`)).sort().join(',');
  if (a !== b && sig(a) !== sig(b)) throw new Error('visualMidi differs from audioMidi in onsets/pitches/velocities');
}

export function loadShow(showArg) {
  const showPath = path.resolve(REC, showArg);
  const show = readJson(showPath);
  const name = path.basename(showPath, '.json');
  const songDir = path.join(REC, 'songs', show.song);
  const song = readJson(path.join(songDir, 'song.json'));
  const fixtures = readJson(path.join(REC, 'models.json'));
  const board = leaderboard();

  const models = show.models.map((id) => {
    const run = board[id];
    if (!run) throw new Error(`${id}: no scored runs/${id}/run.json`);
    if (!fixtures[id]) console.warn(`warning: ${id} has no models.json fixture; probe it first (scripts/probe.mjs --model ${id})`);
    const fx = { ...fixtures.default, ...(fixtures[id] || {}) };
    return {
      id, label: show.labels?.[id] ?? run.title, rank: run.rank, of: run.of, score: run.score,
      url: `${(show.previewBase || 'https://stagebench.vercel.app/previews').replace(/\/$/, '')}/${id}/stage${show.stage ?? 3}/`,
      viewport: fx.viewport, setup: fx.setup || [], quantizeVelocity: fx.quantizeVelocity || null, prewarm: !!fx.prewarm,
    };
  });
  if (show.order === 'countdown') models.sort((a, b) => b.rank - a.rank || a.score - b.score);

  const files = { audio: path.join(songDir, song.audioMidi), visual: path.join(songDir, song.visualMidi || song.audioMidi) };
  const plan = makePlan(show, song, files, models.map((m) => m.id));
  return {
    name, show, song, songDir, files, models, plan,
    model: (id) => models.find((m) => m.id === id),
    takeDir: (id) => path.join(REC, '.takes', name, id),
    workDir: path.join(REC, '.takes', name, '_work'),
    output: path.resolve(REC, show.output || `output/${name}.mp4`),
  };
}

// One continuous stretch of the song: each model gets `barsPerModel` bars from `startBar`, in
// order; the last gets the same, a number of bars, or every remaining bar ("to-end"). Video cuts
// land on the frame at or before each downbeat, so every downbeat belongs to the incoming piano.
function makePlan(show, song, files, order) {
  const midi = loadMidi(files.audio);
  const ppq = midi.header.ppq, bpb = song.beatsPerBar || 4;
  const barTime = (bar1) => midi.header.ticksToSeconds((bar1 - 1) * ppq * bpb);
  const notes = midi.tracks.flatMap((t) => t.notes);
  const songBars = Math.ceil(Math.max(...notes.map((x) => x.ticks + 1)) / (ppq * bpb));
  const lastOff = Math.max(...notes.map((x) => x.time + x.duration));
  const IDLE = show.idle ?? 0.4, BREATHE = show.breathe ?? 2.5, LEADIN_BARS = show.leadInBars ?? 2;
  const n = order.length, per = show.barsPerModel;
  const starts = order.map((_, k) => show.startBar + k * per);
  const lastBars = show.last === 'to-end' ? songBars - starts[n - 1] + 1 : (typeof show.last === 'number' ? show.last : per);
  const finalBar = starts[n - 1] + lastBars; // first bar after the film's music
  if (finalBar - 1 > songBars) throw new Error(`plan runs past the song (bar ${finalBar - 1} > ${songBars})`);
  const toEnd = finalBar - 1 >= songBars;
  // Not to the end: play into the next downbeat (one beat) so the film lands on it.
  const finalCut = toEnd ? Infinity : midi.header.ticksToSeconds((finalBar - 1) * ppq * bpb + ppq);
  const finalRelease = toEnd ? lastOff
    : Math.max(barTime(finalBar), ...notes.filter((x) => x.time >= barTime(finalBar) - 1e-6 && x.time < finalCut).map((x) => x.time + x.duration));
  const t0 = barTime(starts[0]) - IDLE;
  const end = t0 + Math.round((finalRelease + BREATHE - t0) * FPS) / FPS;
  const cut = (t) => t0 + Math.floor((t - t0) * FPS + 1e-6) / FPS;
  const segments = order.map((model, k) => {
    const first = k === 0, last = k === n - 1, bar = starts[k];
    return {
      model, bars: [bar, last ? finalBar - 1 : bar + per - 1],
      from: first ? t0 : cut(barTime(bar)), to: last ? end : cut(barTime(bar + per)),
      audioFrom: first ? t0 : barTime(bar), audioTo: last ? end : barTime(bar + per),
      playStart: first ? barTime(bar) : barTime(Math.max(1, bar - LEADIN_BARS)),
      playBefore: last ? finalCut : barTime(bar + per), // onsets played: [playStart, playBefore)
    };
  });
  for (const s of segments) s.secs = +(s.to - s.from).toFixed(3);
  // 8-bar (barsPerModel) blocks inside each segment, used to measure and gently level loudness.
  const blocks = segments.flatMap((s, k) => {
    const out = [];
    const lastBar = s.bars[1] + 1;
    for (let b = s.bars[0]; b < lastBar; b += per) {
      out.push({ model: s.model, seg: k, bars: [b, Math.min(b + per, lastBar) - 1], from: barTime(b), to: barTime(Math.min(b + per, lastBar)) });
    }
    return out;
  });
  blocks.at(-1).to = Math.min(blocks.at(-1).to, finalRelease);
  const refBars = song.levelReferenceBars || [show.startBar, show.startBar + per - 1];
  const ref = { from: barTime(refBars[0]), to: barTime(refBars[1] + 1) };
  return { t0, end, duration: +(end - t0).toFixed(3), segments, blocks, ref, songBars };
}

export const argv = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
