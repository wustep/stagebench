// Small utilities shared by the run and eval sides of the bench CLI.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

// Transient workspaces (implementation candidates, evaluator copies, gate
// scratch) live OUTSIDE the repository tree so a candidate or evaluator agent
// cannot reach runs/, showcase/, or other solutions with a relative `../..`.
// The base defaults to ~/.stagebench and is overridable (tests point it at a
// temp dir). Keyed by the repo's absolute path so multiple checkouts do not
// collide.
export function stagebenchHome() {
  return process.env.STAGEBENCH_HOME || path.join(os.homedir(), '.stagebench')
}

export function repoKey(root) {
  const absolute = path.resolve(root)
  return `${path.basename(absolute)}-${sha256(absolute).slice(0, 8)}`
}

// Base directory for a class of transient workspace ('work', 'eval', 'gates').
export function workspaceRoot(root, kind) {
  return path.join(stagebenchHome(), repoKey(root), kind)
}

// Stable, non-reversible handle for a run used as its evaluator directory
// name, so the model identity (the run id) is not printed in the path the
// evaluator works in. Deterministic so the two `score` calls agree.
export function blindRunCode(id) {
  return `run-${sha256(`stagebench-eval:${id}`).slice(0, 12)}`
}

// Async replacement for spawnSync that streams the child's output as progress
// while still collecting it, enforces a timeout by sending SIGTERM (then
// SIGKILL) to the child, and forwards a parent SIGTERM/SIGINT to the child so
// Ctrl-C never orphans a candidate build. Resolves with the same
// { status, stdout, stderr, error } shape spawnSync returned, so callers keep
// their exit-code semantics unchanged.
export function runCommand(executable, args, options = {}) {
  const { timeout, onOutput, ...spawnOptions } = options
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(executable, args, { ...spawnOptions, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      resolve({ status: null, stdout: '', stderr: '', error })
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let timer = null
    let killTimer = null

    const forwardSignal = (signal) => child.kill(signal)
    process.on('SIGTERM', forwardSignal)
    process.on('SIGINT', forwardSignal)

    const cleanup = () => {
      if (timer) clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      process.off('SIGTERM', forwardSignal)
      process.off('SIGINT', forwardSignal)
    }

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      stdout += text
      onOutput?.(text)
    })
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      stderr += text
      onOutput?.(text)
    })

    if (typeof timeout === 'number' && timeout > 0) {
      timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
        // Match spawnSync: escalate to SIGKILL if the child ignores SIGTERM.
        killTimer = setTimeout(() => child.kill('SIGKILL'), 2000)
      }, timeout)
    }

    child.on('error', (error) => {
      if (settled) return
      settled = true
      cleanup()
      resolve({ status: null, stdout, stderr, error })
    })

    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      cleanup()
      resolve({
        status: code,
        signal,
        stdout,
        stderr,
        // spawnSync reports a timeout via an ETIMEDOUT error; mirror that so
        // callers that inspect result.error keep working.
        error: timedOut ? Object.assign(new Error(`Command timed out after ${timeout}ms`), { code: 'ETIMEDOUT' }) : undefined,
      })
    })
  })
}

export function parseArgs(argv) {
  const positional = []
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = argv[index + 1]
      if (next === undefined || next.startsWith('--')) {
        options[key] = 'true'
      } else {
        options[key] = next
        index += 1
      }
    } else {
      positional.push(token)
    }
  }
  return { positional, options }
}

export function findRepoRoot(start = process.cwd()) {
  let current = path.resolve(start)
  while (true) {
    if (fs.existsSync(path.join(current, 'BENCHMARK.md')) && fs.existsSync(path.join(current, 'package.json'))) return current
    const parent = path.dirname(current)
    if (parent === current) throw new Error('Could not find the Stagebench repository (looked for BENCHMARK.md + package.json)')
    current = parent
  }
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`)
  fs.renameSync(temporaryPath, filePath)
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function hashFile(filePath) {
  return sha256(fs.readFileSync(filePath))
}

// Deterministic digest of a directory tree (paths + contents), ignoring
// regenerable directories. Used to seal verified phase artifacts.
export function hashTree(directory, options = {}) {
  const ignored = new Set(options.ignored ?? ['node_modules', '.git', '.vite'])
  const files = []
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (ignored.has(entry.name)) continue
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) files.push(absolute)
    }
  }
  visit(directory)
  const hash = crypto.createHash('sha256')
  for (const file of files) {
    hash.update(path.relative(directory, file).split(path.sep).join('/'))
    hash.update('\0')
    hash.update(fs.readFileSync(file))
    hash.update('\0')
  }
  return { digest: hash.digest('hex'), files: files.length }
}

export function loadProtocol(root) {
  const manifest = path.join(root, 'specs', 'benchmark-phases.json')
  const value = readJson(manifest)
  if (value.phaseCount !== 3 || value.selectionMode !== 'cumulative-target') {
    throw new Error('The active protocol must define three cumulative target phases')
  }
  const numbers = value.phases?.map((phase) => phase.number)
  if (JSON.stringify(numbers) !== JSON.stringify([1, 2, 3])) {
    throw new Error('The active protocol phases must be ordered 1, 2, 3')
  }
  return { manifest, value, digest: hashFile(manifest) }
}

export function selectedPhases(protocol, targetPhase) {
  const target = Number(targetPhase)
  const phases = protocol.selection?.[String(target)]
  if (!Array.isArray(phases)) throw new Error('--target must be 1, 2, or 3')
  return [...phases]
}
