// The container runtime the lockdown runs on, and the handful of primitives
// everything else is built from. Podman and Docker share a CLI for all of
// them, so the same code drives a local Podman machine, Docker Desktop, Colima,
// a Linux host, or a remote engine on another machine — nothing here uses a
// bind mount, so the engine never needs to see the operator's filesystem.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const IMAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'image')
export const EGRESS_NETWORK = 'stagebench-egress'
// The dedicated Podman machine `pnpm bench lockdown-setup` creates: no host
// directories are shared into it, so even a container escape lands in a VM
// that cannot see the operator's disk.
export const PODMAN_MACHINE = 'stagebench'

function probe(bin, prefix) {
  const result = spawnSync(bin, [...prefix, 'version', '--format', '{{.Server.Version}}'], { encoding: 'utf8', timeout: 30_000 })
  if (result.status !== 0 || result.error) return null
  return result.stdout.trim()
}

// STAGEBENCH_CONTAINER_RUNTIME wins ("docker", "podman --connection other").
// Otherwise prefer the dedicated no-host-mounts Podman machine, then whatever
// Podman or Docker engine answers.
export function detectRuntime(env = process.env) {
  const explicit = env.STAGEBENCH_CONTAINER_RUNTIME?.trim()
  const candidates = explicit
    ? [explicit.split(/\s+/)]
    : [['podman', '--connection', PODMAN_MACHINE], ['podman'], ['docker']]
  for (const [bin, ...prefix] of candidates) {
    const version = probe(bin, prefix)
    if (version) return { bin, prefix, kind: path.basename(bin).includes('podman') ? 'podman' : 'docker', version, explicit: Boolean(explicit) }
  }
  return null
}

export function requireRuntime(env = process.env) {
  const runtime = detectRuntime(env)
  if (!runtime) {
    throw new Error([
      'Lockdown needs a container runtime, and none answered.',
      'Run `pnpm bench lockdown-setup` (it creates a dedicated Podman machine with no host directories shared),',
      'or point STAGEBENCH_CONTAINER_RUNTIME at a working engine, e.g. "docker" or "podman --connection <name>".',
    ].join(' '))
  }
  return runtime
}

// Can the engine's own machine read the operator's disk? Containers are given
// no mounts either way; this is the second wall. A candidate must never run on
// a host where the repository or sibling workspaces are readable, and the only
// way to make that true of a container escape as well is for the VM underneath
// to have nothing of the host in it.
//   none     verified: the operator's home directory does not exist in the VM
//   shared   verified: it does (Podman's default machine shares /Users)
//   unknown  this engine cannot be asked (Docker Desktop, a remote host, …)
export function hostExposure(runtime) {
  if (runtime.kind === 'podman' && runtime.prefix.includes(PODMAN_MACHINE)) {
    const probe = spawnSync(runtime.bin, ['machine', 'ssh', PODMAN_MACHINE, `test -e ${JSON.stringify(os.homedir())} && echo shared || echo absent`], { encoding: 'utf8', timeout: 30_000 })
    if (probe.status === 0 && probe.stdout.includes('absent')) return { state: 'none', detail: 'the engine VM cannot see the operator\'s home directory' }
    if (probe.status === 0 && probe.stdout.includes('shared')) return { state: 'shared', detail: `the engine VM mounts ${os.homedir()}; recreate it with \`podman machine rm ${PODMAN_MACHINE}\` and \`pnpm bench lockdown-setup\`` }
  }
  return { state: 'unknown', detail: 'this engine cannot be asked whether its VM shares host directories; containers still receive no mounts' }
}

// Synchronous engine call. Returns { status, stdout, stderr }; throws only when
// `check` is set and the call failed.
export function engine(runtime, args, { input, check = false, timeout = 120_000, encoding = 'utf8', env } = {}) {
  // `env` adds variables to the engine CLI's own environment, for values that
  // must not appear on a command line (`-e NAME` then forwards them by name).
  const result = spawnSync(runtime.bin, [...runtime.prefix, ...args], { input, encoding, timeout, maxBuffer: 256 * 1024 * 1024, ...(env ? { env: { ...process.env, ...env } } : {}) })
  const output = { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error }
  if (check && (result.status !== 0 || result.error)) {
    throw new Error(`${runtime.bin} ${args.slice(0, 3).join(' ')} failed: ${String(result.stderr || result.error?.message || '').trim().slice(-1200)}`)
  }
  return output
}

