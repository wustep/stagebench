/**
 * Compose a show from prepped takes.
 * Usage: node scripts/compose.mjs --show shows/<name>.json
 *
 * House style (keep identical across shows): 1920x1080, 30 fps, black. One keyboard at a time,
 * fit to a 1800x610 box centered at y=610. Top-left: "#N on StageBench" (60 px bold, warm white)
 * over the model name (84 px). Top-right: caption title / subtitle / date, fading out by 5 s
 * (caption.fadeOut). Text is HTML rendered
 * with -apple-system (SF Pro on macOS), so render on a Mac for identical type.
 * Audio: one timeline from the takes, 30 ms equal-power switches that end exactly on each
 * downbeat (no fades), then linear make-up gain to the target LUFS through a -1.7 dBFS lookahead
 * limiter. No intro slide or end card unless the show sets titleCardSecs.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { loadShow, argv, FPS } from './lib/show.mjs';

const FF = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
const W = 1920, H = 1080;
const BOX_W = 1800, BOX_H = 610, BOX_CY = 610;
const MARGIN_X = (W - BOX_W) / 2;
const LIMIT_DBFS = -1.7;
const XF = 0.03; // switch length; ends exactly on the downbeat
const SR = 48000;

const S = loadShow(argv('show'));
const P = S.plan;
const TITLE_SECS = S.show.titleCardSecs || 0;
const TARGET_LUFS = S.show.loudness?.targetLufs ?? -14;
const cap = S.show.caption || {};
const WORK = S.workDir;
fs.mkdirSync(WORK, { recursive: true });
fs.mkdirSync(path.dirname(S.output), { recursive: true });

const ff = (args) => {
  const r = spawnSync(FF, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(r.stderr.slice(-1500));
};
const probe = (file) => {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const [w, h] = r.stdout.trim().split(',').map(Number);
  return { w, h };
};
const duration = (file) => Number(spawnSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout.trim());
function loudness(file) {
  const r = spawnSync(FF, ['-hide_banner', '-nostdin', '-i', file, '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' });
  return {
    I: Number(/I:\s+(-?[\d.]+) LUFS/.exec(r.stderr)?.[1]),
    LRA: Number(/LRA:\s+(-?[\d.]+) LU/.exec(r.stderr)?.[1]),
    TP: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(r.stderr.split('True peak:')[1] || '')?.[1]),
  };
}

const segs = P.segments.map((s, k) => {
  const dir = S.takeDir(s.model);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const { w, h } = probe(path.join(dir, 'take-video.mp4'));
  const sc = Math.min(BOX_W / w, BOX_H / h);
  const rw = Math.round((w * sc) / 2) * 2, rh = Math.round((h * sc) / 2) * 2;
  return { ...s, k, dir, meta, rw, rh, x: Math.round((W - rw) / 2), y: Math.round(BOX_CY - rh / 2), first: k === 0, last: k === P.segments.length - 1 };
});

// --- 1. Timeline audio (t=0 is plan.t0). ---
const tlDur = P.end - P.t0;
const inputs = [], chains = [];
segs.forEach((s, i) => {
  inputs.push('-i', path.join(s.dir, 'take-audio.wav'));
  const from = s.first ? s.audioFrom : s.audioFrom - XF;
  const to = s.last ? P.end : s.audioTo;
  const a = from - s.meta.videoStartMidi, b = to - s.meta.videoStartMidi;
  let c = `[${i}:a]atrim=start=${a.toFixed(5)}:end=${b.toFixed(5)},asetpts=PTS-STARTPTS`;
  if (!s.first) c += `,afade=t=in:d=${XF}:curve=qsin`;
  if (!s.last) c += `,afade=t=out:st=${(b - a - XF).toFixed(5)}:d=${XF}:curve=qsin`;
  c += `,adelay=${Math.round((from - P.t0) * 1000)}:all=1[s${i}]`;
  chains.push(c);
});
const mixed = path.join(WORK, 'timeline-premaster.wav');
// apad needs whole_dur and the output needs -t: a bare apad pads forever (it once wrote ~1 TB).
ff([...inputs, '-filter_complex', chains.join(';') + ';' + segs.map((_, i) => `[s${i}]`).join('') +
  `amix=inputs=${segs.length}:normalize=0:duration=longest,apad=whole_dur=${tlDur.toFixed(5)},atrim=duration=${tlDur.toFixed(5)}`,
  '-t', tlDur.toFixed(5), '-ar', String(SR), '-c:a', 'pcm_f32le', mixed]);

// --- 1b. Gentle leveling: nudge only blocks that stand well off the median. ---
// Each barsPerModel block is measured (after the per-model reference gains). A block more than
// `deadbandDb` from the median moves toward it by `strength` of its distance, capped at
// +maxBoostDb / -maxCutDb. Gains ramp over `rampSec` inside a model's turn and step exactly at the
// cut between models, so the song keeps its shape and nothing pumps.
const LV = { strength: 0.35, deadbandDb: 2, maxBoostDb: 2, maxCutDb: 1.5, rampSec: 1, ...(S.show.leveling || {}) };
const blockLoud = (from, to) => {
  const r = spawnSync(FF, ['-hide_banner', '-nostdin', '-ss', (from - P.t0).toFixed(3), '-t', (to - from).toFixed(3), '-i', mixed,
    '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' });
  return Number(/I:\s+(-?[\d.]+) LUFS/.exec(r.stderr)?.[1]);
};
const blocks = P.blocks.map((b) => ({ ...b, I: blockLoud(b.from, b.to) }));
const sorted = blocks.map((b) => b.I).sort((x, y) => x - y);
const median = sorted[Math.floor(sorted.length / 2)];
for (const b of blocks) {
  const d = b.I - median;
  b.nudgeDb = Math.abs(d) <= LV.deadbandDb ? 0 : Math.max(-LV.maxCutDb, Math.min(LV.maxBoostDb, -LV.strength * d));
}
{
  const dec = spawnSync(FF, ['-v', 'error', '-i', mixed, '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-'], { maxBuffer: 1 << 30 }).stdout;
  const st = new Float32Array(dec.buffer.slice(dec.byteOffset, dec.byteOffset + dec.byteLength));
  const n = st.length / 2;
  const gainAt = new Float32Array(n);
  const idxOf = (t) => Math.max(0, Math.min(n, Math.round((t - P.t0) * SR)));
  blocks.forEach((b, i) => {
    const first = i === 0 || blocks[i - 1].seg !== b.seg;
    const last = i === blocks.length - 1 || blocks[i + 1].seg !== b.seg;
    const from = first ? (b.seg === 0 ? P.t0 : segs[b.seg].audioFrom) : b.from;
    const to = last ? (b.seg === segs.length - 1 ? P.end : segs[b.seg].audioTo) : blocks[i + 1].from;
    for (let j = idxOf(from); j < idxOf(to); j++) gainAt[j] = b.nudgeDb;
  });
  // Smooth only the within-turn block boundaries.
  const smooth = Float32Array.from(gainAt);
  blocks.forEach((b, i) => {
    if (i === 0 || blocks[i - 1].seg !== b.seg) return;
    const g0 = blocks[i - 1].nudgeDb, g1 = b.nudgeDb, c = idxOf(b.from), h = Math.round((LV.rampSec / 2) * SR);
    for (let j = c - h; j < c + h; j++) if (j >= 0 && j < n) smooth[j] = g0 + ((g1 - g0) * (j - (c - h))) / (2 * h);
  });
  for (let j = 0; j < n; j++) { const g = Math.pow(10, smooth[j] / 20); st[2 * j] *= g; st[2 * j + 1] *= g; }
  const r = spawnSync(FF, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', '-',
    '-c:a', 'pcm_f32le', mixed], { input: Buffer.from(st.buffer), maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(String(r.stderr).slice(-800));
}
console.log('leveling (median ' + median.toFixed(1) + ' LUFS): ' + blocks.map((b) => `${b.model} ${b.bars.join('-')} ${b.I.toFixed(1)}${b.nudgeDb ? ` ${b.nudgeDb > 0 ? '+' : ''}${b.nudgeDb.toFixed(1)}dB` : ''}`).join(' | '));

const pre = loudness(mixed);
const makeup = TARGET_LUFS - pre.I;
const master = path.join(WORK, 'timeline-master.wav');
ff(['-i', mixed, '-af', `volume=${makeup.toFixed(2)}dB,alimiter=limit=${Math.pow(10, LIMIT_DBFS / 20).toFixed(4)}:attack=1:release=80:level=disabled:asc=1`,
  '-t', tlDur.toFixed(5), '-c:a', 'pcm_f32le', master]);
const raw = spawnSync(FF, ['-v', 'error', '-i', mixed, '-ac', '1', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 }).stdout;
const pcm = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
const lin = Math.pow(10, makeup / 20), ceil = Math.pow(10, LIMIT_DBFS / 20), win = Math.round(0.05 * SR);
const limiter = segs.map((s) => {
  let n = 0, over3 = 0, max = 0, tot = 0;
  for (let i = Math.round((s.from - P.t0) * SR); i < Math.round((s.to - P.t0) * SR) - win; i += win) {
    let pk = 0; for (let j = i; j < i + win; j++) pk = Math.max(pk, Math.abs(pcm[j] || 0));
    const db = 20 * Math.log10((pk * lin) / ceil + 1e-12); tot++;
    if (db > 0) { n++; if (db > 3) over3++; max = Math.max(max, db); }
  }
  return { model: s.model, pctLimited: +((100 * n) / tot).toFixed(1), windowsOver3dB: over3, maxDb: +max.toFixed(1) };
});
console.log('timeline', tlDur.toFixed(3) + 's premaster', JSON.stringify(pre), `makeup ${makeup.toFixed(2)} dB`);

// --- 2. Name/rank overlays (+ optional title card). ---
const FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif`;
const css = `
  * { margin: 0; box-sizing: border-box; }
  html, body { width: ${W}px; height: ${H}px; background: transparent; font-family: ${FONT}; -webkit-font-smoothing: antialiased; color: #fff; }
  .card { position: absolute; left: ${MARGIN_X}px; top: 84px; }
  .rank { display: flex; align-items: baseline; gap: 14px; }
  .num { font-size: 60px; font-weight: 700; letter-spacing: -1px; color: #f6eee2; font-variant-numeric: tabular-nums; }
  .new { font-size: 26px; font-weight: 700; letter-spacing: 3px; color: #000; background: #f6eee2; padding: 6px 14px; border-radius: 8px; align-self: center; }
  .on { font-size: 30px; font-weight: 500; color: rgba(255,255,255,0.62); }
  .name { margin-top: 4px; font-size: 84px; font-weight: 650; letter-spacing: -1.3px; line-height: 1.02; }
  .cap { position: absolute; right: ${MARGIN_X}px; top: 98px; text-align: right; }
  .cap .t { font-size: 30px; font-weight: 600; color: rgba(255,255,255,0.86); letter-spacing: -0.2px; }
  .cap .s { margin-top: 8px; font-size: 22px; font-weight: 500; color: rgba(255,255,255,0.55); }
  .cap .d { margin-top: 10px; font-size: 18px; font-weight: 600; letter-spacing: 2.5px; text-transform: uppercase; color: rgba(255,255,255,0.42); }
`;
const esc = (t) => String(t ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const CAPTION = `<div class="cap">${cap.title ? `<div class="t">${esc(cap.title)}</div>` : ''}${cap.subtitle ? `<div class="s">${esc(cap.subtitle)}</div>` : ''}${cap.date ? `<div class="d">${esc(cap.date)}</div>` : ''}</div>`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const overlays = [];
for (const s of segs) {
  const m = S.model(s.model);
  const rank = m.rank ? `<span class="num">#${m.rank}</span><span class="on">on StageBench</span>`
    : `<span class="new">NEW</span><span class="on">not yet ranked on StageBench</span>`;
  await page.setContent(`<style>${css}</style><div class="card"><div class="rank">${rank}</div><div class="name">${esc(m.label)}</div></div>`);
  await page.evaluate(() => document.fonts.ready);
  const file = path.join(WORK, `label-${s.model}.png`);
  await page.screenshot({ path: file, omitBackground: true });
  overlays.push(file);
}
await page.setContent(`<style>${css}</style>${CAPTION}`);
await page.evaluate(() => document.fonts.ready);
const captionPng = path.join(WORK, 'caption.png');
await page.screenshot({ path: captionPng, omitBackground: true });
let title = null;
if (TITLE_SECS > 0) {
  await page.setContent(`<style>${css}
    body { background: #000; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
    h1 { font-size: 92px; font-weight: 650; letter-spacing: -1.5px; }
    h2 { margin-top: 22px; font-size: 38px; font-weight: 500; color: rgba(255,255,255,0.72); }
    p { margin-top: 48px; font-size: 24px; font-weight: 600; letter-spacing: 3px; text-transform: uppercase; color: rgba(255,255,255,0.45); }
  </style><h1>${esc(cap.title)}</h1><h2>${esc(cap.subtitle)}</h2><p>${esc(cap.date)}</p>`);
  await page.evaluate(() => document.fonts.ready);
  title = path.join(WORK, 'title.png');
  await page.screenshot({ path: title });
}
await browser.close();

// --- 3. Picture: each model's bars full width; hard cuts. ---
const vin = [], graph = [];
let idx = 0;
if (title) {
  vin.push('-loop', '1', '-framerate', String(FPS), '-t', String(TITLE_SECS), '-i', title);
  graph.push(`[${idx++}:v]format=yuv420p,setsar=1[v0]`);
}
segs.forEach((s, i) => {
  const D = s.to - s.from;
  const vi = idx++, oi = idx++;
  vin.push('-i', path.join(s.dir, 'take-video.mp4'), '-loop', '1', '-framerate', String(FPS), '-t', D.toFixed(5), '-i', overlays[i]);
  graph.push(`color=c=black:s=${W}x${H}:r=${FPS}:d=${D.toFixed(5)}[bg${i}]`);
  graph.push(`[${vi}:v]trim=start=${(s.from - s.meta.videoStartMidi).toFixed(5)}:duration=${D.toFixed(5)},setpts=PTS-STARTPTS,scale=${s.rw}:${s.rh}:flags=lanczos[p${i}]`);
  graph.push(`[bg${i}][p${i}]overlay=${s.x}:${s.y}[c${i}]`);
  graph.push(`[c${i}][${oi}:v]overlay=0:0,format=yuv420p,setsar=1,trim=end_frame=${Math.round(D * FPS)}[v${i + 1}]`);
});
const parts = Array.from({ length: segs.length + 1 }, (_, i) => i).filter((i) => i > 0 || title);
const total = TITLE_SECS + tlDur;
// Caption: fully visible, then fades out and is gone by fadeOut[1] seconds into the film.
const [capFadeStart, capGone] = cap.fadeOut || [3.5, 5];
graph.push(`${parts.map((i) => `[v${i}]`).join('')}concat=n=${parts.length}:v=1:a=0[vcat]`);
graph.push(`[${idx}:v]format=rgba,fade=t=out:st=${capFadeStart}:d=${(capGone - capFadeStart).toFixed(3)}:alpha=1[cap]`);
graph.push(`[vcat][cap]overlay=0:0:eof_action=pass,format=yuv420p[v]`);
vin.push('-loop', '1', '-framerate', String(FPS), '-t', String(capGone + 0.5), '-i', captionPng);
idx++;
graph.push(`[${idx}:a]${TITLE_SECS > 0 ? `adelay=${TITLE_SECS * 1000}:all=1,` : ''}apad=whole_dur=${total.toFixed(5)}[a]`);
vin.push('-i', master);
ff([...vin, '-filter_complex', graph.join(';'), '-map', '[v]', '-map', '[a]', '-t', total.toFixed(5),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-r', String(FPS), '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart',
  '-c:a', 'aac', '-b:a', '256k', '-ar', String(SR), S.output]);

const report = {
  show: S.name, file: path.relative(process.cwd(), S.output), duration: duration(S.output), loudness: loudness(S.output),
  makeupDb: +makeup.toFixed(2), limiter, leveling: { ...LV, medianLufs: median, blocks: blocks.map((b) => ({ model: b.model, bars: b.bars, lufs: b.I, nudgeDb: +b.nudgeDb.toFixed(2) })) },
  timeline: segs.map((s) => {
    const m = S.model(s.model);
    return { model: s.model, label: m.label, rank: m.rank, score: m.score, bars: s.bars,
      filmFrom: +(TITLE_SECS + s.from - P.t0).toFixed(3), filmTo: +(TITLE_SECS + s.to - P.t0).toFixed(3), secs: s.secs,
      prep: JSON.parse(fs.readFileSync(path.join(s.dir, 'prep.json'), 'utf8')),
      take: { setup: s.meta.setup, miss: s.meta.miss, missed: s.meta.missed, schedLateMs: s.meta.schedLateMs, quantizeVelocity: s.meta.quantizeVelocity } };
  }),
};
fs.writeFileSync(S.output.replace(/\.mp4$/, '.report.json'), JSON.stringify(report, null, 1));
console.log('wrote', S.output, report.duration.toFixed(3) + 's', JSON.stringify(report.loudness));
for (const t of report.timeline) console.log(`  ${t.filmFrom.toFixed(2).padStart(6)}–${t.filmTo.toFixed(2).padStart(6)}  bars ${t.bars.join('–').padEnd(8)} #${t.rank}  ${t.label}`);
console.log('limiter', JSON.stringify(limiter));
