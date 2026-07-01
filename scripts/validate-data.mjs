#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { findRepoRoot } from '../.agents/skills/run-nord-benchmark/lib/cli.mjs'

const SCHEMA_FILES = [
  'protocol.schema.json',
  'run.schema.json',
  'telemetry.schema.json',
  'assessment.schema.json',
  'evaluation.schema.json',
  'verification.schema.json',
  'feature-matrix.schema.json',
  'implementation-details.schema.json',
  'registry.schema.json',
  'domain-spec.schema.json',
  'rubric.schema.json',
  'capture.schema.json',
  'blind-bundle.schema.json',
]

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function discover(directory, predicate, results = []) {
  if (!fs.existsSync(directory)) return results
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', '.vite'].includes(entry.name)) continue
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) discover(absolute, predicate, results)
    else if (entry.isFile() && predicate(absolute)) results.push(absolute)
  }
  return results
}

export function validateRepositoryData(root) {
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  addFormats(ajv)
  const schemas = Object.fromEntries(SCHEMA_FILES.map((file) => [file, readJson(path.join(root, 'schemas', file))]))
  for (const schema of Object.values(schemas)) ajv.addSchema(schema)
  const checks = []
  const validate = (schemaFile, file) => {
    const validator = ajv.getSchema(schemas[schemaFile].$id)
    const data = readJson(file)
    const passed = validator(data)
    checks.push({ schema: schemaFile, file: path.relative(root, file).split(path.sep).join('/'), passed, errors: passed ? [] : validator.errors })
  }

  validate('protocol.schema.json', path.join(root, 'specs', 'benchmark-phases.json'))
  validate('registry.schema.json', path.join(root, 'src', 'data', 'runs.json'))
  for (const file of ['nord-stage-4.visual.json', 'nord-stage-4.variants.json', 'nord-stage-4.piano.json', 'nord-stage-4.effects.json', 'nord-stage-4.programs.json', 'nord-stage-4.organ.json', 'nord-stage-4.synth.json']) validate('domain-spec.schema.json', path.join(root, 'specs', file))
  for (const file of ['v1.json', 'v2.json', 'v3.json']) validate('rubric.schema.json', path.join(root, 'evaluation', 'rubrics', file))
  for (const file of discover(path.join(root, 'runs'), (value) => path.basename(value) === 'run.json')) validate('run.schema.json', file)
  for (const file of discover(path.join(root, 'runs'), (value) => /evaluations\/stage\d+\.assessment\.json$/.test(value))) validate('assessment.schema.json', file)
  for (const file of discover(path.join(root, 'runs'), (value) => /evaluations\/stage\d+\.json$/.test(value))) validate('evaluation.schema.json', file)
  for (const file of discover(path.join(root, 'runs'), (value) => /verifications\/stage\d+\.json$/.test(value))) validate('verification.schema.json', file)
  for (const file of discover(path.join(root, 'runs'), (value) => path.basename(value) === 'feature-matrix.json')) validate('feature-matrix.schema.json', file)
  for (const file of discover(path.join(root, 'runs'), (value) => path.basename(value) === 'IMPLEMENTATION_DETAILS.json')) validate('implementation-details.schema.json', file)
  for (const file of discover(path.join(root, 'runs'), (value) => /evidence\/stage\d+-capture\.json$/.test(value))) validate('capture.schema.json', file)
  for (const file of discover(path.join(root, '.stagebench', 'blind'), (value) => path.basename(value) === 'bundle.json')) validate('blind-bundle.schema.json', file)

  const failed = checks.filter((check) => !check.passed)
  if (failed.length > 0) {
    const detail = failed.map((check) => `${check.file} (${check.schema}): ${ajv.errorsText(check.errors, { separator: '; ' })}`).join('\n')
    throw new Error(`Schema validation failed:\n${detail}`)
  }
  return { ok: true, checks: checks.length, files: checks.map((check) => check.file) }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    console.log(JSON.stringify(validateRepositoryData(findRepoRoot()), null, 2))
  } catch (error) {
    console.error(`validate-data: ${error.message}`)
    process.exitCode = 1
  }
}
