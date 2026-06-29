import assert from 'node:assert/strict'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')
const script = path.join(root, '.agents', 'skills', 'run-nord-benchmark', 'scripts', 'manage-run.mjs')

test('run manager publishes a completed phase while later phases remain queued', () => {
  const result = spawnSync(process.execPath, [script, 'self-test'], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /"ok": true/)
})
