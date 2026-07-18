/**
 * Canonical Phase 1 captures: stage1-desktop.png, stage1-narrow.png,
 * stage1-capture.json — produced with Playwright against the built app.
 */
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = join(root, 'dist')
const out = join(root, 'tests')

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    let path = join(dist, url.pathname === '/' ? 'index.html' : url.pathname)
    if (!existsSync(path)) path = join(dist, 'index.html')
    const body = await readFile(path)
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' })
    res.end(body)
  } catch (err) {
    res.writeHead(500).end(String(err))
  }
})
await new Promise((resolve) => server.listen(0, resolve))
const port = server.address().port

const browser = await chromium.launch()
const consoleErrors = []
const captures = {}

for (const [name, viewport] of [
  ['desktop', { width: 1440, height: 900 }],
  ['narrow', { width: 390, height: 844 }],
]) {
  const page = await browser.newPage({ viewport })
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`${name}: ${msg.text()}`)
  })
  page.on('pageerror', (err) => consoleErrors.push(`${name}: ${err.message}`))
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-key-id="key.e7"]', { timeout: 10000 })
  await page.screenshot({ path: join(out, `stage1-${name}.png`) })

  const metrics = await page.evaluate(() => {
    const inst = document.querySelector('[data-instrument]').getBoundingClientRect()
    const deck = document.querySelector('.deck').getBoundingClientRect()
    const keybed = document.querySelector('[data-keybed]').getBoundingClientRect()
    const slots = [...document.querySelectorAll('[data-section-slot]')].map((s) => {
      const r = s.getBoundingClientRect()
      return { id: s.getAttribute('data-section-slot'), x: r.x, width: r.width }
    })
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      instrument: { x: inst.x, y: inst.y, width: inst.width, height: inst.height, bottom: inst.bottom },
      deck: { height: deck.height },
      keybed: { height: keybed.height },
      slots,
      keyCount: document.querySelectorAll('[data-key-id]').length,
      whiteKeys: document.querySelectorAll('.key-white').length,
      blackKeys: document.querySelectorAll('.key-black').length,
      controlCount: document.querySelectorAll('[data-control-id]').length,
      oledCount: document.querySelectorAll('.oled').length,
      verticalScroll: document.documentElement.scrollHeight > window.innerHeight,
    }
  })
  captures[name] = metrics
  await page.close()
}

await browser.close()
server.close()

const { writeFile } = await import('node:fs/promises')
await writeFile(
  join(out, 'stage1-capture.json'),
  JSON.stringify(
    {
      stage: 1,
      variant: 'stage-4-73',
      capturedAt: new Date().toISOString(),
      url: `http://localhost:${port}/`,
      captures,
      consoleErrors,
    },
    null,
    2,
  ),
)

console.log(JSON.stringify({ consoleErrors, desktop: captures.desktop.instrument, narrow: captures.narrow.instrument }, null, 2))
process.exit(consoleErrors.length ? 1 : 0)
