import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { readJson } from './cli.mjs'

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function hashFile(filePath) {
  return sha256(fs.readFileSync(filePath))
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
  if (!Array.isArray(phases)) throw new Error('--target-phase must be 1, 2, or 3')
  return [...phases]
}

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
