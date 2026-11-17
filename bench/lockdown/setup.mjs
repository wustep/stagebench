// `pnpm bench lockdown-setup`: get this machine to the point where a candidate
// can be boxed, and say plainly what the boundary looks like.
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { EGRESS_NETWORK, PODMAN_MACHINE, detectRuntime, engine, ensureImages, hostExposure } from './runtime.mjs'

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

export async function setupLockdown({ rebuild = false, onOutput, env = process.env } = {}) {
  let runtime = detectRuntime(env)
  let machine = null
  if (!runtime || (runtime.kind === 'podman' && !runtime.prefix.includes(PODMAN_MACHINE) && !runtime.explicit)) {
    machine = ensurePodmanMachine(onOutput)
    runtime = detectRuntime(env)
  }
  if (!runtime) {
    throw new Error('No container runtime found. Install Podman (`brew install podman` on macOS, your package manager on Linux) and run this again, or set STAGEBENCH_CONTAINER_RUNTIME to a Docker-compatible engine.')
  }
  const images = await ensureImages(runtime, { onOutput, rebuild })
  if (engine(runtime, ['network', 'inspect', EGRESS_NETWORK]).status !== 0) engine(runtime, ['network', 'create', '--label', 'stagebench.lockdown=1', EGRESS_NETWORK], { check: true })
  return {
    runtime: `${runtime.bin} ${runtime.prefix.join(' ')}`.trim(),
    engine: `${runtime.kind} ${runtime.version}`,
    ...(machine?.created ? { machine: `created "${PODMAN_MACHINE}"` } : {}),
    images,
    hostDirectoriesVisibleToVm: (({ state, detail }) => `${state}: ${detail}`)(hostExposure(runtime)),
    internalNetworkEgress: egressSelfTest(runtime, images.candidate.tag),
    next: 'pnpm bench redteam   (attack the boundary), then pnpm bench new --model <id> --target <1|2|3>',
  }
}
