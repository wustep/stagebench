/**
 * Audit what a preview has switched on after its models.json setup: every pressed toggle, every
 * section/layer/effect state, and every reverb/effect amount with its range. Use it to confirm a
 * model plays just the grand (+ modest reverb) before recording.
 *   node scripts/audit.mjs --show shows/<name>.json [--model <id>]
 */
import { chromium } from 'playwright';
import { LAUNCH_ARGS, initScript } from './lib/page.mjs';
import { loadShow, argv } from './lib/show.mjs';
import { runSetup } from './lib/setup.mjs';

const S = loadShow(argv('show'));
const only = argv('model');
const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
for (const m of S.models.filter((x) => !only || x.id === only)) {
  const page = await browser.newPage({ viewport: { width: m.viewport.width, height: m.viewport.height } });
  page.setDefaultTimeout(15000);
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.addInitScript(initScript);
  await page.goto(m.url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(3500);
  const log = await runSetup(page, m.setup);
  const r = await page.evaluate(() => {
    const name = (e) => (e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 70);
    const on = [...document.querySelectorAll('[aria-pressed="true"],[aria-checked="true"],input[type=checkbox]:checked')].map(name)
      .filter((n) => !/ key$|piano key|^[A-G][♯#b]?\d$/i.test(n));
    const amounts = [...document.querySelectorAll('[role=slider],input[type=range]')].map((e) => ({ n: name(e), v: e.getAttribute('aria-valuenow') ?? e.value, min: e.getAttribute('aria-valuemin') ?? e.min, max: e.getAttribute('aria-valuemax') ?? e.max, t: e.getAttribute('aria-valuetext') }))
      .filter((a) => /reverb|delay|mod|chorus|comp|drive|dry|wet|amount|mix|level|volume/i.test(a.n));
    const oled = [...document.querySelectorAll('[class*=oled],[class*=display],[class*=lcd]')].map((e) => e.textContent.trim().replace(/\s+/g, ' ')).filter(Boolean).slice(0, 2);
    return { on: [...new Set(on)], amounts, oled };
  });
  console.log(`\n===== ${m.id}  setup: ${JSON.stringify(log)}\nOLED ${JSON.stringify(r.oled)}\nON: ${r.on.join(' | ')}`);
  for (const a of r.amounts) console.log(`  ${a.n} = ${a.v}${a.t ? ` (${a.t})` : ''} [${a.min}..${a.max}]`);
  await page.close();
}
await browser.close();
