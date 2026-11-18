// `pnpm bench offline-lock`: resolve the offline npm mirror and write its lock.
//
// A maintainer step, run with network, whenever bench/lockdown/offline/
// packages.json or the starter changes. It answers one question once, so that
// no candidate ever asks the registry anything: which exact tarballs can be
// installed inside the box?
//
//   1. Resolve the starter's dependencies plus the reviewed extras with pnpm
//      (lockfile only), seeded with the starter's own lockfile so the starter
//      installs frozen against the mirror.
//   2. For every resolved package version, record the registry's manifest, its
//      publish time, and its sha512.
//   3. Download each tarball that installs on linux (arm64 and x64, glibc),
//      verify it, record its size, and refuse any that ships audio.
//
// The result, bench/lockdown/image/npm-mirror.lock.json, is the whole
// definition of the mirror: the image build downloads exactly these tarballs
// and fails on any hash mismatch.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { audioEntries, compareVersions, integrityOf, matchesPlatform, tarballRelativePath } from '../image/npm-mirror.mjs'
import { stagebenchHome } from '../../lib/shared.mjs'

const HERE = import.meta.dirname
export const LOCK_PATH = path.join(HERE, '..', 'image', 'npm-mirror.lock.json')
export const PACKAGES_PATH = path.join(HERE, 'packages.json')
const REGISTRY = 'https://registry.npmjs.org'
const PLATFORMS = { os: ['linux'], cpu: ['arm64', 'x64'], libc: ['glibc'] }
const MANIFEST_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta', 'bundleDependencies', 'bundledDependencies', 'bin', 'engines', 'os', 'cpu', 'libc', 'hasInstallScript']

// The `packages:` section of a pnpm v9 lockfile: one entry per package version.
export function parseLockPackages(text) {
  const lines = text.split('\n')
  const start = lines.indexOf('packages:')
  if (start === -1) return []
  const packages = []
  let current = null
  const list = (value) => value.replace(/^\[|\]$/g, '').split(',').map((entry) => entry.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^\S/.test(line)) break
    const key = /^ {2}(['"]?)(\S.*)\1:\s*$/.exec(line)
    if (key && !line.startsWith('   ')) {
      const spec = key[2]
      const at = spec.lastIndexOf('@')
      current = { name: spec.slice(0, at), version: spec.slice(at + 1) }
      packages.push(current)
      continue
    }
    const property = /^ {4}(\w+): (.*)$/.exec(line)
    if (!current || !property) continue
    if (property[1] === 'resolution') {
      current.integrity = /integrity: ([^,}\s]+)/.exec(property[2])?.[1] ?? null
      current.nonRegistry = /\b(tarball|repo|commit|directory): /.test(property[2])
    } else if (['os', 'cpu', 'libc'].includes(property[1])) {
      current[property[1]] = list(property[2])
    }
  }
  return packages
}

async function pool(items, size, worker) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      await worker(items[index], index)
    }
  }))
}

