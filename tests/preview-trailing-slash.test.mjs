import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'))

test('vercel.json redirects bare preview stage URLs to trailing-slash form', () => {
  // Published builds use relative ./assets paths. A URL without a trailing
  // slash makes the browser resolve assets one directory too high
  // (/previews/<run>/assets/...) → 404 blank page. Chat clients and copy/paste
  // routinely strip the trailing slash, so production must 308 to the slash.
  const redirects = vercel.redirects ?? []
  const stage = redirects.find((r) => r.source === '/previews/:run/:stage(stage[1-3])')
  assert.ok(stage, 'missing /previews/:run/:stage redirect')
  assert.equal(stage.destination, '/previews/:run/:stage/')
  assert.equal(stage.permanent, true)

  const showcase = redirects.find((r) => r.source === '/previews/showcase')
  assert.ok(showcase, 'missing /previews/showcase redirect')
  assert.equal(showcase.destination, '/previews/showcase/')
  assert.equal(showcase.permanent, true)
})
