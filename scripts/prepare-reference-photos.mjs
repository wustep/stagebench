#!/usr/bin/env node
/**
 * Ensure Nord product photos are available for the gallery overlay:
 *   1. Prefer committed JPGs under ./reference (and public/reference)
 *   2. Fetch missing photos via pnpm bench fetch --photos-only (CDN fallback)
 *   3. Copy JPGs into public/reference/ for Vite build output + middleware
 *
 * Photos are copyrighted by Clavia DMI AB; JPGs are stored in-repo for
 * overlay reliability. Safe to run on every build; skips downloads when present.
 */
import { access, cp, mkdir, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchReference } from '../bench/lib/fetch-reference.mjs'
import { REFERENCE_PHOTOS } from '../bench/lib/reference-assets.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'reference')
const destDir = join(root, 'public', 'reference')

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const missingInReference = []
for (const name of Object.keys(REFERENCE_PHOTOS)) {
  if (!(await exists(join(srcDir, name)))) missingInReference.push(name)
}

if (missingInReference.length > 0) {
  console.log(
    `prepare-reference-photos: ${missingInReference.length} JPG(s) missing from reference/; fetching…`,
  )
  const result = await fetchReference(root, { photosOnly: true })
  if (result.failed > 0) {
    console.warn(
      `prepare-reference-photos: ${result.failed} fetch(es) failed; copying any local JPGs`,
    )
  }
} else {
  console.log('prepare-reference-photos: committed reference/ JPGs present; skipping fetch')
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
  console.log(`Prepared ${copied} reference photo(s) under public/reference/.`)
}
