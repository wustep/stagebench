#!/usr/bin/env node
/**
 * Computed-layout regression audit (Chromium via playwright-core, using the
 * locally cached browser — no downloads, no audio).
 *
 * The jsdom test suite asserts the hardware MODEL (key counts, control ids,
 * inline styles) but never computes CSS layout — a class of regression it is
 * structurally blind to (e.g. a stray `position: relative` on `.black-key`
 * once scattered all 30 black keys while 371 tests stayed green). This script
 * closes that gap against the BUILT artifact:
 *
 *   1. Keybed geometry: 43 white + 30 black keys, E1..E7 ends, every black
 *      key straddling its two white neighbours, spec black-height fraction.
 *   2. Per-section overflow audit at 1440x900: no text content clipped
 *      (printed group-box title straddles and round-knob overhangs excluded).
 *   3. No overlapping group boxes.
 *   4. Effects-grid boxes fit their fixed grid tracks.
 *   5. Narrow 390x844: all keys inside the chassis, six sections rendered,
 *      no horizontal page scroll.
 *   6. Zero console errors on load.
 *
 * Usage: node scripts/verify-layout.mjs   (builds are NOT run here — run
 * `pnpm build` first; the script serves dist/ itself via `vite preview`.)
 */
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const PORT = 4873
const URL_UNDER_TEST = `http://localhost:${PORT}/`

if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
  console.error('dist/index.html missing — run `pnpm build` first')
  process.exit(1)
}

function findChromium() {
  // Probe every Playwright cache root and browser bundle layout so the audit
  // runs on macOS and Linux alike (CI, cloud agents, contributor machines).
  const caches = [
    join(homedir(), 'Library', 'Caches', 'ms-playwright'), // macOS
    join(homedir(), '.cache', 'ms-playwright'), // Linux
  ]
  const executables = [
    ['chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'],
    ['chrome-mac', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'],
    ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
    ['chrome-linux64', 'chrome'],
    ['chrome-linux', 'chrome'],
  ]
  for (const cache of caches) {
    if (!existsSync(cache)) continue
    const dirs = readdirSync(cache)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort()
      .reverse()
    for (const dir of dirs) {
      for (const executable of executables) {
        const path = join(cache, dir, ...executable)
        if (existsSync(path)) return path
      }
    }
  }
  throw new Error('No cached Playwright Chromium found — run `pnpm exec playwright-core install chromium`')
}

/* --------------------------------------------------------- static server -- */

const server = spawn('pnpm', ['exec', 'vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: ROOT,
  stdio: 'pipe',
})
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('vite preview did not start')), 15000)
  server.stdout.on('data', (chunk) => {
    if (String(chunk).includes(String(PORT))) {
      clearTimeout(timeout)
      resolve()
    }
  })
  server.on('exit', () => reject(new Error('vite preview exited early')))
})

