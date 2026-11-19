// `pnpm bench lockdown-setup`: get this machine to the point where a candidate
// can be boxed, and say plainly what the boundary looks like.
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { DEFAULT_IMAGE_TARGETS, EGRESS_NETWORK, PODMAN_MACHINE, detectRuntime, engine, ensureImages, hostExposure } from './runtime.mjs'
import { offlineToolchain } from './session.mjs'

function podman(args, options = {}) {
  return spawnSync('podman', args, { encoding: 'utf8', timeout: 900_000, ...options })
}

// A Podman machine of our own, created with no host directories shared into it
// (the default machine shares /Users, /private and /var/folders). The lockdown
// never bind-mounts anything, so the VM has no reason to see the host disk —
// and without the share, a container escape lands somewhere with nothing in it.
function ensurePodmanMachine(onOutput) {
  if (podman(['--version']).status !== 0) return { created: false, available: false }
  const listed = podman(['machine', 'list', '--format', '{{.Name}} {{.Running}}'])
  const machines = Object.fromEntries(listed.stdout.split('\n').filter(Boolean).map((line) => {
    const [name, running] = line.replace('*', '').split(/\s+/)
    return [name, running === 'true']
  }))
  let created = false
  if (!(PODMAN_MACHINE in machines)) {
    const cpus = Math.max(2, Math.min(8, Math.floor(os.cpus().length / 2)))
    const memory = Math.max(4096, Math.min(16384, Math.floor(os.totalmem() / 1024 / 1024 / 4)))
    onOutput?.(`→ creating Podman machine "${PODMAN_MACHINE}" (${cpus} CPUs, ${memory} MiB, no host directories shared)\n`)
    const init = podman(['machine', 'init', PODMAN_MACHINE, '--cpus', String(cpus), '--memory', String(memory), '--disk-size', '60', '--volume', ''])
    if (init.status !== 0) throw new Error(`podman machine init failed: ${init.stderr.trim().slice(-800)}`)
    created = true
  }
  if (!machines[PODMAN_MACHINE]) {
    onOutput?.(`→ starting Podman machine "${PODMAN_MACHINE}"\n`)
    const start = podman(['machine', 'start', PODMAN_MACHINE])
    if (start.status !== 0 && !/already running/i.test(start.stderr)) throw new Error(`podman machine start failed: ${start.stderr.trim().slice(-800)}`)
  }
  return { created, available: true }
}

// The one property everything else rests on, checked for real: a container on
// an internal network cannot open a connection to the internet or resolve a name.
function egressSelfTest(runtime, image) {
  const network = `sb-selftest-${process.pid}`
  engine(runtime, ['network', 'rm', '-f', network])
  engine(runtime, ['network', 'create', '--internal', network], { check: true })
  try {
    const result = engine(runtime, ['run', '--rm', '--network', network, '--cap-drop=ALL', '--entrypoint', 'sh', image, '-c',
      'curl -s -m 5 -o /dev/null https://1.1.1.1/ && echo DIRECT-OPEN; getent hosts registry.npmjs.org >/dev/null && echo DNS-OPEN; echo done'], { timeout: 60_000 })
    const leaks = ['DIRECT-OPEN', 'DNS-OPEN'].filter((marker) => result.stdout.includes(marker))
    return leaks.length === 0 && result.stdout.includes('done') ? 'closed: no route out and no external DNS from an internal network' : `OPEN (${leaks.join(', ') || 'self-test did not run'}): this engine's internal networks are not isolated; do not use it for runs`
  } finally {
    engine(runtime, ['network', 'rm', '-f', network])
  }
}

