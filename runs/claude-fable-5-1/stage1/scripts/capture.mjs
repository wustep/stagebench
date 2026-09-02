/**
 * Canonical capture + browser interaction pass for Phase 1.
 * Builds are expected in dist/ (run `pnpm build` first). Serves dist/ over a local HTTP port, drives
 * Chrome through playwright-core, records console/page errors, measures the rendered instrument and
 * writes stage1-desktop.png, stage1-narrow.png and stage1-capture.json into evidence/ at the candidate root.
 *
 * Usage: node scripts/capture.mjs [--out <dir>] [--chrome <path>]   (default --out evidence)
 */
import { createServer } from 'node:http'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argValue = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const outDir = path.resolve(root, argValue('--out', 'evidence'))
await mkdir(outDir, { recursive: true })
const distDir = path.join(root, 'dist')
if (!existsSync(path.join(distDir, 'index.html'))) {
  console.error('dist/index.html not found; run `pnpm build` first')
  process.exit(1)
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' }
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    let file = path.join(distDir, decodeURIComponent(url.pathname))
    if (!file.startsWith(distDir)) throw new Error('outside dist')
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html')
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const baseUrl = `http://127.0.0.1:${port}/`

const chromePath = argValue('--chrome', process.env.CHROME_PATH ?? process.env.PLAYWRIGHT_CHROME_PATH)
const launch = chromePath ? { executablePath: chromePath } : { channel: 'chrome' }
const browser = await chromium.launch({ ...launch, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream'] })

const MEASURE = () => {
  const rect = (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  }
  const instrument = document.getElementById('instrument')
  const inst = rect(instrument)
  const deck = rect(document.getElementById('deck'))
  const keybed = rect(document.getElementById('keybed'))
  const sections = [...document.querySelectorAll('.section')].map((s) => {
    const r = rect(s)
    return { id: s.dataset.section, documentedFraction: Number(s.dataset.fraction), x: r.x, width: r.width, measuredFraction: r.width / inst.width, left: (r.x - inst.x) / inst.width }
  })
  const keys = [...document.querySelectorAll('.key')]
  const white = keys.filter((k) => k.dataset.color === 'white')
  const black = keys.filter((k) => k.dataset.color === 'black')
  const whiteRect = white.length ? rect(white[0]) : null
  const blackRect = black.length ? rect(black[0]) : null
  const controls = [...document.querySelectorAll('[data-control-kind]')]
  const perSection = {}
  for (const s of document.querySelectorAll('.section')) {
    const id = s.dataset.section
    const list = [...s.querySelectorAll('[data-control-kind]')]
    const kinds = {}
    for (const c of list) kinds[c.dataset.controlKind] = (kinds[c.dataset.controlKind] ?? 0) + 1
    const displays = [...s.querySelectorAll('[data-display], [id*="oled"], [class*="display"], [class*="screen"]')].map((d) => {
      const r = rect(d)
      return { id: d.id, width: r.width, widthFraction: r.width / rect(s).width, area: r.width * r.height }
    })
    perSection[id] = { controls: list.length, kinds, displays, sectionWidth: rect(s).width }
  }
  const missingNames = controls.filter((c) => !(c.getAttribute('aria-label') || c.textContent.trim())).map((c) => c.id)
  const duplicateIds = (() => {
    const seen = new Set()
    const dup = []
    for (const el of document.querySelectorAll('[id]')) {
      if (seen.has(el.id)) dup.push(el.id)
      seen.add(el.id)
    }
    return dup
  })()
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    document: { scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight },
    instrument: { ...inst, widthFraction: inst.width / window.innerWidth, aspect: inst.width / inst.height, bottom: inst.y + inst.height },
    deck: { ...deck, fraction: deck.height / inst.height },
    keybed: { ...keybed, fraction: keybed.height / inst.height },
    sections,
    keys: {
      total: keys.length,
      white: white.length,
      black: black.length,
      first: keys[0]?.dataset.note,
      last: keys[keys.length - 1]?.dataset.note,
      whiteKey: whiteRect,
      blackKey: blackRect,
      blackHeightFraction: whiteRect && blackRect ? blackRect.height / whiteRect.height : null,
    },
    controls: { total: controls.length, missingNames, duplicateIds, perSection },
  }
}

const results = { generatedAt: new Date().toISOString(), tool: 'scripts/capture.mjs (playwright-core + local Chrome)', chrome: browser.version(), captures: {}, interaction: null }

async function capture(name, viewport, options = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, ...options })
  const page = await context.newPage()
  const consoleErrors = []
  const pageErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') consoleErrors.push(`${msg.type()}: ${msg.text()}`)
  })
  page.on('pageerror', (err) => pageErrors.push(String(err)))
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.waitForSelector('#instrument')
  await page.waitForTimeout(300)
  const measured = await page.evaluate(MEASURE)
  const file = path.join(outDir, `${name}.png`)
  await page.screenshot({ path: file, fullPage: false })
  results.captures[name] = { file: path.basename(file), ...measured, consoleErrors, pageErrors }
  return { page, context, consoleErrors, pageErrors }
}

