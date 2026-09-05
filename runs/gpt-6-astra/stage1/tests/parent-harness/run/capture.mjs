// Parent-controlled canonical evidence: serve the sealed build locally and
// screenshot it at the two required viewports with a pinned browser profile.
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { writeJson } from '../shared.mjs'

export const CAPTURE_PROFILES = {
  desktop: { width: 1440, height: 900 },
  narrow: { width: 390, height: 844 },
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.webm': 'audio/webm',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.md': 'text/markdown',
}

// Minimal static file server for a built dist/ directory on an ephemeral port.
export function serveDirectory(directory) {
  // Resolve once: the traversal guard compares against path.resolve, so a
  // relative directory made every request fail the check and 403 — including
  // the root document, which looks exactly like an app that renders nothing.
  const rootDirectory = path.resolve(directory)
  const server = http.createServer((request, response) => {
    const urlPath = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    let filePath = path.join(rootDirectory, urlPath)
    if (!filePath.startsWith(rootDirectory)) {
      response.writeHead(403).end()
      return
    }
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html')
    if (!fs.existsSync(filePath)) {
      response.writeHead(404).end('Not found')
      return
    }
    response.writeHead(200, { 'content-type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream' })
    fs.createReadStream(filePath).pipe(response)
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}/`,
        close: () => new Promise((done) => server.close(done)),
      })
    })
  })
}

export async function captureEvidence(root, { id, phase, url }) {
  if (!id) throw new Error('A run id is required')
  if (![1, 2, 3].includes(Number(phase))) throw new Error('phase must be 1, 2, or 3')
  if (!url) throw new Error('A URL is required')
  let chromium
  try {
    ;({ chromium } = await import('playwright'))
  } catch {
    throw new Error('Playwright is required. Run pnpm install, then pnpm exec playwright install chromium.')
  }
  const outputDir = path.join(root, 'runs', id, `stage${phase}`, 'evidence')
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
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 })
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
    phase: Number(phase),
    url,
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
