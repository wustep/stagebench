/**
 * Key a product photo shot on a white studio background onto black, for the end card.
 *
 *   node scripts/key-photo.mjs --in nord-stage-4-wustep-me.png --out assets/nord-stage-4-on-black.png [--width 1280]
 *
 * The source is the Nord Stage 4 photo from wustep.me (11600x3866 PNG, ~19 MB). It stays out of
 * git; only the keyed result is committed. Node + ffmpeg only (no image libraries):
 *
 *  1. find the subject's bounding box on a small decode, then decode just that region (plus a
 *     margin of background) at 2x the output width with Lanczos;
 *  2. background = everything reachable from the image border through near-white pixels (a flood
 *     fill, so the light-gray white keys, which the red cheeks and the black front rail enclose,
 *     are never touched);
 *  3. edge band (the few pixels next to the background): each pixel is unmixed against the
 *     nearest solid subject pixel F: alpha = projection of (white - C) onto (white - F), color F.
 *     That removes the white the anti-aliasing mixed in, so there is no halo, fringe or gray matte;
 *  4. composite onto pure black (premultiplied: alpha x color), downscale 2:1 with Lanczos (correct
 *     on an opaque image), crop to the subject, write an opaque RGB PNG.
 * Prints a fringe check: how many output pixels on the subject's outline are light and unsaturated
 * (leftover white), which should be ~0.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { argv, REC } from './lib/show.mjs';

const FF = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
const inPath = path.resolve(REC, argv('in', 'nord-stage-4-wustep-me.png'));
const outPath = path.resolve(REC, argv('out', 'assets/nord-stage-4-on-black.png'));
const OUT_W = Number(argv('width', 1280));
const BG_T = 10; // a pixel within 10/255 of the background color (every channel) can be background
const BAND = 4; // edge band width at the working scale (2x output)

const [srcW, srcH] = spawnSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', inPath], { encoding: 'utf8' })
  .stdout.trim().split(',').map(Number);
if (!srcW) throw new Error(`cannot read ${inPath}`);
const decode = (vf, w, h) => {
  const r = spawnSync(FF, ['-v', 'error', '-i', inPath, '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0 || r.stdout.length !== w * h * 3) throw new Error(`decode failed: ${String(r.stderr).slice(-400)}`);
  return r.stdout;
};

// Background color: per-channel median of the border.
function borderMedian(px, w, h) {
  const ch = [[], [], []];
  const add = (x, y) => { const i = (y * w + x) * 3; for (let c = 0; c < 3; c++) ch[c].push(px[i + c]); };
  for (let x = 0; x < w; x++) { add(x, 0); add(x, h - 1); }
  for (let y = 0; y < h; y++) { add(0, y); add(w - 1, y); }
  return ch.map((v) => v.sort((a, b) => a - b)[v.length >> 1]);
}
// Flood fill from the border through near-background pixels. Returns a Uint8Array mask (1 = bg).
function floodBackground(px, w, h, bg) {
  const near = (i) => Math.max(bg[0] - px[i * 3], bg[1] - px[i * 3 + 1], bg[2] - px[i * 3 + 2], px[i * 3] - bg[0], px[i * 3 + 1] - bg[1], px[i * 3 + 2] - bg[2]) < BG_T;
  const m = new Uint8Array(w * h), q = new Int32Array(w * h);
  let head = 0, tail = 0;
  const push = (i) => { if (!m[i] && near(i)) { m[i] = 1; q[tail++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (head < tail) {
    const i = q[head++], x = i % w, y = (i / w) | 0;
    if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (y > 0) push(i - w); if (y < h - 1) push(i + w);
  }
  return m;
}
const bbox = (m, w, h) => {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!m[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
};

// 1. Subject box on a small decode.
const sw = Math.round(srcW / 8), sh = Math.round(srcH / 8);
const small = decode(`scale=${sw}:${sh}:flags=area`, sw, sh);
const sb = bbox(floodBackground(small, sw, sh, borderMedian(small, sw, sh)), sw, sh);
const fx = srcW / sw, fy = srcH / sh;
const subW = (sb.x1 - sb.x0 + 1) * fx;
const margin = Math.round(subW * 0.01);
const cx0 = Math.max(0, Math.floor(sb.x0 * fx) - margin), cy0 = Math.max(0, Math.floor(sb.y0 * fy) - margin);
const cx1 = Math.min(srcW, Math.ceil((sb.x1 + 1) * fx) + margin), cy1 = Math.min(srcH, Math.ceil((sb.y1 + 1) * fy) + margin);
const scale = (2 * OUT_W) / subW;
const W = Math.round((cx1 - cx0) * scale), H = Math.round((cy1 - cy0) * scale);
const px = decode(`crop=${cx1 - cx0}:${cy1 - cy0}:${cx0}:${cy0},scale=${W}:${H}:flags=lanczos`, W, H);

// 2. Background.
const bg = borderMedian(px, W, H);
const B = floodBackground(px, W, H, bg);
const N = W * H;
// Distance (8-connected steps) from the background, up to BAND + 1.
const dist = new Uint8Array(N).fill(255);
{
  const q = new Int32Array(N);
  let head = 0, tail = 0;
  for (let i = 0; i < N; i++) if (B[i]) { dist[i] = 0; q[tail++] = i; }
  while (head < tail) {
    const i = q[head++], d = dist[i];
    if (d > BAND) continue;
    const x = i % W, y = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (dist[j] > d + 1) { dist[j] = d + 1; q[tail++] = j; }
    }
  }
}

// 3. Unmix the edge band, 4. composite on black (premultiplied).
const out = Buffer.alloc(N * 3);
const R = 8;
let unmixed = 0, noSolid = 0;
for (let i = 0; i < N; i++) {
  if (B[i]) continue; // background -> black
  const C = [px[i * 3], px[i * 3 + 1], px[i * 3 + 2]];
  if (dist[i] > BAND) { out[i * 3] = C[0]; out[i * 3 + 1] = C[1]; out[i * 3 + 2] = C[2]; continue; }
  const x = i % W, y = (i / W) | 0;
  let best = -1, bestD = Infinity;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const j = ny * W + nx;
    if (dist[j] <= BAND) continue;
    const dd = dx * dx + dy * dy;
    if (dd < bestD) { bestD = dd; best = j; }
  }
  let F = C, a = 1;
  if (best >= 0) {
    F = [px[best * 3], px[best * 3 + 1], px[best * 3 + 2]];
    const u = [bg[0] - C[0], bg[1] - C[1], bg[2] - C[2]], v = [bg[0] - F[0], bg[1] - F[1], bg[2] - F[2]];
    const vv = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
    if (vv > 400) a = Math.max(0, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / vv));
    // Nearly opaque: keep the pixel's own color (texture, highlights); otherwise the unmixed one.
    if (a > 0.97) F = C;
    unmixed++;
  } else noSolid++;
  for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(a * F[c]);
}

// Crop box (subject, at the working scale) and the 2:1 Lanczos downscale.
const box = bbox(B, W, H);
const pad = 4;
const bx = Math.max(0, box.x0 - pad) & ~1, by = Math.max(0, box.y0 - pad) & ~1;
const bw = (Math.min(W, box.x1 + 1 + pad) - bx) & ~1, bh = (Math.min(H, box.y1 + 1 + pad) - by) & ~1;
fs.mkdirSync(path.dirname(outPath), { recursive: true });
const enc = spawnSync(FF, ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', '-',
  '-vf', `crop=${bw}:${bh}:${bx}:${by},scale=${bw / 2}:${bh / 2}:flags=lanczos`, '-frames:v', '1', '-pix_fmt', 'rgb24', outPath], { input: out, maxBuffer: 1 << 30 });
if (enc.status !== 0) throw new Error(String(enc.stderr).slice(-600));

// Fringe check at the working scale: subject pixels on the outer silhouette (next to the keyed-out
// background) whose composite is light and unsaturated would be leftover white.
let outline = 0, light = 0, lightest = 0;
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
  const i = y * W + x;
  if (B[i] || ![i - 1, i + 1, i - W, i + W].some((j) => B[j])) continue;
  outline++;
  const r = out[i * 3], g = out[i * 3 + 1], b = out[i * 3 + 2];
  lightest = Math.max(lightest, Math.min(r, g, b));
  if (Math.min(r, g, b) > 150 && Math.max(r, g, b) - Math.min(r, g, b) < 30) light++;
}
const ow = bw / 2, oh = bh / 2;
const res = spawnSync(FF, ['-v', 'error', '-i', outPath, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 }).stdout;
const lum = (i) => (res[i * 3] + res[i * 3 + 1] + res[i * 3 + 2]) / 3;
let maxCorner = 0;
for (const [x, y] of [[0, 0], [ow - 1, 0], [0, oh - 1], [ow - 1, oh - 1]]) maxCorner = Math.max(maxCorner, lum(y * ow + x));
console.log(`source ${srcW}x${srcH}, background rgb(${bg.join(',')}); subject crop ${cx1 - cx0}x${cy1 - cy0} at ${cx0},${cy0}; keyed at ${W}x${H}`);
console.log(`edge band ${unmixed} px unmixed (${noSolid} with no solid neighbour); wrote ${path.relative(process.cwd(), outPath)} ${ow}x${oh}`);
console.log(`fringe check: ${light} light/gray of ${outline} silhouette px (should be ~0; brightest min-channel ${lightest}); corner luminance ${maxCorner.toFixed(1)} (black field = 0)`);
