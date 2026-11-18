// Loads a show config (shows/<name>.json) and resolves everything the pipeline needs:
// the song's MIDI, each model's label/rank/score (the gallery's combined leaderboard in
// src/data/runs.json), where its preview is served from, its capture fixture (models.json), and the
// timing plan. Every script calls loadShow(), so recording, prep and compose always agree.
//
// A model that can't be filmed yet (no run record, or no preview at the show's stage) doesn't stop
// the show: it becomes a placeholder slot (`model.placeholder` holds the reason). Its bars stay in
// the plan, nothing is recorded for it, and compose.mjs fills its turn with a house-style card.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import midiPkg from '@tonejs/midi';

const { Midi } = midiPkg;
export const REC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); // recording/
export const REPO = path.resolve(REC, '..');
export const FPS = 30;
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const PRODUCTION = 'https://stagebench.vercel.app/previews';

// StageBench ranks: ONE combined list, the gallery's own data and rule (src/data/runs.json, built
// from runs/*/run.json by `pnpm bench reindex`; ranking as in src/runs-data.ts buildRankByRun):
// every run with a numeric `score` (the gallery's aggregate), highest first, newest first on a tie,
// numbered by position. No per-protocol or per-rubric boards. Computed every time a show loads,
// never stored, so the film says what the site says.
export function leaderboard(file = path.join(REPO, 'src', 'data', 'runs.json')) {
  const runs = readJson(file).filter((r) => typeof r.score === 'number')
    .sort((a, b) => b.score - a.score || String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? '')));
  return Object.fromEntries(runs.map((r, i) => [r.id, { id: r.id, title: r.title, score: r.score, of: runs.length, rank: i + 1 }]));
}

// Checkouts searched for runs/<id>/run.json and public/previews/<id>/stage<N>/: this one first,
// then any listed in STAGEBENCH_EXTRA_CHECKOUTS (path-separated, read only). The extra list is for
// filming a run that only exists in another checkout (e.g. one still being graded) without copying
// it here; nothing is written to those trees.
export function checkouts() {
  const extra = (process.env.STAGEBENCH_EXTRA_CHECKOUTS || '').split(path.delimiter).filter(Boolean)
    .map((p) => path.resolve(p.replace(/^~(?=$|\/)/, os.homedir())));
  return [REPO, ...extra.filter((p) => p !== REPO)];
}
const findRunJson = (id) => checkouts().map((c) => path.join(c, 'runs', id, 'run.json')).find((f) => fs.existsSync(f)) || null;
export const findPreview = (id, stage) => {
  for (const c of checkouts()) {
    const pub = path.join(c, 'public');
    if (fs.existsSync(path.join(pub, 'previews', id, `stage${stage}`, 'index.html'))) return pub;
  }
  return null;
};
export const loadMidi = (file) => new Midi(fs.readFileSync(file));

