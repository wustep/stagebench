// Evaluator-side helpers: the active rubric, assessment templates, and the
// technical checks rerun at scoring time. Everything here operates on a
// sealed stage directory and never imports run state or writes run.json —
// the CLI bridges the two sides.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readJson, runCommand } from '../shared.mjs'
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
export async function runTechnicalChecks(stageDir, rubric) {
  const packagePath = path.join(stageDir, 'package.json')
  if (!fs.existsSync(packagePath)) {
    return [{ id: 'artifact', label: 'Runnable phase artifact', passed: false, detail: `Missing ${packagePath}` }]
  }
  const packageJson = readJson(packagePath)
  const checks = []
  for (const script of rubric.technicalGate.requiredChecks) {
    if (!packageJson.scripts?.[script]) {
      checks.push({ id: script, label: script, passed: false, detail: `Missing package script: ${script}` })
      continue
    }
    const startedAt = Date.now()
    process.stderr.write(`  · ${script} … `)
    const result = await runCommand('pnpm', ['run', script], {
      cwd: stageDir,
      timeout: 240_000,
      env: { ...process.env, CI: '1' },
      onOutput: (text) => process.stderr.write(text),
    })
    const passed = result.status === 0 && !result.error
    process.stderr.write(passed ? `${script} passed\n` : `${script} failed\n`)
    checks.push({
      id: script,
      label: script,
      passed,
      durationMs: Date.now() - startedAt,
      detail: passed ? 'Passed' : outputTail(result.stderr || result.stdout || result.error?.message),
    })
  }
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