async function fetchRetry(url, { retries = 4, json = false } = {}) {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      // A generic client name: the registry is told nothing about who is asking.
      const response = await fetch(url, { headers: { 'user-agent': 'npm-mirror-lock', accept: json ? 'application/json' : '*/*' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return json ? await response.json() : Buffer.from(await response.arrayBuffer())
    } catch (error) {
      lastError = error
      await new Promise((done) => setTimeout(done, 600 * (attempt + 1)))
    }
  }
  throw new Error(`${url}: ${lastError?.message}`)
}

export async function writeOfflineLock(root, { log = (line) => process.stderr.write(`${line}\n`) } = {}) {
  const config = JSON.parse(fs.readFileSync(PACKAGES_PATH, 'utf8'))
  const starterDir = path.join(root, 'bench', 'starter')
  const starter = JSON.parse(fs.readFileSync(path.join(starterDir, 'package.json'), 'utf8'))
  const starterLock = fs.readFileSync(path.join(starterDir, 'pnpm-lock.yaml'), 'utf8')
  const containerfile = fs.readFileSync(path.join(HERE, '..', 'image', 'Containerfile'), 'utf8')

  // The three places a version is pinned have to agree before anything is fetched.
  const arg = (name) => new RegExp(`^ARG ${name}=(\\S+)`, 'm').exec(containerfile)?.[1]
  const starterVitest = parseLockPackages(starterLock).find((entry) => entry.name === 'vitest')?.version
  const checks = [
    ['pnpm', config.pinned.pnpm, starter.packageManager?.replace(/^pnpm@/, ''), 'bench/starter/package.json packageManager'],
    ['pnpm', config.pinned.pnpm, arg('PNPM_VERSION'), 'Containerfile PNPM_VERSION'],
    ['playwright', config.pinned.playwright, arg('PLAYWRIGHT_VERSION'), 'Containerfile PLAYWRIGHT_VERSION'],
    ['vitest', config.pinned.vitest, starterVitest, 'bench/starter/pnpm-lock.yaml'],
  ]
  for (const [name, pinned, actual, where] of checks) {
    if (pinned !== actual) throw new Error(`${name} is pinned to ${pinned} in packages.json but ${where} says ${actual}`)
  }

  // --- 1. resolve ------------------------------------------------------------
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'stagebench-offline-lock-'))
  let resolved
  try {
    const { packageManager: _pinned, ...manifest } = starter
    const taken = new Set([...Object.keys(starter.dependencies ?? {}), ...Object.keys(starter.devDependencies ?? {})])
    manifest.devDependencies = { ...manifest.devDependencies, ...Object.fromEntries(Object.entries(config.packages).filter(([name]) => !taken.has(name))) }
    fs.writeFileSync(path.join(scratch, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    fs.writeFileSync(path.join(scratch, 'pnpm-lock.yaml'), starterLock)
    log('→ resolving the starter plus the reviewed extras (pnpm, lockfile only)')
    const result = spawnSync('pnpm', ['install', '--lockfile-only', '--ignore-scripts', '--no-frozen-lockfile'], { cwd: scratch, encoding: 'utf8', timeout: 600_000, env: { ...process.env, CI: '1' } })
    if (result.status !== 0) throw new Error(`pnpm could not resolve the list:\n${String(result.stderr || result.stdout).trim().slice(-3000)}`)
    resolved = parseLockPackages(fs.readFileSync(path.join(scratch, 'pnpm-lock.yaml'), 'utf8'))
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
  // The starter's own lockfile must install frozen, so its versions are in whatever pnpm chose to keep.
  const wanted = new Map()
  for (const entry of [...parseLockPackages(starterLock), ...resolved]) {
    if (entry.nonRegistry || !entry.integrity) throw new Error(`${entry.name}@${entry.version} does not come from the registry; only registry packages can be mirrored`)
    wanted.set(`${entry.name}@${entry.version}`, entry)
  }
  const byName = new Map()
  for (const entry of wanted.values()) {
    if (!byName.has(entry.name)) byName.set(entry.name, [])
    byName.get(entry.name).push(entry)
  }
  log(`→ ${wanted.size} package versions across ${byName.size} packages; reading registry metadata`)

  // --- 2. metadata -----------------------------------------------------------
  const packages = {}
  await pool([...byName.keys()].sort(), 10, async (name) => {
    const packument = await fetchRetry(`${REGISTRY}/${name.replace('/', '%2f')}`, { json: true })
    const versions = {}
    for (const entry of byName.get(name)) {
      const manifest = packument.versions?.[entry.version]
      if (!manifest) throw new Error(`${name}@${entry.version} is not in the registry`)
      if (manifest.dist?.integrity !== entry.integrity) throw new Error(`${name}@${entry.version}: the registry's sha512 differs from the one pnpm resolved`)
      if (!String(manifest.dist.tarball).endsWith(`/${tarballRelativePath(name, entry.version)}`)) throw new Error(`${name}@${entry.version} has a non-standard tarball URL: ${manifest.dist.tarball}`)
      versions[entry.version] = {
        integrity: entry.integrity,
        shasum: manifest.dist.shasum ?? null,
        time: packument.time?.[entry.version] ?? null,
        tarball: matchesPlatform(manifest, PLATFORMS),
        manifest: Object.fromEntries(MANIFEST_FIELDS.filter((field) => manifest[field] !== undefined).map((field) => [field, manifest[field]])),
      }
    }
    const sorted = Object.keys(versions).sort(compareVersions)
    packages[name] = { latest: sorted.at(-1), versions: Object.fromEntries(sorted.map((version) => [version, versions[version]])) }
  })

  // --- 3. tarballs -----------------------------------------------------------
  const cacheDir = path.join(stagebenchHome(), 'cache', 'npm-mirror')
  const tarballs = Object.entries(packages).flatMap(([name, entry]) => Object.entries(entry.versions).filter(([, record]) => record.tarball).map(([version, record]) => ({ name, version, record })))
  log(`→ downloading and verifying ${tarballs.length} linux tarballs (cache: ${cacheDir})`)
  const audio = {}
  let bytes = 0
  await pool(tarballs, 12, async ({ name, version, record }) => {
    const relative = tarballRelativePath(name, version)
    const cached = path.join(cacheDir, relative)
    let buffer = fs.existsSync(cached) ? fs.readFileSync(cached) : null
    if (!buffer || integrityOf(buffer) !== record.integrity) {
      buffer = await fetchRetry(`${REGISTRY}/${relative}`)
      fs.mkdirSync(path.dirname(cached), { recursive: true })
      fs.writeFileSync(cached, buffer)
    }
    if (integrityOf(buffer) !== record.integrity) throw new Error(`${name}@${version}: the tarball does not match its sha512`)
    record.bytes = buffer.length
    bytes += buffer.length
    const found = audioEntries(buffer)
    if (found.length > 0) audio[`${name}@${version}`] = { files: found.length, bytes: found.reduce((total, entry) => total + entry.size, 0), examples: found.slice(0, 3).map((entry) => entry.name) }
  })
  const exceptions = config.audioPolicy?.exceptions ?? {}
  const offenders = Object.entries(audio).filter(([spec, found]) => !exceptions[spec.slice(0, spec.lastIndexOf('@'))] && found.bytes > (config.audioPolicy?.maxAudioBytesPerPackage ?? 0))
  if (offenders.length > 0) {
    throw new Error(`These packages ship audio files, which the mirror does not allow (the sample pack is the only source of recordings). Remove them from packages.json or record a reviewed exception:\n${offenders.map(([spec, found]) => `  ${spec}: ${found.files} files, ${found.bytes} bytes (${found.examples.join(', ')})`).join('\n')}`)
  }

  const requested = Object.fromEntries(Object.entries({ ...starter.dependencies, ...starter.devDependencies, ...config.packages }).sort(([a], [b]) => a.localeCompare(b)))
  const missing = Object.keys(requested).filter((name) => !packages[name])
  if (missing.length > 0) throw new Error(`Requested but not resolved: ${missing.join(', ')}`)
  const lock = {
    lockVersion: 1,
    registry: REGISTRY,
    resolvedAt: new Date().toISOString().slice(0, 10),
    platforms: PLATFORMS,
    pinned: config.pinned,
    requested,
    totals: { packages: Object.keys(packages).length, versions: wanted.size, tarballs: tarballs.length, bytes },
    audioExceptions: Object.fromEntries(Object.entries(audio).map(([spec, found]) => [spec, { ...found, reason: exceptions[spec.slice(0, spec.lastIndexOf('@'))] ?? null }])),
    packages: Object.fromEntries(Object.keys(packages).sort().map((name) => [name, packages[name]])),
  }
  fs.writeFileSync(LOCK_PATH, `${JSON.stringify(lock, null, 1)}\n`)
  return { lock: path.relative(root, LOCK_PATH), ...lock.totals, megabytes: Number((bytes / 1024 / 1024).toFixed(1)), requested: Object.keys(requested).length, cache: cacheDir, next: 'pnpm bench lockdown-setup   (rebuilds the candidate image with the new mirror)' }
}
