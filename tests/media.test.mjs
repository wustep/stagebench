import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// The homepage serves the countdown film from public/media/, a copy of the
// rendered recording/ output. Re-rendering the show must refresh the copy too.
test('public countdown film matches the rendered recording output', () => {
  const rendered = readFileSync(new URL('../recording/output/etude6-countdown.mp4', import.meta.url))
  const served = readFileSync(new URL('../public/media/etude6-countdown.mp4', import.meta.url))
  assert.ok(served.equals(rendered), 'cp recording/output/etude6-countdown.mp4 public/media/')
})