// Note events for notes starting in [from, before); offs sort before ons at equal times.
// hold ({ from, until }, the plan's finalHold): a note struck at or after hold.from sounds until at
// least hold.until (a held final chord), unless the same key is struck again before `before`.
export function events(midi, from, before, hold = null) {
  const ev = [];
  const notes = midi.tracks.flatMap((tr) => tr.notes).filter((n) => n.time >= from - 1e-6 && n.time < before);
  for (const n of notes) {
    let end = n.time + n.duration;
    if (hold && n.time >= hold.from - 1e-6 && !notes.some((o) => o !== n && o.midi === n.midi && o.time > n.time)) end = Math.max(end, hold.until);
    ev.push({ t: n.time, on: 1, note: n.midi, vel: Math.max(1, Math.round(n.velocity * 127)) });
    ev.push({ t: end, on: 0, note: n.midi });
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
  const stage = show.stage ?? 3;
  // previewBase "local" serves the preview from this checkout's public/ (scripts/lib/serve.mjs);
  // anything else is a URL prefix (the Étude film used production).
  const local = show.previewBase === 'local';
  const base = (show.previewBase && !local ? show.previewBase : PRODUCTION).replace(/\/$/, '');

  const models = show.models.map((id) => {
    const ranked = board[id];
    const ownRun = path.join(REPO, 'runs', id, 'run.json');
    if (ranked && fs.existsSync(ownRun)) {
      const s = readJson(ownRun).evaluation?.score;
      if (s !== ranked.score) console.warn(`warning: ${id} scores ${s} in runs/${id}/run.json but ${ranked.score} in src/data/runs.json; run \`pnpm bench reindex\` so ranks match the gallery`);
    }
    const runFile = ranked ? null : findRunJson(id);
    const run = ranked || (runFile ? readJson(runFile) : null);
    const previewRoot = local ? findPreview(id, stage) : null;
    let placeholder = null;
    if (!run) placeholder = `no run record (not in src/data/runs.json, no runs/${id}/run.json)`;
    else if (local && !previewRoot) placeholder = `no public/previews/${id}/stage${stage}/`;
    if (!placeholder && !fixtures[id]) console.warn(`warning: ${id} has no models.json fixture; probe it first (scripts/probe.mjs --model ${id} --base local)`);
    const fx = { ...fixtures.default, ...(fixtures[id] || {}) };
    const label = show.labels?.[id] ?? run?.title ?? show.placeholderLabels?.[id] ?? id;
    return {
      id, label, rank: ranked?.rank ?? null, of: ranked?.of ?? null, score: ranked?.score ?? null, placeholder,
      url: local ? null : `${base}/${id}/stage${stage}/`,
      previewRoot, previewPath: `/previews/${id}/stage${stage}/`,
      viewport: fx.viewport, setup: fx.setup || [], quantizeVelocity: fx.quantizeVelocity || null, prewarm: !!fx.prewarm,
      instrument: fx.instrument || null,
    };
  });
  // Unranked models count down first (they have no place on the board yet).
  if (show.order === 'countdown') models.sort((a, b) => (b.rank ?? Infinity) - (a.rank ?? Infinity) || (a.score ?? 0) - (b.score ?? 0));

  const files = { audio: path.join(songDir, song.audioMidi), visual: path.join(songDir, song.visualMidi || song.audioMidi) };
  const plan = makePlan(show, song, files, models.map((m) => m.id));
  return {
    name, show, song, songDir, files, models, plan,
    model: (id) => models.find((m) => m.id === id),
    filmable: models.filter((m) => !m.placeholder),
    takeDir: (id) => path.join(REC, '.takes', name, id),
    workDir: path.join(REC, '.takes', name, '_work'),
    output: path.resolve(REC, show.output || `output/${name}.mp4`),
  };
}

// One continuous stretch of the song: each model gets `barsPerModel` bars from `startBar`, in
// order; the last gets the same, a number of bars, or every remaining bar ("to-end"). Video cuts
// land on the frame at or before each downbeat, so every downbeat belongs to the incoming piano.
// song.pickupBeats: the file opens with an anacrusis, so bar 1 starts that many beats in.
// show.pickupBeats: the first model also plays that many beats before startBar (its pickup).
// show.lastBarBeats: the film's final bar plays only its first N beats (a cadence whose bar also
// holds the next section's pickup); without it the last model plays into the next downbeat.
// show.finalHold: with lastBarBeats, hold the notes struck on that final beat for this many
// seconds from the beat (a fermata on the closing chord), then release into `breathe`.
// show.breathe: seconds from that release (the last note lifting) to the end of the last model's
// picture. An end card's crossfade (endCard.crossfade) takes the last seconds of it.
// show.pickupInIntro (with an intro): the first model's picture starts on startBar's downbeat like
// every other turn; its idle and pickup play under the end of the intro (from = the downbeat cut,
// audioFrom = t0). Without it the first turn's picture starts at t0 and carries both.
// show.ringOut: seconds the audio runs on past the last picture (audioEnd = end + ringOut), so the
// final chord's reverb tail decays under the end card instead of being cut; compose fades it out.
function makePlan(show, song, files, order) {
  const midi = loadMidi(files.audio);
  const ppq = midi.header.ppq, bpb = song.beatsPerBar || 4, pick = (song.pickupBeats || 0) * ppq;
  const barTick = (bar1) => pick + (bar1 - 1) * ppq * bpb;
  const barTime = (bar1) => midi.header.ticksToSeconds(barTick(bar1));
  const notes = midi.tracks.flatMap((t) => t.notes);
  const songBars = Math.ceil((Math.max(...notes.map((x) => x.ticks + 1)) - pick) / (ppq * bpb));
  const lastOff = Math.max(...notes.map((x) => x.time + x.duration));
  const IDLE = show.idle ?? 0.4, BREATHE = show.breathe ?? 2.5, LEADIN_BARS = show.leadInBars ?? 2;
  const n = order.length, per = show.barsPerModel;
  const starts = order.map((_, k) => show.startBar + k * per);
  const lastBars = show.last === 'to-end' ? songBars - starts[n - 1] + 1 : (typeof show.last === 'number' ? show.last : per);
  const finalBar = starts[n - 1] + lastBars; // first bar after the film's music
  if (finalBar - 1 > songBars) throw new Error(`plan runs past the song (bar ${finalBar - 1} > ${songBars})`);
  const toEnd = finalBar - 1 >= songBars;
  const endBeats = toEnd ? 0 : show.lastBarBeats || 0;
  if (endBeats && (endBeats >= bpb || !Number.isInteger(endBeats))) throw new Error(`lastBarBeats must be a whole number below ${bpb}`);
  // Not to the end: play into the next downbeat (one beat) so the film lands on it, or, with
  // lastBarBeats, stop after that many beats of the final bar.
  const landTick = endBeats ? barTick(finalBar - 1) + (endBeats - 1) * ppq : barTick(finalBar);
  const finalCut = toEnd ? Infinity : midi.header.ticksToSeconds(landTick + ppq);
  const landAt = midi.header.ticksToSeconds(landTick);
  const finalHold = endBeats && show.finalHold ? { from: landAt, until: landAt + show.finalHold } : null;
  const finalRelease = toEnd ? lastOff
    : Math.max(endBeats ? finalCut : barTime(finalBar), finalHold?.until ?? 0, ...notes.filter((x) => x.time >= landAt - 1e-6 && x.time < finalCut).map((x) => x.time + x.duration));
  const firstPlay = midi.header.ticksToSeconds(Math.max(0, barTick(starts[0]) - (show.pickupBeats || 0) * ppq));
  const t0 = firstPlay - IDLE;
  const end = t0 + Math.round((finalRelease + BREATHE - t0) * FPS) / FPS;
  const audioEnd = end + Math.round((show.ringOut ?? 0) * FPS) / FPS;
  const cut = (t) => t0 + Math.floor((t - t0) * FPS + 1e-6) / FPS;
  const pickupInIntro = !!(show.pickupInIntro && show.intro);
  const segments = order.map((model, k) => {
    const first = k === 0, last = k === n - 1, bar = starts[k];
    return {
      model, bars: [bar, last ? finalBar - 1 : bar + per - 1],
      from: first && !pickupInIntro ? t0 : cut(barTime(bar)), to: last ? end : cut(barTime(bar + per)),
      audioFrom: first ? t0 : barTime(bar), audioTo: last ? end : barTime(bar + per),
      playStart: first ? firstPlay : barTime(Math.max(1, bar - LEADIN_BARS)),
      playBefore: last ? finalCut : barTime(bar + per), // onsets played: [playStart, playBefore)
      ...(last && finalHold ? { hold: finalHold } : {}),
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
  // lead: seconds of the timeline (idle + pickup) before the first turn's picture starts; with
  // pickupInIntro they play under the intro.
  return { t0, end, audioEnd, lead: +(segments[0].from - t0).toFixed(5), pickupInIntro, duration: +(end - t0).toFixed(3), segments, blocks, ref, songBars, finalCut, finalHold, finalRelease };
}

export const argv = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
