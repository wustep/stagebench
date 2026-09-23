/**
 * Probe a preview before adding it to models.json. Prints what matters for capture and a suggested
 * fixture entry. Never trust a suggestion blindly: read the audit lines.
 *
 *   node scripts/probe.mjs --model <run-id> [--base https://stagebench.vercel.app/previews] [--stage 3]
 *
 * Checks, each with a hard timeout (some previews never go network-idle or stall their main thread):
 *  1. instrument element + keybed (data-note / data-midi, numeric range; a 73-key Stage is E1-E7 = 28-100)
 *  2. layout: instrument CSS width at 2560 vs 1600 px viewports -> fluid or fixed; suggested viewport
 *  3. sound config: sections/layers/piano type/model/unison/effects/reverb, as the page reports them
 *  4. key-press cost: first press vs repeat vs new velocity (engines that build notes on first use)
 *  5. velocity: loudness from strike depth (back/front) and from pointer pressure
 *  6. reverb: staccato-chord tail with the reverb switch as loaded vs toggled
 */
import { chromium } from 'playwright';
import { LAUNCH_ARGS, initScript, installDriver, findInstrument } from './lib/page.mjs';
import { argv } from './lib/show.mjs';

const id = argv('model');
const base = (argv('base') || 'https://stagebench.vercel.app/previews').replace(/\/$/, '');
const url = `${base}/${id}/stage${argv('stage') || 3}/`;
if (!id) { console.error('usage: node scripts/probe.mjs --model <run-id>'); process.exit(1); }
const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
const withTimeout = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout: ${label}`)), ms))]);

async function open(viewport = { width: 2560, height: 960 }) {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(15000);
  page.on('crash', () => console.log('  !! page crashed'));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.addInitScript(initScript);
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(3500);
  await page.evaluate(installDriver);
  return page;
}
const out = { id, url };

// 1-3. Structure, layout, config.
{
  const page = await open();
  out.instrument = await page.evaluate(findInstrument);
  Object.assign(out, await page.evaluate((sel) => {
    const keys = [...document.querySelectorAll('[data-note],[data-midi]')]
      .map((k) => Number(/^\d+$/.test(k.dataset.note ?? '') ? k.dataset.note : k.dataset.midi)).filter(Number.isFinite);
    const box = document.querySelector(sel)?.getBoundingClientRect();
    const re = /organ|synth|layer|section|piano (type|model)|unison|reverb|mod ?1|mod ?2|effect|delay|comp|rotary|chorus/i;
    const controls = [...document.querySelectorAll('button,[role=button],[role=switch],select,input,[role=slider]')]
      .map((e) => ({ name: (e.getAttribute('aria-label') || e.getAttribute('title') || '').trim(), e }))
      .filter((c) => c.name && re.test(c.name) && !/octave|zone|drawbar|focus|morph|key$/i.test(c.name))
      .map(({ name, e }) => `${name.slice(0, 60)} = ${e.getAttribute('aria-pressed') ?? (e.tagName === 'SELECT' ? e.options[e.selectedIndex]?.text : null) ?? e.getAttribute('aria-valuetext') ?? e.value ?? ''}`);
    const oled = [...document.querySelectorAll('[class*=oled],[class*=display],[class*=lcd],[class*=screen]')].map((e) => e.textContent.trim().replace(/\s+/g, ' ')).filter(Boolean).slice(0, 2);
    return { keys: { count: keys.length, lo: Math.min(...keys), hi: Math.max(...keys) }, widthAt2560: Math.round(box?.width || 0), controls: [...new Set(controls)], oled };
  }, out.instrument));
  await page.close();
  const narrow = await open({ width: 1600, height: 900 });
  out.widthAt1600 = Math.round(await narrow.evaluate((sel) => document.querySelector(sel)?.getBoundingClientRect().width || 0, out.instrument));
  await narrow.close();
  const fixed = Math.abs(out.widthAt2560 - out.widthAt1600) < 20;
  out.layout = fixed ? 'fixed' : 'fluid';
  if (fixed) {
    const dpr = +(2400 / out.widthAt2560).toFixed(2);
    out.suggestedViewport = { width: Math.round(out.widthAt2560 + 100), height: Math.round(960 / dpr), dpr };
  }
}

// 4-5. Key cost and velocity.
{
  const page = await open(out.suggestedViewport ? { width: out.suggestedViewport.width, height: out.suggestedViewport.height } : undefined);
  const r = await withTimeout(page.evaluate(async () => {
    const K = window.__etudeKey, mode = { y: 'front-loud', pressure: true };
    const el = document.querySelector('[data-note="60"],[data-midi="60"]');
    const peak = () => { let m = 0; const b = new Float32Array(2048); for (const an of window.__etude.analysers) { an.getFloatTimeDomainData(b); for (const s of b) m = Math.max(m, Math.abs(s)); } return m; };
    const time = async (n, v) => { const s = performance.now(); K.down(n, v, mode); const d = performance.now() - s; await new Promise((r) => setTimeout(r, 40)); K.up(n, mode); await new Promise((r) => setTimeout(r, 60)); return +d.toFixed(1); };
    const cost = { first: await time(64, 70), repeat: await time(64, 70), newVelocity: await time(64, 100), newPitch: await time(67, 70) };
    const hit = async (frac, pressure) => {
      const q = el.getBoundingClientRect();
      const init = { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'mouse', button: 0, buttons: 1, clientX: q.left + q.width / 2, clientY: q.top + q.height * frac, pressure };
      el.dispatchEvent(new PointerEvent('pointerdown', init));
      let m = 0; const t0 = performance.now();
      while (performance.now() - t0 < 400) { m = Math.max(m, peak()); await new Promise((r) => setTimeout(r, 15)); }
      el.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0, pressure: 0 }));
      await new Promise((r) => setTimeout(r, 1200));
      return +m.toFixed(4);
    };
    await hit(0.5, 0.5);
    const vel = { back: await hit(0.1, 0.5), front: await hit(0.95, 0.5), pressureLo: await hit(0.5, 0.1), pressureHi: await hit(0.5, 1) };
    return { cost, vel, contexts: window.__etude.contexts.length };
  }), 60000, 'key cost/velocity').catch((e) => ({ error: e.message }));
  out.keys.cost = r.cost; out.velocity = r.vel; out.audioContexts = r.contexts; if (r.error) out.keysError = r.error;
  await page.close();
}

// 6. Reverb tail (staccato C-major chord, tail energy after release) as loaded vs toggled.
const reverbSel = (out.controls.find((c) => /^reverb ?on(\/off)?\b|reverb on\b/i.test(c)) || '').split(' = ')[0];
async function tail(toggle) {
  const page = await open(out.suggestedViewport ? { width: out.suggestedViewport.width, height: out.suggestedViewport.height } : undefined);
  if (toggle && reverbSel) await page.locator(`[aria-label="${reverbSel}"]`).first().click().catch(() => {});
  const r = await withTimeout(page.evaluate(async () => {
    const K = window.__etudeKey, mode = { y: 'front-loud', pressure: true };
    const rms = () => { let s = 0, n = 0; const b = new Float32Array(2048); for (const an of window.__etude.analysers) { an.getFloatTimeDomainData(b); for (const x of b) { s += x * x; n++; } } return n ? 10 * Math.log10(s / n + 1e-15) : -150; };
    K.down(60, 60, mode); await new Promise((r) => setTimeout(r, 100)); K.up(60, mode); await new Promise((r) => setTimeout(r, 2500));
    for (const n of [48, 55, 60, 64, 67]) K.down(n, 80, mode);
    await new Promise((r) => setTimeout(r, 120));
    for (const n of [48, 55, 60, 64, 67]) K.up(n, mode);
    const at = async (ms) => { await new Promise((r) => setTimeout(r, ms)); return +rms().toFixed(1); };
    return { after300ms: await at(300), after800ms: await at(500), after1500ms: await at(700) };
  }), 30000, 'reverb').catch((e) => ({ error: e.message }));
  await page.close();
  return r;
}
out.reverb = { control: reverbSel || null, asLoaded: await tail(false), toggled: reverbSel ? await tail(true) : null };
await browser.close();

// Summary + suggested fixture.
const on = out.controls.find((c) => c.startsWith(reverbSel + ' ='))?.endsWith('true');
const tailGain = out.reverb.toggled && !out.reverb.toggled.error ? out.reverb.toggled.after1500ms - out.reverb.asLoaded.after1500ms : 0;
const fixture = {};
if (out.suggestedViewport) fixture.viewport = out.suggestedViewport;
fixture.setup = [];
if (reverbSel && (on ? tailGain < -15 : tailGain > 15)) fixture.setup.push({ pressIfOff: `button[aria-label="${reverbSel}"]` }); // real tail: keep/turn it on
if (out.keys.cost && out.keys.cost.newVelocity > 30) fixture.quantizeVelocity = 8;
console.log(JSON.stringify(out, null, 1));
console.log('\nnotes:');
console.log(`  keybed ${out.keys.count} keys, MIDI ${out.keys.lo}-${out.keys.hi}${out.keys.lo !== 28 ? '  <- not E1-E7; notes outside are skipped' : ''}`);
console.log(`  layout ${out.layout} (${out.widthAt2560}px at 2560, ${out.widthAt1600}px at 1600)`);
if (out.keys.cost) console.log(`  key cost ms: first ${out.keys.cost.first}, repeat ${out.keys.cost.repeat}, new velocity ${out.keys.cost.newVelocity}${out.keys.cost.newVelocity > 30 ? '  <- builds per velocity: quantize' : ''}`);
if (out.velocity) console.log(`  velocity: depth ${out.velocity.back}->${out.velocity.front}, pressure ${out.velocity.pressureLo}->${out.velocity.pressureHi}`);
console.log(`  reverb "${reverbSel || 'none found'}" ${on ? 'on' : 'off'} as loaded; toggling changes the 1.5 s tail by ${tailGain.toFixed(1)} dB${reverbSel && Math.abs(tailGain) < 15 ? '  <- no real tail: leave at default' : ''}`);
console.log('  check the controls list for Piano B / organ / synth layers / unison / mod effects that are on, and add setup steps.');
console.log(`\nsuggested models.json entry:\n"${id}": ${JSON.stringify(fixture)}`);