// The other property protocol 3 rests on: a box with no network at all can
// still install the starter, run its tests, and find its browser. Checked for
// real, in a container with `--network none`.
function offlineSelfTest(runtime, image) {
  const script = [
    'set -e',
    'cd /tmp && mkdir -p probe && cd probe',
    'echo \'{"name":"probe","private":true}\' > package.json',
    'pnpm add react vitest playwright >/dev/null 2>&1',
    'node -e "require(\'react\'); require(\'playwright\').chromium.launch().then(async (b) => { console.log(\'chromium \' + b.version()); await b.close() })"',
    'if pnpm add is-odd >/dev/null 2>&1; then echo UNLISTED-INSTALLED; fi',
    'if curl -s -m 4 -o /dev/null https://registry.npmjs.org/; then echo NETWORK-OPEN; fi',
    'echo offline-ok',
  ].join('\n')
  const result = engine(runtime, ['run', '--rm', '--init', '--network', 'none', '--cap-drop=ALL', '--security-opt', 'no-new-privileges', '--read-only', '--tmpfs', '/tmp:rw,exec,size=2g,mode=1777',
    '--user', 'candidate', '-v', '/home/candidate', '-e', 'STAGEBENCH_REGISTRY=http://127.0.0.1:4874/', '-e', 'npm_config_registry=http://127.0.0.1:4874/', image, 'sh', '-c', script], { timeout: 300_000 })
  const leaks = ['UNLISTED-INSTALLED', 'NETWORK-OPEN'].filter((marker) => result.stdout.includes(marker))
  if (leaks.length > 0) return `BROKEN (${leaks.join(', ')}): a network-less box reached something it should not`
  if (!result.stdout.includes('offline-ok')) return `BROKEN: a network-less box could not install and launch a browser: ${String(result.stderr || result.stdout).trim().slice(-300)}`
  return `works: with no network, packages install from the image's mirror and ${(/chromium [\d.]+/.exec(result.stdout) ?? ['Chromium'])[0]} launches; an unlisted package does not install`
}

// The omp image (Bun and the pinned omp on top of the candidate box) runs the
// CLI it carries, with no network: a version, and nothing else.
function ompSelfTest(runtime, image) {
  const result = engine(runtime, ['run', '--rm', '--network', 'none', '--cap-drop=ALL', '--security-opt', 'no-new-privileges', '--read-only', '--tmpfs', '/tmp:rw,exec,size=256m,mode=1777',
    '--user', 'candidate', '-v', '/home/candidate', '--entrypoint', 'sh', image, '-c', 'echo "bun $(bun --version)"; omp --version'], { timeout: 120_000 })
  if (result.status !== 0) return `BROKEN: ${String(result.stderr || result.stdout).trim().slice(-300)}`
  return result.stdout.trim().split('\n').filter(Boolean).join('; ')
}

export async function setupLockdown({ rebuild = false, omp = false, onOutput, env = process.env } = {}) {
  let runtime = detectRuntime(env)
  let machine = null
  if (!runtime || (runtime.kind === 'podman' && !runtime.prefix.includes(PODMAN_MACHINE) && !runtime.explicit)) {
    machine = ensurePodmanMachine(onOutput)
    runtime = detectRuntime(env)
  }
  if (!runtime) {
    throw new Error('No container runtime found. Install Podman (`brew install podman` on macOS, your package manager on Linux) and run this again, or set STAGEBENCH_CONTAINER_RUNTIME to a Docker-compatible engine.')
  }
  const images = await ensureImages(runtime, { onOutput, rebuild, targets: omp ? [...DEFAULT_IMAGE_TARGETS, 'candidate-omp'] : DEFAULT_IMAGE_TARGETS })
  if (engine(runtime, ['network', 'inspect', EGRESS_NETWORK]).status !== 0) engine(runtime, ['network', 'create', '--label', 'stagebench.lockdown=1', EGRESS_NETWORK], { check: true })
  return {
    runtime: `${runtime.bin} ${runtime.prefix.join(' ')}`.trim(),
    engine: `${runtime.kind} ${runtime.version}`,
    ...(machine?.created ? { machine: `created "${PODMAN_MACHINE}"` } : {}),
    images,
    hostDirectoriesVisibleToVm: (({ state, detail }) => `${state}: ${detail}`)(hostExposure(runtime)),
    internalNetworkEgress: egressSelfTest(runtime, images.candidate.tag),
    offlineToolchain: { ...offlineToolchain(), selfTest: offlineSelfTest(runtime, images.candidate.tag) },
    ...(images.candidateOmp ? { omp: ompSelfTest(runtime, images.candidateOmp.tag) } : {}),
    next: 'pnpm bench fetch   (manual, photos, sample pack), pnpm bench redteam   (attack the boundary), then pnpm bench new --model <id> --target <1|2|3>',
  }
}
