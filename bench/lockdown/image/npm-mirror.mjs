#!/usr/bin/env node
// The offline npm mirror a protocol-3 candidate installs from.
//
// A candidate has no internet. Its packages come from a fixed set of tarballs
// baked into the candidate image at build time, each one checked against the
// sha512 recorded in npm-mirror.lock.json, and served to pnpm from loopback
// inside the box. Nothing is fetched at run time, so there is no registry to
// read from: what a candidate can install is exactly what the lock names.
//
//   build   (image build, has network)  download and verify every tarball the
//           lock names for linux, write one packument per package
//   serve   (inside the box, no network) answer registry requests from disk
//   verify  re-hash a built mirror against its lock
//
// One file with no dependencies: it runs in the image build, in the box, and
// under `node --test`.
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

export const REGISTRY_PORT = 4874
export const REGISTRY_URL = `http://127.0.0.1:${REGISTRY_PORT}/`
export const MIRROR_ROOT = '/opt/stagebench/npm-mirror'

// Recorded audio is what the sample pack is for. A mirrored tarball that
// carried any would be a second, unreviewed source of samples.
export const AUDIO_EXTENSIONS = ['.wav', '.flac', '.mp3', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.aif', '.aiff', '.sf2', '.sf3', '.sfz', '.webm', '.caf', '.wma']

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')

// `@scope/name` → `name`; the registry's own tarball file naming.
export function tarballFile(name, version) {
  return `${name.slice(name.lastIndexOf('/') + 1)}-${version}.tgz`
}

export function tarballRelativePath(name, version) {
  return `${name}/-/${tarballFile(name, version)}`
}

// Does a package version install on the platforms the image is built for?
// Optional platform binaries for anything else are listed (pnpm needs their
// metadata to skip them) but their tarballs are not mirrored.
export function matchesPlatform(manifest, platforms) {
  const allows = (declared, wanted) => {
    if (!Array.isArray(declared) || declared.length === 0) return true
    const negated = declared.filter((entry) => entry.startsWith('!')).map((entry) => entry.slice(1))
    const positive = declared.filter((entry) => !entry.startsWith('!'))
    return wanted.some((value) => !negated.includes(value) && (positive.length === 0 || positive.includes(value)))
  }
  return allows(manifest.os, platforms.os) && allows(manifest.cpu, platforms.cpu) && allows(manifest.libc, platforms.libc)
}

// Numeric semver ordering, enough to name a `latest` among mirrored versions.
export function compareVersions(left, right) {
  const parse = (value) => {
    const [core, pre = ''] = String(value).split('+')[0].split(/-(.*)/s)
    return { parts: core.split('.').map((part) => Number(part) || 0), pre }
  }
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < 3; index += 1) {
    if ((a.parts[index] ?? 0) !== (b.parts[index] ?? 0)) return (a.parts[index] ?? 0) - (b.parts[index] ?? 0)
  }
  if (a.pre === b.pre) return 0
  if (!a.pre) return 1
  if (!b.pre) return -1
  return a.pre < b.pre ? -1 : 1
}

// The packument pnpm resolves against: only mirrored versions exist, and every
// tarball URL points at the loopback registry.
export function packumentFor(name, entry, registryUrl = REGISTRY_URL) {
  const base = registryUrl.replace(/\/+$/, '')
  const versions = {}
  const time = {}
  for (const [version, record] of Object.entries(entry.versions)) {
    versions[version] = {
      ...record.manifest,
      name,
      version,
      dist: { integrity: record.integrity, ...(record.shasum ? { shasum: record.shasum } : {}), tarball: `${base}/${tarballRelativePath(name, version)}` },
    }
    if (record.time) time[version] = record.time
  }
  const stamps = Object.values(time).sort()
  return {
    name,
    'dist-tags': { latest: entry.latest },
    versions,
    time: { ...(stamps.length ? { created: stamps[0], modified: stamps.at(-1) } : {}), ...time },
  }
}

export function integrityOf(buffer) {
  return `sha512-${crypto.createHash('sha512').update(buffer).digest('base64')}`
}

// File names inside a gzipped tarball, without unpacking it to disk.
export function tarEntries(gzipped) {
  const buffer = zlib.gunzipSync(gzipped)
  const entries = []
  let longName = null
  for (let offset = 0; offset + 512 <= buffer.length;) {
    const header = buffer.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const text = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '')
    const size = parseInt(text(124, 12).trim() || '0', 8) || 0
    const type = String.fromCharCode(header[156] || 48)
    const prefix = text(345, 155)
    const name = longName ?? (prefix ? `${prefix}/${text(0, 100)}` : text(0, 100))
    longName = null
    const body = buffer.subarray(offset + 512, offset + 512 + size)
    if (type === 'L') longName = body.toString('utf8').replace(/\0.*$/s, '')
    else if (type === 'x') {
      const match = /\d+ path=([^\n]*)\n/.exec(body.toString('utf8'))
      if (match) longName = match[1]
    } else if (type === '0' || type === '\0') entries.push({ name, size })
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return entries
}

