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
 * limiter. No intro or end card unless the show sets one.
 * Optional cards (renderCard): show.intro before the first model, show.endCard after the last.
 * Each is { secs, image, title, subtitle, date, footer, fades } plus its placement:
 *  - intro with frame "first-model": the image (a keyed photo) is scaled and placed so its chassis
 *    lands exactly on the first model's chassis as composed (measured from both images), so the cut
 *    into the first turn keeps the keyboard where it is; title and subtitle sit above it, the date
 *    below. With show.pickupInIntro the first model's idle and pickup play under its last moments.
 *  - otherwise (the end card): the image centered, an SVG drawn at a whole-number imageScale of its
 *    own size on even pixels (pick a scale that puts the art's coordinates on whole pixels, so its
 *    straight edges are exact rather than anti-aliased), with imageFilter (CSS, lengths at 1x,
 *    scaled with it); the type beneath it.
 * Type: the title in Crimson Pro (the one non-system face, vendored in assets/fonts/), everything
 * else SF Pro. Each part is its own layer on its own schedule: fades.<part> = [in at, in for] or
 * [in at, in for, out at, out for]; the image fades from black, the type in alpha. An end card with
 * `crossfade` dissolves in from the last model over that many seconds (the last seconds of its
 * turn) instead of starting on black; show.ringOut lets the audio decay under it and fades it out.
 * An intro with `crossfade` dissolves into the first model over its last seconds (the first model is
 * fully up on its downbeat either way). Picture is composited in RGB and converted to tagged
 * BT.709/sRGB 4:2:0 video once (TO_VIDEO below).
 * With an intro, the caption comes on with the first model. `--cards` renders just the cards.
 * Placeholder slots (models not filmable yet, see lib/show.mjs) keep their bars: black frame, the
 * same label (NEW / not yet ranked) and a centered "Take pending" line in the caption's subtitle
 * style; their audio is silent and they are left out of the leveling.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { loadShow, argv, FPS, REC } from './lib/show.mjs';

const FF = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
const W = 1920, H = 1080;
const BOX_W = 1800, BOX_H = 610, BOX_CY = 610;
const MARGIN_X = (W - BOX_W) / 2;
const LIMIT_DBFS = -1.7;
const XF = 0.03; // switch length; ends exactly on the downbeat
const SR = 48000;
// Picture: everything is composited in RGB (gbrp) and converted to video once, at the very end:
// BT.709 matrix, limited (tv) range, BT.709 primaries and the sRGB transfer, all tagged. Every source
// (the previews' screen captures, the photo, the card art) is sRGB, and with that tag colour-managed
// players show the frames as rendered: the end-card red plays as #c3202e in Chrome and #c2202e in
// WebKit/Safari against the site's #c4202f (the nearest 8-bit video can carry), where a BT.709
// transfer tag shows ~#ca2335 in both and round 3's full-range BT.601 file #d0312d in Chrome. The
// 4:2:0 chroma is taken with an area filter, so a flat colour meeting black on an even pixel (the
// end-card art) keeps a one-pixel edge instead of the smeared, ringing chroma fringe of converting
// each layer to yuv420p on its own.
const PIX = 'gbrp';
const TO_VIDEO = 'scale=out_color_matrix=bt709:out_range=tv:flags=area+accurate_rnd+full_chroma_inp,format=yuv420p,setparams=range=tv:color_primaries=bt709:color_trc=iec61966-2-1:colorspace=bt709';
const VIDEO_TAGS = ['-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1'];

const S = loadShow(argv('show'));
const P = S.plan;
const INTRO = S.show.intro || null; // a card before the first model (see renderCard)
const INTRO_SECS = INTRO?.secs || 0;
const TITLE_SECS = INTRO_SECS || S.show.titleCardSecs || 0; // film time before the music
const END = S.show.endCard || null;
const END_SECS = END?.secs || 0;
// The end card's crossfade, on whole frames (xfade offsets must land on a frame).
const XF_END = END_SECS ? Math.round((END.crossfade || 0) * FPS) / FPS : 0;
// The intro's crossfade into the first turn (intro.crossfade), on whole frames: the last frames of
// the intro dissolve into the first model, whose picture is fully up on its downbeat as without it.
const XF_IN = INTRO_SECS ? Math.round((INTRO.crossfade || 0) * FPS) / FPS : 0;
// Timeline before the first turn's picture (idle + pickup), played under the intro (pickupInIntro).
const LEAD = P.lead;
const MUSIC_AT = TITLE_SECS - LEAD; // film time of the timeline's t0
if (MUSIC_AT < 0) throw new Error(`intro (${INTRO_SECS} s) is shorter than the idle + pickup it carries (${LEAD.toFixed(2)} s)`);
if (P.audioEnd - P.end > END_SECS - XF_END + 1e-6) throw new Error(`ringOut runs past the end card (${(P.audioEnd - P.end).toFixed(2)} s > ${(END_SECS - XF_END).toFixed(2)} s)`);
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

// --- 2. Name/rank overlays (+ optional title card). ---
// House type is SF Pro through -apple-system; no web fonts. The platform fonts actually used are
// checked below and recorded in the report.
const FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif`;
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
  .slot { position: absolute; left: 0; width: ${W}px; top: ${BOX_CY}px; transform: translateY(-50%); text-align: center; font-size: 22px; font-weight: 500; color: rgba(255,255,255,0.55); }
`;
// The (optional) title card.
const CARD_CSS = `
    body { background: #000; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
    h1 { font-size: 92px; font-weight: 650; letter-spacing: -1.5px; }
    h2 { margin-top: 22px; font-size: 38px; font-weight: 500; color: rgba(255,255,255,0.72); }
    p { margin-top: 48px; font-size: 24px; font-weight: 600; letter-spacing: 3px; text-transform: uppercase; color: rgba(255,255,255,0.45); }`;