const results = []
const failures = []
function record(name, pass, detail) {
  results.push({ name, pass })
  if (!pass) failures.push(`${name}: ${detail}`)
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`)
}

// A launch failure (e.g. no cached Chromium) must still kill the preview
// server — a leaked server camps on the port and makes the NEXT run die with
// a misleading "vite preview exited early".
let browser
try {
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--mute-audio'] })
} catch (error) {
  server.kill()
  throw error
}
try {
  const consoleErrors = []
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(String(error)))
  await page.goto(URL_UNDER_TEST, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-testid="keybed"]')

  /* 1 — keybed geometry from COMPUTED layout, not the model. */
  const keys = await page.evaluate(() => {
    const keybed = document.querySelector('[data-testid="keybed"]').getBoundingClientRect()
    const all = [...document.querySelectorAll('.key')].map((el) => {
      const r = el.getBoundingClientRect()
      return { midi: Number(el.dataset.midi), black: el.classList.contains('black-key'), left: r.left, right: r.right, top: r.top, height: r.height }
    })
    return { keybed: { left: keybed.left, right: keybed.right, top: keybed.top, height: keybed.height }, all }
  })
  const whites = keys.all.filter((k) => !k.black).sort((a, b) => a.left - b.left)
  const blacks = keys.all.filter((k) => k.black)
  record('key-counts', whites.length === 43 && blacks.length === 30, `white=${whites.length} black=${blacks.length}`)
  record('key-range', whites[0]?.midi === 28 && whites[whites.length - 1]?.midi === 100, `first=${whites[0]?.midi} last=${whites[whites.length - 1]?.midi} (E1=28, E7=100)`)
  const whiteByMidi = new Map(whites.map((w) => [w.midi, w]))
  const misplaced = blacks.filter((b) => {
    const lower = whiteByMidi.get(b.midi - 1)
    const upper = whiteByMidi.get(b.midi + 1)
    const straddles = lower && upper && b.left > lower.left && b.right < upper.right && b.right > lower.right - 2 && b.left < upper.left + 2
    const inKeybed = b.left >= keys.keybed.left - 1 && b.right <= keys.keybed.right + 1 && Math.abs(b.top - keys.keybed.top) < 3
    return !(straddles && inKeybed)
  })
  record('black-key-placement', misplaced.length === 0, misplaced.length ? `misplaced midis: ${misplaced.map((b) => b.midi).join(',')}` : 'every black key straddles its white neighbours')
  const fractions = blacks.map((b) => b.height / keys.keybed.height)
  const fractionOk = fractions.every((f) => f > 0.6 && f < 0.68)
  record('black-key-height-fraction', fractionOk, `range ${Math.min(...fractions).toFixed(3)}..${Math.max(...fractions).toFixed(3)} (spec 0.64)`)

  /* 2+3+4 — per-section overflow, collisions and effects tracks. */
  const audit = await page.evaluate(() => {
    const out = { overflows: [], collisions: [], effectsBoxes: [] }
    for (const id of ['performance', 'organ', 'piano', 'program', 'synth', 'effects']) {
      const section = document.querySelector(`[data-section="${id}"]`)
      section.querySelectorAll('*').forEach((el) => {
        // SVG internals (the knobs' printed scale arcs) paint with
        // overflow visible by design and have no scroll box to audit.
        if (!(el instanceof HTMLElement)) return
        if (el.scrollWidth <= el.clientWidth + 3 && el.scrollHeight <= el.clientHeight + 3) return
        const cls = el.className.toString()
        // Printed panel titles deliberately straddle their boxes; round knob
        // caps overhang their flex cells by design. Everything else is a bug.
        const benign =
          el.classList.contains('group-box') ||
          el.classList.contains('plate') ||
          /synth-(body|main|top)|arp-column|voice-vibrato-row|effects-(body|grid)|keybed/.test(cls) ||
          // Knob caps overhang bare; the printed tick/numeral arc (.knob-scale)
          // paints outside its own box without adding scroll size, so a knob
          // whose textContent is only its scale numerals is panel print.
          // Drawbar caps likewise overhang their slim hit columns (photo:
          // chunky caps on a narrow stem) and print no text of their own.
          (/knob|encoder|wheel|stick|drawbar/.test(cls) &&
            (!el.textContent.trim() || el.textContent.trim() === (el.querySelector(':scope > .knob-scale')?.textContent ?? '').trim())) ||
          // Dense knob columns: the uniform-size knob box and its centered
          // nowrap legend print straddle the column horizontally by design
          // (panel ink, symmetric on both sides). Vertical overflow — text
          // actually clipping — still fails.
          (el.classList.contains('knob-cell') && el.scrollHeight <= el.clientHeight + 3 && el.scrollWidth <= el.clientWidth + 8) ||
          // Deliberate display clipping (OLED lines ellipsize like real hardware).
          getComputedStyle(el).textOverflow === 'ellipsis'
        if (!benign) out.overflows.push(`${id}: ${el.tagName}.${cls.slice(0, 30)} [${(el.textContent || '').slice(0, 24)}]`)
      })
      const boxes = [...section.querySelectorAll('.group-box')].map((el) => ({ n: el.getAttribute('aria-label'), r: el.getBoundingClientRect() }))
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i].r
          const b = boxes[j].r
          const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left)
          const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
          if (ox > 3 && oy > 3) out.collisions.push(`${id}: ${boxes[i].n} <-> ${boxes[j].n}`)
        }
      }
    }
    document.querySelectorAll('[data-section="effects"] .effects-grid > *').forEach((el) => {
      if (el.scrollHeight > el.clientHeight + 2) out.effectsBoxes.push(`${el.getAttribute('aria-label')}: ${el.scrollHeight} in ${el.clientHeight}`)
    })
    return out
  })
  record('no-text-overflows-desktop', audit.overflows.length === 0, audit.overflows.slice(0, 5).join(' | ') || 'clean')
  record('no-groupbox-collisions', audit.collisions.length === 0, audit.collisions.slice(0, 5).join(' | ') || 'clean')
  record('effects-boxes-fit-tracks', audit.effectsBoxes.length === 0, audit.effectsBoxes.join(' | ') || 'clean')
  record(
    'no-horizontal-page-scroll-desktop',
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
    'document scrollWidth vs clientWidth',
  )

  /* 5 — narrow viewport retention. */
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(400)
  const narrow = await page.evaluate(() => {
    const chassis = document.querySelector('[data-testid="chassis"]').getBoundingClientRect()
    const keys = [...document.querySelectorAll('.key')].map((el) => el.getBoundingClientRect())
    const outside = keys.filter((r) => r.left < chassis.left - 1 || r.right > chassis.right + 1 || r.bottom > chassis.bottom + 1).length
    const sections = [...document.querySelectorAll('.deck-section')].map((el) => el.getBoundingClientRect().width)
    return {
      keyCount: keys.length,
      outside,
      sectionsRendered: sections.filter((w) => w > 4).length,
      hScroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    }
  })
  record('narrow-keys-inside-chassis', narrow.keyCount === 73 && narrow.outside === 0, `keys=${narrow.keyCount} outside=${narrow.outside}`)
  record('narrow-sections-rendered', narrow.sectionsRendered === 6, `sections with width: ${narrow.sectionsRendered}/6`)
  record('no-horizontal-page-scroll-narrow', narrow.hScroll, 'document scrollWidth vs clientWidth')

  /* 6 — console cleanliness. */
  record('console-clean', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'no console errors')
} finally {
  await browser.close()
  server.kill()
}

console.log(`\n${results.filter((r) => r.pass).length}/${results.length} layout checks passed`)
if (failures.length) {
  console.error('FAILURES:\n' + failures.join('\n'))
  process.exit(1)
}