// Streaming engine call. Output is forwarded to `onOutput` (and collected);
// with `inherit`, the child owns the terminal (interactive TUIs).
export function engineStream(runtime, args, { onOutput, inherit = false, stdin, timeout, onSpawn, onTimeout } = {}) {
  return new Promise((resolve) => {
    const child = spawn(runtime.bin, [...runtime.prefix, ...args], {
      stdio: inherit ? 'inherit' : [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    })
    onSpawn?.(child)
    let output = ''
    let timedOut = false
    let timer = null
    if (!inherit) {
      const collect = (chunk) => {
        const text = chunk.toString()
        // Keep the tail only: a long agent session can print for hours.
        output = (output + text).slice(-4 * 1024 * 1024)
        onOutput?.(text)
      }
      child.stdout.on('data', collect)
      child.stderr.on('data', collect)
      if (stdin !== undefined) child.stdin.end(stdin)
    }
    let killer = null
    if (typeof timeout === 'number' && timeout > 0) {
      timer = setTimeout(() => {
        timedOut = true
        // The client only relays the signal; a process in the container can
        // ignore it. `onTimeout` is where the caller removes the container, and
        // the client itself is killed if it still has not gone.
        child.kill('SIGTERM')
        try { onTimeout?.() } catch { /* best effort */ }
        killer = setTimeout(() => child.kill('SIGKILL'), 15_000)
      }, timeout)
    }
    child.on('error', (error) => {
      if (timer) clearTimeout(timer)
      resolve({ status: null, output, error })
    })
    child.on('close', (status, signal) => {
      if (timer) clearTimeout(timer)
      if (killer) clearTimeout(killer)
      resolve({ status, signal, output, timedOut })
    })
  })
}

// Content-addressed image tags: the tag is a digest of the image directory, so
// editing the Containerfile, the gateway, or the entrypoint yields new images,
// and a tag recorded at seal names exactly what ran.
export function imageContextDigest(directory = IMAGE_DIR) {
  const hash = crypto.createHash('sha256')
  for (const name of fs.readdirSync(directory).sort()) {
    const file = path.join(directory, name)
    if (!fs.statSync(file).isFile()) continue
    hash.update(name).update('\0').update(fs.readFileSync(file)).update('\0')
  }
  return hash.digest('hex')
}

export function imageTags(directory = IMAGE_DIR, env = process.env) {
  const digest = imageContextDigest(directory).slice(0, 12)
  return {
    digest,
    candidate: env.STAGEBENCH_LOCKDOWN_CANDIDATE_IMAGE || `stagebench-lockdown-candidate:${digest}`,
    gateway: env.STAGEBENCH_LOCKDOWN_GATEWAY_IMAGE || `stagebench-lockdown-gateway:${digest}`,
  }
}

function imageId(runtime, tag) {
  const result = engine(runtime, ['image', 'inspect', '--format', '{{.Id}}', tag])
  return result.status === 0 ? result.stdout.trim() : null
}

// Build whichever image is missing. `onOutput` receives build progress.
export async function ensureImages(runtime, { onOutput, rebuild = false, buildArgs = {} } = {}) {
  const tags = imageTags()
  const images = {}
  for (const target of ['gateway', 'candidate']) {
    let id = rebuild ? null : imageId(runtime, tags[target])
    if (!id) {
      onOutput?.(`→ building ${tags[target]} (first build downloads Chromium and the harness CLIs; expect a few minutes)\n`)
      const args = ['build', '--target', target, '-t', tags[target], '-f', path.join(IMAGE_DIR, 'Containerfile')]
      for (const [key, value] of Object.entries(buildArgs)) args.push('--build-arg', `${key}=${value}`)
      args.push(IMAGE_DIR)
      const built = await engineStream(runtime, args, { onOutput, timeout: 45 * 60_000 })
      if (built.status !== 0) throw new Error(`Building ${tags[target]} failed:\n${built.output.slice(-3000)}`)
      id = imageId(runtime, tags[target])
    }
    images[target] = { tag: tags[target], id }
  }
  return images
}

// A minimal ustar writer for small generated files (harness config,
// credentials). It exists so secrets go straight from memory into a volume and
// never land in a temp file on the host.
export function tarBuffer(files) {
  const blocks = []
  const header = ({ name, size, mode, type }) => {
    const block = Buffer.alloc(512)
    // ustar: up to 100 bytes of name, plus up to 155 of prefix, split at a slash.
    let base = name
    let prefix = ''
    if (Buffer.byteLength(name) > 100) {
      let split = -1
      for (let index = name.indexOf('/'); index !== -1 && index < name.length - 1; index = name.indexOf('/', index + 1)) {
        if (Buffer.byteLength(name.slice(0, index)) <= 155 && Buffer.byteLength(name.slice(index + 1)) <= 100) {
          split = index
          break
        }
      }
      if (split === -1) throw new Error(`Path is too long to write into the box: ${name.slice(0, 120)}…`)
      base = name.slice(split + 1)
      prefix = name.slice(0, split)
    }
    block.write(base, 0, 100, 'utf8')
    if (prefix) block.write(prefix, 345, 155, 'utf8')
    block.write(`${mode.toString(8).padStart(7, '0')}\0`, 100, 8, 'ascii')
    block.write('0001750\0', 108, 8, 'ascii')
    block.write('0001750\0', 116, 8, 'ascii')
    block.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii')
    block.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')}\0`, 136, 12, 'ascii')
    block.write('        ', 148, 8, 'ascii')
    block.write(type, 156, 1, 'ascii')
    block.write('ustar\0', 257, 6, 'ascii')
    block.write('00', 263, 2, 'ascii')
    let sum = 0
    for (const byte of block) sum += byte
    block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
    return block
  }
  const directories = new Set()
  for (const file of files) {
    const parts = file.path.split('/').slice(0, -1)
    for (let depth = 1; depth <= parts.length; depth += 1) directories.add(`${parts.slice(0, depth).join('/')}/`)
  }
  for (const directory of [...directories].sort()) blocks.push(header({ name: directory, size: 0, mode: 0o755, type: '5' }))
  for (const file of files) {
    const content = Buffer.isBuffer(file.content) ? file.content : Buffer.from(String(file.content))
    blocks.push(header({ name: file.path, size: content.length, mode: file.mode ?? 0o644, type: '0' }))
    blocks.push(content)
    const padding = (512 - (content.length % 512)) % 512
    if (padding) blocks.push(Buffer.alloc(padding))
  }
  blocks.push(Buffer.alloc(1024))
  return Buffer.concat(blocks)
}

function waitFor(child) {
  return new Promise((resolve) => {
    let stderr = ''
    child.stderr?.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000) })
    child.on('error', (error) => resolve({ status: null, stderr: `${stderr}${error.message}` }))
    child.on('close', (status) => resolve({ status, stderr }))
  })
}

