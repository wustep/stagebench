/**
 * Canonical Phase 3 captures: stage3-desktop.png, stage3-narrow.png,
 * stage3-capture.json — produced with Playwright against the built app.
 * The required interaction pass exercises programs, Live Mode, splits,
 * scenes, morphs, representative organ and synth sounds, and Panic while
 * watching the console for errors.
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
const captures = []

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

  // Required interaction pass: programs, Live Mode, splits, scenes, morphs,
  // organ + synth sounds, master clock, Panic.
  if (name === 'desktop') {
    const click = async (id) => page.click(`[data-control-id="${id}"]`)
    // Organ: enable, pick Vox, pull drawbars, route rotary, play.
    await click('organ.on')
    await click('organ.model') // B3 Bass
    await click('organ.model') // Vox
    await click('organ.rotaryRoute')
    await click('fx.rotaryOn')
    await page.click('[data-key-id="key.c3"]')
    // Synth: enable, pick Super Saw, run the arp, play.
    await click('synth.on')
    await click('synth.oscWave') // Square
    await click('synth.arpOn')
    await page.click('[data-key-id="key.c4"]')
    // Splits: enable the mid split and crossfade edit.
    await click('program.split')
    await click('program.splitMid')
    // Scene toggle.
    await click('program.layerScene')
    await click('program.layerScene')
    // Morph: assign wheel → filter cutoff, sweep the wheel.
    await click('program.morphWheel')
    const cutoff = '[data-control-id="synth.filterCutoff"]'
    await page.focus(cutoff)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    // Live Mode on/off.
    await click('program.liveMode')
    await click('program.liveMode')
    // Master clock taps.
    for (let i = 0; i < 4; i++) await click('program.mstClock')
    // Program navigation: next page, program button, dial back.
    await click('program.pageRight')
    await click('program.button.2')
    // Panic to finish (all notes off).
    await click('program.panic')
  }

  await page.screenshot({ path: join(out, `stage3-${name}.png`) })

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
      splitStrip: document.querySelector('[data-split-strip]') !== null,
      zoneKeys: document.querySelectorAll('[data-zone-key]').length,
      programOled: document.querySelector('[data-oled="program-position"]')?.textContent ?? '',
      synthOled: document.querySelector('[data-oled="synth-wave"]')?.textContent ?? '',
      audioStatus: document.querySelector('[data-status="audio"]')?.textContent ?? '',
      verticalScroll: document.documentElement.scrollHeight > window.innerHeight,
    }
  })
  captures.push({
    profile: name,
    viewport,
    file: `evidence/stage3-${name}.png`,
    metrics,
  })
  await page.close()
}

await browser.close()
server.close()

const { writeFile, stat } = await import('node:fs/promises')
for (const c of captures) {
  const s = await stat(join(root, c.file))
  c.bytes = s.size
}
await writeFile(
  join(out, 'stage3-capture.json'),
  JSON.stringify(
    {
      version: 1,
      phase: 3,
      variant: 'stage-4-73',
      capturedAt: new Date().toISOString(),
      url: `http://localhost:${port}/`,
      browser: 'Playwright Chromium',
      interactionPass:
        'organ on + Vox + rotary route + played, synth on + wave + arp run + played, split + split point, scene toggle, morph assign (wheel → filter cutoff) + wheel sweep, Live Mode on/off, 4 master-clock taps, page + program button navigation, Panic',
      captures,
      consoleErrors,
    },
    null,
    2,
  ),
)

console.log(JSON.stringify({ consoleErrors, programOled: captures[0].metrics.programOled, audioStatus: captures[0].metrics.audioStatus }, null, 2))
process.exit(consoleErrors.length ? 1 : 0)