const esc = (t) => String(t ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const card = (h1, h2, p) => `<style>${css}${CARD_CSS}</style>${h1 ? `<h1>${esc(h1)}</h1>` : ''}${h2 ? `<h2>${esc(h2)}</h2>` : ''}${p ? `<p>${esc(p)}</p>` : ''}`;
const dataUri = (rel) => {
  const file = path.resolve(REC, rel);
  const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[path.extname(file).toLowerCase()];
  if (!type) throw new Error(`unsupported asset type ${file}`);
  return `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
};
// Cards (house style): the intro before the first model and the end card after the last. A card is
// an image on the black field with a little type: the title in Crimson Pro (wustep.me's heading
// serif, SIL OFL, vendored in assets/fonts/; compose checks it actually rendered), the subtitle,
// date and link in SF Pro. No box or frame around anything. Layout is absolute and computed here,
// not left to flexbox, so the art lands on exact pixels:
//  - frame layout (intro, `frame: "first-model"`): the image is placed by cardFrame() so its chassis
//    covers the first model's chassis; title + subtitle are centered above that chassis, the date
//    (and any footer) below it;
//  - stack layout (end card): the image centered, an SVG at a whole-number `imageScale` of its own
//    size (or `imageWidth`) on even pixels, then the title and link beneath it, the group centered.
// Image, title, subtitle, date and footer are each rendered as their own layer, so each fades on its
// own schedule (card.fades.<part>).
const TITLE_FONT = 'assets/fonts/crimson-pro-latin-wght-normal.woff2';
const CARD_GAP = { above: 64, below: 52, stack: 64 }; // art to type, px
const CARD_LAYER_CSS = `
    @font-face { font-family: "Crimson Pro"; src: url(${dataUri(TITLE_FONT)}) format("woff2"); font-weight: 200 900; font-style: normal; font-display: block; }
    body { background: #000; }
    body.layer { background: transparent; }
    .card-image { position: absolute; display: block; }
    .card-block { position: absolute; left: 0; width: ${W}px; text-align: center; }
    .card-title { font-family: "Crimson Pro", serif; font-size: 76px; font-weight: 500; line-height: 1; letter-spacing: -0.3px; color: #f6eee2; }
    .card-sub { font-size: 32px; font-weight: 400; line-height: 1.25; letter-spacing: 0; color: rgba(255,255,255,0.7); }
    .card-date { font-size: 21px; font-weight: 600; line-height: 1.2; letter-spacing: 3px; text-transform: uppercase; color: rgba(255,255,255,0.5); }
    .card-link { font-size: 30px; font-weight: 400; line-height: 1.2; letter-spacing: 0.2px; color: rgba(255,255,255,0.64); }
    .card-block > * + * { margin-top: 20px; }
    .hide { visibility: hidden; }`;
const CARD_PARTS = ['image', 'title', 'subtitle', 'date', 'footer'];
const CARD_CLASS = { title: 'card-title', subtitle: 'card-sub', date: 'card-date', footer: 'card-link' };
const even = (v) => 2 * Math.round(v / 2);
const imageSize = (rel) => {
  const file = path.resolve(REC, rel);
  if (/\.svg$/i.test(file)) {
    const head = fs.readFileSync(file, 'utf8').match(/<svg\b[^>]*>/)?.[0] || '';
    const w = Number(/\bwidth="([\d.]+)"/.exec(head)?.[1]), h = Number(/\bheight="([\d.]+)"/.exec(head)?.[1]);
    if (!w || !h) throw new Error(`${rel}: the <svg> needs width and height (its size at 1x)`);
    return { w, h };
  }
  return probe(file);
};
// Placement of a card's parts in px: { img: {src, x, y, w, h, filter}, blocks: [{ parts, top|bottom }] }.
// `typeH` is the stack layout's type block height, measured in the page (cardLayout runs twice).
function cardLayout(C, frame, typeH = 0) {
  const type = (ps) => ps.filter((p) => C[p]);
  if (frame) {
    const c = frame.target;
    return {
      img: { src: dataUri(frame.file), x: frame.x, y: frame.y, w: frame.w, h: frame.h },
      blocks: [{ parts: type(['title', 'subtitle']), bottom: c.y - CARD_GAP.above }, { parts: type(['date', 'footer']), top: c.y + c.h + CARD_GAP.below }],
    };
  }
  const L = { blocks: [] };
  let y = H / 2;
  if (C.image) {
    const nat = imageSize(C.image);
    const scale = C.imageScale ?? (C.imageWidth ? C.imageWidth / nat.w : 1);
    const w = Math.round(nat.w * scale), h = Math.round(nat.h * scale);
    const groupH = h + (typeH ? CARD_GAP.stack + typeH : 0);
    const top = even((H - groupH) / 2);
    // CSS lengths in the filter are at the art's 1x size (the site's), so they scale with it.
    const filter = C.imageFilter ? C.imageFilter.replace(/(-?[\d.]+)px/g, (_, v) => `${+(Number(v) * scale).toFixed(3)}px`) : null;
    L.img = { src: dataUri(C.image), x: even((W - w) / 2), y: top, w, h, scale, filter };
    y = top + h + CARD_GAP.stack;
  }
  L.blocks.push({ parts: type(['title', 'subtitle', 'date', 'footer']), top: C.image ? y : even((H - typeH) / 2) });
  return L;
}
// show = which parts are visible (the rest keep their space, so every layer shares one layout).
const cardHtml = (C, L, show, layer) => {
  const vis = (p) => (show.includes(p) ? '' : ' hide');
  const img = L.img ? `<img class="card-image${vis('image')}" alt="" src="${L.img.src}" style="left:${L.img.x}px;top:${L.img.y}px;width:${L.img.w}px;height:${L.img.h}px${L.img.filter ? `;filter:${L.img.filter}` : ''}">` : '';
  const blocks = L.blocks.filter((b) => b.parts.length).map((b) => `<div class="card-block" style="${b.bottom != null ? `bottom:${H - b.bottom}px` : `top:${b.top}px`}">` +
    b.parts.map((p) => `<div class="${CARD_CLASS[p]}${vis(p)}">${esc(C[p])}</div>`).join('') + '</div>').join('');
  return `<style>${css}${CARD_LAYER_CSS}</style><body class="${layer ? 'layer' : ''}">${img}${blocks}</body>`;
};
// Fade timing per part, seconds into the card: [in at, in for] or [in at, in for, out at, out for].
// Defaults: image first, then the type.
const cardFades = (C) => ({ image: [0, C.fadeIn ?? 1], title: [1.2, 0.8], subtitle: [1.4, 0.8], date: [1.5, 0.8], footer: [1.55, 0.8], ...(C.fades || {}) });

// The instrument's chassis in an RGB frame: the rows more than half lit (any channel > 40), then the
// columns more than half lit between them, so thin protrusions (handles, a drop shadow, the black
// pad around a take) don't count.
function chassisBox(px, w, h) {
  const lit = (x, y) => { const i = (y * w + x) * 3; return Math.max(px[i], px[i + 1], px[i + 2]) > 40; };
  const rows = [];
  for (let y = 0; y < h; y++) { let n = 0; for (let x = 0; x < w; x++) n += lit(x, y); if (n > w / 2) rows.push(y); }
  if (!rows.length) throw new Error('no chassis found');
  const y0 = rows[0], y1 = rows.at(-1), cols = [];
  for (let x = 0; x < w; x++) { let n = 0; for (let y = y0; y <= y1; y++) n += lit(x, y); if (n > (y1 - y0 + 1) / 2) cols.push(x); }
  return { x: cols[0], y: y0, w: cols.at(-1) - cols[0] + 1, h: y1 - y0 + 1 };
}
const rgbFrame = (file, vf, ss = null) => {
  const r = spawnSync(FF, ['-v', 'error', ...(ss != null ? ['-ss', ss.toFixed(4)] : []), '-i', file, '-frames:v', '1', '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(String(r.stderr).slice(-600));
  return r.stdout;
};
// Where the intro's photo goes (`frame: "first-model"`): measure the first filmed model's chassis on
// its first composed frame (the take scaled into the 1800x610 box exactly as below) and the photo's
// own chassis, scale the photo so the two chassis are the same width (Lanczos, written to _work/),
// and center it on the model's chassis. A photo with a different aspect is letterboxed by the black
// field, never shrunk or raised.
function cardFrame(C) {
  if (C.frame !== 'first-model') return null;
  const s = P.segments.find((x) => !S.model(x.model).placeholder);
  const dir = s && S.takeDir(s.model);
  if (!dir || !fs.existsSync(path.join(dir, 'meta.json'))) throw new Error('intro frame "first-model" needs a recorded first model');
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const take = path.join(dir, 'take-video.mp4');
  const { w, h } = probe(take);
  const g = boxFit(w, h);
  const m = chassisBox(rgbFrame(take, `scale=${g.rw}:${g.rh}:flags=lanczos`, s.from - meta.videoStartMidi), g.rw, g.rh);
  const target = { x: g.x + m.x, y: g.y + m.y, w: m.w, h: m.h };
  const src = path.resolve(REC, C.image);
  const nat = probe(src);
  const pc = chassisBox(rgbFrame(src, 'null'), nat.w, nat.h);
  const k = target.w / pc.w;
  const fw = Math.round(nat.w * k), fh = Math.round(nat.h * k);
  const file = path.join(WORK, 'intro-photo.png');
  ff(['-i', src, '-vf', `scale=${fw}:${fh}:flags=lanczos`, '-frames:v', '1', file]);
  const x = Math.round(target.x - pc.x * k), y = Math.round(target.y + target.h / 2 - (pc.y + pc.h / 2) * k);
  const placed = { x: x + Math.round(pc.x * k), y: y + Math.round(pc.y * k), w: Math.round(pc.w * k), h: Math.round(pc.h * k) };
  console.log(`intro frame: ${s.model} chassis ${JSON.stringify(target)}; photo chassis ${JSON.stringify(pc)} of ${nat.w}x${nat.h}, scaled ${k.toFixed(4)} to ${fw}x${fh} at ${x},${y} (chassis ${JSON.stringify(placed)})`);
  return { model: s.model, target, photo: { size: [nat.w, nat.h], chassis: pc }, scale: +k.toFixed(4), file: path.relative(REC, file), x, y, w: fw, h: fh, placed };
}
// A take's frame fitted into the house keyboard box (shared by the picture and cardFrame).
function boxFit(w, h) {
  const sc = Math.min(BOX_W / w, BOX_H / h);
  const rw = Math.round((w * sc) / 2) * 2, rh = Math.round((h * sc) / 2) * 2;
  return { rw, rh, x: Math.round((W - rw) / 2), y: Math.round(BOX_CY - rh / 2) };
}
const CAPTION = `<div class="cap">${cap.title ? `<div class="t">${esc(cap.title)}</div>` : ''}${cap.subtitle ? `<div class="s">${esc(cap.subtitle)}</div>` : ''}${cap.date ? `<div class="d">${esc(cap.date)}</div>` : ''}</div>`;
const FORBIDDEN = /inter|instrument serif|fraunces|bricolage|space grotesk|sora|young serif|bodoni|geist|syne/i;
// Renders a card: the full card (saved next to the film as output/<show>.<name>.png), a check of
// the faces that rendered its type, and one layer per part.
async function renderCard(page, C, name) {
  const layers = [];
  const ready = async () => {
    await page.evaluate(async () => { await document.fonts.load('500 76px "Crimson Pro"'); await document.fonts.ready; });
    await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  };
  const parts = CARD_PARTS.filter((p) => C[p]);
  const frame = cardFrame(C);
  let L = cardLayout(C, frame);
  if (!frame) { // stack: measure the type block, then center art + type as one group
    await page.setContent(cardHtml(C, L, parts, false));
    await ready();
    const typeH = await page.evaluate(() => { const b = [...document.querySelectorAll('.card-block')].at(-1); return b ? b.getBoundingClientRect().height : 0; });
    L = cardLayout(C, null, typeH);
  }
  await page.setContent(cardHtml(C, L, parts, false));
  await ready();
  const layout = {
    image: L.img ? { x: L.img.x, y: L.img.y, w: L.img.w, h: L.img.h, ...(L.img.scale ? { scale: L.img.scale } : {}), ...(L.img.filter ? { filter: L.img.filter } : {}) } : null,
    type: await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.card-block > *')].map((e) => { const r = e.getBoundingClientRect(); return [e.className.replace(/ hide$/, ''), [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]]; }))),
    ...(frame ? { frame } : {}),
  };
  const fullPng = path.join(WORK, `${name}.png`);
  await page.screenshot({ path: fullPng });
  fs.copyFileSync(fullPng, S.output.replace(/\.mp4$/, `.${name}.png`));
  const fonts = {};
  {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
    for (const [k, sel] of Object.entries(CARD_CLASS).map(([p, c]) => [p, `.${c}`])) {
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
      if (nodeId) fonts[k] = (await cdp.send('CSS.getPlatformFontsForNode', { nodeId })).fonts.map((f) => f.familyName);
    }
    await cdp.detach();
  }
  if (Object.keys(fonts).length) console.log(`${name} fonts:`, JSON.stringify(fonts));
  const all = Object.values(fonts).flat();
  if (all.some((f) => FORBIDDEN.test(f))) throw new Error(`a non-house font rendered on the ${name}: ${all.join(', ')}`);
  if (fonts.title && !fonts.title.every((f) => /Crimson Pro/i.test(f))) throw new Error(`${name} title did not render in Crimson Pro: ${fonts.title.join(', ')}`);
  for (const k of ['subtitle', 'date', 'footer']) if (fonts[k] && !fonts[k].some((f) => /SF|System/i.test(f))) console.warn(`warning: ${name} ${k} did not render in SF Pro: ${fonts[k].join(', ')}`);
  // One layer per part: the image on black (it fades in from black), the type on transparent.
  const fades = cardFades(C);
  for (const p of parts) {
    await page.setContent(cardHtml(C, L, [p], p !== 'image'));
    await ready();
    const file = path.join(WORK, `${name}-${p}.png`);
    await page.screenshot({ path: file, omitBackground: p !== 'image' });
    layers.push({ part: p, file, fade: fades[p] || [0, 0] });
  }
  if (!layers.some((l) => l.part === 'image')) layers.unshift({ part: 'black', file: null, fade: [0, 0] });
  return { name, secs: C.secs, layers, fonts, layout, fades: Object.fromEntries(layers.filter((l) => l.file).map((l) => [l.part, l.fade])) };
}

// Adds a rendered card to an ffmpeg graph as [<out>]: the image layer fades in from black, each type
// layer fades in (and out, if its fade has an out) in alpha over it on its own schedule. Returns the
// next input index.
function cardGraph(card, out, vin, graph, idx) {
  let base = null;
  card.layers.forEach((l, i) => {
    let lab = `${out}${i}`;
    if (!l.file) graph.push(`color=c=black:s=${W}x${H}:r=${FPS}:d=${card.secs}[${lab}]`);
    else {
      vin.push('-loop', '1', '-framerate', String(FPS), '-t', String(card.secs), '-i', l.file);
      const [st, d, ost, od] = l.fade;
      const alpha = l.part === 'image' ? '' : ':alpha=1';
      graph.push(`[${idx++}:v]format=rgba${d > 0 ? `,fade=t=in:st=${st}:d=${d}${alpha}` : ''}${od > 0 ? `,fade=t=out:st=${ost}:d=${od}${alpha}` : ''}[${lab}]`);
    }
    if (base) { graph.push(`[${base}][${lab}]overlay=0:0:format=${PIX}[${out}o${i}]`); lab = `${out}o${i}`; }
    base = lab;
  });
  graph.push(`[${base}]format=${PIX},setsar=1,trim=end_frame=${Math.round(card.secs * FPS)}[${out}]`);
  return idx;
}

// --cards: render just the intro and end card (their layers, full-card PNGs and card-only clips in
// .takes/<show>/_work/<card>-preview.mp4) without takes, to look at them on their own.
if (process.argv.includes('--cards')) {
  if (!INTRO_SECS && !END_SECS) throw new Error('the show has no intro or endCard');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  for (const [C, name] of [[INTRO, 'intro'], [END, 'end-card']]) {
    if (!C?.secs) continue;
    const card = await renderCard(page, C, name);
    const vin = [], graph = [];
    cardGraph(card, 'vc', vin, graph, 0);
    graph.push(`[vc]${TO_VIDEO}[vcv]`);
    const clip = path.join(WORK, `${name}-preview.mp4`);
    ff([...vin, '-filter_complex', graph.join(';'), '-map', '[vcv]', '-t', String(card.secs), '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-r', String(FPS), '-pix_fmt', 'yuv420p', ...VIDEO_TAGS, clip]);
    console.log(`${name}:`, S.output.replace(/\.mp4$/, `.${name}.png`), clip);
  }
  await browser.close();
  process.exit(0);
}

const segs = P.segments.map((s, k) => {
  const seg = { ...s, k, first: k === 0, last: k === P.segments.length - 1, placeholder: S.model(s.model).placeholder };
  // A placeholder that already has a take means the loader lost sight of its run or preview
  // (usually STAGEBENCH_EXTRA_CHECKOUTS unset); filming "Take pending" over a real take is never wanted.
  if (seg.placeholder && fs.existsSync(path.join(S.takeDir(s.model), 'prep.json'))) throw new Error(`${s.model} has a recorded take but is a placeholder here (${seg.placeholder}); set STAGEBENCH_EXTRA_CHECKOUTS (README "Dropping in GPT 6.2")`);
  if (seg.placeholder) return seg;
  const dir = S.takeDir(s.model);
  if (!fs.existsSync(path.join(dir, 'prep.json'))) throw new Error(`${s.model}: no prepped take in ${dir}; record it with make.mjs --models ${s.model}`);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  if (meta.segment?.bars?.join() !== s.bars.join()) throw new Error(`${s.model}: take covers bars ${meta.segment?.bars?.join('-')}, plan needs ${s.bars.join('-')}; re-record it`);
  const { w, h } = probe(path.join(dir, 'take-video.mp4'));
  return { ...seg, dir, meta, ...boxFit(w, h) };
});
const filmed = segs.filter((s) => !s.placeholder);
if (!filmed.length) throw new Error('no filmed models yet; record some first');
for (const s of segs) if (s.placeholder) console.log(`placeholder: ${s.model} bars ${s.bars.join('-')} (${s.placeholder})`);

// --- 1. Timeline audio (t=0 is plan.t0; it runs to plan.audioEnd, past the last picture by ringOut). ---
const tlDur = P.audioEnd - P.t0;
const inputs = [], chains = [];
filmed.forEach((s, i) => {
  inputs.push('-i', path.join(s.dir, 'take-audio.wav'));
  const from = s.first ? s.audioFrom : s.audioFrom - XF;
  const to = s.last ? P.audioEnd : s.audioTo;
  const a = from - s.meta.videoStartMidi, b = to - s.meta.videoStartMidi;
  let c = `[${i}:a]atrim=start=${a.toFixed(5)}:end=${b.toFixed(5)},asetpts=PTS-STARTPTS`;
  if (!s.first) c += `,afade=t=in:d=${XF}:curve=qsin`;
  if (!s.last) c += `,afade=t=out:st=${(b - a - XF).toFixed(5)}:d=${XF}:curve=qsin`;
  c += `,adelay=${Math.round((from - P.t0) * 1000)}:all=1[s${i}]`;
  chains.push(c);
});
const mixed = path.join(WORK, 'timeline-premaster.wav');
// apad needs whole_dur and the output needs -t: a bare apad pads forever (it once wrote ~1 TB).
ff([...inputs, '-filter_complex', chains.join(';') + ';' + filmed.map((_, i) => `[s${i}]`).join('') +
  `amix=inputs=${filmed.length}:normalize=0:duration=longest,apad=whole_dur=${tlDur.toFixed(5)},atrim=duration=${tlDur.toFixed(5)}`,
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
// Placeholder blocks are silent: not measured, not in the median, never nudged.
const blocks = P.blocks.map((b) => (segs[b.seg].placeholder ? { ...b, placeholder: true, I: null } : { ...b, I: blockLoud(b.from, b.to) }));
const sorted = blocks.filter((b) => !b.placeholder).map((b) => b.I).sort((x, y) => x - y);
const median = sorted[Math.floor(sorted.length / 2)];
for (const b of blocks) {
  if (b.placeholder) { b.nudgeDb = 0; continue; }
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
    const to = last ? (b.seg === segs.length - 1 ? P.audioEnd : segs[b.seg].audioTo) : blocks[i + 1].from;
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
console.log('leveling (median ' + median.toFixed(1) + ' LUFS): ' + blocks.map((b) => b.placeholder ? `${b.model} ${b.bars.join('-')} placeholder` : `${b.model} ${b.bars.join('-')} ${b.I.toFixed(1)}${b.nudgeDb ? ` ${b.nudgeDb > 0 ? '+' : ''}${b.nudgeDb.toFixed(1)}dB` : ''}`).join(' | '));

const pre = loudness(mixed);
const makeup = TARGET_LUFS - pre.I;
const master = path.join(WORK, 'timeline-master.wav');
// Ring-out: when the audio runs past the last picture (ringOut) or the picture dissolves into the
// end card, the tail fades out from the start of that dissolve to the end of the audio.
const tailFrom = P.end - XF_END - P.t0;
const tailFade = tlDur - tailFrom > 0.05 && (XF_END > 0 || P.audioEnd > P.end) ? `,afade=t=out:st=${tailFrom.toFixed(5)}:d=${(tlDur - tailFrom).toFixed(5)}:curve=qsin` : '';
ff(['-i', mixed, '-af', `volume=${makeup.toFixed(2)}dB,alimiter=limit=${Math.pow(10, LIMIT_DBFS / 20).toFixed(4)}:attack=1:release=80:level=disabled:asc=1${tailFade}`,
  '-t', tlDur.toFixed(5), '-c:a', 'pcm_f32le', master]);
// What the limiter actually did, per turn: the gain reduction it applied, measured as the stereo
// peak (either channel, as the limiter sees it) of the master against the premaster with make-up,
// in 10 ms blocks, aligned for the limiter's lookahead. (A mono fold-down overstates it for
// correlated pianos and misses it on wide ones.) pctLimited: share of the turn's sounding blocks
// reduced by more than 0.25 dB; maxDb: the deepest reduction.
const stereo = (file) => { const b = spawnSync(FF, ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-'], { maxBuffer: 1 << 30 }).stdout; return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const preS = stereo(mixed), masS = stereo(master);
const lin = Math.pow(10, makeup / 20), blk = Math.round(0.01 * SR);
const lag = (() => { // lookahead latency in samples: best match over the loudest second
  let at = 0, pk = 0;
  for (let i = 0; i < preS.length / 2; i += SR / 10) { let m = 0; for (let j = i; j < Math.min(i + SR / 10, preS.length / 2); j++) m = Math.max(m, Math.abs(preS[2 * j])); if (m > pk) { pk = m; at = i; } }
  const a = Math.max(0, at - SR / 2), b = Math.min(preS.length / 2 - SR, a + SR);
  let best = -Infinity, bl = 0;
  for (let l = 0; l < Math.round(0.02 * SR); l++) { let s = 0; for (let j = a; j < b; j++) s += preS[2 * j] * masS[2 * (j + l)]; if (s > best) { best = s; bl = l; } }
  return bl;
})();
const limiter = segs.map((s) => {
  let n = 0, over3 = 0, max = 0, tot = 0;
  const stop = Math.round((Math.min(s.to, P.end - XF_END) - P.t0) * SR); // not into the ring-out fade
  for (let i = Math.round((s.from - P.t0) * SR); i + blk < stop && 2 * (i + blk + lag) < masS.length; i += blk) {
    let pp = 0, pm = 0;
    for (let j = i; j < i + blk; j++) { pp = Math.max(pp, Math.abs(preS[2 * j]), Math.abs(preS[2 * j + 1])); pm = Math.max(pm, Math.abs(masS[2 * (j + lag)]), Math.abs(masS[2 * (j + lag) + 1])); }
    if (pp * lin < 0.03) continue; // below -30 dBFS: nothing for the limiter to do
    const gr = 20 * Math.log10((pp * lin) / (pm + 1e-12)); tot++;
    if (gr > 0.25) { n++; if (gr > 3) over3++; }
    max = Math.max(max, gr);
  }
  return { model: s.model, ...(s.placeholder ? { placeholder: true } : {}), pctLimited: tot ? +((100 * n) / tot).toFixed(1) : 0, windowsOver3dB: over3, maxDb: +Math.max(0, max).toFixed(1) };
});
console.log(`limiter lookahead ${lag} samples`);
console.log('timeline', tlDur.toFixed(3) + 's premaster', JSON.stringify(pre), `makeup ${makeup.toFixed(2)} dB`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: W, height: H } });
// Which platform fonts render the house type (should be SF Pro / the macOS system font only).
const fontsUsed = await (async () => {
  await page.setContent(`<style>${css}</style><div class="card"><div class="rank"><span class="num">#1</span><span class="on">on StageBench</span><span class="new">NEW</span></div><div class="name">Model</div></div>${CAPTION}<div class="slot">Take pending</div><h1>T</h1><h2>S</h2><p>F</p>`);
  await page.evaluate(() => document.fonts.ready);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const used = new Set();
  for (const sel of ['.num', '.on', '.new', '.name', '.cap .t', '.cap .s', '.cap .d', '.slot', 'h1', 'h2', 'p']) {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
    if (!nodeId) continue;
    for (const f of (await cdp.send('CSS.getPlatformFontsForNode', { nodeId })).fonts) used.add(f.familyName);
  }
  await cdp.detach();
  return [...used];
})();
console.log('fonts used:', fontsUsed.join(', '));
if (fontsUsed.some((f) => FORBIDDEN.test(f))) throw new Error(`a non-house font rendered: ${fontsUsed.join(', ')}`);
if (!fontsUsed.some((f) => /SF|System/i.test(f))) console.warn('warning: SF Pro did not render (not on macOS?); type will not match the house style');
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
let slotPng = null;
if (segs.some((s) => s.placeholder)) {
  await page.setContent(`<style>${css}</style><div class="slot">Take pending</div>`);
  await page.evaluate(() => document.fonts.ready);
  slotPng = path.join(WORK, 'placeholder-slot.png');
  await page.screenshot({ path: slotPng, omitBackground: true });
}
let title = null;
if (!INTRO_SECS && TITLE_SECS > 0) {
  await page.setContent(card(cap.title, cap.subtitle, cap.date));
  await page.evaluate(() => document.fonts.ready);
  title = path.join(WORK, 'title.png');
  await page.screenshot({ path: title });
}
const introCard = INTRO_SECS > 0 ? await renderCard(page, INTRO, 'intro') : null;
const endCard = END_SECS > 0 ? await renderCard(page, END, 'end-card') : null;
await browser.close();

// --- 3. Picture: each model's bars full width; hard cuts (the intro may dissolve into the first). ---
const vin = [], graph = [];
let idx = 0;
if (introCard) idx = cardGraph(introCard, 'v0', vin, graph, idx);
else if (title) {
  vin.push('-loop', '1', '-framerate', String(FPS), '-t', String(TITLE_SECS), '-i', title);
  graph.push(`[${idx++}:v]format=${PIX},setsar=1[v0]`);
}
const xfIn = introCard && XF_IN > 0 && !segs[0].placeholder ? XF_IN : 0;
segs.forEach((s, i) => {
  // With an intro crossfade the first turn's picture starts xfIn early, under the dissolve.
  const pre = i === 0 ? xfIn : 0;
  const D = s.to - s.from + pre;
  const oi = idx++;
  vin.push('-loop', '1', '-framerate', String(FPS), '-t', D.toFixed(5), '-i', overlays[i]);
  graph.push(`color=c=black:s=${W}x${H}:r=${FPS}:d=${D.toFixed(5)},format=${PIX}[bg${i}]`);
  if (s.placeholder) {
    const si = idx++;
    vin.push('-loop', '1', '-framerate', String(FPS), '-t', D.toFixed(5), '-i', slotPng);
    graph.push(`[bg${i}][${si}:v]overlay=0:0:format=${PIX}[c${i}]`);
  } else {
    const vi = idx++;
    vin.push('-i', path.join(s.dir, 'take-video.mp4'));
    graph.push(`[${vi}:v]trim=start=${(s.from - pre - s.meta.videoStartMidi).toFixed(5)}:duration=${D.toFixed(5)},setpts=PTS-STARTPTS,scale=${s.rw}:${s.rh}:flags=lanczos[p${i}]`);
    graph.push(`[bg${i}][p${i}]overlay=${s.x}:${s.y}:format=${PIX}[c${i}]`);
  }
  graph.push(`[c${i}][${oi}:v]overlay=0:0:format=${PIX},format=${PIX},setsar=1,trim=end_frame=${Math.round(D * FPS)}[v${i + 1}]`);
});
const parts = Array.from({ length: segs.length + 1 }, (_, i) => `v${i}`).filter((v) => v !== 'v0' || title || introCard);
if (xfIn) { // the intro's last xfIn seconds dissolve into the first turn
  graph.push(`[v0]fps=${FPS},settb=AVTB[v0t]`, `[v1]fps=${FPS},settb=AVTB[v1t]`);
  graph.push(`[v0t][v1t]xfade=transition=fade:duration=${xfIn.toFixed(5)}:offset=${(INTRO_SECS - xfIn).toFixed(5)}[vin]`);
  parts.splice(0, 2, 'vin');
}
// Film time: the intro (or title card) runs TITLE_SECS, then the turns' pictures from the first
// turn's `from`; the end card follows, dissolving in over the last XF_END seconds of the last turn.
const picEnd = TITLE_SECS + (P.end - P.segments[0].from); // film time the last turn's picture ends
const endAt = picEnd - XF_END; // film time the end card starts (its crossfade's first frame)
const total = endAt + END_SECS;
if (endCard && XF_END > 0) {
  idx = cardGraph(endCard, 'vend', vin, graph, idx);
  graph.push(`${parts.map((v) => `[${v}]`).join('')}concat=n=${parts.length}:v=1:a=0,fps=${FPS},settb=AVTB[vmain]`);
  graph.push(`[vend]fps=${FPS},settb=AVTB[vendt]`);
  graph.push(`[vmain][vendt]xfade=transition=fade:duration=${XF_END.toFixed(5)}:offset=${endAt.toFixed(5)}[vcat]`);
} else {
  if (endCard) { idx = cardGraph(endCard, 'vend', vin, graph, idx); parts.push('vend'); }
  graph.push(`${parts.map((v) => `[${v}]`).join('')}concat=n=${parts.length}:v=1:a=0[vcat]`);
}
// Caption: on with the first model (after any intro, dissolving in with it), fully visible, then
// fades out and is gone by fadeOut[1] seconds into the music.
const [capFadeStart, capGone] = cap.fadeOut || [3.5, 5];
const capAt = TITLE_SECS - xfIn;
graph.push(`[${idx}:v]format=rgba${xfIn ? `,fade=t=in:st=0:d=${xfIn.toFixed(5)}:alpha=1` : ''},fade=t=out:st=${(capFadeStart + xfIn).toFixed(5)}:d=${(capGone - capFadeStart).toFixed(3)}:alpha=1${capAt ? `,setpts=PTS+${capAt.toFixed(5)}/TB` : ''}[cap]`);
graph.push(`[vcat][cap]overlay=0:0:eof_action=pass:format=${PIX},${TO_VIDEO}[v]`);
vin.push('-loop', '1', '-framerate', String(FPS), '-t', String(capGone + xfIn + 0.5), '-i', captionPng);
idx++;
// The timeline audio starts at MUSIC_AT: the intro's length, less any idle + pickup it carries.
graph.push(`[${idx}:a]${MUSIC_AT > 0 ? `adelay=${Math.round(MUSIC_AT * SR)}S:all=1,` : ''}apad=whole_dur=${total.toFixed(5)}[a]`);
vin.push('-i', master);
ff([...vin, '-filter_complex', graph.join(';'), '-map', '[v]', '-map', '[a]', '-t', total.toFixed(5),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-r', String(FPS), '-pix_fmt', 'yuv420p', '-profile:v', 'high', ...VIDEO_TAGS, '-movflags', '+faststart',
  '-c:a', 'aac', '-b:a', '256k', '-ar', String(SR), S.output]);

const film = (t) => +(TITLE_SECS + t - P.segments[0].from).toFixed(3); // MIDI time -> film time
const lastSeg = P.segments.at(-1);
const report = {
  show: S.name, file: path.relative(process.cwd(), S.output), duration: duration(S.output), loudness: loudness(S.output),
  // musicStart: the timeline's t0 (idle before the first note); firstNoteAt: the first note (with
  // pickupInIntro, under the intro); pictureStart: the cut into the first turn; musicEnd: the end of
  // the last turn's picture; audioEnd: the end of its ring-out under the end card.
  musicStart: +MUSIC_AT.toFixed(3), firstNoteAt: film(P.segments[0].playStart), pictureStart: TITLE_SECS, musicEnd: +picEnd.toFixed(3), audioEnd: film(P.audioEnd),
  finalChord: P.finalHold ? { struckAt: film(P.finalHold.from), releasedAt: film(P.finalRelease), hold: +(P.finalRelease - P.finalHold.from).toFixed(3),
    pictureAfterStrike: +(endAt - film(P.finalHold.from)).toFixed(3), pictureAfterRelease: +(endAt - film(P.finalRelease)).toFixed(3) } : null,
  intro: introCard ? { from: 0, secs: INTRO_SECS, artwork: INTRO.image ?? null, title: INTRO.title ?? null, subtitle: INTRO.subtitle ?? null, date: INTRO.date ?? null, footer: INTRO.footer ?? null,
    underIntro: LEAD > 0 ? { from: +MUSIC_AT.toFixed(3), firstNote: film(P.segments[0].playStart), note: 'the first model\'s idle and pickup play under the intro' } : null,
    dissolve: xfIn ? { from: +(INTRO_SECS - xfIn).toFixed(3), secs: +xfIn.toFixed(3), note: 'the intro dissolves into the first turn, which is fully up on its downbeat' } : null,
    fades: introCard.fades, fonts: introCard.fonts, layout: introCard.layout, image: path.relative(process.cwd(), S.output.replace(/\.mp4$/, '.intro.png')) } : null,
  endCard: endCard ? { from: +endAt.toFixed(3), secs: END_SECS, crossfade: +XF_END.toFixed(3), artwork: END.image ?? null, title: END.title, subtitle: END.subtitle ?? null, footer: END.footer,
    fades: endCard.fades, fonts: endCard.fonts, layout: endCard.layout, image: path.relative(process.cwd(), S.output.replace(/\.mp4$/, '.end-card.png')) } : null,
  video: { pixFmt: 'yuv420p', profile: 'high', colorRange: 'tv', matrix: 'bt709', primaries: 'bt709', transfer: 'iec61966-2-1 (sRGB)', chroma: 'area (composited in RGB, converted once)' },
  fonts: fontsUsed, makeupDb: +makeup.toFixed(2), limiterLookaheadSamples: lag, limiter, leveling: { ...LV, medianLufs: median, blocks: blocks.map((b) => ({ model: b.model, bars: b.bars, ...(b.placeholder ? { placeholder: true } : { lufs: b.I }), nudgeDb: +b.nudgeDb.toFixed(2) })) },
  timeline: segs.map((s) => {
    const m = S.model(s.model);
    // visibleSecs: on screen alone (the last turn's dissolve into the end card is not counted, nor
    // the first turn's dissolve in from the intro). cutOffsetMs: the cut into the turn against its
    // downbeat (negative: the picture leads the audio; plan cutSlack).
    const at = { model: s.model, label: m.label, rank: m.rank, score: m.score, bars: s.bars,
      filmFrom: film(s.from), filmTo: film(s.to), secs: s.secs, visibleSecs: +(s.to - s.from - (s.model === lastSeg.model && endCard ? XF_END : 0)).toFixed(3),
      ...(s.cutOffsetMs != null ? { cutOffsetMs: s.cutOffsetMs } : {}), ...(s.cutShift ? { cutShiftFrames: s.cutShift } : {}) };
    if (s.placeholder) return { ...at, placeholder: s.placeholder };
    return { ...at,
      prep: JSON.parse(fs.readFileSync(path.join(s.dir, 'prep.json'), 'utf8')),
      take: { setup: s.meta.setup, miss: s.meta.miss, missed: s.meta.missed, schedLateMs: s.meta.schedLateMs, quantizeVelocity: s.meta.quantizeVelocity } };
  }),
};
fs.writeFileSync(S.output.replace(/\.mp4$/, '.report.json'), JSON.stringify(report, null, 1));
console.log('wrote', S.output, report.duration.toFixed(3) + 's', JSON.stringify(report.loudness));
for (const t of report.timeline) console.log(`  ${t.filmFrom.toFixed(2).padStart(6)}–${t.filmTo.toFixed(2).padStart(6)}  ${t.visibleSecs.toFixed(2)} s  bars ${t.bars.join('–').padEnd(8)} ${t.rank ? `#${t.rank}` : 'NEW'}  ${t.label}${t.cutShiftFrames ? `  (cut moved ${t.cutShiftFrames > 0 ? '+' : ''}${t.cutShiftFrames} frame: ${t.cutOffsetMs > 0 ? '+' : ''}${t.cutOffsetMs} ms off its downbeat)` : ''}${t.placeholder ? '  (placeholder)' : ''}`);
if (report.finalChord) console.log('final chord', JSON.stringify(report.finalChord));
if (report.endCard) console.log(`end card from ${report.endCard.from} s, crossfade ${report.endCard.crossfade} s, fades ${JSON.stringify(report.endCard.fades)}`);
console.log('limiter', JSON.stringify(limiter));