export function audioEntries(gzipped) {
  return tarEntries(gzipped).filter((entry) => AUDIO_EXTENSIONS.includes(path.extname(entry.name).toLowerCase()))
}

export function lockDigest(lockText) {
  return sha256(lockText)
}

// Every (name, version) whose tarball belongs in the mirror.
export function mirroredTarballs(lock) {
  const list = []
  for (const [name, entry] of Object.entries(lock.packages)) {
    for (const [version, record] of Object.entries(entry.versions)) {
      if (record.tarball) list.push({ name, version, integrity: record.integrity, bytes: record.bytes ?? null })
    }
  }
  return list.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`))
}

async function download(url, { retries = 4 } = {}) {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: 'follow' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      lastError = error
      await new Promise((done) => setTimeout(done, 500 * (attempt + 1)))
    }
  }
  throw new Error(`Could not download ${url}: ${lastError?.message}`)
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

// Build the mirror directory from a lock. `cacheDir` lets the maintainer's
// lock step and a local test reuse downloads; the image build has none.
export async function buildMirror({ lockPath, outDir, cacheDir = null, log = (line) => process.stderr.write(`${line}\n`) }) {
  const lockText = fs.readFileSync(lockPath, 'utf8')
  const lock = JSON.parse(lockText)
  const tarballs = mirroredTarballs(lock)
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(path.join(outDir, 'packuments'), { recursive: true })
  let bytes = 0
  let done = 0
  await pool(tarballs, 12, async (item) => {
    const relative = tarballRelativePath(item.name, item.version)
    const cached = cacheDir ? path.join(cacheDir, relative) : null
    let buffer = cached && fs.existsSync(cached) ? fs.readFileSync(cached) : null
    if (buffer && integrityOf(buffer) !== item.integrity) buffer = null
    if (!buffer) {
      buffer = await download(`${lock.registry}/${relative}`)
      if (cached) {
        fs.mkdirSync(path.dirname(cached), { recursive: true })
        fs.writeFileSync(cached, buffer)
      }
    }
    if (integrityOf(buffer) !== item.integrity) throw new Error(`${item.name}@${item.version}: the downloaded tarball does not match the sha512 in the lock`)
    if (item.bytes !== null && item.bytes !== buffer.length) throw new Error(`${item.name}@${item.version}: ${buffer.length} bytes, the lock says ${item.bytes}`)
    const target = path.join(outDir, 'tarballs', relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, buffer)
    bytes += buffer.length
    done += 1
    if (done % 100 === 0) log(`  ${done}/${tarballs.length} tarballs`)
  })
  for (const [name, entry] of Object.entries(lock.packages)) {
    fs.writeFileSync(path.join(outDir, 'packuments', `${encodeURIComponent(name)}.json`), JSON.stringify(packumentFor(name, entry)))
  }
  const requested = Object.keys(lock.requested ?? {}).sort()
  const manifest = {
    version: 1,
    lockSha256: lockDigest(lockText),
    registry: lock.registry,
    platforms: lock.platforms,
    packages: Object.keys(lock.packages).length,
    versions: Object.values(lock.packages).reduce((total, entry) => total + Object.keys(entry.versions).length, 0),
    tarballs: tarballs.length,
    bytes,
  }
  fs.writeFileSync(path.join(outDir, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  fs.writeFileSync(path.join(outDir, 'PACKAGES.md'), packagesDocument(lock, requested))
  log(`mirror: ${manifest.packages} packages, ${manifest.tarballs} tarballs, ${(bytes / 1024 / 1024).toFixed(1)} MB`)
  return manifest
}

// The list a candidate is shown: what it can `pnpm add`, and at which version.
export function packagesDocument(lock, requested = Object.keys(lock.requested ?? {}).sort()) {
  const lines = [
    '# Packages available offline',
    '',
    'This workspace has no internet. `pnpm install` and `pnpm add <name>` resolve against a fixed mirror inside the box,',
    'so only the packages below (and their dependencies) can be installed, at these versions. Anything else fails with',
    '`404`; do not retry it, choose from this list or write the code yourself.',
    '',
    '| Package | Version |',
    '| --- | --- |',
  ]
  for (const name of requested) {
    const entry = lock.packages[name]
    if (entry) lines.push(`| \`${name}\` | ${Object.keys(entry.versions).sort(compareVersions).join(', ')} |`)
  }
  lines.push('', `Plus ${Object.keys(lock.packages).length - requested.filter((name) => lock.packages[name]).length} transitive dependencies. Chromium for Playwright ${lock.pinned?.playwright ?? ''} is already installed; no browser download is needed or possible.`, '')
  return lines.join('\n')
}

