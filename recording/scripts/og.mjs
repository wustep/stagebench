/**
 * Compose the 1200x630 Open Graph / social preview loop from a show's prepped takes.
 * Usage: node scripts/og.mjs --show shows/og-video.json [--reuse-gallery]
 *        (make.mjs runs it as that show's `composer`; --reuse-gallery skips recapturing the site)
 *
 * Silent and about 8.5 s long, built to autoplay muted and loop:
 *  1. card + gallery: og.card (public/og.png) is stacked on top of the live site (og.galleryUrl), so
 *     the film opens on the card and one eased scroll carries it up through the gallery's hero to
 *     the leaderboard. Frame-exact: scrollTo per sub-frame, with motion blur from a 180° shutter
 *     sampled every og.blurStep px of travel. Frames that haven't moved yet are og.png itself.
 *  2. models: one keyboard per bar from the prepped take-video.mp4s, counting up to #1, under the
 *     og.png header (red band, 10 px #591822 rule, StageBench wordmark) with rank, name and score.
 *     Each cut lands on the first frame at or after its downbeat, so it opens on the hit.
 *  3. card: a hard cut back to og.png on the next downbeat. The film ends and starts on the same
 *     frame, so the loop point doesn't show.
 * Writes S.output (H.264 High, yuv420p, BT.709 matrix and primaries with the sRGB transfer tag,
 * +faststart, no audio), og.poster (frame og.posterFrame of the lossless master), and
 * _work/og-contact.png (every 0.5 s) for checking stills.
 * Type is the gallery's own (Barlow Condensed 800, Manrope) from the repo's node_modules: run
 * `pnpm install` at the repo root first.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { loadShow, loadMidi, argv, FPS, REC, REPO } from './lib/show.mjs';

const FF = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
const W = 1200, H = 630;

const S = loadShow(argv('show'));
const OG = {
  galleryUrl: 'https://stagebench.vercel.app/',
  galleryDpr: 2,
  hold: 0.6, // card before the scroll starts; with cardSecs it makes the brand beat across the loop
  scroll: 1.7, // card -> hero -> leaderboard
  settle: 0.5, // leaderboard before the first keyboard
  scrollTo: 'h2', scrollToText: 'Runs', scrollMargin: 20,
  shutter: 0.5, // fraction of a frame the motion blur spans
  blurStep: 2, // px of travel per blur sub-frame
  band: 136, // red header height in the keyboard shots, including its 10 px rule
  card: '../public/og.png',
  cardSecs: 0.9,
  crf: 16,
  poster: '../public/og-video-poster.png',
  posterFrame: 0,
  ...(S.show.og || {}),
};
const WORK = S.workDir;
const GAL = path.join(WORK, 'gallery');
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
const pad = (n, w = 4) => String(n).padStart(w, '0');

// --- Timeline (film frames at 30 fps). ---
const midi = loadMidi(S.files.audio);
const bpb = S.song.beatsPerBar || 4;
const barTime = (bar1) => midi.header.ticksToSeconds((bar1 - 1) * midi.header.ppq * bpb);
const G = Math.round((OG.hold + OG.scroll + OG.settle) * FPS);
const t0 = barTime(S.show.startBar);
const frameAt = (t) => G + Math.ceil((t - t0) * FPS - 1e-6); // first film frame at or after MIDI time t
const onsets = loadMidi(S.files.visual).tracks.flatMap((tr) => tr.notes.map((n) => n.time));
const segs = S.plan.segments.map((s, k) => {
  const dir = S.takeDir(s.model);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const from = frameAt(barTime(s.bars[0])), to = frameAt(barTime(s.bars[1] + 1));
  // Film frame f shows MIDI time t0 + (f - G)/FPS; take frame i shows videoStartMidi + i/FPS.
  // Humanized downbeats can land a few ms after the bar line, so shift the take (at most a frame,
  // which a silent film can't show) until its first frame has the whole downbeat chord down.
  const at = t0 + (from - G) / FPS, bar = barTime(s.bars[0]);
  const chord = onsets.filter((t) => Math.abs(t - bar) < 0.05);
  const takeFrom = Math.max(at, ...chord) - meta.videoStartMidi;
  return { ...s, k, dir, meta, model: S.model(s.model), from, to, takeFrom };
});
const modelsEnd = segs.at(-1).to;
const C = Math.round(OG.cardSecs * FPS);
const total = modelsEnd + C;

const card = path.resolve(REC, OG.card);
if (probe(card).w !== W || probe(card).h !== H) throw new Error(`${card} must be ${W}x${H}`);
const cardRgb = path.join(WORK, 'og-card.png');
ff(['-i', card, '-vf', 'format=rgb24', '-frames:v', '1', '-update', '1', cardRgb]);

// --- 1. Card + gallery frames from the live site. ---
const ease = (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);
async function captureGallery() {
  fs.rmSync(GAL, { recursive: true, force: true });
  fs.mkdirSync(GAL, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: OG.galleryDpr });
  const page = await context.newPage();
  await page.goto(OG.galleryUrl, { waitUntil: 'load', timeout: 120000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(3000);
  // The card sits above the page, exactly one viewport tall, so scroll 0 frames it alone.
  await page.evaluate(async (src) => {
    const style = document.createElement('style');
    style.textContent = 'html { scrollbar-width: none } ::-webkit-scrollbar { display: none }';
    document.head.append(style);
    const img = new Image();
    img.src = src;
    img.alt = '';
    img.style.cssText = 'display: block; width: 100%; height: auto';
    document.body.prepend(img);
    await img.decode();
  }, `data:image/png;base64,${fs.readFileSync(cardRgb).toString('base64')}`);
  await page.waitForTimeout(500);
  const target = await page.evaluate(({ sel, text, margin }) => {
    const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.trim() === text);
    return el ? el.getBoundingClientRect().top + window.scrollY - margin : null;
  }, { sel: OG.scrollTo, text: OG.scrollToText, margin: OG.scrollMargin });
  if (target == null) throw new Error(`gallery: no ${OG.scrollTo} reading "${OG.scrollToText}" at ${OG.galleryUrl}`);
  const scrollAt = (t) => target * ease(Math.min(1, Math.max(0, (t - OG.hold) / OG.scroll)));
  const sub = path.join(GAL, 'sub');
  let shots = 0;
  for (let f = 0; f < G; f++) {
    const out = path.join(GAL, `g${pad(f)}.png`);
    const a = scrollAt((f - OG.shutter / 2) / FPS), b = scrollAt((f + OG.shutter / 2) / FPS);
    if (b === 0) { fs.copyFileSync(cardRgb, out); continue; } // still on the card: og.png exactly
    // Sub-frames spread evenly in time across the shutter, about blurStep px of travel apart.
    const K = Math.max(1, Math.min(48, Math.ceil((b - a) / OG.blurStep)));
    fs.rmSync(sub, { recursive: true, force: true });
    fs.mkdirSync(sub);
    for (let j = 0; j < K; j++) {
      const y = scrollAt((f + ((j + 0.5) / K - 0.5) * OG.shutter) / FPS);
      await page.evaluate((y) => new Promise((resolve) => {
        window.scrollTo(0, y);
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }), y);
      await page.screenshot({ path: path.join(sub, `s${pad(j, 2)}.png`) });
      shots++;
    }
    ff(['-i', path.join(sub, 's%02d.png'), '-vf', `scale=${W}:${H}:flags=lanczos,tmix=frames=${K},select=eq(n\\,${K - 1}),format=rgb24`,
      '-frames:v', '1', '-update', '1', out]);
  }
  fs.rmSync(sub, { recursive: true, force: true });
  await browser.close();
  return { target, shots };
}

// --- 2. Keyboard-shot chrome: og.png's header with rank, name, score and wordmark. ---
const font = (family, weight, file) => {
  const p = path.join(REPO, 'node_modules', file);
  if (!fs.existsSync(p)) throw new Error(`missing ${p}: run pnpm install at the repo root`);
  return `@font-face { font-family: '${family}'; font-weight: ${weight}; src: url(data:font/woff2;base64,${fs.readFileSync(p).toString('base64')}) format('woff2'); }`;
};
const FONTS = font('Barlow Condensed', 800, '@fontsource/barlow-condensed/files/barlow-condensed-latin-800-normal.woff2')
  + font('Manrope Variable', '200 800', '@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2');
const esc = (t) => String(t ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const B = OG.band;
const CSS = `${FONTS}
  * { box-sizing: border-box; margin: 0; }
  html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: #000; color: oklch(98% 0 0);
    font-family: 'Manrope Variable', sans-serif; -webkit-font-smoothing: antialiased; }
  /* scripts/og-image.html's background, squeezed into a band. */
  .band { position: absolute; inset: 0 0 auto; height: ${B}px; border-bottom: 10px solid #591822;
    display: flex; align-items: center; justify-content: space-between; padding: 0 52px 2px 50px;
    background:
      radial-gradient(110% 260% at 30% -120%, oklch(57% 0.18 25), transparent 64%),
      linear-gradient(180deg, transparent 35%, oklch(23% 0.09 25 / .75)),
      linear-gradient(90deg, #5f1923, #79232c 18% 82%, #5f1923); }
  .band::after { content: ''; position: absolute; inset: 0; opacity: .07; mix-blend-mode: overlay; pointer-events: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
  .rail { position: absolute; inset: ${B}px 0 0; box-shadow: 0 -1px oklch(100% 0 0 / .1); }
  .who { display: flex; align-items: center; gap: 22px; }
  .rank { font: 800 88px/.8 'Barlow Condensed', sans-serif; letter-spacing: -.03em; padding-top: 6px; }
  .name { font-size: 36px; font-weight: 650; line-height: 1.05; letter-spacing: -.015em; }
  .score { margin-top: 7px; font-size: 19px; font-weight: 500; color: color-mix(in oklch, oklch(98% 0 0) 72%, transparent); }
  .score b { font: 800 24px/1 'Barlow Condensed', sans-serif; color: oklch(98% 0 0); letter-spacing: .01em; }
  .mark { font: 800 58px/.86 'Barlow Condensed', sans-serif; letter-spacing: -.035em; padding-top: 4px; }
`;
async function renderChrome() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const files = [];
  for (const s of segs) {
    const m = s.model;
    const rank = m.rank ? `#${m.rank}` : 'New';
    const score = typeof m.score === 'number' ? `<b>${Math.floor(m.score)}</b> / 100 on StageBench` : 'Not yet ranked';
    await page.setContent(`<style>${CSS}</style><div class="band"><div class="who"><div class="rank">${rank}</div>
      <div><div class="name">${esc(m.label)}</div><div class="score">${score}</div></div></div>
      <div class="mark">StageBench</div></div><div class="rail"></div>`);
    await page.evaluate(() => document.fonts.ready);
    const missing = await page.evaluate(() => [...document.fonts].filter((f) => f.status !== 'loaded').map((f) => f.family));
    if (missing.length) throw new Error(`fonts failed to load: ${missing.join(', ')}`);
    const file = path.join(WORK, `og-chrome-${s.model.id}.png`);
    await page.screenshot({ path: file });
    files.push(file);
  }
  await browser.close();
  return files;
}

// --- 3. Lossless RGB master, then the delivery encode and the poster. ---
const gallery = process.argv.includes('--reuse-gallery') && fs.existsSync(path.join(GAL, `g${pad(G - 1)}.png`))
  ? { reused: true } : await captureGallery();
const chrome = await renderChrome();

const BOX = { x: 32, y: B + 26, w: W - 64, h: H - B - 52 };
const vin = ['-framerate', String(FPS), '-i', path.join(GAL, 'g%04d.png')];
const graph = [`[0:v]format=rgb24,setsar=1,trim=end_frame=${G},settb=1/${FPS},setpts=N[p0]`];
let idx = 1;
const placed = segs.map((s, i) => {
  const { w, h } = probe(path.join(s.dir, 'take-video.mp4'));
  const sc = Math.min(BOX.w / w, BOX.h / h);
  const rw = Math.round((w * sc) / 2) * 2, rh = Math.round((h * sc) / 2) * 2;
  const x = Math.round((W - rw) / 2), y = Math.round(BOX.y + (BOX.h - rh) / 2);
  const D = s.to - s.from;
  const ti = idx++, hi = idx++;
  vin.push('-i', path.join(s.dir, 'take-video.mp4'), '-loop', '1', '-framerate', String(FPS), '-t', ((D + 2) / FPS).toFixed(4), '-i', chrome[i]);
  // trim keeps the first take frame at or after the film frame's MIDI time, so a cut opens on its hit.
  graph.push(`[${ti}:v]trim=start=${Math.max(0, s.takeFrom - 1e-4).toFixed(5)},setpts=PTS-STARTPTS,scale=${rw}:${rh}:flags=lanczos,format=rgb24[t${i}]`);
  graph.push(`[${hi}:v]format=rgb24[c${i}]`);
  graph.push(`[c${i}][t${i}]overlay=${x}:${y}:eof_action=repeat,trim=end_frame=${D},settb=1/${FPS},setpts=N,setsar=1[p${i + 1}]`);
  return { model: s.model.id, rank: s.model.rank, bars: s.bars, frames: [s.from, s.to], take: { w, h }, placed: { x, y, w: rw, h: rh } };
});
const ci = idx++;
vin.push('-loop', '1', '-framerate', String(FPS), '-t', ((C + 2) / FPS).toFixed(4), '-i', cardRgb);
graph.push(`[${ci}:v]format=rgb24,trim=end_frame=${C},settb=1/${FPS},setpts=N,setsar=1[pc]`);
const parts = [...Array(segs.length + 1).keys()].map((i) => `[p${i}]`).join('') + '[pc]';
graph.push(`${parts}concat=n=${segs.length + 2}:v=1:a=0[v]`);
const master = path.join(WORK, 'og-master.mkv');
ff([...vin, '-filter_complex', graph.join(';'), '-map', '[v]', '-frames:v', String(total), '-r', String(FPS),
  '-c:v', 'libx264rgb', '-qp', '0', '-preset', 'ultrafast', master]);

// Tagged sRGB transfer, not bt709: the frames are sRGB screenshots, and Chrome and Safari then show
// og.png's reds exactly (a bt709 or missing transfer tag renders them ~4% brighter).
ff(['-i', master, '-vf', 'scale=out_color_matrix=bt709:out_range=tv:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv420p,'
    + 'setparams=range=tv:color_primaries=bt709:color_trc=iec61966-2-1:colorspace=bt709',
  '-c:v', 'libx264', '-preset', 'veryslow', '-crf', String(OG.crf), '-profile:v', 'high', '-level:v', '4.0',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1', '-color_range', 'tv',
  '-r', String(FPS), '-an', '-movflags', '+faststart', S.output]);
const poster = path.resolve(REC, OG.poster);
ff(['-i', master, '-vf', `select=eq(n\\,${OG.posterFrame}),format=rgb24`, '-frames:v', '1', '-update', '1', poster]);

// Contact sheet: a frame every 0.5 s, 4 across at 300x158.
const sheet = path.join(WORK, 'og-contact.png');
ff(['-i', S.output, '-vf', `select='not(mod(n\\,${FPS / 2}))',scale=300:-2,tile=4x${Math.ceil(total / (FPS / 2) / 4)}:padding=4`, '-frames:v', '1', '-update', '1', sheet]);

const size = fs.statSync(S.output).size;
const report = {
  show: S.name, output: path.relative(REC, S.output), poster: path.relative(REC, poster), sizeBytes: size,
  frames: total, seconds: +(total / FPS).toFixed(3), gallery: { frames: G, url: OG.galleryUrl, ...gallery },
  models: placed, card: { frames: [modelsEnd, total] }, og: OG,
};
fs.writeFileSync(path.join(WORK, 'og-report.json'), JSON.stringify(report, null, 1));
console.log(`wrote ${S.output} ${(size / 1e6).toFixed(2)} MB, ${total} frames (${(total / FPS).toFixed(2)} s); poster ${poster}`);
console.log(`  0–${G} card + gallery | ` + placed.map((p) => `${p.frames.join('–')} #${p.rank} ${p.model}`).join(' | ') + ` | ${modelsEnd}–${total} card`);
console.log(`contact sheet ${sheet}`);
