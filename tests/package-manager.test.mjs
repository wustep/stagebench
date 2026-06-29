import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')

test('root and every implemented benchmark phase use pnpm exclusively', () => {
  const projectDirs = [root]
  const runsDir = path.join(root, 'runs')
  for (const runEntry of fs.readdirSync(runsDir, { withFileTypes: true })) {
    if (!runEntry.isDirectory()) continue
    const runDir = path.join(runsDir, runEntry.name)
    for (const phaseEntry of fs.readdirSync(runDir, { withFileTypes: true })) {
      if (phaseEntry.isDirectory() && /^stage[1-4]$/.test(phaseEntry.name) && fs.existsSync(path.join(runDir, phaseEntry.name, 'package.json'))) {
        projectDirs.push(path.join(runDir, phaseEntry.name))
      }
    }
  }

  for (const projectDir of projectDirs) {
    const label = path.relative(root, projectDir) || 'root'
    const packageJson = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'))
    assert.match(packageJson.packageManager ?? '', /^pnpm@/, `${label} must declare pnpm as packageManager`)
    assert.ok(fs.existsSync(path.join(projectDir, 'pnpm-lock.yaml')), `${label} must contain pnpm-lock.yaml`)
    assert.ok(!fs.existsSync(path.join(projectDir, 'package-lock.json')), `${label} must not contain package-lock.json`)
    assert.ok(!fs.existsSync(path.join(projectDir, 'yarn.lock')), `${label} must not contain yarn.lock`)
  }
})
