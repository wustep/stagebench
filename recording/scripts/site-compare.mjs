/**
 * Side-by-side of the end card's keyboard art against the live wustep.me StageBench card.
 *
 *   node scripts/site-compare.mjs --show shows/<name>.json --frame <end-card frame png> --out <png>
 *
 * Needs the network (it opens https://wustep.me in the site's default light theme). Left: a tight
 * crop of the site's StageBench SVG on its card, screenshotted at a device scale factor equal to the
 * end card's imageScale, so both panels show the art at the same pixel size. Right: the same-size
 * crop around the art in --frame, a frame decoded from the film (qa.mjs --grabs writes
 * end-card-faded-in.png). Below each, the body red sampled from that panel. Read-only on the site.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { loadShow, argv, REC } from './lib/show.mjs';

const FF = process.env.FFMPEG || 'ffmpeg';
const S = loadShow(argv('show'));
const report = JSON.parse(fs.readFileSync(S.output.replace(/\.mp4$/, '.report.json'), 'utf8'));
const art = report.endCard?.layout?.image;
if (!art?.scale) throw new Error('the report has no end card art layout (compose first)');
const framePng = path.resolve(process.cwd(), argv('frame'));
const out = path.resolve(process.cwd(), argv('out'));
const SITE = 'https://wustep.me/';
const SEL = 'a[href="/playground/stagebench"] svg';
const M = 7; // margin around the art, CSS px at 1x (holds the site shadow; clears the end card title)
const k = art.scale;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: k, colorScheme: 'light' });
const page = await ctx.newPage();
await page.goto(SITE, { waitUntil: 'networkidle', timeout: 60000 });
const svg = page.locator(SEL).first();
await svg.scrollIntoViewIfNeeded();
await page.mouse.move(0, 0); // no hover: the art's idle pose
await page.waitForTimeout(800);
const site = await page.evaluate((sel) => {
  const e = document.querySelector(sel), cs = getComputedStyle(e);
  return { theme: document.body.className, filter: cs.filter, size: [cs.width, cs.height], body: getComputedStyle(e.querySelector('rect')).fill };
}, SEL);
const r = await svg.boundingBox();
const siteCrop = path.join(S.workDir, 'site-svg.png');
await page.screenshot({ path: siteCrop, clip: { x: r.x - M, y: r.y - M, width: r.width + 2 * M, height: r.height + 2 * M } });
await ctx.close();

// The same crop from the film frame (art box from the report, margin scaled like the site's).
const cw = Math.round((r.width + 2 * M) * k), ch = Math.round((r.height + 2 * M) * k);
const filmCrop = path.join(S.workDir, 'film-svg.png');
const run = (args) => { const p = spawnSync(FF, ['-v', 'error', '-y', ...args], { maxBuffer: 1 << 28 }); if (p.status !== 0) throw new Error(String(p.stderr)); return p.stdout; };
run(['-i', framePng, '-vf', `crop=${cw}:${ch}:${art.x - M * k}:${art.y - M * k}`, filmCrop]);
// Body red: a point on the body between the screen and the first knob (art units 80, 9.5).
const px = (file, x, y) => [...run(['-i', file, '-vf', `crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])];
const at = [Math.round((M + 80) * k), Math.round((M + 9.5) * k)];
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
const siteRed = px(siteCrop, ...at), filmRed = px(filmCrop, ...at);

const uri = (f) => `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`;
const page2 = await browser.newPage({ viewport: { width: 2 * cw + 3 * 48, height: ch + 200 }, deviceScaleFactor: 1 });
await page2.setContent(`<style>
  * { margin: 0; box-sizing: border-box; }
  body { background: #2a2a2a; font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; -webkit-font-smoothing: antialiased; color: #eee; padding: 48px; display: flex; gap: 48px; }
  figure img { display: block; width: ${cw}px; height: ${ch}px; }
  figcaption { margin-top: 18px; font-size: 22px; line-height: 1.4; color: rgba(255,255,255,0.8); }
  figcaption b { font-weight: 600; color: #fff; }
  .sw { display: inline-block; width: 18px; height: 18px; vertical-align: -3px; margin-right: 6px; border-radius: 3px; }
</style>
<figure><img src="${uri(siteCrop)}"><figcaption><b>wustep.me, live</b> (light theme), StageBench card SVG at ${k}× device scale<br>
<span class="sw" style="background:${hex(siteRed)}"></span>body ${hex(siteRed)} · CSS fill ${site.body} · filter ${site.filter}</figcaption></figure>
<figure><img src="${uri(filmCrop)}"><figcaption><b>End card</b>, frame decoded from ${path.basename(S.output)}, art at ${k}× (${art.w}×${art.h} at ${art.x},${art.y})<br>
<span class="sw" style="background:${hex(filmRed)}"></span>body ${hex(filmRed)} · ${art.filter ? `filter ${art.filter}` : 'no filter'}</figcaption></figure>`);
fs.mkdirSync(path.dirname(out), { recursive: true });
await page2.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(JSON.stringify({ site, siteRed: hex(siteRed), filmRed: hex(filmRed), crop: [cw, ch], out: path.relative(REC, out) }));
