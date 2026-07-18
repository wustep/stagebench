/**
 * Canonical Phase 2 captures: stage2-desktop.png, stage2-narrow.png,
 * stage2-capture.json — produced with Playwright against the built app.
 * Includes the required interaction pass (functional controls exercised,
 * keybed played) while watching the console for errors.
 */
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = join(root, 'dist')
const out = join(root, 'evidence')

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.wav': 'audio/wav' }

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
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelectorAll('[data-key-id]').length === 73, { timeout: 15000 })

  // Required interaction pass: exercise functional controls + keybed.
  if (name === 'desktop') {
    const click = async (id) => page.click(`[data-control-id="${id}"]`)
    await click('piano.type') // Upright
    await click('piano.layerB') // enable layer B (focus B)
    await click('fx.effect1On') // Mod 1 on (chain B)
    await click('fx.reverbOn')
    await click('fx.rotaryOn')
    await page.keyboard.press('z') // play a note
    await page.keyboard.down(' ')
    await page.keyboard.up(' ')
    await page.click('[data-key-id="key.c4"]')
    await click('program.panic')
  }

  await page.screenshot({ path: join(out, `stage2-${name}.png`) })

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
      functionalControls: document.querySelectorAll('[data-functional="true"]').length,
      oledCount: document.querySelectorAll('.oled').length,
      audioStatus: document.querySelector('[data-status="audio"]')?.textContent ?? '',
      pianoModelShown: document.querySelector('[data-oled="piano-model"]')?.textContent ?? '',
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
  join(out, 'stage2-capture.json'),
  JSON.stringify(
    {
      stage: 2,
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

console.log(JSON.stringify({ consoleErrors, desktop: captures.desktop.instrument, audioStatus: captures.desktop.audioStatus }, null, 2))
process.exit(consoleErrors.length ? 1 : 0)
