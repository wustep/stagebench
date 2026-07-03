// Fetches Nord Stage 4 reference material (user manual + official product
// photos) from Clavia's own servers into ./reference, which is gitignored.
//
// These are third-party copyrighted works owned by Clavia DMI AB. They are
// deliberately NOT redistributed in this repository — the benchmark fetches
// them from the manufacturer's official URLs for local evaluation only.
import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// filename in ./reference  ->  official Clavia/Nord source URL
const ASSETS = [
  {
    file: 'manual.pdf',
    url: 'https://www.nordkeyboards.com/wt/documents/951/Nord%20Stage%204%20User%20Manual%20v1.6X-Edition-N.pdf',
  },
  {
    file: 'nord-stage-4.jpg', // Stage 4 88 (full)
    url: 'https://assets.nordkeyboards.com/nord-assets-prod/media/original_images/lyDePXcG/NS4_HA88_TopDown-01_241008.jpg',
  },
  {
    file: 'nord-stage-4-73.jpg', // Stage 4 73
    url: 'https://assets.nordkeyboards.com/nord-assets-prod/media/original_images/2jnZVaTL/NS4_HA73_TopDown-01_241008.jpg',
  },
  {
    file: 'nord-stage-4-compact.jpg', // Stage 4 Compact 73
    url: 'https://assets.nordkeyboards.com/nord-assets-prod/media/original_images/NS4_Compact73_TopDown-01_231020.jpg',
  },
]

const exists = (path) => access(path).then(() => true, () => false)

const DEFAULT_TIMEOUT_MS = 60_000
const MAX_ATTEMPTS = 3 // one initial attempt plus two retries
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Fetch one asset with an AbortController timeout, retrying transient failures
// (network errors, timeouts, 5xx, 429) with exponential backoff. A persistent
// failure surfaces an explicit message rather than hanging forever.
async function fetchAsset(url, timeoutMs) {
  let lastError = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { signal: controller.signal })
      if (response.ok) return Buffer.from(await response.arrayBuffer())
      // 5xx and 429 are worth retrying; 4xx (except 429) are permanent.
      const retriable = response.status >= 500 || response.status === 429
      lastError = new Error(`HTTP ${response.status} ${response.statusText}`)
      if (!retriable) throw lastError
    } catch (error) {
      lastError = error.name === 'AbortError'
        ? new Error(`timed out after ${timeoutMs}ms`)
        : error
    } finally {
      clearTimeout(timer)
    }
    if (attempt < MAX_ATTEMPTS) {
      const backoff = 1000 * 2 ** (attempt - 1)
      process.stdout.write(`retry ${attempt}/${MAX_ATTEMPTS - 1} in ${backoff}ms … `)
      await sleep(backoff)
    }
  }
  throw lastError ?? new Error('unknown fetch failure')
}

export async function fetchReference(root, { force = false, timeout } = {}) {
  const timeoutMs = Number.isFinite(Number(timeout)) && Number(timeout) > 0
    ? Number(timeout)
    : DEFAULT_TIMEOUT_MS
  const outDir = join(root, 'reference')
  await mkdir(outDir, { recursive: true })
  let downloaded = 0
  let failed = 0
  for (const { file, url } of ASSETS) {
    const dest = join(outDir, file)
    if (!force && (await exists(dest))) {
      console.log(`· skip  ${file} (already present)`)
      continue
    }
    process.stdout.write(`↓ fetch ${file} … `)
    try {
      const bytes = await fetchAsset(url, timeoutMs)
      await writeFile(dest, bytes)
      console.log(`${(bytes.length / 1e6).toFixed(1)} MB`)
      downloaded += 1
    } catch (error) {
      console.error(`FAILED ${error.message}\n        ${url}`)
      failed += 1
    }
  }
  console.log(`\nReference material is in ./reference (${downloaded} downloaded, gitignored).`)
  return { downloaded, failed }
}