// Desktop capture + interaction pass
{
  const { page, context, consoleErrors, pageErrors } = await capture('stage1-desktop', { width: 1440, height: 900 }, { hasTouch: true })
  const interaction = { steps: [] }
  const step = async (label, fn) => {
    try {
      const value = await fn()
      interaction.steps.push({ label, ok: true, value })
    } catch (err) {
      interaction.steps.push({ label, ok: false, error: String(err) })
    }
  }
  await step('press key C4 with the mouse', async () => {
    const key = page.locator('#key-60')
    const box = await key.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8)
    await page.mouse.down()
    await page.waitForTimeout(80)
    const pressed = await key.getAttribute('aria-pressed')
    await page.mouse.up()
    await page.waitForTimeout(50)
    const released = await key.getAttribute('aria-pressed')
    return { pressed, released }
  })
  await step('audio status after first gesture', async () => {
    await page.waitForFunction(() => ['ready', 'error', 'fallback'].includes(document.getElementById('audio-status')?.dataset.state ?? ''), null, { timeout: 8000 })
    return await page.evaluate(() => ({ state: document.getElementById('audio-status').dataset.state, message: document.getElementById('audio-message').textContent, midi: document.getElementById('midi-status').dataset.state, midiMessage: document.getElementById('midi-message').textContent }))
  })
  await step('engine metrics after playing', async () => await page.evaluate(() => globalThis.__stagebench.engine.metrics()))
  await step('computer keyboard A/W chord with sustain', async () => {
    await page.keyboard.down('Shift')
    await page.keyboard.down('KeyA')
    await page.keyboard.down('KeyW')
    await page.waitForTimeout(60)
    const held = await page.evaluate(() => globalThis.__stagebench.bus.heldNotes())
    const sustain = await page.evaluate(() => globalThis.__stagebench.engine.isSustain())
    await page.keyboard.up('KeyA')
    await page.keyboard.up('KeyW')
    await page.keyboard.up('Shift')
    await page.waitForTimeout(60)
    const after = await page.evaluate(() => ({ held: globalThis.__stagebench.bus.heldNotes(), voices: globalThis.__stagebench.engine.activeVoices().length }))
    return { held, sustain, after }
  })
  await step('multi-touch two keys', async () => {
    const a = await page.locator('#key-64').boundingBox()
    const b = await page.locator('#key-67').boundingBox()
    await page.touchscreen.tap(a.x + a.width / 2, a.y + a.height * 0.8)
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height * 0.8)
    return await page.evaluate(() => globalThis.__stagebench.bus.getState().lastEvent)
  })
  await step('operate a knob with the keyboard', async () => {
    const knob = page.locator('#effects\\.reverb\\.dry-wet')
    const before = await knob.getAttribute('aria-valuenow')
    await knob.focus()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    const after = await knob.getAttribute('aria-valuenow')
    return { before, after }
  })
  await step('drag a drawbar and a fader with the mouse', async () => {
    const drawbar = page.locator('#organ\\.drawbar\\.8')
    const b = await drawbar.boundingBox()
    const before = await drawbar.getAttribute('aria-valuenow')
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 40, { steps: 5 })
    await page.mouse.up()
    const after = await drawbar.getAttribute('aria-valuenow')
    const fader = page.locator('#piano\\.layer-b\\.level')
    const f = await fader.boundingBox()
    const fBefore = await fader.getAttribute('aria-valuenow')
    await page.mouse.move(f.x + f.width / 2, f.y + f.height / 2)
    await page.mouse.down()
    await page.mouse.move(f.x + f.width / 2, f.y + f.height / 2 - 30, { steps: 5 })
    await page.mouse.up()
    const fAfter = await fader.getAttribute('aria-valuenow')
    return { drawbar: { before, after }, fader: { fBefore, fAfter } }
  })
  await step('click toggle, selector and momentary buttons', async () => {
    const toggle = page.locator('#organ\\.vibrato\\.on')
    await toggle.click()
    const pressed = await toggle.getAttribute('aria-pressed')
    const sel = page.locator('#piano\\.type')
    await sel.click()
    const selValue = await sel.getAttribute('data-value')
    const mom = page.locator('#program\\.shift')
    const box = await mom.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    const held = await mom.getAttribute('data-value')
    await page.mouse.up()
    const released = await mom.getAttribute('data-value')
    return { toggle: pressed, selector: selValue, momentary: { held, released } }
  })
  await step('tab focus shows a visible focus ring', async () => {
    await page.mouse.click(5, 5)
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    return await page.evaluate(() => {
      const el = document.activeElement
      const style = getComputedStyle(el)
      return { id: el.id, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, matchesFocusVisible: el.matches(':focus-visible') }
    })
  })
  await step('panel controls did not touch audio state', async () => await page.evaluate(() => ({ voices: globalThis.__stagebench.engine.activeVoices().length, lastNote: globalThis.__stagebench.engine.getStatus().lastNote })))
  await step('blur releases everything', async () => {
    await page.keyboard.down('KeyD')
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.keyboard.up('KeyD')
    await page.waitForTimeout(400)
    return await page.evaluate(() => ({ held: globalThis.__stagebench.bus.heldNotes(), voices: globalThis.__stagebench.engine.activeVoices().length }))
  })
  await step('forbidden-hardware rules (visual spec forbiddenDetection)', async () =>
    await page.evaluate(() => {
      const out = {}
      for (const s of document.querySelectorAll('.section')) {
        const id = s.dataset.section
        const sw = s.getBoundingClientRect().width
        const displays = [...s.querySelectorAll('[data-display], [id*="oled"], [class*="display"], [class*="screen"]')].map((d) => d.getBoundingClientRect())
        const controls = [...s.querySelectorAll('[data-control-kind]')].map((c) => c.getBoundingClientRect())
        const tall = controls.filter((r) => r.height >= 3 * r.width)
        const areas = displays.map((r) => r.width * r.height)
        const maxArea = Math.max(0, ...areas)
        out[id] = {
          displays: displays.length,
          wideDisplays: displays.filter((r) => r.width >= 0.5 * sw).length,
          primaryDisplays: areas.filter((a) => a >= 0.5 * maxArea).length,
          drawbarLikeControls: tall.length,
          controls: controls.length,
        }
      }
      return out
    }),
  )
  interaction.consoleErrors = consoleErrors
  interaction.pageErrors = pageErrors
  results.interaction = interaction
  await context.close()
}

