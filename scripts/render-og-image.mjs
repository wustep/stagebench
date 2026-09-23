#!/usr/bin/env node
/**
 * Render scripts/og-image.html to public/og.png, the 1200×630 Open Graph /
 * Twitter card referenced from index.html. Rerun after editing the HTML.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = pathToFileURL(join(root, 'scripts', 'og-image.html')).href
const output = join(root, 'public', 'og.png')

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
  await page.goto(source, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  const missing = await page.evaluate(() =>
    [...document.fonts].filter((face) => face.status !== 'loaded').map((face) => face.family),
  )
  if (missing.length > 0) throw new Error(`Fonts failed to load (run pnpm install): ${missing.join(', ')}`)
  await page.screenshot({ path: output, type: 'png' })
  console.log(`Wrote ${output}`)
} finally {
  await browser.close()
}