export function verifyMirror({ lockPath, root }) {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
  const problems = []
  for (const item of mirroredTarballs(lock)) {
    const file = path.join(root, 'tarballs', tarballRelativePath(item.name, item.version))
    if (!fs.existsSync(file)) problems.push(`${item.name}@${item.version}: missing`)
    else if (integrityOf(fs.readFileSync(file)) !== item.integrity) problems.push(`${item.name}@${item.version}: sha512 mismatch`)
  }
  return problems
}

// --- the loopback registry ---------------------------------------------------

function notFound(response, what) {
  const body = JSON.stringify({ error: `not found: ${what}. This workspace is offline; only the packages in ${MIRROR_ROOT}/PACKAGES.md can be installed.` })
  response.writeHead(404, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
  response.end(body)
}

export function serveMirror({ root = MIRROR_ROOT, port = REGISTRY_PORT, host = '127.0.0.1' } = {}) {
  const packuments = path.join(root, 'packuments')
  const tarballs = path.join(root, 'tarballs')
  const server = http.createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { 'content-type': 'application/json' }).end('{"error":"the offline mirror is read-only"}')
      return
    }
    let pathname
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    } catch {
      response.writeHead(400).end()
      return
    }
    if (pathname === '/-/ping') {
      response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
      return
    }
    if (pathname.includes('\0') || /(^|\/)\.\.(\/|$)/.test(pathname)) return notFound(response, 'path')
    const tarball = /^\/((?:@[^/]+\/)?[^/@][^/]*)\/-\/([^/]+\.tgz)$/.exec(pathname)
    if (tarball) {
      const file = path.join(tarballs, tarball[1], '-', tarball[2])
      if (!file.startsWith(`${tarballs}${path.sep}`) || !fs.existsSync(file)) return notFound(response, `${tarball[1]}/-/${tarball[2]}`)
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': fs.statSync(file).size })
      if (request.method === 'HEAD') response.end()
      else fs.createReadStream(file).pipe(response)
      return
    }
    const match = /^\/((?:@[^/]+\/)?[^/@][^/]*)(?:\/([^/]+))?$/.exec(pathname)
    if (!match) return notFound(response, pathname)
    const file = path.join(packuments, `${encodeURIComponent(match[1])}.json`)
    if (!file.startsWith(`${packuments}${path.sep}`) || !fs.existsSync(file)) return notFound(response, match[1])
    let body = fs.readFileSync(file)
    if (match[2]) {
      // `/<name>/<version-or-tag>`: one version's manifest.
      const packument = JSON.parse(body)
      const version = packument['dist-tags'][match[2]] ?? match[2]
      if (!packument.versions[version]) return notFound(response, `${match[1]}@${match[2]}`)
      body = Buffer.from(JSON.stringify(packument.versions[version]))
    }
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': body.length })
    response.end(request.method === 'HEAD' ? undefined : body)
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => resolve({ port: server.address().port, close: () => new Promise((done) => server.close(done)) }))
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2)
  const option = (name, fallback) => (rest.includes(`--${name}`) ? rest[rest.indexOf(`--${name}`) + 1] : fallback)
  try {
    if (command === 'build') {
      await buildMirror({ lockPath: option('lock'), outDir: option('out', MIRROR_ROOT), cacheDir: option('cache', null) })
    } else if (command === 'serve') {
      await serveMirror({ root: option('root', MIRROR_ROOT), port: Number(option('port', REGISTRY_PORT)) })
    } else if (command === 'verify') {
      const problems = verifyMirror({ lockPath: option('lock'), root: option('root', MIRROR_ROOT) })
      if (problems.length > 0) throw new Error(`mirror does not match its lock:\n${problems.slice(0, 20).join('\n')}`)
      process.stdout.write('mirror matches its lock\n')
    } else {
      throw new Error('usage: npm-mirror.mjs <build --lock <file> --out <dir> | serve [--root <dir>] [--port N] | verify --lock <file> [--root <dir>]>')
    }
  } catch (error) {
    process.stderr.write(`npm-mirror: ${error.message}\n`)
    process.exit(1)
  }
}