// Narrow capture (mobile emulation)
{
  const { context } = await capture('stage1-narrow', { width: 390, height: 844 }, { isMobile: true, hasTouch: true })
  await context.close()
}

await browser.close()
server.close()
await writeFile(path.join(outDir, 'stage1-capture.json'), JSON.stringify(results, null, 2))
const d = results.captures['stage1-desktop']
console.log(`desktop: instrument ${d.instrument.width.toFixed(0)}x${d.instrument.height.toFixed(0)} = ${(d.instrument.widthFraction * 100).toFixed(1)}% of viewport, scrollHeight ${d.document.scrollHeight}, keys ${d.keys.total} (${d.keys.white}w/${d.keys.black}b), controls ${d.controls.total}`)
for (const s of d.sections) console.log(`  ${s.id.padEnd(12)} documented ${s.documentedFraction.toFixed(3)} measured ${s.measuredFraction.toFixed(3)}`)
console.log(`  deck ${d.deck.fraction.toFixed(3)} keybed ${d.keybed.fraction.toFixed(3)} blackKeyHeight ${d.keys.blackHeightFraction?.toFixed(3)}`)
console.log(`  console errors: ${d.consoleErrors.length}, page errors: ${d.pageErrors.length}`)
for (const step of results.interaction.steps) console.log(`  [${step.ok ? 'ok' : 'FAIL'}] ${step.label}: ${JSON.stringify(step.value ?? step.error)}`)
const n = results.captures['stage1-narrow']
console.log(`narrow: instrument ${n.instrument.width.toFixed(0)}x${n.instrument.height.toFixed(0)}, scrollWidth ${n.document.scrollWidth}, console errors ${n.consoleErrors.length}`)
