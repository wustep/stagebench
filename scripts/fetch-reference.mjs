#!/usr/bin/env node
// Fetches Nord Stage 4 reference material (user manual + official product
// photos) from Clavia's own servers into ./reference, which is gitignored.
//
// These are third-party copyrighted works owned by Clavia DMI AB. They are
// deliberately NOT redistributed in this repository — the benchmark fetches
// them from the manufacturer's official URLs for local evaluation only.
//
// Usage:
//   pnpm fetch:reference            download anything missing
//   pnpm fetch:reference --force    re-download everything
import { access, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'reference')

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

const force = process.argv.includes('--force')
const exists = (path) => access(path).then(() => true, () => false)

await mkdir(outDir, { recursive: true })

let downloaded = 0
for (const { file, url } of ASSETS) {
  const dest = join(outDir, file)
  if (!force && (await exists(dest))) {
    console.log(`· skip  ${file} (already present)`)
    continue
  }

  process.stdout.write(`↓ fetch ${file} … `)
  const response = await fetch(url)
  if (!response.ok) {
    console.error(`FAILED ${response.status} ${response.statusText}\n        ${url}`)
    process.exitCode = 1
    continue
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  await writeFile(dest, bytes)
  console.log(`${(bytes.length / 1e6).toFixed(1)} MB`)
  downloaded++
}

console.log(`\nReference material is in ./reference (${downloaded} downloaded, gitignored).`)
