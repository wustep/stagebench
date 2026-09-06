/**
 * Canonical capture harness: serves dist/, screenshots 1440x900 + 390x844,
 * and writes <prefix>-capture.json with measured bounds for the visual audit.
 * Run: `node ./scripts/capture.mjs` after `pnpm build`.
 * Env PREFIX selects the evidence prefix (default `stage1`; Phase 2 uses
 * `PREFIX=stage2`). The static server also serves dist/samples/ so the
 * Phase 2 capture exercises the real bundled sample fetch path.
 */
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, '..', 'dist');
const PREFIX = process.env.PREFIX ?? 'stage1';
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wav': 'audio/wav',
};

async function serve() {
  const server = createServer(async (req, res) => {
    try {
      const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
      const data = await readFile(join(dist, path));
      res.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const server = await serve();
const port = server.address().port;
const errors = [];

try {
  for (const [name, width, height, file] of [
    ['desktop', 1440, 900, `${PREFIX}-desktop.png`],
    ['narrow', 390, 844, `${PREFIX}-narrow.png`],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`${name}: ${msg.text()}`);
    });
    page.on('pageerror', (err) => errors.push(`${name}: ${String(err)}`));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2200);
    const instrument = page.getByTestId('instrument');
    await instrument.waitFor({ timeout: 10000 });
    const box = await instrument.boundingBox();
    const deck = await page.getByTestId('keybed').boundingBox();
    const sections = await page.evaluate(() => {
      const deckEl = document.querySelector('[data-testid="control-deck"]');
      const deckBox = deckEl.getBoundingClientRect();
      return [...document.querySelectorAll('[data-testid^="section-"]')].map((el) => ({
        id: el.getAttribute('data-section'),
        widthFraction: +(el.getBoundingClientRect().width / deckBox.width).toFixed(4),
      }));
    });
    const keys = await page.evaluate(() => ({
      total: document.querySelectorAll('[data-testid^="key-"]').length,
      white: document.querySelectorAll('[data-testid^="key-"][data-white="true"]').length,
      black: document.querySelectorAll('[data-testid^="key-"][data-white="false"]').length,
    }));
    const phase2 = await page.evaluate(() => ({
      stageStatus: document.querySelector('[data-testid="stage-status"]')?.getAttribute('data-status'),
      stageText: document.querySelector('[data-testid="stage-status"]')?.textContent?.slice(0, 120),
      programModel: document.querySelector('[data-testid="p2-program-model"]')?.textContent,
      p2Controls: document.querySelectorAll('[data-testid^="p2-"]').length,
      pianoTypes: document.querySelectorAll('[data-testid^="p2-piano-A-type-"]').length,
    }));
    const overflow = await page.evaluate(() => ({
      bodyScrollWidth: document.body.scrollWidth,
      docScrollWidth: document.documentElement.scrollWidth,
      bodyScrollHeight: document.body.scrollHeight,
      innerHeight: window.innerHeight,
    }));
    await page.screenshot({ path: join(root, '..', file) });
    globalThis[`__${name}`] = { box, deck, sections, keys, overflow, phase2, viewport: { width, height } };
    await page.close();
  }
  const desktop = globalThis.__desktop;
  const narrow = globalThis.__narrow;
  const capture = {
    tool: 'scripts/capture.mjs + playwright-core + system chrome',
    desktop: {
      ...desktop,
      instrumentWidthFraction: +(desktop.box.width / desktop.viewport.width).toFixed(4),
      deckFraction: +(desktop.box.height ? 1 - desktop.deck.height / desktop.box.height : 0).toFixed(4),
    },
    narrow: {
      ...narrow,
      instrumentWidthFraction: +(narrow.box.width / narrow.viewport.width).toFixed(4),
    },
    consoleErrors: errors,
  };
  await writeFile(join(root, '..', `${PREFIX}-capture.json`), JSON.stringify(capture, null, 2));
  console.log(JSON.stringify(capture, null, 2));
} finally {
  await browser.close();
  server.close();
}
