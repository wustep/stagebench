#!/usr/bin/env node
/**
 * Ensure Nord product photos are available for the gallery overlay:
 *   1. Fetch into gitignored ./reference (via pnpm bench fetch --photos-only)
 *   2. Copy JPGs into public/reference/ so Vite's build output + Vercel
 *      middleware can serve them without a live upstream CDN request.
 *
 * Photos remain copyrighted by Clavia DMI AB — never commit public/reference/
 * or ./reference/. Safe to run on every build; skips downloads when present.
 */
import { cp, mkdir, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchReference } from '../bench/lib/fetch-reference.mjs'
import { REFERENCE_PHOTOS } from '../bench/lib/reference-assets.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'reference')
const destDir = join(root, 'public', 'reference')

const result = await fetchReference(root, { photosOnly: true })
if (result.failed > 0) {
  // Local copies may still exist from a prior fetch — copy whatever we have.
  console.warn(`prepare-reference-photos: ${result.failed} fetch(es) failed; copying any local JPGs`)
}

await mkdir(destDir, { recursive: true })
let copied = 0
for (const name of Object.keys(REFERENCE_PHOTOS)) {
  try {
    await cp(join(srcDir, name), join(destDir, name))
    copied += 1
    console.log(`· copy  ${name} → public/reference/`)
  } catch {
    console.warn(`· miss  ${name} (not in reference/; overlay may fall back to upstream)`)
  }
}

if (copied === 0) {
  const listing = await readdir(srcDir).catch(() => [])
  console.warn(
    `prepare-reference-photos: no photos copied (reference/ has: ${listing.join(', ') || 'nothing'}). Middleware will fall back to upstream.`,
  )
} else {
  console.log(`Prepared ${copied} reference photo(s) under public/reference/ (gitignored).`)
}
