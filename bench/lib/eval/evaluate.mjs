// Evaluator-side helpers: the active rubric, assessment templates, and the
// technical checks rerun at scoring time. Everything here operates on a
// sealed stage directory and never imports run state or writes run.json —
// the CLI bridges the two sides.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readJson } from '../shared.mjs'
import { validateRubric } from './scoring.mjs'

export function loadRubric() {
  const rubricPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'rubric.json')
  return validateRubric(readJson(rubricPath))
}

function outputTail(value, length = 1600) {
  return String(value || '').trim().slice(-length)
}

// Rerun the package gates against the sealed artifact so the recorded score
// reflects checks the scorer executed, not checks the candidate claimed.
export function runTechnicalChecks(stageDir, rubric) {
  const packagePath = path.join(stageDir, 'package.json')
  if (!fs.existsSync(packagePath)) {
    return [{ id: 'artifact', label: 'Runnable phase artifact', passed: false, detail: `Missing ${packagePath}` }]
  }
  const packageJson = readJson(packagePath)
  const checks = rubric.technicalGate.requiredChecks.map((script) => {
    if (!packageJson.scripts?.[script]) {
      return { id: script, label: script, passed: false, detail: `Missing package script: ${script}` }
    }
    const startedAt = Date.now()
    const result = spawnSync('pnpm', ['run', script], {
      cwd: stageDir,
      encoding: 'utf8',
      timeout: 240_000,
      env: { ...process.env, CI: '1' },
    })
    const passed = result.status === 0 && !result.error
    return {
      id: script,
      label: script,
      passed,
      durationMs: Date.now() - startedAt,
      detail: passed ? 'Passed' : outputTail(result.stderr || result.stdout || result.error?.message),
    }
  })
  const artifactPath = path.join(stageDir, 'dist', 'index.html')
  checks.push({
    id: 'artifact',
    label: 'Built phase artifact',
    passed: fs.existsSync(artifactPath),
    detail: fs.existsSync(artifactPath) ? 'dist/index.html present' : 'Missing dist/index.html',
  })
  return checks
}

export function skippedTechnicalChecks(stageDir, rubric) {
  const artifactPath = path.join(stageDir, 'dist', 'index.html')
  return [
    ...rubric.technicalGate.requiredChecks.map((id) => ({ id, label: id, passed: true, detail: 'Skipped by explicit option' })),
    { id: 'artifact', label: 'Built phase artifact', passed: fs.existsSync(artifactPath), detail: fs.existsSync(artifactPath) ? 'dist/index.html present' : 'Missing dist/index.html' },
  ]
}