// Copy a host directory into a volume by streaming a tar through a throwaway,
// network-less container. No bind mount is involved.
// Helper containers mount a volume at a path the image already owns as the
// right user: Docker (unlike Podman) does not chown a fresh volume to the
// container user, it copies the ownership of the image directory underneath.
function helperMount(user) {
  return user === 'candidate' ? '/gate' : '/dst'
}

export async function copyIntoVolume(runtime, { image, volume, sourceDir, entries = ['.'], excludes = [], user = 'candidate', subdirectory = '' }) {
  const packArgs = ['-c', '-f', '-']
  // bsdtar on macOS would otherwise add AppleDouble files and xattr headers.
  if (process.platform === 'darwin') packArgs.push('--no-mac-metadata', '--no-xattrs')
  for (const exclude of excludes) packArgs.push('--exclude', exclude)
  packArgs.push('-C', sourceDir, ...entries)
  const pack = spawn('tar', packArgs, { env: { ...process.env, COPYFILE_DISABLE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  const mount = helperMount(user)
  const target = path.posix.join(mount, subdirectory)
  const unpack = spawn(runtime.bin, [...runtime.prefix, 'run', '--rm', '-i', '--network', 'none', '--user', user,
    '-v', `${volume}:${mount}`, '--entrypoint', 'sh', image, '-c', 'mkdir -p "$1" && exec tar -x -f - -C "$1" --no-same-owner', 'sh', target], { stdio: ['pipe', 'ignore', 'pipe'] })
  pack.stdout.pipe(unpack.stdin)
  unpack.stdin.on('error', () => {})
  const [packed, unpacked] = await Promise.all([waitFor(pack), waitFor(unpack)])
  if (packed.status !== 0) throw new Error(`Packing ${sourceDir} failed: ${packed.stderr}`)
  if (unpacked.status !== 0) throw new Error(`Copying into volume ${volume} failed: ${unpacked.stderr}`)
}

// Write generated files (from memory) into a volume.
export function writeIntoVolume(runtime, { image, volume, files, user = 'candidate' }) {
  if (files.length === 0) return
  const mount = helperMount(user)
  engine(runtime, ['run', '--rm', '-i', '--network', 'none', '--user', user, '-v', `${volume}:${mount}`,
    '--entrypoint', 'tar', image, '-x', '-f', '-', '-C', mount, '--no-same-owner'], { input: tarBuffer(files), check: true, encoding: 'buffer' })
}

// Copy a volume (or a subdirectory of it) out to a host directory. The tar is
// produced by the image's own tar binary in a fresh container, so the stream's
// framing is trusted even though the file contents are not; callers sanitize
// the extracted tree (see sanitizeTree) before anything on the host reads it.
export const EXPORT_LIMIT_BYTES = Number(process.env.STAGEBENCH_EXPORT_LIMIT_MB || 4096) * 1024 * 1024

export async function copyOutOfVolume(runtime, { image, volume, subdirectory = '.', destinationDir, excludes = [], limitBytes = EXPORT_LIMIT_BYTES }) {
  // Measure before copying: apparent size, so a sparse file counts at the size
  // it would expand to on this side.
  const measure = engine(runtime, ['run', '--rm', '--network', 'none', '--user', 'candidate', '-v', `${volume}:/src:ro`, '--entrypoint', 'du', image,
    '-sb', '--apparent-size', ...excludes.map((exclude) => `--exclude=${exclude}`), path.posix.join('/src', subdirectory)], { timeout: 300_000 })
  const bytes = Number(String(measure.stdout).trim().split(/\s+/)[0])
  if (measure.status !== 0 || !Number.isFinite(bytes)) throw new Error(`Could not measure volume ${volume} before export: ${String(measure.stderr).trim().slice(-300)}`)
  if (bytes > limitBytes) {
    throw new Error(`Refusing to export ${Math.round(bytes / 1024 / 1024)} MB from ${volume} (limit ${Math.round(limitBytes / 1024 / 1024)} MB; raise STAGEBENCH_EXPORT_LIMIT_MB if this is expected)`)
  }
  fs.mkdirSync(destinationDir, { recursive: true })
  const packArgs = ['run', '--rm', '--network', 'none', '--user', 'candidate', '-v', `${volume}:/src:ro`,
    '--entrypoint', 'tar', image, '-c', '-f', '-', '-C', path.posix.join('/src', subdirectory)]
  for (const exclude of excludes) packArgs.push(`--exclude=${exclude}`)
  packArgs.push('.')
  const pack = spawn(runtime.bin, [...runtime.prefix, ...packArgs], { stdio: ['ignore', 'pipe', 'pipe'] })
  // No -P: absolute paths and `..` members are refused. Ownership and special
  // permission bits are never restored.
  const unpack = spawn('tar', ['-x', '-f', '-', '-C', destinationDir, '--no-same-owner', '--no-same-permissions'], { stdio: ['pipe', 'ignore', 'pipe'] })
  pack.stdout.pipe(unpack.stdin)
  unpack.stdin.on('error', () => {})
  const [packed, unpacked] = await Promise.all([waitFor(pack), waitFor(unpack)])
  if (packed.status !== 0) throw new Error(`Reading volume ${volume} failed: ${packed.stderr}`)
  if (unpacked.status !== 0) throw new Error(`Extracting volume ${volume} failed: ${unpacked.stderr}`)
}

// Everything a candidate wrote is data until proven otherwise. A symlink that
// points outside the tree is dangling inside the box but live on the host: the
// next host-side step would follow it (`public/samples -> ~/Projects/...`) and
// read whatever it finds. Even a link that stays inside the tree is rewritten
// to an absolute host path by the first recursive copy. So no link crosses the
// boundary at all: every symlink is removed, along with anything else that is
// not a plain file or directory, and each removal is reported.
export function sanitizeTree(rootDirectory) {
  const root = fs.realpathSync(rootDirectory)
  const dropped = []
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      const relative = path.relative(root, absolute).split(path.sep).join('/')
      if (entry.isSymbolicLink()) {
        const target = fs.readlinkSync(absolute)
        fs.rmSync(absolute, { force: true })
        dropped.push({ path: relative, kind: 'symlink', target })
      } else if (entry.isDirectory()) {
        visit(absolute)
      } else if (!entry.isFile()) {
        fs.rmSync(absolute, { force: true })
        dropped.push({ path: relative, kind: 'special' })
      }
    }
  }
  visit(root)
  return dropped
}
