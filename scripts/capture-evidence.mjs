#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { findRepoRoot, parseArgs, writeJson } from '../.agents/skills/run-nord-benchmark/lib/cli.mjs'

export const CAPTURE_PROFILES = {
  desktop: { width: 1440, height: 900 },
  narrow: { width: 390, height: 844 },
}

export async function captureEvidence(root, options) {
  if (!options.id) throw new Error('--id is required')
  const phase = Number(options.phase)
  if (![1, 2, 3].includes(phase)) throw new Error('--phase must be 1, 2, or 3')
  if (!options.url) throw new Error('--url is required (start the sealed build before capture)')
  let chromium
  try {
    ;({ chromium } = await import('playwright'))
  } catch {
    throw new Error('Playwright is required. Run pnpm install, then pnpm exec playwright install chromium.')
  }
  const outputDir = path.join(root, 'runs', options.id, `stage${phase}`, 'evidence')
  fs.mkdirSync(outputDir, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const browserVersion = browser.version()
  const captures = []
  try {
    for (const [profile, viewport] of Object.entries(CAPTURE_PROFILES)) {
      const context = await browser.newContext({
        viewport,
        deviceScaleFactor: 1,
        colorScheme: 'light',
        reducedMotion: 'reduce',
        locale: 'en-US',
        timezoneId: 'UTC',
      })
      const page = await context.newPage()
      const consoleMessages = []
      const pageErrors = []
      page.on('console', (message) => consoleMessages.push({ type: message.type(), text: message.text() }))
      page.on('pageerror', (error) => pageErrors.push(error.message))
      await page.goto(options.url, { waitUntil: 'networkidle', timeout: 60_000 })
      await page.evaluate(async () => document.fonts.ready)
      await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' })
      await page.waitForTimeout(100)
      const file = path.join(outputDir, `stage${phase}-${profile}.png`)
      await page.screenshot({ path: file, fullPage: false, animations: 'disabled' })
      captures.push({ profile, viewport, file: path.relative(path.dirname(outputDir), file).split(path.sep).join('/'), bytes: fs.statSync(file).size, consoleMessages, pageErrors })
      await context.close()
    }
  } finally {
    await browser.close()
  }
  const metadata = {
    version: 1,
    phase,
    url: options.url,
    capturedAt: new Date().toISOString(),
    browser: `Playwright Chromium ${browserVersion}`,
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezone: 'UTC',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    captures,
  }
  writeJson(path.join(outputDir, `stage${phase}-capture.json`), metadata)
  return metadata
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const { options } = parseArgs(process.argv.slice(2))
    const result = await captureEvidence(findRepoRoot(options.root), options)
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(`capture-evidence: ${error.message}`)
    process.exitCode = 1
  }
}
