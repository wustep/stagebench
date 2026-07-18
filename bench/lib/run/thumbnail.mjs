// Gallery hover thumbnails: shoot each published preview build and crop to the
// instrument itself, so the leaderboard shows the keyboard rather than whatever
// status text, help copy, and dead page background surrounds it.
//
// Every run lays the instrument out differently, so the crop is found in the
// DOM rather than hard-coded: locate the keyboard (the element with the most
// key-shaped children), then walk up to the painted chassis that contains it.
import fs from 'node:fs'
import path from 'node:path'
import { serveDirectory } from './capture.mjs'

const VIEWPORT = { width: 1440, height: 900 }
// Wide enough to stay sharp on a HiDPI hover card without bloating the repo.
const THUMB_WIDTH = 720
// Crop exactly to the chassis: even a few pixels of slack lets a status line
// sitting directly under the instrument bleed into the frame.
const PADDING = 0

// Runs in the page. Returns a viewport-space rect for the instrument, or null
// when nothing keyboard-shaped turns up and the caller should fall back.
function findInstrumentRect() {
  const viewportArea = window.innerWidth * window.innerHeight
  // A chassis may legitimately fill most of the window, but an element that
  // covers essentially all of it is the page wrapper, not the instrument.
  const MAX_SHARE = 0.92

  const rectOf = (element) => element.getBoundingClientRect()
  const isVisible = (element) => {
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    if (Number(style.opacity) === 0) return false
    const rect = rectOf(element)
    return rect.width > 0 && rect.height > 0
  }
  const isPainted = (element) => {
    const style = getComputedStyle(element)
    const background = style.backgroundColor
    const transparent = !background || background === 'transparent' || /,\s*0\s*\)$/.test(background)
    return !transparent || style.backgroundImage !== 'none'
  }
  // Piano keys: tall, narrow, and all siblings of one another.
  const isKeyShaped = (element) => {
    const rect = rectOf(element)
    return rect.height > 24 && rect.width > 3 && rect.width < 90 && rect.height > rect.width
  }

  const elements = Array.from(document.body.querySelectorAll('*')).filter(isVisible)

  let keyboard = null
  let keyCount = 0
  for (const element of elements) {
    const keys = Array.from(element.children).filter(isKeyShaped)
    if (keys.length > keyCount) {
      keyCount = keys.length
      keyboard = element
    }
  }
  // An octave's worth of keys is the floor for trusting the detection.
  if (!keyboard || keyCount < 12) return null

  // Climb to the outermost painted ancestor that still reads as the instrument
  // rather than the page — that is the chassis holding panel plus keyboard.
  let chassis = keyboard
  for (let node = keyboard; node && node !== document.body; node = node.parentElement) {
    const rect = rectOf(node)
    if (rect.width * rect.height > viewportArea * MAX_SHARE) break
    if (isPainted(node)) chassis = node
  }

  const rect = rectOf(chassis)
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, keyCount }
}

// Union of every painted element that is not the page wrapper. Used when key
// detection fails, so a phase-1 shell still gets a sensible crop.
function findPaintedBounds() {
  const viewportArea = window.innerWidth * window.innerHeight
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const element of document.body.querySelectorAll('*')) {
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue
    const background = style.backgroundColor
    const transparent = !background || background === 'transparent' || /,\s*0\s*\)$/.test(background)
    if (transparent && style.backgroundImage === 'none') continue
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue
    if (rect.width * rect.height > viewportArea * 0.92) continue
    left = Math.min(left, rect.x)
    top = Math.min(top, rect.y)
    right = Math.max(right, rect.x + rect.width)
    bottom = Math.max(bottom, rect.y + rect.height)
  }
  if (!Number.isFinite(left)) return null
  return { x: left, y: top, width: right - left, height: bottom - top, keyCount: 0 }
}

function clampToViewport(rect) {
  const left = Math.max(0, Math.floor(rect.x - PADDING))
  const top = Math.max(0, Math.floor(rect.y - PADDING))
  const right = Math.min(VIEWPORT.width, Math.ceil(rect.x + rect.width + PADDING))
  const bottom = Math.min(VIEWPORT.height, Math.ceil(rect.y + rect.height + PADDING))
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }
}

// Playwright cannot resize a screenshot, so the full-resolution crop is
// replayed into a blank page at the target width and reshot. Keeps thumbnails a
// uniform width with no image-processing dependency.
async function downscale(browser, buffer, clip) {
  const height = Math.max(1, Math.round((clip.height / clip.width) * THUMB_WIDTH))
  const context = await browser.newContext({
    viewport: { width: THUMB_WIDTH, height },
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  await page.setContent(
    `<body style="margin:0"><img src="data:image/png;base64,${buffer.toString('base64')}"
      style="display:block;width:${THUMB_WIDTH}px;height:${height}px"></body>`,
  )
  await page.waitForTimeout(60)
  const out = await page.screenshot({ type: 'jpeg', quality: 82 })
  await context.close()
  return out
}

async function shootOne(browser, { directory, output }) {
  const server = await serveDirectory(directory)
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'UTC',
  })
  try {
    const page = await context.newPage()
    await page.goto(server.url, { waitUntil: 'networkidle', timeout: 60_000 })
    await page.evaluate(async () => document.fonts.ready)
    await page.addStyleTag({
      content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}',
    })
    await page.waitForTimeout(120)

    let rect = await page.evaluate(findInstrumentRect)
    let strategy = 'instrument'
    if (!rect) {
      rect = await page.evaluate(findPaintedBounds)
      strategy = 'painted-bounds'
    }
    if (!rect) {
      rect = { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height, keyCount: 0 }
      strategy = 'viewport'
    }
    const clip = clampToViewport(rect)
    const full = await page.screenshot({ clip, animations: 'disabled' })
    const thumb = await downscale(browser, full, clip)
    fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.writeFileSync(output, thumb)
    return { strategy, keyCount: rect.keyCount ?? 0, clip, bytes: thumb.length }
  } finally {
    await context.close()
    await server.close()
  }
}

// Generates a thumbnail for every published preview named in the registry.
// `targets` is [{ id, directory, output }].
export async function generateThumbnails(targets) {
  let chromium
  try {
    ;({ chromium } = await import('playwright'))
  } catch {
    throw new Error('Playwright is required. Run pnpm install, then pnpm exec playwright install chromium.')
  }
  const browser = await chromium.launch({ headless: true })
  const results = []
  try {
    for (const target of targets) {
      try {
        const result = await shootOne(browser, target)
        results.push({ id: target.id, ok: true, ...result })
      } catch (error) {
        results.push({ id: target.id, ok: false, error: error.message })
      }
    }
  } finally {
    await browser.close()
  }
  return results
}
